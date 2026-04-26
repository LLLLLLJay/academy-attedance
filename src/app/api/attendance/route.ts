/**
 * POST /api/attendance — 학생 등원/하원 출석 처리 라우트
 *
 * 전체 흐름:
 *   0. 요청 본문 파싱 + 형식 검증
 *   1. phone_last4로 후보 학생 조회 (학원·활성 필터)
 *      - 0명: NOT_FOUND / 2명+: MULTIPLE / 1명: 다음 단계
 *   2. 쿨타임 체크 (동일 학생 + 동일 type, 5분 이내 차단)
 *   3. attendance_logs 기록
 *   4. 학부모 수만큼 notification_logs를 'pending'으로 적재
 *   5. /api/notify 비동기 호출 (현재 TODO)
 *   6. 성공 응답
 *
 * 응답 status code 정책:
 *   - 200: 비즈니스 분기 전부 (success/NOT_FOUND/MULTIPLE/COOLDOWN)
 *          → 클라이언트는 res.ok 후 body.error 필드만 보고 분기
 *   - 400: 본문 검증 실패
 *   - 500: DB 오류 등 서버 문제
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import type { AttendanceType, TablesInsert } from '@/lib/types/database';

// 외부 입력은 형태를 신뢰할 수 없어 unknown으로 받아 런타임에 검증한다.
// (any로 받으면 타입 시스템이 검증을 강제하지 못함)
type AttendanceRequest = {
  phone_last4?: unknown;
  type?: unknown;
  academy_id?: unknown;
  student_id?: unknown;
};

// 동일 학생 + 동일 type 재입력을 차단하는 윈도우 (분).
// CLAUDE.md "쿨타임 규칙": checkin→checkin / checkout→checkout만 5분 차단.
const COOLDOWN_MINUTES = 5;

export async function POST(request: Request) {
  // ── 0. 요청 본문 파싱 ─────────────────────────────────────────

  // request.json()은 본문이 비었거나 JSON이 아니면 throw → 400으로 매핑.
  // 여기서 막지 않으면 아래 분기에서 undefined.X 형태로 더 모호한 에러가 난다.
  let body: AttendanceRequest;
  try {
    body = (await request.json()) as AttendanceRequest;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  // 각 필드를 타입 가드로 안전하게 좁힌다.
  // 문자열이 아니면 빈 문자열로 떨어뜨려 다음 검증 단계에서 일관되게 거른다.
  const phone_last4 = typeof body.phone_last4 === 'string' ? body.phone_last4 : '';
  const type = body.type;
  const bodyAcademyId =
    typeof body.academy_id === 'string' && body.academy_id.length > 0
      ? body.academy_id
      : '';
  // student_id는 옵셔널 — MULTIPLE 응답을 받은 클라이언트가 학생을 고른 뒤에만 넣어 보낸다.
  const student_id =
    typeof body.student_id === 'string' && body.student_id.length > 0
      ? body.student_id
      : undefined;

  // 본문 형식 검증: 정확히 숫자 4자리인지 / type이 enum 값인지.
  // why: DB까지 가기 전에 잘못된 입력을 거절해 불필요한 쿼리·로그를 방지.
  //      academy_id는 아래 단계에서 env/DB로 보강하므로 여기선 검증하지 않는다.
  if (!/^\d{4}$/.test(phone_last4)) {
    return NextResponse.json({ error: 'INVALID_PHONE' }, { status: 400 });
  }
  if (type !== 'checkin' && type !== 'checkout') {
    return NextResponse.json({ error: 'INVALID_TYPE' }, { status: 400 });
  }

  // 검증 통과 시점에 attendanceType을 enum 타입으로 고정 → 이후 DB insert에 그대로 사용 가능.
  const attendanceType: AttendanceType = type;

  // 서버 컴포넌트/라우트 핸들러용 Supabase 클라이언트 생성 (쿠키 기반 세션 관리).
  const supabase = await createClient();

  // ── 0b. academy_id 결정 (env → body → academies 첫 row) ──────
  //
  // 태블릿은 로그인이 없어 JWT/세션이 없고 body에 academy_id를 실어 보낼 출처도 없다.
  // 그래서 서버에서 다음 우선순위로 보강한다:
  //   1) NEXT_PUBLIC_ACADEMY_ID (운영에서 학원별로 박아 넣는 표준 경로)
  //   2) body.academy_id (관리자/테스트 클라이언트가 명시적으로 넘긴 경우)
  //   3) academies 테이블의 첫 row (단일 학원 운영 환경의 fallback)
  // why: 4자리는 학원 간 우연히 겹칠 수 있어 academy_id 필터가 빠지면 다른 학원
  //      학생이 잡혀 NOT_FOUND/MULTIPLE이 잘못 떨어지므로 반드시 1개로 결정해야 한다.
  let academy_id = '';
  let academySource: 'env' | 'body' | 'db' | 'none' = 'none';

  const envAcademyId = process.env.NEXT_PUBLIC_ACADEMY_ID ?? '';
  if (envAcademyId) {
    academy_id = envAcademyId;
    academySource = 'env';
  } else if (bodyAcademyId) {
    academy_id = bodyAcademyId;
    academySource = 'body';
  } else {
    // env도 body도 없으면 DB에서 가장 오래된 학원 1개를 집어 사용한다 (단일 학원 가정).
    const { data: firstAcademy, error: academyErr } = await supabase
      .from('academies')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (academyErr) {
      return NextResponse.json(
        { error: 'DB_ERROR', detail: academyErr.message },
        { status: 500 },
      );
    }
    if (firstAcademy?.id) {
      academy_id = firstAcademy.id;
      academySource = 'db';
    }
  }

  // 디버깅용 로그 — 어디서 academy_id가 왔는지/실제 값이 무엇인지 확인.
  // (배포 전에 제거하거나 NODE_ENV 체크로 감싸도 됨)
  console.log('[attendance] academy_id resolved:', {
    source: academySource,
    academy_id,
    bodyAcademyId,
    envAcademyId,
  });

  if (!academy_id) {
    // env/body/DB 어디에도 학원이 없으면 더 이상 진행 불가.
    return NextResponse.json({ error: 'MISSING_ACADEMY' }, { status: 400 });
  }

  // ── 1. phone_last4 → 후보 학생 ID 모으기 ─────────────────────

  // student_parents에서 뒷자리 4자리가 일치하는 학부모 행을 모두 가져온다.
  // why: SCHEMA.md의 "뒷자리 4자리로 학생 찾기" 핵심 쿼리를 두 단계로 분리한 첫 절반.
  //      한 SQL JOIN으로 묶어도 되지만 supabase-js의 관계 select는 타입 추론이 까다로워
  //      두 쿼리로 나누는 편이 가독성·타입 안정성 모두 낫다.
  const { data: parentRows, error: parentErr } = await supabase
    .from('student_parents')
    .select('student_id')
    .eq('phone_last4', phone_last4);

  if (parentErr) {
    // DB 자체가 실패한 케이스 — 비즈니스 분기와 구분해 500으로 올린다.
    return NextResponse.json(
      { error: 'DB_ERROR', detail: parentErr.message },
      { status: 500 },
    );
  }

  // 한 학생이 여러 학부모(엄마/아빠/할머니)를 둘 수 있어서 student_id가 중복될 수 있다.
  // Set으로 중복을 제거해야 "MULTIPLE 1명+1명+1명 = 3명" 같은 오판을 막는다.
  const candidateIds = Array.from(
    new Set((parentRows ?? []).map((r) => r.student_id)),
  );
  if (candidateIds.length === 0) {
    // 어떤 학원에서도 매칭되는 학부모가 없음 → 입력 오타거나 미등록 학생.
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 200 });
  }

  // ── 1b. 학원 + 활성 필터 (+ 선택된 student_id로 좁힘) ──────────

  // 후보 ID 중에서 (a) 이 학원 소속 + (b) 활성 상태인 학생만 골라낸다.
  // why: 4자리는 우연히 다른 학원 학부모와 겹칠 수 있고, 퇴원생도 같은 4자리를 쓸 수 있다.
  let studentQuery = supabase
    .from('students')
    .select('id, name')
    .in('id', candidateIds)
    .eq('academy_id', academy_id)
    .eq('is_active', true);

  // student_id가 들어왔다는 건 직전 MULTIPLE 응답에서 사용자가 한 명을 골랐다는 뜻.
  // 그 한 명만 단일 행으로 좁혀 두 번째 호출이 곧장 단일 분기를 타도록 한다.
  if (student_id) {
    studentQuery = studentQuery.eq('id', student_id);
  }

  const { data: students, error: studentErr } = await studentQuery;
  if (studentErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: studentErr.message },
      { status: 500 },
    );
  }
  if (!students || students.length === 0) {
    // 후보는 있었지만 학원/활성 필터에서 다 걸러짐 → 사용자에겐 NOT_FOUND와 동일하게 안내.
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 200 });
  }
  if (!student_id && students.length > 1) {
    // 같은 4자리에 학생이 둘 이상 → 태블릿에서 이름 선택 UI를 띄우라고 알려준다.
    // 클라이언트는 사용자가 고른 학생의 id를 student_id 필드에 넣어 다시 POST한다.
    return NextResponse.json(
      {
        error: 'MULTIPLE',
        students: students.map((s) => ({ id: s.id, name: s.name })),
      },
      { status: 200 },
    );
  }

  // 이 시점에서 학생은 정확히 1명으로 확정 → 이후 처리의 기준이 된다.
  const target = students[0];

  // ── 2. 쿨타임 체크 (동일 학생 + 동일 type, 5분 이내) ──────────

  // 5분 전 시각을 ISO 문자열로 만들어 supabase의 .gte() 비교에 사용.
  // why: 클라이언트 시계가 아닌 서버 시계 기준으로 비교해야 위·변조에 안전.
  const cooldownThreshold = new Date(
    Date.now() - COOLDOWN_MINUTES * 60 * 1000,
  ).toISOString();

  // 같은 학생의 같은 type 기록이 5분 이내에 1건이라도 있는지만 확인 → limit(1).
  // why: 존재 여부만 알면 되므로 전체 카운트나 풀 셀렉트는 불필요.
  //      checkin→checkout(혹은 반대)은 차단하지 않으므로 type 조건이 필수.
  //      checked_at도 함께 가져오는 이유: 클라이언트(CooldownScreen)에 남은 분을 돌려주려고.
  const { data: recent, error: cooldownErr } = await supabase
    .from('attendance_logs')
    .select('id, checked_at')
    .eq('student_id', target.id)
    .eq('type', attendanceType)
    .gte('checked_at', cooldownThreshold)
    .order('checked_at', { ascending: false })
    .limit(1);

  if (cooldownErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: cooldownErr.message },
      { status: 500 },
    );
  }
  if (recent && recent.length > 0) {
    // 5분 안에 같은 type 기록이 존재 → 중복 입력으로 판정해 거절.
    // 화면에 "약 N분 후 다시" 안내를 띄우기 위해 학생명과 남은 분을 함께 돌려준다.
    const lastCheckedMs = new Date(recent[0].checked_at!).getTime();
    const elapsedMs = Date.now() - lastCheckedMs;
    const remainMin = Math.max(
      1,
      Math.ceil((COOLDOWN_MINUTES * 60 * 1000 - elapsedMs) / 60_000),
    );
    return NextResponse.json(
      {
        error: 'COOLDOWN',
        student: { name: target.name },
        remainMin,
      },
      { status: 200 },
    );
  }

  // ── 3. attendance_logs 기록 ──────────────────────────────────

  // checked_at은 명시적으로 넣지 않고 DB의 default(now())에 위임한다.
  // why: 서버↔DB 간 시계 불일치를 피하고, 모든 기록이 DB 단일 시계 기준으로 정렬됨.
  const attendanceInsert: TablesInsert<'attendance_logs'> = {
    student_id: target.id,
    academy_id,
    type: attendanceType,
  };

  // insert 후 .select().single()로 방금 만든 row를 즉시 돌려받아 응답에 사용한다.
  // why: 다시 select 호출하지 않아도 id/checked_at을 한 번에 확보 → 라운드트립 1회 절약.
  const { data: attendance, error: insertErr } = await supabase
    .from('attendance_logs')
    .insert(attendanceInsert)
    .select('id, type, checked_at')
    .single();

  if (insertErr || !attendance) {
    // 이 단계 실패는 "출석 처리 자체 실패"이므로 사용자에게 명확히 500으로 알린다.
    // 이후 단계(notification_logs)와 다르게 부분 성공으로 묻으면 안 된다.
    return NextResponse.json(
      {
        error: 'DB_ERROR',
        detail: insertErr?.message ?? 'attendance insert failed',
      },
      { status: 500 },
    );
  }

  // ── 4·5. 알림톡/SMS 발송 일시 비활성화 ──────────────────────────
  //
  // 카카오 알림톡/SMS 발송 기능을 임시로 꺼둔 상태.
  // why: 솔라피 검수/운영 결정이 끝날 때까지 실제 발송을 막고,
  //      "전송실패"가 관리자 페이지에 누적되지 않도록 notification_logs 적재 자체를 생략.
  //      → 출석은 정상 기록되지만 알림은 보내지 않음 (학부모 통지 없음).
  // 다시 켤 때: 아래 블록의 주석을 해제하면 됨 (parents 조회 / pending insert / /api/notify 호출).
  /*
  // 해당 학생의 학부모 ID를 다시 조회.
  // why: 1단계에선 phone_last4 일치하는 부모만 가져왔지만,
  //      알림은 "그 학생의 모든 학부모"에게 가야 하므로 student_id 기준으로 새로 가져온다.
  const { data: parents, error: parentsErr } = await supabase
    .from('student_parents')
    .select('id')
    .eq('student_id', target.id);

  if (parentsErr) {
    // 출석은 이미 기록됨 → 500을 던지면 사용자는 "출석 실패"로 오해한다.
    // 알림 누락은 후속 cron이나 관리자 페이지에서 복구 가능하므로 로그만 남기고 진행.
    console.error(
      '[attendance] failed to load parents for notify:',
      parentsErr.message,
    );
  } else if (parents && parents.length > 0) {
    // 학부모 1명당 pending 행 1개. 실제 발송과 재시도(1분→5분→15분)는
    // /api/notify 라우트와 pg_cron 워커가 담당한다 (CLAUDE.md 재시도 규칙).
    const notifyRows: TablesInsert<'notification_logs'>[] = parents.map((p) => ({
      attendance_id: attendance.id,
      parent_id: p.id,
      status: 'pending',
      attempt_count: 0,
    }));

    const { error: notifyErr } = await supabase
      .from('notification_logs')
      .insert(notifyRows);

    if (notifyErr) {
      // 부분 실패 — 출석 응답은 깨뜨리지 않고 서버 로그만 남긴다 (위와 같은 이유).
      console.error(
        '[attendance] notification_logs insert failed:',
        notifyErr.message,
      );
    }
  }

  // ── 5. /api/notify 비동기 호출 (fire-and-forget) ──────────────

  // await 없이 트리거만 던지고 응답은 기다리지 않는다.
  // why: 알림톡 발송이 출석 응답 속도(목표 5초 이내)에 영향 주면 안 됨.
  //      태블릿은 빠르게 "등원 완료" 화면으로 넘어가야 다음 학생을 받을 수 있다.
  //      네트워크 오류로 트리거 자체가 실패해도 pending 행은 남아 있으므로
  //      후속 pg_cron 워커가 픽업해 재시도한다.
  void fetch(new URL('/api/notify', request.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendance_id: attendance.id }),
  }).catch((err) => {
    console.error('[attendance] notify dispatch failed:', err);
  });
  */

  // ── 6. 성공 응답 ────────────────────────────────────────────

  // 태블릿 확인 화면("○○○ 학생 등원 완료 - HH:MM")에 필요한 최소 정보만 반환.
  // why: 응답 페이로드를 작게 유지해 모바일 네트워크 환경에서도 빠르게 처리.
  return NextResponse.json({
    success: true,
    student: {
      name: target.name,
      type: attendance.type,
      checked_at: attendance.checked_at,
    },
  });
}
