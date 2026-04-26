'use client'

import { useState, useEffect } from 'react'
import {
  NOTIFICATIONS, STUDENTS, TODAY_ATTENDANCE,
  ABSENT_TODAY, CHECKED_IN_TODAY, CHECKED_OUT_TODAY,
} from '../lib/mockData'
import type { Student } from '../lib/mockData'
import AttendanceTable from './AttendanceTable'
import StudentList from './StudentList'
import FailedNotifications from './FailedNotifications'
import LogoutButton from './LogoutButton'

type Page = 'dashboard' | 'records' | 'students' | 'failures'

const ACADEMY_NAME = '새벽별 학원'

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

function AdminDashboard() {
  const total = STUDENTS.filter(s => s.is_active).length
  const inCount = CHECKED_IN_TODAY.length
  const outCount = CHECKED_OUT_TODAY.length
  const absentCount = ABSENT_TODAY.length
  const failCount = NOTIFICATIONS.filter(n => n.status === 'failed' && !n.resolved).length
  const retryCount = NOTIFICATIONS.filter(n => n.status === 'retrying' && !n.resolved).length

  const now = new Date()
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${['일','월','화','수','목','금','토'][now.getDay()]}요일`

  const recent = [...TODAY_ATTENDANCE]
    .filter(s => s.inTime)
    .sort((a, b) => ((b.outTime ?? b.inTime ?? '') > (a.outTime ?? a.inTime ?? '') ? 1 : -1))
    .slice(0, 8)

  return (
    <div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: '#141414' }}>오늘의 출석 현황</h2>
          <p className="text-sm mt-1" style={{ color: '#5B5B5B' }}>{dateStr}</p>
        </div>
      </div>

      {absentCount > 0 && (
        <div className="flex items-center gap-3.5 rounded-xl p-3.5 mb-5"
          style={{ background: '#FDECEC', border: '1px solid rgba(229,72,77,0.2)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#E5484D', color: '#fff' }}>
            <Icon name="alert" size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: '#E5484D' }}>미등원 학생 {absentCount}명</p>
            <p className="text-xs mt-0.5" style={{ color: '#5B5B5B' }}>수업 시작 후 미등원 학생이 있습니다. 부모님께 확인 필요</p>
          </div>
        </div>
      )}

      <div className="grid gap-3.5 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <StatCard label="등원 완료" sub={`전체 ${total}명 중`} value={inCount} tone="warm" iconName="doorIn" pct={Math.round(inCount / total * 100)} />
        <StatCard label="하원 완료" sub="등원한 학생 중" value={outCount} tone="cool" iconName="doorOut" pct={Math.round(outCount / Math.max(inCount, 1) * 100)} />
        <StatCard label="미등원" sub="수업 시작 후" value={absentCount} tone="danger" iconName="alert" pct={Math.round(absentCount / total * 100)} />
        <StatCard label="발송 실패" sub={retryCount > 0 ? `재시도 중 ${retryCount}건` : '미해결 (3회 실패)'} value={failCount} tone="warn" iconName="bell" pct={null} />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #F2F2EC' }}>
            <div>
              <p className="text-sm font-bold" style={{ color: '#141414' }}>최근 체크인/아웃</p>
              <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>실시간 업데이트</p>
            </div>
          </div>
          {recent.map((s, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3"
              style={{ borderBottom: i < recent.length - 1 ? '1px solid #F2F2EC' : 'none' }}>
              <Avatar name={s.name} kind={s.status === 'out' ? 'cool' : 'warm'} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: '#141414' }}>{s.name}</p>
                <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>{s.grade} · {s.classroom}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold tabular-nums" style={{ color: s.status === 'out' ? '#2B6CFF' : '#FF6B35' }}>
                  {s.status === 'out' ? `하원 ${s.outTime}` : `등원 ${s.inTime}`}
                </p>
                <p className="text-xs tabular-nums mt-0.5" style={{ color: '#9A9A9A' }}>
                  {s.status === 'out' ? `등원 ${s.inTime}` : '수업 중'}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #EAEAE4' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #F2F2EC' }}>
            <div>
              <p className="text-sm font-bold" style={{ color: '#141414' }}>미등원 학생</p>
              <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>{absentCount}명 · 확인 필요</p>
            </div>
          </div>
          {(ABSENT_TODAY as (typeof ABSENT_TODAY[0] & Student)[]).slice(0, 6).map((s, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3"
              style={{ borderBottom: i < Math.min((ABSENT_TODAY as unknown[]).length - 1, 5) ? '1px solid #F2F2EC' : 'none' }}>
              <Avatar name={s.name} kind="neutral" size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: '#141414' }}>{s.name}</p>
                <p className="text-xs mt-0.5" style={{ color: '#9A9A9A' }}>{s.grade} · {s.classroom}</p>
              </div>
              <button className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium"
                style={{ border: '1px solid #EAEAE4', background: '#fff', color: '#141414' }}>
                <Icon name="phone" size={12} />연락
              </button>
            </div>
          ))}
          {(ABSENT_TODAY as unknown[]).length > 6 && (
            <p className="text-center text-xs py-3 cursor-pointer" style={{ color: '#9A9A9A', borderTop: '1px solid #F2F2EC' }}>
              외 {(ABSENT_TODAY as unknown[]).length - 6}명 더보기 →
            </p>
          )}
        </div>
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

  const failBadge = NOTIFICATIONS.filter(n => n.status === 'failed' && !n.resolved).length

  const nav: NavItem[] = [
    { id: 'dashboard', label: '대시보드', iconName: 'dashboard' },
    { id: 'records', label: '출석 기록', iconName: 'list' },
    { id: 'students', label: '학생 관리', iconName: 'users' },
    { id: 'failures', label: '발송 실패', iconName: 'bell', badge: failBadge },
  ]

  const content = {
    dashboard: <AdminDashboard />,
    records: <AttendanceTable />,
    students: <StudentList />,
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
