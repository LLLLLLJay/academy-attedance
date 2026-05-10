/**
 * POST /api/auth — 관리자 비밀번호 검증 후 JWT 쿠키 발급
 *
 * 흐름:
 *   1. 본문에서 password 추출 + 형식 검증
 *   2. academies 테이블에서 학원 1건 조회 (단일 테넌트 가정)
 *   3. bcrypt.compare로 평문 비밀번호 ↔ admin_password_hash 비교
 *   4. 일치 → JWT 발급 후 httpOnly 쿠키에 저장 + { success: true } 반환
 *   5. 불일치 → 401
 *
 * 응답 status code:
 *   - 200: 로그인 성공
 *   - 400: 본문 검증 실패
 *   - 401: 비밀번호 불일치
 *   - 500: DB 오류 또는 학원 미등록
 */

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { createClient } from '@/lib/supabase/server';
import { ADMIN_COOKIE_NAME, signAdminToken } from '@/lib/auth/jwt';
import { rateLimit, getClientIp } from '@/lib/ratelimit';

// 쿠키 만료 — JWT의 7d와 맞춤. 둘이 어긋나면 쿠키만 살아있고 토큰은 만료된 어색한 상태가 생김.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type AuthRequest = {
  password?: unknown;
};

export async function POST(request: Request) {
  // ── 0. Rate limit ───────────────────────────────────────────
  // IP당 5회/분. brute-force 방지 — 정상 사용자는 1~2회면 끝남.
  const ip = getClientIp(request);
  const { success } = await rateLimit.authLogin.limit(ip);
  if (!success) {
    return NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 });
  }

  // ── 1. 본문 파싱 + 검증 ──────────────────────────────────────

  // request.json() 실패 시 throw → 400으로 매핑
  let body: AuthRequest;
  try {
    body = (await request.json()) as AuthRequest;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  // 외부 입력은 unknown으로 받고 타입 가드로 좁힌다 (any로 받으면 검증 누락 위험)
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return NextResponse.json({ error: 'MISSING_PASSWORD' }, { status: 400 });
  }

  const supabase = await createClient();

  // ── 2. 학원(=관리자 계정) 조회 ────────────────────────────────

  // 단일 테넌트 가정: 가장 먼저 만들어진 학원 1개를 관리자 계정으로 사용.
  // why: CLAUDE.md상 MVP는 학원 1개. 멀티 학원 도입 시 로그인 폼에 학원 식별자(코드/이름)를
  //      추가로 받아 .eq()로 좁혀야 함. 그때 이 블록을 갈아끼우면 됨.
  const { data: academy, error: academyErr } = await supabase
    .from('academies')
    .select('id, admin_password_hash')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (academyErr || !academy) {
    // 학원이 한 개도 없는 상태 — 시드 데이터 미투입 등 운영 환경 문제로 간주
    return NextResponse.json(
      { error: 'ACADEMY_NOT_FOUND' },
      { status: 500 },
    );
  }

  // ── 3. 비밀번호 비교 ────────────────────────────────────────

  // bcrypt.compare는 timing-safe 비교를 내부적으로 수행 → 직접 string 비교 금지.
  // why: ===로 비교하면 일치 여부에 따라 응답 시간이 달라져 timing 공격에 취약해짐.
  const ok = await bcrypt.compare(password, academy.admin_password_hash);
  if (!ok) {
    return NextResponse.json({ error: 'INVALID_PASSWORD' }, { status: 401 });
  }

  // ── 4. JWT 발급 + 쿠키 설정 ──────────────────────────────────

  // academy_id를 토큰에 박아 후속 admin API에서 학원 컨텍스트로 활용.
  const token = await signAdminToken({ academy_id: academy.id });

  const res = NextResponse.json({ success: true });

  // 쿠키 옵션:
  //   httpOnly  → JS에서 document.cookie로 못 읽음 (XSS 토큰 탈취 방어)
  //   secure    → HTTPS에서만 전송. dev(http://localhost)에선 비활성화돼야 동작
  //   sameSite  → 'lax'면 외부 사이트 → 우리 사이트 GET 네비게이션은 허용, POST는 차단 (CSRF 방어)
  //   path: '/' → /admin/* 와 /api/* 어디서든 쿠키 동봉
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return res;
}

/**
 * DELETE /api/auth — 관리자 로그아웃
 *
 * 동작: admin_token 쿠키를 즉시 만료시켜 브라우저가 다음 요청부터 보내지 않게 함.
 *
 * why maxAge=0:
 *   쿠키를 "삭제"하려면 같은 name/path/domain 조합으로 maxAge=0(또는 과거 expires)를
 *   다시 Set-Cookie해야 한다. 단순히 서버에서 못 본 척하는 것만으로는 브라우저에
 *   쿠키가 남아있어 새로고침 한 번이면 다시 인증된 상태로 돌아간다.
 *
 * why path/secure/sameSite를 set과 똑같이 맞추는가:
 *   브라우저는 (name, path, domain) 조합으로 쿠키를 식별한다. 만료용 Set-Cookie의
 *   path가 다르면 다른 쿠키로 인식되어 원본은 그대로 남는다 → 로그아웃 실패.
 */
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(ADMIN_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
