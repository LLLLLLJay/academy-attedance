'use client'

import { useState } from 'react'
import Shell from './Shell'
import { DoorInIcon, DoorOutIcon } from './icons'
import { TOKENS } from '../lib/tokens'
import type { Mode } from '../lib/types'

type Props = {
  onPick: (mode: Mode) => void
  academyName: string
}

export default function MainScreen({ onPick, academyName }: Props) {
  return (
    <Shell academyName={academyName}>
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 48, padding: '0 80px',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em' }}>
            오늘도 반가워요 🙂
          </div>
          <div style={{ fontSize: 20, color: TOKENS.inkSoft, marginTop: 10 }}>
            부모님 연락처 뒷 4자리로 체크인/아웃 해주세요
          </div>
        </div>

        <div style={{ display: 'flex', gap: 28 }}>
          <BigButton kind="warm" label="등원" sub="학원에 왔어요" icon={<DoorInIcon />} onClick={() => onPick('in')} />
          <BigButton kind="cool" label="하원" sub="집에 갑니다" icon={<DoorOutIcon />} onClick={() => onPick('out')} />
        </div>

        <div style={{ fontSize: 15, color: TOKENS.inkMute, marginTop: 12 }}>
          버튼을 누르면 키패드가 나타납니다
        </div>
      </div>
    </Shell>
  )
}

function BigButton({
  kind, label, sub, icon, onClick,
}: {
  kind: 'warm' | 'cool'
  label: string
  sub: string
  icon: React.ReactNode
  onClick: () => void
}) {
  const [pressed, setPressed] = useState(false)
  const accent = kind === 'warm' ? TOKENS.warm : TOKENS.cool
  const soft = kind === 'warm' ? TOKENS.warmSoft : TOKENS.coolSoft
  return (
    <button
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onClick={onClick}
      style={{
        width: 380, height: 340, cursor: 'pointer',
        background: TOKENS.surface,
        border: `2px solid ${pressed ? accent : TOKENS.line}`,
        borderRadius: 24,
        display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', justifyContent: 'space-between',
        padding: 36, textAlign: 'left',
        transition: 'all 120ms ease',
        transform: pressed ? 'translateY(2px)' : 'translateY(0)',
        boxShadow: pressed ? 'none' : '0 2px 0 rgba(0,0,0,0.02), 0 20px 40px -20px rgba(0,0,0,0.08)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{
        width: 72, height: 72, borderRadius: 18,
        background: soft, color: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 64, fontWeight: 800, color: accent, letterSpacing: '-0.03em', lineHeight: 1 }}>{label}</div>
        <div style={{ fontSize: 22, color: TOKENS.inkSoft, marginTop: 12 }}>{sub}</div>
      </div>
    </button>
  )
}
