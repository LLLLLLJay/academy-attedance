'use client'

import { TOKENS } from '../lib/tokens'

type Props = {
  pin: string
  onRetry: () => void
  onBack: () => void
  countdown: number
  academyName: string
}

export default function NotFoundScreen({ pin, onRetry, onBack, countdown, academyName }: Props) {
  const warn = TOKENS.warn
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
        gap: 32, padding: '0 80px',
      }}>
        <div style={{
          width: 140, height: 140, borderRadius: 999,
          background: TOKENS.warnSoft, color: warn,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'kioskErrPop 320ms cubic-bezier(0.34,1.56,0.64,1)',
        }}>
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
            <circle cx="36" cy="36" r="28" />
            <line x1="36" y1="22" x2="36" y2="40" />
            <circle cx="36" cy="50" r="1.5" fill="currentColor" />
          </svg>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em' }}>
            등록되지 않은 번호예요
          </div>
          <div style={{ fontSize: 20, color: TOKENS.inkSoft, marginTop: 12, lineHeight: 1.5 }}>
            입력하신 <b style={{ color: TOKENS.ink, fontVariantNumeric: 'tabular-nums' }}>{pin}</b>번으로 등록된 학생이 없습니다.<br />
            번호를 다시 확인하시거나 선생님께 문의해주세요.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
          <button onClick={onRetry} style={{
            padding: '16px 36px', borderRadius: 14,
            background: TOKENS.ink, color: '#fff', border: 'none',
            fontSize: 18, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>다시 입력하기</button>
          <button onClick={onBack} style={{
            padding: '16px 36px', borderRadius: 14,
            background: TOKENS.surface, color: TOKENS.ink, border: `1px solid ${TOKENS.line}`,
            fontSize: 18, fontWeight: 500, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>처음으로</button>
        </div>

        <div style={{
          padding: '10px 22px', borderRadius: 999,
          background: TOKENS.surface, border: `1px solid ${TOKENS.line}`,
          fontSize: 15, color: TOKENS.inkSoft, fontVariantNumeric: 'tabular-nums',
          marginTop: 6,
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
