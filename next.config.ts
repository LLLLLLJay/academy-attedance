import type { NextConfig } from "next";

/**
 * 전역 보안 헤더 — 모든 응답에 부착.
 *
 * 항목별 의도:
 *   Strict-Transport-Security  HTTPS 강제 + 서브도메인 포함 + preload 등록 후보화
 *   X-Content-Type-Options      MIME sniffing 차단 (서버가 보낸 Content-Type 강제)
 *   X-Frame-Options             iframe 임베드 차단 (clickjacking 방어)
 *   Referrer-Policy             cross-origin엔 origin만 노출 (URL path/query 누설 방지)
 *   Permissions-Policy          카메라/마이크/위치 권한 자동 거부 (불필요한 권한 표면 제거)
 *
 * CSP는 미적용 — Next/Tailwind가 inline-style을 광범위하게 쓰는데 'unsafe-inline'을
 * 풀면 보호 효과가 약해진다. 후속 PR에서 nonce 기반으로 따로 도입.
 */
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
