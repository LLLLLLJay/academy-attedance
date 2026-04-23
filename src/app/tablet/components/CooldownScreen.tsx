'use client'

import { TOKENS } from '../lib/tokens'
import type { CooldownInfo, Mode } from '../lib/types'

type Props = {
  mode: Mode
  info: CooldownInfo
  onBack: () => void
  countdown: number
  academyName: string
}

export default function CooldownScreen({ mode, info, onBack, countdown, academyName }: Props) {
  const modeLabel = mode === 'in' ? '등원' : '하원'
  const accent = TOKENS.cooldown
  const soft = TOKENS.cooldownSoft

  return (
    <div style={{
      width: 1280, height: 800, background: TOKENS.bg,
      fontFamily: 'Pretendard Variable, Pretendard, -apple-system, sans-serif',
      color: TOKENS.ink, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 68,
        display: 'flex', alignItems: 'center', padding: '0 40px',
        borderBottom: `1px solid ${TOKENS.line}`, background: TOKENS.surface,
        fontSize: 18, fontWeight: 600,
      }}>{academyName}</div>

      <div style={{
        position: 'absolute', top: 68, left: 0, right: 0, bottom: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 30, padding: '0 80px',
      }}>
        <div style={{
          width: 140, height: 140, borderRadius: 999,
          background: soft, color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'kioskErrPop 320ms cubic-bezier(0.34,1.56,0.64,1)',
        }}>
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="36" cy="36" r="28" />
            <path d="M36 22 V36 L46 42" />
          </svg>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', borderRadius: 999,
            background: soft, color: accent,
            fontSize: 14, fontWeight: 600, marginBottom: 16,
          }}>방금 처리됨</div>

          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em' }}>
            <span style={{ color: accent }}>{info.student.name}</span>은 이미 {modeLabel} 처리됐어요
          </div>
          <div style={{ fontSize: 20, color: TOKENS.inkSoft, marginTop: 14, lineHeight: 1.5 }}>
            실수 방지를 위해 5분 동안은 같은 타입으로 다시 체크할 수 없습니다.<br />
            약 <b style={{ color: accent }}>{info.remainMin}분 후</b> 다시 시도해주세요.
          </div>
        </div>

        <button onClick={onBack} style={{
          padding: '16px 36px', borderRadius: 14,
          background: TOKENS.ink, color: '#fff', border: 'none',
          fontSize: 18, fontWeight: 600, cursor: 'pointer',
          fontFamily: 'inherit', marginTop: 6,
        }}>처음으로</button>

        <div style={{
          padding: '10px 22px', borderRadius: 999,
          background: TOKENS.surface, border: `1px solid ${TOKENS.line}`,
          fontSize: 15, color: TOKENS.inkSoft, fontVariantNumeric: 'tabular-nums',
        }}>{countdown}초 후 메인 화면으로 돌아갑니다</div>
      </div>

      <style>{`
        @keyframes kioskErrPop {
          from { transform: scale(0.3); opacity: 0 }
          to { transform: scale(1); opacity: 1 }
        }
      `}</style>
    </div>
  )
}
