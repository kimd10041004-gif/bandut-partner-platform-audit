import { useMemo, useState } from 'react'
import type { RepairCategory } from '../domain/types'
import { todayUTC, categoriesOf, heldForReview, requestForPartner } from '../domain/platform'
import { parseWonInput } from '../domain/money'
import { usePlatform, usePartnerId } from '../app/PlatformContext'
import { CATEGORIES } from '../ui/constants'
import { krw, isKnownError } from '../ui/format'
import { ICON } from '../ui/icons'
import { Card, StatusChip, EmptyState, Dday } from '../ui/primitives'
import ApprovalBanner from '../ui/ApprovalBanner'

/** 일감 정렬 키 (28-11-02 · 28-43) — select 옵션과 1:1 */
type SortKey = 'latest' | 'desired' | 'budget' | 'deadline'

/** 입찰 제안 폼 (28-6-01): 제안 금액 구성 + 고객 메시지 */
function BidForm({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const { platform, refresh } = usePlatform()
  const partnerId = usePartnerId()
  // 28-42-03: 낙찰 전(requested/estimated) 요청 전부 — 28-43-02: 마감 지난 건 제외
  const today = todayUTC()
  // 28-93: 관리자 검토 전 요청은 후보에 없다
  const candidates = platform.store
    .list()
    .filter(
      (r) =>
        (r.status === 'requested' || r.status === 'estimated') && !platform.bidClosed(r.id, today) && !heldForReview(r),
    )
  const requestId = candidates.some((c) => c.id === selectedId) ? selectedId : (candidates[0]?.id ?? '')
  const [labor, setLabor] = useState('150000')
  const [material, setMaterial] = useState('80000')
  const [transport, setTransport] = useState('20000')
  const [discount, setDiscount] = useState('0')
  const [memo, setMemo] = useState('')
  const [message, setMessage] = useState('')

  const parsed = useMemo(() => {
    try {
      const trimmedMemo = memo.trim()
      return {
        ok: true as const,
        input: {
          laborCost: parseWonInput(labor),
          materialCost: parseWonInput(material),
          transportCost: parseWonInput(transport),
          discount: parseWonInput(discount),
          ...(trimmedMemo !== '' ? { memo: trimmedMemo } : {}),
        },
      }
    } catch (err) {
      if (isKnownError(err)) return { ok: false as const, message: err.message }
      throw err
    }
  }, [labor, material, transport, discount, memo])

  const submit = () => {
    setMessage('')
    if (!parsed.ok) return
    if (!requestId) {
      setMessage('입찰할 일감을 선택하세요')
      return
    }
    try {
      const breakdown = platform.submitEstimate(requestId, partnerId, parsed.input)
      setMessage(
        `입찰 제안 완료 — 제안 금액 ${krw(breakdown.total)} (수수료 3% 차감 시 지급액 ${krw(breakdown.partnerPayout)})`,
      )
      refresh()
    } catch (err) {
      if (isKnownError(err)) setMessage(err.message)
      else throw err
    }
  }

  return (
    <div className="card form" style={{ marginBottom: 12 }}>
      <h3 style={{ margin: 0 }}>입찰하기</h3>
      <label>
        일감 선택
        <select value={requestId} onChange={(e) => onSelect(e.target.value)}>
          {candidates.length === 0 && <option value="">입찰 가능한 일감 없음</option>}
          {candidates.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} · [{categoriesOf(r).join(' + ')}] {r.description}
              {r.budget !== undefined ? ` (예산 ${krw(r.budget)})` : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        인건비 (원)
        <input value={labor} onChange={(e) => setLabor(e.target.value)} inputMode="numeric" />
      </label>
      <label>
        자재비 (원)
        <input value={material} onChange={(e) => setMaterial(e.target.value)} inputMode="numeric" />
      </label>
      <label>
        출장비 (원)
        <input value={transport} onChange={(e) => setTransport(e.target.value)} inputMode="numeric" />
      </label>
      <label>
        할인 (원)
        <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" />
      </label>
      <label>
        고객에게 남길 메시지 (선택)
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="예: 꼼꼼하고 정직한 시공을 약속드립니다"
        />
      </label>
      <button onClick={submit} disabled={!parsed.ok}>
        입찰 제안하기
      </button>
      {!parsed.ok && <div className="error">{parsed.message}</div>}
      {message && <div className="breakdown card">{message}</div>}
    </div>
  )
}

/** 일감·입찰 탭 (28-6-01): 입찰 가능/입찰 중 일감 + 입찰 폼. 낙찰/미낙찰 결정은 고객 모드에서 (28-14-02) */
export default function Jobs() {
  const { platform, auth, refresh } = usePlatform()
  const partnerId = usePartnerId()
  // 28-34-02: 승인 전(pending/rejected)에는 입찰 폼·버튼 비활성
  const canBid = auth.partnerApproval()?.approval === 'approved'
  const today = todayUTC()
  // 28-42-03: 낙찰 전 요청 전부 노출 — 카드에 입찰 수 + 내 입찰 여부. 28-93: 관리자 검토 전 요청은 없는 일감이다
  // 28-94: 낙찰 전이라 주소·연락처·현장 사진은 없고 이름은 가려진 요청이다
  const jobs = platform.store
    .list()
    .filter((r) => (r.status === 'requested' || r.status === 'estimated') && !heldForReview(r))
    .map((r) => requestForPartner(r, partnerId))
  // 28-7-03: 카드의 "이 일감에 입찰" → 폼 대상 선택과 연동
  const [bidTarget, setBidTarget] = useState('')
  // 28-52-03: 낙찰 전 입찰 철회
  const [withdrawMsg, setWithdrawMsg] = useState('')
  const withdrawBid = (requestId: string) => {
    setWithdrawMsg('')
    try {
      platform.withdrawBid(requestId, partnerId, today)
      setWithdrawMsg(`${requestId} 입찰을 철회했습니다`)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setWithdrawMsg(err.message)
      else throw err
    }
  }
  // 28-11-02: 키워드·카테고리 필터
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'' | RepairCategory>('')
  // 28-24-03: 정렬 — 최신순(기본)/희망일 임박순/예산 높은순(예산 없는 건 뒤로)
  const [sortKey, setSortKey] = useState<SortKey>('latest')
  // 28-46-03: 내 지역·분야만 — 프로필에 분야가 있으면 기본 켜짐
  const profile = platform.getProfile(partnerId)
  const hasSpecialty = !!profile && profile.specialties.trim() !== ''
  const [matchedOnly, setMatchedOnly] = useState(hasSpecialty)
  const matchedIds = new Set(platform.matchedRequests(partnerId, today).map((r) => r.id))

  const keyword = query.trim()
  const visible = jobs
    .filter(
      (r) =>
        (!matchedOnly || matchedIds.has(r.id)) &&
        (categoryFilter === '' || categoriesOf(r).includes(categoryFilter)) &&
        (keyword === '' || [r.description, r.customerName, r.region].some((v) => v.includes(keyword))),
    )
    .sort((a, b) => {
      if (sortKey === 'desired') return a.desiredDate.localeCompare(b.desiredDate) || b.id.localeCompare(a.id)
      if (sortKey === 'deadline')
        return (a.bidDeadline ?? '9999').localeCompare(b.bidDeadline ?? '9999') || b.id.localeCompare(a.id)
      if (sortKey === 'budget') {
        if (a.budget === undefined && b.budget === undefined) return b.id.localeCompare(a.id)
        if (a.budget === undefined) return 1
        if (b.budget === undefined) return -1
        return b.budget - a.budget || b.id.localeCompare(a.id)
      }
      return b.id.localeCompare(a.id)
    })

  const pickForBid = (id: string) => {
    setBidTarget(id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div>
      <ApprovalBanner />
      {canBid && <BidForm selectedId={bidTarget} onSelect={setBidTarget} />}
      <div className="toolbar">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="키워드 검색 (요청 내용·고객·지역)"
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as '' | RepairCategory)}>
          <option value="">전체 카테고리</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label
          className="matched-toggle"
          title={hasSpecialty ? undefined : '마이 탭 프로필에서 전문 분야를 선택하면 맞춤 일감을 볼 수 있습니다'}
        >
          <input
            type="checkbox"
            aria-label="내 지역·분야만"
            checked={matchedOnly}
            disabled={!hasSpecialty}
            onChange={(e) => setMatchedOnly(e.target.checked)}
          />
          내 지역·분야만
        </label>
        <select aria-label="정렬" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="latest">최신순</option>
          <option value="desired">희망일 임박순</option>
          <option value="deadline">마감 임박순</option>
          <option value="budget">예산 높은순</option>
        </select>
      </div>
      {jobs.length > 0 && visible.length === 0 && (
        <EmptyState icon={ICON.search} title="검색 결과가 없습니다" sub="키워드나 카테고리 필터를 바꿔보세요" />
      )}
      {jobs.length === 0 && (
        <EmptyState
          icon={ICON.search}
          title="입찰 가능한 일감이 없습니다"
          sub="고객 모드에서 수리 요청이 등록되면 여기에 표시됩니다"
        />
      )}
      {withdrawMsg && (
        <div className="meta" data-withdraw-msg style={{ marginBottom: 8 }}>
          {withdrawMsg}
        </div>
      )}
      {visible.map((r) => {
        const bid = platform.bidOf(r.id, partnerId)
        const bidCount = platform.bidCount(r.id)
        const closed = platform.bidClosed(r.id, today)
        return (
          <Card key={r.id}>
            <div className="row">
              <div>
                <h3>
                  [{categoriesOf(r).join(' + ')}] {r.description}
                  {matchedIds.has(r.id) && (
                    <span className="svc-tag" style={{ marginLeft: 6 }} data-matched>
                      맞춤
                    </span>
                  )}
                </h3>
                <div className="meta">
                  {r.id} · {r.customerName} · {r.region} · 희망일 {r.desiredDate}
                  {r.desiredTime && <> {r.desiredTime}</>}
                  {r.budget !== undefined && (
                    <>
                      {' '}
                      · 예산 <strong>{krw(r.budget)}</strong>
                    </>
                  )}
                  {r.budgetRange && <> · 예산 {r.budgetRange}</>} <Dday deadline={r.bidDeadline} today={today} />
                </div>
                <div className="meta" data-private-note>
                  현장 사진·상세 주소·연락처는 낙찰 뒤 내 작업에서 열립니다
                </div>
                {r.answers && r.answers.length > 0 && (
                  <div>
                    {r.answers.map((a) => (
                      <div key={a.question} className="qa-line">
                        <span className="qa-q">{a.question}</span> — {a.answer}
                      </div>
                    ))}
                  </div>
                )}
                <div className="meta bid-count">
                  입찰 {bidCount}건
                  {closed
                    ? ' · 입찰 마감'
                    : bid
                      ? ` · 내 입찰 완료${bid.revision ? ` (${bid.revision}차 수정)` : ''}`
                      : bidCount > 0
                        ? ' · 아직 입찰 가능'
                        : ''}
                  {r.bidDeadline && <> · 마감 {r.bidDeadline}</>}
                </div>
                {bid && (
                  <div className="meta">
                    내 제안: {krw(bid.breakdown.total)}
                    {bid.estimate.memo && <> · "{bid.estimate.memo}"</>}
                  </div>
                )}
              </div>
              <StatusChip status={r.status} />
            </div>
            <div className="row" style={{ marginTop: 10, justifyContent: 'flex-start' }}>
              {closed && (
                <span className="pay-tag waiting" data-closed>
                  입찰 마감 — 고객 결정 대기
                </span>
              )}
              {!closed && !bid && (
                <button
                  onClick={() => pickForBid(r.id)}
                  disabled={!canBid}
                  title={canBid ? undefined : '관리자 승인 후 입찰할 수 있습니다'}
                >
                  이 일감에 입찰
                </button>
              )}
              {!closed && bid && (
                <>
                  <button className="btn-secondary" onClick={() => pickForBid(r.id)}>
                    제안 수정
                  </button>
                  <button className="btn-danger" data-withdraw-bid onClick={() => withdrawBid(r.id)}>
                    입찰 철회
                  </button>
                  <span className="meta">고객 결정 대기 중 — 고객이 견적함에서 비교 후 선택합니다</span>
                </>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
