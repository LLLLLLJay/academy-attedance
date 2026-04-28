/**
 * /api/admin/classes/[id] — 클래스 단건 수정 / 삭제
 *
 * 가드: admin JWT 쿠키 + 대상 클래스가 같은 학원 소속인지 확인.
 *      academy_id는 본문이 아니라 claims에서만 받아 다른 학원 클래스 변조를 차단.
 *
 * PATCH:  클래스 기본 정보(name/weekdays) 갱신 + 학생 배정 "전체 교체" 전략
 * DELETE: 클래스 hard delete (student_classes는 ON DELETE CASCADE로 자동 정리)
 *         WHY: 클래스는 출석 기록과 직접 FK가 없어 hard delete가 안전 — 결석 판정은
 *              "현재 시점의 학생 클래스 소속" 기준이므로 과거 데이터에 영향 없음.
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';
import type { TablesInsert, TablesUpdate, Weekday } from '@/lib/types/database';

type ClassPatchBody = {
  name?: unknown;
  weekdays?: unknown;
  student_ids?: unknown;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

function sanitizeWeekdays(input: unknown): Weekday[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<number>();
  for (const v of input) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b) as Weekday[];
}

function sanitizeStudentIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const v of input) {
    if (typeof v === 'string' && v.length > 0) set.add(v);
  }
  return Array.from(set);
}

/**
 * 클래스 ID가 현재 admin의 학원에 속하는지 확인.
 * 통과 시 클래스 row를, 실패 시 NextResponse(에러)를 반환.
 */
async function ensureOwned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  academyId: string,
) {
  const { data: existing, error } = await supabase
    .from('classes')
    .select('id, academy_id')
    .eq('id', classId)
    .maybeSingle();

  if (error) {
    return {
      response: NextResponse.json(
        { error: 'DB_ERROR', detail: error.message },
        { status: 500 },
      ),
    };
  }
  if (!existing || existing.academy_id !== academyId) {
    // 다른 학원 클래스의 존재 여부를 숨기기 위해 둘 다 404로 통일.
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

  let body: ClassPatchBody;
  try {
    body = (await request.json()) as ClassPatchBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const supabase = await createClient();
  const owned = await ensureOwned(supabase, id, claims.academy_id);
  if ('response' in owned) return owned.response;

  // ── 1. 기본 정보 업데이트 (변경된 필드만) ─────────────────────
  const update: TablesUpdate<'classes'> = {};
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'INVALID_NAME' }, { status: 400 });
    }
    update.name = trimmed;
  }
  if (body.weekdays !== undefined) {
    update.weekdays = sanitizeWeekdays(body.weekdays);
  }

  if (Object.keys(update).length > 0) {
    const { error: updErr } = await supabase
      .from('classes')
      .update(update)
      .eq('id', id);
    if (updErr) {
      return NextResponse.json(
        { error: 'DB_ERROR', detail: updErr.message },
        { status: 500 },
      );
    }
  }

  // ── 2. 학생 배정 교체 ─────────────────────────────────────────
  // why: 학생 배정은 추가/제거가 한 화면에서 동시에 일어나 diff 계산이 복잡함.
  //      "전체 삭제 후 일괄 INSERT"가 단순하면서도 결과가 동일하다.
  if (body.student_ids !== undefined) {
    const requested = sanitizeStudentIds(body.student_ids);

    // 같은 학원 + 활성 학생만 화이트리스트로 좁힘.
    let allowedIds = new Set<string>();
    if (requested.length > 0) {
      const { data: validStudents, error: validErr } = await supabase
        .from('students')
        .select('id')
        .in('id', requested)
        .eq('academy_id', claims.academy_id)
        .eq('is_active', true);
      if (validErr) {
        return NextResponse.json(
          { error: 'DB_ERROR', detail: validErr.message },
          { status: 500 },
        );
      }
      allowedIds = new Set((validStudents ?? []).map((s) => s.id));
    }

    const { error: delErr } = await supabase
      .from('student_classes')
      .delete()
      .eq('class_id', id);
    if (delErr) {
      return NextResponse.json(
        { error: 'DB_ERROR', detail: delErr.message },
        { status: 500 },
      );
    }

    const rows: TablesInsert<'student_classes'>[] = requested
      .filter((sid) => allowedIds.has(sid))
      .map((student_id) => ({ student_id, class_id: id }));

    if (rows.length > 0) {
      const { error: insErr } = await supabase
        .from('student_classes')
        .insert(rows);
      if (insErr) {
        return NextResponse.json(
          { error: 'DB_ERROR', detail: insErr.message },
          { status: 500 },
        );
      }
    }
  }

  // ── 3. 갱신된 행을 다시 조회해 그대로 반환 ─────────────────────
  const { data: refreshed, error: refetchErr } = await supabase
    .from('classes')
    .select('id, academy_id, name, weekdays, created_at')
    .eq('id', id)
    .single();
  if (refetchErr || !refreshed) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: refetchErr?.message ?? 'refetch failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    class: {
      ...refreshed,
      weekdays: (refreshed.weekdays ?? []) as Weekday[],
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

  // student_classes는 ON DELETE CASCADE → 자동 정리.
  const { error } = await supabase.from('classes').delete().eq('id', id);
  if (error) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
