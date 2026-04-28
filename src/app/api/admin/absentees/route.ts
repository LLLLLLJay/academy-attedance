/**
 * /api/admin/absentees — 당일 미등원 학생 조회
 *
 * 가드: admin JWT 쿠키 검증 후 academy_id를 claims에서 꺼내 사용한다.
 *      쿼리스트링으로 받은 academy_id는 신뢰하지 않음 — 다른 학원 데이터 노출 방지.
 *
 * GET: "오늘(KST 요일) 수업이 있는 활성 학생" 중 checkin 기록이 없는 학생 목록.
 *      클래스 미배정 학생은 결석 정의가 없으므로 자동 제외 (분모에서 빠짐).
 *
 *      흐름:
 *        1) 오늘 KST 요일에 수업하는 클래스 ID 수집
 *        2) 그 클래스에 속한 활성 학생 ID 수집 (학생-클래스 합집합)
 *        3) 오늘 등원한 학생 ID 수집
 *        4) (2 \ 3) 학생만 결석 후보로 반환
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';

// 응답 형태 — 대시보드 카드/목록이 곧바로 그릴 수 있는 최소 필드만.
type AbsenteeResponse = {
  id: string;
  name: string;
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 한국 시간(KST = UTC+9) 기준 "오늘 자정 ~ 내일 자정"의 UTC ISO 범위 + 오늘 요일을 함께 반환.
// why: SCHEMA.md 쿼리는 `current_date`를 쓰지만 이는 DB 세션 timezone에 의존한다.
//      애플리케이션에서 KST 경계를 명시적으로 계산해 timezone 설정과 무관하게 동작.
function todayKst(): { from: string; to: string; weekday: number } {
  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  const kstMidnightUtcMs =
    Date.UTC(
      nowKst.getUTCFullYear(),
      nowKst.getUTCMonth(),
      nowKst.getUTCDate(),
    ) - KST_OFFSET_MS;
  return {
    from: new Date(kstMidnightUtcMs).toISOString(),
    to: new Date(kstMidnightUtcMs + 24 * 60 * 60 * 1000).toISOString(),
    // getUTCDay()를 KST 시계에 적용 — 0=일~6=토.
    weekday: nowKst.getUTCDay(),
  };
}

export async function GET() {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const supabase = await createClient();
  const { from, to, weekday } = todayKst();

  // 1) 오늘 요일에 수업하는 클래스 — weekdays 배열에 오늘 weekday가 포함되는지 확인.
  //    PostgREST의 'cs.{n}' 필터로 array contains 검사가 가능하다.
  const { data: todayClasses, error: classesErr } = await supabase
    .from('classes')
    .select('id')
    .eq('academy_id', claims.academy_id)
    .filter('weekdays', 'cs', `{${weekday}}`);

  if (classesErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: classesErr.message },
      { status: 500 },
    );
  }

  // 오늘 수업하는 클래스가 한 개도 없으면 → 결석 후보 자체가 없음.
  // why: 학원 휴일/주말에 절대 결석이 잡히지 않도록 조기 종료.
  const todayClassIds = (todayClasses ?? []).map((c) => c.id);
  if (todayClassIds.length === 0) {
    return NextResponse.json({ absentees: [] satisfies AbsenteeResponse[] });
  }

  // 2) 그 클래스에 속한 활성 학생 ID — student_classes inner join으로 한 번에.
  const { data: scheduledLinks, error: scheduledErr } = await supabase
    .from('student_classes')
    .select('student_id, students!inner(id, name, is_active, academy_id)')
    .in('class_id', todayClassIds);

  if (scheduledErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: scheduledErr.message },
      { status: 500 },
    );
  }

  type LinkRow = {
    student_id: string;
    students:
      | { id: string; name: string; is_active: boolean; academy_id: string }
      | { id: string; name: string; is_active: boolean; academy_id: string }[]
      | null;
  };

  // 학생 한 명이 오늘 수업하는 반 여러 개에 속하면 중복으로 잡힐 수 있어 Map으로 dedup.
  const scheduledById = new Map<string, { id: string; name: string }>();
  for (const raw of (scheduledLinks ?? []) as LinkRow[]) {
    const rel = Array.isArray(raw.students) ? raw.students[0] : raw.students;
    if (!rel) continue;
    if (!rel.is_active) continue;
    if (rel.academy_id !== claims.academy_id) continue;
    scheduledById.set(rel.id, { id: rel.id, name: rel.name });
  }

  if (scheduledById.size === 0) {
    return NextResponse.json({ absentees: [] satisfies AbsenteeResponse[] });
  }

  // 3) 오늘 등원(checkin)한 학생 ID 수집 — Set으로 dedup.
  const { data: checkins, error: checkinsErr } = await supabase
    .from('attendance_logs')
    .select('student_id')
    .eq('academy_id', claims.academy_id)
    .eq('type', 'checkin')
    .gte('checked_at', from)
    .lt('checked_at', to);

  if (checkinsErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: checkinsErr.message },
      { status: 500 },
    );
  }

  const checkedInIds = new Set((checkins ?? []).map((c) => c.student_id));

  // 4) (오늘 수업 학생) − (오늘 등원 학생) = 미등원.
  //    이름 한국어 정렬로 응답 안정성 확보.
  const result: AbsenteeResponse[] = Array.from(scheduledById.values())
    .filter((s) => !checkedInIds.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  return NextResponse.json({ absentees: result });
}
