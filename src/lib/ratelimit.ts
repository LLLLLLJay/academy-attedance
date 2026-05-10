/**
 * Upstash 기반 rate limit — 외부 호출이 비용·DoS·brute-force로 이어질 수 있는 라우트만 보호.
 *
 * 정책 (학원 1곳 기준 — Upstash 무료 티어 10K req/day로 충분):
 *   authLogin       — IP당 5/min   (admin/tablet 로그인 brute-force 방어)
 *   attendanceIp    — IP당 30/min  (학원 NAT 환경 고려해 후하게)
 *   attendanceToken — 토큰당 60/min (디바이스/세션 단위. 정상 키오스크는 충분히 여유)
 *   retryNotif      — IP당 10/min  (수동 재전송 — 솔라피 비용 폭주 방어)
 *
 * WHY 슬라이딩 윈도우:
 *   고정 윈도우는 경계 근처에서 한도의 2배까지 통과 가능. 슬라이딩이 더 균일.
 *
 * WHY /api/notify에는 적용 안 함:
 *   백오프 1/5/15분 패턴으로 고의적 호출 빈도가 정해져 있어 제한 의미가 없고,
 *   cron secret 검증이 더 강한 게이트 역할을 한다.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Redis.fromEnv()는 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN을 자동으로 읽음.
// 누락 시 첫 .limit() 호출에서 throw → 라우트가 500을 던지므로 운영자가 즉시 인지.
const redis = Redis.fromEnv();

export const rateLimit = {
  authLogin: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 m'),
    prefix: 'rl:auth',
  }),
  attendanceIp: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:att:ip',
  }),
  attendanceToken: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    prefix: 'rl:att:tok',
  }),
  retryNotif: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix: 'rl:retry',
  }),
};

/**
 * Vercel/일반 환경에서 클라이언트 IP 추출.
 *
 * x-forwarded-for: 프록시 체인을 거치며 누적되므로 첫 번째 값이 진짜 클라이언트 IP.
 * x-real-ip: 일부 리버스 프록시(nginx 등)가 채워주는 단일 IP 헤더.
 * 둘 다 없으면 'unknown'으로 통일 — 한 버킷에 몰아 보수적으로 차단.
 *
 * WHY 'unknown' 한 버킷:
 *   같은 'unknown' IP로 여러 클라이언트가 묶이면 정상 사용자가 차단될 수 있지만,
 *   Vercel 환경에서는 x-forwarded-for가 항상 채워지므로 실제로 발생할 가능성 낮음.
 *   헤더 위조(IP 우회) 시도를 막는 편이 우선.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}
