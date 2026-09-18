import { useState } from 'react'
import { PARTNER_TYPE_LABEL, type AuthRole } from '../../../server/domain/auth'
import { usePlatform } from '../../app/PlatformContext'
import { toCsv } from '../../domain/csv'
import { downloadText } from '../../ui/download'
import { todayUTC } from '../../domain/platform'
import { STATUS_LABEL } from '../../ui/constants'
import { isKnownError, fmtPhone } from '../../ui/format'
import { PlatformError } from '../../domain/platform'
import { Card } from '../../ui/primitives'
import OverwrittenBox from '../../ui/OverwrittenBox'

const fmtBiz = (b: string) => `${b.slice(0, 3)}-${b.slice(3, 5)}-${b.slice(5)}`

/** 마이페이지 (28-33-02, 시안 "마이페이지"): 내 정보 + 비밀번호 변경. 고객 탭·파트너 마이 탭이 공유 */
export default function MyAccount({ role }: { role: AuthRole }) {
  const { auth, authActions, refresh } = usePlatform()
  const session = auth.sessionFor(role)
  const account = auth.accountFor(role)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const fmtDate = (iso: string) => iso.slice(0, 10)
  // 동의 내역 카드 전용 메시지 — 비밀번호 카드와 상태를 공유하지 않는다(실측 중 중복 표시 발견)
  const [consentError, setConsentError] = useState('')
  const [consentMessage, setConsentMessage] = useState('')
  // 28-39-02: 회원 탈퇴 — 비밀번호 확인 + 확인 체크, 진행 중 거래·지급 대기는 도메인이 차단
  const { platform } = usePlatform()
  const [wdPassword, setWdPassword] = useState('')
  const [wdConfirm, setWdConfirm] = useState(false)
  const [wdError, setWdError] = useState('')

  const withdraw = async () => {
    setWdError('')
    if (role === 'admin' || !account) return
    if (!wdConfirm) {
      setWdError('안내를 확인하고 동의 체크 후 진행해 주세요')
      return
    }
    try {
      if (role === 'customer' && platform.openTransactionCount(account.id) > 0) {
        throw new PlatformError('진행 중인 거래가 있어 탈퇴할 수 없습니다 — 거래 완료·결제 후 다시 시도해 주세요')
      }
      if (role === 'partner' && platform.partnerHasOpenWork()) {
        throw new PlatformError('진행 중인 작업 또는 지급 대기 정산이 있어 탈퇴할 수 없습니다')
      }
      await authActions.withdraw(role, wdPassword)
      if (role === 'customer') platform.anonymizeCustomer(account.id)
      refresh()
    } catch (err) {
      // 28-66-04: 예전에는 `isKnownError(err) || err instanceof Error`였다. DomainError가 Error를
      // 상속하므로 좌변은 죽은 조건이었고, 우변 때문에 TypeError 같은 진짜 버그의 메시지까지
      // 사용자에게 그대로 보였다. 이제 다른 화면과 같은 규약을 따른다.
      if (isKnownError(err)) setWdError(err.message)
      else throw err
    }
  }

  // 28-37-03: 마케팅 수신 동의·철회 — 로그인한 고객·파트너
  const toggleMarketing = async (on: boolean) => {
    setConsentError('')
    setConsentMessage('')
    if (role === 'admin') return
    try {
      await authActions.setMarketingOptIn(role, on)
      setConsentMessage(on ? '마케팅 수신에 동의했습니다' : '마케팅 수신을 철회했습니다')
      refresh()
    } catch (err) {
      if (isKnownError(err)) setConsentError(err.message)
      else throw err
    }
  }

  const change = async () => {
    setError('')
    setMessage('')
    if (next !== confirm) {
      setError('새 비밀번호 확인이 일치하지 않습니다')
      return
    }
    try {
      await authActions.changePassword(role, current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setMessage('비밀번호를 변경했습니다')
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  return (
    <>
      <Card title="내 정보">
        <div className="list-row">
          <div className="lr-title">이름</div>
          <div className="lr-right">{session?.name ?? '—'}</div>
        </div>
        {account && (
          <>
            <div className="list-row">
              <div className="lr-title">휴대폰</div>
              <div className="lr-right">{fmtPhone(account.phone)}</div>
            </div>
            {account.role === 'partner' && account.partnerType && (
              <div className="list-row">
                <div className="lr-title">파트너 유형</div>
                <div className="lr-right">{PARTNER_TYPE_LABEL[account.partnerType]}</div>
              </div>
            )}
            {account.bizNo && (
              <div className="list-row">
                <div className="lr-title">사업자등록번호</div>
                <div className="lr-right">{fmtBiz(account.bizNo)}</div>
              </div>
            )}
            {account.role === 'partner' && account.partnerType === 'business' && (
              <div className="list-row">
                <div className="lr-title">사업자 정보 조회</div>
                <div className="lr-right">{account.bizVerified ? '통과' : '미조회'}</div>
              </div>
            )}
            <div className="list-row">
              <div className="lr-title">본인인증</div>
              <div className="lr-right">{account.verified ? '완료' : '미완료'}</div>
            </div>
            <div className="list-row">
              <div className="lr-title">가입일</div>
              <div className="lr-right">{account.createdAt.slice(0, 10)}</div>
            </div>
            {session && (
              <div className="list-row" data-session-expiry>
                <div className="lr-title">로그인 유지</div>
                <div className="lr-right meta">
                  {new Date(session.expiresAt).toLocaleString('ko-KR')}까지 (이후 자동 로그아웃)
                </div>
              </div>
            )}
          </>
        )}
        {role === 'admin' && (
          <div className="list-row">
            <div className="lr-title">계정</div>
            <div className="lr-right">관리자 (admin)</div>
          </div>
        )}
      </Card>
      {account && (
        <Card title="동의 내역">
          <div className="list-row">
            <div className="lr-title">이용약관 (필수)</div>
            <div className="lr-right">동의 · {fmtDate(account.consent.termsAt)}</div>
          </div>
          <div className="list-row">
            <div className="lr-title">개인정보 수집·이용 (필수)</div>
            <div className="lr-right">동의 · {fmtDate(account.consent.privacyAt)}</div>
          </div>
          <div className="list-row" data-consent="marketing">
            <div className="lr-title">마케팅 수신 (선택)</div>
            <div className="lr-right consent-toggle">
              <span>
                {account.consent.marketing ? '수신 중' : account.consent.marketingAt ? '철회' : '미동의'}
                {account.consent.marketingAt && ` · ${fmtDate(account.consent.marketingAt)}`}
              </span>
              <label className="toggle">
                <input
                  type="checkbox"
                  aria-label="마케팅 수신 동의"
                  checked={account.consent.marketing}
                  onChange={(e) => void toggleMarketing(e.target.checked)}
                />
              </label>
            </div>
          </div>
          {consentError && (
            <div className="error" style={{ marginTop: 6 }}>
              {consentError}
            </div>
          )}
          {consentMessage && (
            <div className="meta" style={{ marginTop: 6 }}>
              {consentMessage}
            </div>
          )}
        </Card>
      )}
      <Card className="form" title="비밀번호 변경">
        <label>
          현재 비밀번호
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            aria-label="현재 비밀번호"
          />
        </label>
        <label>
          새 비밀번호 (8자 이상)
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            aria-label="새 비밀번호"
          />
        </label>
        <label className="form-wide">
          새 비밀번호 확인
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-label="새 비밀번호 확인"
          />
        </label>
        <button onClick={() => void change()}>비밀번호 변경</button>
        {error && <div className="error form-wide">{error}</div>}
        {message && <div className="meta form-wide">{message}</div>}
      </Card>
      {account && role !== 'admin' && (
        <Card className="form withdraw-card" title="회원 탈퇴">
          <div className="meta form-wide withdraw-note">
            탈퇴 즉시 <strong>이름·휴대폰·비밀번호·사업자번호·정산 계좌</strong>가 파기되고 로그아웃됩니다. 거래·결제
            기록은 전자상거래법에 따라 <strong>5년</strong>(분쟁 기록 3년) 비식별 상태로 보관 후 파기됩니다. 진행 중인
            거래나 지급 대기 정산이 있으면 탈퇴할 수 없습니다.
          </div>
          <label className="form-wide">
            비밀번호 확인
            <input
              type="password"
              value={wdPassword}
              onChange={(e) => setWdPassword(e.target.value)}
              autoComplete="current-password"
              aria-label="탈퇴 비밀번호"
            />
          </label>
          <label className="consent-row form-wide">
            <input
              type="checkbox"
              aria-label="탈퇴 안내 확인"
              checked={wdConfirm}
              onChange={(e) => setWdConfirm(e.target.checked)}
            />
            <span>안내를 확인했으며 탈퇴에 동의합니다</span>
          </label>
          <button className="btn-danger" onClick={() => void withdraw()}>
            회원 탈퇴
          </button>
          {wdError && <div className="error form-wide">{wdError}</div>}
        </Card>
      )}
      {role === 'customer' && session && <MyDataCard customerId={session.accountId} />}
    </>
  )
}

/**
 * 내 데이터 내보내기 (28-60-03, 개인정보보호법 열람·이동권):
 * 로그인한 본인 요청 범위의 데이터만 내려받는다 — 도메인이 요청 id 집합으로 엄격히 거른다.
 */
function MyDataCard({ customerId }: { customerId: string }) {
  const { platform, refresh } = usePlatform()
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const rows = platform.customerDataRows(customerId)

  const run = (fn: () => string) => {
    setErr('')
    try {
      setMsg(fn())
      refresh()
    } catch (e) {
      if (isKnownError(e)) setErr(e.message)
      else throw e
    }
  }

  return (
    <Card title="내 데이터 내보내기">
      <div className="meta form-wide" style={{ marginBottom: 8 }}>
        내가 등록한 요청과 그에 딸린 견적·방문·결제·환불·리뷰·분쟁·대화만 담깁니다. 다른 회원의 데이터는 포함되지
        않습니다.
      </div>
      <div className="row form-wide" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <button
          data-export-mydata
          disabled={rows.length === 0}
          onClick={() =>
            run(() => {
              const { json, requests } = platform.exportCustomerData(customerId)
              downloadText(`my-data-${todayUTC()}.json`, json, 'application/json')
              return `거래 ${requests}건을 JSON으로 내려받았습니다`
            })
          }
        >
          전체 JSON
        </button>
        <button
          className="btn-secondary"
          data-export-mydata-csv
          disabled={rows.length === 0}
          onClick={() =>
            run(() => {
              const csv = toCsv(
                ['요청', '등록일', '분야', '지역', '상태', '견적', '결제액'],
                rows.map((r) => [r[0], r[1], r[2], r[3], STATUS_LABEL[r[4]], r[5], r[6]]),
              )
              downloadText(`my-transactions-${todayUTC()}.csv`, csv, 'text/csv')
              return `거래 ${rows.length}건을 CSV로 내려받았습니다`
            })
          }
        >
          거래 요약 CSV
        </button>
        <span className="meta" data-mydata-count={rows.length}>
          내 거래 {rows.length}건
        </span>
      </div>
      {msg && (
        <div className="meta form-wide" style={{ marginTop: 6 }} data-mydata-msg>
          {msg}
        </div>
      )}
      {err && (
        <div className="error form-wide" style={{ marginTop: 6 }}>
          {err}
        </div>
      )}
      {/* 28-75-04: 보관은 이 기기에서 일어났고 보관함도 이 기기에만 있다 — 그 자리의 사람이 꺼낸다 */}
      <div className="form-wide">
        <OverwrittenBox restoreHint="관리자에게 전달하면 되살릴 수 있습니다" />
      </div>
    </Card>
  )
}
