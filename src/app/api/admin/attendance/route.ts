/**
 * /api/admin/attendance — 관리자 출석 기록 조회
 *
 * 가드: admin JWT 쿠키 검증 후 academy_id를 claims에서 꺼내 사용한다.
 *      쿼리스트링으로 받은 academy_id는 신뢰하지 않음 — 다른 학원 데이터 노출 방지.
 *
 * GET: attendance_logs를 students와 inner join 해서 학생 이름까지 한 번에 응답.
 *      날짜 범위(from/to) · 등원/하원 타입 · 특정 학생 ID로 필터링 가능.
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';
import type { AttendanceType } from '@/lib/types/database';

// 클라이언트 응답 형태 — UI 테이블이 곧바로 그릴 수 있도록 학생 이름을 평탄화해서 내려준다.
type AttendanceLogResponse = {
  id: string;
  student_id: string;
  student_name: string;
  type: AttendanceType;
  checked_at: string;
  memo: string | null;
};

// supabase-js의 inner join 결과는 관계 키가 단일 객체 또는 배열로 추론되어
// 어느 쪽이든 안전하게 학생 이름을 꺼낼 수 있게 둘 다 받는다.
type JoinedRow = {
  id: string;
  student_id: string;
  type: AttendanceType;
  checked_at: string;
  memo: string | null;
  students: { name: string } | { name: string }[] | null;
};

export async function GET(request: Request) {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const studentId = url.searchParams.get('student_id');
  const typeParam = url.searchParams.get('type');

  const supabase = await createClient();

  // students!inner — 학생 row가 없으면(=고아 출석 로그) 응답에서 제외한다.
  // why: 학생이 hard-delete된 적은 없지만 RLS/정합성 안전망 차원에서 inner를 걸어둠.
  let queryBuilder = supabase
    .from('attendance_logs')
    .select('id, student_id, type, checked_at, memo, students!inner(name)')
    .eq('academy_id', claims.academy_id)
    .order('checked_at', { ascending: false });

  if (from) queryBuilder = queryBuilder.gte('checked_at', from);
  if (to) queryBuilder = queryBuilder.lte('checked_at', to);
  if (studentId) queryBuilder = queryBuilder.eq('student_id', studentId);
  if (typeParam === 'checkin' || typeParam === 'checkout') {
    queryBuilder = queryBuilder.eq('type', typeParam);
  } else {
    // 출석 기록 페이지는 등원/하원만 다룬다 — 결석 관리에서 저장한 'absent' row는 제외.
    // why: 동일 attendance_logs 테이블에 type='absent' row가 함께 누적되므로
    //      필터를 명시하지 않으면 출석 기록 표에 결석 행이 섞여 들어온다.
    queryBuilder = queryBuilder.in('type', ['checkin', 'checkout']);
  }

  const { data, error } = await queryBuilder;

  if (error) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: error.message },
      { status: 500 },
    );
  }

  const logs: AttendanceLogResponse[] = ((data ?? []) as JoinedRow[]).map((row) => {
    const studentRel = Array.isArray(row.students) ? row.students[0] : row.students;
    return {
      id: row.id,
      student_id: row.student_id,
      student_name: studentRel?.name ?? '',
      type: row.type,
      checked_at: row.checked_at,
      memo: row.memo,
    };
  });

  return NextResponse.json({ logs });
}
