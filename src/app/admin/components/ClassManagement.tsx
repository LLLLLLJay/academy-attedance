'use client'

// 클래스(반) 관리 화면 — /admin → '클래스 관리' 탭의 본문.
// 목록(검색·요일 칩) + 등록/수정/삭제(모달) + 학생 다중 배정을 한 컴포넌트에서 처리한다.

import { useCallback, useEffect, useMemo, useState } from 'react'

// 0=일 ~ 6=토 — JS Date.getDay()와 동일.
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const

// API 응답 형태 — /api/admin/classes GET 결과와 1:1.
type ClassStudent = { id: string; name: string }
type ClassRow = {
  id: string
  academy_id: string
  name: string
  weekdays: number[]
  created_at: string
  student_count: number
  students: ClassStudent[]
}

// 학생 옵션 — /api/admin/students GET 결과에서 칩 표시에 필요한 필드만 추려 사용.
type StudentOption = { id: string; name: string }

// 모달 입력 폼 형태.
type ClassDraft = {
  id?: string
  name: string
  weekdays: number[]
  student_ids: string[]
}

function Icon({ name, size = 16, strokeWidth = 1.7 }: { name: string; size?: number; strokeWidth?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="M20 20L16 16"/></>,
    plus: <><path d="M12 5V19"/><path d="M5 12H19"/></>,
    edit: <path d="M4 20L4 16L16 4L20 8L8 20Z"/>,
    trash: <><path d="M4 7H20"/><path d="M6 7L7 20H17L18 7"/><path d="M9 7V4H15V7"/></>,
    x: <><path d="M6 6L18 18"/><path d="M18 6L6 18"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14c3 0 6 2 6 6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M3 10h18"/></>,
    check: <path d="M5 12l5 5L20 7"/>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

// 요일 chip — 클릭으로 토글되는 작은 버튼. select 모드만 지원 (가독성용 read-only는 WeekdayBadges).
function WeekdayPicker({ value, onChange }: {
  value: number[]
  onChange: (next: number[]) => void
}) {
  const set = new Set(value)
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAY_LABELS.map((label, i) => {
        const active = set.has(i)
        return (
          <button
            key={i}
            type="button"
            onClick={() => {
              const next = new Set(set)
              if (next.has(i)) next.delete(i)
              else next.add(i)
              onChange(Array.from(next).sort((a, b) => a - b))
            }}
            className="h-9 w-9 rounded-lg text-sm font-bold flex items-center justify-center"
            style={{
              background: active ? '#141414' : '#F2F2EC',
              color: active ? '#fff' : '#5B5B5B',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// 읽기 전용 요일 뱃지 — 카드/테이블에서 클래스의 수업 요일을 컴팩트하게 표시.
// why: WeekdayPicker는 토글 가능한 입력용, 이건 정보 표시용으로 톤을 분리.
function WeekdayBadges({ weekdays }: { weekdays: number[] }) {
  if (weekdays.length === 0) {
    return <span className="text-xs" style={{ color: '#9A9A9A' }}>휴강</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {weekdays.map((w) => (
        <span
          key={w}
          className="inline-flex items-center justify-center text-xs font-bold rounded"
          style={{
            width: 22, height: 22,
            background: '#E9F0FF', color: '#2B6CFF',
          }}
        >
          {WEEKDAY_LABELS[w]}
        </span>
      ))}
    </div>
  )
}

// 학생 다중 선택 — 검색 + 체크박스. 모달 안에서 사용.
function StudentMultiSelect({ all, selected, onToggle }: {
  all: StudentOption[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return all
    return all.filter((s) => s.name.toLowerCase().includes(t))
  }, [all, q])

  return (
    <div>
      <div className="relative mb-2">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#9A9A9A' }}>
          <Icon name="search" size={14} />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="학생 이름 검색"
          className="w-full h-10 rounded-lg pl-9 pr-3 text-sm outline-none"
          style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', boxSizing: 'border-box' }}
        />
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #EAEAE4', maxHeight: 240, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="text-xs text-center py-8" style={{ color: '#9A9A9A' }}>
            {all.length === 0 ? '등록된 학생이 없습니다' : '검색 결과가 없습니다'}
          </div>
        ) : (
          filtered.map((s, i) => {
            const checked = selected.has(s.id)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onToggle(s.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid #F2F2EC',
                  background: checked ? '#FAFAF7' : '#fff',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <span
                  className="inline-flex items-center justify-center rounded"
                  style={{
                    width: 18, height: 18, flexShrink: 0,
                    background: checked ? '#141414' : '#fff',
                    color: '#fff',
                    border: `1px solid ${checked ? '#141414' : '#EAEAE4'}`,
                  }}
                >
                  {checked && <Icon name="check" size={12} strokeWidth={3} />}
                </span>
                <span className="text-sm" style={{ color: '#141414' }}>{s.name}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function ClassModal({ initial, allStudents, onClose, onSave, onDelete, busy }: {
  initial: ClassRow | null
  allStudents: StudentOption[]
  onClose: () => void
  onSave: (draft: ClassDraft) => Promise<void>
  onDelete: (c: ClassRow) => Promise<void>
  busy: boolean
}) {
  const [form, setForm] = useState<ClassDraft>(() =>
    initial
      ? {
          id: initial.id,
          name: initial.name,
          weekdays: [...initial.weekdays],
          student_ids: initial.students.map((s) => s.id),
        }
      : { name: '', weekdays: [], student_ids: [] },
  )

  const selected = useMemo(() => new Set(form.student_ids), [form.student_ids])

  const toggleStudent = (id: string) => {
    setForm((prev) => {
      const next = new Set(prev.student_ids)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...prev, student_ids: Array.from(next) }
    })
  }

  const canSave = Boolean(form.name.trim()) && !busy

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(10,10,10,0.45)' }}
      onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-lg rounded-2xl flex flex-col"
        style={{ background: '#fff', border: '1px solid #EAEAE4', boxShadow: '0 30px 80px -10px rgba(0,0,0,0.25)', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 flex-shrink-0" style={{ borderBottom: '1px solid #F2F2EC' }}>
          <div>
            <p className="text-xs font-semibold" style={{ color: '#9A9A9A' }}>{initial ? '클래스 수정' : '새 클래스 등록'}</p>
            <p className="text-xl font-bold mt-1" style={{ color: '#141414' }}>{initial ? initial.name : '신규 클래스'}</p>
          </div>
          <button onClick={onClose} disabled={busy} className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ background: 'transparent', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: '#9A9A9A' }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>클래스 이름</label>
            <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="예: 초등 영어 A반"
              className="w-full h-10 rounded-lg px-3 text-sm outline-none"
              style={{ border: '1px solid #EAEAE4', color: '#141414', boxSizing: 'border-box' }} />
          </div>

          <div className="mt-5">
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>수업 요일</label>
            <p className="text-xs mb-2" style={{ color: '#9A9A9A' }}>
              매주 수업하는 요일을 모두 선택하세요. 미선택 = 휴강.
            </p>
            <WeekdayPicker
              value={form.weekdays}
              onChange={(next) => setForm((p) => ({ ...p, weekdays: next }))}
            />
          </div>

          <div className="mt-5 pt-5" style={{ borderTop: '1px solid #F2F2EC' }}>
            <div className="flex items-center justify-between mb-2.5">
              <div>
                <p className="text-sm font-bold" style={{ color: '#141414' }}>소속 학생</p>
                <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>
                  여러 반에 동시에 속할 수 있어요. 활성 학생만 선택 가능.
                </p>
              </div>
              <span className="text-xs font-semibold" style={{ color: '#5B5B5B' }}>
                선택 {form.student_ids.length}명
              </span>
            </div>
            <StudentMultiSelect all={allStudents} selected={selected} onToggle={toggleStudent} />
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-3.5 flex-shrink-0"
          style={{ borderTop: '1px solid #F2F2EC', background: '#F2F2EC' }}>
          {initial ? (
            <button onClick={() => onDelete(initial)} disabled={busy}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm"
              style={{ background: '#fff', color: '#E5484D', border: '1px solid #EAEAE4', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.5 : 1 }}>
              <Icon name="trash" size={13} />클래스 삭제
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={busy} className="h-9 px-4 rounded-lg text-sm font-medium"
              style={{ background: 'transparent', color: '#5B5B5B', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>취소</button>
            <button onClick={() => onSave(form)} disabled={!canSave}
              className="h-9 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#141414', border: 'none', cursor: canSave ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
              {busy ? '처리 중...' : initial ? '저장' : '등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ClassManagement() {
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [students, setStudents] = useState<StudentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<ClassRow | { _new: true } | null>(null)
  const [saving, setSaving] = useState(false)

  // 클래스 + 학생을 함께 받아 모달 학생 셀렉터에 즉시 사용 — 라운드트립 절감.
  const reload = useCallback(async () => {
    try {
      const [classRes, studentRes] = await Promise.all([
        fetch('/api/admin/classes', { cache: 'no-store' }),
        fetch('/api/admin/students', { cache: 'no-store' }),
      ])
      if (!classRes.ok) {
        const body = await classRes.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${classRes.status}`)
      }
      if (!studentRes.ok) {
        const body = await studentRes.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${studentRes.status}`)
      }
      const classBody = (await classRes.json()) as { classes: ClassRow[] }
      const studentBody = (await studentRes.json()) as {
        students: { id: string; name: string }[]
      }
      setClasses(classBody.classes)
      setStudents(studentBody.students.map((s) => ({ id: s.id, name: s.name })))
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '클래스 정보를 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [classRes, studentRes] = await Promise.all([
          fetch('/api/admin/classes', { cache: 'no-store' }),
          fetch('/api/admin/students', { cache: 'no-store' }),
        ])
        if (cancelled) return
        if (!classRes.ok) {
          const body = await classRes.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${classRes.status}`)
        }
        if (!studentRes.ok) {
          const body = await studentRes.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${studentRes.status}`)
        }
        const classBody = (await classRes.json()) as { classes: ClassRow[] }
        const studentBody = (await studentRes.json()) as {
          students: { id: string; name: string }[]
        }
        if (cancelled) return
        setClasses(classBody.classes)
        setStudents(studentBody.students.map((s) => ({ id: s.id, name: s.name })))
        setLoadError(null)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '클래스 정보를 불러오지 못했습니다')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return classes
    return classes.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true
      return c.students.some((s) => s.name.toLowerCase().includes(q))
    })
  }, [classes, query])

  const onSave = async (draft: ClassDraft) => {
    setSaving(true)
    try {
      const isUpdate = Boolean(draft.id)
      const url = isUpdate ? `/api/admin/classes/${draft.id}` : '/api/admin/classes'
      const res = await fetch(url, {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          weekdays: draft.weekdays,
          student_ids: draft.student_ids,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      await reload()
      setEditing(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : '저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (c: ClassRow) => {
    if (!confirm(`"${c.name}" 클래스를 삭제하시겠습니까?\n소속 학생 ${c.student_count}명의 배정도 함께 해제됩니다.`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/classes/${c.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      await reload()
      setEditing(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  const totalCount = classes.length

  return (
    <div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>클래스 관리</h2>
          <p className="text-sm mt-1" style={{ color: '#5B5B5B' }}>
            전체 <b style={{ color: '#141414' }}>{totalCount}</b>개 반
          </p>
        </div>
        <button onClick={() => setEditing({ _new: true })}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold text-white"
          style={{ background: '#141414', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Icon name="plus" size={14} />클래스 등록
        </button>
      </div>

      <div className="rounded-xl p-3.5 mb-4" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="relative flex items-center">
          <span className="absolute left-3 pointer-events-none" style={{ color: '#9A9A9A' }}><Icon name="search" size={14} /></span>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="반 이름 · 학생 이름 검색"
            className="w-full h-10 rounded-lg pl-9 pr-3 text-sm outline-none"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414' }} />
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl p-3.5 mb-4 text-sm"
          style={{ background: '#FDECEC', border: '1px solid rgba(229,72,77,0.2)', color: '#E5484D' }}>
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl px-5 py-10 text-sm text-center"
          style={{ background: '#fff', border: '1px solid #EAEAE4', color: '#9A9A9A' }}>
          불러오는 중...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl"
          style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
          <div className="flex flex-col items-center gap-3" style={{ padding: '80px 20px' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: '#F2F2EC', color: '#9A9A9A' }}>
              <Icon name="calendar" size={26} />
            </div>
            <div className="text-base font-bold" style={{ color: '#141414' }}>
              {classes.length === 0 ? '등록된 클래스가 없습니다' : '검색 결과가 없습니다'}
            </div>
            <div className="text-sm" style={{ color: '#9A9A9A' }}>
              {classes.length === 0
                ? '우측 상단 [클래스 등록]으로 첫 반을 추가해 보세요.'
                : '다른 검색어를 입력해 보세요.'}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setEditing(c)}
              className="rounded-xl p-4 text-left flex flex-col gap-3"
              style={{
                background: '#fff', border: '1px solid #EAEAE4',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-bold truncate" style={{ color: '#141414' }}>{c.name}</p>
                  <div className="flex items-center gap-1.5 mt-1" style={{ color: '#5B5B5B' }}>
                    <Icon name="users" size={12} />
                    <span className="text-xs">{c.student_count}명</span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-xs font-medium"
                  style={{ background: 'transparent', color: '#5B5B5B', border: '1px solid #EAEAE4' }}>
                  <Icon name="edit" size={11} />수정
                </span>
              </div>
              <div>
                <WeekdayBadges weekdays={c.weekdays} />
              </div>
              {c.students.length > 0 && (
                <div>
                  <div className="flex flex-wrap gap-1">
                    {c.students.slice(0, 6).map((s) => (
                      <span key={s.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs"
                        style={{ background: '#F2F2EC', color: '#5B5B5B' }}>
                        {s.name}
                      </span>
                    ))}
                    {c.students.length > 6 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs"
                        style={{ background: 'transparent', color: '#9A9A9A' }}>
                        +{c.students.length - 6}명
                      </span>
                    )}
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {editing && '_new' in editing ? (
        <ClassModal initial={null} allStudents={students}
          onClose={() => setEditing(null)} onSave={onSave} onDelete={onDelete} busy={saving} />
      ) : editing ? (
        <ClassModal initial={editing} allStudents={students}
          onClose={() => setEditing(null)} onSave={onSave} onDelete={onDelete} busy={saving} />
      ) : null}
    </div>
  )
}
