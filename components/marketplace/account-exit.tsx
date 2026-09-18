'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { withdraw, withdrawCheck, type ExitBlock } from '@/lib/auth-client'

/**
 * 회원 탈퇴 (29-24).
 *
 * ## 왜 이제야
 *
 * 서버의 `withdraw`는 28-39 부터 있었다. 그런데 Next 화면으로 옮겨 오면서(29-3) 이 버튼이 따라오지
 * 않았고, 그 뒤로 **사용자가 나갈 방법이 없는 채로** 라운드가 계속 돌았다.
 *
 * ## 이 카드가 지키는 것 셋
 *
 * **하나. 되돌릴 수 없다고 먼저 말한다.** 누르고 나서 알게 하지 않는다.
 *
 * **둘. 왜 안 되는지를 누르기 전에 보여 준다.** 진행 중인 거래가 있으면 버튼 대신 그 목록이 나온다.
 * 서버도 같은 것을 다시 보므로(`server/accountExit.ts`) 이 화면은 **안내이지 자물쇠가 아니다.**
 *
 * **셋. 비밀번호를 받는다.** 남이 열어 둔 화면에서 탈퇴시킬 수 없게 한다.
 *
 * ## 관리자는 여기 오지 않는다
 *
 * 관리자 계정은 스스로 나가는 것이 아니라 소유자가 제거한다(28-89). 그래서 이 카드는 고객·파트너
 * 화면에만 붙는다.
 */
export function AccountExit() {
  const router = useRouter()
  const [blocks, setBlocks] = useState<ExitBlock[] | null>(null)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const check = useCallback(() => {
    withdrawCheck()
      .then(setBlocks)
      .catch((e) => setError((e as Error).message))
  }, [])
  useEffect(check, [check])

  const blocked = blocks !== null && blocks.length > 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await withdraw(password)
      // 탈퇴한 계정으로 남은 화면을 계속 그리지 않는다 — 첫 화면으로 보내고 새로 읽는다
      router.replace('/')
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
      // 거절 이유가 바뀌었을 수 있다(그 사이 주문이 하나 더 들어왔다든지)
      check()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel field-stack" data-account-exit>
      <h2>회원 탈퇴</h2>
      <p className="small muted">
        탈퇴하시면 이름과 연락처는 즉시 파기됩니다. 거래·결제 기록은 법이 정한 기간 동안 보관한 뒤
        파기됩니다. <strong>되돌릴 수 없습니다.</strong>
      </p>

      {error !== '' && (
        <p className="error" role="alert" data-exit-error>
          {error}
        </p>
      )}

      {blocked ? (
        <div className="inline-notice" data-exit-blocked>
          <AlertTriangle size={20} />
          <div>
            <strong>지금은 탈퇴하실 수 없습니다.</strong>
            <ul>
              {blocks.map((b) => (
                <li key={b.kind} data-exit-block={b.kind}>
                  {b.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : blocks === null ? (
        <p className="small muted">확인하는 중…</p>
      ) : open ? (
        <form className="field-stack" onSubmit={submit}>
          <label className="field">
            비밀번호를 한 번 더 입력해 주세요
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              data-exit-password
            />
          </label>
          <div className="action-row">
            <button className="btn primary" disabled={busy} data-exit-submit>
              {busy ? '처리 중…' : '탈퇴합니다'}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setPassword('')
                setError('')
              }}
            >
              그만두기
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn secondary" data-exit-open onClick={() => setOpen(true)}>
          탈퇴하기
        </button>
      )}
    </section>
  )
}
