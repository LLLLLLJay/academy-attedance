/**
 * /api/admin/dashboard — 관리자 대시보드 요약 카운트 + 최근 활동
 *
 * 가드: admin JWT 쿠키 검증 후 academy_id를 claims에서 꺼내 사용한다.
 *      쿼리스트링으로 받은 academy_id는 신뢰하지 않음 — 다른 학원 데이터 노출 방지.
 *
 * GET: 대시보드 카드(등원/하원/총원) + 하단 "최근 체크인/아웃" 리스트가 요구하는
 *      4종 데이터를 한 번에 묶어 반환한다.
 *      why: 카드/리스트별로 endpoint를 쪼개면 라운드트립이 늘고, 각자 로딩 상태 관리도
 *           복잡해진다. 모두 동일 academy_id 가드만 필요하므로 한 라우트에 합쳤다.
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';
import type { AttendanceType } from '@/lib/types/database';

// 클라이언트 응답 형태 — 대시보드 컴포넌트가 곧바로 그릴 수 있는 평탄화 구조.
type RecentLogResponse = {
  id: string;
  student_id: string;
  student_name: string;
  type: AttendanceType;
  checked_at: string;
};

type DashboardResponse = {
  // 활동 학생 전체 수 — 학생 관리 페이지 지표 등에서 참고용으로 유지.
  total_active_students: number;
  // 오늘(KST 요일) 수업이 있는 활성 학생 수 — 등원/미등원 카드의 분모로 사용.
  // 클래스 미배정 학생은 분모에서 제외 (결석 정의가 없음).
  today_expected_count: number;
  today_checkin_count: number;
  today_checkout_count: number;
  recent: RecentLogResponse[];
};

// supabase-js의 inner join 결과는 단일 객체 또는 배열로 추론될 수 있어 둘 다 허용.
type JoinedRow = {
  id: string;
  student_id: string;
  type: AttendanceType;
  checked_at: string;
  students: { name: string } | { name: string }[] | null;
};

// 한국 시간(KST = UTC+9) 기준 "오늘 자정 ~ 내일 자정" UTC ISO 범위 + 오늘 KST 요일.
// why: SCHEMA.md 쿼리는 current_date에 의존 — DB 세션 timezone과 무관하게 동작하도록
//      애플리케이션에서 명시적으로 KST 경계를 계산한다. (absentees/route.ts와 동일 방식)
//      weekday는 "오늘 수업이 있는 클래스 → 학생" 합집합 계산에 사용한다.
function todayKst(): { from: string; to: string; weekday: number } {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  const kstMidnightUtcMs = Date.UTC(
    nowKst.getUTCFullYear(),
    nowKst.getUTCMonth(),
    nowKst.getUTCDate(),
  ) - KST_OFFSET_MS;
  return {
    from: new Date(kstMidnightUtcMs).toISOString(),
    to: new Date(kstMidnightUtcMs + 24 * 60 * 60 * 1000).toISOString(),
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

  // 5개 쿼리를 병렬 실행 — 서로 의존성이 없어 순차 대기 시간이 합산되는 것을 회피.
  // count: 'exact', head: true — row 본문은 가져오지 않고 카운트만 받아 페이로드 절감.
  // expectedRes: 오늘 weekday에 수업이 있는 클래스에 속한 활성 학생 ID 목록 (중복 제거 후 카운트).
  //   why: array-contains 필터를 students/students_classes에 직접 못 거니까 클래스 → 조인 → dedup 흐름.
  const [activeRes, checkinRes, checkoutRes, recentRes, todayClassRes] = await Promise.all([
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('academy_id', claims.academy_id)
      .eq('is_active', true),
    supabase
      .from('attendance_logs')
      .select('id', { count: 'exact', head: true })
      .eq('academy_id', claims.academy_id)
      .eq('type', 'checkin')
      .gte('checked_at', from)
      .lt('checked_at', to),
    supabase
      .from('attendance_logs')
      .select('id', { count: 'exact', head: true })
      .eq('academy_id', claims.academy_id)
      .eq('type', 'checkout')
      .gte('checked_at', from)
      .lt('checked_at', to),
    // 최근 활동은 오늘이 아닌 "최신 10건"으로 조회 — 대시보드의 "실시간 업데이트" 영역.
    // students!inner: 학생이 정합성상 누락된 고아 로그는 응답에서 제외.
    // type 필터(checkin/checkout만): 결석 관리에서 저장한 'absent' row가 같은 테이블에
    // 누적되므로, 대시보드 카드와 일관되게 등원/하원만 노출한다.
    supabase
      .from('attendance_logs')
      .select('id, student_id, type, checked_at, students!inner(name)')
      .eq('academy_id', claims.academy_id)
      .in('type', ['checkin', 'checkout'])
      .order('checked_at', { ascending: false })
      .limit(10),
    // 오늘 weekday에 수업하는 클래스 — array contains 연산자로 PostgREST 필터링.
    supabase
      .from('classes')
      .select('id')
      .eq('academy_id', claims.academy_id)
      .filter('weekdays', 'cs', `{${weekday}}`),
  ]);

  const firstError =
    activeRes.error ?? checkinRes.error ?? checkoutRes.error ?? recentRes.error ?? todayClassRes.error;
  if (firstError) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: firstError.message },
      { status: 500 },
    );
  }

  // today_expected_count 계산 — 오늘 클래스 → student_classes → 활성 학생 dedup.
  // why: 휴일(어떤 클래스도 오늘 수업 없음)이면 0으로 떨어져야 분모가 안전하게 계산됨.
  let todayExpectedCount = 0;
  const todayClassIds = (todayClassRes.data ?? []).map((c) => c.id);
  if (todayClassIds.length > 0) {
    const { data: scheduledLinks, error: scheduledErr } = await supabase
      .from('student_classes')
      .select('student_id, students!inner(id, is_active, academy_id)')
      .in('class_id', todayClassIds);
    if (scheduledErr) {
      return NextResponse.json(
        { error: 'DB_ERROR', detail: scheduledErr.message },
        { status: 500 },
      );
    }
    type SchedRow = {
      student_id: string;
      students:
        | { id: string; is_active: boolean; academy_id: string }
        | { id: string; is_active: boolean; academy_id: string }[]
        | null;
    };
    const expectedIds = new Set<string>();
    for (const raw of (scheduledLinks ?? []) as SchedRow[]) {
      const rel = Array.isArray(raw.students) ? raw.students[0] : raw.students;
      if (!rel || !rel.is_active) continue;
      if (rel.academy_id !== claims.academy_id) continue;
      expectedIds.add(rel.id);
    }
    todayExpectedCount = expectedIds.size;
  }

  const recent: RecentLogResponse[] = ((recentRes.data ?? []) as JoinedRow[]).map(
    (row) => {
      const studentRel = Array.isArray(row.students) ? row.students[0] : row.students;
      return {
        id: row.id,
        student_id: row.student_id,
        student_name: studentRel?.name ?? '',
        type: row.type,
        checked_at: row.checked_at,
      };
    },
  );

  const body: DashboardResponse = {
    total_active_students: activeRes.count ?? 0,
    today_expected_count: todayExpectedCount,
    today_checkin_count: checkinRes.count ?? 0,
    today_checkout_count: checkoutRes.count ?? 0,
    recent,
  };

  return NextResponse.json(body);
}
