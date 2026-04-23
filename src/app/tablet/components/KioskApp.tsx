'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import MainScreen from './MainScreen'
import KeypadScreen from './KeypadScreen'
import SelectScreen from './SelectScreen'
import DoneScreen from './DoneScreen'
import NotFoundScreen from './NotFoundScreen'
import CooldownScreen from './CooldownScreen'
import { findByPhoneLast4 } from '../lib/phoneDB'
import { ACADEMY_NAME, COOLDOWN_MS, COUNTDOWN_SECONDS, PIN_MASKING } from '../lib/tokens'
import type { CooldownInfo, KioskMatch, KioskStudent, Mode, Screen } from '../lib/types'

export default function KioskApp() {
  const [screen, setScreen] = useState<Screen>('main')
  const [mode, setMode] = useState<Mode>('in')
  const [pin, setPin] = useState('')
  const [matches, setMatches] = useState<KioskMatch[]>([])
  const [currentStudent, setCurrentStudent] = useState<KioskStudent | null>(null)
  const [cooldownInfo, setCooldownInfo] = useState<CooldownInfo | null>(null)
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS)
  const [scale, setScale] = useState(1)

  // 동일 학생+동일 타입의 마지막 처리 시각을 메모리에 저장 (5분 쿨다운 판정).
  // 프로덕션: attendance_logs 테이블에서 최근 5분 내 동일 조합 조회로 교체.
  const cooldownRef = useRef<Record<string, number>>({})

  const resetToMain = useCallback(() => {
    setScreen('main')
    setPin('')
    setMatches([])
    setCurrentStudent(null)
    setCooldownInfo(null)
  }, [])

  useEffect(() => {
    if (screen !== 'done' && screen !== 'notfound' && screen !== 'cooldown') return
    let n = COUNTDOWN_SECONDS
    const tick = () => {
      setCountdown(n)
      if (n <= 0) {
        clearInterval(interval)
        cancelAnimationFrame(raf)
        resetToMain()
        return
      }
      n -= 1
    }
    const raf = requestAnimationFrame(tick)
    const interval = setInterval(tick, 1000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(interval)
    }
  }, [screen, resetToMain])

  useEffect(() => {
    const compute = () => {
      const sx = window.innerWidth / 1280
      const sy = window.innerHeight / 800
      setScale(Math.min(sx, sy, 1))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  const checkCooldownMinutes = (studentName: string, type: Mode): number | null => {
    const key = `${studentName}::${type}`
    const last = cooldownRef.current[key]
    if (last && Date.now() - last < COOLDOWN_MS) {
      return Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 60_000)
    }
    return null
  }

  const commitAttendance = (student: KioskStudent) => {
    cooldownRef.current[`${student.name}::${mode}`] = Date.now()
    setCurrentStudent(student)
    setScreen('done')
  }

  const onPickMode = (m: Mode) => {
    setMode(m)
    setPin('')
    setScreen('keypad')
  }

  const onKey = (k: string) => {
    if (k === '⌫') {
      setPin(p => p.slice(0, -1))
      return
    }
    if (pin.length >= 4) return
    const next = pin + k
    setPin(next)
    if (next.length === 4) {
      setTimeout(() => {
        const found = findByPhoneLast4(next)
        if (found.length === 0) {
          setScreen('notfound')
          return
        }
        if (found.length === 1) {
          const remainMin = checkCooldownMinutes(found[0].student.name, mode)
          if (remainMin) {
            setCooldownInfo({ student: found[0].student, remainMin })
            setScreen('cooldown')
            return
          }
          commitAttendance(found[0].student)
        } else {
          setMatches(found)
          setScreen('select')
        }
      }, 260)
    }
  }

  const onPickStudent = (match: KioskMatch) => {
    const remainMin = checkCooldownMinutes(match.student.name, mode)
    if (remainMin) {
      setCooldownInfo({ student: match.student, remainMin })
      setScreen('cooldown')
      return
    }
    commitAttendance(match.student)
  }

  const backFromSelect = () => {
    setPin('')
    setScreen('keypad')
  }

  const retryFromError = () => {
    setPin('')
    setScreen('keypad')
  }

  let screenEl: React.ReactNode = null
  if (screen === 'main') {
    screenEl = <MainScreen onPick={onPickMode} academyName={ACADEMY_NAME} />
  } else if (screen === 'keypad') {
    screenEl = (
      <KeypadScreen
        mode={mode}
        pin={pin}
        masking={PIN_MASKING}
        onKey={onKey}
        onBack={resetToMain}
        academyName={ACADEMY_NAME}
      />
    )
  } else if (screen === 'select') {
    screenEl = (
      <SelectScreen
        mode={mode}
        matches={matches}
        onPick={onPickStudent}
        onBack={backFromSelect}
        academyName={ACADEMY_NAME}
      />
    )
  } else if (screen === 'done' && currentStudent) {
    screenEl = (
      <DoneScreen
        mode={mode}
        student={currentStudent}
        countdown={Math.max(0, countdown)}
        academyName={ACADEMY_NAME}
      />
    )
  } else if (screen === 'notfound') {
    screenEl = (
      <NotFoundScreen
        pin={pin}
        onRetry={retryFromError}
        onBack={resetToMain}
        countdown={Math.max(0, countdown)}
        academyName={ACADEMY_NAME}
      />
    )
  } else if (screen === 'cooldown' && cooldownInfo) {
    screenEl = (
      <CooldownScreen
        mode={mode}
        info={cooldownInfo}
        onBack={resetToMain}
        countdown={Math.max(0, countdown)}
        academyName={ACADEMY_NAME}
      />
    )
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: '#0a0a0a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      <div
        key={screen}
        style={{
          width: 1280, height: 800,
          transform: `scale(${scale})`, transformOrigin: 'center center',
          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.5)',
          position: 'relative',
        }}
      >
        {screenEl}
      </div>
    </div>
  )
}
