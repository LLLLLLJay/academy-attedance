'use client'

import { useState } from 'react'
import Shell from './Shell'
import { TOKENS } from '../lib/tokens'
import type { KioskMatch, Mode } from '../lib/types'

type Props = {
  mode: Mode
  matches: KioskMatch[]
  onPick: (match: KioskMatch) => void
  onBack: () => void
  academyName: string
}

export default function SelectScreen({ mode, matches, onPick, onBack, academyName }: Props) {
  const accent = mode === 'in' ? TOKENS.warm : TOKENS.cool
  const soft = mode === 'in' ? TOKENS.warmSoft : TOKENS.coolSoft

  return (
    <Shell academyName={academyName}>
      <div style={{
        width: '100%', height: '100%', padding: '40px 120px',
        display: 'flex', flexDirection: 'column', gap: 32,
      }}>
        <div>
          <button onClick={onBack} style={{
            border: `1px solid ${TOKENS.line}`, background: TOKENS.surface,
            borderRadius: 12, padding: '10px 18px',
            fontSize: 15, color: TOKENS.inkSoft, cursor: 'pointer',
            fontFamily: 'inherit', marginBottom: 20,
          }}>← 뒤로</button>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em' }}>
            본인의 이름을 선택해주세요
          </div>
          <div style={{ fontSize: 18, color: TOKENS.inkSoft, marginTop: 6 }}>
            이 번호로 등록된 학생이 {matches.length}명 있어요
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {matches.map((m, i) => (
            <StudentRow key={i} match={m} onClick={() => onPick(m)} accent={accent} soft={soft} />
          ))}
        </div>
      </div>
    </Shell>
  )
}

function StudentRow({
  match, onClick, accent, soft,
}: {
  match: KioskMatch
  onClick: () => void
  accent: string
  soft: string
}) {
  const [hover, setHover] = useState(false)
  const { student, parent } = match
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        width: '100%', minHeight: 120,
        background: hover ? soft : TOKENS.surface,
        border: `2px solid ${hover ? accent : TOKENS.line}`,
        borderRadius: 18, padding: '22px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        cursor: 'pointer', fontFamily: 'inherit',
        transition: 'all 120ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: soft, color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, fontWeight: 700,
        }}>{student.name.slice(-1)}</div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.01em' }}>{student.name}</div>
          <div style={{ fontSize: 17, color: TOKENS.inkSoft, marginTop: 2 }}>
            {student.grade} · {student.classroom}
            <span style={{ color: TOKENS.inkMute }}> · {parent.name}</span>
          </div>
        </div>
      </div>
      <div style={{
        width: 44, height: 44, borderRadius: 999,
        background: hover ? accent : '#F5F5F0',
        color: hover ? '#fff' : TOKENS.inkMute,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, transition: 'all 120ms',
      }}>→</div>
    </button>
  )
}
