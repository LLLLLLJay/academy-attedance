/**
 * Next.js Middleware — /admin/* 와 /tablet/* 경로 보호
 *
 * /admin/*  → admin 토큰만 통과 (관리자 페이지)
 * /tablet/* → admin OR tablet 토큰 통과 (운영자도 디버깅용으로 진입 가능)
 *
 * 위치 주의: src/ 디렉토리를 쓰는 프로젝트에서는 middleware도 src/middleware.ts에
 *           있어야 Next.js가 인식한다 (루트에 두면 무시됨).
 *
 * Edge Runtime 주의: 미들웨어는 Edge에서 실행되므로 Node 전용 모듈(예: jsonwebtoken)을
 *                    import하면 안 됨. jose는 Edge·Node 호환이라 안전.
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  ADMIN_COOKIE_NAME,
  TABLET_COOKIE_NAME,
  verifyToken,
} from '@/lib/auth/jwt';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── /admin/* 가드 ─────────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    // 로그인 페이지 자체는 미인증 상태에서도 접근 가능해야 함.
    // why: 가드 안 두면 미로그인 → /admin/login → (또 가드) → 무한 루프.
    if (pathname.startsWith('/admin/login')) {
      return NextResponse.next();
    }

    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    if (!token) return redirect(req, '/admin/login');

    const claims = await verifyToken(token);
    if (!claims || claims.role !== 'admin') {
      return redirect(req, '/admin/login');
    }
    return NextResponse.next();
  }

  // ── /tablet/* 가드 ────────────────────────────────────────────
  if (pathname.startsWith('/tablet')) {
    // tablet 로그인 화면은 무조건 통과
    if (pathname.startsWith('/tablet/login')) {
      return NextResponse.next();
    }

    // admin이 디버깅·테스트 목적으로 tablet 화면을 열어보는 케이스도 허용.
    // 둘 다 없거나 둘 다 만료/위조면 tablet 로그인으로 보낸다.
    const adminToken = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    if (adminToken) {
      const c = await verifyToken(adminToken);
      if (c && c.role === 'admin') return NextResponse.next();
    }

    const tabletToken = req.cookies.get(TABLET_COOKIE_NAME)?.value;
    if (tabletToken) {
      const c = await verifyToken(tabletToken);
      if (c && c.role === 'tablet') return NextResponse.next();
    }

    return redirect(req, '/tablet/login');
  }

  return NextResponse.next();
}

/**
 * 로그인 페이지로 리다이렉트.
 * 쿼리스트링은 비워서 보내 — 추후 returnTo 같은 값을 넘길 거면 여기서 set.
 */
function redirect(req: NextRequest, path: string) {
  const url = req.nextUrl.clone();
  url.pathname = path;
  url.search = '';
  return NextResponse.redirect(url);
}

/**
 * matcher 정의:
 *   '/admin', '/admin/:path*'   → 관리자 페이지 전체
 *   '/tablet', '/tablet/:path*' → 키오스크 페이지 전체
 *
 * why: '/admin/:path*' 하나만 두면 path-to-regexp 해석상 정확히 '/admin'(트레일링 슬래시 없음)이
 *      매칭되지 않을 수 있음 → 안전하게 두 패턴을 모두 등록.
 *
 * 매처 밖: /api/* 라우트는 미들웨어를 안 거치므로 핸들러 안에서 직접 인증/검증한다
 *         (lib/auth/admin.ts, lib/auth/tablet.ts, lib/auth/cron.ts 헬퍼 사용).
 */
export const config = {
  matcher: ['/admin', '/admin/:path*', '/tablet', '/tablet/:path*'],
};
