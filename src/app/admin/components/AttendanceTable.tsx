'use client'

import { useEffect, useMemo, useState } from 'react'

// API 응답 형태 — /api/admin/attendance 라우트와 1:1 매칭.
// student_name은 서버에서 students 테이블과 inner join해 평탄화한 값.
type AttendanceLogRow = {
  id: string
  student_id: string
  student_name: string
  type: 'checkin' | 'checkout'
  checked_at: string
  memo: string | null
}

type RangeKey = 'week' | 'month' | 'all' | 'custom'
type TypeFilter = 'all' | 'checkin' | 'checkout'

function Icon({ name, size = 16, strokeWidth = 1.7, color }: { name: string; size?: number; strokeWidth?: number; color?: string }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="M20 20L16 16"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10H21"/><path d="M8 3V7"/><path d="M16 3V7"/></>,
    x: <><path d="M6 6L18 18"/><path d="M18 6L6 18"/></>,
    check: <path d="M4 12L10 18L20 6"/>,
    plus: <><path d="M12 5V19"/><path d="M5 12H19"/></>,
    note: <><path d="M5 4H15L19 8V20H5Z"/><path d="M15 4V8H19"/><path d="M8 12H16"/><path d="M8 16H14"/></>,
    chevronDown: <path d="M6 9L12 15L18 9"/>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function Avatar({ name, kind = 'neutral', size = 32 }: { name: string; kind?: 'warm' | 'cool' | 'neutral'; size?: number }) {
  const c = { warm: { bg: '#FFF1EA', fg: '#FF6B35' }, cool: { bg: '#E9F0FF', fg: '#2B6CFF' }, neutral: { bg: '#F2F2EC', fg: '#5B5B5B' } }[kind]
  return (
    <div style={{ width: size, height: size, borderRadius: 8, background: c.bg, color: c.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, flexShrink: 0 }}>
      {name.slice(-1) || '?'}
    </div>
  )
}

function TypeBadge({ type }: { type: 'checkin' | 'checkout' }) {
  const map = {
    checkin: { bg: '#FFF1EA', fg: '#FF6B35', dot: '#FF6B35', label: '등원' },
    checkout: { bg: '#E9F0FF', fg: '#2B6CFF', dot: '#2B6CFF', label: '하원' },
  }[type]
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: map.bg, color: map.fg }}>
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: map.dot }} />
      {map.label}
    </span>
  )
}

// ISO timestamptz → 화면 표시용 분해. 한 곳에 모아둬 테이블 row와 모달이 같은 형식을 쓰게 한다.
function formatChecked(iso: string): { date: string; day: string; time: string } {
  const d = new Date(iso)
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return { date, day, time }
}

// range → API에 보낼 from(ISO) 계산. 'all'은 from 자체를 보내지 않아 서버에서 무제한으로 조회.
// 'custom'은 사용자 지정 시작일(YYYY-MM-DD)을 그 날 자정(브라우저 로컬=KST)으로 변환.
function computeFromIso(range: RangeKey, customFrom: string): string | null {
  if (range === 'all') return null
  if (range === 'custom') {
    if (!customFrom) return null
    return new Date(`${customFrom}T00:00:00`).toISOString()
  }
  const d = new Date()
  if (range === 'week') d.setDate(d.getDate() - 7)
  else d.setDate(d.getDate() - 30)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// 'custom' 범위에서만 종료일 boundary 계산 — 그 날 23:59:59.999까지 포함.
// why: API의 lte 비교라 자정으로 박으면 종료일 그날의 데이터가 누락됨.
//      'week'/'month'/'all'은 to를 보내지 않아 서버에서 현재까지로 자연스럽게 흐름.
function computeToIso(range: RangeKey, customTo: string): string | null {
  if (range !== 'custom' || !customTo) return null
  return new Date(`${customTo}T23:59:59.999`).toISOString()
}

// CSV 셀 escape — RFC 4180. 콤마/줄바꿈/따옴표 포함 시 따옴표로 감싸고 내부 따옴표는 두 번 반복.
function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

// 파일명 금지 문자(/\:*?"<>|)를 _로 치환. 한글/공백/물결표(~)는 모던 OS에서 허용되어 보존.
function sanitizeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_')
}

// 'YYYY-MM-DD' 오늘 문자열 (date input value 형식). UTC 변환 없이 로컬(KST) 자정 기준.
function todayDateString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 헤더 "기간 버튼"이 띄우는 모달 — 빠른 선택(7일/30일/전체)과 사용자 지정 날짜를 한 곳에 통합.
// why: 기간 관련 컨트롤(select + 모달)이 분산돼 있던 UX를 단일 진입점으로 합쳐 사용자 시선 점프를 줄임.
//      프리셋은 클릭 즉시 onApply → 모달 닫힘. 사용자 지정은 두 날짜 + 하단 '사용자 지정 적용' 버튼.
function RangeModal({ currentRange, currentFrom, currentTo, onClose, onApply }: {
  currentRange: RangeKey
  currentFrom: string
  currentTo: string
  onClose: () => void
  onApply: (range: RangeKey, from?: string, to?: string) => void
}) {
  const today = todayDateString()
  // 기본값: 비어있으면 (오늘-7, 오늘)을 미리 깔아둠 — 사용자가 즉시 적용 가능하도록.
  const defaultFrom = (() => {
    if (currentFrom) return currentFrom
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(currentTo || today)
  const valid = Boolean(from && to && from <= to)

  const presets: Array<{ value: RangeKey; label: string }> = [
    { value: 'week', label: '최근 7일' },
    { value: 'month', label: '최근 30일' },
    { value: 'all', label: '전체 기간' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(10,10,10,0.45)' }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #F2F2EC' }}>
          <h3 className="text-lg font-bold" style={{ color: '#141414' }}>기간 설정</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9A9A9A' }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="p-6 flex flex-col gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2.5" style={{ color: '#9A9A9A' }}>빠른 선택</p>
            <div className="flex flex-col rounded-lg overflow-hidden" style={{ border: '1px solid #EAEAE4' }}>
              {presets.map((p, i) => {
                const selected = currentRange === p.value
                return (
                  <button key={p.value}
                    onClick={() => onApply(p.value)}
                    className="flex items-center justify-between px-4 py-3 text-sm font-medium text-left"
                    style={{
                      background: selected ? '#F2F2EC' : '#fff',
                      color: '#141414',
                      border: 'none',
                      borderTop: i === 0 ? 'none' : '1px solid #EAEAE4',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}>
                    <span>{p.label}</span>
                    {selected && <Icon name="check" size={16} strokeWidth={2.4} color="#141414" />}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2.5" style={{ color: '#9A9A9A' }}>사용자 지정</p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>시작일</label>
                <input type="date" value={from} max={today}
                  onChange={e => setFrom(e.target.value)}
                  className="w-full h-10 rounded-lg px-3 text-sm tabular-nums outline-none"
                  style={{ border: '1px solid #EAEAE4', color: '#141414', background: '#fff', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>종료일</label>
                <input type="date" value={to} min={from} max={today}
                  onChange={e => setTo(e.target.value)}
                  className="w-full h-10 rounded-lg px-3 text-sm tabular-nums outline-none"
                  style={{ border: '1px solid #EAEAE4', color: '#141414', background: '#fff', boxSizing: 'border-box' }} />
              </div>
              {!valid && from && to && (
                <p className="text-xs" style={{ color: '#E5484D' }}>시작일은 종료일보다 빠르거나 같아야 합니다.</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-3.5" style={{ borderTop: '1px solid #F2F2EC', background: '#F2F2EC' }}>
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-medium"
            style={{ background: 'transparent', color: '#5B5B5B', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            취소
          </button>
          <button onClick={() => valid && onApply('custom', from, to)} disabled={!valid}
            className="h-9 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: '#141414', border: 'none', cursor: valid ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            사용자 지정 적용
          </button>
        </div>
      </div>
    </div>
  )
}

function MemoModal({ row, onClose, onSave, busy }: {
  row: AttendanceLogRow
  onClose: () => void
  onSave: (id: string, memo: string) => Promise<void>
  busy: boolean
}) {
  const [text, setText] = useState(row.memo ?? '')
  const ts = formatChecked(row.checked_at)
  const isEdit = Boolean(row.memo)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(10,10,10,0.45)' }}
      onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#fff', border: '1px solid #EAEAE4', boxShadow: '0 30px 80px -10px rgba(0,0,0,0.25)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid #F2F2EC' }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9A9A9A' }}>메모</p>
            <p className="text-xl font-bold mt-1" style={{ color: '#141414' }}>{row.student_name}</p>
          </div>
          <button onClick={onClose} disabled={busy} className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ background: 'transparent', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: '#9A9A9A' }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-3 p-3 rounded-xl mb-5" style={{ background: '#F2F2EC' }}>
            <Avatar name={row.student_name} kind={row.type === 'checkin' ? 'warm' : 'cool'} size={36} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: '#141414' }}>{row.student_name}</p>
              <p className="text-xs mt-0.5 tabular-nums" style={{ color: '#9A9A9A' }}>{ts.date} ({ts.day}) · {ts.time}</p>
            </div>
            <TypeBadge type={row.type} />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>메모</label>
            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder="보강 일정, 결석 사유, 인계 사항 등을 자유롭게 기록해주세요"
              rows={5}
              className="w-full rounded-lg px-3 py-2.5 text-sm leading-relaxed outline-none resize-y"
              style={{ border: '1px solid #EAEAE4', color: '#141414', boxSizing: 'border-box' }} />
            <p className="text-xs mt-1.5" style={{ color: '#9A9A9A' }}>비워두고 저장하면 기존 메모가 삭제됩니다</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-3.5" style={{ borderTop: '1px solid #F2F2EC', background: '#F2F2EC' }}>
          <button onClick={onClose} disabled={busy} className="h-9 px-4 rounded-lg text-sm font-medium"
            style={{ background: 'transparent', color: '#5B5B5B', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            취소
          </button>
          <button onClick={() => onSave(row.id, text)} disabled={busy}
            className="h-9 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: '#141414', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {busy ? '저장 중...' : isEdit ? '수정' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AttendanceTable() {
  const [logs, setLogs] = useState<AttendanceLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('week')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [memoOpen, setMemoOpen] = useState<AttendanceLogRow | null>(null)
  const [savingMemo, setSavingMemo] = useState(false)
  // range='custom'일 때 사용되는 사용자 지정 시작/종료일 ('YYYY-MM-DD', 비어 있으면 미설정).
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [rangeModalOpen, setRangeModalOpen] = useState(false)

  // range/typeFilter 변경 시 서버 재조회.
  // why: 기간/타입은 row 수가 크게 달라질 수 있어 클라이언트 필터링보다 DB 쿼리에서 잘라내는 편이 효율적.
  //      (학생 이름 검색은 row 단위 필터라 클라이언트에서 처리)
  // react-hooks/set-state-in-effect 회피를 위해 useCallback 함수를 effect에서 호출하지 않고
  // effect 본문에 인라인 async IIFE로 작성한다.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const params = new URLSearchParams()
        const fromIso = computeFromIso(range, customFrom)
        const toIso = computeToIso(range, customTo)
        if (fromIso) params.set('from', fromIso)
        if (toIso) params.set('to', toIso)
        if (typeFilter !== 'all') params.set('type', typeFilter)
        const res = await fetch(`/api/admin/attendance?${params.toString()}`, { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        const body = (await res.json()) as { logs: AttendanceLogRow[] }
        if (cancelled) return
        setLogs(body.logs)
        setLoadError(null)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '출석 기록을 불러오지 못했습니다')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [range, typeFilter, customFrom, customTo])

  const filtered = useMemo(() => {
    if (!query) return logs
    const q = query.toLowerCase()
    return logs.filter(l => l.student_name.toLowerCase().includes(q))
  }, [logs, query])

  const saveMemo = async (id: string, memo: string) => {
    setSavingMemo(true)
    try {
      const res = await fetch(`/api/admin/attendance/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { id: string; memo: string | null }
      // 전체 reload 대신 해당 row만 갱신 — 사용자가 보던 스크롤 위치/필터를 유지.
      setLogs(prev => prev.map(l => l.id === id ? { ...l, memo: body.memo } : l))
      setMemoOpen(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : '메모 저장에 실패했습니다')
    } finally {
      setSavingMemo(false)
    }
  }

  const rangeLabel =
    range === 'week' ? '최근 7일'
    : range === 'month' ? '최근 30일'
    : range === 'all' ? '전체 기간'
    : (customFrom && customTo) ? `${customFrom.replace(/-/g, '.')} ~ ${customTo.replace(/-/g, '.')}`
    : '사용자 지정'

  // 현재 보이는 필터 결과(filtered)를 CSV로 변환해 다운로드.
  // why: 백엔드 export 엔드포인트를 추가하지 않고 클라이언트에서만 처리 — 데이터가 이미 메모리에 있고
  //      Blob+ObjectURL로 외부 의존성 없이 즉시 다운로드 가능.
  const exportCsv = () => {
    const headers = ['날짜', '요일', '학생명', '구분', '시각', '메모']
    const rows = filtered.map((row) => {
      const ts = formatChecked(row.checked_at)
      return [
        ts.date,
        ts.day,
        row.student_name,
        row.type === 'checkin' ? '등원' : '하원',
        ts.time,
        row.memo ?? '',
      ].map(escapeCsvCell).join(',')
    })
    // \r\n: Excel가 줄바꿈을 가장 안정적으로 인식.
    // ﻿: UTF-8 BOM — Excel가 한글을 깨지 않게 하는 필수 prefix.
    const csv = '﻿' + [headers.join(','), ...rows].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const today = todayDateString().replace(/-/g, '.')
    const rangePart =
      range === 'week' ? '최근7일'
      : range === 'month' ? '최근30일'
      : range === 'all' ? '전체'
      : (customFrom && customTo) ? `${customFrom.replace(/-/g, '.')}~${customTo.replace(/-/g, '.')}`
      : '사용자지정'
    // custom의 경우 파일명에 이미 기간이 있어 today 중복 회피.
    const filename = sanitizeFilename(
      range === 'custom' ? `출석기록_${rangePart}.csv` : `출석기록_${rangePart}_${today}.csv`,
    )

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>출석 기록</h2>
          <p className="text-sm mt-1 tabular-nums" style={{ color: '#5B5B5B' }}>총 {filtered.length}건</p>
        </div>
        <button onClick={exportCsv} disabled={filtered.length === 0}
          className="h-9 px-3 rounded-lg text-sm font-medium disabled:opacity-50"
          style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', cursor: filtered.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
          엑셀 내보내기
        </button>
      </div>

      {/* 필터 카드: 기간/검색/구분/초기화를 한 줄에 그룹. flex-wrap으로 좁은 화면에서 자연 줄바꿈,
          검색 input만 flex-1로 남는 공간 흡수해 나머지 컨트롤은 콘텐츠 폭만 차지. */}
      <div className="rounded-xl p-3.5 mb-4" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 기간 버튼: 현재 선택된 기간을 라벨로 표시 → 클릭 시 RangeModal로 빠른 선택/사용자 지정 일괄 처리. */}
          <button onClick={() => setRangeModalOpen(true)}
            className="flex items-center gap-2 h-10 px-3 rounded-lg text-sm font-semibold flex-shrink-0"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', cursor: 'pointer', fontFamily: 'inherit' }}>
            <Icon name="calendar" size={14} />
            <span className="tabular-nums">{rangeLabel}</span>
            <Icon name="chevronDown" size={14} color="#9A9A9A" />
          </button>
          <div className="relative flex items-center flex-1" style={{ minWidth: 200 }}>
            <span className="absolute left-3 pointer-events-none" style={{ color: '#9A9A9A' }}><Icon name="search" size={14} /></span>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="학생 이름 검색"
              className="w-full h-10 rounded-lg pl-9 pr-3 text-sm outline-none"
              style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414' }} />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TypeFilter)}
            className="h-10 rounded-lg px-3 text-sm cursor-pointer outline-none flex-shrink-0"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', fontFamily: 'inherit' }}>
            <option value="all">전체 구분</option>
            <option value="checkin">등원만</option>
            <option value="checkout">하원만</option>
          </select>
          <button onClick={() => { setQuery(''); setRange('week'); setTypeFilter('all'); setCustomFrom(''); setCustomTo('') }}
            className="h-10 px-3 rounded-lg text-sm font-medium flex-shrink-0"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#5B5B5B', cursor: 'pointer', fontFamily: 'inherit' }}>
            초기화
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl p-3.5 mb-4 text-sm"
          style={{ background: '#FDECEC', border: '1px solid rgba(229,72,77,0.2)', color: '#E5484D' }}>
          출석 기록을 불러오지 못했습니다: {loadError}
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 14, minWidth: 720 }}>
            <thead>
              <tr style={{ background: '#F2F2EC', textAlign: 'left' }}>
                {[['날짜', 130], ['학생', 200], ['구분', 100], ['시각', 100], ['메모', 240]].map(([label, w]) => (
                  <th key={label} className="uppercase tracking-widest"
                    style={{ padding: '12px 16px', fontSize: 12, color: '#5B5B5B', fontWeight: 600, width: w, whiteSpace: 'nowrap' }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: '32px 16px', textAlign: 'center', color: '#9A9A9A' }}>불러오는 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '32px 16px', textAlign: 'center', color: '#9A9A9A' }}>
                  {logs.length === 0 ? '해당 기간에 출석 기록이 없습니다' : '검색 조건에 맞는 기록이 없습니다'}
                </td></tr>
              ) : filtered.map(r => {
                const ts = formatChecked(r.checked_at)
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid #F2F2EC', height: 56 }}>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <p className="text-xs tabular-nums" style={{ color: '#141414' }}>{ts.date}</p>
                      <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>{ts.day}요일</p>
                    </td>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <p className="text-sm font-semibold truncate" style={{ color: '#141414' }}>{r.student_name}</p>
                    </td>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <TypeBadge type={r.type} />
                    </td>
                    <td className="tabular-nums text-sm" style={{ padding: '12px 16px', verticalAlign: 'middle', color: '#141414' }}>
                      {ts.time}
                    </td>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      {r.memo ? (
                        <button onClick={() => setMemoOpen(r)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold max-w-full"
                          style={{ background: '#E6F6EE', color: '#1BA974', border: '1px solid #E6F6EE', cursor: 'pointer', fontFamily: 'inherit' }}>
                          <Icon name="check" size={12} strokeWidth={2.4} />
                          <span className="truncate" style={{ maxWidth: 180 }}>{r.memo}</span>
                        </button>
                      ) : (
                        <button onClick={() => setMemoOpen(r)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{ background: 'transparent', color: '#141414', border: '1px dashed #EAEAE4', cursor: 'pointer', fontFamily: 'inherit' }}>
                          <Icon name="plus" size={12} strokeWidth={2} />메모 추가
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {memoOpen && (
        <MemoModal row={memoOpen} onClose={() => setMemoOpen(null)} onSave={saveMemo} busy={savingMemo} />
      )}
      {rangeModalOpen && (
        <RangeModal
          currentRange={range}
          currentFrom={customFrom}
          currentTo={customTo}
          onClose={() => setRangeModalOpen(false)}
          onApply={(r, from, to) => {
            setRange(r)
            // 프리셋(week/month/all) 선택 시 stale custom 값 정리. custom일 땐 새 from/to를 set.
            if (r === 'custom' && from && to) {
              setCustomFrom(from)
              setCustomTo(to)
            } else {
              setCustomFrom('')
              setCustomTo('')
            }
            setRangeModalOpen(false)
          }}
        />
      )}
    </div>
  )
}
