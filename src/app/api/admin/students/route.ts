/**
 * /api/admin/students — 관리자 학생 관리 (목록/등록)
 *
 * 가드: 모든 핸들러는 admin JWT 쿠키 검증 후 academy_id를 claims에서 꺼내 사용한다.
 *      쿼리스트링/본문으로 받은 academy_id는 절대 신뢰하지 않음 (다른 학원 데이터 노출 방지).
 *
 * GET:  현재 학원의 활동(is_active=true) 학생 + 학부모 일괄 조회
 * POST: 학생 1명 + 학부모 N명을 트랜잭션처럼 등록 (학생 INSERT 실패 시 학부모도 만들지 않음)
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';
import type { TablesInsert } from '@/lib/types/database';

// 클라이언트 응답에서 사용할 학생/학부모 형태.
// DB 컬럼 그대로지만 phone_last4(generated)도 포함해 UI 검색에 바로 쓸 수 있게 한다.
type ParentResponse = {
  id: string;
  name: string | null;
  phone: string;
  phone_last4: string;
  is_primary: boolean;
};

type StudentResponse = {
  id: string;
  academy_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  parents: ParentResponse[];
};

// POST 본문 형태 — 외부 입력은 unknown으로 받아 런타임 검증.
type ParentInput = {
  name?: unknown;
  phone?: unknown;
  is_primary?: unknown;
};

type StudentCreateBody = {
  name?: unknown;
  parents?: unknown;
};

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const supabase = await createClient();

  // 1) 활성 학생만 가져온다 (사용자 요구: is_active = true).
  //    퇴원 처리된 학생은 출석 기록 보존용으로 DB엔 남지만 관리 화면엔 노출하지 않는다.
  const { data: students, error: studentsErr } = await supabase
    .from('students')
    .select('id, academy_id, name, is_active, created_at')
    .eq('academy_id', claims.academy_id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (studentsErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: studentsErr.message },
      { status: 500 },
    );
  }

  if (!students || students.length === 0) {
    return NextResponse.json({ students: [] satisfies StudentResponse[] });
  }

  // 2) 학생 ID 목록으로 학부모를 한 번에 조회 (N+1 방지).
  //    supabase-js의 관계 select(`students(*, student_parents(*))`)도 가능하지만
  //    /api/attendance와 동일하게 두 쿼리로 분리해 타입을 단순화 + 일관성 유지.
  const studentIds = students.map((s) => s.id);
  const { data: parents, error: parentsErr } = await supabase
    .from('student_parents')
    .select('id, student_id, name, phone, phone_last4, is_primary')
    .in('student_id', studentIds);

  if (parentsErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: parentsErr.message },
      { status: 500 },
    );
  }

  // student_id별 학부모 묶음을 만들어 학생 row에 합친다.
  const parentsByStudent = new Map<string, ParentResponse[]>();
  for (const p of parents ?? []) {
    const list = parentsByStudent.get(p.student_id) ?? [];
    list.push({
      id: p.id,
      name: p.name,
      phone: p.phone,
      phone_last4: p.phone_last4,
      is_primary: p.is_primary,
    });
    parentsByStudent.set(p.student_id, list);
  }

  // 대표 연락처가 항상 첫 번째로 보이도록 정렬 — UI에서 primary를 우선 표시하기 편함.
  const result: StudentResponse[] = students.map((s) => ({
    id: s.id,
    academy_id: s.academy_id,
    name: s.name,
    is_active: s.is_active,
    created_at: s.created_at,
    parents: (parentsByStudent.get(s.id) ?? []).sort((a, b) =>
      a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1,
    ),
  }));

  return NextResponse.json({ students: result });
}

// ── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: StudentCreateBody;
  try {
    body = (await request.json()) as StudentCreateBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'MISSING_NAME' }, { status: 400 });
  }

  const parentsInput = Array.isArray(body.parents) ? body.parents : [];
  if (parentsInput.length === 0) {
    return NextResponse.json({ error: 'MISSING_PARENTS' }, { status: 400 });
  }

  // 학부모 입력 검증 — phone은 숫자 4자리 이상이어야 phone_last4 generated column이 의미를 가짐.
  const cleanedParents: { name: string | null; phone: string; is_primary: boolean }[] = [];
  for (const raw of parentsInput) {
    const p = raw as ParentInput;
    const phone = typeof p.phone === 'string' ? p.phone.trim() : '';
    if (!phone || phone.replace(/\D/g, '').length < 4) {
      return NextResponse.json({ error: 'INVALID_PARENT_PHONE' }, { status: 400 });
    }
    cleanedParents.push({
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : null,
      phone,
      is_primary: Boolean(p.is_primary),
    });
  }

  // 대표 연락처가 없으면 첫 번째를 자동으로 대표로 — UI에서 누락된 경우 방어.
  if (!cleanedParents.some((p) => p.is_primary)) {
    cleanedParents[0].is_primary = true;
  }

  const supabase = await createClient();

  // 학생 INSERT 먼저 — id를 받아야 학부모 행을 만들 수 있음.
  const studentInsert: TablesInsert<'students'> = {
    academy_id: claims.academy_id,
    name,
    is_active: true,
  };
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .insert(studentInsert)
    .select('id, academy_id, name, is_active, created_at')
    .single();

  if (studentErr || !student) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: studentErr?.message ?? 'student insert failed' },
      { status: 500 },
    );
  }

  // 학부모 INSERT (배치). 실패 시 방금 만든 학생 row를 롤백해 고아 데이터를 남기지 않는다.
  // why: Supabase JS는 트랜잭션을 직접 노출하지 않아 에러 시 수동 보상 (compensating delete).
  const parentRows: TablesInsert<'student_parents'>[] = cleanedParents.map((p) => ({
    student_id: student.id,
    name: p.name,
    phone: p.phone,
    is_primary: p.is_primary,
  }));

  const { data: insertedParents, error: parentsErr } = await supabase
    .from('student_parents')
    .insert(parentRows)
    .select('id, name, phone, phone_last4, is_primary');

  if (parentsErr || !insertedParents) {
    await supabase.from('students').delete().eq('id', student.id);
    return NextResponse.json(
      { error: 'DB_ERROR', detail: parentsErr?.message ?? 'parents insert failed' },
      { status: 500 },
    );
  }

  const created: StudentResponse = {
    id: student.id,
    academy_id: student.academy_id,
    name: student.name,
    is_active: student.is_active,
    created_at: student.created_at,
    parents: insertedParents.sort((a, b) =>
      a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1,
    ),
  };

  return NextResponse.json({ student: created }, { status: 201 });
}
