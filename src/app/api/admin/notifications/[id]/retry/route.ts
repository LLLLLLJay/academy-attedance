/**
 * POST /api/admin/notifications/[id]/retry — 실패/재시도 멈춤 알림을 수동 재전송
 *
 * 가드: admin JWT 쿠키 검증 + 학원 격리 (notification_logs → attendance_logs.academy_id).
 *      다른 학원 알림 ID로 강제 재전송하는 시도를 차단한다.
 *
 * 동작:
 *   1. 대상 notification_logs 조회 (학원 격리 포함)
 *   2. 현재 status가 'failed' 또는 'retrying' 인지 확인 (sent/pending은 재전송 의미 없음)
 *   3. 행을 발송 가능한 상태로 reset:
 *        - status='pending'
 *        - attempt_count = MAX_ATTEMPT - 1 = 2
 *          why: /api/notify의 markFailureOrRetry는 newAttempt(prev+1)가 MAX_ATTEMPT(3)
 *               초과 시 즉시 'failed'로 떨어뜨린다. 수동 재전송 1회를 보장하려면
 *               prev=2로 두고 시도 후 실패 시 newAttempt=3 → 백오프 대신 바로 failed.
 *               (정책: 옵션 B — "이번 한 번 더 보낸다", 자동 재시도 슬롯 회복 안 함)
 *        - error_message=null, next_retry_at=null
 *          why: pg_cron이 향후 설치되어도 이 행은 픽업 대상에서 빠짐.
 *               운영자가 책임지고 1회 보낸 행이라는 의미를 명확히.
 *   4. /api/notify를 await 호출 — 사용자가 즉시 결과 토스트를 받을 수 있게 동기 처리.
 *   5. 결과 응답 (sent/retrying/failed 카운트 그대로 전달)
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClaims } from '@/lib/auth/admin';
import { rateLimit, getClientIp } from '@/lib/ratelimit';
import { CRON_SECRET_HEADER } from '@/lib/auth/cron';
import type { TablesUpdate } from '@/lib/types/database';

// /api/notify의 MAX_ATTEMPT(3)와 일치해야 함 — 한 곳에 두 군데 상수 분기를
// 막기 위해 명시적 주석을 남긴다. 향후 정책 변경 시 두 파일을 함께 수정.
const RETRY_RESET_ATTEMPT = 2;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const claims = await getAdminClaims();
  if (!claims) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Rate limit — 운영자가 의도적·실수로 같은 행을 연타해 솔라피 비용을 폭주시키는 케이스 차단.
  // IP당 10회/분이면 정상 운영자 수동 재전송엔 충분히 여유.
  const ip = getClientIp(_request);
  const { success } = await rateLimit.retryNotif.limit(ip);
  if (!success) {
    return NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 });
  }

  const supabase = await createClient();

  // ── 1. 대상 알림 조회 (학원 격리) ──────────────────────────────
  // attendance_logs!inner로 academy_id를 같이 가져와 다른 학원 알림 차단.
  const { data: notif, error: notifErr } = await supabase
    .from('notification_logs')
    .select(
      `
        id,
        status,
        attendance_id,
        attendance_logs!inner ( academy_id )
      `,
    )
    .eq('id', id)
    .single();

  if (notifErr || !notif) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // supabase-js의 inner join 결과는 단일 객체 또는 배열 모두로 추론될 수 있어 정규화.
  const attendance = Array.isArray(notif.attendance_logs)
    ? notif.attendance_logs[0]
    : notif.attendance_logs;

  if (!attendance || attendance.academy_id !== claims.academy_id) {
    // 학원 불일치 — 존재 자체를 숨기기 위해 404로 통일.
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // ── 2. 재전송 가능한 상태인지 검증 ─────────────────────────────
  if (notif.status !== 'failed' && notif.status !== 'retrying') {
    // sent: 이미 발송됨, pending: 1차 발송 진행 중 — 둘 다 수동 개입 부적절.
    return NextResponse.json(
      { error: 'NOT_RETRYABLE', currentStatus: notif.status },
      { status: 409 },
    );
  }

  // ── 3. reset → pending ────────────────────────────────────────
  const update: TablesUpdate<'notification_logs'> = {
    status: 'pending',
    attempt_count: RETRY_RESET_ATTEMPT,
    error_message: null,
    next_retry_at: null,
  };
  const { error: updateErr } = await supabase
    .from('notification_logs')
    .update(update)
    .eq('id', id);

  if (updateErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: updateErr.message },
      { status: 500 },
    );
  }

  // ── 4. /api/notify 호출 (await) ───────────────────────────────
  // /api/attendance와 동일하게 request.url을 베이스로 빌드 → 환경별 URL 분기 불필요.
  // why: 운영자에게 즉시 성공/실패 토스트를 보여주려면 응답을 기다려야 한다.
  let notifyBody: { sent?: number; retrying?: number; failed?: number; error?: string } = {};
  try {
    const notifyRes = await fetch(new URL('/api/notify', _request.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // /api/notify 익명 호출 차단으로 자체 호출도 공유 비밀이 필요.
        [CRON_SECRET_HEADER]: process.env.CRON_SECRET ?? '',
      },
      body: JSON.stringify({ attendance_id: notif.attendance_id }),
    });
    notifyBody = (await notifyRes.json()) as typeof notifyBody;

    if (!notifyRes.ok) {
      // /api/notify가 비-200을 돌려준 경우 — 환경변수 누락(500) 등.
      // 행은 이미 pending으로 reset됐으므로 cron이 깔리면 자동 재시도 가능.
      return NextResponse.json(
        {
          error: 'NOTIFY_FAILED',
          detail: notifyBody.error ?? `notify status ${notifyRes.status}`,
        },
        { status: 502 },
      );
    }
  } catch (err) {
    // 네트워크 자체 실패 — 매우 드문 케이스 (자체 호출이라 fetch 자체 실패 거의 없음).
    return NextResponse.json(
      {
        error: 'NOTIFY_DISPATCH_FAILED',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // ── 5. 결과 요약 응답 ────────────────────────────────────────
  // 클라이언트는 sent>0면 성공 토스트, failed>0면 실패 토스트로 분기.
  return NextResponse.json({
    success: true,
    sent: notifyBody.sent ?? 0,
    retrying: notifyBody.retrying ?? 0,
    failed: notifyBody.failed ?? 0,
  });
}
