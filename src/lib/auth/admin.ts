/**
 * 관리자 API 라우트 공용 인증 헬퍼.
 *
 * /admin/* 페이지 라우트는 middleware.ts가 JWT 쿠키를 검증해 가드하지만,
 * /api/admin/* 라우트 핸들러는 미들웨어 매처에 포함돼 있지 않아 별도로 검증해야 한다.
 * 매 핸들러마다 쿠키 → verifyToken 코드를 반복하지 않도록 한 군데로 모은다.
 */

import { cookies } from 'next/headers';

import {
  ADMIN_COOKIE_NAME,
  verifyToken,
  type AuthClaims,
} from '@/lib/auth/jwt';

/**
 * 요청 쿠키에서 admin JWT를 추출해 검증된 claims를 돌려준다.
 * 쿠키 없음/위조/만료/role 불일치 등 모든 실패는 null로 통일 — 호출부 분기 단순화.
 *
 * why role==='admin' 명시 검증:
 *   verifyToken은 admin/tablet 양쪽을 통과시키므로, admin 헬퍼에서 한 번 더 좁혀
 *   tablet 토큰이 admin 컨텍스트로 새는 사고를 방지.
 */
export async function getAdminClaims(): Promise<AuthClaims | null> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return null;
  const claims = await verifyToken(token);
  return claims && claims.role === 'admin' ? claims : null;
}
