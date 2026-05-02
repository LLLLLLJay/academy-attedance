'use client'

import { useEffect, useMemo, useState } from 'react'

// API 응답 형태 — /api/admin/absences GET 결과와 1:1 매칭.
// absence_log_id가 null이면 아직 absent row가 없다는 뜻 → 저장 시 INSERT.
// memo_created_at은 absent row의 created_at(ISO timestamptz). API의 UPDATE 분기가
// 이 값을 함께 갱신해 화면의 "작성일 YYYY.MM.DD"가 최근 작성 시점을 가리킨다.
type AbsenceRow = {
  student_id: string
  student_name: string
  date: string // 'YYYY-MM-DD' (KST)
  absence_log_id: string | null
  memo: string | null
  memo_created_at: string | null
}

// 기간 필터 — 디자인의 select 옵션과 동일.
// why: 데이터가 학원 개원일부터 누적되므로 기본값 'all'. '오늘'/'최근 7일'은 KST 기준.
type Range = 'all' | 'today' | 'week'

function Icon({ name, size = 16, strokeWidth = 1.7 }: { name: string; size?: number; strokeWidth?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="M20 20L16 16"/></>,
    alert: <><path d="M12 3L22 20H2Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/></>,
    note: <><path d="M5 4H15L19 8V20H5Z"/><path d="M15 4V8H19"/><path d="M8 12H16"/><path d="M8 16H14"/></>,
    edit: <><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></>,
    chevronDown: <path d="M6 9l6 6 6-6"/>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

// 'YYYY-MM-DD' → "YYYY.MM.DD (요일)" 한국어 표기.
// why: 다른 화면(AttendanceTable formatChecked)과 시각적 일관성 유지.
function formatDate(dateStr: string): { display: string; day: string } {
  const [y, m, d] = dateStr.split('-').map(Number)
  // local Date로 만들어 요일을 뽑되, 표시 자체는 입력 문자열 그대로 → KST 해석 차이 없음.
  const date = new Date(y, m - 1, d)
  const day = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()]
  return {
    display: `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`,
    day,
  }
}

// ISO timestamptz → "YYYY.MM.DD" — 보강 메모 작성일 표시용.
// 학원 사용자는 KST이므로 브라우저 로컬 = KST로 안전하게 변환.
function formatMemoDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

// 'YYYY-MM-DD' → 로컬 자정 Date — 기간 필터 비교에 쓰는 day-only 키.
function dateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// 행 단위 상태 — 사용자가 입력한 메모 초안 + 편집 모드 + 저장 진행 플래그.
// why: 한 페이지에 결석 행이 수십~수백 개라 행마다 별도 컴포넌트로 분리하면
//      재렌더링이 잦아진다. AbsenceManagement에서 Map 한 곳으로 관리.
type RowDraftMap = Record<string, string>
type RowFlagMap = Record<string, boolean>

// (학생, 날짜) 조합 키 — 행 식별자. absence_log_id는 INSERT 전엔 null이라 키로 쓸 수 없다.
const rowKey = (r: AbsenceRow) => `${r.student_id}::${r.date}`

export default function AbsenceManagement() {
  const [rows, setRows] = useState<AbsenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<RowDraftMap>({})
  const [editing, setEditing] = useState<RowFlagMap>({})
  const [busy, setBusy] = useState<RowFlagMap>({})
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<Range>('all')

  // 최초 로딩 — /api/admin/absences GET.
  // why: 결석 데이터는 학생 추가/등원 입력에 따라 변하므로 cache: 'no-store'로 항상 최신.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/absences', { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        const body = (await res.json()) as { absences: AbsenceRow[] }
        if (cancelled) return
        setRows(body.absences)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '결석 내역을 불러오지 못했습니다')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 기간 필터 경계값 — KST 기준 오늘/7일전 자정 Date.
  // why: 사용자 브라우저 로컬을 KST로 가정(학원 운영은 모두 KST). today는 매 렌더 새로 계산해도
  //      비용이 미미하지만 useMemo로 묶어 deps 명시.
  const { today, weekAgo } = useMemo(() => {
    const now = new Date()
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const w = new Date(t)
    w.setDate(w.getDate() - 6)
    return { today: t, weekAgo: w }
  }, [])

  // 검색 + 기간 필터.
  // why: 검색은 학생 이름 substring, 기간은 today/week/all. 둘 다 클라이언트에서 처리.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (q && !r.student_name.toLowerCase().includes(q)) return false
      if (range === 'all') return true
      const d = dateOnly(r.date)
      if (range === 'today') return d.getTime() === today.getTime()
      if (range === 'week') return d.getTime() >= weekAgo.getTime() && d.getTime() <= today.getTime()
      return true
    })
  }, [rows, search, range, today, weekAgo])

  // 지표 — 선택된 기간 내(검색은 무시) 결석 인원 / 보강 메모 미등록 인원.
  // why: 디자인 사양상 학생 단위 unique 카운트(같은 학생이 여러 날 결석해도 1명).
  //      검색을 무시하는 이유는 "이 기간의 전체 현황"을 보여주는 KPI이므로.
  const stats = useMemo(() => {
    const inRange = rows.filter((r) => {
      if (range === 'all') return true
      const d = dateOnly(r.date)
      if (range === 'today') return d.getTime() === today.getTime()
      if (range === 'week') return d.getTime() >= weekAgo.getTime() && d.getTime() <= today.getTime()
      return true
    })
    const absentIds = new Set(inRange.map((r) => r.student_id))
    const missingMemoIds = new Set(inRange.filter((r) => !r.absence_log_id).map((r) => r.student_id))
    return { absent: absentIds.size, missing: missingMemoIds.size }
  }, [rows, range, today, weekAgo])

  // 헤더 서브타이틀에 쓰는 전체 카운트 — 기간 필터와 무관한 누적 통계.
  const totalCount = rows.length
  const memoCount = rows.filter((r) => r.absence_log_id).length

  const rangeLabel = range === 'all' ? '전체 기간' : range === 'today' ? '오늘' : '최근 7일'

  // 저장 핸들러 — POST /api/admin/absences.
  // 성공 시 rows의 해당 행만 새 absence_log_id/memo/memo_created_at으로 갱신해 재조회 없이 반영.
  const onSave = async (row: AbsenceRow) => {
    const key = rowKey(row)
    if (busy[key]) return
    const memo = (drafts[key] ?? '').trim()
    if (!memo) return // 빈 메모는 저장하지 않음 — 디자인 동작과 동일.
    setBusy((b) => ({ ...b, [key]: true }))
    try {
      const res = await fetch('/api/admin/absences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: row.student_id,
          date: row.date,
          memo,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as {
        absence_log_id: string
        memo: string | null
        memo_created_at: string | null
      }
      // 응답 결과를 해당 row에 즉시 반영 — 페이지 전체 재조회 회피.
      setRows((prev) =>
        prev.map((r) =>
          rowKey(r) === key
            ? {
                ...r,
                absence_log_id: body.absence_log_id,
                memo: body.memo,
                memo_created_at: body.memo_created_at,
              }
            : r,
        ),
      )
      // 편집 모드 종료 + draft 정리 — 다음 수정 진입 시 기존 메모를 다시 채우기 위함.
      setEditing((e) => ({ ...e, [key]: false }))
      setDrafts((d) => {
        const n = { ...d }
        delete n[key]
        return n
      })
    } catch (err) {
      // 실패 시 alert로 노출 — 행 단위 인라인 에러 박스를 만드는 것보다 단순.
      console.error('[absences] save failed:', err)
      alert(`저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`)
    } finally {
      setBusy((b) => ({ ...b, [key]: false }))
    }
  }

  // 편집 모드 진입 — 기존 메모를 draft 초기값으로 채워 input에서 바로 수정 가능.
  const onEdit = (row: AbsenceRow) => {
    const key = rowKey(row)
    setEditing((e) => ({ ...e, [key]: true }))
    setDrafts((d) => ({ ...d, [key]: row.memo ?? '' }))
  }

  // 편집 취소 — draft 폐기 + 디스플레이 모드 복귀. 저장된 메모가 있을 때만 의미 있음.
  const onCancelEdit = (row: AbsenceRow) => {
    const key = rowKey(row)
    setEditing((e) => ({ ...e, [key]: false }))
    setDrafts((d) => {
      const n = { ...d }
      delete n[key]
      return n
    })
  }

  return (
    <div>
      {/* 헤더 — 제목과 누적 카운트 요약 */}
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>
            결석 관리
          </h2>
          <p className="text-sm mt-1" style={{ color: '#5B5B5B' }}>
            전체 결석 <b style={{ color: '#141414' }}>{totalCount}</b>건 ·
            메모 <b style={{ color: '#141414' }}>{memoCount}</b>건 ·
            미작성 <b style={{ color: '#141414' }}>{totalCount - memoCount}</b>건
          </p>
        </div>
      </div>

      {/* 필터 카드 — 검색 + 기간 select */}
      <div className="rounded-xl p-3.5 mb-4" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: 'minmax(220px, 2fr) minmax(140px, 1fr)' }}
        >
          <div className="flex items-center gap-2 rounded-lg px-3 h-10"
            style={{ background: '#F2F2EC' }}>
            <Icon name="search" size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="학생 이름 검색"
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: '#141414', fontFamily: 'inherit' }}
            />
          </div>
          {/* 기간 select — 네이티브 select에 chevron 아이콘 오버레이 */}
          <div className="relative">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as Range)}
              className="w-full h-10 rounded-lg pl-3 pr-9 text-sm outline-none appearance-none"
              style={{
                background: '#F2F2EC', color: '#141414', border: 'none',
                fontFamily: 'inherit',
              }}
            >
              <option value="all">전체 기간</option>
              <option value="today">오늘</option>
              <option value="week">최근 7일</option>
            </select>
            <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: '#5B5B5B' }}>
              <Icon name="chevronDown" size={14} />
            </span>
          </div>
        </div>
      </div>

      {/* 지표 카드 2개 — 결석 인원 / 보강 메모 미등록 (기간 라벨 동적) */}
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
      >
        <StatCard
          label={`${rangeLabel} 결석 인원`}
          value={stats.absent}
          tone="danger"
          iconName="alert"
        />
        <StatCard
          label={`${rangeLabel} 메모 미등록`}
          value={stats.missing}
          tone="warn"
          iconName="note"
        />
      </div>

      {/* 본문 — 로딩/에러/빈/데이터 분기 */}
      {error ? (
        <div className="rounded-xl px-5 py-10 text-sm text-center"
          style={{ background: '#fff', border: '1px solid #EAEAE4', color: '#E5484D' }}>
          {error}
        </div>
      ) : loading ? (
        <div className="rounded-xl px-5 py-10 text-sm text-center"
          style={{ background: '#fff', border: '1px solid #EAEAE4', color: '#9A9A9A' }}>
          불러오는 중...
        </div>
      ) : filteredRows.length === 0 ? (
        <EmptyCard hasFilter={!!search.trim() || range !== 'all'} />
      ) : (
        <div className="rounded-xl overflow-hidden"
          style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ background: '#FAFAF7' }}>
                  <th style={thStyle(160)}>날짜</th>
                  <th style={thStyle(200)}>학생 이름</th>
                  <th style={thStyle()}>메모</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const key = rowKey(row)
                  const f = formatDate(row.date)
                  const draft = drafts[key] ?? ''
                  const isEditing = editing[key] ?? false
                  const isBusy = busy[key] ?? false
                  // 저장된 메모가 있고 편집 모드가 아니면 디스플레이 모드.
                  const isSaved = !!row.absence_log_id && !!row.memo && !isEditing
                  const trimmed = draft.trim()
                  return (
                    <tr key={key} style={{ borderTop: '1px solid #F2F2EC' }}>
                      {/* 날짜 */}
                      <td style={tdStyle()}>
                        <div className="tabular-nums" style={{ fontWeight: 600, color: '#141414' }}>
                          {f.display}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>
                          {f.day}요일
                        </div>
                      </td>
                      {/* 학생 이름 (학년/반은 DB에 없어 생략 — README와 어긋나지만 사용자 결정) */}
                      <td style={tdStyle()}>
                        <div className="text-sm font-semibold truncate" style={{ color: '#141414' }}>
                          {row.student_name}
                        </div>
                      </td>
                      {/* 보강 메모 — 저장됨 / 편집중 분기 */}
                      <td style={tdStyle()}>
                        {isSaved ? (
                          <div className="flex items-start gap-2.5">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm whitespace-pre-wrap break-words"
                                style={{ color: '#141414', lineHeight: 1.5 }}>
                                {row.memo}
                              </div>
                              {row.memo_created_at && (
                                <div className="text-xs mt-1 tabular-nums"
                                  style={{ color: '#9A9A9A' }}>
                                  작성일 {formatMemoDate(row.memo_created_at)}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => onEdit(row)}
                              className="h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1"
                              style={{
                                background: 'transparent', color: '#5B5B5B',
                                border: '1px solid #EAEAE4', cursor: 'pointer', fontFamily: 'inherit',
                              }}
                            >
                              <Icon name="edit" size={12} />
                              수정
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              value={draft}
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [key]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') onSave(row)
                                else if (e.key === 'Escape' && isEditing) onCancelEdit(row)
                              }}
                              placeholder="보강 일정 / 진행 내용 입력"
                              className="flex-1 rounded-lg px-3 text-sm outline-none"
                              style={{
                                height: 38,
                                background: '#fff',
                                border: '1px solid #EAEAE4',
                                color: '#141414',
                                fontFamily: 'inherit',
                              }}
                            />
                            <button
                              onClick={() => onSave(row)}
                              disabled={!trimmed || isBusy}
                              className="h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center"
                              style={{
                                background: trimmed && !isBusy ? '#141414' : '#EAEAE4',
                                color: trimmed && !isBusy ? '#fff' : '#9A9A9A',
                                border: 'none',
                                cursor: trimmed && !isBusy ? 'pointer' : 'not-allowed',
                                fontFamily: 'inherit',
                              }}
                            >
                              {isBusy ? '저장 중' : '저장'}
                            </button>
                            {isEditing && (
                              <button
                                onClick={() => onCancelEdit(row)}
                                className="h-8 px-3 rounded-lg text-xs font-semibold"
                                style={{
                                  background: 'transparent', color: '#5B5B5B',
                                  border: '1px solid #EAEAE4', cursor: 'pointer', fontFamily: 'inherit',
                                }}
                              >
                                취소
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// 지표 카드 — 결석 인원/메모 미등록을 톤별 색상으로 강조.
function StatCard({ label, value, tone, iconName }: {
  label: string; value: number; tone: 'danger' | 'warn'; iconName: string
}) {
  const tones = {
    danger: { bg: '#FDECEC', fg: '#E5484D' },
    warn: { bg: '#FDF3DC', fg: '#9A6B00' },
  }[tone]
  return (
    <div className="rounded-xl p-4 flex items-center gap-3.5"
      style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
      <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: tones.bg, color: tones.fg }}>
        <Icon name={iconName} size={22} strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium" style={{ color: '#5B5B5B' }}>{label}</div>
        <div className="text-2xl font-extrabold mt-0.5 tabular-nums tracking-tight"
          style={{ color: '#141414' }}>
          {value}
          <span className="text-sm font-semibold ml-1" style={{ color: '#9A9A9A' }}>명</span>
        </div>
      </div>
    </div>
  )
}

// 빈 상태 카드 — 필터로 좁혀 0건일 때와 데이터 자체가 없을 때 메시지를 분기.
function EmptyCard({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="rounded-xl"
      style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
      <div className="flex flex-col items-center gap-3" style={{ padding: '80px 20px' }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: '#F2F2EC', color: '#9A9A9A' }}>
          <Icon name="note" size={26} />
        </div>
        <div className="text-base font-bold" style={{ color: '#141414' }}>
          {hasFilter ? '조건에 맞는 결석 기록이 없습니다' : '결석 기록이 없습니다'}
        </div>
        <div className="text-sm" style={{ color: '#9A9A9A' }}>
          {hasFilter
            ? '검색어나 기간을 변경해보세요.'
            : '결석이 발생하면 이곳에서 메모를 남길 수 있어요.'}
        </div>
      </div>
    </div>
  )
}

// 테이블 셀 스타일 — 디자인의 absencesThStyle/absencesTdStyle을 그대로 옮김.
function thStyle(width?: number): React.CSSProperties {
  return {
    textAlign: 'left',
    padding: '14px 20px',
    fontSize: 12,
    fontWeight: 600,
    color: '#5B5B5B',
    borderBottom: '1px solid #EAEAE4',
    width: width ?? 'auto',
    whiteSpace: 'nowrap',
  }
}

function tdStyle(): React.CSSProperties {
  return {
    padding: '14px 20px',
    fontSize: 14,
    color: '#141414',
    verticalAlign: 'top',
  }
}
