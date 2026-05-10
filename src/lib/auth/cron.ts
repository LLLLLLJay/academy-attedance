/**
 * 서버↔서버 / cron→서버 호출용 공유 비밀 검증.
 *
 * /api/notify는 (1) /api/attendance가 fire-and-forget으로 호출, (2) 향후 pg_cron이
 * next_retry_at 도래한 행을 재시도 호출 — 두 경로 모두 사용자 세션이 없는 자동 호출이다.
 *
 * WHY 공유 비밀 (vs JWT):
 *   호출 주체가 사람이 아니라 cron/내부 서버 → 사용자 세션 개념 자체가 없다.
 *   JWT를 쓰려면 cron이 토큰 갱신을 챙겨야 하는데 운영 복잡도만 늘 뿐 보안 이득이 없음.
 *   고정 비밀 + 헤더 1개로 충분.
 *
 * WHY length-equal early exit:
 *   strict equality(===)는 JS 엔진 최적화에 따라 미세하게 길이 차이를 먼저 본다.
 *   일관된 길이의 secret을 강제해 timing 분석 표면을 줄인다 (32바이트 hex 권장).
 */

export const CRON_SECRET_HEADER = 'x-cron-secret';

export function isValidCronSecret(req: Request): boolean {
  const provided = req.headers.get(CRON_SECRET_HEADER);
  const expected = process.env.CRON_SECRET;
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  return provided === expected;
}
