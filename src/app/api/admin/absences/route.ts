/**
 * /api/admin/absences — 결석 관리 라우트
 *
 * 가드: admin JWT 쿠키 검증 후 academy_id를 claims에서 꺼내 사용한다.
 *      쿼리스트링/본문으로 받은 academy_id는 신뢰하지 않음 — 다른 학원 데이터 노출 방지.
 *
 * GET:
 *   학원 개원일(academies.created_at) ~ 오늘(KST) 사이에서
 *   "활성 학생 × 날짜" 조합 중 등원(checkin) 기록이 없는 (학생, 날짜)를 모두 반환한다.
 *   해당 (학생, 날짜)에 'absent' 로그가 이미 있으면 보강 메모와 그 row id도 함께 내려준다.
 *   학생의 created_at 이전 날짜는 결석 후보에서 제외 (그 학생이 아직 학원에 없던 날).
 *
 * POST:
 *   { student_id, date, memo } 를 받아 해당 (학생, KST 날짜)에
 *   type='absent' 로그를 INSERT 또는 UPDATE 한다.
 *   why: SCHEMA.md의 attendance_logs.memo 컬럼 — 결석 사유/보강 일정 등을 원장이 기록.
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';
import type { TablesInsert, TablesUpdate } from '@/lib/types/database';

// ── 응답 / 요청 형태 ──────────────────────────────────────────────

type AbsenceRow = {
  student_id: string;
  student_name: string;
  // KST 기준 'YYYY-MM-DD' — 화면에서 그대로 정렬·표시 가능하도록 문자열로 평탄화.
  date: string;
  // 'absent' 로그가 아직 없으면 null, 있으면 그 row id (POST에서 UPDATE 분기 판정에 쓰임).
  absence_log_id: string | null;
  memo: string | null;
  // 보강 메모 작성일(ISO timestamptz) — 화면의 "작성일 YYYY.MM.DD" 표시에 사용.
  // why: INSERT 시점에 찍히고 UPDATE 시에도 함께 갱신되어 "최근 작성일"을 의미.
  //      별도 updated_at 컬럼을 추가하지 않고 created_at을 mutate해 schema 변경을 회피.
  memo_created_at: string | null;
};

type PostBody = {
  student_id?: unknown;
  date?: unknown;
  memo?: unknown;
};

// ── KST 날짜 유틸 ─────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// timestamptz(ISO) → KST 기준 'YYYY-MM-DD'.
// why: KST 자정 경계로 "그 날의 출석"을 묶기 위해. UTC 그대로 사용하면 새벽 출석이
//      전날로 분류돼 결석 판정이 틀어진다.
function toKstDateStr(iso: string): string {
  const t = new Date(iso).getTime() + KST_OFFSET_MS;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' (KST 해석) → 그 날의 [from, to) UTC ISO 범위.
// why: attendance_logs.checked_at은 timestamptz라 범위 비교는 UTC ISO로 해야 한다.
function kstDateRangeIso(dateStr: string): { from: string; to: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const fromMs = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(fromMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

// 날짜 문자열을 day 단위로 더하기 — listKstDateStrings 내부 루프에서 사용.
function nextKstDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

// fromIso ~ toIso 사이의 KST 날짜 문자열 리스트 (양 끝 포함, 오름차순).
function listKstDateStrs(fromIso: string, toIso: string): string[] {
  const start = toKstDateStr(fromIso);
  const end = toKstDateStr(toIso);
  if (start > end) return [];
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = nextKstDate(cur);
  }
  return out;
}

// ── GET ───────────────────────────────────────────────────────────

export async function GET() {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const supabase = await createClient();

  // 1) 개원일 — 결석 집계의 시작점. 학원이 없으면 더 진행 불가.
  const { data: academy, error: academyErr } = await supabase
    .from('academies')
    .select('id, created_at')
    .eq('id', claims.academy_id)
    .maybeSingle();
  if (academyErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: academyErr.message },
      { status: 500 },
    );
  }
  if (!academy) {
    return NextResponse.json({ error: 'ACADEMY_NOT_FOUND' }, { status: 404 });
  }

  const todayIso = new Date().toISOString();
  const allDates = listKstDateStrs(academy.created_at, todayIso);

  // 2) 활성 학생 — created_at도 함께 가져와 "학생이 학원에 없던 날"은 결석 후보에서 제외.
  const { data: students, error: studentsErr } = await supabase
    .from('students')
    .select('id, name, created_at')
    .eq('academy_id', claims.academy_id)
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (studentsErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: studentsErr.message },
      { status: 500 },
    );
  }

  // 2b) 학생 ↔ 클래스 매핑 + 클래스 weekdays 조회.
  //     why: 결석 판정은 "학생이 속한 클래스의 수업 요일에 해당하는 날짜"만 분모로 본다.
  //          여러 반에 속한 학생은 weekdays 합집합을 사용 (어느 한 반이라도 수업 있는 날).
  //          클래스 미배정 학생은 합집합이 비어 있어 자연스럽게 결석 집계에서 제외된다.
  const studentIdsAll = (students ?? []).map((s) => s.id);
  const weekdayUnionByStudent = new Map<string, Set<number>>();
  if (studentIdsAll.length > 0) {
    const { data: links, error: linksErr } = await supabase
      .from('student_classes')
      .select('student_id, classes!inner(weekdays, academy_id)')
      .in('student_id', studentIdsAll);
    if (linksErr) {
      return NextResponse.json(
        { error: 'DB_ERROR', detail: linksErr.message },
        { status: 500 },
      );
    }
    type LinkRow = {
      student_id: string;
      classes:
        | { weekdays: number[] | null; academy_id: string }
        | { weekdays: number[] | null; academy_id: string }[]
        | null;
    };
    for (const raw of (links ?? []) as LinkRow[]) {
      const rel = Array.isArray(raw.classes) ? raw.classes[0] : raw.classes;
      if (!rel || rel.academy_id !== claims.academy_id) continue;
      const set = weekdayUnionByStudent.get(raw.student_id) ?? new Set<number>();
      for (const w of rel.weekdays ?? []) set.add(w);
      weekdayUnionByStudent.set(raw.student_id, set);
    }
  }

  // 날짜 문자열 → 요일(0~6) 변환을 미리 캐시. 같은 날짜를 학생 수만큼 다시 파싱하지 않도록.
  const weekdayByDate = new Map<string, number>();
  for (const d of allDates) {
    const [y, m, day] = d.split('-').map(Number);
    weekdayByDate.set(d, new Date(y, m - 1, day).getDay());
  }

  // 3) 개원 이후 등원 로그 전부.
  //    why: 학생/날짜별로 메모리에서 매칭해 "결석 = checkin 없음"을 판정한다.
  //         날짜 단위로 쿼리를 N번 돌리면 N×라운드트립이 되므로 1회 풀스캔이 더 싸다.
  const { data: checkins, error: checkinsErr } = await supabase
    .from('attendance_logs')
    .select('student_id, checked_at')
    .eq('academy_id', claims.academy_id)
    .eq('type', 'checkin')
    .gte('checked_at', academy.created_at);
  if (checkinsErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: checkinsErr.message },
      { status: 500 },
    );
  }

  // 4) 같은 기간의 'absent' 로그 — 화면에 메모와 row id를 같이 내려보내려고 함께 적재.
  //    created_at은 메모 작성일("작성일 YYYY.MM.DD") 표시에 사용.
  const { data: absents, error: absentsErr } = await supabase
    .from('attendance_logs')
    .select('id, student_id, checked_at, memo, created_at')
    .eq('academy_id', claims.academy_id)
    .eq('type', 'absent')
    .gte('checked_at', academy.created_at);
  if (absentsErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: absentsErr.message },
      { status: 500 },
    );
  }

  // 5) (student_id × KST 날짜) 키로 인덱싱.
  //    checkinSet은 존재 여부만 필요 → Set,
  //    absentMap은 메모/id가 필요 → Map.
  const checkinSet = new Set<string>(
    (checkins ?? []).map((c) => `${c.student_id}::${toKstDateStr(c.checked_at!)}`),
  );
  const absentMap = new Map<string, { id: string; memo: string | null; created_at: string }>();
  for (const a of absents ?? []) {
    const key = `${a.student_id}::${toKstDateStr(a.checked_at!)}`;
    // 같은 (학생, 날짜)에 absent row가 두 개면 가장 최근 것을 우선 — 정상 흐름에선 하나뿐.
    absentMap.set(key, { id: a.id, memo: a.memo, created_at: a.created_at });
  }

  // 6) 학생 × 날짜 조합 순회 → 결석 row 생성.
  //    학생.created_at(KST 날짜) 이전 날짜는 건너뛴다.
  //    클래스 미배정 학생(weekdays union이 비어있음)은 결석 정의가 없으므로 통째로 건너뛴다.
  //    학생이 속한 클래스의 weekdays 합집합에 포함되지 않는 요일도 결석 후보에서 제외.
  const result: AbsenceRow[] = [];
  for (const s of students ?? []) {
    const allowedWeekdays = weekdayUnionByStudent.get(s.id);
    if (!allowedWeekdays || allowedWeekdays.size === 0) continue;
    const studentJoinDate = toKstDateStr(s.created_at!);
    for (const date of allDates) {
      if (date < studentJoinDate) continue;
      const wd = weekdayByDate.get(date)!;
      if (!allowedWeekdays.has(wd)) continue;
      const key = `${s.id}::${date}`;
      if (checkinSet.has(key)) continue;
      const absentInfo = absentMap.get(key);
      result.push({
        student_id: s.id,
        student_name: s.name,
        date,
        absence_log_id: absentInfo?.id ?? null,
        memo: absentInfo?.memo ?? null,
        memo_created_at: absentInfo?.created_at ?? null,
      });
    }
  }

  // 7) 화면 요구: 날짜 내림차순(최신이 위), 동일 날짜 내에서는 학생 이름 오름차순.
  result.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.student_name.localeCompare(b.student_name, 'ko');
  });

  return NextResponse.json({ absences: result });
}

// ── POST ──────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const studentId = typeof body.student_id === 'string' ? body.student_id : '';
  const date = typeof body.date === 'string' ? body.date : '';
  // memo는 빈 문자열도 유효한 입력 (메모 지우기 의도) — null로만 정규화.
  const memo =
    typeof body.memo === 'string' ? body.memo : body.memo == null ? null : '';

  if (!studentId) {
    return NextResponse.json({ error: 'MISSING_STUDENT' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'INVALID_DATE' }, { status: 400 });
  }

  const supabase = await createClient();

  // 다른 학원 학생을 조작하지 못하도록 학생 ↔ 학원 일치 확인.
  // why: claims.academy_id 가드만으론 student_id를 임의 UUID로 보내면 통과될 수 있음.
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id')
    .eq('id', studentId)
    .eq('academy_id', claims.academy_id)
    .maybeSingle();
  if (studentErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: studentErr.message },
      { status: 500 },
    );
  }
  if (!student) {
    return NextResponse.json({ error: 'STUDENT_NOT_FOUND' }, { status: 404 });
  }

  const { from, to } = kstDateRangeIso(date);

  // 같은 (학생, 날짜)에 이미 absent row가 있는지 조회해 INSERT/UPDATE 분기.
  // limit(1) — 정상 흐름에선 하나뿐이고 존재 여부만 알면 된다.
  const { data: existing, error: existingErr } = await supabase
    .from('attendance_logs')
    .select('id')
    .eq('academy_id', claims.academy_id)
    .eq('student_id', studentId)
    .eq('type', 'absent')
    .gte('checked_at', from)
    .lt('checked_at', to)
    .limit(1);
  if (existingErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: existingErr.message },
      { status: 500 },
    );
  }

  if (existing && existing.length > 0) {
    // 기존 absent row의 메모를 갱신. created_at도 함께 mutate해 "작성일"이 최근 시점으로 갱신되게 한다.
    // why: 화면의 "작성일 YYYY.MM.DD"가 최근 수정 시점을 반영해야 하는데, 별도 updated_at 컬럼을
    //      추가하지 않기로 한 결정에 따라 created_at을 last-modified 의미로 재사용한다.
    const update: TablesUpdate<'attendance_logs'> = {
      memo: memo || null,
      created_at: new Date().toISOString(),
    };
    const { data: updated, error: updateErr } = await supabase
      .from('attendance_logs')
      .update(update)
      .eq('id', existing[0].id)
      .select('id, memo, created_at')
      .single();
    if (updateErr || !updated) {
      return NextResponse.json(
        {
          error: 'DB_ERROR',
          detail: updateErr?.message ?? 'absent update failed',
        },
        { status: 500 },
      );
    }
    return NextResponse.json({
      absence_log_id: updated.id,
      memo: updated.memo,
      memo_created_at: updated.created_at,
    });
  }

  // 새로 INSERT — checked_at은 해당 KST 날짜의 정오로 잡아 자정 경계 이슈를 회피.
  // why: 자정(00:00 KST)은 데이터를 읽을 때 isoStr 끝점 비교에서 헷갈리기 쉽고,
  //      정오는 어떤 timezone 변환을 거쳐도 같은 날짜로 안전하게 떨어진다.
  const [y, m, d] = date.split('-').map(Number);
  const checkedAtIso = new Date(
    Date.UTC(y, m - 1, d) - KST_OFFSET_MS + 12 * 60 * 60 * 1000,
  ).toISOString();

  const insert: TablesInsert<'attendance_logs'> = {
    student_id: studentId,
    academy_id: claims.academy_id,
    type: 'absent',
    checked_at: checkedAtIso,
    memo: memo || null,
  };
  const { data: inserted, error: insertErr } = await supabase
    .from('attendance_logs')
    .insert(insert)
    .select('id, memo, created_at')
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      {
        error: 'DB_ERROR',
        detail: insertErr?.message ?? 'absent insert failed',
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    absence_log_id: inserted.id,
    memo: inserted.memo,
    memo_created_at: inserted.created_at,
  });
}
