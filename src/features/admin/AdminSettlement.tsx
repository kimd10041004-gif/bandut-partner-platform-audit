import { useState } from 'react'
import { payoutAccountLabels } from '../../../server/domain/auth'
import { toCsv } from '../../domain/csv'
import { downloadText } from '../../ui/download'
import { usePlatform } from '../../app/PlatformContext'
import { isKnownError, krw } from '../../ui/format'
import { ICON } from '../../ui/icons'
import { Card, Stat } from '../../ui/primitives'

/** 정산 감독 (28-14-03): 월별 수수료 수익 + 파트너×주차 정산 전체 + 지급 처리 (28-38-03) */
export default function AdminSettlement() {
  const { platform, auth, authActions, refresh } = usePlatform()
  const monthly = platform.monthlyReport()
  const weekly = platform.settlements('all')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  // 28-47-02: 월별 원장 + CSV
  const months = platform.ledgerMonths()
  const [month, setMonth] = useState<string>(months[0] ?? '')
  const ledgerMonth = months.includes(month) ? month : (months[0] ?? '')
  const ledgerRows = ledgerMonth ? platform.ledger(ledgerMonth) : []
  const summary = platform.ledgerSummary(ledgerMonth || undefined)
  const exportLedger = () => {
    const csv = toCsv(
      ['날짜', '구분', '요청', '상대방', '금액', '참조', '메모'],
      ledgerRows.map((r) => [r.date, r.type, r.requestId, r.counterparty, r.amount, r.ref, r.memo]),
    )
    downloadText(`ledger-${ledgerMonth || 'all'}.csv`, csv, 'text/csv')
    setMessage(`원장 CSV ${ledgerRows.length}행을 내려받았습니다 (ledger-${ledgerMonth || 'all'}.csv)`)
  }
  // 28-38-03: 지급 대기·완료 — 파트너 정산 계좌는 파트너 계정(auth)에 있다
  const pending = platform.pendingPayouts()
  const paid = platform.paidPayouts()
  // 28-41-03: 작업의 partnerId(= 파트너 계정 id)로 계좌·이름을 찾는다 — 구 스냅샷의 P-001은 계정이 없다
  const accounts = auth.listAccounts()
  const partnerAccountOf = (partnerId: string) => accounts.find((a) => a.id === partnerId && a.role === 'partner')
  const accountLabelOf = (partnerId: string) => {
    const acc = partnerAccountOf(partnerId)?.payoutAccount
    // 28-67-01: 표기 두 벌을 넘긴다 — 운영 기록에는 실명, 파일로 나가는 산출물에는 마스킹본
    return acc ? payoutAccountLabels(acc) : undefined
  }
  const partnerNameOf = (partnerId: string) =>
    partnerAccountOf(partnerId)?.name ?? platform.getProfile(partnerId)?.name ?? partnerId

  const pay = (requestId: string, partnerId: string) => {
    setError('')
    setMessage('')
    try {
      const job = platform.markPayout(requestId, accountLabelOf(partnerId))
      setMessage(`${requestId} 지급 완료 — ${krw(job.payout?.amount ?? 0)}`)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  // 28-97: 부분 환불 — 지급 전 완료 거래에 걸고, 완료되면 수수료·지급액이 다시 산정된다
  const settleJobs = platform.completedJobs.filter((j) => !j.payout)
  const [refundAmount, setRefundAmount] = useState<Record<string, string>>({})
  const [refundReason, setRefundReason] = useState<Record<string, string>>({})
  const addRefund = (requestId: string) => {
    setError('')
    setMessage('')
    try {
      const amount = Number((refundAmount[requestId] ?? '').replace(/[^0-9]/g, '') || '0')
      const refund = platform.requestRefund(requestId, { amount, reason: refundReason[requestId] ?? '' })
      setMessage(
        `${requestId} 환불 등록 — ${krw(refund.amount)} · 아래 "환불 대기"에서 처리하면 지급액이 다시 산정됩니다`,
      )
      setRefundAmount({ ...refundAmount, [requestId]: '' })
      setRefundReason({ ...refundReason, [requestId]: '' })
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  // 28-90: 계좌 인증 — 관리자가 예금주·계좌를 외부에서 확인했다고 기록한다. 인증 전에는 지급되지 않는다
  const verify = async (partnerId: string) => {
    setError('')
    setMessage('')
    try {
      await authActions.verifyPayoutAccount(partnerId)
      setMessage(`${partnerNameOf(partnerId)} 정산 계좌를 인증했습니다`)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  // 28-28-03: 결제 현황 — 완료·정산 거래의 고객 결제 상태
  const payRows = platform.store
    .list()
    .filter(
      (r) =>
        r.status === 'completed' ||
        r.status === 'settled' ||
        (r.status === 'cancelled' && platform.refundFor(r.id) !== undefined),
    )

  return (
    <div>
      <div className="stat-grid">
        <Stat tone="amber" icon={ICON.wallet} label="지급 대기 금액">
          {krw(platform.pendingPayoutAmount())}
        </Stat>
        <Stat tone="green" icon={ICON.work} label="지급 완료">
          {paid.length}
          <small>건</small>
        </Stat>
      </div>
      <Card title="월별 원장" className="ledger-card">
        <div className="row" style={{ justifyContent: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ margin: 0 }}>
            월
            <select
              aria-label="원장 월"
              value={ledgerMonth}
              onChange={(e) => setMonth(e.target.value)}
              disabled={months.length === 0}
            >
              {months.length === 0 && <option value="">기록 없음</option>}
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button onClick={exportLedger} disabled={ledgerRows.length === 0} data-export-ledger>
            CSV 내보내기
          </button>
          {message && <span className="meta">{message}</span>}
        </div>
        <div className="bidstats" style={{ marginTop: 8 }} data-ledger-summary>
          <span className="rate">{krw(summary.net)}</span>
          <span className="part">
            순액 (입금 {krw(summary.inflow)} − 출금 {krw(summary.outflow)})
          </span>
          <span className="part">
            플랫폼 수수료 {krw(summary.fee)} · {summary.rows}행
          </span>
        </div>
        <div className="table-wrap" style={{ boxShadow: 'none', border: 'none', marginTop: 6 }}>
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>구분</th>
                <th>요청</th>
                <th>상대방</th>
                <th className="num">금액</th>
                <th>참조</th>
                <th>메모</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="meta">
                    해당 월의 기록이 없습니다
                  </td>
                </tr>
              )}
              {ledgerRows.map((r, i) => (
                <tr key={`${r.ref}-${i}`} className="ledger-row">
                  <td>{r.date}</td>
                  <td>
                    <span className={`pay-tag ${r.amount < 0 ? 'waiting' : 'paid'}`}>{r.type}</span>
                  </td>
                  <td>{r.requestId}</td>
                  <td>{r.counterparty}</td>
                  <td className="num">{r.amount < 0 ? `−${krw(-r.amount)}` : krw(r.amount)}</td>
                  <td>{r.ref}</td>
                  <td className="meta">{r.memo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={`정산 내역 (${settleJobs.length}건) — 총액 − 환불 − 수수료`}>
        <div className="meta">
          지급액은 <strong>총액 − 환불 − 수수료</strong>입니다. 환불을 등록하면 처리될 때까지 정산 확정·지급이 보류되고,
          처리되면 수수료가 (총액 − 환불) 기준으로 다시 산정됩니다. 결제사 취소는 이 기록과 별개로 진행합니다.
        </div>
        {settleJobs.length === 0 && <div className="meta">정산 대상 작업이 없습니다</div>}
        {settleJobs.map((j) => {
          const f = platform.settlementFor(j.requestId)
          if (!f) return null
          return (
            <div key={j.requestId} className="list-row" data-settlement={j.requestId}>
              <div>
                <div className="lr-title">
                  {j.requestId} · {partnerNameOf(j.partnerId)}
                </div>
                <div className="lr-sub" data-settlement-breakdown>
                  총액 {krw(f.gross)} − 환불 {krw(f.refunded)} − 수수료 {krw(f.fee)} ({f.bps / 100}%) ={' '}
                  <strong>{krw(f.payable)}</strong>
                  {f.pendingRefund > 0 && <> · 환불 대기 {krw(f.pendingRefund)} (처리 후 재산정)</>}
                </div>
                <div className="row" style={{ justifyContent: 'flex-start', gap: 6, marginTop: 6 }}>
                  <input
                    value={refundAmount[j.requestId] ?? ''}
                    onChange={(e) => setRefundAmount({ ...refundAmount, [j.requestId]: e.target.value })}
                    inputMode="numeric"
                    placeholder="환불 금액(원)"
                    aria-label="환불 금액"
                    style={{ width: 130 }}
                  />
                  <input
                    value={refundReason[j.requestId] ?? ''}
                    onChange={(e) => setRefundReason({ ...refundReason, [j.requestId]: e.target.value })}
                    placeholder="환불 사유"
                    aria-label="환불 사유"
                    style={{ width: 220 }}
                  />
                  <button className="btn-secondary" onClick={() => addRefund(j.requestId)} data-add-refund>
                    환불 등록
                  </button>
                </div>
              </div>
              <div className="lr-right">
                <strong>{krw(f.payable)}</strong>
              </div>
            </div>
          )
        })}
      </Card>
      <Card title={`지급 대기 (${pending.length}건)`}>
        <div className="meta">
          정산 확정된 작업입니다. 파트너 계좌로 이체한 뒤 "지급 완료"를 눌러 기록을 남기세요 — 계좌 미등록·미인증
          파트너, 분쟁 검토 중인 거래는 지급할 수 없습니다.
        </div>
        {error && (
          <div className="error" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}
        {message && (
          <div className="meta" style={{ marginTop: 8 }}>
            {message}
          </div>
        )}
        <div className="table-wrap" style={{ boxShadow: 'none', border: 'none', marginTop: 6 }}>
          <table>
            <thead>
              <tr>
                <th>요청</th>
                <th>파트너</th>
                <th>완료일</th>
                <th className="num">지급액</th>
                <th>계좌</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 && (
                <tr>
                  <td colSpan={6} className="meta">
                    지급 대기 작업이 없습니다
                  </td>
                </tr>
              )}
              {pending.map((j) => {
                const acc = accountLabelOf(j.partnerId)
                const disputed = platform.hasOpenClaim(j.requestId)
                return (
                  <tr
                    key={j.requestId}
                    className="pending-payout-row"
                    data-payout-held={disputed ? 'dispute' : undefined}
                  >
                    <td>{j.requestId}</td>
                    <td>
                      {partnerNameOf(j.partnerId)} <span className="meta">({j.partnerId})</span>
                    </td>
                    <td>{j.completedDate}</td>
                    <td className="num">
                      <strong>{krw(platform.settlementFor(j.requestId)?.payable ?? j.total - j.platformFee)}</strong>
                    </td>
                    <td>
                      {acc === undefined && <span className="pay-tag waiting">계좌 미등록</span>}
                      {acc !== undefined && (
                        <>
                          {acc.label}{' '}
                          {acc.verified ? (
                            <span className="pay-tag paid">인증됨</span>
                          ) : (
                            <button
                              className="btn-secondary"
                              onClick={() => void verify(j.partnerId)}
                              data-verify-payout
                            >
                              계좌 인증
                            </button>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      {disputed ? (
                        <span className="claim-tag dispute">분쟁 보류</span>
                      ) : (
                        <button onClick={() => pay(j.requestId, j.partnerId)}>지급 완료</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={`지급 완료 (${paid.length}건)`}>
        <div className="table-wrap" style={{ boxShadow: 'none', border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>요청</th>
                <th>지급일</th>
                <th className="num">지급액</th>
                <th>계좌</th>
              </tr>
            </thead>
            <tbody>
              {paid.length === 0 && (
                <tr>
                  <td colSpan={4} className="meta">
                    지급 기록이 없습니다
                  </td>
                </tr>
              )}
              {paid.map((j) => (
                <tr key={j.requestId} className="paid-payout-row">
                  <td>{j.requestId}</td>
                  <td>{j.payout!.paidAt.slice(0, 10)}</td>
                  <td className="num">{krw(j.payout!.amount)}</td>
                  <td>{j.payout!.account}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="결제 현황 (완료·정산 거래)">
        <div className="table-wrap" style={{ boxShadow: 'none', border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>요청</th>
                <th>고객</th>
                <th>예약금</th>
                <th>최종 결제</th>
                <th>영수증</th>
                <th>환불</th>
              </tr>
            </thead>
            <tbody>
              {payRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="meta">
                    완료된 거래가 없습니다
                  </td>
                </tr>
              )}
              {payRows.map((r) => {
                const dep = platform.paymentFor(r.id, 'deposit')
                const fin = platform.paymentFor(r.id, 'final')
                const rf = platform.refundFor(r.id)
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.customerName}</td>
                    <td>{dep ? krw(dep.amount) : '—'}</td>
                    <td>
                      {r.status === 'cancelled' ? (
                        <span className="claim-tag dispute">취소</span>
                      ) : fin ? (
                        <strong>{krw(fin.amount)}</strong>
                      ) : (
                        <span className="pay-tag waiting">결제 대기</span>
                      )}
                    </td>
                    <td>{fin ? fin.receiptNo : '—'}</td>
                    <td>
                      {rf ? (
                        rf.status === 'done' ? (
                          <span className="pay-tag paid">환불 {krw(rf.amount - rf.deduction)}</span>
                        ) : (
                          <span className="pay-tag waiting">환불 대기</span>
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="월별 플랫폼 수익 (수수료 3%)">
        <div className="table-wrap" style={{ boxShadow: 'none', border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>월</th>
                <th className="num">완료 건수</th>
                <th className="num">거래 총액</th>
                <th className="num">수수료 수익</th>
                <th className="num">파트너 지급액</th>
              </tr>
            </thead>
            <tbody>
              {monthly.length === 0 && (
                <tr>
                  <td colSpan={5} className="meta">
                    완료된 작업이 없습니다
                  </td>
                </tr>
              )}
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="num">{m.jobCount}</td>
                  <td className="num">{krw(m.totalAmount)}</td>
                  <td className="num">
                    <strong>{krw(m.totalFee)}</strong>
                  </td>
                  <td className="num">{krw(m.payout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="파트너×주차 정산 현황">
        <div className="table-wrap" style={{ boxShadow: 'none', border: 'none' }}>
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
              {weekly.length === 0 && (
                <tr>
                  <td colSpan={6} className="meta">
                    정산 대상 작업이 없습니다
                  </td>
                </tr>
              )}
              {weekly.map((s) => (
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
      </Card>
    </div>
  )
}
