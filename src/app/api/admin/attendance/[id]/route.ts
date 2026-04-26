/**
 * /api/admin/attendance/[id] — 출석 로그 단건 보강 메모 갱신
 *
 * 가드: admin JWT 쿠키 + 대상 출석 로그가 같은 학원 소속인지 확인.
 *      WHERE id=$id AND academy_id=$claims.academy_id를 한 쿼리에 묶어
 *      다른 학원 로그 변조를 차단한다.
 *
 * PATCH: attendance_logs.memo 컬럼만 갱신. 빈 문자열은 null로 정규화해
 *        "메모 삭제" 동작과 동일하게 처리한다.
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';
import type { TablesUpdate } from '@/lib/types/database';

type MemoBody = { memo?: unknown };

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 });
  }

  let body: MemoBody;
  try {
    body = (await request.json()) as MemoBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  // memo 정규화 — 빈/공백 문자열은 null로 저장해 UI에서 "메모 없음" 상태로 보이게 한다.
  let memo: string | null;
  if (body.memo === null || body.memo === undefined) {
    memo = null;
  } else if (typeof body.memo === 'string') {
    const trimmed = body.memo.trim();
    memo = trimmed.length > 0 ? trimmed : null;
  } else {
    return NextResponse.json({ error: 'INVALID_MEMO' }, { status: 400 });
  }

  const supabase = await createClient();

  // 학원 소속 확인을 UPDATE WHERE 조건에 직접 포함 — 한 쿼리로 권한 검증 + 갱신.
  // why: select 후 update 두 단계로 나누면 race가 생길 수 있고, RLS 미설정 환경에서도
  //      academy_id를 함께 매칭해 다른 학원 로그를 잘못 건드리지 않도록 한다.
  const update: TablesUpdate<'attendance_logs'> = { memo };
  const { data, error } = await supabase
    .from('attendance_logs')
    .update(update)
    .eq('id', id)
    .eq('academy_id', claims.academy_id)
    .select('id, memo')
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    // 존재 자체를 숨기기 위해 다른 학원 / 미존재 둘 다 404로 통일.
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ id: data.id, memo: data.memo });
}
