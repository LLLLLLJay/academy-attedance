'use client'

import { useState, useMemo } from 'react'
import { HISTORICAL, CLASSROOMS } from '../lib/mockData'
import type { AttendanceRecord } from '../lib/mockData'

function Icon({ name, size = 16, strokeWidth = 1.7, color }: { name: string; size?: number; strokeWidth?: number; color?: string }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="M20 20L16 16"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10H21"/><path d="M8 3V7"/><path d="M16 3V7"/></>,
    chevronDown: <path d="M6 9l6 6 6-6"/>,
    x: <><path d="M6 6L18 18"/><path d="M18 6L6 18"/></>,
    check: <path d="M4 12L10 18L20 6"/>,
    plus: <><path d="M12 5V19"/><path d="M5 12H19"/></>,
    note: <><path d="M5 4H15L19 8V20H5Z"/><path d="M15 4V8H19"/><path d="M8 12H16"/><path d="M8 16H14"/></>,
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
      {name.slice(-1)}
    </div>
  )
}

function StatusBadge({ status }: { status: 'in' | 'out' | 'absent' }) {
  const map = {
    in: { bg: '#FFF1EA', fg: '#FF6B35', dot: '#FF6B35', label: '등원' },
    out: { bg: '#E9F0FF', fg: '#2B6CFF', dot: '#2B6CFF', label: '하원' },
    absent: { bg: '#FDECEC', fg: '#E5484D', dot: '#E5484D', label: '결석' },
  }[status]
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: map.bg, color: map.fg }}>
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: map.dot }} />
      {map.label}
    </span>
  )
}

function MemoModal({ row, onClose, onSave }: {
  row: AttendanceRecord
  onClose: () => void
  onSave: (row: AttendanceRecord, text: string, date: string) => void
}) {
  const [date, setDate] = useState(row.memo?.date ?? '')
  const [text, setText] = useState(row.memo?.text ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(10,10,10,0.45)' }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#fff', border: '1px solid #EAEAE4', boxShadow: '0 30px 80px -10px rgba(0,0,0,0.25)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid #F2F2EC' }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9A9A9A' }}>보강 메모</p>
            <p className="text-xl font-bold mt-1" style={{ color: '#141414' }}>{row.student.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9A9A9A' }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-3 p-3 rounded-xl mb-5" style={{ background: '#F2F2EC' }}>
            <Avatar name={row.student.name} kind="neutral" size={36} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: '#141414' }}>{row.student.name} · {row.student.classroom}</p>
              <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>결석일: {row.date} ({row.day})</p>
            </div>
            <StatusBadge status="absent" />
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>보강 날짜</label>
            <input value={date} onChange={e => setDate(e.target.value)}
              placeholder="예: 2026.04.18"
              className="w-full h-10 rounded-lg px-3 text-sm tabular-nums outline-none"
              style={{ border: '1px solid #EAEAE4', color: '#141414', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>메모</label>
            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder="어떤 내용을 보강했는지, 누가 진행했는지 등을 기록해주세요"
              rows={4}
              className="w-full rounded-lg px-3 py-2.5 text-sm leading-relaxed outline-none resize-y"
              style={{ border: '1px solid #EAEAE4', color: '#141414', boxSizing: 'border-box' }} />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-3.5" style={{ borderTop: '1px solid #F2F2EC', background: '#F2F2EC' }}>
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-medium"
            style={{ background: 'transparent', color: '#5B5B5B', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            취소
          </button>
          <button onClick={() => onSave(row, text, date)} disabled={!date || !text}
            className="h-9 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: '#141414', border: 'none', cursor: !date || !text ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {row.memo ? '수정' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AttendanceTable() {
  const [range, setRange] = useState<'week' | 'month' | 'custom'>('week')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'in' | 'out' | 'absent'>('all')
  const [classFilter, setClassFilter] = useState('all')
  const [memoOpen, setMemoOpen] = useState<AttendanceRecord | null>(null)
  const [records, setRecords] = useState<AttendanceRecord[]>(() => HISTORICAL.slice())

  const cutoff = useMemo(() => {
    const d = new Date(2026, 3, 21)
    if (range === 'week') d.setDate(d.getDate() - 7)
    else if (range === 'month') d.setDate(d.getDate() - 30)
    else d.setDate(d.getDate() - 14)
    return d
  }, [range])

  const filtered = useMemo(() => records.filter(r => {
    if (r.dateObj < cutoff) return false
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (classFilter !== 'all' && r.student.classroom !== classFilter) return false
    if (query) {
      const q = query.toLowerCase()
      if (r.student.name.toLowerCase().includes(q)) return true
      return r.student.parents.some(p => p.phone.includes(q))
    }
    return true
  }).slice(0, 60), [records, cutoff, statusFilter, classFilter, query])

  const saveMemo = (row: AttendanceRecord, text: string, date: string) => {
    setRecords(prev => prev.map(r => r === row ? { ...r, memo: { date, text } } : r))
    setMemoOpen(null)
  }

  const rangeLabel = range === 'week' ? '최근 7일' : range === 'month' ? '최근 30일' : '최근 14일'

  return (
    <div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>출석 기록</h2>
          <p className="text-sm mt-1" style={{ color: '#5B5B5B' }}>기간: {rangeLabel} · {filtered.length}건</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', cursor: 'pointer', fontFamily: 'inherit' }}>
            <Icon name="calendar" size={14} />기간 설정
          </button>
          <button className="h-9 px-3 rounded-lg text-sm font-medium"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', cursor: 'pointer', fontFamily: 'inherit' }}>
            엑셀 내보내기
          </button>
        </div>
      </div>

      <div className="rounded-xl p-3.5 mb-4" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div className="relative flex items-center">
            <span className="absolute left-3 pointer-events-none" style={{ color: '#9A9A9A' }}><Icon name="search" size={14} /></span>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="이름 또는 학부모 번호 검색"
              className="w-full h-10 rounded-lg pl-9 pr-3 text-sm outline-none"
              style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414' }} />
          </div>
          <select value={range} onChange={e => setRange(e.target.value as typeof range)}
            className="h-10 rounded-lg px-3 text-sm cursor-pointer outline-none"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', fontFamily: 'inherit' }}>
            <option value="week">이번 주</option>
            <option value="month">이번 달</option>
            <option value="custom">직접 설정</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 rounded-lg px-3 text-sm cursor-pointer outline-none"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', fontFamily: 'inherit' }}>
            <option value="all">전체 상태</option>
            <option value="in">등원만</option>
            <option value="out">하원 완료</option>
            <option value="absent">결석</option>
          </select>
          <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
            className="h-10 rounded-lg px-3 text-sm cursor-pointer outline-none"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', fontFamily: 'inherit' }}>
            <option value="all">전체 반</option>
            {CLASSROOMS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5 mt-3 flex-wrap text-xs" style={{ color: '#9A9A9A' }}>
          빠른 필터:
          {([['absent', '결석만 보기']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setStatusFilter(v)}
              className="px-2.5 py-1 rounded-full transition-colors"
              style={{
                background: statusFilter === v ? '#141414' : 'transparent',
                color: statusFilter === v ? '#fff' : '#5B5B5B',
                border: `1px solid ${statusFilter === v ? '#141414' : '#EAEAE4'}`,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{l}</button>
          ))}
          <button onClick={() => { setStatusFilter('all'); setClassFilter('all'); setQuery(''); setRange('week') }}
            className="px-2.5 py-1 rounded-full"
            style={{ background: 'transparent', color: '#5B5B5B', border: '1px solid #EAEAE4', cursor: 'pointer', fontFamily: 'inherit' }}>
            초기화
          </button>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 14, minWidth: 820 }}>
            <thead>
              <tr style={{ background: '#F2F2EC', textAlign: 'left' }}>
                {[['날짜', 120], ['학생', 180], ['반', 110], ['상태', 100], ['등원', 90], ['하원', 90], ['보강 메모', 220]].map(([label, w]) => (
                  <th key={label} className="uppercase tracking-widest"
                    style={{ padding: '12px 16px', fontSize: 12, color: '#5B5B5B', fontWeight: 600, width: w, whiteSpace: 'nowrap' }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid #F2F2EC', height: 56 }}>
                  <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                    <p className="text-xs tabular-nums" style={{ color: '#141414' }}>{r.date}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>{r.day}요일</p>
                  </td>
                  <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.student.name}
                        kind={r.status === 'absent' ? 'neutral' : r.status === 'out' ? 'cool' : 'warm'} size={32} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: '#141414' }}>{r.student.name}</p>
                        <p className="text-xs" style={{ color: '#9A9A9A' }}>{r.student.grade}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', verticalAlign: 'middle', fontSize: 13, color: '#141414' }}>
                    {r.student.classroom}
                  </td>
                  <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="tabular-nums text-sm" style={{ padding: '12px 16px', verticalAlign: 'middle', color: r.inTime ? '#141414' : '#C8C8C2' }}>
                    {r.inTime ?? '—'}
                  </td>
                  <td className="tabular-nums text-sm" style={{ padding: '12px 16px', verticalAlign: 'middle', color: r.outTime ? '#141414' : '#C8C8C2' }}>
                    {r.outTime ?? '—'}
                  </td>
                  <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                    {r.status === 'absent' ? (
                      r.memo ? (
                        <button onClick={() => setMemoOpen(r)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                          style={{ background: '#E6F6EE', color: '#1BA974', border: '1px solid #E6F6EE', cursor: 'pointer', fontFamily: 'inherit' }}>
                          <Icon name="check" size={12} strokeWidth={2.4} />{r.memo.date} 보강
                        </button>
                      ) : (
                        <button onClick={() => setMemoOpen(r)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{ background: 'transparent', color: '#141414', border: '1px dashed #EAEAE4', cursor: 'pointer', fontFamily: 'inherit' }}>
                          <Icon name="plus" size={12} strokeWidth={2} />보강 기록하기
                        </button>
                      )
                    ) : (
                      <span className="text-sm" style={{ color: '#C8C8C2' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="text-center py-16 text-sm" style={{ color: '#9A9A9A' }}>필터 조건에 맞는 기록이 없습니다</p>
        )}
      </div>

      {memoOpen && (
        <MemoModal row={memoOpen} onClose={() => setMemoOpen(null)} onSave={saveMemo} />
      )}
    </div>
  )
}
