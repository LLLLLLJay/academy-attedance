'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

// 보호자 역할 드롭다운 옵션 — DB에 별도 컬럼이 없으므로 UI 상수로만 사용.
// 학교/학원 행정 표준 용어로 통일. "보호자"는 할머니·할아버지·이모 등 비부모 가족까지 포괄.
// 기존 데이터의 "엄마/아빠/할머니"는 DB에 그대로 남으며, 모달에서 select가 첫 옵션(어머니)로
// fallback 표시될 뿐 사용자가 select를 직접 건드리지 않으면 저장 시 원본 값이 유지된다.
const PARENT_ROLES = ['어머니', '아버지', '보호자'] as const

// API 응답 형태 — /api/admin/students 라우트와 1:1 매칭.
// phone_last4는 DB의 generated column이라 클라이언트에서 직접 만들지 않고 응답에서만 받는다.
type ParentRow = {
  id: string
  name: string | null
  phone: string
  phone_last4: string
  is_primary: boolean
}

// 클래스 칩 — /api/admin/students 응답에 포함되는 학생-클래스 평탄 배열.
// 학생 카드/모달에서 "어느 반에 속해 있는지" 한눈에 보여주기 위함.
type ClassChip = { id: string; name: string; weekdays: number[] }

type StudentRow = {
  id: string
  academy_id: string
  name: string
  is_active: boolean
  created_at: string
  parents: ParentRow[]
  classes: ClassChip[]
}

// 모달이 다루는 학부모 입력 폼 형태.
// id가 옵셔널인 이유: 새로 추가된 행은 아직 DB id가 없고, 저장 시 PATCH/POST 본문에는 id를 넣지 않아도 됨.
type ParentDraft = {
  id?: string
  name: string
  phone: string
  phone_last4: string
  is_primary: boolean
}

type StudentDraft = {
  id?: string
  name: string
  is_active: boolean
  parents: ParentDraft[]
}

function Icon({ name, size = 16, strokeWidth = 1.7 }: { name: string; size?: number; strokeWidth?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="M20 20L16 16"/></>,
    plus: <><path d="M12 5V19"/><path d="M5 12H19"/></>,
    edit: <path d="M4 20L4 16L16 4L20 8L8 20Z"/>,
    trash: <><path d="M4 7H20"/><path d="M6 7L7 20H17L18 7"/><path d="M9 7V4H15V7"/></>,
    x: <><path d="M6 6L18 18"/><path d="M18 6L6 18"/></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)}
      className="relative flex-shrink-0"
      style={{ width: 44, height: 24, borderRadius: 999, background: value ? '#1BA974' : '#EAEAE4', border: 'none', cursor: 'pointer', transition: 'background 180ms' }}>
      <span className="absolute top-0.5 rounded-full transition-all duration-150"
        style={{ width: 20, height: 20, background: '#fff', left: value ? 22 : 2, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }} />
    </button>
  )
}

// created_at(timestamptz ISO) → "YYYY.MM.DD" 표시 형식.
// DB 스키마엔 별도 등록일 컬럼이 없어 created_at에서 파생.
function formatJoined(iso: string): string {
  const d = new Date(iso)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const date = String(d.getDate()).padStart(2, '0')
  return `${year}.${month}.${date}`
}

function ParentRowEditor({ parent, onUpdate, onRemove, onSetPrimary, canRemove }: {
  parent: ParentDraft
  onUpdate: (patch: Partial<ParentDraft>) => void
  onRemove: () => void
  onSetPrimary: () => void
  canRemove: boolean
}) {
  return (
    <div className="flex gap-2.5 items-start p-3 rounded-xl"
      style={{ border: `1px solid ${parent.is_primary ? '#141414' : '#EAEAE4'}`, background: parent.is_primary ? '#F2F2EC' : '#fff' }}>
      <select value={(PARENT_ROLES as readonly string[]).includes(parent.name) ? parent.name : PARENT_ROLES[0]}
        onChange={e => onUpdate({ name: e.target.value })}
        className="h-10 rounded-lg px-2 text-sm cursor-pointer outline-none flex-shrink-0"
        style={{ width: 92, border: '1px solid #EAEAE4', background: '#fff', color: '#141414', fontFamily: 'inherit' }}>
        {PARENT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <div className="flex-1 min-w-0">
        <input value={parent.phone} onChange={e => onUpdate({ phone: e.target.value, phone_last4: e.target.value.replace(/\D/g, '').slice(-4) })}
          placeholder="010-0000-0000"
          className="w-full h-10 rounded-lg px-3 text-sm tabular-nums outline-none"
          style={{ border: '1px solid #EAEAE4', color: '#141414', boxSizing: 'border-box' }} />
        {parent.phone_last4.length === 4 && (
          <p className="text-xs mt-1 tabular-nums" style={{ color: '#9A9A9A', fontFamily: 'monospace' }}>뒷자리: {parent.phone_last4}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5 items-end flex-shrink-0">
        <button onClick={onSetPrimary}
          className="px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
          style={{ background: parent.is_primary ? '#141414' : 'transparent', color: parent.is_primary ? '#fff' : '#5B5B5B', border: `1px solid ${parent.is_primary ? '#141414' : '#EAEAE4'}`, cursor: 'pointer', fontFamily: 'inherit' }}>
          {parent.is_primary ? '대표' : '대표 지정'}
        </button>
        {canRemove && (
          <button onClick={onRemove}
            className="px-2 py-1 rounded text-xs"
            style={{ background: 'transparent', color: '#E5484D', border: '1px solid #EAEAE4', cursor: 'pointer', fontFamily: 'inherit' }}>삭제</button>
        )}
      </div>
    </div>
  )
}

function StudentModal({ student, onClose, onSave, onDelete, busy }: {
  student: StudentRow | null
  onClose: () => void
  onSave: (draft: StudentDraft) => Promise<void>
  onDelete: (s: StudentRow) => Promise<void>
  busy: boolean
}) {
  const [form, setForm] = useState<StudentDraft>(() =>
    student
      ? {
          id: student.id,
          name: student.name,
          is_active: student.is_active,
          parents: student.parents.map(p => ({
            id: p.id,
            name: p.name ?? PARENT_ROLES[0],
            phone: p.phone,
            phone_last4: p.phone_last4,
            is_primary: p.is_primary,
          })),
        }
      : {
          name: '',
          is_active: true,
          parents: [{ name: PARENT_ROLES[0], phone: '', phone_last4: '', is_primary: true }],
        },
  )

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(prev => ({ ...prev, [k]: v }))

  const updateParent = (idx: number, patch: Partial<ParentDraft>) => {
    setForm(prev => ({
      ...prev,
      parents: prev.parents.map((p, i) => i !== idx ? p : { ...p, ...patch }),
    }))
  }

  const addParent = () => setForm(prev => ({
    ...prev,
    parents: [...prev.parents, { name: PARENT_ROLES[prev.parents.length] ?? PARENT_ROLES[0], phone: '', phone_last4: '', is_primary: false }],
  }))

  const removeParent = (idx: number) => setForm(prev => {
    const next = prev.parents.filter((_, i) => i !== idx)
    if (next.length > 0 && !next.some(p => p.is_primary)) next[0].is_primary = true
    return { ...prev, parents: next }
  })

  const setPrimary = (idx: number) => setForm(prev => ({
    ...prev,
    parents: prev.parents.map((p, i) => ({ ...p, is_primary: i === idx })),
  }))

  const canSave = Boolean(form.name.trim()) && form.parents.length > 0 && form.parents.every(p => p.phone && p.phone_last4.length === 4)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(10,10,10,0.45)' }}
      onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-lg rounded-2xl flex flex-col"
        style={{ background: '#fff', border: '1px solid #EAEAE4', boxShadow: '0 30px 80px -10px rgba(0,0,0,0.25)', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 flex-shrink-0" style={{ borderBottom: '1px solid #F2F2EC' }}>
          <div>
            <p className="text-xs font-semibold" style={{ color: '#9A9A9A' }}>{student ? '학생 정보 수정' : '새 학생 등록'}</p>
            <p className="text-xl font-bold mt-1" style={{ color: '#141414' }}>{student ? student.name : '신규 학생'}</p>
          </div>
          <button onClick={onClose} disabled={busy} className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ background: 'transparent', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: '#9A9A9A' }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>이름</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              className="w-full h-10 rounded-lg px-3 text-sm outline-none"
              style={{ border: '1px solid #EAEAE4', color: '#141414', boxSizing: 'border-box' }} />
          </div>

          <div className="mt-5 pt-5" style={{ borderTop: '1px solid #F2F2EC' }}>
            <div className="flex items-center justify-between mb-2.5">
              <div>
                <p className="text-sm font-bold" style={{ color: '#141414' }}>학부모 연락처</p>
                <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>뒷자리 4자리로 학생이 검색됩니다 · 대표 연락처는 알림톡 우선 발송</p>
              </div>
              <button onClick={addParent}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium"
                style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', cursor: 'pointer', fontFamily: 'inherit' }}>
                <Icon name="plus" size={13} />연락처 추가
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              {form.parents.map((p, i) => (
                <ParentRowEditor key={p.id ?? `new-${i}`} parent={p}
                  onUpdate={patch => updateParent(i, patch)}
                  onRemove={() => removeParent(i)}
                  onSetPrimary={() => setPrimary(i)}
                  canRemove={form.parents.length > 1} />
              ))}
            </div>
          </div>

          {student && (
            <div className="flex items-center justify-between p-3.5 rounded-xl mt-4"
              style={{ background: '#F2F2EC' }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#141414' }}>활동 상태</p>
                <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>비활성화하면 태블릿 출석에서 제외됩니다</p>
              </div>
              <Toggle value={form.is_active} onChange={v => set('is_active', v)} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-3.5 flex-shrink-0"
          style={{ borderTop: '1px solid #F2F2EC', background: '#F2F2EC' }}>
          {student ? (
            <button onClick={() => onDelete(student)} disabled={busy}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm"
              style={{ background: '#fff', color: '#E5484D', border: '1px solid #EAEAE4', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.5 : 1 }}>
              <Icon name="trash" size={13} />퇴원 처리
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={busy} className="h-9 px-4 rounded-lg text-sm font-medium"
              style={{ background: 'transparent', color: '#5B5B5B', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>취소</button>
            <button onClick={() => onSave(form)} disabled={!canSave || busy}
              className="h-9 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#141414', border: 'none', cursor: canSave && !busy ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
              {busy ? '처리 중...' : student ? '저장' : '등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StudentList() {
  const [students, setStudents] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<StudentRow | { _new: true } | null>(null)
  const [saving, setSaving] = useState(false)

  // 목록 조회 — 마운트 시 / 데이터 변경 후 재호출.
  // why: 등록/수정/삭제 후 자동 갱신을 위해 한 군데에 모아두고 onSave/onDelete 끝에 호출.
  // setState는 모두 await 이후에만 호출 — useEffect에서 호출돼도 동기적 setState로 인한
  // 캐스케이딩 렌더링이 발생하지 않도록 한다.
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/students', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { students: StudentRow[] }
      setStudents(body.students)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '학생 목록을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  // 마운트 시 1회 로드. cancelled 플래그로 언마운트 후 setState를 막아 메모리 경고 방지.
  // why: react-hooks/set-state-in-effect 규칙이 effect 본문에서 reload() 호출 자체를
  //      "동기적 setState"로 간주하기 때문에 인라인 async IIFE로 풀어 작성한다.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/students', { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        const body = (await res.json()) as { students: StudentRow[] }
        if (cancelled) return
        setStudents(body.students)
        setLoadError(null)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '학생 목록을 불러오지 못했습니다')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => students.filter(s => {
    if (!query) return true
    const q = query.toLowerCase()
    if (s.name.toLowerCase().includes(q)) return true
    return s.parents.some(p => p.phone.includes(q) || p.phone_last4.includes(q))
  }), [students, query])

  const onSave = async (draft: StudentDraft) => {
    setSaving(true)
    try {
      // 학부모 페이로드 — DB의 phone_last4는 generated column이라 보내지 않는다.
      const parents = draft.parents.map(p => ({
        name: p.name,
        phone: p.phone,
        is_primary: p.is_primary,
      }))

      const isUpdate = Boolean(draft.id)
      const url = isUpdate ? `/api/admin/students/${draft.id}` : '/api/admin/students'
      const res = await fetch(url, {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          is_active: draft.is_active,
          parents,
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

  const onDelete = async (s: StudentRow) => {
    if (!confirm(`${s.name} 학생을 퇴원 처리(소프트 삭제)하시겠습니까?`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/students/${s.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      await reload()
      setEditing(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : '퇴원 처리에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  // GET 라우트가 is_active=true만 반환하므로 students는 곧 활동 학생.
  const activeCount = students.length

  return (
    <div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>학생 관리</h2>
          <p className="text-sm mt-1" style={{ color: '#5B5B5B' }}>활동 {activeCount}명</p>
        </div>
        <button onClick={() => setEditing({ _new: true })}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold text-white"
          style={{ background: '#141414', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Icon name="plus" size={14} />학생 등록
        </button>
      </div>

      <div className="rounded-xl p-3.5 mb-4" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="relative flex items-center">
          <span className="absolute left-3 pointer-events-none" style={{ color: '#9A9A9A' }}><Icon name="search" size={14} /></span>
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="이름 · 연락처 · 뒷자리 검색"
            className="w-full h-10 rounded-lg pl-9 pr-3 text-sm outline-none"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414' }} />
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl p-3.5 mb-4 text-sm"
          style={{ background: '#FDECEC', border: '1px solid rgba(229,72,77,0.2)', color: '#E5484D' }}>
          학생 목록을 불러오지 못했습니다: {loadError}
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 14, minWidth: 640 }}>
            <thead>
              <tr style={{ background: '#F2F2EC', textAlign: 'left' }}>
                {[['학생', 220], ['학부모 연락처', 240], ['상태', 80], ['등록일', 100], ['', 80]].map(([label, w]) => (
                  <th key={label} className="uppercase tracking-widest"
                    style={{ padding: '12px 16px', fontSize: 12, color: '#5B5B5B', fontWeight: 600, minWidth: w, whiteSpace: 'nowrap' }}>
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
                  {students.length === 0 ? '등록된 학생이 없습니다. 우측 상단 [학생 등록]으로 추가하세요.' : '검색 결과가 없습니다'}
                </td></tr>
              ) : filtered.map(s => {
                const primary = s.parents.find(p => p.is_primary) ?? s.parents[0]
                const extra = s.parents.length - 1
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid #F2F2EC', height: 56 }}>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <div className="min-w-0">
                        <span className="font-semibold" style={{ color: '#141414' }}>{s.name}</span>
                        {/* 클래스 칩 — 미배정이면 회색 안내, 1개 이상이면 반 이름 칩으로 노출. */}
                        {s.classes.length === 0 ? (
                          <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>반 미배정</p>
                        ) : (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {s.classes.slice(0, 3).map((c) => (
                              <span key={c.id}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-xs"
                                style={{ background: '#E9F0FF', color: '#2B6CFF' }}>
                                {c.name}
                              </span>
                            ))}
                            {s.classes.length > 3 && (
                              <span className="inline-flex items-center text-xs"
                                style={{ color: '#9A9A9A' }}>
                                +{s.classes.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <div className="flex items-center gap-1.5 text-xs tabular-nums" style={{ fontSize: 13, color: '#141414' }}>
                        <span>{primary?.phone ?? '—'}</span>
                        {primary?.name && <span style={{ color: '#9A9A9A' }}>({primary.name})</span>}
                      </div>
                      {extra > 0 && <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>+ {extra}명 더</p>}
                    </td>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: s.is_active ? '#E6F6EE' : '#F2F2EC', color: s.is_active ? '#1BA974' : '#5B5B5B' }}>
                        {s.is_active ? '활동' : '퇴원'}
                      </span>
                    </td>
                    <td className="tabular-nums text-sm" style={{ padding: '12px 16px', verticalAlign: 'middle', color: '#5B5B5B' }}>{formatJoined(s.created_at)}</td>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <button onClick={() => setEditing(s)}
                        className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium"
                        style={{ background: 'transparent', color: '#5B5B5B', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <Icon name="edit" size={13} />수정
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && '_new' in editing ? (
        <StudentModal student={null} onClose={() => setEditing(null)} onSave={onSave} onDelete={onDelete} busy={saving} />
      ) : editing ? (
        <StudentModal student={editing} onClose={() => setEditing(null)} onSave={onSave} onDelete={onDelete} busy={saving} />
      ) : null}
    </div>
  )
}
