export type ParentInfo = {
  id: string
  student_id: string
  name: string
  phone: string
  phone_last4: string
  is_primary: boolean
}

export type Student = {
  id: string
  academy_id: string
  name: string
  grade: string
  classroom: string
  parents: ParentInfo[]
  joined: string
  is_active: boolean
}

export type AttendanceRecord = {
  date: string
  day: string
  dateObj: Date
  student: Student
  status: 'in' | 'out' | 'absent'
  inTime: string | null
  outTime: string | null
  memo: { date: string; text: string } | null
}

export type NotificationLog = {
  id: string
  attendance_id: string
  student: Student
  parent: ParentInfo
  type: 'checkin' | 'checkout'
  status: 'failed' | 'retrying'
  attempt_count: number
  next_retry_at_display?: string
  next_retry_at: number | null
  error_message: string
  attempted_at_display: string
  attempted_at_raw: string
  resolved: boolean
}

export const GRADES = ['중1', '중2', '중3', '고1', '고2']
export const CLASSROOMS = [
  '수학 A반', '수학 B반', '수학 심화반',
  '영어 A반', '영어 B반', '영어 심화반',
  '국어 A반', '국어 B반',
]
export const PARENT_ROLES = ['엄마', '아빠', '할머니']

function seedRand(seed: number) {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

const rng = seedRand(42)
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]
const randPhone = () =>
  `010-${String(1000 + Math.floor(rng() * 9000))}-${String(1000 + Math.floor(rng() * 9000))}`

const FIRST = ['민', '서', '지', '윤', '예', '하', '도', '주', '시', '은', '준', '현', '수', '유', '채']
const LAST = ['준', '연', '아', '우', '호', '민', '서', '현', '영', '훈', '인', '빈', '율', '원', '희']
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권']

export const STUDENTS: Student[] = Array.from({ length: 58 }, (_, i) => {
  const name = pick(SURNAMES) + pick(FIRST) + pick(LAST)
  const numParents = rng() > 0.3 ? 2 : 1
  const parents: ParentInfo[] = Array.from({ length: numParents }, (_, pi) => {
    const phone = randPhone()
    return {
      id: `p-${i}-${pi}`,
      student_id: `S${String(i + 1).padStart(3, '0')}`,
      name: PARENT_ROLES[pi] ?? '보호자',
      phone,
      phone_last4: phone.slice(-4),
      is_primary: pi === 0,
    }
  })
  return {
    id: `S${String(i + 1).padStart(3, '0')}`,
    academy_id: 'a-0001',
    name,
    grade: pick(GRADES),
    classroom: pick(CLASSROOMS),
    parents,
    joined: `2024.${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}`,
    is_active: rng() > 0.08,
  }
})

type TodayRecord = Student & {
  status: 'in' | 'out' | 'absent'
  inTime: string | null
  outTime: string | null
}

export const TODAY_ATTENDANCE: TodayRecord[] = STUDENTS.slice(0, 48).map(s => {
  const r = rng()
  if (r < 0.18) return { ...s, status: 'absent' as const, inTime: null, outTime: null }
  const inHour = 15 + Math.floor(rng() * 4)
  const inMin = Math.floor(rng() * 60)
  const inTime = `${String(inHour).padStart(2, '0')}:${String(inMin).padStart(2, '0')}`
  const hasOut = rng() > 0.45
  let outTime: string | null = null
  if (hasOut) {
    const outHour = inHour + 2 + Math.floor(rng() * 2)
    const outMin = Math.floor(rng() * 60)
    outTime = `${String(outHour).padStart(2, '0')}:${String(outMin).padStart(2, '0')}`
  }
  return { ...s, status: (hasOut ? 'out' : 'in') as 'in' | 'out', inTime, outTime }
})

export const ABSENT_TODAY = TODAY_ATTENDANCE.filter(s => s.status === 'absent')
export const CHECKED_IN_TODAY = TODAY_ATTENDANCE.filter(s => s.status !== 'absent')
export const CHECKED_OUT_TODAY = TODAY_ATTENDANCE.filter(s => s.status === 'out')

function dateOffset(days: number): Date {
  const d = new Date(2026, 3, 21)
  d.setDate(d.getDate() - days)
  return d
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}
function fmtDay(d: Date): string {
  return ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
}

export const HISTORICAL: AttendanceRecord[] = []
for (let off = 0; off < 14; off++) {
  const d = dateOffset(off)
  if (d.getDay() === 0) continue
  const subset = STUDENTS.slice(0, 40 + Math.floor(rng() * 10))
  for (const s of subset) {
    const r = rng()
    if (r < 0.15) {
      HISTORICAL.push({
        date: fmtDate(d), day: fmtDay(d), dateObj: d,
        student: s, status: 'absent', inTime: null, outTime: null,
        memo:
          off > 3 && rng() > 0.5
            ? { date: fmtDate(dateOffset(off - 2)), text: '평일 저녁 1:1 보강 진행' }
            : null,
      })
    } else {
      const inHour = 15 + Math.floor(rng() * 4)
      const inMin = Math.floor(rng() * 60)
      const outHour = inHour + 2 + Math.floor(rng() * 2)
      const outMin = Math.floor(rng() * 60)
      HISTORICAL.push({
        date: fmtDate(d), day: fmtDay(d), dateObj: d,
        student: s,
        status: (rng() > 0.3 ? 'out' : 'in') as 'in' | 'out',
        inTime: `${String(inHour).padStart(2, '0')}:${String(inMin).padStart(2, '0')}`,
        outTime: `${String(outHour).padStart(2, '0')}:${String(outMin).padStart(2, '0')}`,
        memo: null,
      })
    }
  }
}

const NOTIFY_REASONS = [
  '수신 거부 (KT)', '번호 변경됨', '알림톡 미수신 설정', '일시적 통신 오류',
  '채널 미등록 수신자', '메시지 차단 설정됨',
]

export const NOTIFICATIONS: NotificationLog[] = []

for (let i = 0; i < 9; i++) {
  const s = STUDENTS[Math.floor(rng() * STUDENTS.length)]
  const parent = s.parents[Math.floor(rng() * s.parents.length)]
  const hourAgo = 1 + Math.floor(rng() * 36)
  NOTIFICATIONS.push({
    id: `n-f-${i}`,
    attendance_id: `a-${i}`,
    student: s,
    parent,
    type: (rng() > 0.5 ? 'checkin' : 'checkout') as 'checkin' | 'checkout',
    status: 'failed',
    attempt_count: 3,
    next_retry_at: null,
    error_message: NOTIFY_REASONS[Math.floor(rng() * NOTIFY_REASONS.length)],
    attempted_at_display: `${hourAgo}시간 전`,
    attempted_at_raw: `2026.04.${String(Math.max(1, 21 - Math.floor(hourAgo / 24))).padStart(2, '0')} ${String(15 + (hourAgo % 7)).padStart(2, '0')}:${String((hourAgo * 7) % 60).padStart(2, '0')}`,
    resolved: rng() > 0.7,
  })
}

for (let i = 0; i < 4; i++) {
  const s = STUDENTS[Math.floor(rng() * STUDENTS.length)]
  const parent = s.parents[Math.floor(rng() * s.parents.length)]
  const attempt = i < 2 ? 1 : 2
  const minUntilRetry = attempt === 1 ? 5 - Math.floor(rng() * 4) : 15 - Math.floor(rng() * 12)
  NOTIFICATIONS.push({
    id: `n-r-${i}`,
    attendance_id: `a-r-${i}`,
    student: s,
    parent,
    type: (rng() > 0.5 ? 'checkin' : 'checkout') as 'checkin' | 'checkout',
    status: 'retrying',
    attempt_count: attempt,
    next_retry_at_display: `${minUntilRetry}분 뒤 재시도 예정`,
    next_retry_at: Date.now() + minUntilRetry * 60 * 1000,
    error_message: NOTIFY_REASONS[Math.floor(rng() * NOTIFY_REASONS.length)],
    attempted_at_display: `${Math.floor(rng() * 10) + 1}분 전`,
    attempted_at_raw: `2026.04.21 ${String(15 + Math.floor(rng() * 3)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}`,
    resolved: false,
  })
}
