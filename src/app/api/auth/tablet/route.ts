/**
 * POST /api/auth/tablet — 태블릿(키오스크) 비밀번호 검증 후 JWT 쿠키 발급
 * DELETE                — 태블릿 로그아웃 (쿠키 만료)
 *
 * /api/auth(admin)와 거의 동일한 구조지만 분리한 이유:
 *   - academies.tablet_password_hash라는 별도 컬럼을 비교 (admin과 분리된 비밀번호)
 *   - 발급되는 토큰의 role='tablet' 으로 권한 분리
 *   - 쿠키도 별도(TABLET_COOKIE_NAME)라 admin 쿠키와 충돌하지 않음
 *
 * 응답 status code:
 *   - 200: 로그인 성공
 *   - 400: 본문 검증 실패
 *   - 401: 비밀번호 불일치
 *   - 429: rate limit 초과
 *   - 500: DB 오류 또는 tablet_password_hash 미설정
 */

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { createClient } from '@/lib/supabase/server';
import { TABLET_COOKIE_NAME, signToken } from '@/lib/auth/jwt';
import { rateLimit, getClientIp } from '@/lib/ratelimit';

// 쿠키 만료 — JWT의 24h와 맞춤. 어긋나면 쿠키만 살아있고 토큰 만료된 어색한 상태가 생김.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

type AuthRequest = {
  password?: unknown;
};

export async function POST(request: Request) {
  // ── 0. Rate limit ───────────────────────────────────────────
  const ip = getClientIp(request);
  const { success } = await rateLimit.authLogin.limit(ip);
  if (!success) {
    return NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 });
  }

  // ── 1. 본문 파싱 + 검증 ──────────────────────────────────────
  let body: AuthRequest;
  try {
    body = (await request.json()) as AuthRequest;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return NextResponse.json({ error: 'MISSING_PASSWORD' }, { status: 400 });
  }

  // ── 2. 학원 + tablet_password_hash 조회 ──────────────────────
  // 단일 테넌트 가정: 가장 먼저 만들어진 학원 1개를 사용 (admin 라우트와 동일).
  const supabase = await createClient();
  const { data: academy, error } = await supabase
    .from('academies')
    .select('id, tablet_password_hash')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !academy || !academy.tablet_password_hash) {
    // 컬럼 자체가 비어 있는 경우 — 운영자가 시딩(update academies set tablet_password_hash=...)을 안 한 상태.
    // why: 사용자에겐 정확한 원인을 노출해 운영자가 빠르게 인지하도록 (보안 정보 아님).
    return NextResponse.json(
      { error: 'TABLET_PASSWORD_NOT_SET' },
      { status: 500 },
    );
  }

  // ── 3. 비밀번호 비교 (timing-safe) ───────────────────────────
  const ok = await bcrypt.compare(password, academy.tablet_password_hash);
  if (!ok) {
    return NextResponse.json({ error: 'INVALID_PASSWORD' }, { status: 401 });
  }

  // ── 4. JWT 발급 + 쿠키 설정 ──────────────────────────────────
  const token = await signToken({ academy_id: academy.id, role: 'tablet' });

  const res = NextResponse.json({ success: true });
  res.cookies.set(TABLET_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}

/**
 * DELETE /api/auth/tablet — 태블릿 로그아웃
 * 동일 옵션의 빈 쿠키(maxAge=0)로 덮어 브라우저에서 즉시 삭제.
 */
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(TABLET_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
