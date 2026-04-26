/**
 * 관리자 JWT 발급/검증 유틸 — middleware(Edge)와 /api/auth(Node) 양쪽에서 공유.
 *
 * why jose:
 *   middleware는 Edge Runtime에서 실행되는데 jsonwebtoken은 Node 전용 모듈을
 *   사용해 Edge에서 import 자체가 실패한다. jose는 Web Crypto API 기반이라
 *   Edge·Node 모두에서 동작하므로 같은 모듈을 양쪽에서 재사용할 수 있다.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

// 쿠키 이름 — middleware/page/api 어디서든 같은 상수를 import 해야 일관성 유지
export const ADMIN_COOKIE_NAME = 'admin_token';

// 토큰 유효기간 (jose가 받는 표현식). 너무 짧으면 자주 재로그인, 너무 길면 탈취 위험.
const TOKEN_EXPIRY = '7d';

// JWT_SECRET을 Uint8Array로 변환해 jose에 넘긴다.
// why: 함수 호출 시점에 평가해야 .env.local 로딩 후 값이 잡힘 (모듈 최상단에서 읽으면 build-time에 빈 값이 박힐 수 있음).
function getKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET env var is missing');
  }
  return new TextEncoder().encode(secret);
}

// JWT 페이로드 형태 — 멀티 학원 확장 대비해 academy_id를 담는다.
export type AdminClaims = JWTPayload & {
  academy_id: string;
};

/**
 * 관리자 토큰 발급.
 * HS256으로 서명 — 단일 서버 환경이라 비대칭 키(RS256)까지는 불필요.
 */
export async function signAdminToken(claims: {
  academy_id: string;
}): Promise<string> {
  return new SignJWT({ academy_id: claims.academy_id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(getKey());
}

/**
 * 관리자 토큰 검증.
 * 위변조/만료/잘못된 알고리즘 등 모든 실패는 null로 통일 — 호출부 분기 단순화.
 *
 * why algorithms 명시:
 *   알고리즘을 지정하지 않으면 'none' 알고리즘 우회 공격 위험 → 항상 화이트리스트로 고정.
 */
export async function verifyAdminToken(
  token: string,
): Promise<AdminClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      algorithms: ['HS256'],
    });
    // payload.academy_id가 문자열이 아니면 위조된 토큰으로 간주
    if (typeof payload.academy_id !== 'string') {
      return null;
    }
    return payload as AdminClaims;
  } catch {
    return null;
  }
}
