/**
 * POST /api/notify — 출석 기록에 묶인 학부모에게 카카오 알림톡 발송
 *
 * 호출 시점:
 *   - /api/attendance가 성공 직후 fire-and-forget으로 호출 (1차 발송)
 *   - pg_cron 워커가 next_retry_at 도래한 retrying 행을 찾아 호출 (재시도)
 *
 * 전체 흐름:
 *   0. 본문(attendance_id) 파싱 + solapi 환경변수 검증
 *   1. attendance_logs / students / academies 조회 (메시지 변수 재료)
 *   2. 발송 대기 중인 notification_logs(pending|retrying) 조회
 *   3. 학부모 phone을 한 번에 가져와 매핑
 *   4. 각 행마다 솔라피 호출 → 결과에 따라 status/attempt_count/next_retry_at 갱신
 *   5. 성공/재시도/실패 카운트 요약 반환
 *
 * 재시도 백오프 (사용자 스펙):
 *   attempt_count 1 → +1분, 2 → +5분, 3 → +15분, 3 초과 → status='failed'
 *
 * 응답 status code:
 *   - 200: 처리 완료(부분 실패 포함, 본문에 카운트 동봉)
 *   - 400: 본문 검증 실패
 *   - 404: attendance_id가 가리키는 출석/학생/학원 못 찾음
 *   - 500: 환경변수 누락 또는 DB 오류
 */

import { NextResponse } from 'next/server';
import { createHmac, randomBytes } from 'node:crypto';

import { createClient } from '@/lib/supabase/server';
import type { TablesUpdate } from '@/lib/types/database';

// 솔라피 단건 발송 엔드포인트 (REST v4)
const SOLAPI_SEND_URL = 'https://api.solapi.com/messages/v4/send';

// 재시도 backoff 분 단위 — 인덱스가 새 attempt_count - 1
// CLAUDE.md "알림톡 재시도" 규칙: 1분 → 5분 → 15분
const RETRY_BACKOFF_MIN = [1, 5, 15] as const;

// 최대 시도 횟수 — 이 값을 초과하면 status='failed' 처리
const MAX_ATTEMPT = 3;

type NotifyRequest = {
  attendance_id?: unknown;
};

// supabase 클라이언트 타입을 별도로 import하지 않기 위한 트릭
// why: createClient는 ssr 패키지가 SupabaseClient<Database>를 감싸 반환 →
//      그 타입을 직접 import하면 v2 내부 타입 노출이 많아져 유지보수 부담
type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export async function POST(request: Request) {
  // ── 0. 본문 파싱 + 환경변수 검증 ──────────────────────────────

  // request.json() 실패 시 throw → 400으로 매핑.
  // why: 본문이 비었거나 JSON이 아니면 attendance_id 검증 단계에서
  //      undefined.X 같은 모호한 에러가 나는 것을 방지.
  let body: NotifyRequest;
  try {
    body = (await request.json()) as NotifyRequest;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const attendance_id =
    typeof body.attendance_id === 'string' ? body.attendance_id : '';
  if (!attendance_id) {
    return NextResponse.json(
      { error: 'MISSING_ATTENDANCE_ID' },
      { status: 400 },
    );
  }

  // 솔라피 인증/발신 정보 — .env.local 참고
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const sender = process.env.SOLAPI_SENDER;
  // 카카오 비즈니스 채널 발신 프로필 ID (검수 통과 후 솔라피 콘솔에서 발급)
  const pfId = process.env.SOLAPI_PFID;
  // 등원/하원 템플릿 ID — ALIMTALK_TEMPLATE.md 1번/2번 (검수 통과 후 발급)
  const templateIdCheckin = process.env.SOLAPI_TEMPLATE_ID_CHECKIN;
  const templateIdCheckout = process.env.SOLAPI_TEMPLATE_ID_CHECKOUT;

  // 인증 키/발신번호가 없으면 솔라피 호출 자체가 불가능 → 즉시 500.
  if (!apiKey || !apiSecret || !sender) {
    return NextResponse.json({ error: 'SOLAPI_ENV_MISSING' }, { status: 500 });
  }
  // 템플릿/PFID는 카카오 검수 통과 후에 채워지므로 별도 코드로 구분.
  // why: 운영자가 어떤 환경변수를 추가해야 하는지 메시지로 식별 가능.
  if (!pfId || !templateIdCheckin || !templateIdCheckout) {
    return NextResponse.json(
      { error: 'SOLAPI_TEMPLATE_ENV_MISSING' },
      { status: 500 },
    );
  }

  const supabase = await createClient();

  // ── 1. 메시지 변수 재료 조회 (attendance / student / academy) ──

  // 출석 기록 자체를 먼저 가져온다. 여기에 student_id, academy_id, type, checked_at이 들어 있음.
  // why: attendance_logs에 학생/학원 이름이 함께 있으면 좋겠지만 정규화상 분리됨 →
  //      세 번 쿼리하는 편이 supabase-js 관계 select보다 타입이 깔끔.
  const { data: attendance, error: attErr } = await supabase
    .from('attendance_logs')
    .select('id, student_id, academy_id, type, checked_at')
    .eq('id', attendance_id)
    .single();

  if (attErr || !attendance) {
    return NextResponse.json(
      { error: 'ATTENDANCE_NOT_FOUND' },
      { status: 404 },
    );
  }

  // 학생 이름 — 알림톡 #{학생명} 변수로 사용
  const { data: student, error: stuErr } = await supabase
    .from('students')
    .select('name')
    .eq('id', attendance.student_id)
    .single();

  if (stuErr || !student) {
    return NextResponse.json({ error: 'STUDENT_NOT_FOUND' }, { status: 404 });
  }

  // 학원 이름 — 알림톡 #{학원명} 변수로 사용
  const { data: academy, error: acaErr } = await supabase
    .from('academies')
    .select('name')
    .eq('id', attendance.academy_id)
    .single();

  if (acaErr || !academy) {
    return NextResponse.json({ error: 'ACADEMY_NOT_FOUND' }, { status: 404 });
  }

  // ── 2. 발송 대기 중인 notification_logs 조회 ──────────────────

  // pending(아직 한 번도 안 보낸 상태) + retrying(실패 후 재시도 대기) 모두 처리.
  // why: 이 라우트는 1차 발송과 cron 재시도 양쪽에서 호출되므로 두 상태를 모두 다뤄야 함.
  //      sent/failed는 종결 상태라 제외.
  const { data: pendingNotifs, error: notifErr } = await supabase
    .from('notification_logs')
    .select('id, parent_id, attempt_count')
    .eq('attendance_id', attendance_id)
    .in('status', ['pending', 'retrying']);

  if (notifErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: notifErr.message },
      { status: 500 },
    );
  }
  // 처리할 게 없으면 빠르게 종료 — 이미 다 발송됐거나 다 실패한 케이스.
  if (!pendingNotifs || pendingNotifs.length === 0) {
    return NextResponse.json({
      success: true,
      sent: 0,
      retrying: 0,
      failed: 0,
      message: 'no pending notifications',
    });
  }

  // ── 3. 학부모 phone을 한 번에 조회 ───────────────────────────

  // notification_logs에 parent_id만 들어있어 phone을 따로 조회해야 함.
  // why: 부모 1명당 쿼리하면 N+1 문제 → in()으로 일괄 조회 후 Map으로 인덱싱.
  const parentIds = pendingNotifs.map((n) => n.parent_id);
  const { data: parents, error: pErr } = await supabase
    .from('student_parents')
    .select('id, phone')
    .in('id', parentIds);

  if (pErr) {
    return NextResponse.json(
      { error: 'DB_ERROR', detail: pErr.message },
      { status: 500 },
    );
  }

  // parent_id → phone 룩업용 Map (O(1) 접근)
  const parentPhoneById = new Map((parents ?? []).map((p) => [p.id, p.phone]));

  // ── 4. 각 notification 발송 (병렬) ───────────────────────────

  // 알림톡 변수 빌드 — 모든 행이 동일한 variables를 공유 (수신자만 다름).
  // why: 한 출석 = 한 학생 = 한 학원 = 한 시각이므로 학생/학원/시각은 모두 같음.
  const timeStr = formatKoreanTime(attendance.checked_at);
  const templateId =
    attendance.type === 'checkin' ? templateIdCheckin : templateIdCheckout;
  // 솔라피 REST API는 키를 #{변수명} 형태 그대로 받음 (템플릿 본문과 매칭).
  const variables: Record<string, string> = {
    '#{학원명}': academy.name,
    '#{학생명}': student.name,
    '#{시각}': timeStr,
  };

  // SMS 폴백용 본문 — 알림톡 실패 시 솔라피가 이 텍스트로 SMS 발송.
  // why: text 필드를 비우면 솔라피 콘솔 기본 폴백 정책에 끌려가 빈 SMS가 나갈 수 있음.
  //      ALIMTALK_TEMPLATE.md의 알림톡 본문과 동일한 문구로 맞춰 학부모 혼선 방지.
  const actionLabel = attendance.type === 'checkin' ? '등원' : '하원';
  const fallbackText = `[${academy.name}] ${student.name} 학생이 ${timeStr}에 ${actionLabel}했습니다.`;

  // Promise.allSettled로 병렬 발송 — 한 학부모 실패가 다른 학부모 발송을 막지 않도록.
  const results = await Promise.allSettled(
    pendingNotifs.map(async (notif) => {
      const phone = parentPhoneById.get(notif.parent_id);

      // 학부모 행이 사라졌거나 phone이 비었으면 재시도해도 의미 없음 → 즉시 failed.
      if (!phone) {
        await markFailed(
          supabase,
          notif.id,
          notif.attempt_count,
          'parent phone not found',
        );
        return { id: notif.id, outcome: 'failed' as const };
      }

      try {
        await sendAlimtalk({
          apiKey,
          apiSecret,
          sender,
          pfId,
          templateId,
          variables,
          text: fallbackText,
          to: normalizePhone(phone),
        });
        await markSent(supabase, notif.id);
        return { id: notif.id, outcome: 'sent' as const };
      } catch (err) {
        // 솔라피 호출 실패 → backoff 또는 failed 결정
        const reason = err instanceof Error ? err.message : String(err);
        const outcome = await markFailureOrRetry(
          supabase,
          notif.id,
          notif.attempt_count,
          reason,
        );
        return { id: notif.id, outcome };
      }
    }),
  );

  // 결과 집계 — 운영 모니터링/디버깅용
  const summary = { sent: 0, retrying: 0, failed: 0 };
  for (const r of results) {
    if (r.status === 'fulfilled') {
      summary[r.value.outcome] += 1;
    } else {
      // Promise 자체가 reject된 경우 (markX 실패 등) — 보수적으로 failed로 카운트
      summary.failed += 1;
      console.error('[notify] settled reject:', r.reason);
    }
  }

  // ── 5. 요약 응답 ────────────────────────────────────────────

  // 부분 실패 포함 모두 200 — 클라이언트(주로 cron)는 카운트로 상태 파악.
  return NextResponse.json({ success: true, ...summary });
}

// ─────────────────────────────────────────────────────────────
// 헬퍼: 시각 포맷
// ─────────────────────────────────────────────────────────────

/**
 * UTC ISO 문자열 → 한국식 "오전 H:MM" / "오후 H:MM" 형식.
 *
 * why: ALIMTALK_TEMPLATE.md 예시("오후 3:05")와 정확히 일치시키기 위해
 *      Intl.DateTimeFormat의 format() 결과(환경별로 "오후 3시 05분" 등 변종)
 *      대신 formatToParts()로 시/분만 추출해 직접 조립한다.
 *      timeZone: 'Asia/Seoul'로 KST 변환은 Intl에 위임.
 */
function formatKoreanTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).formatToParts(new Date(iso));

  const hour24 = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';

  const ampm = hour24 < 12 ? '오전' : '오후';
  // 12시간제 변환: 0 → 12 (오전 12 = 자정), 13~23 → 1~11 (오후), 12는 그대로 (오후 12 = 정오)
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;

  return `${ampm} ${hour12}:${minute.padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────
// 헬퍼: 솔라피 호출
// ─────────────────────────────────────────────────────────────

/**
 * 010-1234-5678 / +82-10-… 등 다양한 형식을 숫자만 남긴 형태로 정규화.
 * why: 솔라피 to/from 필드는 숫자만 받음 (하이픈 포함 시 검증 실패).
 */
function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

/**
 * 솔라피 HMAC 인증 헤더 빌드.
 * 형식: `HMAC-SHA256 apiKey={key}, date={ISO}, salt={hex16}, signature={hmac(date+salt)}`
 * why: 매 요청마다 date+salt가 바뀌어 리플레이 공격에 강함.
 */
function buildAuthHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', apiSecret)
    .update(date + salt)
    .digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

type SendArgs = {
  apiKey: string;
  apiSecret: string;
  sender: string;
  pfId: string;
  templateId: string;
  variables: Record<string, string>;
  text: string;
  to: string;
};

/**
 * 솔라피 단건 발송 (카카오 알림톡, REST v4).
 * 실패(HTTP 4xx/5xx 또는 응답 statusCode 비정상) 시 throw → 호출부에서 retry 결정.
 */
async function sendAlimtalk({
  apiKey,
  apiSecret,
  sender,
  pfId,
  templateId,
  variables,
  text,
  to,
}: SendArgs) {
  const res = await fetch(SOLAPI_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(apiKey, apiSecret),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        to,
        from: normalizePhone(sender),
        // SMS 폴백 본문 — disableSms:false일 때 알림톡 실패 시 이 텍스트로 SMS 발송.
        // why: 메시지 루트 어디에 두든 솔라피가 폴백 본문으로 인식. 알림톡 성공 시엔 무시됨.
        text,
        // type 필드는 생략 가능 — kakaoOptions 존재 시 솔라피가 ATA로 자동 인식.
        kakaoOptions: {
          pfId,
          templateId,
          variables,
          // 알림톡 발송 실패 시 SMS로 자동 대체 발송.
          // why: 카카오톡 미설치/차단/서버장애로 알림톡이 실패해도 학부모는 등하원
          //      알림을 받을 수 있어야 함 → 솔라피가 동일 메시지(text)를 SMS로 폴백.
          //      (SMS 단가가 추가 발생할 수 있다는 점은 운영 시 모니터링 필요)
          disableSms: false,
        },
      },
    }),
  });

  // HTTP 레벨 오류 (인증 실패, 서버 오류 등)
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Solapi HTTP ${res.status}: ${body}`);
  }

  // 솔라피는 HTTP 200이어도 응답 본문에 실패 statusCode를 담을 수 있음.
  // why: 잔액 부족, 템플릿 미매칭, 수신 거부 등은 HTTP 200 + 비정상 statusCode로 옴.
  //      "2000"(성공)/"3000"(예약 성공)이 아닌 경우 모두 실패로 간주.
  const data = (await res.json()) as { statusCode?: string };
  if (data.statusCode && !['2000', '3000'].includes(String(data.statusCode))) {
    throw new Error(
      `Solapi statusCode=${data.statusCode}: ${JSON.stringify(data)}`,
    );
  }
  return data;
}

// ─────────────────────────────────────────────────────────────
// 헬퍼: notification_logs 상태 업데이트
// ─────────────────────────────────────────────────────────────

/**
 * 발송 성공 → status='sent', sent_at=now, next_retry_at 클리어.
 * why: next_retry_at을 null로 비워야 cron이 이 행을 다시 줍지 않음.
 */
async function markSent(supabase: ServerSupabase, id: string) {
  const update: TablesUpdate<'notification_logs'> = {
    status: 'sent',
    sent_at: new Date().toISOString(),
    next_retry_at: null,
  };
  await supabase.from('notification_logs').update(update).eq('id', id);
}

/**
 * 즉시 'failed' 처리 (재시도 무의미한 경우 — 예: 학부모 phone 행 자체가 사라짐).
 * why: 솔라피 호출조차 못 한 케이스라도 attempt_count는 +1 해서 시도 흔적을 남긴다.
 */
async function markFailed(
  supabase: ServerSupabase,
  id: string,
  prevAttempt: number,
  reason: string,
) {
  const update: TablesUpdate<'notification_logs'> = {
    status: 'failed',
    attempt_count: prevAttempt + 1,
    error_message: reason,
    next_retry_at: null,
  };
  await supabase.from('notification_logs').update(update).eq('id', id);
}

/**
 * 솔라피 호출 실패 후 backoff 스케줄 또는 최종 'failed' 결정.
 * - 새 attempt_count가 MAX_ATTEMPT(3) 초과 → status='failed' (cron이 다시 줍지 않음)
 * - 그 외 → status='retrying' + next_retry_at = now + backoff
 *
 * why: cron이 next_retry_at <= now() 조건으로 행을 픽업하므로,
 *      backoff 시각을 정확히 박아둬야 1분/5분/15분 간격이 성립.
 */
async function markFailureOrRetry(
  supabase: ServerSupabase,
  id: string,
  prevAttempt: number,
  reason: string,
): Promise<'retrying' | 'failed'> {
  const newAttempt = prevAttempt + 1;

  if (newAttempt > MAX_ATTEMPT) {
    const update: TablesUpdate<'notification_logs'> = {
      status: 'failed',
      attempt_count: newAttempt,
      error_message: reason,
      next_retry_at: null,
    };
    await supabase.from('notification_logs').update(update).eq('id', id);
    return 'failed';
  }

  // backoff 인덱스: newAttempt 1 → [0]=1분, 2 → [1]=5분, 3 → [2]=15분
  const backoffMin = RETRY_BACKOFF_MIN[newAttempt - 1];
  const nextRetry = new Date(Date.now() + backoffMin * 60 * 1000).toISOString();

  const update: TablesUpdate<'notification_logs'> = {
    status: 'retrying',
    attempt_count: newAttempt,
    next_retry_at: nextRetry,
    error_message: reason,
  };
  await supabase.from('notification_logs').update(update).eq('id', id);
  return 'retrying';
}
