/**
 * JWT 발급/검증 유틸 — admin과 tablet 두 역할을 같은 모듈에서 다룬다.
 *
 * why jose:
 *   middleware는 Edge Runtime에서 실행되는데 jsonwebtoken은 Node 전용 모듈을
 *   사용해 Edge에서 import 자체가 실패한다. jose는 Web Crypto API 기반이라
 *   Edge·Node 모두에서 동작하므로 같은 모듈을 양쪽에서 재사용할 수 있다.
 *
 * why role 필드 + 쿠키 분리:
 *   admin은 관리자 페이지(높은 권한), tablet은 키오스크 출석 호출(낮은 권한)으로
 *   노출 면적이 다르다. 하나의 토큰을 공유하면 tablet 토큰 분실 시 관리자 권한도 함께
 *   털리므로 쿠키와 토큰 만료 시간을 분리한다.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

// 쿠키 이름 — middleware/page/api 어디서든 같은 상수를 import 해야 일관성 유지
export const ADMIN_COOKIE_NAME = 'admin_token';
export const TABLET_COOKIE_NAME = 'tablet_token';

// 토큰 유효기간:
//   admin  7일 — 운영자가 자주 재로그인하지 않도록 길게.
//   tablet 24시간 — 학원 내 공용 기기라 매일 1회 재인증을 강제 (분실/도난 시 노출 면적 제한).
const ADMIN_TOKEN_EXPIRY = '7d';
const TABLET_TOKEN_EXPIRY = '24h';

export type Role = 'admin' | 'tablet';

// 모든 토큰의 공통 페이로드 형태. role로 admin/tablet을 구분.
export type AuthClaims = JWTPayload & {
  academy_id: string;
  role: Role;
};

// 하위 호환용 별칭 — 기존 코드(`AdminClaims`)가 import해도 깨지지 않도록 유지.
export type AdminClaims = AuthClaims;

// JWT_SECRET을 Uint8Array로 변환해 jose에 넘긴다.
// why: 함수 호출 시점에 평가해야 .env.local 로딩 후 값이 잡힘 (모듈 최상단에서 읽으면 build-time에 빈 값이 박힐 수 있음).
function getKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET env var is missing');
  }
  return new TextEncoder().encode(secret);
}

/**
 * 역할 기반 토큰 발급 — role에 따라 만료 시간을 자동으로 결정.
 * HS256으로 서명 — 단일 서버 환경이라 비대칭 키(RS256)까지는 불필요.
 */
export async function signToken(claims: {
  academy_id: string;
  role: Role;
}): Promise<string> {
  const exp = claims.role === 'admin' ? ADMIN_TOKEN_EXPIRY : TABLET_TOKEN_EXPIRY;
  return new SignJWT({ academy_id: claims.academy_id, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(getKey());
}

/**
 * 토큰 검증 — 위변조/만료/role 누락 등 모든 실패는 null로 통일.
 *
 * why algorithms 명시:
 *   알고리즘을 지정하지 않으면 'none' 알고리즘 우회 공격 위험 → 항상 화이트리스트로 고정.
 *
 * why role 검증:
 *   기존(role 없는) 토큰을 그대로 통과시키면 PR 1 이전에 발급된 admin 토큰이
 *   role 검증 없이 admin 권한을 유지한다. role을 강제해 강제 재로그인을 유도.
 */
export async function verifyToken(token: string): Promise<AuthClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      algorithms: ['HS256'],
    });
    if (typeof payload.academy_id !== 'string') return null;
    if (payload.role !== 'admin' && payload.role !== 'tablet') return null;
    return payload as AuthClaims;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 하위 호환 별칭 — 기존 호출부(signAdminToken/verifyAdminToken) 유지
// ─────────────────────────────────────────────────────────────

/**
 * 관리자 토큰 발급 — signToken({ role: 'admin' }) 짧은 별칭.
 * 기존 코드 호환을 위해 유지.
 */
export async function signAdminToken(claims: {
  academy_id: string;
}): Promise<string> {
  return signToken({ academy_id: claims.academy_id, role: 'admin' });
}

/**
 * 관리자 전용 검증 — role==='admin'까지 강제.
 * tablet 토큰을 admin 헬퍼로 통과시키는 사고를 막는다.
 */
export async function verifyAdminToken(
  token: string,
): Promise<AuthClaims | null> {
  const claims = await verifyToken(token);
  return claims && claims.role === 'admin' ? claims : null;
}
