import { useState } from 'react'
import type { SettlementFilter } from '../domain/platform'
import { payoutAccountLabel } from '../../server/domain/auth'
import { toCsv } from '../domain/csv'
import { downloadText } from '../ui/download'
import { usePlatform, usePartnerId } from '../app/PlatformContext'
import { isKnownError, krw } from '../ui/format'
import { Card, ToggleGroup } from '../ui/primitives'

const BANKS = [
  '국민은행',
  '신한은행',
  '우리은행',
  '하나은행',
  '농협은행',
  '기업은행',
  '카카오뱅크',
  '토스뱅크',
  '케이뱅크',
  '새마을금고',
  '우체국',
  '기타',
]

/** 정산 계좌 카드 (28-38-02 → 28-90): 등록/수정 폼 + 마스킹 표시. 예금주는 가입 이름과 같아야 하고, 관리자 인증 뒤 지급된다 */
function PayoutAccountCard() {
  const { auth, authActions, refresh } = usePlatform()
  const me = auth.accountFor('partner')
  const saved = me?.payoutAccount
  const [editing, setEditing] = useState(!saved)
  const [bank, setBank] = useState(saved?.bank ?? BANKS[0]!)
  const [number, setNumber] = useState(saved?.number ?? '')
  const [holder, setHolder] = useState(saved?.holder ?? '')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const submit = async () => {
    setError('')
    setMessage('')
    try {
      await authActions.setPayoutAccount({ bank, number, holder })
      setMessage('정산 계좌를 저장했습니다')
      setEditing(false)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  return (
    <Card className="form" title="정산 계좌">
      {!saved && (
        <div className="approval-banner pending form-wide" data-payout-banner>
          정산 계좌를 등록해야 지급됩니다 — 정산 확정 후 관리자가 이 계좌로 이체합니다.
        </div>
      )}
      {saved && !editing && (
        <>
          <div className="list-row form-wide">
            <div className="lr-title">등록 계좌</div>
            <div className="lr-right" data-payout-account>
              {payoutAccountLabel(saved)}
            </div>
          </div>
          <div className="meta form-wide" data-payout-verified={saved.verifiedAt ? 'yes' : 'no'}>
            최종 수정 {saved.updatedAt.slice(0, 10)} · 계좌번호는 마스킹되어 표시됩니다.
            {saved.verifiedAt ? (
              <>
                {' '}
                · <span className="pay-tag paid">인증됨 {saved.verifiedAt.slice(0, 10)}</span>
              </>
            ) : (
              <>
                {' '}
                · <span className="pay-tag waiting">인증 대기</span> — 관리자가 예금주·계좌를 확인한 뒤 지급됩니다
              </>
            )}
          </div>
          <button className="btn-secondary" onClick={() => setEditing(true)}>
            계좌 수정
          </button>
        </>
      )}
      {editing && (
        <>
          <label>
            은행
            <select value={bank} onChange={(e) => setBank(e.target.value)} aria-label="은행">
              {BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label>
            계좌번호 (숫자 10~14자리)
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              inputMode="numeric"
              placeholder="예: 123456-78-901234"
              aria-label="계좌번호"
            />
          </label>
          <label>
            예금주 — 가입한 이름과 같아야 합니다{me ? ` (${me.name})` : ''}
            <input
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              placeholder={me?.name ?? '가입한 이름'}
              aria-label="예금주"
            />
          </label>
          <button onClick={() => void submit()}>계좌 저장</button>
          {saved && (
            <button
              className="btn-secondary"
              onClick={() => {
                setEditing(false)
                setError('')
              }}
            >
              취소
            </button>
          )}
        </>
      )}
      {error && <div className="error form-wide">{error}</div>}
      {message && <div className="meta form-wide">{message}</div>}
    </Card>
  )
}

export default function Settlement() {
  const { platform } = usePlatform()
  const partnerId = usePartnerId()
  // 28-3-03: 미정산/정산 확정을 구분해 보여준다 — 28-41-03: 로그인한 파트너 범위
  const [filter, setFilter] = useState<SettlementFilter>('all')
  const rows = platform.settlements(filter, partnerId)
  const unsettled = platform.unsettledPayout(partnerId)
  const monthly = platform.monthlyReport(partnerId)
  // 28-38-02: 작업별 지급 상태
  const jobRows = platform.completedJobsOf(partnerId)
  // 28-47-03: 내 정산 내역 CSV
  const [csvMsg, setCsvMsg] = useState('')
  const exportMine = () => {
    const rows = platform.partnerLedger(partnerId)
    const csv = toCsv(
      ['요청', '완료일', '총액', '수수료', '지급액', '정산 확정', '지급일', '계좌'],
      rows.map((r) => [
        r.requestId,
        r.completedDate,
        r.total,
        r.fee,
        r.payout,
        r.settled ? 'Y' : 'N',
        r.paidAt,
        r.account,
      ]),
    )
    downloadText(`settlement-${partnerId}.csv`, csv, 'text/csv')
    setCsvMsg(`정산 내역 ${rows.length}행을 내려받았습니다`)
  }

  return (
    <div>
      <PayoutAccountCard />
      <Card title={`작업별 지급 상태 (${jobRows.length}건)`}>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 10, marginBottom: 6 }}>
          <button className="btn-secondary" onClick={exportMine} disabled={jobRows.length === 0} data-export-settlement>
            내 정산 내역 CSV
          </button>
          {csvMsg && <span className="meta">{csvMsg}</span>}
        </div>
        <div className="table-wrap" style={{ boxShadow: 'none', border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>요청</th>
                <th>완료일</th>
                <th className="num">지급액</th>
                <th>정산</th>
                <th>지급</th>
              </tr>
            </thead>
            <tbody>
              {jobRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="meta">
                    완료된 작업이 없습니다
                  </td>
                </tr>
              )}
              {jobRows.map((j) => (
                <tr key={j.requestId} className="payout-row">
                  <td>{j.requestId}</td>
                  <td>{j.completedDate}</td>
                  {/* 28-97: 지급액 = 총액 − 환불 − 수수료 */}
                  <td className="num">
                    {krw(platform.settlementFor(j.requestId)?.payable ?? j.total - j.platformFee)}
                  </td>
                  <td>
                    {j.settled ? (
                      <span className="pay-tag paid">확정</span>
                    ) : (
                      <span className="pay-tag waiting">미정산</span>
                    )}
                  </td>
                  <td>
                    {j.payout ? (
                      <span className="pay-tag paid">지급 완료 · {j.payout.paidAt.slice(0, 10)}</span>
                    ) : j.settled ? (
                      <span className="pay-tag waiting">지급 대기</span>
                    ) : (
                      <span className="meta">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="월별 요약">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>월</th>
                <th className="num">건수</th>
                <th className="num">총액</th>
                <th className="num">수수료(3%)</th>
                <th className="num">지급액</th>
                <th className="num">미정산</th>
              </tr>
            </thead>
            <tbody>
              {monthly.length === 0 && (
                <tr>
                  <td colSpan={6} className="meta">
                    완료된 작업이 없습니다
                  </td>
                </tr>
              )}
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="num">{m.jobCount}</td>
                  <td className="num">{krw(m.totalAmount)}</td>
                  <td className="num">{krw(m.totalFee)}</td>
                  <td className="num">{krw(m.payout)}</td>
                  <td className="num">{krw(m.unsettledPayout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="card row" style={{ marginBottom: 12 }}>
        <span>
          미정산 지급 예정 합계: <strong>{krw(unsettled)}</strong>
        </span>
        <ToggleGroup
          label="정산 상태 필터"
          value={filter}
          buttonStyle={{ marginLeft: 6 }}
          options={(['all', 'unsettled', 'settled'] as const).map((f) => ({
            value: f,
            label: f === 'all' ? '전체' : f === 'unsettled' ? '미정산' : '정산 완료',
          }))}
          onChange={(f) => setFilter(f as typeof filter)}
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>파트너</th>
              <th>주차</th>
              <th className="num">건수</th>
              <th className="num">총액</th>
              <th className="num">수수료</th>
              <th className="num">지급액</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="meta">
                  해당하는 작업이 없습니다
                </td>
              </tr>
            )}
            {rows.map((s) => (
              <tr key={`${s.partnerId}-${s.week}`}>
                <td>{s.partnerId}</td>
                <td>{s.week}</td>
                <td className="num">{s.jobCount}</td>
                <td className="num">{krw(s.totalAmount)}</td>
                <td className="num">{krw(s.totalFee)}</td>
                <td className="num">{krw(s.payout)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
