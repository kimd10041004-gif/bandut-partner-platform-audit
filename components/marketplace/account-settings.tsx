'use client'
import { useCallback, useEffect, useState } from 'react'
import { MailCheck, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { changePassword, myAccount, setEmail, verifyEmail, type MyAccount } from '@/lib/auth-client'

/**
 * 계정 보안 (29-27) — 이메일 등록·인증과 비밀번호 변경.
 *
 * ## 왜 이제야
 *
 * 서버의 `changePassword` 는 28-33 부터, 계정 거울(`me`)은 28-70 부터 있었다. Next 화면으로 옮겨 오면서
 * (29-3) 이 둘을 다루는 화면이 따라오지 않았다 — 로그인한 사람이 비밀번호를 바꿀 자리가 없었다.
 *
 * ## 이메일은 인증해야 쓴다
 *
 * 비밀번호 찾기의 두 번째 길이다. 오타로 적은 남의 주소로 내 복구 코드가 가면 안 되므로 **인증한 주소만**
 * 복구에 쓴다(`server/domain/auth.ts`). 그래서 이 카드는 "저장" 이 아니라 "저장하고 인증 메일 받기" 다.
 * 메일이 아직 연결되지 않은 자리(로컬·CI)에서는 서버가 인증번호를 응답으로 주고, 화면이 그것을 보여 준다 —
 * 가입 인증번호와 같은 편의다.
 */
export function AccountSecurity() {
  const [account, setAccount] = useState<MyAccount | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [pending, setPending] = useState(false)
  const [issued, setIssued] = useState('')
  const [code, setCode] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    myAccount()
      .then((a) => {
        setAccount(a)
        setEmailInput((prev) => (prev === '' ? (a?.email ?? '') : prev))
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoaded(true))
  }, [])
  useEffect(load, [load])

  const verified = account?.email !== undefined && account.emailVerifiedAt !== undefined
  const sameAddress = account?.email !== undefined && account.email === emailInput.trim().toLowerCase()

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await setEmail(emailInput.trim())
      setIssued(r.otp)
      setCode('')
      setPending(true)
      toast.success(r.otp === '' ? `${r.email} 로 인증 메일을 보냈습니다.` : '인증번호를 발급했습니다.')
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await verifyEmail(code.trim())
      setPending(false)
      setIssued('')
      toast.success('이메일을 인증했습니다. 이제 이 주소로 비밀번호를 찾을 수 있습니다.')
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      toast.success('비밀번호를 바꿨습니다.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // 관리자는 계정이 아니라 카드가 없다. 읽기에 **실패**한 것은 다르다 — 그때는 카드를 남겨 오류를 보여 준다
  if (loaded && account === null && error === '') return null

  return (
    <section className="panel field-stack" data-account-security>
      <h2>계정 보안</h2>
      {error !== '' && (
        <p className="error" role="alert" data-security-error>
          {error}
        </p>
      )}

      <form className="field-stack" onSubmit={saveEmail} data-email-form>
        <h3>이메일</h3>
        <p className="small muted">
          비밀번호를 잊었을 때 휴대폰 번호 대신 이메일로도 찾을 수 있습니다. <strong>인증한 주소만</strong> 쓸 수
          있습니다.
        </p>
        {account?.email !== undefined && (
          <p className="small" data-email-status={verified ? 'verified' : 'unverified'}>
            {verified ? <MailCheck size={16} /> : null} {account.email} ·{' '}
            {verified ? '인증됨' : '아직 인증되지 않았습니다'}
          </p>
        )}
        <label className="field">
          이메일 주소
          <input
            type="email"
            required
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            data-email-input
          />
        </label>
        <button className="btn secondary" disabled={busy || (sameAddress && verified)} data-email-save>
          {busy ? '보내는 중…' : sameAddress ? (verified ? '인증된 이메일입니다' : '인증 메일 다시 받기') : '저장하고 인증 메일 받기'}
        </button>
      </form>

      {pending && (
        <form className="field-stack" onSubmit={verify} data-email-verify-form>
          {issued !== '' && (
            <div className="inline-notice" data-email-issued>
              <ShieldCheck size={20} />
              메일 발송이 아직 연결되지 않아 인증번호를 화면에 보여 드립니다: <strong>{issued}</strong>
            </div>
          )}
          <label className="field">
            메일로 받은 인증번호
            <input required value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" data-email-otp />
          </label>
          <button className="btn primary" disabled={busy} data-email-verify>
            {busy ? '확인 중…' : '이메일 인증'}
          </button>
        </form>
      )}

      <form className="field-stack" onSubmit={changePw} data-password-form>
        <h3>비밀번호 변경</h3>
        <label className="field">
          현재 비밀번호
          <input
            type="password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            data-password-current
          />
        </label>
        <label className="field">
          새 비밀번호
          <input
            type="password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            data-password-next
          />
        </label>
        <button className="btn secondary" disabled={busy} data-password-submit>
          {busy ? '바꾸는 중…' : '비밀번호 바꾸기'}
        </button>
      </form>
    </section>
  )
}
