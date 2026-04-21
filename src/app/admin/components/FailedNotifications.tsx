'use client'

import { useState, useMemo } from 'react'
import { NOTIFICATIONS } from '../lib/mockData'
import type { NotificationLog } from '../lib/mockData'

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
      {name.slice(-1)}
    </div>
  )
}

function NotifyRow({ n, onResolve, onRetry }: {
  n: NotificationLog
  onResolve: () => void
  onRetry: () => void
}) {
  const isRetrying = n.status === 'retrying'
  const typeLabel = n.type === 'checkin' ? '등원' : '하원'
  const typeBg = n.type === 'checkin' ? '#FFF1EA' : '#E9F0FF'
  const typeFg = n.type === 'checkin' ? '#FF6B35' : '#2B6CFF'

  return (
    <div className="flex items-center gap-4 flex-wrap p-4 rounded-xl"
      style={{
        background: '#fff', opacity: n.resolved ? 0.55 : 1,
        border: '1px solid #EAEAE4',
        borderLeft: `3px solid ${isRetrying ? '#E8A317' : '#E5484D'}`,
      }}>
      <Avatar name={n.student.name} kind={n.type === 'checkin' ? 'warm' : 'cool'} size={40} />

      <div style={{ flex: '1 1 220px', minWidth: 180 }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold" style={{ color: '#141414' }}>{n.student.name}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ background: typeBg, color: typeFg }}>{typeLabel} 알림</span>
          {isRetrying
            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: '#FDF3DC', color: '#9A6B00' }}>재시도 중 · {n.attempt_count}/3</span>
            : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: '#FDECEC', color: '#E5484D' }}>3회 실패</span>}
          {n.resolved && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: '#E6F6EE', color: '#1BA974' }}>해결됨</span>}
        </div>
        <p className="text-xs mt-1" style={{ color: '#9A9A9A' }}>
          {n.student.classroom} · {n.student.grade} · {n.parent.name} ({n.parent.phone})
        </p>
      </div>

      <div style={{ flex: '1 1 220px', minWidth: 180 }}>
        <p className="text-xs font-semibold mb-0.5" style={{ color: '#9A9A9A' }}>
          {isRetrying ? '재시도 예정' : '실패 사유'}
        </p>
        <p className="text-sm font-medium" style={{ color: '#141414' }}>
          {isRetrying ? n.next_retry_at_display : n.error_message}
        </p>
        <p className="text-xs mt-1 tabular-nums" style={{ color: '#9A9A9A' }}>
          최초 발송: {n.attempted_at_raw} · 시도 {n.attempt_count}회
          {isRetrying && ` · 최근 오류: ${n.error_message}`}
        </p>
      </div>

      {!n.resolved && (
        <div className="flex gap-1.5 flex-shrink-0">
          <button className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', cursor: 'pointer', fontFamily: 'inherit' }}>
            <Icon name="phone" size={13} />직접 연락
          </button>
          {!isRetrying && (
            <button onClick={onRetry}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-white"
              style={{ background: '#141414', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              <Icon name="retry" size={13} />재전송
            </button>
          )}
          {isRetrying && (
            <button onClick={onResolve}
              className="h-8 px-3 rounded-lg text-xs font-medium"
              style={{ background: 'transparent', color: '#5B5B5B', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
          )}
        </div>
      )}
    </div>
  )
}

type FilterType = 'all' | 'failed' | 'retrying'

export default function FailedNotifications() {
  const [notifs, setNotifs] = useState<NotificationLog[]>(() => NOTIFICATIONS.slice())
  const [filter, setFilter] = useState<FilterType>('all')
  const [showResolved, setShowResolved] = useState(false)
  const [query, setQuery] = useState('')

  const failedCount = notifs.filter(n => n.status === 'failed' && !n.resolved).length
  const retryingCount = notifs.filter(n => n.status === 'retrying' && !n.resolved).length

  const filtered = useMemo(() => notifs.filter(n => {
    if (!showResolved && n.resolved) return false
    if (filter !== 'all' && n.status !== filter) return false
    if (query) {
      const q = query.toLowerCase()
      return n.student.name.toLowerCase().includes(q) || n.parent.phone.includes(q)
    }
    return true
  }), [notifs, filter, showResolved, query])

  const markResolved = (n: NotificationLog) =>
    setNotifs(p => p.map(x => x.id === n.id ? { ...x, resolved: true } : x))

  const retry = (n: NotificationLog) =>
    setNotifs(p => p.map(x => x.id === n.id ? { ...x, resolved: true, error_message: '재시도 성공' } : x))

  const tabs: { v: FilterType; l: string }[] = [
    { v: 'all', l: `전체 ${failedCount + retryingCount}` },
    { v: 'failed', l: `3회 실패 ${failedCount}` },
    { v: 'retrying', l: `재시도 중 ${retryingCount}` },
  ]

  return (
    <div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>알림 발송 실패</h2>
          <p className="text-sm mt-1" style={{ color: '#5B5B5B' }}>3회 실패 {failedCount}건 · 재시도 중 {retryingCount}건</p>
        </div>
        <button className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium"
          style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Icon name="retry" size={14} />전체 재시도
        </button>
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

          <div className="flex gap-1 p-1 rounded-xl" style={{ background: '#F2F2EC' }}>
            {tabs.map(t => (
              <button key={t.v} onClick={() => setFilter(t.v)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{
                  background: filter === t.v ? '#fff' : 'transparent',
                  color: filter === t.v ? '#141414' : '#5B5B5B',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: filter === t.v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}>{t.l}</button>
            ))}
          </div>

          <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer select-none"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#5B5B5B' }}>
            <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)}
              style={{ accentColor: '#141414' }} />
            해결된 내역 포함
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {filtered.map(n => (
          <NotifyRow key={n.id} n={n} onResolve={() => markResolved(n)} onRetry={() => retry(n)} />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-xl p-10 text-center" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3.5"
              style={{ background: '#E6F6EE', color: '#1BA974' }}>
              <Icon name="check" size={28} strokeWidth={2.4} />
            </div>
            <p className="text-base font-bold" style={{ color: '#141414' }}>문제가 되는 알림이 없습니다</p>
            <p className="text-sm mt-1" style={{ color: '#9A9A9A' }}>모든 알림톡이 정상 전송됐어요</p>
          </div>
        )}
      </div>
    </div>
  )
}
