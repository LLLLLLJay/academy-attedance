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
// parent_name / parent_phone: 이 출석에 대해 알림이 보내진 학부모 1명의 정보.
//   notification_logs를 거쳐 추출(아래 select 참고). is_primary 학부모를 우선,
//   없으면 가장 먼저 발송 시도된 학부모. 정보 없으면 null로 떨어진다.
type RecentLogResponse = {
  id: string;
  student_id: string;
  student_name: string;
  type: AttendanceType;
  checked_at: string;
  parent_name: string | null;
  parent_phone: string | null;
};

type DashboardResponse = {
  // 관리자 사이드바/모바일 헤더에 표시할 학원명 — claims.academy_id로 academies.name 조회.
  // why: 별도 endpoint를 두지 않고 대시보드 응답에 묶어 라운드트립 절감.
  //      AdminPage가 마운트 시 한 번 호출하므로 사이드바 학원명도 같은 fetch로 채운다.
  academy_name: string;
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
// notification_logs는 N개(학부모 수만큼)일 수 있어 항상 배열 형태로 받는다.
type ParentRel = {
  name: string | null;
  phone: string;
  is_primary: boolean | null;
};
type NotifRow = {
  created_at: string;
  student_parents: ParentRel | ParentRel[] | null;
};
type JoinedRow = {
  id: string;
  student_id: string;
  type: AttendanceType;
  checked_at: string;
  students: { name: string } | { name: string }[] | null;
  notification_logs: NotifRow[] | null;
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

  // 6개 쿼리를 병렬 실행 — 서로 의존성이 없어 순차 대기 시간이 합산되는 것을 회피.
  // count: 'exact', head: true — row 본문은 가져오지 않고 카운트만 받아 페이로드 절감.
  // expectedRes: 오늘 weekday에 수업이 있는 클래스에 속한 활성 학생 ID 목록 (중복 제거 후 카운트).
  //   why: array-contains 필터를 students/students_classes에 직접 못 거니까 클래스 → 조인 → dedup 흐름.
  // academyRes: 사이드바/모바일 헤더에 표시할 학원명 — claims로 격리된 단일 row 조회.
  const [academyRes, activeRes, checkinRes, checkoutRes, recentRes, todayClassRes] = await Promise.all([
    supabase
      .from('academies')
      .select('name')
      .eq('id', claims.academy_id)
      .maybeSingle(),
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
    // notification_logs를 함께 가져와 "이 출석에 대해 알림이 간 학부모"의 이름·전화를 노출.
    // student_parents:parent_id(...) — notification_logs.parent_id FK를 명시적으로 지정.
    // 학부모 정보가 누락된 케이스(insert 실패 등)는 빈 배열로 떨어져 응답에서 null로 처리.
    supabase
      .from('attendance_logs')
      .select(
        `id, student_id, type, checked_at,
         students!inner(name),
         notification_logs(created_at, student_parents:parent_id(name, phone, is_primary))`,
      )
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
    academyRes.error ?? activeRes.error ?? checkinRes.error ?? checkoutRes.error ?? recentRes.error ?? todayClassRes.error;
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

      // 알림이 간 학부모 1명 선택 — is_primary 우선, 없으면 가장 먼저 발송된 학부모.
      // why: 한 출석에 학부모 N명이 모두 알림을 받지만 UI는 1명만 표시 → 대표를 일관되게 고른다.
      const notifs = (row.notification_logs ?? [])
        .slice()
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const pickParent = (n: NotifRow): ParentRel | null => {
        const sp = Array.isArray(n.student_parents) ? n.student_parents[0] : n.student_parents;
        return sp ?? null;
      };
      let chosen: ParentRel | null = null;
      for (const n of notifs) {
        const sp = pickParent(n);
        if (sp?.is_primary) { chosen = sp; break; }
      }
      if (!chosen && notifs.length > 0) chosen = pickParent(notifs[0]);

      return {
        id: row.id,
        student_id: row.student_id,
        student_name: studentRel?.name ?? '',
        type: row.type,
        checked_at: row.checked_at,
        parent_name: chosen?.name ?? null,
        parent_phone: chosen?.phone ?? null,
      };
    },
  );

  const body: DashboardResponse = {
    // claims로 academy_id 격리하므로 academyRes.data는 항상 본인 학원.
    // 만약 academies row가 사라진 비정상 케이스면 빈 문자열로 두어 UI가 placeholder를 띄우게 한다.
    academy_name: academyRes.data?.name ?? '',
    total_active_students: activeRes.count ?? 0,
    today_expected_count: todayExpectedCount,
    today_checkin_count: checkinRes.count ?? 0,
    today_checkout_count: checkoutRes.count ?? 0,
    recent,
  };

  return NextResponse.json(body);
}
