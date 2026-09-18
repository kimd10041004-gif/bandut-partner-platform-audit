import { PlatformService } from '../domain/platform'
import { usePlatform } from '../app/PlatformContext'
import { Stars } from './primitives'

/** 업체 상세 (28-31-02, 시안 3): 프로필 + 숫자 우선 지표 + 최근 리뷰 3건.
 *  견적함(수락 전 비교 근거)과 거래 상세(시공 업체 카드)가 공유한다. */
export default function PartnerCard({ requestId, partnerId: explicit }: { requestId?: string; partnerId?: string }) {
  const { platform } = usePlatform()
  // 28-41-02: 그 요청의 견적 파트너 프로필·실적 — 28-42-02: 입찰 카드는 파트너를 직접 지정
  const partnerId =
    explicit ?? (requestId ? platform.partnerOf(requestId) : undefined) ?? PlatformService.LEGACY_PARTNER_ID
  // 28-91: 시연 시드가 없어졌으므로 고객·운영자·파트너가 같은 집계를 본다 (28-82의 public* 대응물은 사라졌다)
  const s = platform.partnerSummary(partnerId)
  const recent = platform.allReviews(partnerId).slice(0, 3)

  return (
    <div className="partner-card">
      <div className="row">
        <div>
          <div className="pc-name">
            {s.profile.name} <span className="svc-tag">{s.profile.specialties || '집수리 전반'}</span>
          </div>
          <div className="meta">{s.profile.region || '서울 전역'}</div>
        </div>
      </div>
      <div className="bidstats" style={{ marginTop: 8 }}>
        <span className="rate">{s.average === null ? '—' : `★${s.average}`}</span>
        <span className="part">리뷰 {s.reviewCount}건</span>
        <span className="part">완료 {s.completedCount}건</span>
        <span className="part">낙찰률 {s.winRate === null ? '—' : `${s.winRate}%`}</span>
        {s.cancelCount > 0 && (
          <span className="part cancel-warn" data-cancel-count={s.cancelCount}>
            낙찰 후 취소 {s.cancelCount}회 (90일)
          </span>
        )}
      </div>
      <p className="pc-intro">{s.profile.intro}</p>
      {recent.length > 0 && (
        <div>
          {recent.map((rv) => (
            <div key={rv.requestId} className="list-row">
              <div>
                <div className="lr-title">
                  <Stars rating={rv.rating} />
                </div>
                {rv.text && <div className="lr-sub">{rv.text}</div>}
                {rv.reply && (
                  <div className="lr-sub" data-review-reply>
                    ↳ 업체 답글: {rv.reply}
                  </div>
                )}
              </div>
              <div className="lr-right meta">{rv.createdDate}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
