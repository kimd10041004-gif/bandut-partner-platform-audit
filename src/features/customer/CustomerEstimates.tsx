import type { RepairRequest, JobStatus } from '../../domain/types'
import { usePlatform } from '../../app/PlatformContext'
import { krw, isKnownError } from '../../ui/format'
import { ICON } from '../../ui/icons'
import { Card, StatusChip, EmptyState } from '../../ui/primitives'
import PartnerCard from '../../ui/PartnerCard'
import { useState } from 'react'

/** 견적함 (28-14-02): 받은 견적 검토 + 수락/거절 — 파트너 탭의 "고객 결정 시뮬레이션"을 실제 동선으로 이관 */
export default function CustomerEstimates() {
  const { platform, auth, refresh } = usePlatform()
  const [error, setError] = useState('')
  // 28-31-02: 견적 카드별 업체 정보 펼침 — 28-42-02: 요청:파트너 단위
  const [profileOpen, setProfileOpen] = useState('')
  // 28-32-01: 내 요청만 (계정 연결 없는 구 데이터·시드 제외)
  const myId = auth.sessionFor('customer')?.accountId
  const mine = platform.store.list().filter((r) => r.customerId === myId)
  const pending = mine.filter((r) => r.status === 'estimated')
  const decided = mine.filter((r) => r.status !== 'requested' && r.status !== 'estimated')

  const decide = (r: RepairRequest, to: JobStatus) => {
    setError('')
    try {
      platform.transitionRequest(r.id, to)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  // 28-42-02: 입찰 중 하나를 선택
  const accept = (r: RepairRequest, partnerId: string) => {
    setError('')
    try {
      platform.acceptBid(r.id, partnerId)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  const partnerName = (partnerId: string) => platform.getProfile(partnerId)?.name ?? partnerId

  return (
    <div>
      {error && (
        <div className="error" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}
      {pending.length === 0 && (
        <EmptyState
          icon={ICON.wallet}
          title="결정을 기다리는 견적이 없습니다"
          sub="파트너가 견적을 제안하면 여기에 표시됩니다"
        />
      )}
      {pending.map((r) => {
        const bids = platform.bidsFor(r.id)
        if (bids.length === 0) return null
        const lowest = bids[0]!.breakdown.total
        return (
          <Card key={r.id} title={`[${r.category}] ${r.description}`}>
            <div className="meta">
              {r.region} · 희망 방문일 {r.desiredDate} · <strong>견적 {bids.length}건</strong> (낮은 금액순)
            </div>
            {bids.map((bid, i) => {
              const pid = bid.estimate.partnerId
              const key = `${r.id}:${pid}`
              return (
                <div key={pid} className="bid-card" data-bid={pid}>
                  <div className="row">
                    <div>
                      <div className="lr-title">
                        {partnerName(pid)}
                        {bid.revision ? (
                          <span className="svc-tag" style={{ marginLeft: 6 }} data-revision={bid.revision}>
                            {bid.revision}차 수정
                          </span>
                        ) : null}
                        {i === 0 && bids.length > 1 && (
                          <span className="svc-tag" style={{ marginLeft: 6 }}>
                            최저가
                          </span>
                        )}
                        {bids.length > 1 && i > 0 && (
                          <span className="meta"> · 최저가 대비 +{krw(bid.breakdown.total - lowest)}</span>
                        )}
                      </div>
                      <div className="meta">
                        공급가 {krw(bid.breakdown.subtotal)} + 부가세 {krw(bid.breakdown.vat)}
                      </div>
                      {bid.estimate.memo && <div className="meta">파트너 메시지: "{bid.estimate.memo}"</div>}
                    </div>
                    <div className="total">{krw(bid.breakdown.total)}</div>
                  </div>
                  <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                    <button onClick={() => accept(r, pid)}>이 견적 수락</button>
                    <button className="btn-secondary" onClick={() => setProfileOpen(profileOpen === key ? '' : key)}>
                      업체 정보 {profileOpen === key ? '접기' : '보기'}
                    </button>
                  </div>
                  {profileOpen === key && <PartnerCard partnerId={pid} />}
                </div>
              )
            })}
            <div className="row" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
              <button className="btn-danger" onClick={() => decide(r, 'lost')}>
                전체 거절
              </button>
            </div>
          </Card>
        )
      })}
      {decided.length > 0 && (
        <Card title="결정한 요청">
          {decided.map((r) => (
            <div key={r.id} className="list-row">
              <div>
                <div className="lr-title">
                  [{r.category}] {r.description}
                </div>
                <div className="lr-sub">{r.region}</div>
              </div>
              <div className="lr-right">
                <StatusChip status={r.status} />
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
