'use client'

import { useState, useMemo } from 'react'
import { STUDENTS, GRADES, CLASSROOMS, PARENT_ROLES } from '../lib/mockData'
import type { Student, ParentInfo } from '../lib/mockData'

function Icon({ name, size = 16, strokeWidth = 1.7 }: { name: string; size?: number; strokeWidth?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="M20 20L16 16"/></>,
    plus: <><path d="M12 5V19"/><path d="M5 12H19"/></>,
    edit: <path d="M4 20L4 16L16 4L20 8L8 20Z"/>,
    trash: <><path d="M4 7H20"/><path d="M6 7L7 20H17L18 7"/><path d="M9 7V4H15V7"/></>,
    x: <><path d="M6 6L18 18"/><path d="M18 6L6 18"/></>,
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

function Avatar({ name, kind = 'neutral', size = 32 }: { name: string; kind?: 'warm' | 'neutral'; size?: number }) {
  const c = kind === 'warm' ? { bg: '#FFF1EA', fg: '#FF6B35' } : { bg: '#F2F2EC', fg: '#5B5B5B' }
  return (
    <div style={{ width: size, height: size, borderRadius: 8, background: c.bg, color: c.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, flexShrink: 0 }}>
      {name.slice(-1)}
    </div>
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

type ParentDraft = Omit<ParentInfo, 'student_id'>

function ParentRow({ parent, onUpdate, onRemove, onSetPrimary, canRemove }: {
  parent: ParentDraft
  onUpdate: (patch: Partial<ParentDraft>) => void
  onRemove: () => void
  onSetPrimary: () => void
  canRemove: boolean
}) {
  return (
    <div className="flex gap-2.5 items-start p-3 rounded-xl"
      style={{ border: `1px solid ${parent.is_primary ? '#141414' : '#EAEAE4'}`, background: parent.is_primary ? '#F2F2EC' : '#fff' }}>
      <select value={PARENT_ROLES.includes(parent.name) ? parent.name : PARENT_ROLES[0]}
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

type StudentDraft = Omit<Student, 'id' | 'academy_id' | 'parents'> & { parents: ParentDraft[] }

function StudentModal({ student, onClose, onSave, onDelete }: {
  student: Student | null
  onClose: () => void
  onSave: (draft: StudentDraft & { id?: string }) => void
  onDelete: (s: Student) => void
}) {
  const [form, setForm] = useState<StudentDraft & { id?: string }>(() =>
    student
      ? { ...student, parents: student.parents.map(p => ({ ...p })) }
      : { name: '', grade: GRADES[0], classroom: CLASSROOMS[0], parents: [{ id: 'tmp-0', name: '엄마', phone: '', phone_last4: '', is_primary: true }], is_active: true, joined: '2026.04' }
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
    parents: [...prev.parents, { id: `tmp-${prev.parents.length}`, name: PARENT_ROLES[prev.parents.length] ?? '보호자', phone: '', phone_last4: '', is_primary: false }],
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

  const canSave = Boolean(form.name) && form.parents.length > 0 && form.parents.every(p => p.phone && p.phone_last4.length === 4)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(10,10,10,0.45)' }}
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl flex flex-col"
        style={{ background: '#fff', border: '1px solid #EAEAE4', boxShadow: '0 30px 80px -10px rgba(0,0,0,0.25)', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 flex-shrink-0" style={{ borderBottom: '1px solid #F2F2EC' }}>
          <div>
            <p className="text-xs font-semibold" style={{ color: '#9A9A9A' }}>{student ? '학생 정보 수정' : '새 학생 등록'}</p>
            <p className="text-xl font-bold mt-1" style={{ color: '#141414' }}>{student ? student.name : '신규 학생'}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9A9A9A' }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>이름</label>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                className="w-full h-10 rounded-lg px-3 text-sm outline-none"
                style={{ border: '1px solid #EAEAE4', color: '#141414', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>학년</label>
              <select value={form.grade} onChange={e => set('grade', e.target.value)}
                className="w-full h-10 rounded-lg px-3 text-sm cursor-pointer outline-none"
                style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', fontFamily: 'inherit' }}>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold mb-1.5" style={{ color: '#5B5B5B' }}>반</label>
              <select value={form.classroom} onChange={e => set('classroom', e.target.value)}
                className="w-full h-10 rounded-lg px-3 text-sm cursor-pointer outline-none"
                style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', fontFamily: 'inherit' }}>
                {CLASSROOMS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
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
                <ParentRow key={p.id ?? i} parent={p}
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
            <button onClick={() => onDelete(student)}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm"
              style={{ background: '#fff', color: '#E5484D', border: '1px solid #EAEAE4', cursor: 'pointer', fontFamily: 'inherit' }}>
              <Icon name="trash" size={13} />퇴원 처리
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-medium"
              style={{ background: 'transparent', color: '#5B5B5B', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
            <button onClick={() => onSave(form)} disabled={!canSave}
              className="h-9 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#141414', border: 'none', cursor: canSave ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
              {student ? '저장' : '등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StudentList() {
  const [students, setStudents] = useState<Student[]>(() => STUDENTS.slice())
  const [query, setQuery] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [gradeFilter, setGradeFilter] = useState('all')
  const [editing, setEditing] = useState<Student | null | { _new: true }>(null)

  const filtered = useMemo(() => students.filter(s => {
    if (classFilter !== 'all' && s.classroom !== classFilter) return false
    if (gradeFilter !== 'all' && s.grade !== gradeFilter) return false
    if (query) {
      const q = query.toLowerCase()
      if (s.name.toLowerCase().includes(q)) return true
      return s.parents.some(p => p.phone.includes(q) || p.phone_last4.includes(q))
    }
    return true
  }), [students, query, classFilter, gradeFilter])

  const onSave = (draft: StudentDraft & { id?: string }) => {
    if (draft.id && students.find(x => x.id === draft.id)) {
      setStudents(prev => prev.map(x => x.id === draft.id ? { ...x, ...draft } as Student : x))
    } else {
      const newId = `S${String(students.length + 1).padStart(3, '0')}`
      setStudents(prev => [{ ...draft, id: newId, academy_id: 'a-0001', parents: draft.parents.map(p => ({ ...p, student_id: newId })) } as Student, ...prev])
    }
    setEditing(null)
  }

  const onDelete = (s: Student) => {
    if (confirm(`${s.name} 학생을 퇴원 처리(소프트 삭제)하시겠습니까?`)) {
      setStudents(prev => prev.map(x => x.id === s.id ? { ...x, is_active: false } : x))
      setEditing(null)
    }
  }

  type StudentDraft = Omit<Student, 'id' | 'academy_id' | 'parents'> & { parents: Omit<ParentInfo, 'student_id'>[]; id?: string }

  const activeCount = students.filter(s => s.is_active).length

  return (
    <div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>학생 관리</h2>
          <p className="text-sm mt-1" style={{ color: '#5B5B5B' }}>총 {students.length}명 · 활동 {activeCount}명</p>
        </div>
        <button onClick={() => setEditing({ _new: true })}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold text-white"
          style={{ background: '#141414', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Icon name="plus" size={14} />학생 등록
        </button>
      </div>

      <div className="rounded-xl p-3.5 mb-4" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div className="relative flex items-center">
            <span className="absolute left-3 pointer-events-none" style={{ color: '#9A9A9A' }}><Icon name="search" size={14} /></span>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="이름 · 연락처 · 뒷자리 검색"
              className="w-full h-10 rounded-lg pl-9 pr-3 text-sm outline-none"
              style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414' }} />
          </div>
          <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)}
            className="h-10 rounded-lg px-3 text-sm cursor-pointer outline-none"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', fontFamily: 'inherit' }}>
            <option value="all">전체 학년</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
            className="h-10 rounded-lg px-3 text-sm cursor-pointer outline-none"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414', fontFamily: 'inherit' }}>
            <option value="all">전체 반</option>
            {CLASSROOMS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 14, minWidth: 820 }}>
            <thead>
              <tr style={{ background: '#F2F2EC', textAlign: 'left' }}>
                {[['학생', 220], ['학년', 80], ['반', 140], ['학부모 연락처', 220], ['상태', 80], ['등록일', 100], ['', 80]].map(([label, w]) => (
                  <th key={label} className="uppercase tracking-widest"
                    style={{ padding: '12px 16px', fontSize: 12, color: '#5B5B5B', fontWeight: 600, minWidth: w, whiteSpace: 'nowrap' }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const primary = s.parents.find(p => p.is_primary) ?? s.parents[0]
                const extra = s.parents.length - 1
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid #F2F2EC', height: 56 }}>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={s.name} kind={s.is_active ? 'warm' : 'neutral'} size={32} />
                        <span className="font-semibold" style={{ color: '#141414' }}>{s.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle', color: '#141414' }}>{s.grade}</td>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle', color: '#141414' }}>{s.classroom}</td>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <div className="flex items-center gap-1.5 text-xs tabular-nums" style={{ fontSize: 13, color: '#141414' }}>
                        <span>{primary?.phone ?? '—'}</span>
                        {primary && <span style={{ color: '#9A9A9A' }}>({primary.name})</span>}
                      </div>
                      {extra > 0 && <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>+ {extra}명 더</p>}
                    </td>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: s.is_active ? '#E6F6EE' : '#F2F2EC', color: s.is_active ? '#1BA974' : '#5B5B5B' }}>
                        {s.is_active ? '활동' : '퇴원'}
                      </span>
                    </td>
                    <td className="tabular-nums text-sm" style={{ padding: '12px 16px', verticalAlign: 'middle', color: '#5B5B5B' }}>{s.joined}</td>
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

      {editing && !('_new' in editing && editing._new) && (
        <StudentModal student={editing as Student} onClose={() => setEditing(null)} onSave={onSave} onDelete={onDelete} />
      )}
      {editing && '_new' in editing && (editing as { _new: true })._new && (
        <StudentModal student={null} onClose={() => setEditing(null)} onSave={onSave} onDelete={onDelete} />
      )}
    </div>
  )
}
