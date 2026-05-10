/**
 * POST /api/attendance — 학생 등원/하원 출석 처리 라우트
 *
 * 인증: tablet 또는 admin 토큰 쿠키 필수 (lib/auth/tablet.ts).
 *       academy_id는 항상 claims에서 받아 외부 주입 통로를 차단.
 *
 * 전체 흐름:
 *   -1. 인증 게이트 (tablet/admin 쿠키)
 *    0. Rate limit (IP × 토큰 두 차원)
 *    1. 본문 파싱 + 형식 검증
 *    2. phone_last4로 후보 학생 조회 (학원·활성 필터)
 *       - 0명: NOT_FOUND / 2명+: MULTIPLE / 1명: 다음 단계
 *    3. 쿨타임 체크 (동일 학생 + 동일 type, 5분 이내 차단)
 *    4. attendance_logs 기록
 *    5. 학부모 수만큼 notification_logs를 'pending'으로 적재
 *    6. /api/notify 비동기 호출 (cron secret 헤더 동봉)
 *    7. 성공 응답
 *
 * 응답 status code 정책:
 *   - 200: 비즈니스 분기 전부 (success/NOT_FOUND/MULTIPLE/COOLDOWN)
 *          → 클라이언트는 res.ok 후 body.error 필드만 보고 분기
 *   - 400: 본문 검증 실패
 *   - 401: 인증 토큰 없음/위조/만료
 *   - 429: rate limit 초과
 *   - 500: DB 오류 등 서버 문제
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getTabletOrAdminClaims } from '@/lib/auth/tablet';
import { rateLimit, getClientIp } from '@/lib/ratelimit';
import { CRON_SECRET_HEADER } from '@/lib/auth/cron';
import type { AttendanceType, TablesInsert } from '@/lib/types/database';

// 외부 입력은 형태를 신뢰할 수 없어 unknown으로 받아 런타임에 검증한다.
// (any로 받으면 타입 시스템이 검증을 강제하지 못함)
//
// academy_id 필드는 더 이상 받지 않는다 — 인증 토큰의 claims.academy_id로 강제.
// why: 외부에서 다른 학원 ID를 주입할 통로를 차단.
type AttendanceRequest = {
  phone_last4?: unknown;
  type?: unknown;
  student_id?: unknown;
};

// 동일 학생 + 동일 type 재입력을 차단하는 윈도우 (분).
// CLAUDE.md "쿨타임 규칙": checkin→checkin / checkout→checkout만 5분 차단.
const COOLDOWN_MINUTES = 5;

export async function POST(request: Request) {
  // ── -1. 인증 게이트 ──────────────────────────────────────────
  //
  // tablet 또는 admin 토큰 필수. 두 경로 모두 academy_id를 토큰에서 받아 사용한다.
  // why: 익명 호출을 허용하면 알림톡 비용 폭탄(스팸 발송)·brute-force·DoS 통로가 됨.
  const claims = await getTabletOrAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // ── 0. Rate limit (IP × 토큰 둘 다) ──────────────────────────
  //
  // 두 차원으로 나눠 거는 이유:
  //   - IP만 걸면 같은 학원 NAT 뒤에 여러 디바이스 사용 시 서로 차단할 수 있음.
  //   - 토큰만 걸면 한 토큰이 여러 IP로 분산되는 케이스를 못 막음.
  // 하나라도 한도 초과면 429.
  const ip = getClientIp(request);
  const ipResult = await rateLimit.attendanceIp.limit(ip);
  const tokenResult = await rateLimit.attendanceToken.limit(claims.academy_id);
  if (!ipResult.success || !tokenResult.success) {
    return NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 });
  }

  // ── 1. 요청 본문 파싱 ─────────────────────────────────────────

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
  // student_id는 옵셔널 — MULTIPLE 응답을 받은 클라이언트가 학생을 고른 뒤에만 넣어 보낸다.
  const student_id =
    typeof body.student_id === 'string' && body.student_id.length > 0
      ? body.student_id
      : undefined;

  // 본문 형식 검증: 정확히 숫자 4자리인지 / type이 enum 값인지.
  // why: DB까지 가기 전에 잘못된 입력을 거절해 불필요한 쿼리·로그를 방지.
  //      academy_id는 인증 토큰의 claims에서 직접 가져오므로 본문 검증 대상 아님.
  if (!/^\d{4}$/.test(phone_last4)) {
    return NextResponse.json({ error: 'INVALID_PHONE' }, { status: 400 });
  }
  if (type !== 'checkin' && type !== 'checkout') {
    return NextResponse.json({ error: 'INVALID_TYPE' }, { status: 400 });
  }

  // 검증 통과 시점에 attendanceType을 enum 타입으로 고정 → 이후 DB insert에 그대로 사용 가능.
  const attendanceType: AttendanceType = type;

  // 서버 라우트용 Supabase 클라이언트 (service_role 키로 RLS 우회).
  const supabase = await createClient();

  // academy_id는 인증된 토큰에서만 받는다.
  // why: 외부에서 academy_id를 주입할 통로(body/env)를 닫아 학원 격리를 강제.
  //      claims는 /api/auth(admin) 또는 /api/auth/tablet 발급 시점에 academies row의
  //      실제 id로 박혀 있으므로 추가 DB 조회 불필요.
  const academy_id = claims.academy_id;

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

  // ── 4. notification_logs 'pending' 적재 ──────────────────────

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
  //
  // x-cron-secret: /api/notify가 익명 호출을 차단하므로 같은 origin 자체 호출도
  //                공유 비밀 헤더를 동봉해야 통과한다 (lib/auth/cron.ts 참고).
  void fetch(new URL('/api/notify', request.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CRON_SECRET_HEADER]: process.env.CRON_SECRET ?? '',
    },
    body: JSON.stringify({ attendance_id: attendance.id }),
  }).catch((err) => {
    console.error('[attendance] notify dispatch failed:', err);
  });

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
