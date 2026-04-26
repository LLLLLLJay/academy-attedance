'use client'

import { useEffect, useMemo, useState } from 'react'

// API 응답 형태 — /api/admin/notifications/failed 라우트와 1:1 매칭.
// student/parent를 평탄화해서 받으므로 UI에서 추가 가공 없이 그대로 그릴 수 있다.
type FailedNotificationRow = {
  id: string
  attendance_id: string
  student_id: string
  student_name: string
  parent_name: string | null
  parent_phone: string
  type: 'checkin' | 'checkout'
  attempt_count: number
  error_message: string | null
  attempted_at: string
}

function Icon({ name, size = 16, strokeWidth = 1.7, color }: { name: string; size?: number; strokeWidth?: number; color?: string }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="M20 20L16 16"/></>,
    alert: <><path d="M12 3L22 20H2Z"/><path d="M12 10V14"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/></>,
    check: <path d="M4 12L10 18L20 6"/>,
    retry: <><path d="M4 12A8 8 0 0 1 20 12"/><path d="M20 8V12H16"/><path d="M20 12A8 8 0 0 1 4 12"/><path d="M4 16V12H8"/></>,
    phone: <path d="M5 4h4l2 5-3 2a10 10 0 0 0 5 5l2-3 5 2v4a1 1 0 0 1-1 1C10 20 4 14 4 5a1 1 0 0 1 1-1z"/>,
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

function NotifyRow({ n }: { n: FailedNotificationRow }) {
  const typeLabel = n.type === 'checkin' ? '등원' : '하원'
  const typeBg = n.type === 'checkin' ? '#FFF1EA' : '#E9F0FF'
  const typeFg = n.type === 'checkin' ? '#FF6B35' : '#2B6CFF'

  return (
    <div className="flex items-center gap-4 flex-wrap p-4 rounded-xl"
      style={{
        background: '#fff',
        border: '1px solid #EAEAE4',
        borderLeft: '3px solid #E5484D',
      }}>
      <Avatar name={n.student_name} kind={n.type === 'checkin' ? 'warm' : 'cool'} size={40} />

      <div style={{ flex: '1 1 220px', minWidth: 180 }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold" style={{ color: '#141414' }}>{n.student_name}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ background: typeBg, color: typeFg }}>{typeLabel} 알림</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ background: '#FDECEC', color: '#E5484D' }}>{n.attempt_count}회 실패</span>
        </div>
        <p className="text-xs mt-1" style={{ color: '#9A9A9A' }}>
          {n.parent_name ? `${n.parent_name} · ` : ''}{n.parent_phone}
        </p>
      </div>

      <div style={{ flex: '1 1 220px', minWidth: 180 }}>
        <p className="text-xs font-semibold mb-0.5" style={{ color: '#9A9A9A' }}>실패 사유</p>
        <p className="text-sm font-medium" style={{ color: '#141414' }}>
          {n.error_message ?? '사유 미기록'}
        </p>
        <p className="text-xs mt-1 tabular-nums" style={{ color: '#9A9A9A' }}>
          최초 발송: {formatAttempted(n.attempted_at)} · 시도 {n.attempt_count}회
        </p>
      </div>

      <div className="flex gap-1.5 flex-shrink-0">
        <button className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium"
          style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Icon name="phone" size={13} />직접 연락
        </button>
      </div>
    </div>
  )
}

export default function FailedNotifications() {
  const [notifs, setNotifs] = useState<FailedNotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

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

  const filtered = useMemo(() => notifs.filter(n => {
    if (!query) return true
    const q = query.toLowerCase()
    return n.student_name.toLowerCase().includes(q) || n.parent_phone.includes(q)
  }), [notifs, query])

  return (
    <div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>알림 발송 실패</h2>
          <p className="text-sm mt-1" style={{ color: '#5B5B5B' }}>
            {loading ? '불러오는 중...' : `${notifs.length}건`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl p-3 mb-4"
        style={{ background: '#FDF3DC', border: '1px solid rgba(232,163,23,0.2)' }}>
        <Icon name="alert" size={16} color="#9A6B00" />
        <p className="text-xs leading-relaxed flex-1" style={{ color: '#6F4E00' }}>
          솔라피 알림톡은 <b>1분 → 5분 → 15분</b> 간격으로 최대 3회 자동 재시도됩니다.
          3회 실패 시 학부모께 직접 연락하거나 수동 재전송해주세요.
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
          filtered.map(n => <NotifyRow key={n.id} n={n} />)
        )}
      </div>
    </div>
  )
}
