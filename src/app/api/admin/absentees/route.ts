/**
 * /api/admin/absentees — 당일 미등원 학생 조회
 *
 * 가드: admin JWT 쿠키 검증 후 academy_id를 claims에서 꺼내 사용한다.
 *      쿼리스트링으로 받은 academy_id는 신뢰하지 않음 — 다른 학원 데이터 노출 방지.
 *
 * GET: SCHEMA.md 핵심 쿼리 #3 — 활성 학생 중 당일(KST) checkin 기록이 없는 학생 목록.
 *      supabase-js는 서브쿼리를 직접 노출하지 않아 두 쿼리로 분리:
 *        1) 오늘 등원한 학생 ID 수집
 *        2) 활성 학생 중 1)의 ID에 포함되지 않은 학생만 조회
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';

// 응답 형태 — 대시보드 카드/목록이 곧바로 그릴 수 있는 최소 필드만.
type AbsenteeResponse = {
  id: string;
  name: string;
};

// 한국 시간(KST = UTC+9) 기준 "오늘 자정 ~ 내일 자정"의 UTC ISO 범위를 만든다.
// why: SCHEMA.md 쿼리는 `current_date`를 쓰지만 이는 DB 세션 timezone에 의존한다.
//      애플리케이션에서 KST 경계를 명시적으로 계산해 timezone 설정과 무관하게 동작.
function todayKstRangeIso(): { from: string; to: string } {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  // KST 기준 오늘 0시(자정)을 UTC ms로 환산
  const kstMidnightUtcMs = Date.UTC(
    nowKst.getUTCFullYear(),
    nowKst.getUTCMonth(),
    nowKst.getUTCDate(),
  ) - KST_OFFSET_MS;
  const from = new Date(kstMidnightUtcMs).toISOString();
  const to = new Date(kstMidnightUtcMs + 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

export async function GET() {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const supabase = await createClient();
  const { from, to } = todayKstRangeIso();

  // 1) 오늘 등원(checkin)한 학생 ID 수집.
  //    동일 학생이 여러 번 등원할 수 있으므로 Set으로 중복 제거.
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

  const checkedInIds = Array.from(
    new Set((checkins ?? []).map((c) => c.student_id)),
  );

  // 2) 활성 학생 중 1)에 없는 학생.
  //    체크인 학생이 0명이면 not.in 절을 붙이지 않아야 PostgREST가 빈 IN 절로 에러를 내지 않는다.
  let queryBuilder = supabase
    .from('students')
    .select('id, name')
    .eq('academy_id', claims.academy_id)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (checkedInIds.length > 0) {
    queryBuilder = queryBuilder.not(
      'id',
      'in',
      `(${checkedInIds.join(',')})`,
    );
  }

  const { data: absentees, error: absenteesErr } = await queryBuilder;

  if (absenteesErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: absenteesErr.message },
      { status: 500 },
    );
  }

  const result: AbsenteeResponse[] = (absentees ?? []).map((s) => ({
    id: s.id,
    name: s.name,
  }));

  return NextResponse.json({ absentees: result });
}
