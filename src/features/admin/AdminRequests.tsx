import { useState } from 'react'
import type { RepairRequest, JobStatus } from '../../domain/types'
import { STATUS_LABEL } from '../../ui/constants'
import { usePlatform } from '../../app/PlatformContext'
import { krw, fmtPhone, isKnownError } from '../../ui/format'
import { ICON } from '../../ui/icons'
import { Card, StatusChip, EmptyState, Timeline } from '../../ui/primitives'
import PhotoStrip from '../../ui/PhotoStrip'

/** 관리자 거래 상세 (28-15-04, 시안 4): 고객·파트너·금액 + 진행 타임라인 + 정산 상태 */
function AdminRequestDetail({ request, onBack }: { request: RepairRequest; onBack: () => void }) {
  const { platform } = usePlatform()
  const bid = platform.getEstimate(request.id)
  const extras = platform.extraWorksFor(request.id)
  const approvedExtraSum = extras
    .filter((e) => (e.status ?? 'approved') === 'approved')
    .reduce((s, e) => s + e.amount, 0)
  const timeline = platform.requestTimeline(request.id)
  const profile = platform.getProfile()
  // 28-95: 주문별 수수료(계약 전) + 계약 이력
  const { auth, refresh } = usePlatform()
  const bps = platform.commissionBpsFor(request.id)
  const contracts = platform.contractsFor(request.id)
  const canSetTerms = request.status === 'accepted' && !platform.acceptedContract(request.id)
  const [bpsInput, setBpsInput] = useState(String(bps))
  const [bpsReason, setBpsReason] = useState('')
  const [termsMsg, setTermsMsg] = useState('')
  const saveTerms = () => {
    setTermsMsg('')
    try {
      const t = platform.setCommissionTerms(
        request.id,
        Number(bpsInput),
        bpsReason,
        auth.sessionFor('admin')?.accountId ?? 'admin',
      )
      setTermsMsg(`수수료 ${t.bps / 100}%로 정했습니다 — 파트너가 계약서를 (다시) 보냅니다`)
      setBpsReason('')
      refresh()
    } catch (err) {
      if (isKnownError(err)) setTermsMsg(err.message)
      else throw err
    }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'flex-start', marginBottom: 10 }}>
        <button className="btn-secondary" onClick={onBack}>
          ← 거래 목록
        </button>
      </div>
      <Card title={`거래 상세 — ${request.id}`}>
        <div className="row">
          <div className="meta">
            고객 {request.customerName} · {request.region}
            {request.address && <> {request.address}</>}
            {request.phone && <> · 연락처 {fmtPhone(request.phone)}</>} · 희망 방문일 {request.desiredDate}
            {request.desiredTime && <> {request.desiredTime}</>}
            {request.budgetRange && <> · 희망 예산 {request.budgetRange}</>}
            {bid && <> · 파트너 {profile?.name ?? bid.estimate.partnerId}</>}
          </div>
          <StatusChip status={request.status} />
        </div>
        <PhotoStrip photos={request.photos} />
        <PhotoStrip photos={request.beforePhotos} title="작업 전 사진" before />
        <PhotoStrip photos={request.completionPhotos} title="시공 완료 사진" completion />
        <Timeline events={timeline} />
      </Card>
      <Card title="금액 정보">
        {!bid && <div className="meta">아직 견적이 제출되지 않았습니다</div>}
        {bid && (
          <div className="breakdown">
            기본 견적 {krw(bid.breakdown.total)} (공급가 {krw(bid.breakdown.subtotal)} + 부가세 {krw(bid.breakdown.vat)}
            ){approvedExtraSum > 0 && <div>승인된 추가 작업 +{krw(approvedExtraSum)}</div>}
            <div className="total">총 거래 금액 {krw(bid.breakdown.total + approvedExtraSum)}</div>
            <div className="meta">
              플랫폼 수수료({bps / 100}%) 예상{' '}
              {krw(Math.round(((bid.breakdown.total + approvedExtraSum) * bps) / 10000))}
            </div>
          </div>
        )}
        {canSetTerms && (
          <div
            className="row"
            style={{ justifyContent: 'flex-start', gap: 6, marginTop: 8, flexWrap: 'wrap' }}
            data-commission-form
          >
            <input
              value={bpsInput}
              onChange={(e) => setBpsInput(e.target.value)}
              inputMode="numeric"
              aria-label="수수료 bps"
              style={{ width: 90 }}
            />
            <span className="meta">bps (300 = 3%)</span>
            <input
              value={bpsReason}
              onChange={(e) => setBpsReason(e.target.value)}
              placeholder="사유"
              aria-label="수수료 사유"
              style={{ width: 200 }}
            />
            <button className="btn-secondary" onClick={saveTerms}>
              주문별 수수료 확정
            </button>
          </div>
        )}
        {termsMsg && <div className="meta">{termsMsg}</div>}
        {contracts.length > 0 && (
          <div style={{ marginTop: 8 }} data-contract-history>
            {contracts.map((c) => (
              <div key={c.id} className="meta">
                계약 v{c.version} · {c.status} · 예약금 {krw(c.deposit)} · 수수료 {c.commissionBps / 100}% · 방문{' '}
                {c.date} {String(c.startHour).padStart(2, '0')}:00 · {c.terms}
              </div>
            ))}
          </div>
        )}
      </Card>
      {extras.length > 0 && (
        <Card title={`추가 작업 ${extras.length}건`}>
          {extras.map((e) => {
            const st = e.status ?? 'approved'
            const label = st === 'pending' ? '승인 대기' : st === 'approved' ? '승인됨' : '거절됨'
            return (
              <div key={e.id} className="meta" style={{ padding: '4px 0' }}>
                {e.id} · {e.memo || '추가 작업'} +{krw(e.amount)}
                {e.supply !== undefined && ` (공급가 ${krw(e.supply)} + VAT ${krw(e.vat ?? 0)})`} ({e.approvedDate}){' '}
                <span className={`extra-status ${st}`}>{label}</span>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}

/** 요청 관리 (28-14-03): 전체 요청 목록 — 행 선택 시 거래 상세 (28-15-04) */
const PAGE = 50
const STATUS_KEYS = Object.keys(STATUS_LABEL) as JobStatus[]

export default function AdminRequests() {
  const { platform } = usePlatform()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 28-57-03: 검색·상태 필터·50건 페이지
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | JobStatus>('all')
  const [limit, setLimit] = useState(PAGE)
  const all = [...platform.store.list()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const q = query.trim().toLowerCase()
  const filtered = all.filter((r) => {
    if (status !== 'all' && r.status !== status) return false
    if (q === '') return true
    return (
      r.id.toLowerCase().includes(q) ||
      r.customerName.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.region.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q)
    )
  })
  const requests = filtered.slice(0, limit)

  const selected = selectedId ? all.find((r) => r.id === selectedId) : undefined
  if (selected) {
    return <AdminRequestDetail request={selected} onBack={() => setSelectedId(null)} />
  }

  if (all.length === 0) {
    return (
      <EmptyState
        icon={ICON.search}
        title="등록된 요청이 없습니다"
        sub="고객이 수리 요청을 등록하면 여기에 표시됩니다"
      />
    )
  }

  return (
    <Card
      title={`전체 요청 (${filtered.length}${filtered.length !== all.length ? `/${all.length}` : ''}건) — 행을 누르면 거래 상세`}
    >
      <div className="row" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(PAGE)
          }}
          placeholder="ID·고객·내용·지역·분야"
          aria-label="요청 검색"
          style={{ maxWidth: 260 }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as 'all' | JobStatus)
            setLimit(PAGE)
          }}
          aria-label="상태 필터"
        >
          <option value="all">전체 상태</option>
          {STATUS_KEYS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      {filtered.length === 0 && (
        <div className="meta" data-requests-empty>
          검색 결과가 없습니다
        </div>
      )}
      <div className="table-wrap" style={{ boxShadow: 'none', border: 'none' }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>고객</th>
              <th>요청</th>
              <th>지역</th>
              <th>희망일</th>
              <th className="num">견적</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const bid = platform.getEstimate(r.id)
              return (
                <tr key={r.id} className="rowlink" onClick={() => setSelectedId(r.id)}>
                  <td className="meta">{r.id}</td>
                  <td>{r.customerName}</td>
                  <td>
                    [{r.category}] {r.description}
                  </td>
                  <td>{r.region}</td>
                  <td>{r.desiredDate}</td>
                  <td className="num">{bid ? krw(bid.breakdown.total) : '—'}</td>
                  <td>
                    <StatusChip status={r.status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > requests.length && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
          <button className="btn-secondary" onClick={() => setLimit((n) => n + PAGE)} data-requests-more>
            더 보기 ({requests.length}/{filtered.length})
          </button>
        </div>
      )}
    </Card>
  )
}
