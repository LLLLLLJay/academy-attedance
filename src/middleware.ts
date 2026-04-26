/**
 * Next.js Middleware — /admin/* 경로 보호
 *
 * 동작:
 *   1. 요청이 /admin/* 경로면 admin_token 쿠키 확인
 *   2. 토큰 없거나 검증 실패 → /admin/login으로 리다이렉트
 *   3. 검증 성공 → 그대로 다음으로 통과
 *
 * 위치 주의: src/ 디렉토리를 쓰는 프로젝트에서는 middleware도 src/middleware.ts에
 *           있어야 Next.js가 인식한다 (루트에 두면 무시됨).
 *
 * Edge Runtime 주의: 미들웨어는 Edge에서 실행되므로 Node 전용 모듈(예: jsonwebtoken)을
 *                    import하면 안 됨. jose는 Edge·Node 호환이라 안전.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { ADMIN_COOKIE_NAME, verifyAdminToken } from '@/lib/auth/jwt';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 로그인 페이지 자체는 미인증 상태에서도 접근 가능해야 함.
  // why: 이 가드를 안 두면 미로그인 → /admin/login → (또 가드) → /admin/login 무한 루프.
  if (pathname.startsWith('/admin/login')) {
    return NextResponse.next();
  }

  // 쿠키에서 JWT 추출
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) {
    return redirectToLogin(req);
  }

  // 서명/만료/페이로드 형태 검증. 실패는 모두 null로 통일됨.
  const claims = await verifyAdminToken(token);
  if (!claims) {
    return redirectToLogin(req);
  }

  // 인증 통과 → 그대로 핸들러로 위임
  return NextResponse.next();
}

/**
 * /admin/login으로 리다이렉트.
 * 쿼리스트링은 비워서 보내 — 추후 returnTo 같은 값을 넘길 거면 여기서 set.
 */
function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = '/admin/login';
  url.search = '';
  return NextResponse.redirect(url);
}

/**
 * matcher 정의:
 *   '/admin'            → /admin 자체 (트레일링 슬래시 없는 경우 매칭 위해 별도 추가)
 *   '/admin/:path*'     → /admin/ 와 그 모든 하위 경로
 *
 * why: '/admin/:path*' 하나만 두면 Next.js의 path-to-regexp 해석상 정확히 '/admin'은
 *      매칭되지 않을 수 있음 → 안전하게 두 패턴을 모두 등록.
 */
export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
