import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types/database';

/**
 * 서버 사이드 Supabase 클라이언트 — service_role 키 사용.
 *
 * WHY service_role:
 *   앱이 Supabase Auth를 안 쓰고 자체 jose JWT 쿠키로 인증한다. anon 키로는
 *   RLS를 통과시킬 사용자 컨텍스트가 없어 0 row만 반환된다. 서버는 자체 JWT로
 *   academy_id를 검증한 뒤 service_role로 DB 접근 → 신뢰 경계는 Next.js 서버.
 *
 * WHY @supabase/supabase-js (not @supabase/ssr):
 *   ssr 패키지는 Supabase Auth 세션 동기화용. service_role은 세션 무관이라
 *   순수 클라이언트 헬퍼로 충분.
 *
 * 보안 주의:
 *   service_role은 RLS를 우회한다. 절대 'use client' 컴포넌트에서 import 금지.
 *   본 모듈을 import하는 곳은 모두 서버 코드(라우트/서버 컴포넌트)여야 한다.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase env (URL/SERVICE_ROLE_KEY) is missing');
  }
  return createSupabaseClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
