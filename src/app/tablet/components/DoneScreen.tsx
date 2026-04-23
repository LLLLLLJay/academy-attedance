'use client'

import { useEffect, useState } from 'react'
import Shell from './Shell'
import { TOKENS } from '../lib/tokens'
import type { KioskStudent, Mode } from '../lib/types'

type Props = {
  mode: Mode
  student: KioskStudent
  countdown: number
  academyName: string
}

export default function DoneScreen({ mode, student, countdown, academyName }: Props) {
  const accent = mode === 'in' ? TOKENS.warm : TOKENS.cool
  const modeLabel = mode === 'in' ? '등원' : '하원'
  const [time, setTime] = useState('--:--')

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setTime(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }))
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <Shell header={false} academyName={academyName}>
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 36, background: TOKENS.bg,
      }}>
        <div style={{
          width: 180, height: 180, borderRadius: 999,
          background: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 20px 60px -20px ${accent}88`,
          animation: 'kioskDonePop 400ms cubic-bezier(0.34,1.56,0.64,1)',
        }}>
          <svg width="96" height="96" viewBox="0 0 96 96" fill="none">
            <path d="M24 50 L42 68 L74 32" stroke="white" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"
              style={{
                strokeDasharray: 100,
                strokeDashoffset: 100,
                animation: 'kioskDoneDraw 500ms 200ms ease-out forwards',
              }}
            />
          </svg>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, color: TOKENS.inkSoft, fontWeight: 500 }}>{modeLabel} 완료</div>
          <div style={{ fontSize: 56, fontWeight: 800, marginTop: 10, letterSpacing: '-0.03em' }}>
            <span style={{ color: accent }}>{student.name}</span> 학생
          </div>
          <div style={{ fontSize: 24, color: TOKENS.ink, marginTop: 14, fontVariantNumeric: 'tabular-nums' }}>
            {time} · 부모님께 알림이 전송되었습니다
          </div>
        </div>

        <div style={{
          marginTop: 12,
          padding: '10px 24px', borderRadius: 999,
          background: TOKENS.surface, border: `1px solid ${TOKENS.line}`,
          fontSize: 16, color: TOKENS.inkSoft, fontVariantNumeric: 'tabular-nums',
        }}>
          {countdown}초 후 메인 화면으로 돌아갑니다
        </div>
      </div>
      <style>{`
        @keyframes kioskDonePop {
          from { transform: scale(0.3); opacity: 0 }
          to { transform: scale(1); opacity: 1 }
        }
        @keyframes kioskDoneDraw { to { stroke-dashoffset: 0 } }
      `}</style>
    </Shell>
  )
}
