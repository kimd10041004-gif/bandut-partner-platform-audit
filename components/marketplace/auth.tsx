'use client'
/**
 * 우리 로그인·가입 화면 (29-6).
 *
 * 29-3이 v17 화면을 들여올 때 로그인 화면만 v17 것이 그대로 따라 들어왔다 — ChatGPT 로그인 버튼이
 * `/signin-with-chatgpt`로 보내는데 우리 앱에 그 경로가 없어 404였다. 서버 인증은 멀쩡했다.
 * 이 파일이 그 빠진 절반이다. 부르는 곳은 `lib/auth-client.ts` 하나다.
 */
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  login,
  register,
  requestPasswordReset,
  resetPassword,
  verifyOtp,
  type LoginRole,
  type RecoveryChannel,
  type SignupRole,
} from '@/lib/auth-client'
import { PageHeading, useAccount } from './shell'

const ROLE_LABEL: Record<LoginRole, string> = { customer: '고객', partner: '파트너', admin: '관리자' }

function useAfterAuth() {
  const router = useRouter()
  const { reload } = useAccount()
  /** 로그인 뒤 화면을 새로 읽는다 — 토큰만 저장하고 끝내면 헤더가 예전 상태로 남는다 */
  return (to: string) => {
    reload()
    router.replace(to)
    router.refresh()
  }
}

const HOME_FOR: Record<LoginRole, string> = { customer: '/mypage', partner: '/partner', admin: '/admin' }

/**
 * 29-10: 관리자 로그인은 공개 화면에서 고르는 것이 아니다.
 *
 * `/login`이 세 역할을 나란히 내걸고 있었다. 손님 누구나 "관리자"를 골라 비밀번호를 넣어 볼 수
 * 있다는 뜻이고, 운영자 문이 어디인지도 대놓고 알려 준다. 서버가 막아 주더라도 문을 내걸 이유는
 * 없다.
 *
 * 이제 `/login`·`/login/partner`는 고객·파트너만 고른다. 관리자는 `/login/admin` 한 자리뿐이고,
 * 그 주소는 화면 어디에서도 링크하지 않는다 — 아는 사람만 직접 친다.
 */
const PUBLIC_ROLES = ['customer', 'partner'] as const

/**
 * 29-12: 화면에서 역할을 바꾸면 주소도 따라간다.
 *
 * 명세 2절이 요구하는 것은 두 가지다 — 주소의 `role`을 초기값으로 쓰고, 화면에서 바꾸면 주소도
 * 갱신한다. 그래야 새로고침하거나 로그인 화면으로 돌아와도 고르던 자리가 남는다.
 *
 * `router.replace`가 아니라 `history.replaceState`를 쓴다. 이 주소는 되돌아갈 지점이 아니라
 * **지금 화면의 표기**라서, 뒤로 가기 기록에 역할을 바꾼 횟수만큼 쌓이면 안 된다. 서버를 다시
 * 부르지도 않는다.
 */
function keepRoleInUrl(role: string): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (url.searchParams.get('role') === role) return
  url.searchParams.set('role', role)
  window.history.replaceState(null, '', url.toString())
}

export function LoginPage({ initialRole = 'customer' }: { initialRole?: LoginRole }) {
  const adminOnly = initialRole === 'admin'
  const [role, setRole] = useState<LoginRole>(initialRole)
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const done = useAfterAuth()

  return (
    <div className="workspace auth-page">
      <PageHeading
        eyebrow="SIGN IN"
        title={adminOnly ? '관리자 로그인' : '로그인'}
        description={
          adminOnly
            ? '운영자 전용 화면입니다. 관리자 아이디와 비밀번호로 로그인합니다.'
            : '가입할 때 쓴 휴대폰 번호와 비밀번호로 로그인합니다.'
        }
      />
      <form
        className="panel field-stack"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            await login(role, id.trim(), password)
            done(HOME_FOR[role])
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <fieldset hidden={adminOnly}>
          <legend className="section-label">어떤 계정인가요?</legend>
          <div className="check-grid" role="radiogroup" aria-label="계정 종류">
            {PUBLIC_ROLES.map((r) => (
              <label className="check-line" key={r}>
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={role === r}
                  onChange={() => {
                    setRole(r)
                    keepRoleInUrl(r)
                  }}
                  data-login-role={r}
                />
                {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          {role === 'admin' ? '관리자 아이디' : '휴대폰 번호'}
          <input
            required
            value={id}
            onChange={(e) => setId(e.target.value)}
            autoComplete={role === 'admin' ? 'username' : 'tel'}
            placeholder={role === 'admin' ? '' : '010-0000-0000'}
            data-login-id
          />
        </label>
        <label className="field">
          비밀번호
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            data-login-password
          />
        </label>
        {error && (
          <p className="error" role="alert" data-login-error>
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy} data-login-submit>
          {busy ? '확인 중…' : '로그인'} <ArrowRight size={17} />
        </button>
      </form>
      <p className="small muted">
        계정이 없으신가요?{' '}
        <Link className="inline-link" href={`/signup?role=${adminOnly ? 'customer' : role}`}>
          회원가입
        </Link>
      </p>
      {!adminOnly && (
        <p className="small muted">
          비밀번호를 잊으셨나요?{' '}
          <Link className="inline-link" href={`/password/reset?role=${role}`} data-reset-link>
            비밀번호 찾기
          </Link>
        </p>
      )}
    </div>
  )
}

/** 가입은 두 걸음이다 — 신청하고, 인증번호를 확인해야 계정이 살아난다(28-31) */
export function SignupPage({ initialRole = 'customer' }: { initialRole?: SignupRole }) {
  const [step, setStep] = useState<'form' | 'otp'>('form')
  const [role, setRole] = useState<SignupRole>(initialRole)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [partnerType, setPartnerType] = useState<'business' | 'individual'>('individual')
  const [bizNo, setBizNo] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [otp, setOtp] = useState('')
  const [issued, setIssued] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const done = useAfterAuth()

  if (step === 'otp')
    return (
      <div className="workspace auth-page">
        <PageHeading
          eyebrow="SIGN UP"
          title="인증번호 확인"
          description="받으신 인증번호를 입력하면 가입이 끝납니다."
        />
        <form
          className="panel field-stack"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError('')
            try {
              await verifyOtp(role, phone.trim(), otp.trim())
              await login(role, phone.trim(), password)
              done(role === 'partner' ? '/partner/profile' : '/mypage')
            } catch (err) {
              setError((err as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {issued !== '' && (
            <div className="inline-notice" data-otp-issued>
              <ShieldCheck size={20} />
              문자 발송이 아직 연결되지 않아 인증번호를 화면에 보여 드립니다: <strong>{issued}</strong>
            </div>
          )}
          <label className="field">
            인증번호
            <input required value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" data-otp-input />
          </label>
          {error && (
            <p className="error" role="alert" data-signup-error>
              {error}
            </p>
          )}
          <button className="btn primary" disabled={busy} data-otp-submit>
            {busy ? '확인 중…' : '가입 완료'} <ArrowRight size={17} />
          </button>
          <button type="button" className="btn secondary" onClick={() => setStep('form')}>
            입력 내용 고치기
          </button>
        </form>
      </div>
    )

  return (
    <div className="workspace auth-page">
      <PageHeading eyebrow="SIGN UP" title="회원가입" description="휴대폰 번호로 본인 확인을 하면 가입이 끝납니다." />
      <form
        className="panel field-stack"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            const r = await register({
              role,
              name: name.trim(),
              phone: phone.trim(),
              password,
              ...(role === 'partner' ? { partnerType } : {}),
              ...(role === 'partner' && partnerType === 'business' ? { bizNo: bizNo.trim() } : {}),
              agreeTerms,
              agreePrivacy,
              marketing,
              ...(email.trim() !== '' ? { email: email.trim() } : {}),
            })
            setIssued(r.otp)
            setStep('otp')
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <fieldset>
          <legend className="section-label">어떤 계정으로 가입하세요?</legend>
          <div className="check-grid" role="radiogroup" aria-label="가입 종류">
            {(['customer', 'partner'] as const).map((r) => (
              <label className="check-line" key={r}>
                <input
                  type="radio"
                  name="signup-role"
                  value={r}
                  checked={role === r}
                  onChange={() => {
                    setRole(r)
                    keepRoleInUrl(r)
                  }}
                  data-signup-role={r}
                />
                {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          이름
          <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} data-signup-name />
        </label>
        <label className="field">
          휴대폰 번호
          <input
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-0000-0000"
            data-signup-phone
          />
        </label>
        <label className="field">
          비밀번호
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            data-signup-password
          />
        </label>
        <label className="field">
          이메일 (선택)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            data-signup-email
          />
        </label>
        <p className="small muted">
          비밀번호를 잊었을 때 이메일로도 찾을 수 있습니다. 가입 뒤 내 계정에서 인증하면 쓸 수 있습니다.
        </p>
        {role === 'partner' && (
          <>
            <fieldset>
              <legend className="section-label">파트너 유형</legend>
              <div className="check-grid" role="radiogroup" aria-label="파트너 유형">
                {(['individual', 'business'] as const).map((t) => (
                  <label className="check-line" key={t}>
                    <input
                      type="radio"
                      name="partner-type"
                      value={t}
                      checked={partnerType === t}
                      onChange={() => setPartnerType(t)}
                    />
                    {t === 'business' ? '사업자' : '개인'}
                  </label>
                ))}
              </div>
            </fieldset>
            {partnerType === 'business' && (
              <label className="field">
                사업자등록번호
                <input required value={bizNo} onChange={(e) => setBizNo(e.target.value)} placeholder="000-00-00000" />
              </label>
            )}
          </>
        )}
        <label className="check-line">
          <Checkbox checked={agreeTerms} onCheckedChange={(v) => setAgreeTerms(v === true)} />
          <Link className="inline-link" href="/terms">
            이용약관
          </Link>
          에 동의합니다 (필수)
        </label>
        <label className="check-line">
          <Checkbox checked={agreePrivacy} onCheckedChange={(v) => setAgreePrivacy(v === true)} />
          <Link className="inline-link" href="/privacy">
            개인정보 수집·이용
          </Link>
          에 동의합니다 (필수)
        </label>
        <label className="check-line">
          <Checkbox checked={marketing} onCheckedChange={(v) => setMarketing(v === true)} />
          혜택·소식 안내를 받겠습니다 (선택)
        </label>
        {error && (
          <p className="error" role="alert" data-signup-error>
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy} data-signup-submit>
          {busy ? '신청 중…' : '인증번호 받기'} <ArrowRight size={17} />
        </button>
      </form>
      <p className="small muted">
        이미 계정이 있으신가요?{' '}
        <Link className="inline-link" href={`/login?role=${role}`}>
          로그인
        </Link>
      </p>
    </div>
  )
}

/**
 * 비밀번호 찾기 (29-12) — 세 걸음이다.
 *
 * 휴대폰 → 재설정 인증번호 → 새 비밀번호. 성공하면 서버가 이 계정의 **기존 세션을 모두 폐기**한다.
 * 비밀번호를 도둑맞아 바꾸는 것이라면, 그 도둑의 세션이 살아 있는 채로 끝나는 복구는 복구가 아니다.
 *
 * 이미 가입한 사람이 자기 번호로 받는다. 예전에는 가입용 코드를 함께 물었는데, 코드가
 * 바뀐 뒤 기존 회원이 복구할 수 없게 된다.
 *
 * 서버는 없는 번호에도 같은 모양으로 답한다. 그래서 이 화면도 "보냈다"까지만 말한다 — 가입 여부를
 * 응답으로 훑을 수 없어야 한다.
 */
export function PasswordResetPage({ initialRole = 'customer' }: { initialRole?: SignupRole }) {
  const router = useRouter()
  const [step, setStep] = useState<'target' | 'confirm'>('target')
  const [role, setRole] = useState<SignupRole>(initialRole)
  /** 29-27: 휴대폰 번호로 받거나, 내 계정에서 인증한 이메일로 받는다 */
  const [channel, setChannel] = useState<RecoveryChannel>('phone')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [issued, setIssued] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const target = channel === 'email' ? email.trim() : phone.trim()

  if (step === 'confirm')
    return (
      <div className="workspace auth-page">
        <PageHeading
          eyebrow="RESET"
          title="새 비밀번호 정하기"
          description="받으신 인증번호와 새로 쓰실 비밀번호를 입력해 주세요."
        />
        <form
          className="panel field-stack"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError('')
            try {
              await resetPassword(role, target, otp.trim(), password)
              router.replace(`/login?role=${role}`)
            } catch (err) {
              setError((err as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {issued !== '' && (
            <div className="inline-notice" data-reset-issued>
              <ShieldCheck size={20} />
              {channel === 'email' ? '메일' : '문자'} 발송이 아직 연결되지 않아 인증번호를 화면에 보여 드립니다:{' '}
              <strong>{issued}</strong>
            </div>
          )}
          {issued === '' && (
            <p className="small muted" data-reset-sent>
              {channel === 'email'
                ? '등록·인증된 이메일이면 인증번호를 보냈습니다. 메일함(스팸함도)을 확인해 주세요.'
                : '가입된 번호면 인증번호를 보냈습니다.'}
            </p>
          )}
          <label className="field">
            인증번호
            <input required value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" data-reset-otp />
          </label>
          <label className="field">
            새 비밀번호
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              data-reset-password
            />
          </label>
          {error && (
            <p className="error" role="alert" data-reset-error>
              {error}
            </p>
          )}
          <button className="btn primary" disabled={busy} data-reset-submit>
            {busy ? '바꾸는 중…' : '비밀번호 바꾸기'} <ArrowRight size={17} />
          </button>
          <button type="button" className="btn secondary" onClick={() => setStep('target')}>
            다시 입력
          </button>
        </form>
        <p className="small muted">비밀번호를 바꾸면 로그인되어 있던 기기에서 모두 로그아웃됩니다.</p>
      </div>
    )

  return (
    <div className="workspace auth-page">
      <PageHeading
        eyebrow="RESET"
        title="비밀번호 찾기"
        description="가입할 때 쓰신 휴대폰 번호, 또는 내 계정에서 인증한 이메일로 인증번호를 보내 드립니다."
      />
      <form
        className="panel field-stack"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            const r = await requestPasswordReset(role, target)
            setIssued(r.otp)
            setStep('confirm')
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <fieldset>
          <legend className="section-label">어떤 계정인가요?</legend>
          <div className="check-grid" role="radiogroup" aria-label="계정 종류">
            {PUBLIC_ROLES.map((r) => (
              <label className="check-line" key={r}>
                <input
                  type="radio"
                  name="reset-role"
                  value={r}
                  checked={role === r}
                  onChange={() => {
                    setRole(r)
                    keepRoleInUrl(r)
                  }}
                  data-reset-role={r}
                />
                {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="section-label">인증번호를 어디로 받을까요?</legend>
          <div className="check-grid" role="radiogroup" aria-label="인증 방법">
            {(['phone', 'email'] as const).map((c) => (
              <label className="check-line" key={c}>
                <input
                  type="radio"
                  name="reset-channel"
                  value={c}
                  checked={channel === c}
                  onChange={() => setChannel(c)}
                  data-reset-channel={c}
                />
                {c === 'phone' ? '휴대폰 번호' : '이메일'}
              </label>
            ))}
          </div>
        </fieldset>
        {channel === 'phone' ? (
          <label className="field">
            휴대폰 번호
            <input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="010-0000-0000"
              data-reset-phone
            />
          </label>
        ) : (
          <>
            <label className="field">
              이메일
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                data-reset-email
              />
            </label>
            <p className="small muted">내 계정에서 인증한 이메일만 쓸 수 있습니다.</p>
          </>
        )}
        {error && (
          <p className="error" role="alert" data-reset-error>
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy} data-reset-request>
          {busy ? '보내는 중…' : '인증번호 받기'} <ArrowRight size={17} />
        </button>
      </form>
      <p className="small muted">
        <Link className="inline-link" href={`/login?role=${role}`}>
          로그인으로 돌아가기
        </Link>
      </p>
    </div>
  )
}
