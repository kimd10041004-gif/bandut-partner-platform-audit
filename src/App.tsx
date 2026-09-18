import {
  useEffect,
  useState,
  type ReactNode,
  type SyntheticEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { RepairCategory } from './domain/types'
import { PlatformProvider, SaveErrorBanner, SyncNoticeBanner } from './app/PlatformContext'
import { AUTH_MODE, AUTH_MODE_MARK } from './app/bootstrap'
import { useAdminGrade } from './app/PlatformContext'
import { canAdmin } from '../server/domain/adminGrade'
import { isBlockedForViewer, isActivationKey } from './app/adminReadOnly'
import { ErrorBoundary } from './app/ErrorBoundary'
import { setDraftCategory } from './app/entry'
import { Icon, ICON } from './ui/icons'
import Landing from './features/landing/Landing'
import Dashboard from './features/Dashboard'
import Jobs from './features/Jobs'
import Work from './features/Work'
import Schedule from './features/Schedule'
import Settlement from './features/Settlement'
import MyProfile from './features/MyProfile'
import CustomerHome from './features/customer/CustomerHome'
import CustomerRequest from './features/customer/CustomerRequest'
import CustomerEstimates from './features/customer/CustomerEstimates'
import AdminOverview from './features/admin/AdminOverview'
import AdminRequests from './features/admin/AdminRequests'
import AdminSettlement from './features/admin/AdminSettlement'
import AdminReviews from './features/admin/AdminReviews'
import AdminSettings from './features/admin/AdminSettings'
import AdminClaims from './features/admin/AdminClaims'
import AuthGate, { AuthStatus } from './features/auth/AuthGate'
import NotificationBell from './features/auth/NotificationBell'
import MyAccount from './features/auth/MyAccount'
import AdminMembers from './features/admin/AdminMembers'

/** 목적자 분리 (28-20-01): 고객 웹 `#/` · 파트너 센터 `#/partner` · 관리자 콘솔 `#/admin`.
 *  세 앱은 문(해시)과 아이덴티티가 다르고, 도메인 데이터는 공유한다 — 한 플랫폼의 세 얼굴.
 *  새 앱 추가 = APPS에 항목 1개 + features 폴더. 새 화면 추가 = 해당 앱 tabs 배열 + 파일 하나. */
/** 고객 마이 탭 (28-33-02) */
function CustomerMy() {
  return <MyAccount role="customer" />
}

const APPS = [
  {
    key: 'customer',
    hash: '#/',
    badge: null,
    tabs: [
      { key: 'chome', label: '홈', icon: ICON.home, view: CustomerHome },
      { key: 'crequest', label: '수리 요청', icon: ICON.work, view: CustomerRequest },
      { key: 'cestimates', label: '견적함', icon: ICON.wallet, view: CustomerEstimates },
      { key: 'cmy', label: '마이', icon: ICON.user, view: CustomerMy },
    ],
  },
  {
    key: 'partner',
    hash: '#/partner',
    badge: '파트너',
    tabs: [
      { key: 'dashboard', label: '대시보드', icon: ICON.home, view: Dashboard },
      { key: 'jobs', label: '일감·입찰', icon: ICON.search, view: Jobs },
      { key: 'work', label: '내 작업', icon: ICON.work, view: Work },
      { key: 'schedule', label: '일정', icon: ICON.calendar, view: Schedule },
      { key: 'settlement', label: '정산', icon: ICON.wallet, view: Settlement },
      { key: 'my', label: '마이', icon: ICON.user, view: MyProfile },
    ],
  },
  {
    key: 'admin',
    hash: '#/admin',
    badge: '관리자',
    tabs: [
      { key: 'aoverview', label: '현황', icon: ICON.home, view: AdminOverview },
      { key: 'arequests', label: '요청 관리', icon: ICON.search, view: AdminRequests },
      { key: 'asettlement', label: '정산 감독', icon: ICON.wallet, view: AdminSettlement },
      { key: 'areviews', label: '리뷰', icon: ICON.user, view: AdminReviews },
      { key: 'aclaims', label: '분쟁', icon: ICON.work, view: AdminClaims },
      { key: 'amembers', label: '회원', icon: ICON.user, view: AdminMembers },
      { key: 'asettings', label: '설정', icon: ICON.sliders, view: AdminSettings },
    ],
  },
] as const

type AppKey = (typeof APPS)[number]['key']

function appFromHash(): AppKey {
  try {
    const h = window.location.hash
    if (h.startsWith('#/partner')) return 'partner'
    if (h.startsWith('#/admin')) return 'admin'
  } catch {
    // 해시 접근 불가 환경 — 고객 앱
  }
  return 'customer'
}

/**
 * 관리자 화면의 등급 껍데기 (28-89-A).
 * 열람 등급이면 화면을 **읽기 전용**으로 만든다 — 탭·필터·검색·펼치기는 되고, 저장·승인·지급은 막힌다.
 *
 * **CSS로 막지 않는다** (28-89 리뷰, #244). 첫 판은 `pointer-events: none` 하나였는데 그것은
 * 마우스만 막는다 — Tab으로 옮겨 Enter를 누르면 그대로 실행됐다. 이제 캡처 단계에서 이벤트를
 * 막고(`isBlockedForViewer`), CSS는 "막혔다"는 **표시**만 한다.
 *
 * 화면이 막는 것은 여전히 안내에 가깝고, 실제로 막는 것은 도메인(`AuthService.assertOwner`)·
 * 서버(`api/auth.ts`의 등급 검사, `api/snapshot.ts`의 열람 쓰기 403)다 — 다만 **로컬 모드에는
 * 그 서버가 없으므로** 이 껍데기가 그 자리에서는 유일한 차단이다. `adminGrade.ts`의 한계 문단 참고.
 */
function AdminGradeShell({ children }: { children: ReactNode }) {
  const grade = useAdminGrade()
  const readOnly = grade === undefined || !canAdmin(grade, 'operate')
  const block = (e: SyntheticEvent) => {
    if (!isBlockedForViewer(e.target)) return
    e.preventDefault()
    e.stopPropagation()
  }
  const blockKey = (e: ReactKeyboardEvent) => {
    if (isActivationKey(e.key)) block(e)
  }
  return (
    <div
      className={readOnly ? 'admin-readonly' : undefined}
      data-admin-grade={grade ?? 'none'}
      aria-readonly={readOnly || undefined}
      {...(readOnly
        ? { onClickCapture: block, onKeyDownCapture: blockKey, onChangeCapture: block, onSubmitCapture: block }
        : {})}
    >
      {readOnly && (
        <div className="meta admin-readonly-banner" role="status" data-admin-readonly>
          {grade === undefined
            ? '이 세션에는 관리자 등급이 없습니다 — 다시 로그인하면 등급이 실립니다'
            : `열람 등급입니다 — 보기만 할 수 있고, 저장·승인·지급은 매니저 이상이 합니다`}
        </div>
      )}
      {children}
    </div>
  )
}

export default function App() {
  const [app, setApp] = useState<AppKey>(appFromHash)
  const activeApp = APPS.find((a) => a.key === app) ?? APPS[0]
  const [tab, setTab] = useState<string>(activeApp.tabs[0].key)
  const activeTab = activeApp.tabs.find((t) => t.key === tab) ?? activeApp.tabs[0]
  const ActiveView = activeTab.view
  // 고객 웹의 메인은 퍼블릭 홈페이지 (28-16-01)
  const [landing, setLanding] = useState(app === 'customer')
  useEffect(() => {
    const onHashChange = () => {
      const next = appFromHash()
      setApp(next)
      const nextApp = APPS.find((a) => a.key === next) ?? APPS[0]
      setTab(nextApp.tabs[0].key)
      // 고객 앱으로 돌아오면 홈페이지부터 (파트너/관리자에는 랜딩 없음)
      setLanding(next === 'customer')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const enterCustomerApp = (tabKey: string, category?: RepairCategory) => {
    if (category) setDraftCategory(category)
    setLanding(false)
    setTab(tabKey)
  }

  const onBrandClick = () => {
    if (activeApp.key === 'customer') setLanding(true)
    else setTab(activeApp.tabs[0].key)
  }

  const showLanding = activeApp.key === 'customer' && landing

  return (
    <PlatformProvider>
      <div className="app">
        <a className="skip-link" href="#main">
          본문 바로가기
        </a>
        <header className="app-header">
          <button className="brand" onClick={onBrandClick} aria-label="홈으로">
            <img className="logo-mark" src="/brand/logo-mark.png" alt="" />
            <h1>반듯집수리</h1>
            {activeApp.badge && <span className="app-badge">{activeApp.badge}</span>}
          </button>
          <AuthStatus role={activeApp.key} />
          <NotificationBell role={activeApp.key} />
          <span className="round" data-auth-mode={AUTH_MODE} data-build={AUTH_MODE_MARK}>
            29-32
          </span>
          {activeApp.key !== 'customer' && (
            <a className="quiet-link" href="#/">
              ← 고객 홈
            </a>
          )}
        </header>
        <SaveErrorBanner />
        <SyncNoticeBanner />
        {!showLanding && (
          <nav className="tabs">
            {activeApp.tabs.map((t) => (
              <button
                key={t.key}
                className={activeTab.key === t.key ? 'active' : ''}
                aria-current={activeTab.key === t.key ? 'page' : undefined}
                onClick={() => setTab(t.key)}
              >
                <Icon d={t.icon} /> {t.label}
              </button>
            ))}
          </nav>
        )}
        <main id="main" className="panel">
          <ErrorBoundary resetKey={showLanding ? 'landing' : `${activeApp.key}:${activeTab.key}`}>
            {showLanding ? (
              <Landing
                onPostJob={(category) => enterCustomerApp('crequest', category)}
                onBrowse={() => enterCustomerApp('chome')}
              />
            ) : (
              // 28-30-02: 랜딩(홈페이지)만 공개 — 앱 기능은 역할별 로그인 게이트 뒤
              <AuthGate role={activeApp.key}>
                {activeApp.key === 'admin' ? (
                  <AdminGradeShell>
                    <ActiveView />
                  </AdminGradeShell>
                ) : (
                  <ActiveView />
                )}
              </AuthGate>
            )}
          </ErrorBoundary>
        </main>
      </div>
    </PlatformProvider>
  )
}
