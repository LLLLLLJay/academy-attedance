/**
 * 태블릿 API 인증 헬퍼 — admin 또는 tablet 토큰 어느 쪽이든 통과.
 *
 * /api/attendance는 키오스크가 호출하는 게 정상이지만, 운영자가 디버깅·테스트
 * 목적으로 admin 세션에서 직접 호출할 수 있어야 한다. 두 쿠키를 모두 인정한다.
 *
 * 우선순위 admin > tablet:
 *   같은 브라우저에 둘 다 켜져 있는 케이스(운영자가 본인 PC에서 양쪽을 동시에
 *   열어둔 경우)에 더 권한 높은 쪽을 잡는다. 어느 쪽이 잡혀도 academy_id는 같다.
 */

import { cookies } from 'next/headers';

import {
  ADMIN_COOKIE_NAME,
  TABLET_COOKIE_NAME,
  verifyToken,
  type AuthClaims,
} from '@/lib/auth/jwt';

/**
 * admin 쿠키 → tablet 쿠키 순으로 검증해 첫 통과 claims를 반환.
 * 둘 다 없거나 둘 다 만료/위조면 null.
 */
export async function getTabletOrAdminClaims(): Promise<AuthClaims | null> {
  const store = await cookies();

  const adminToken = store.get(ADMIN_COOKIE_NAME)?.value;
  if (adminToken) {
    const c = await verifyToken(adminToken);
    if (c && c.role === 'admin') return c;
  }

  const tabletToken = store.get(TABLET_COOKIE_NAME)?.value;
  if (tabletToken) {
    const c = await verifyToken(tabletToken);
    if (c && c.role === 'tablet') return c;
  }

  return null;
}
