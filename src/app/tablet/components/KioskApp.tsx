'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import MainScreen from './MainScreen'
import KeypadScreen from './KeypadScreen'
import SelectScreen from './SelectScreen'
import DoneScreen from './DoneScreen'
import NotFoundScreen from './NotFoundScreen'
import CooldownScreen from './CooldownScreen'
import { COUNTDOWN_SECONDS, PIN_MASKING, TOKENS } from '../lib/tokens'
import type { CooldownInfo, KioskMatch, KioskStudent, Mode, Screen } from '../lib/types'

// ── 타입: /api/attendance 응답 ────────────────────────────────────
//
// 라우트가 status 200으로 비즈니스 분기 응답을 모두 돌려주는 정책을 따른다.
// (CLAUDE.md / route.ts 상단 JSDoc 참조)
// 클라이언트는 res.ok 체크 후 body.error 필드 유무·값으로 분기한다.
type AttendanceSuccess = {
  success: true
  student: { name: string; type: 'checkin' | 'checkout'; checked_at: string }
}
// error는 라우트가 돌려주는 모든 코드를 리터럴 union으로 나열한다.
// why: 'string' 타입을 한 곳이라도 끼우면 TS가 'MULTIPLE'/'COOLDOWN' 같은
//      개별 리터럴로 좁히지 못해 분기에서 students/student 같은 속성 접근이 막힌다.
type AttendanceResponse =
  | AttendanceSuccess
  | { error: 'MULTIPLE'; students: { id: string; name: string }[] }
  | { error: 'COOLDOWN'; student: { name: string }; remainMin: number }
  | { error: 'NOT_FOUND' }
  | { error: 'INVALID_PHONE' }
  | { error: 'INVALID_TYPE' }
  | { error: 'INVALID_JSON' }
  | { error: 'MISSING_ACADEMY' }
  | { error: 'DB_ERROR'; detail?: string }

// 키오스크 모드 ↔ API enum 매핑.
// why: UI는 짧은 'in'/'out'을 쓰지만 API/DB enum은 'checkin'/'checkout'.
const modeToType = (m: Mode): 'checkin' | 'checkout' =>
  m === 'in' ? 'checkin' : 'checkout'

// /api/attendance 호출 시 네트워크 타임아웃 (ms).
// why: 무한 대기로 "확인 중…" 화면이 영원히 멈추는 것을 막기 위해 명시적 상한.
const ATTENDANCE_TIMEOUT_MS = 6000

export default function KioskApp() {
  const router = useRouter()
  const [screen, setScreen] = useState<Screen>('main')
  const [mode, setMode] = useState<Mode>('in')
  const [pin, setPin] = useState('')
  const [matches, setMatches] = useState<KioskMatch[]>([])
  const [currentStudent, setCurrentStudent] = useState<KioskStudent | null>(null)
  const [cooldownInfo, setCooldownInfo] = useState<CooldownInfo | null>(null)
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS)
  const [scale, setScale] = useState(1)
  // 모든 화면(Main/Keypad/Done 등)의 헤더에 표시할 학원명.
  // why: 과거에 tokens.ts에 하드코딩된 상수를 import 했으나, DB(academies.name)가 단일 진실원이고
  //      알림톡의 #{학원명} 변수도 거기서 읽으므로 같은 출처에서 가져와 표시 일관성을 보장한다.
  //      부팅 직후 fetch 완료 전에는 빈 문자열로 두어 헤더 학원명만 잠깐 비고, "엘" 배지는 그대로 표시.
  const [academyName, setAcademyName] = useState('')
  // 키패드 화면에서 4자리 입력 직후 결과 화면 전까지 "확인 중…" 인디케이터를 띄우기 위한 상태.
  // why: ref만으로는 렌더에 반영되지 않아 사용자가 멈춘 화면으로 오인함 (네트워크 RTT + 서버 처리에 ~1초 소요).
  const [submitting, setSubmitting] = useState(false)

  // 동시 키 입력으로 동일한 4자리에 대해 두 번 POST 나가는 것을 막기 위한 가드.
  // why: setTimeout(260) 사이에 빠른 추가 입력이 들어오면 race가 날 수 있음.
  const submittingRef = useRef(false)

  const resetToMain = useCallback(() => {
    setScreen('main')
    setPin('')
    setMatches([])
    setCurrentStudent(null)
    setCooldownInfo(null)
    setSubmitting(false)
    submittingRef.current = false
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
      // 화면을 letterbox 없이 채운다. 비율이 다른 기기에서는 일부 가장자리가 잘릴 수 있다.
      setScale(Math.max(sx, sy))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  // 부팅 시 학원명을 1회 fetch — /api/academy는 NEXT_PUBLIC_ACADEMY_ID(없으면 첫 row) 정책을 따라
  // /api/attendance와 동일한 학원을 가리킨다. 실패해도 화면은 정상 동작 — 헤더 학원명만 빈칸.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/academy', { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const body = (await res.json()) as { id: string; name: string }
        if (cancelled) return
        setAcademyName(body.name)
      } catch {
        // 키오스크 부팅 시 일시적 네트워크 실패 — 헤더 학원명만 비고 출석 기능은 정상.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── /api/attendance 호출 헬퍼 ─────────────────────────────────────
  //
  // phone_last4 + type (+ 선택 시 student_id) 만 실어 POST.
  // academy_id는 서버 라우트가 env/DB로 보강하므로 클라이언트가 보내지 않는다.
  // why: 태블릿엔 로그인이 없어 학원 식별 정보 출처가 없음.
  const callAttendance = useCallback(
    async (phoneLast4: string, type: 'checkin' | 'checkout', studentId?: string) => {
      // AbortController로 네트워크 타임아웃 보강.
      // why: fetch 기본은 무한 대기 → 망 단절 시 "확인 중…" 화면이 영원히 멈춤.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ATTENDANCE_TIMEOUT_MS)
      try {
        const res = await fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone_last4: phoneLast4,
            type,
            ...(studentId ? { student_id: studentId } : {}),
          }),
          signal: controller.signal,
        })
        // tablet 토큰 만료/누락 → 즉시 로그인 페이지로 이동.
        // why: 미들웨어가 페이지 진입은 막지만, 페이지가 떠 있는 동안 토큰이 만료되면
        //      여기서만 401이 떨어진다. 사용자에게 NOT_FOUND/오류 화면을 띄우는 대신
        //      바로 로그인 화면으로 보내는 편이 직관적.
        if (res.status === 401) {
          router.replace('/tablet/login')
          return { ok: false, status: 401, body: null, redirected: true as const }
        }
        // 본문은 항상 JSON. 비즈니스 분기 응답도 200이라서 res.ok로 검증 후 body로 분기.
        const json = (await res.json().catch(() => null)) as AttendanceResponse | null
        return { ok: res.ok, status: res.status, body: json, redirected: false as const }
      } finally {
        clearTimeout(timer)
      }
    },
    [router],
  )

  // ── 응답 분기 → 화면 전환 ─────────────────────────────────────────
  //
  // 4자리 첫 호출과 SelectScreen에서 학생 선택 후 두 번째 호출 모두 같은 분기를 탄다.
  // why: 두 호출 모두 success/COOLDOWN/NOT_FOUND가 가능하고 분기 로직이 동일.
  const handleResponse = useCallback(
    (body: AttendanceResponse | null, ok: boolean) => {
      if (!ok || !body) {
        // 네트워크/서버 실패 → 사용자에겐 NOT_FOUND와 동일한 안내 화면으로.
        // why: 태블릿에서 별도 에러 화면을 띄우면 학생이 당황 → "다시 시도" 흐름이 더 친절.
        setScreen('notfound')
        return
      }
      if ('success' in body && body.success) {
        setCurrentStudent({ name: body.student.name })
        setScreen('done')
        return
      }
      if ('error' in body) {
        if (body.error === 'MULTIPLE') {
          // students[] 를 KioskMatch 형태로 매핑. parent 정보는 API에 없어 생략.
          const next: KioskMatch[] = body.students.map((s) => ({
            student: { id: s.id, name: s.name },
          }))
          setMatches(next)
          setScreen('select')
          return
        }
        if (body.error === 'COOLDOWN') {
          setCooldownInfo({
            student: { name: body.student.name },
            remainMin: body.remainMin,
          })
          setScreen('cooldown')
          return
        }
        if (body.error === 'NOT_FOUND') {
          setScreen('notfound')
          return
        }
        // INVALID_PHONE / INVALID_TYPE / DB_ERROR / MISSING_ACADEMY 등
        // 사용자가 손쓸 수 없는 케이스도 우선 NOT_FOUND 화면으로 안내한다.
        // why: 정확한 사유는 서버 로그로 보고, 아이는 "다시 누르세요" 메시지면 충분.
        console.error('[kiosk] attendance error:', body)
        setScreen('notfound')
        return
      }
    },
    [],
  )

  const onPickMode = (m: Mode) => {
    setMode(m)
    setPin('')
    setScreen('keypad')
  }

  const onKey = (k: string) => {
    if (k === '⌫') {
      setPin((p) => p.slice(0, -1))
      return
    }
    if (pin.length >= 4) return
    const next = pin + k
    setPin(next)
    if (next.length === 4) {
      // 4자리 채워지자마자 "확인 중…" 인디케이터 ON. 사용자에게 즉시 시각적 피드백을 준다.
      setSubmitting(true)
      // 260ms 지연: 마지막 키 애니메이션이 끝난 뒤 화면 전환되도록 (UX).
      setTimeout(async () => {
        if (submittingRef.current) return
        submittingRef.current = true
        try {
          const { ok, body, redirected } = await callAttendance(next, modeToType(mode))
          // 401 리다이렉트가 일어난 경우 화면 분기 스킵 — router.replace가 곧 페이지를 갈아끼움.
          if (redirected) return
          handleResponse(body, ok)
        } catch (err) {
          console.error('[kiosk] attendance request failed:', err)
          setScreen('notfound')
        } finally {
          submittingRef.current = false
          setSubmitting(false)
        }
      }, 260)
    }
  }

  const onPickStudent = async (match: KioskMatch) => {
    if (!match.student.id) {
      // id가 없는 match는 mock 잔재 — 정상 흐름에선 발생하지 않지만 방어적으로 처리.
      console.error('[kiosk] picked match without student.id', match)
      setScreen('notfound')
      return
    }
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      // 두 번째 호출: 같은 4자리 + 선택된 student_id로 단일 학생 확정.
      const { ok, body, redirected } = await callAttendance(pin, modeToType(mode), match.student.id)
      if (redirected) return
      handleResponse(body, ok)
    } catch (err) {
      console.error('[kiosk] attendance pick request failed:', err)
      setScreen('notfound')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
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
    screenEl = <MainScreen onPick={onPickMode} academyName={academyName} />
  } else if (screen === 'keypad') {
    screenEl = (
      <KeypadScreen
        mode={mode}
        pin={pin}
        masking={PIN_MASKING}
        onKey={onKey}
        onBack={resetToMain}
        academyName={academyName}
        submitting={submitting}
      />
    )
  } else if (screen === 'select') {
    screenEl = (
      <SelectScreen
        mode={mode}
        matches={matches}
        onPick={onPickStudent}
        onBack={backFromSelect}
        academyName={academyName}
      />
    )
  } else if (screen === 'done' && currentStudent) {
    screenEl = (
      <DoneScreen
        mode={mode}
        student={currentStudent}
        countdown={Math.max(0, countdown)}
        academyName={academyName}
      />
    )
  } else if (screen === 'notfound') {
    screenEl = (
      <NotFoundScreen
        pin={pin}
        onRetry={retryFromError}
        onBack={resetToMain}
        countdown={Math.max(0, countdown)}
        academyName={academyName}
      />
    )
  } else if (screen === 'cooldown' && cooldownInfo) {
    screenEl = (
      <CooldownScreen
        mode={mode}
        info={cooldownInfo}
        onBack={resetToMain}
        countdown={Math.max(0, countdown)}
        academyName={academyName}
      />
    )
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: TOKENS.bg,
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
