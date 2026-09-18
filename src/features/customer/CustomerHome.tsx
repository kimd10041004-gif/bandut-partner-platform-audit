import { useEffect, useState } from 'react'
import RegionSelect from '../../ui/RegionSelect'
import type { RepairRequest, PaymentMethod, DesiredTime } from '../../domain/types'
import { PlatformService, todayUTC, categoriesOf, heldForReview } from '../../domain/platform'
import { usePlatform } from '../../app/PlatformContext'
import { krw, koreanDate, isKnownError, fmtPhone } from '../../ui/format'
import { CLAIM_STATUS_LABEL, PAY_KIND_LABEL, PAY_METHOD_LABEL } from '../../ui/constants'
import { ICON } from '../../ui/icons'
import {
  Card,
  Stat,
  StatusChip,
  WorkStepper,
  EmptyState,
  Timeline,
  Stars,
  Dday,
  ToggleGroup,
} from '../../ui/primitives'
import ChatBox from '../../ui/ChatBox'
import PartnerCard from '../../ui/PartnerCard'
import PhotoStrip from '../../ui/PhotoStrip'

/** 결제 카드 (28-28-02, 시안 "결제 및 예약"): 예약금(낙찰 후)·최종 결제(완료 후)·영수증.
 *  결제 실행은 도메인 payDeposit/payFinal — 상용 전환 시 이 버튼이 PG 결제창을 띄우고
 *  서버 승인 콜백이 같은 도메인 레코드를 만든다. */
function PaymentCards({
  request,
  baseTotal,
  finalTotal,
}: {
  request: RepairRequest
  baseTotal: number
  finalTotal: number
}) {
  const { platform, refresh } = usePlatform()
  const [method, setMethod] = useState<PaymentMethod>('card')
  const [error, setError] = useState('')
  const payments = platform.paymentsFor(request.id)
  // 28-97: 승인된(done) 것만이 결제다 — 준비 중(ready)·실패한 주문은 카드·영수증에서 결제로 세지 않는다
  const deposit = payments.find((p) => p.kind === 'deposit' && p.status === 'done')
  const finalPay = payments.find((p) => p.kind === 'final' && p.status === 'done')
  const lastFailed = [...payments].reverse().find((p) => p.status === 'failed')
  // 28-95: 예약금은 동의된 계약의 금액이고 계약 동의 뒤에만 낸다 — 계약 없는 낙찰 건은 파트너의 계약서를 기다린다
  const contract = platform.acceptedContract(request.id)
  const depositPreview = contract ? contract.deposit : Math.max(10_000, Math.floor(baseTotal / 10))
  const depositDue =
    contract !== undefined && contract.deposit > 0 && (request.status === 'scheduled' || request.status === 'accepted')
  // 28-45-02: 취소 건 환불 상태 · 28-97: 부분 환불이 여러 건일 수 있다
  const refunds = platform.refundsFor(request.id)

  const pay = (fn: () => void) => {
    setError('')
    try {
      fn()
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  const methodPick = (
    <ToggleGroup
      label="결제 수단"
      value={method}
      style={{ display: 'inline-flex', gap: 6 }}
      options={(['card', 'transfer'] as const).map((m) => ({ value: m, label: PAY_METHOD_LABEL[m] }))}
      onChange={setMethod}
    />
  )

  return (
    <>
      {request.status === 'accepted' && !contract && !platform.proposedContract(request.id) && (
        <div className="meta" data-contract-wait>
          파트너가 계약서(예약금·조건·방문 일정)를 보내면 여기서 확인하고 동의합니다.
        </div>
      )}
      {depositDue && !deposit && (
        <Card title="예약금 결제">
          <div className="breakdown">
            <div>
              예약금 ({contract ? `계약 v${contract.version}` : '낙찰가의 10%'}) <strong>{krw(depositPreview)}</strong>
            </div>
            <div className="meta">예약금을 결제하면 방문 일정이 확정됩니다. 잔액은 작업 완료 후 결제합니다.</div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-start', marginTop: 10, gap: 10 }}>
            {methodPick}
            <button onClick={() => pay(() => platform.payDeposit(request.id, method))}>
              {krw(depositPreview)} 결제하기
            </button>
          </div>
          {error && (
            <div className="error" style={{ marginTop: 8 }}>
              {error}
            </div>
          )}
        </Card>
      )}
      {request.status === 'completed' && !finalPay && (
        <Card title="최종 결제">
          <div className="breakdown">
            <div>최종 금액 {krw(finalTotal)}</div>
            {deposit && <div>기결제 예약금 −{krw(deposit.amount)}</div>}
            <div className="total">결제할 금액 {krw(Math.max(0, finalTotal - (deposit?.amount ?? 0)))}</div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-start', marginTop: 10, gap: 10 }}>
            {methodPick}
            <button onClick={() => pay(() => platform.payFinal(request.id, method))}>
              {krw(Math.max(0, finalTotal - (deposit?.amount ?? 0)))} 결제하기
            </button>
          </div>
          {error && (
            <div className="error" style={{ marginTop: 8 }}>
              {error}
            </div>
          )}
        </Card>
      )}
      {refunds.length > 0 && (
        <Card title="환불 내역" className="refund-card">
          {refunds.map((refund) => (
            <div key={refund.id} className="list-row" data-refund-status={refund.status}>
              <div>
                <div className="lr-title">
                  {refund.status === 'done' ? '환불 완료' : '환불 대기'} · {krw(refund.amount - refund.deduction)}
                </div>
                <div className="lr-sub">
                  {refund.reason}
                  {refund.deduction > 0 && <> · 실비 차감 {krw(refund.deduction)}</>}
                  {refund.doneAt && <> · 처리일 {refund.doneAt.slice(0, 10)}</>}
                </div>
              </div>
              <div className="lr-right">
                {refund.status === 'done' ? (
                  <span className="pay-tag paid">환불 완료</span>
                ) : (
                  <span className="pay-tag waiting">운영자 처리 중</span>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      {lastFailed && !deposit && !finalPay && (
        <div className="meta" data-payment-failed>
          직전 결제 시도가 완료되지 않았습니다 ({lastFailed.failReason ?? '사유 없음'}) — 주문번호 {lastFailed.orderId}.
          다시 결제하면 새 주문번호로 진행됩니다.
        </div>
      )}
      {payments.length > 0 && (
        <Card title="영수증">
          {payments.map((p) => (
            <div key={p.id} className="list-row" data-payment={p.id} data-payment-status={p.status}>
              <div>
                <div className="lr-title">
                  {PAY_KIND_LABEL[p.kind]} · {PAY_METHOD_LABEL[p.method]}
                  {p.status !== 'done' && (
                    <>
                      {' '}
                      <span className="pay-tag waiting">{p.status === 'ready' ? '결제 진행 중' : '결제 실패'}</span>
                    </>
                  )}
                </div>
                {/* 28-97: 주문번호는 결제사와 대조할 때 쓰는 값이라 고객 화면에도 남긴다 */}
                <div className="lr-sub">
                  {p.receiptNo} · {p.paidAt.slice(0, 10)} · 주문번호 <span data-order-id>{p.orderId}</span>
                </div>
              </div>
              <div className="lr-right">{krw(p.amount)}</div>
            </div>
          ))}
          <div className="meta" style={{ marginTop: 8 }}>
            부가세는 견적 내역의 공급가·부가세 분리 기준을 따릅니다. 세금계산서·현금영수증은 정산 후 발행됩니다.
          </div>
        </Card>
      )}
    </>
  )
}

/** 고객 거래 상세 (28-15-02, 시안 5): 진행 타임라인 + 견적 분해 + 추가 작업 승인 + 최종 금액 */
function ReviewCard({ requestId }: { requestId: string }) {
  const { platform, refresh } = usePlatform()
  const [rating, setRating] = useState(5)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const existing = platform.reviewFor(requestId)

  if (existing) {
    return (
      <Card title="내가 남긴 리뷰">
        <div>
          <Stars rating={existing.rating} /> <span className="meta">{existing.createdDate}</span>
        </div>
        {existing.text && <div style={{ marginTop: 6 }}>{existing.text}</div>}
      </Card>
    )
  }

  const submit = () => {
    setError('')
    try {
      platform.writeReview(requestId, { rating, text })
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  return (
    <Card title="리뷰 작성">
      <div className="meta">작업은 어떠셨나요? 별점과 후기를 남겨 주세요.</div>
      <div className="star-pick" style={{ marginTop: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={n <= rating ? 'on' : ''} aria-label={`${n}점`} onClick={() => setRating(n)}>
            ★
          </button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8, gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="예: 꼼꼼하고 깔끔했어요"
          style={{ flex: 1, minWidth: 200 }}
        />
        <button onClick={submit}>리뷰 등록</button>
      </div>
      {error && (
        <div className="error" style={{ marginTop: 6 }}>
          {error}
        </div>
      )}
    </Card>
  )
}

function ClaimCard({ request }: { request: RepairRequest }) {
  const { platform, refresh } = usePlatform()
  const [detail, setDetail] = useState('')
  const [error, setError] = useState('')
  const claims = platform.claimsFor(request.id)
  const canDispute = ['accepted', 'scheduled', 'in_progress', 'completed', 'settled'].includes(request.status)
  if (!canDispute && claims.length === 0) return null

  const file = () => {
    setError('')
    try {
      platform.fileClaim(request.id, { detail })
      setDetail('')
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  return (
    <Card title="문제 접수 (분쟁)">
      {claims.map((c) => (
        <div key={c.id} className="list-row">
          <div>
            <div className="lr-title">
              <span className="claim-tag dispute">분쟁</span> {c.detail}
            </div>
            <div className="lr-sub">
              접수 {c.createdDate}
              {c.status !== 'resolved' && <> · 해결 전까지 정산·지급 보류</>}
              {c.status === 'resolved' && c.resolution && (
                <>
                  {' '}
                  · 처리: {c.resolution} ({c.resolvedDate})
                </>
              )}
            </div>
            {c.partnerReply && (
              <div className="lr-sub" data-claim-reply>
                파트너 답변 ({c.repliedDate}): {c.partnerReply}
              </div>
            )}
          </div>
          <div className="lr-right">
            <span className={`claim-status ${c.status}`}>{CLAIM_STATUS_LABEL[c.status]}</span>
          </div>
        </div>
      ))}
      {canDispute && (
        <>
          <div className="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: claims.length > 0 ? 10 : 0 }}>
            <input
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="예: 실리콘 마감 부위가 다시 들떠요 / 방문 일정이 협의 없이 변경됐어요"
              style={{ flex: 1, minWidth: 200 }}
            />
            <button className="btn-danger" onClick={file} data-file-claim>
              문제 신고
            </button>
          </div>
          <div className="meta" style={{ marginTop: 6 }}>
            접수하면 관리자가 확인 후 처리 결과를 여기에 남깁니다. 해결될 때까지 이 거래의 정산·지급은 보류됩니다.
          </div>
        </>
      )}
      {error && (
        <div className="error" style={{ marginTop: 6 }}>
          {error}
        </div>
      )}
    </Card>
  )
}

function RequestDetail({ request, onBack }: { request: RepairRequest; onBack: () => void }) {
  const { platform, refresh } = usePlatform()
  const [error, setError] = useState('')
  // 28-43-03: 입찰 마감 안내·연장
  const today = todayUTC()
  const bidding = request.status === 'requested' || request.status === 'estimated'
  const closed = bidding && platform.bidClosed(request.id, today)
  const bidCount = platform.bidCount(request.id)
  const [extendTo, setExtendTo] = useState(() =>
    PlatformService.defaultBidDeadline(request.desiredDate, today) > today
      ? PlatformService.defaultBidDeadline(request.desiredDate, today)
      : today,
  )
  const extend = () => {
    setError('')
    try {
      platform.extendDeadline(request.id, extendTo, today)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  // 28-42-03: 고객 요청 취소 — 시공 시작 전(requested~scheduled)만, 2단계 확인(인라인)
  const [cancelArmed, setCancelArmed] = useState(false)
  const canCancel = ['requested', 'estimated', 'accepted', 'scheduled'].includes(request.status)
  const cancel = () => {
    setError('')
    try {
      platform.transitionRequest(request.id, 'cancelled')
      setCancelArmed(false)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  // 28-52-03: 낙찰 전 요청 수정(인라인 폼)
  const [editing, setEditing] = useState(false)
  const [eDesc, setEDesc] = useState(request.description)
  const [eRegion, setERegion] = useState(request.region)
  const [eDate, setEDate] = useState(request.desiredDate)
  const [eTime, setETime] = useState<DesiredTime>(request.desiredTime ?? '오후')
  const saveEdit = () => {
    setError('')
    try {
      platform.updateRequest(
        request.id,
        { description: eDesc, region: eRegion, desiredDate: eDate, desiredTime: eTime },
        today,
      )
      setEditing(false)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  // 28-56-01: 방문 예정 상태의 일정 변경(인라인 폼)
  const [rescheduling, setRescheduling] = useState(false)
  const [rDate, setRDate] = useState(today)
  const [rStart, setRStart] = useState('9')
  const [rEnd, setREnd] = useState('12')
  const saveReschedule = () => {
    setError('')
    try {
      platform.rescheduleVisit(
        request.id,
        { date: rDate, startHour: Number(rStart), endHour: Number(rEnd) },
        'customer',
        today,
      )
      setRescheduling(false)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  const bid = platform.getEstimate(request.id)
  // 28-95: 계약서·일정 변경 제안은 고객이 결정한다
  const proposedContract = platform.proposedContract(request.id)
  const acceptedContract = platform.acceptedContract(request.id)
  const scheduleChange = platform.proposedScheduleChange(request.id)
  const [contractConsent, setContractConsent] = useState(false)
  const decideContract = (id: string, accept: boolean) => {
    setError('')
    try {
      platform.decideContract(request.id, id, accept, today)
      setContractConsent(false)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  const decideSchedule = (id: string, accept: boolean) => {
    setError('')
    try {
      platform.decideSchedule(request.id, id, accept, today)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  const extras = platform.extraWorksFor(request.id)
  const pendingExtras = extras.filter((e) => e.status === 'pending')
  const approvedExtraSum = extras
    .filter((e) => (e.status ?? 'approved') === 'approved')
    .reduce((s, e) => s + e.amount, 0)
  const slots = platform.scheduleSlots
    .filter((s) => s.requestId === request.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
  const timeline = platform.requestTimeline(request.id)

  const decideExtra = (id: string, decision: 'approved' | 'rejected') => {
    setError('')
    try {
      platform.decideExtraWork(id, decision)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  // 28-50-03: 파트너 철회로 재오픈된 요청(낙찰 전 상태 + 철회 이력) — 환불 카드는 견적이 없어도 보여야 한다
  const refundPending = platform.refundFor(request.id) !== undefined
  const reopened = bidding && platform.partnerCancels().some((c) => c.requestId === request.id)
  return (
    <div>
      <div className="row" style={{ justifyContent: 'flex-start', marginBottom: 10 }}>
        <button className="btn-secondary" onClick={onBack}>
          ← 목록으로
        </button>
        {bidding && !editing && !cancelArmed && (
          <button className="btn-secondary" data-edit-request onClick={() => setEditing(true)}>
            요청 수정
          </button>
        )}
        {request.status === 'scheduled' && !rescheduling && !cancelArmed && (
          <button className="btn-secondary" data-reschedule onClick={() => setRescheduling(true)}>
            방문일 변경
          </button>
        )}
        {canCancel && !cancelArmed && !editing && (
          <button className="btn-danger" onClick={() => setCancelArmed(true)}>
            요청 취소
          </button>
        )}
        {canCancel && cancelArmed && (
          <>
            <span className="meta">
              정말 취소할까요? 방문 전 취소는 예약금 전액 환불, 방문일 이후 취소는 협의 후 실비를 차감해 환불됩니다.
            </span>
            <button className="btn-danger" onClick={cancel}>
              취소 확정
            </button>
            <button className="btn-secondary" onClick={() => setCancelArmed(false)}>
              돌아가기
            </button>
          </>
        )}
      </div>
      {rescheduling && (
        <Card title="방문 일정 변경" className="edit-request">
          <div className="form">
            <label>
              날짜
              <input
                type="date"
                value={rDate}
                min={today}
                onChange={(e) => setRDate(e.target.value)}
                aria-label="변경 날짜"
              />
            </label>
            <label>
              시작 시각
              <select value={rStart} onChange={(e) => setRStart(e.target.value)} aria-label="변경 시작">
                {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((h) => (
                  <option key={h} value={String(h)}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <label>
              종료 시각
              <select value={rEnd} onChange={(e) => setREnd(e.target.value)} aria-label="변경 종료">
                {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => (
                  <option key={h} value={String(h)}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <div className="form-wide meta">
              파트너의 다른 예약·휴무일과 겹치면 변경할 수 없습니다. 저장하면 파트너에게 알림이 갑니다.
            </div>
            {error && (
              <div className="error form-wide" data-reschedule-error>
                {error}
              </div>
            )}
            <div className="row form-wide" style={{ justifyContent: 'flex-start', gap: 8 }}>
              <button onClick={saveReschedule}>변경 저장</button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setRescheduling(false)
                  setError('')
                }}
              >
                취소
              </button>
            </div>
          </div>
        </Card>
      )}
      {editing && (
        <Card title="요청 수정" className="edit-request">
          <div className="form">
            <label className="form-wide">
              요청 내용
              <input value={eDesc} onChange={(e) => setEDesc(e.target.value)} aria-label="수정 내용" />
            </label>
            <label>
              지역
              <RegionSelect
                value={eRegion}
                onChange={setERegion}
                labels={{ city: '수정 시·도', district: '수정 시·군·구' }}
              />
            </label>
            <label>
              희망 방문일
              <input
                type="date"
                value={eDate}
                min={today}
                onChange={(e) => setEDate(e.target.value)}
                aria-label="수정 희망일"
              />
            </label>
            <label>
              시간대
              <select value={eTime} onChange={(e) => setETime(e.target.value as DesiredTime)} aria-label="수정 시간대">
                <option value="오전">오전</option>
                <option value="오후">오후</option>
              </select>
            </label>
            <div className="form-wide meta">
              카테고리는 바꿀 수 없습니다(질문·매칭 기준). 저장하면 견적을 낸 파트너에게 알림이 갑니다.
            </div>
            {error && (
              <div className="error form-wide" data-edit-error>
                {error}
              </div>
            )}
            <div className="row form-wide" style={{ justifyContent: 'flex-start', gap: 8 }}>
              <button onClick={saveEdit}>수정 저장</button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setEditing(false)
                  setError('')
                }}
              >
                취소
              </button>
            </div>
          </div>
        </Card>
      )}
      <Card title={`[${categoriesOf(request).join(' + ')}] ${request.description}`}>
        <div className="row">
          <div className="meta">
            {request.region}
            {request.address && <> {request.address}</>}
            {request.phone && <> · 연락처 {fmtPhone(request.phone)}</>} · 희망 방문일 {request.desiredDate}
            {request.desiredTime && <> {request.desiredTime}</>}
            {request.budgetRange && <> · 희망 예산 {request.budgetRange}</>}
            {request.editCount ? (
              <>
                {' '}
                · <span data-edit-count={request.editCount}>수정됨 {request.editCount}회</span>
              </>
            ) : null}
            {bidding && request.bidDeadline && (
              <>
                {' '}
                · 입찰 마감 {request.bidDeadline} <Dday deadline={request.bidDeadline} today={today} />
              </>
            )}
            {slots[0] && (
              <>
                {' '}
                · 예약 {slots[0].date} {String(slots[0].startHour).padStart(2, '0')}:00
              </>
            )}
            {request.rescheduleCount ? (
              <>
                {' '}
                · <span data-reschedule-count={request.rescheduleCount}>일정 변경 {request.rescheduleCount}회</span>
              </>
            ) : null}
          </div>
          <StatusChip status={request.status} />
        </div>
        {reopened && (
          <div className="approval-banner pending" data-reopen-banner style={{ marginTop: 8 }}>
            파트너 사정으로 낙찰이 철회돼 다시 입찰을 받고 있어요
            {request.bidDeadline && <> — 마감 {request.bidDeadline}</>}. 받은 견적은 <strong>견적함</strong>에서 다시
            비교할 수 있고, 결제한 예약금은 전액 환불됩니다.
          </div>
        )}
        {closed && (
          <div className="approval-banner pending" data-deadline-banner style={{ marginTop: 8 }}>
            {bidCount > 0 ? (
              <>
                입찰이 마감되었습니다 — 받은 견적 {bidCount}건을 <strong>견적함</strong>에서 비교하고 선택해 주세요.
              </>
            ) : (
              <div className="form" style={{ gap: 6 }}>
                <div className="form-wide">
                  입찰이 마감되었지만 견적이 들어오지 않았습니다. 마감을 연장하거나 요청을 취소해 주세요.
                </div>
                <label>
                  새 마감일
                  <input
                    type="date"
                    value={extendTo}
                    min={today}
                    onChange={(e) => setExtendTo(e.target.value)}
                    aria-label="새 마감일"
                  />
                </label>
                <button onClick={extend}>마감 연장</button>
              </div>
            )}
          </div>
        )}
        {request.answers && request.answers.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {request.answers.map((a) => (
              <div key={a.question} className="qa-line">
                <span className="qa-q">{a.question}</span> — {a.answer}
              </div>
            ))}
          </div>
        )}
        <PhotoStrip photos={request.photos} />
        <PhotoStrip photos={request.beforePhotos} title="작업 전 사진" before />
        <PhotoStrip photos={request.completionPhotos} title="시공 완료 사진 — 최종 결제 전에 확인하세요" completion />
        <Timeline events={timeline} />
      </Card>
      {bid && (
        <Card title="견적 내역">
          <div className="breakdown">
            공급가 {krw(bid.breakdown.subtotal)} + 부가세 {krw(bid.breakdown.vat)}
            <div>기본 견적 {krw(bid.breakdown.total)}</div>
            {approvedExtraSum > 0 && <div>승인된 추가 작업 +{krw(approvedExtraSum)}</div>}
            <div className="total">최종 결제 예정 금액 {krw(bid.breakdown.total + approvedExtraSum)}</div>
            {bid.estimate.memo && <div className="meta">파트너 메시지: "{bid.estimate.memo}"</div>}
          </div>
        </Card>
      )}
      {bid && (
        <Card title="시공 업체">
          <PartnerCard requestId={request.id} />
        </Card>
      )}
      {proposedContract && (
        <Card title={`계약서 v${proposedContract.version} — 확인해 주세요`} className="edit-request">
          <div className="breakdown" data-contract={proposedContract.id}>
            <div>총액 {krw(proposedContract.total)}</div>
            <div>예약금 {krw(proposedContract.deposit)}</div>
            <div className="meta">플랫폼 수수료 {proposedContract.commissionBps / 100}% (파트너 정산에서 차감)</div>
            <div>
              방문 {proposedContract.date} {String(proposedContract.startHour).padStart(2, '0')}:00~
              {String(proposedContract.endHour).padStart(2, '0')}:00
            </div>
            <div>조건: {proposedContract.terms}</div>
          </div>
          <label className="row" style={{ justifyContent: 'flex-start', gap: 6, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={contractConsent}
              onChange={(e) => setContractConsent(e.target.checked)}
              aria-label="계약 내용 확인"
            />
            계약 내용과 방문 일정을 확인했습니다
          </label>
          <div className="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
            <button disabled={!contractConsent} onClick={() => decideContract(proposedContract.id, true)}>
              계약 동의
            </button>
            <button className="btn-secondary" onClick={() => decideContract(proposedContract.id, false)}>
              수정 요청
            </button>
          </div>
        </Card>
      )}
      {acceptedContract && (
        <Card title={`계약 v${acceptedContract.version} 동의됨`}>
          <div className="meta" data-contract-accepted>
            총액 {krw(acceptedContract.total)} · 예약금 {krw(acceptedContract.deposit)} · 수수료{' '}
            {acceptedContract.commissionBps / 100}% · 방문 {acceptedContract.date}{' '}
            {String(acceptedContract.startHour).padStart(2, '0')}:00 · 조건: {acceptedContract.terms}
          </div>
        </Card>
      )}
      {scheduleChange && (
        <Card title="파트너가 방문 일정 변경을 제안했습니다" className="edit-request">
          <div className="breakdown" data-schedule-change={scheduleChange.id}>
            <div>
              새 일정 {scheduleChange.date} {String(scheduleChange.startHour).padStart(2, '0')}:00~
              {String(scheduleChange.endHour).padStart(2, '0')}:00
            </div>
            <div className="meta">사유: {scheduleChange.reason}</div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
            <button onClick={() => decideSchedule(scheduleChange.id, true)}>변경 승인</button>
            <button className="btn-secondary" onClick={() => decideSchedule(scheduleChange.id, false)}>
              거절 (기존 일정 유지)
            </button>
          </div>
        </Card>
      )}
      {(bid || refundPending) && (
        <PaymentCards
          request={request}
          baseTotal={bid?.breakdown.total ?? 0}
          finalTotal={(bid?.breakdown.total ?? 0) + approvedExtraSum}
        />
      )}
      {request.status !== 'lost' && request.status !== 'cancelled' && (
        <Card title="파트너와 채팅">
          {request.status === 'requested' ? (
            <div className="meta">견적이 도착하면 채팅이 열립니다.</div>
          ) : (
            <ChatBox requestId={request.id} viewer="customer" />
          )}
        </Card>
      )}
      {pendingExtras.length > 0 && (
        <Card title={`추가 작업 승인 요청 ${pendingExtras.length}건`}>
          {error && (
            <div className="error" style={{ marginBottom: 8 }}>
              {error}
            </div>
          )}
          {pendingExtras.map((e) => (
            <div key={e.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="row">
                <div>
                  <div style={{ fontWeight: 700 }}>{e.memo || '추가 작업'}</div>
                  <div className="meta">
                    요청일 {e.approvedDate} · 추가 비용 <strong>+{krw(e.amount)}</strong>
                    {e.supply !== undefined && (
                      <span data-extra-vat>
                        {' '}
                        (공급가 {krw(e.supply)} + VAT {krw(e.vat ?? 0)})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                <button onClick={() => decideExtra(e.id, 'approved')}>승인하기</button>
                <button className="btn-danger" onClick={() => decideExtra(e.id, 'rejected')}>
                  거절하기
                </button>
              </div>
            </div>
          ))}
          <div className="meta" style={{ marginTop: 8 }}>
            추가 작업은 고객 승인 후 진행되며, 승인된 금액만 최종 결제 금액에 반영됩니다.
          </div>
        </Card>
      )}
      {extras.some((e) => e.status === 'approved' || e.status === 'rejected') && (
        <Card title="추가 작업 결정 내역">
          {extras
            .filter((e) => e.status === 'approved' || e.status === 'rejected')
            .map((e) => (
              <div key={e.id} className="meta" style={{ padding: '4px 0' }}>
                {e.memo || '추가 작업'} +{krw(e.amount)}
                {e.supply !== undefined && ` (공급가 ${krw(e.supply)} + VAT ${krw(e.vat ?? 0)})`} ({e.approvedDate}){' '}
                <span className={`extra-status ${e.status}`}>{e.status === 'approved' ? '승인됨' : '거절됨'}</span>
              </div>
            ))}
        </Card>
      )}
      {(request.status === 'completed' || request.status === 'settled') && <ReviewCard requestId={request.id} />}
      <ClaimCard request={request} />
      <Card title="방문 전 안내">
        <div className="meta">
          작업 공간 주변을 미리 비워 주세요 · 귀중품은 안전한 곳에 보관해 주세요 · 주차 공간이 필요한 경우 미리 알려
          주세요.
        </div>
      </Card>
    </div>
  )
}

/** 고객 홈 (28-14-02): 내 요청 목록 + 진행 상태 → 카드 선택 시 거래 상세 (28-15-02) */
export default function CustomerHome() {
  const { platform, auth, refresh } = usePlatform()
  // 28-43-01: 마감 정리(멱등) — 화면 진입 시 마감 지난 요청에 고객 알림
  useEffect(() => {
    if (platform.sweepDeadlines() + platform.sweepPaymentReminders() > 0) refresh()
  }, [platform, refresh])
  const today = todayUTC()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 28-32-01: 내 요청만 — 계정 연결이 없는 구 데이터·시드는 고객 앱에서 제외
  const myId = auth.sessionFor('customer')?.accountId
  const requests = platform.store
    .list()
    .filter((r) => r.customerId === myId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const awaitingDecision = requests.filter((r) => r.status === 'estimated').length
  const inProgress = requests.filter((r) => ['accepted', 'scheduled', 'in_progress'].includes(r.status)).length
  const done = requests.filter((r) => r.status === 'completed' || r.status === 'settled').length

  const selected = selectedId ? requests.find((r) => r.id === selectedId) : undefined
  if (selected) {
    return <RequestDetail request={selected} onBack={() => setSelectedId(null)} />
  }

  return (
    <div>
      <div className="hero">
        <div className="hero-date">{koreanDate(today)}</div>
        <h2 className="hero-greet">우리 집 수리, 반듯하게 진행 중이에요</h2>
      </div>
      <div className="stat-grid">
        <Stat tone="blue" icon={ICON.search} label="견적 대기">
          {requests.filter((r) => r.status === 'requested').length}
          <small>건</small>
        </Stat>
        <Stat tone="amber" icon={ICON.wallet} label="결정할 견적">
          {awaitingDecision}
          <small>건</small>
        </Stat>
        <Stat tone="green" icon={ICON.work} label="진행 중">
          {inProgress}
          <small>건</small>
        </Stat>
        <Stat tone="brand" accent icon={ICON.clock} label="완료된 수리">
          {done}
          <small>건</small>
        </Stat>
      </div>
      {requests.length === 0 && (
        <EmptyState
          icon={ICON.home}
          title="아직 수리 요청이 없습니다"
          sub="'수리 요청' 탭에서 첫 요청을 등록해 보세요"
        />
      )}
      {requests.map((r) => {
        const bid = platform.getEstimate(r.id)
        const bidCount = platform.bidCount(r.id)
        const pendingCount = platform.extraWorksFor(r.id).filter((e) => e.status === 'pending').length
        return (
          <Card key={r.id}>
            <div className="row">
              <div>
                <h3>
                  [{categoriesOf(r).join(' + ')}] {r.description}
                </h3>
                {heldForReview(r) && (
                  <div className="review-hold" data-review-hold>
                    접수 확인 중 — 관리자가 안전·작업 범위를 확인한 뒤 파트너에게 공개됩니다
                  </div>
                )}
                <div className="meta">
                  {r.region} · 희망 방문일 {r.desiredDate}
                  {(r.status === 'requested' || r.status === 'estimated') && r.bidDeadline && (
                    <>
                      {' '}
                      · 입찰 마감 <Dday deadline={r.bidDeadline} today={todayUTC()} />
                    </>
                  )}
                  {r.status === 'estimated' && (
                    <>
                      {' '}
                      · <strong>견적 {bidCount}건 도착</strong> — 견적함에서 비교
                    </>
                  )}
                  {bid && r.status !== 'estimated' && (
                    <>
                      {' '}
                      · 낙찰 견적 <strong>{krw(bid.breakdown.total)}</strong>
                    </>
                  )}
                  {pendingCount > 0 && (
                    <>
                      {' '}
                      · <span className="extra-status pending">추가 작업 승인 대기 {pendingCount}건</span>
                    </>
                  )}
                </div>
              </div>
              <StatusChip status={r.status} />
            </div>
            <WorkStepper status={r.status} />
            <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
              <button className="btn-secondary" onClick={() => setSelectedId(r.id)}>
                거래 상세 보기
              </button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
