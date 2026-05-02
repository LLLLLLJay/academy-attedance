'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

// API 응답 형태 — /api/admin/notifications/failed 라우트와 1:1 매칭.
// status는 'failed' | 'retrying' 중 하나. UI에서 뱃지 분기에 사용.
type FailedNotificationRow = {
  id: string
  attendance_id: string
  student_id: string
  student_name: string
  parent_name: string | null
  parent_phone: string
  type: 'checkin' | 'checkout'
  status: 'failed' | 'retrying'
  attempt_count: number
  error_message: string | null
  attempted_at: string
}

// 토스트 한 건의 모양 — kind에 따라 색만 분기, 메시지는 자유 텍스트.
type Toast = {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

function Icon({ name, size = 16, strokeWidth = 1.7, color }: { name: string; size?: number; strokeWidth?: number; color?: string }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="M20 20L16 16"/></>,
    alert: <><path d="M12 3L22 20H2Z"/><path d="M12 10V14"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/></>,
    check: <path d="M4 12L10 18L20 6"/>,
    retry: <><path d="M4 12A8 8 0 0 1 20 12"/><path d="M20 8V12H16"/><path d="M20 12A8 8 0 0 1 4 12"/><path d="M4 16V12H8"/></>,
    phone: <path d="M5 4h4l2 5-3 2a10 10 0 0 0 5 5l2-3 5 2v4a1 1 0 0 1-1 1C10 20 4 14 4 5a1 1 0 0 1 1-1z"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7V12L15 14"/></>,
    x: <><path d="M18 6L6 18"/><path d="M6 6L18 18"/></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function Avatar({ name, kind = 'neutral', size = 40 }: { name: string; kind?: 'warm' | 'cool' | 'neutral'; size?: number }) {
  const c = { warm: { bg: '#FFF1EA', fg: '#FF6B35' }, cool: { bg: '#E9F0FF', fg: '#2B6CFF' }, neutral: { bg: '#F2F2EC', fg: '#5B5B5B' } }[kind]
  return (
    <div style={{ width: size, height: size, borderRadius: 10, background: c.bg, color: c.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, flexShrink: 0 }}>
      {name.slice(-1) || '?'}
    </div>
  )
}

// ISO timestamptz → 화면 표시용 "YYYY.MM.DD HH:MM" 포맷.
// 한국 사용자가 보는 화면이라 24시간/한국식 구분자를 사용한다.
function formatAttempted(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// /api/notify가 throw하는 에러 메시지는 솔라피 응답 본문을 그대로 붙여 저장한다
// (예: `Solapi HTTP 403: {"errorCode":"Forbidden","errorMessage":"허용되지 않은 IP..."}`).
// 운영자에겐 HTTP 코드/JSON 키가 의미 없으므로 errorMessage 부분만 뽑아 보여준다.
//
// 정책:
//  - JSON 파싱 가능 + errorMessage 필드 존재 → 그 문자열만 반환
//  - 그 외(JSON 없음, 파싱 실패, errorMessage 없음) → raw 그대로 (안전한 폴백)
//  - [DUMMY] 마커는 QA 식별용이므로 보존
//
// why DB가 아닌 UI에서 정제: DB에는 디버깅용 raw를 보존해야 솔라피 CS 문의 등에 활용 가능.
//                          파서 버그 수정 시 코드 한 곳만 고치면 모든 행이 재렌더되며 즉시 반영됨.
function formatErrorForOperator(raw: string | null): string {
  if (!raw) return '사유 미기록'

  const dummyPrefix = raw.startsWith('[DUMMY] ') ? '[DUMMY] ' : ''
  const stripped = raw.slice(dummyPrefix.length)

  // 메시지 내 첫 '{'부터 끝까지를 JSON 본문으로 시도 — solapi 응답은 단일 객체 1개라 안전.
  const braceIdx = stripped.indexOf('{')
  if (braceIdx >= 0) {
    try {
      const obj = JSON.parse(stripped.slice(braceIdx)) as Record<string, unknown>
      const msg = obj.errorMessage
      if (typeof msg === 'string' && msg.length > 0) {
        return dummyPrefix + msg
      }
    } catch {
      // JSON 파싱 실패는 정상 케이스 — non-JSON 응답이거나 잘린 본문. raw 폴백.
    }
  }

  return dummyPrefix + stripped
}

// 터치 우선 디바이스 감지 — 마우스 호버가 안 되는 환경.
// why: pointer:coarse는 손가락 터치를 의미 (모바일/태블릿). 데스크톱은 pointer:fine.
//      iPad Pro + 키보드/마우스 같은 엣지 케이스는 fine으로 잡혀 클립보드로 떨어지지만,
//      그 환경의 사용자는 어차피 클립보드 복사가 더 편하므로 자연스러운 fallback.
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(pointer: coarse)').matches
}

// 전화번호에서 숫자만 남김 — tel: 링크는 하이픈 등이 있어도 동작하지만
// 클립보드에 복사할 때는 원본(010-1234-5678)을 그대로 두는 편이 사람이 읽기 좋다.
function digitsOnly(phone: string): string {
  return phone.replace(/[^0-9]/g, '')
}

// ─────────────────────────────────────────────────────
// 토스트 — 우하단 fixed, 3초 자동 사라짐
// ─────────────────────────────────────────────────────
function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed z-50 flex flex-col gap-2"
      style={{ right: 24, bottom: 24, maxWidth: 'calc(100vw - 48px)' }}>
      {toasts.map(t => {
        const palette = {
          success: { bg: '#E6F6EE', border: '#A8E0C2', fg: '#0F7A4A', icon: 'check' },
          error: { bg: '#FDECEC', border: '#F4B7B9', fg: '#A6232B', icon: 'alert' },
          info: { bg: '#EAF1FF', border: '#B7CCF4', fg: '#1E4FB8', icon: 'phone' },
        }[t.kind]
        return (
          <div key={t.id} role="status"
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl shadow-sm"
            style={{ background: palette.bg, border: `1px solid ${palette.border}`, color: palette.fg, minWidth: 240 }}>
            <Icon name={palette.icon} size={16} color={palette.fg} />
            <span className="text-sm font-medium flex-1">{t.message}</span>
            <button aria-label="닫기" onClick={() => onDismiss(t.id)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: palette.fg, padding: 2, display: 'flex' }}>
              <Icon name="x" size={14} color={palette.fg} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 카드 — 한 행
// ─────────────────────────────────────────────────────
function NotifyRow({
  n,
  isResending,
  onRetry,
  onContact,
}: {
  n: FailedNotificationRow
  isResending: boolean
  onRetry: (id: string) => void
  onContact: (phone: string) => void
}) {
  const typeLabel = n.type === 'checkin' ? '등원' : '하원'
  const typeBg = n.type === 'checkin' ? '#FFF1EA' : '#E9F0FF'
  const typeFg = n.type === 'checkin' ? '#FF6B35' : '#2B6CFF'

  // 상태 뱃지 — failed는 "최종 실패", retrying은 "재시도 대기".
  // why: 운영자에게 두 상태의 의미 차이를 명확히 노출 (cron 미동작 환경에서는
  //      retrying이 사실상 영구 멈춤 — 그래서 노란색으로 경고).
  const statusBadge = n.status === 'failed'
    ? { label: '최종 실패', bg: '#FDECEC', fg: '#E5484D' }
    : { label: '재시도 대기', bg: '#FDF3DC', fg: '#9A6B00' }

  // 좌측 보더 색 — 상태에 따라 빨강/주황으로 시각 구분.
  const borderLeft = n.status === 'failed' ? '#E5484D' : '#E8A317'

  return (
    <div className="flex items-center gap-4 flex-wrap p-4 rounded-xl"
      style={{
        background: '#fff',
        border: '1px solid #EAEAE4',
        borderLeft: `3px solid ${borderLeft}`,
        opacity: isResending ? 0.6 : 1,
        transition: 'opacity 120ms ease',
      }}>
      <Avatar name={n.student_name} kind={n.type === 'checkin' ? 'warm' : 'cool'} size={40} />

      <div style={{ flex: '1 1 220px', minWidth: 180 }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold" style={{ color: '#141414' }}>{n.student_name}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ background: typeBg, color: typeFg }}>{typeLabel} 알림</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ background: statusBadge.bg, color: statusBadge.fg }}>{statusBadge.label}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ background: '#F2F2EC', color: '#5B5B5B' }}>{n.attempt_count}회 시도</span>
        </div>
        <p className="text-xs mt-1" style={{ color: '#9A9A9A' }}>
          {n.parent_name ? `${n.parent_name} · ` : ''}{n.parent_phone}
        </p>
      </div>

      <div style={{ flex: '1 1 220px', minWidth: 180 }}>
        <p className="text-xs font-semibold mb-0.5" style={{ color: '#9A9A9A' }}>실패 사유</p>
        <p className="text-sm font-medium" style={{ color: '#141414' }}>
          {formatErrorForOperator(n.error_message)}
        </p>
        <p className="text-xs mt-1 tabular-nums" style={{ color: '#9A9A9A' }}>
          최초 발송: {formatAttempted(n.attempted_at)}
        </p>
      </div>

      <div className="flex gap-1.5 flex-shrink-0">
        <button
          onClick={() => onRetry(n.id)}
          disabled={isResending}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold"
          style={{
            border: '1px solid #1BA974',
            background: isResending ? '#F2F2EC' : '#1BA974',
            color: isResending ? '#9A9A9A' : '#fff',
            cursor: isResending ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}>
          <Icon name="retry" size={13} />
          {isResending ? '전송 중...' : '재전송'}
        </button>
        <button
          onClick={() => onContact(n.parent_phone)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium"
          style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Icon name="phone" size={13} />직접 연락
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────
export default function FailedNotifications() {
  const [notifs, setNotifs] = useState<FailedNotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // 진행 중인 재전송 ID 집합 — 같은 행 더블 클릭 방지 + 버튼 disable.
  const [resending, setResending] = useState<Set<string>>(new Set())

  // 토스트 큐 — id는 단조 증가하는 카운터로 키 충돌 회피.
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastIdRef = useRef(0)

  // 토스트 추가 (3초 후 자동 dismiss).
  // why: 사용자 액션마다 즉시 피드백 + 운영자가 인지하면 자연스럽게 사라지는 패턴.
  function pushToast(kind: Toast['kind'], message: string) {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, kind, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }

  function dismissToast(id: number) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  // 마운트 시 한 번 조회. AdminPage의 failedCount와는 별도로 자체 fetch한다 —
  // 컴포넌트가 독립적으로 재사용 가능하도록 (전역 상태 없이도 동작).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/notifications/failed', { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        const body = (await res.json()) as { notifications: FailedNotificationRow[] }
        if (cancelled) return
        setNotifs(body.notifications)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '발송 실패 내역 조회 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 수동 재전송 — POST /api/admin/notifications/[id]/retry.
  // 성공(sent>=1) → 행 제거 + 성공 토스트, 실패 → 행 유지 + 실패 토스트.
  // why: sent>=1만 성공으로 본다 — /api/notify는 같은 attendance의 형제 행도 함께 처리해
  //      sent/retrying/failed 카운트를 합산해 돌려주므로 "내가 누른 행이 갔는지"는 근사치로 판단.
  //      엄밀히 검증하려면 재조회가 필요하지만, 실패 시엔 어차피 화면이 그대로 남아 운영자가
  //      한 번 더 누를 수 있으므로 근사치로 충분.
  async function handleRetry(id: string) {
    if (resending.has(id)) return
    setResending(prev => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/admin/notifications/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = (await res.json().catch(() => ({}))) as {
        sent?: number
        retrying?: number
        failed?: number
        error?: string
        detail?: string
      }

      if (!res.ok) {
        pushToast('error', `재전송 실패: ${body.detail ?? body.error ?? `HTTP ${res.status}`}`)
        return
      }

      if ((body.sent ?? 0) > 0) {
        pushToast('success', '재전송 완료 — 학부모에게 알림이 발송됐습니다')
        // 발송 성공한 행은 목록에서 제거 (백엔드 status='sent'로 바뀌어 다음 fetch에서 빠짐).
        setNotifs(prev => prev.filter(n => n.id !== id))
      } else if ((body.failed ?? 0) > 0) {
        pushToast('error', '재전송 실패 — 솔라피 응답 오류. 사유는 새로고침 후 확인하세요')
      } else {
        // 드문 케이스: notify가 처리할 행이 없다고 응답 (이미 다른 경로로 처리됨)
        pushToast('info', '재전송 대상이 없습니다 — 새로고침 후 확인하세요')
      }
    } catch (err) {
      pushToast('error', `재전송 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setResending(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // 직접 연락 — 디바이스에 따라 분기.
  // 모바일/태블릿: tel: 링크로 바로 다이얼.
  // 데스크톱: 클립보드에 번호 복사 + 토스트로 안내.
  // why: 모바일에서 클립보드 복사는 한 번 더 붙여넣어야 해서 마찰 큼.
  //      데스크톱에서 tel:은 OS·브라우저별로 동작이 들쭉날쭉(Skype/Teams 열림 등)이라 비추천.
  async function handleContact(phone: string) {
    if (isTouchDevice()) {
      window.location.href = `tel:${digitsOnly(phone)}`
      return
    }
    // 데스크톱 경로
    try {
      await navigator.clipboard.writeText(phone)
      pushToast('info', `전화번호 복사됨: ${phone}`)
    } catch {
      // clipboard API가 막힌 환경(권한 거부, http 등) 폴백
      pushToast('error', `복사 실패 — 번호: ${phone}`)
    }
  }

  const filtered = useMemo(() => notifs.filter(n => {
    if (!query) return true
    const q = query.toLowerCase()
    return n.student_name.toLowerCase().includes(q) || n.parent_phone.includes(q)
  }), [notifs, query])

  // 카운트 분리 — 헤더 서브타이틀에 두 상태를 같이 노출해 운영자가 한눈에 파악.
  const failedCount = notifs.filter(n => n.status === 'failed').length
  const retryingCount = notifs.filter(n => n.status === 'retrying').length

  return (
    <div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>알림 발송 실패</h2>
          <p className="text-sm mt-1" style={{ color: '#5B5B5B' }}>
            {loading
              ? '불러오는 중...'
              : `총 ${notifs.length}건 — 최종 실패 ${failedCount}건 / 재시도 대기 ${retryingCount}건`}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl p-3 mb-4"
        style={{ background: '#FDF3DC', border: '1px solid rgba(232,163,23,0.2)' }}>
        <Icon name="alert" size={16} color="#9A6B00" />
        <p className="text-xs leading-relaxed flex-1" style={{ color: '#6F4E00' }}>
          실패한 알림은 자동으로 다시 발송되지 않습니다.
          각 행의 <b>[재전송]</b> 또는 <b>[직접 연락]</b>으로 처리해주세요.
        </p>
      </div>

      <div className="rounded-xl p-3.5 mb-4" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="flex gap-2.5 flex-wrap items-center">
          <div className="relative flex items-center flex-1" style={{ minWidth: 200, maxWidth: 320 }}>
            <span className="absolute left-3 pointer-events-none" style={{ color: '#9A9A9A' }}><Icon name="search" size={14} /></span>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="학생 이름 · 연락처 검색"
              className="w-full h-10 rounded-lg pl-9 pr-3 text-sm outline-none"
              style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414' }} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {error ? (
          <div className="rounded-xl p-10 text-center" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
            <p className="text-sm font-semibold" style={{ color: '#E5484D' }}>발송 실패 내역을 불러오지 못했습니다</p>
            <p className="text-xs mt-1" style={{ color: '#9A9A9A' }}>{error}</p>
          </div>
        ) : loading ? (
          <div className="rounded-xl p-10 text-center" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
            <p className="text-sm" style={{ color: '#9A9A9A' }}>불러오는 중...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl p-10 text-center" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3.5"
              style={{ background: '#E6F6EE', color: '#1BA974' }}>
              <Icon name="check" size={28} strokeWidth={2.4} />
            </div>
            <p className="text-base font-bold" style={{ color: '#141414' }}>
              {notifs.length === 0 ? '문제가 되는 알림이 없습니다' : '검색 결과가 없습니다'}
            </p>
            <p className="text-sm mt-1" style={{ color: '#9A9A9A' }}>
              {notifs.length === 0 ? '모든 알림톡이 정상 전송됐어요' : '학생 이름 또는 연락처를 다시 확인해주세요'}
            </p>
          </div>
        ) : (
          filtered.map(n => (
            <NotifyRow
              key={n.id}
              n={n}
              isResending={resending.has(n.id)}
              onRetry={handleRetry}
              onContact={handleContact}
            />
          ))
        )}
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
