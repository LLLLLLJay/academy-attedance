'use client'

import { useState } from 'react'
import Shell from './Shell'
import { TOKENS } from '../lib/tokens'
import type { Mode } from '../lib/types'

type Props = {
  mode: Mode
  pin: string
  masking: boolean
  onKey: (key: string) => void
  onBack: () => void
  academyName: string
  // 4자리 입력 직후 결과 화면이 뜨기 전까지 "확인 중…" 인디케이터 노출 + 키패드 비활성화 토글.
  submitting?: boolean
}

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

export default function KeypadScreen({ mode, pin, masking, onKey, onBack, academyName, submitting = false }: Props) {
  const accent = mode === 'in' ? TOKENS.warm : TOKENS.cool
  const soft = mode === 'in' ? TOKENS.warmSoft : TOKENS.coolSoft
  const modeLabel = mode === 'in' ? '등원' : '하원'

  return (
    <Shell academyName={academyName}>
      <div style={{
        width: '100%', height: '100%', display: 'flex',
        padding: '40px 80px', gap: 60, alignItems: 'center',
      }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <button onClick={onBack} style={{
            alignSelf: 'flex-start',
            border: `1px solid ${TOKENS.line}`, background: TOKENS.surface,
            borderRadius: 12, padding: '10px 18px',
            fontSize: 15, color: TOKENS.inkSoft, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>← 뒤로</button>

          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 14px', borderRadius: 999,
              background: soft, color: accent,
              fontSize: 15, fontWeight: 600,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: accent }} />
              {modeLabel} 체크
            </div>
            <div style={{ fontSize: 40, fontWeight: 700, marginTop: 18, letterSpacing: '-0.02em' }}>
              부모님 연락처 뒷 4자리
            </div>
            <div style={{ fontSize: 18, color: TOKENS.inkSoft, marginTop: 8 }}>
              엄마 또는 아빠 핸드폰 번호의 마지막 4자리를 입력해주세요
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
            {[0, 1, 2, 3].map(i => {
              const filled = i < pin.length
              return (
                <div key={i} style={{
                  width: 68, height: 88, borderRadius: 16,
                  background: TOKENS.surface,
                  border: `2px solid ${filled ? accent : TOKENS.line}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 160ms ease',
                }}>
                  {filled && (
                    masking ? (
                      <div style={{
                        width: 20, height: 20, borderRadius: 999,
                        background: accent,
                        animation: 'kioskPop 200ms ease',
                      }} />
                    ) : (
                      <div style={{
                        fontSize: 36, fontWeight: 700, color: accent,
                        fontVariantNumeric: 'tabular-nums',
                        animation: 'kioskPop 200ms ease',
                      }}>{pin[i]}</div>
                    )
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/*
          우측 패널: 평상시엔 키패드, submitting일 땐 큰 스피너 + "확인 중…" 패널로 치환.
          why: 좌하단 작은 인디케이터는 시야 밖이라 멈춘 화면처럼 보였음.
               사용자 시선이 머물던 키패드 영역을 그대로 로딩 패널로 바꿔 진행 신호를 명확히 한다.
          minHeight 394px: 키패드 전체 높이(88×4 + 14×3)와 동일하게 잡아 전환 시 레이아웃 흔들림 방지.
        */}
        {submitting ? (
          <div style={{
            width: 440, minHeight: 394,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 32,
            animation: 'kioskFade 200ms ease',
          }}>
            <span style={{
              width: 96, height: 96, borderRadius: 999,
              border: `8px solid ${TOKENS.line}`,
              borderTopColor: accent,
              animation: 'kioskSpin 800ms linear infinite',
            }} />
            <div style={{
              fontSize: 40, fontWeight: 700, color: TOKENS.ink,
              letterSpacing: '-0.02em',
            }}>확인 중…</div>
            <div style={{ fontSize: 20, color: TOKENS.inkSoft }}>
              잠시만 기다려주세요
            </div>
          </div>
        ) : (
          <div style={{
            width: 440,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 14,
          }}>
            {KEYS.map((k, i) => {
              if (k === '') return <div key={i} />
              const isBack = k === '⌫'
              return (
                <KeyButton key={i} label={k} accent={accent} isBack={isBack} onClick={() => onKey(k)} />
              )
            })}
          </div>
        )}
      </div>
      <style>{`
        @keyframes kioskPop {
          from { transform: scale(0.4); opacity: 0 }
          to { transform: scale(1); opacity: 1 }
        }
        @keyframes kioskSpin {
          to { transform: rotate(360deg) }
        }
        @keyframes kioskFade {
          from { opacity: 0 }
          to { opacity: 1 }
        }
      `}</style>
    </Shell>
  )
}

function KeyButton({
  label, onClick, accent, isBack,
}: {
  label: string
  onClick: () => void
  accent: string
  isBack: boolean
}) {
  const [down, setDown] = useState(false)
  return (
    <button
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      onClick={onClick}
      style={{
        height: 88,
        background: down ? (isBack ? '#F5F5F0' : accent) : TOKENS.surface,
        color: down && !isBack ? '#fff' : TOKENS.ink,
        border: `1.5px solid ${down ? (isBack ? TOKENS.line : accent) : TOKENS.line}`,
        borderRadius: 16,
        fontSize: isBack ? 30 : 34,
        fontWeight: isBack ? 500 : 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontVariantNumeric: 'tabular-nums',
        transition: 'all 80ms ease',
      }}
    >{label}</button>
  )
}
