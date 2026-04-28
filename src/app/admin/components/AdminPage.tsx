'use client'

import { useState, useEffect } from 'react'
import AttendanceTable from './AttendanceTable'
import StudentList from './StudentList'
import FailedNotifications from './FailedNotifications'
import AbsenceManagement from './AbsenceManagement'
import ClassManagement from './ClassManagement'
import LogoutButton from './LogoutButton'

type Page = 'dashboard' | 'records' | 'students' | 'classes' | 'absences' | 'failures'

const ACADEMY_NAME = '엘 영어학원'

// ─── SVG icon primitives ────────────────────────────────────────────────────

function Icon({ name, size = 16, strokeWidth = 1.7 }: { name: string; size?: number; strokeWidth?: number }) {
  const paths: Record<string, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></>,
    list: <><path d="M8 6H20"/><path d="M8 12H20"/><path d="M8 18H20"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14c3 0 6 2 6 6"/></>,
    bell: <><path d="M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3V9"/><path d="M10 20a2 2 0 0 0 4 0"/></>,
    chevronRight: <path d="M9 6l6 6-6 6"/>,
    chevronLeft: <path d="M15 6l-6 6 6 6"/>,
    logout: <><path d="M10 4H6v16h4"/><path d="M15 8l4 4-4 4"/><path d="M19 12H10"/></>,
    alert: <><path d="M12 3L22 20H2Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/></>,
    doorIn: <><path d="M14 4h5v16h-5"/><path d="M4 12h10"/><path d="M10 7l4 5-4 5"/></>,
    doorOut: <><path d="M14 4h5v16h-5"/><path d="M4 12h10"/><path d="M8 7L4 12l4 5"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M3 10h18"/></>,
    phone: <path d="M5 4h4l2 5-3 2a10 10 0 0 0 5 5l2-3 5 2v4a1 1 0 0 1-1 1C10 20 4 14 4 5a1 1 0 0 1 1-1z"/>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff: <><path d="M17.94 17.94A10 10 0 0 1 12 20c-7 0-10-8-10-8a18 18 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9 9 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-1 1.6"/><path d="M1 1l22 22"/></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function Avatar({ name, kind = 'neutral', size = 36 }: { name: string; kind?: 'warm' | 'cool' | 'neutral'; size?: number }) {
  const styles = {
    warm: { bg: '#FFF1EA', fg: '#FF6B35' },
    cool: { bg: '#E9F0FF', fg: '#2B6CFF' },
    neutral: { bg: '#F2F2EC', fg: '#5B5B5B' },
  }[kind]
  return (
    <div style={{
      width: size, height: size, borderRadius: 10, flexShrink: 0,
      background: styles.bg, color: styles.fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700,
    }}>
      {name.slice(-1)}
    </div>
  )
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

function StatCard({ label, sub, value, tone, iconName, pct }: {
  label: string; sub: string; value: number; tone: 'warm' | 'cool' | 'danger' | 'warn'; iconName: string; pct: number | null
}) {
  const tones = {
    warm: { bg: '#FFF1EA', fg: '#FF6B35' },
    cool: { bg: '#E9F0FF', fg: '#2B6CFF' },
    danger: { bg: '#FDECEC', fg: '#E5484D' },
    warn: { bg: '#FDF3DC', fg: '#9A6B00' },
  }[tone]
  return (
    <div className="rounded-xl p-4.5" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: '#5B5B5B' }}>{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: tones.bg, color: tones.fg }}>
          <Icon name={iconName} size={16} strokeWidth={2} />
        </div>
      </div>
      <div className="text-4xl font-extrabold mt-2.5 tabular-nums tracking-tight" style={{ color: tones.fg }}>
        {value}<span className="text-base font-medium ml-1" style={{ color: '#9A9A9A' }}>명</span>
      </div>
      <div className="flex justify-between items-center mt-1">
        <span className="text-xs" style={{ color: '#9A9A9A' }}>{sub}</span>
        {pct !== null && <span className="text-xs font-semibold" style={{ color: tones.fg }}>{pct}%</span>}
      </div>
    </div>
  )
}

// 미등원 학생 — /api/admin/absentees 응답 row.
// 학년/반 등 부가 정보는 DB 스키마에 없어 id+name만 사용한다.
type Absentee = { id: string; name: string }

// 대시보드 요약 — /api/admin/dashboard 응답 형태와 1:1 매칭.
// 카운트는 KST 기준 당일이며, recent는 당일이 아닌 최신 10건이다.
type RecentLog = {
  id: string
  student_id: string
  student_name: string
  type: 'checkin' | 'checkout'
  checked_at: string
}
type DashboardSummary = {
  total_active_students: number
  // 오늘 KST 요일에 수업이 있는 활성 학생 수 — 등원/미등원 % 계산의 분모.
  today_expected_count: number
  today_checkin_count: number
  today_checkout_count: number
  recent: RecentLog[]
}

// ISO timestamptz → 화면 표시용 "HH:MM" (브라우저 로컬 = 한국 사용자 KST).
function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function AdminDashboard({ failCount, setActivePage }: { failCount: number; setActivePage: (p: Page) => void }) {
  // 미등원 학생은 Supabase에서 실시간 조회 (당일 checkin 기록 없는 활성 학생).
  // why: 상세 리스트는 결석 관리 탭이 담당하고 대시보드에서는 카운트(StatCard)와
  //      알림 배너만 보여주므로 loading/error 별도 표시 없이 카운트만 보관한다.
  //      실패 시에도 0명으로 표시되며, 사용자에겐 결석 관리 탭에서 정확한 정보가 노출된다.
  const [absentees, setAbsentees] = useState<Absentee[]>([])

  // 대시보드 요약(카운트 + 최근 활동)은 별도 API에서 한 번에 받아와 round-trip을 절감한다.
  // 미등원 카드는 별도 endpoint를 유지 — KST 경계 + students 안티조인이 카운트 쿼리와 다르고,
  // 이미 안정화된 absentees API를 그대로 재사용하는 편이 변경 범위를 줄인다.
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/absentees', { cache: 'no-store' })
        if (cancelled || !res.ok) return
        const body = (await res.json()) as { absentees: Absentee[] }
        if (cancelled) return
        setAbsentees(body.absentees)
      } catch {
        // 카운트 조회 실패는 치명적이지 않음 — 0명으로 두고 결석 관리 탭으로 유도.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/dashboard', { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        const body = (await res.json()) as DashboardSummary
        if (cancelled) return
        setSummary(body)
        setSummaryError(null)
      } catch (err) {
        if (cancelled) return
        setSummaryError(err instanceof Error ? err.message : '대시보드 정보를 불러오지 못했습니다')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const expected = summary?.today_expected_count ?? 0
  const inCount = summary?.today_checkin_count ?? 0
  const outCount = summary?.today_checkout_count ?? 0
  const absentCount = absentees.length
  const recent = summary?.recent ?? []

  const now = new Date()
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${['일','월','화','수','목','금','토'][now.getDay()]}요일`

  // 등원/미등원 % 분모는 today_expected_count(오늘 수업 있는 학생) 기준.
  // why: 클래스 도입 후 "오늘 수업이 없는 학생"은 분모에서 빠져야 카드가 의미있어짐.
  // 하원 %는 등원한 학생이 분모 — 등원 → 하원 자연스러운 흐름.
  const inPct = expected > 0 ? Math.round((inCount / expected) * 100) : 0
  const outPct = inCount > 0 ? Math.round((outCount / inCount) * 100) : 0
  const absentPct = expected > 0 ? Math.round((absentCount / expected) * 100) : 0

  return (
    <div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>오늘의 출석 현황</h2>
          <p className="text-sm mt-1" style={{ color: '#5B5B5B' }}>{dateStr}</p>
        </div>
      </div>

      {absentCount > 0 && (
        // 클릭 시 "결석 관리" 탭으로 이동 — 카드 리스트는 결석 관리 페이지로 통합되었기에
        // 대시보드에서는 알림과 진입 동선만 남긴다. (button 사용으로 키보드 접근성도 확보)
        <button
          onClick={() => setActivePage('absences')}
          className="w-full flex items-center gap-3.5 rounded-xl p-3.5 mb-5 text-left"
          style={{
            background: '#FDECEC', border: '1px solid rgba(229,72,77,0.2)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#E5484D', color: '#fff' }}>
            <Icon name="alert" size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: '#E5484D' }}>미등원 학생 {absentCount}명</p>
            <p className="text-xs mt-0.5" style={{ color: '#5B5B5B' }}>결석 관리 탭에서 보강 메모를 기록하세요 →</p>
          </div>
        </button>
      )}

      <div className="grid gap-3.5 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <StatCard label="등원 완료" sub={`오늘 수업 ${expected}명 중`} value={inCount} tone="warm" iconName="doorIn" pct={inPct} />
        <StatCard label="하원 완료" sub="등원한 학생 중" value={outCount} tone="cool" iconName="doorOut" pct={outPct} />
        <StatCard label="미등원" sub={`오늘 수업 ${expected}명 중`} value={absentCount} tone="danger" iconName="alert" pct={absentPct} />
        <StatCard label="발송 실패" sub="미해결 (3회 실패)" value={failCount} tone="warn" iconName="bell" pct={null} />
      </div>

      {/*
        과거의 2분할 그리드(최근 활동 + 미등원 학생 카드)에서 미등원 카드를 제거.
        why: 미등원/결석 관리는 신규 "결석 관리" 탭으로 통합 — 대시보드는 요약 카드와
              알림 배너만 남기고, 자세한 리스트와 메모 입력은 전용 탭에서 처리한다.
      */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #F2F2EC' }}>
          <div>
            <p className="text-sm font-bold" style={{ color: '#141414' }}>최근 체크인/아웃</p>
            <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>실시간 업데이트</p>
          </div>
        </div>
        {summaryError ? (
          <p className="px-5 py-6 text-xs text-center" style={{ color: '#E5484D' }}>
            최근 활동을 불러오지 못했습니다: {summaryError}
          </p>
        ) : summary === null ? (
          <p className="px-5 py-6 text-xs text-center" style={{ color: '#9A9A9A' }}>불러오는 중...</p>
        ) : recent.length === 0 ? (
          <p className="px-5 py-6 text-xs text-center" style={{ color: '#9A9A9A' }}>
            아직 출석 기록이 없습니다
          </p>
        ) : (
          recent.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3"
              style={{ borderBottom: i < recent.length - 1 ? '1px solid #F2F2EC' : 'none' }}>
              <Avatar name={r.student_name} kind={r.type === 'checkout' ? 'cool' : 'warm'} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: '#141414' }}>{r.student_name}</p>
                <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>
                  {r.type === 'checkout' ? '하원' : '등원'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold tabular-nums" style={{ color: r.type === 'checkout' ? '#2B6CFF' : '#FF6B35' }}>
                  {formatTime(r.checked_at)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Shell (sidebar + bottom tabs) ──────────────────────────────────────────

type NavItem = { id: Page; label: string; iconName: string; badge?: number }

function SidebarNav({ nav, activePage, setActivePage, sidebarOpen, setSidebarOpen }: {
  nav: NavItem[]
  activePage: Page
  setActivePage: (p: Page) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}) {
  const w = sidebarOpen ? 240 : 72
  return (
    <aside className="sticky top-0 h-screen flex flex-col flex-shrink-0 transition-all duration-200"
      style={{ width: w, background: '#fff', borderRight: '1px solid #EAEAE4' }}>
      <div className="flex items-center gap-2.5 p-4" style={{ borderBottom: '1px solid #F2F2EC' }}>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
          style={{ background: '#141414' }}>엘</div>
        {sidebarOpen && (
          <div className="min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: '#141414' }}>{ACADEMY_NAME}</p>
            <p className="text-xs" style={{ color: '#9A9A9A' }}>관리자 콘솔</p>
          </div>
        )}
      </div>

      <nav className="flex-1 p-2.5">
        {nav.map(item => {
          const active = item.id === activePage
          return (
            <button key={item.id} onClick={() => setActivePage(item.id)}
              className="w-full flex items-center rounded-lg mb-0.5 transition-colors duration-100"
              style={{
                padding: sidebarOpen ? '10px 12px' : '10px',
                justifyContent: sidebarOpen ? 'space-between' : 'center',
                background: active ? '#F2F2EC' : 'transparent',
                color: active ? '#141414' : '#5B5B5B',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 14, fontWeight: active ? 600 : 500,
              }}>
              <span className="flex items-center gap-3">
                <Icon name={item.iconName} size={18} strokeWidth={active ? 2 : 1.7} />
                {sidebarOpen && item.label}
              </span>
              {sidebarOpen && (item.badge ?? 0) > 0 && (
                <span className="flex items-center justify-center min-w-5 h-5 rounded-full text-xs font-bold text-white px-1.5"
                  style={{ background: '#E5484D' }}>{item.badge}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="p-2.5" style={{ borderTop: '1px solid #F2F2EC' }}>
        <button onClick={() => setSidebarOpen(!sidebarOpen)}
          className="w-full flex items-center gap-2.5 rounded-lg mb-1 text-xs"
          style={{
            padding: sidebarOpen ? '8px 12px' : '8px', justifyContent: sidebarOpen ? 'flex-start' : 'center',
            background: 'transparent', color: '#9A9A9A', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
          <Icon name={sidebarOpen ? 'chevronLeft' : 'chevronRight'} size={16} />
          {sidebarOpen && '접기'}
        </button>
        <LogoutButton
          className="w-full flex items-center gap-2.5 rounded-lg text-sm"
          style={{
            padding: sidebarOpen ? '8px 12px' : '8px', justifyContent: sidebarOpen ? 'flex-start' : 'center',
            background: 'transparent', color: '#5B5B5B', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
          <Icon name="logout" size={16} />
          {sidebarOpen && '로그아웃'}
        </LogoutButton>
      </div>
    </aside>
  )
}

function BottomTabs({ nav, activePage, setActivePage }: {
  nav: NavItem[]; activePage: Page; setActivePage: (p: Page) => void
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 grid"
      style={{
        gridTemplateColumns: `repeat(${nav.length}, 1fr)`,
        background: '#fff', borderTop: '1px solid #EAEAE4',
      }}>
      {nav.map(item => {
        const active = item.id === activePage
        return (
          <button key={item.id} onClick={() => setActivePage(item.id)}
            className="flex flex-col items-center gap-0.5 relative"
            style={{
              padding: '10px 4px 12px', background: 'transparent', border: 'none',
              cursor: 'pointer', fontFamily: 'inherit',
              color: active ? '#141414' : '#9A9A9A',
            }}>
            {active && (
              <span className="absolute top-0 left-1/4 right-1/4 h-0.5 rounded-full" style={{ background: '#141414' }} />
            )}
            <div className="relative">
              <Icon name={item.iconName} size={22} strokeWidth={active ? 2 : 1.7} />
              {(item.badge ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold text-white px-1"
                  style={{ background: '#E5484D', fontSize: 10 }}>{item.badge}</span>
              )}
            </div>
            <span style={{ fontSize: 11, fontWeight: active ? 700 : 500 }}>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Root ────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  // 인증은 middleware.ts(/admin/* JWT 검증) + /admin/login 라우트가 담당.
  // 이 컴포넌트가 렌더된다는 것 자체가 인증 통과를 의미하므로 별도 가드 불필요.
  const [activePage, setActivePage] = useState<Page>('dashboard')
  const [isMobile, setIsMobile] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // 사이드바 뱃지 + 대시보드 카드 모두에서 쓰는 발송 실패 건수.
  // why: 두 컴포넌트가 각자 fetch하면 동일 endpoint를 중복 호출하므로 부모에서 한 번만 조회.
  const [failBadge, setFailBadge] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/notifications/failed', { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const body = (await res.json()) as { notifications: { id: string }[] }
        if (cancelled) return
        setFailBadge(body.notifications.length)
      } catch {
        // 뱃지 조회 실패는 치명적이지 않음 — 0으로 두고 사용자에게 알리지 않는다.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const nav: NavItem[] = [
    { id: 'dashboard', label: '대시보드', iconName: 'dashboard' },
    { id: 'records', label: '출석 기록', iconName: 'list' },
    { id: 'students', label: '학생 관리', iconName: 'users' },
    { id: 'classes', label: '클래스 관리', iconName: 'calendar' },
    { id: 'absences', label: '결석 관리', iconName: 'alert' },
    { id: 'failures', label: '발송 실패', iconName: 'bell', badge: failBadge },
  ]

  const content = {
    dashboard: <AdminDashboard failCount={failBadge} setActivePage={setActivePage} />,
    records: <AttendanceTable />,
    students: <StudentList />,
    classes: <ClassManagement />,
    absences: <AbsenceManagement />,
    failures: <FailedNotifications />,
  }[activePage]

  if (isMobile) {
    return (
      <div className="min-h-screen pb-18" style={{ background: '#FAFAF7', fontFamily: 'Pretendard, -apple-system, sans-serif' }}>
        <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-3"
          style={{ background: '#fff', borderBottom: '1px solid #EAEAE4' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7.5 h-7.5 rounded-lg flex items-center justify-center text-white font-bold text-sm"
              style={{ background: '#141414' }}>엘</div>
            <div>
              <p className="text-sm font-bold" style={{ color: '#141414' }}>{ACADEMY_NAME}</p>
              <p className="text-xs" style={{ color: '#9A9A9A' }}>관리자</p>
            </div>
          </div>
          <LogoutButton
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium"
            style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#5B5B5B' }}>
            <Icon name="logout" size={13} />로그아웃
          </LogoutButton>
        </div>
        <div className="p-4">{content}</div>
        <BottomTabs nav={nav} activePage={activePage} setActivePage={setActivePage} />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen" style={{ background: '#FAFAF7', fontFamily: 'Pretendard, -apple-system, sans-serif' }}>
      <SidebarNav
        nav={nav} activePage={activePage} setActivePage={setActivePage}
        sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
      />
      <main className="flex-1 min-w-0 p-7 lg:p-9">{content}</main>
    </div>
  )
}
