import { useState, type ReactNode } from 'react'
import type { AuthRole, PartnerType, SignupRole } from '../../../server/domain/auth'
import { ADMIN_ID, PARTNER_TYPE_LABEL } from '../../../server/domain/auth'
import { ADMIN_GRADE_LABEL } from '../../../server/domain/adminGrade'
import { usePlatform } from '../../app/PlatformContext'
import { DEFAULT_PARTNER_PROFILE } from '../../domain/platform'
import { isKnownError } from '../../ui/format'
import { Card } from '../../ui/primitives'

const ROLE_LABEL: Record<AuthRole, string> = { customer: '고객', partner: '파트너', admin: '관리자' }

/** 관리자 로그인 (28-30-02, 시안 4) — 가입 없음, 시드 계정 */
function AdminLogin() {
  const { auth, authActions, refresh } = usePlatform()
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  // 28-51-03: 세션 만료 안내 1회
  const [notice] = useState(() => auth.consumeNotice())

  // 28-70: 변경은 authActions로 — 로컬 모드면 auth를, 서버 모드면 /api/auth를 부른다
  const submit = async () => {
    setError('')
    try {
      await authActions.login('admin', id, password)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  return (
    <div className="auth-wrap">
      <Card className="form" title="관리자 로그인">
        {notice && (
          <div className="meta form-wide gate-notice" data-gate-notice>
            {notice}
          </div>
        )}
        <label className="form-wide">
          아이디
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="admin" autoComplete="username" />
        </label>
        <label className="form-wide">
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            autoComplete="current-password"
          />
        </label>
        <button onClick={() => void submit()}>로그인</button>
        {error && <div className="error form-wide">{error}</div>}
        {authActions.mode === 'local' && (
          <div className="meta form-wide">시연용 관리자 계정: {ADMIN_ID} / bandut1234!</div>
        )}
      </Card>
    </div>
  )
}

/** 고객·파트너 로그인 ↔ 가입 ↔ OTP 인증 (28-30-02, 시안 2 "OTP 간편가입") */
function MemberAuth({ role }: { role: SignupRole }) {
  const { platform, auth, authActions, refresh } = usePlatform()
  const [mode, setMode] = useState<'login' | 'signup' | 'otp'>('login')
  // 28-39-02: 탈퇴 직후 1회 안내
  const [notice] = useState(() => auth.consumeNotice())
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [bizNo, setBizNo] = useState('')
  // 28-36-02: 파트너 유형 — 사업자는 가입 시 사업자 정보 조회를 통과해야 한다
  const [partnerType, setPartnerType] = useState<PartnerType>('business')
  // 28-37-03: 약관 동의 — 필수 2건 + 선택 마케팅, 본문 인라인 보기
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [openDoc, setOpenDoc] = useState<'terms' | 'privacy' | null>(null)
  const allAgreed = agreeTerms && agreePrivacy && marketing
  const setAll = (on: boolean) => {
    setAgreeTerms(on)
    setAgreePrivacy(on)
    setMarketing(on)
  }
  const legal = platform.getSettings()
  const [issuedOtp, setIssuedOtp] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  // 28-70: 변경은 authActions로(async) — 로컬 모드면 auth를, 서버 모드면 /api/auth를 부른다
  const run = async (fn: () => Promise<void>) => {
    setError('')
    try {
      await fn()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  const doLogin = () =>
    run(async () => {
      await authActions.login(role, phone, password)
      refresh()
    })

  const doSignup = () =>
    run(async () => {
      const issued = await authActions.register({
        role,
        name,
        phone,
        password,
        ...(role === 'partner' ? { partnerType, bizNo: partnerType === 'business' ? bizNo : '' } : {}),
        agreeTerms,
        agreePrivacy,
        marketing,
      })
      setIssuedOtp(issued.otp)
      setCode('')
      setMode('otp')
    })

  const doVerify = () =>
    run(async () => {
      await authActions.verifyOtp(role, phone, code)
      // 인증 직후 자동 로그인 — 가입 흐름을 한 번에 끝낸다
      const session = await authActions.login(role, phone, password)
      // 28-32-03: 파트너 첫 가입이면 업체명으로 프로필 시드 — 고객 업체 카드에 실명 노출
      if (role === 'partner' && !platform.getProfile(session.accountId)) {
        platform.updateProfile({ ...DEFAULT_PARTNER_PROFILE, name: session.name }, session.accountId)
      }
      refresh()
    })

  const title = `${ROLE_LABEL[role]} ${mode === 'login' ? '로그인' : mode === 'signup' ? '회원가입' : '휴대폰 인증'}`

  return (
    <div className="auth-wrap">
      <Card className="form" title={title}>
        {mode === 'login' && (
          <>
            {notice && (
              <div className="meta form-wide gate-notice" data-gate-notice>
                {notice}
              </div>
            )}
            <label className="form-wide">
              휴대폰 번호
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                inputMode="numeric"
                autoComplete="username"
              />
            </label>
            <label className="form-wide">
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void doLogin()}
                autoComplete="current-password"
              />
            </label>
            <button onClick={() => void doLogin()}>로그인</button>
            <button
              className="btn-secondary"
              onClick={() => {
                setError('')
                setMode('signup')
              }}
            >
              처음이신가요? 회원가입
            </button>
          </>
        )}
        {mode === 'signup' && (
          <>
            <label>
              이름{role === 'partner' ? ' (업체명)' : ''}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={role === 'partner' ? '예: 반듯설비' : '예: 김반듯'}
              />
            </label>
            <label>
              휴대폰 번호
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                inputMode="numeric"
              />
            </label>
            <label>
              비밀번호 (8자 이상)
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            {role === 'partner' && (
              <div className="form-wide">
                <div className="meta" style={{ marginBottom: 6 }}>
                  파트너 유형
                </div>
                <div className="filter-group partner-type">
                  {(['business', 'individual'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={partnerType === t ? 'active' : ''}
                      onClick={() => {
                        setError('')
                        setPartnerType(t)
                      }}
                    >
                      {PARTNER_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {role === 'partner' && partnerType === 'business' && (
              <label>
                사업자등록번호
                <input
                  value={bizNo}
                  onChange={(e) => setBizNo(e.target.value)}
                  placeholder="000-00-00000"
                  inputMode="numeric"
                />
              </label>
            )}
            {role === 'partner' && (
              <div className="meta form-wide">
                {partnerType === 'business'
                  ? '가입 시 사업자 정보 조회(국세청 사업자등록번호 검증)를 통과해야 합니다.'
                  : '개인 파트너는 사업자등록번호 없이 가입하며, 회원 목록에 "개인"으로 표시됩니다.'}
              </div>
            )}
            <div className="consent form-wide">
              <label className="consent-all">
                <input
                  type="checkbox"
                  aria-label="전체 동의"
                  checked={allAgreed}
                  onChange={(e) => setAll(e.target.checked)}
                />
                전체 동의
              </label>
              <label className="consent-row">
                <input
                  type="checkbox"
                  aria-label="이용약관 동의"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                />
                <span>
                  <strong>[필수]</strong> 이용약관 동의
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setOpenDoc(openDoc === 'terms' ? null : 'terms')}
                >
                  보기
                </button>
              </label>
              <label className="consent-row">
                <input
                  type="checkbox"
                  aria-label="개인정보 수집·이용 동의"
                  checked={agreePrivacy}
                  onChange={(e) => setAgreePrivacy(e.target.checked)}
                />
                <span>
                  <strong>[필수]</strong> 개인정보 수집·이용 동의
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setOpenDoc(openDoc === 'privacy' ? null : 'privacy')}
                >
                  보기
                </button>
              </label>
              <label className="consent-row">
                <input
                  type="checkbox"
                  aria-label="마케팅 수신 동의"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                />
                <span>[선택] 마케팅 정보 수신 동의 (마이페이지에서 언제든 철회)</span>
              </label>
              {openDoc && <pre className="legal-doc">{openDoc === 'terms' ? legal.terms : legal.privacy}</pre>}
            </div>
            <button onClick={() => void doSignup()}>가입하고 인증번호 받기</button>
            <button
              className="btn-secondary"
              onClick={() => {
                setError('')
                setMode('login')
              }}
            >
              이미 계정이 있어요 — 로그인
            </button>
          </>
        )}
        {mode === 'otp' && (
          <>
            <div className="meta form-wide">{phone}로 인증번호를 보냈습니다. 6자리 숫자를 입력해 주세요.</div>
            <div className="otp-note form-wide">
              시연용 인증번호: <strong className="otp-code">{issuedOtp}</strong>
              <span className="meta"> (상용 서비스에서는 SMS로 발송됩니다)</span>
            </div>
            <label className="form-wide">
              인증번호
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void doVerify()}
                inputMode="numeric"
                placeholder="6자리"
                aria-label="인증번호"
              />
            </label>
            <button onClick={() => void doVerify()}>인증하고 시작하기</button>
          </>
        )}
        {error && <div className="error form-wide">{error}</div>}
      </Card>
    </div>
  )
}

/** 로그인 게이트 (28-30-02): 역할 세션이 없으면 로그인/가입 화면 */
export default function AuthGate({ role, children }: { role: AuthRole; children: ReactNode }) {
  const { auth } = usePlatform()
  if (auth.sessionFor(role)) return <>{children}</>
  return role === 'admin' ? <AdminLogin /> : <MemberAuth role={role} />
}

/** 헤더 로그인 상태 표시 + 로그아웃 (28-30-02) */
export function AuthStatus({ role }: { role: AuthRole }) {
  const { auth, authActions, refresh } = usePlatform()
  const session = auth.sessionFor(role)
  if (!session) return null
  return (
    <span className="auth-status">
      {session.name}님
      {session.role === 'admin' && session.grade !== undefined && (
        <span className={`grade-tag ${session.grade}`} data-session-grade={session.grade} style={{ marginLeft: 6 }}>
          {ADMIN_GRADE_LABEL[session.grade]}
        </span>
      )}
      <button
        onClick={() => {
          // 28-70: 서버 모드에서는 토큰도 폐기한다 — 로컬은 먼저 지우므로 서버가 안 닿아도 로그아웃이다
          void authActions.logout(role).finally(refresh)
        }}
      >
        로그아웃
      </button>
    </span>
  )
}
