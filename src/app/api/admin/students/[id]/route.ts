/**
 * /api/admin/students/[id] — 학생 단건 수정 / 소프트 삭제
 *
 * 가드: admin JWT 쿠키 + 대상 학생이 같은 학원 소속인지 확인.
 *      academy_id를 본문이 아니라 claims에서만 받아 다른 학원 학생 변조를 차단.
 *
 * PATCH:  학생 기본 정보(name/is_active) 갱신 + 학부모 목록 "전체 교체" 전략
 * DELETE: students.is_active = false (소프트 삭제 — 출석 기록 보존)
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';
import type { TablesInsert, TablesUpdate } from '@/lib/types/database';

type ParentInput = {
  name?: unknown;
  phone?: unknown;
  is_primary?: unknown;
};

type StudentPatchBody = {
  name?: unknown;
  is_active?: unknown;
  parents?: unknown;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * 학생 ID가 현재 admin의 학원에 속하는지 확인.
 * 통과 시 학생 row를, 실패 시 NextResponse(에러)를 반환.
 */
async function ensureOwned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  academyId: string,
) {
  const { data: existing, error } = await supabase
    .from('students')
    .select('id, academy_id')
    .eq('id', studentId)
    .maybeSingle();

  if (error) {
    return {
      response: NextResponse.json(
        { error: 'DB_ERROR', detail: error.message },
        { status: 500 },
      ),
    };
  }
  if (!existing) {
    return {
      response: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }),
    };
  }
  if (existing.academy_id !== academyId) {
    // 다른 학원 학생 — 존재 자체를 숨기기 위해 404로 통일.
    // why: 403으로 답하면 "그 ID의 학생은 존재한다"는 정보를 노출하게 됨.
    return {
      response: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }),
    };
  }
  return { existing };
}

// ── PATCH ───────────────────────────────────────────────────────────────────

export async function PATCH(request: Request, context: RouteContext) {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 });
  }

  let body: StudentPatchBody;
  try {
    body = (await request.json()) as StudentPatchBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const supabase = await createClient();

  const owned = await ensureOwned(supabase, id, claims.academy_id);
  if ('response' in owned) return owned.response;

  // ── 1. 학생 기본 정보 업데이트 (변경된 필드만) ─────────────────
  const studentUpdate: TablesUpdate<'students'> = {};
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'INVALID_NAME' }, { status: 400 });
    }
    studentUpdate.name = trimmed;
  }
  if (typeof body.is_active === 'boolean') {
    studentUpdate.is_active = body.is_active;
  }

  if (Object.keys(studentUpdate).length > 0) {
    const { error: updErr } = await supabase
      .from('students')
      .update(studentUpdate)
      .eq('id', id);
    if (updErr) {
      return NextResponse.json(
        { error: 'DB_ERROR', detail: updErr.message },
        { status: 500 },
      );
    }
  }

  // ── 2. 학부모 목록 교체 ───────────────────────────────────────
  // why: 부모는 추가/삭제/순서변경/대표 토글이 한 화면에서 동시 일어나 diff 계산이 복잡함.
  //      "전체 삭제 후 일괄 INSERT"가 단순하면서도 결과가 동일하다.
  //      외래키 ON DELETE CASCADE는 student → parent 방향이라 부모만 지워지는 건 안전.
  if (Array.isArray(body.parents)) {
    const parentsInput = body.parents as ParentInput[];
    if (parentsInput.length === 0) {
      return NextResponse.json({ error: 'MISSING_PARENTS' }, { status: 400 });
    }

    const cleaned: { name: string | null; phone: string; is_primary: boolean }[] = [];
    for (const raw of parentsInput) {
      const phone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
      if (!phone || phone.replace(/\D/g, '').length < 4) {
        return NextResponse.json(
          { error: 'INVALID_PARENT_PHONE' },
          { status: 400 },
        );
      }
      cleaned.push({
        name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null,
        phone,
        is_primary: Boolean(raw.is_primary),
      });
    }
    if (!cleaned.some((p) => p.is_primary)) {
      cleaned[0].is_primary = true;
    }

    const { error: delErr } = await supabase
      .from('student_parents')
      .delete()
      .eq('student_id', id);
    if (delErr) {
      return NextResponse.json(
        { error: 'DB_ERROR', detail: delErr.message },
        { status: 500 },
      );
    }

    const rows: TablesInsert<'student_parents'>[] = cleaned.map((p) => ({
      student_id: id,
      name: p.name,
      phone: p.phone,
      is_primary: p.is_primary,
    }));
    const { error: insErr } = await supabase
      .from('student_parents')
      .insert(rows);
    if (insErr) {
      return NextResponse.json(
        { error: 'DB_ERROR', detail: insErr.message },
        { status: 500 },
      );
    }
  }

  // ── 3. 갱신된 행을 다시 조회해 그대로 반환 ─────────────────────
  const { data: student, error: refetchErr } = await supabase
    .from('students')
    .select('id, academy_id, name, is_active, created_at')
    .eq('id', id)
    .single();
  if (refetchErr || !student) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: refetchErr?.message ?? 'refetch failed' },
      { status: 500 },
    );
  }

  const { data: parents, error: parentsErr } = await supabase
    .from('student_parents')
    .select('id, name, phone, phone_last4, is_primary')
    .eq('student_id', id);
  if (parentsErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: parentsErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    student: {
      ...student,
      parents: (parents ?? []).sort((a, b) =>
        a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1,
      ),
    },
  });
}

// ── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(_request: Request, context: RouteContext) {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 });
  }

  const supabase = await createClient();

  const owned = await ensureOwned(supabase, id, claims.academy_id);
  if ('response' in owned) return owned.response;

  // 소프트 삭제 — 출석 기록(attendance_logs)은 그대로 유지하고 학생만 비활성화.
  // why: SCHEMA.md ADR — 퇴원 학생의 출석 이력 보존을 위해 hard delete 금지.
  const update: TablesUpdate<'students'> = { is_active: false };
  const { error } = await supabase
    .from('students')
    .update(update)
    .eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
