'use client'

import { useEffect, useState } from 'react'
import { TOKENS } from '../lib/tokens'

type ShellProps = {
  children: React.ReactNode
  header?: boolean
  academyName: string
}

export default function Shell({ children, header = true, academyName }: ShellProps) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    const tick = () => setNow(new Date())
    const raf = requestAnimationFrame(tick)
    const t = setInterval(tick, 30_000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(t)
    }
  }, [])

  const time = now
    ? now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '--:--'
  const date = now
    ? `${now.getMonth() + 1}월 ${now.getDate()}일 ${['일','월','화','수','목','금','토'][now.getDay()]}요일`
    : ''

  return (
    <div style={{
      width: 1280, height: 800, background: TOKENS.bg,
      fontFamily: 'Pretendard Variable, Pretendard, -apple-system, sans-serif',
      color: TOKENS.ink, position: 'relative', overflow: 'hidden',
    }}>
      {header && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 68,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 40px', borderBottom: `1px solid ${TOKENS.line}`,
          background: TOKENS.surface,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: TOKENS.ink, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 16,
            }}>엘</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{academyName}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 15, color: TOKENS.inkSoft }}>
            <span>{date}</span>
            <span style={{ width: 1, height: 14, background: TOKENS.line }} />
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: TOKENS.ink }}>{time}</span>
          </div>
        </div>
      )}
      <div style={{ position: 'absolute', top: header ? 68 : 0, left: 0, right: 0, bottom: 0 }}>
        {children}
      </div>
    </div>
  )
}
