import { useState } from 'react'
import { CHECKLIST_ITEMS, parseTokens, type PartnerProfile } from '../domain/platform'
import { ALL_CATEGORIES, type RepairCategory } from '../domain/types'
import CategoryPicker from '../ui/CategoryPicker'
import { usePlatform, usePartnerId } from '../app/PlatformContext'
import { isKnownError } from '../ui/format'
import { Card, Stars } from '../ui/primitives'
import { downloadText } from '../ui/download'
import { todayUTC } from '../domain/platform'
import MyAccount from './auth/MyAccount'
import OverwrittenBox from '../ui/OverwrittenBox'

/** 마이 탭 (28-8-04): 파트너 프로필 등록/수정 */
/** 리뷰 답글 (28-53-03): 그 작업의 파트너가 답글을 남기거나 고친다 */
function ReviewReplyForm({ requestId, hasReply }: { requestId: string; hasReply: boolean }) {
  const { platform, refresh } = usePlatform()
  const partnerId = usePartnerId()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const submit = () => {
    setError('')
    try {
      platform.replyReview(requestId, partnerId, text)
      setText('')
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  return (
    <div className="row" style={{ justifyContent: 'flex-start', gap: 6, marginTop: 6 }}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={hasReply ? '답글 수정' : '예: 이용해 주셔서 감사합니다'}
        aria-label="리뷰 답글"
        style={{ flex: 1, minWidth: 200 }}
      />
      <button className="btn-secondary" onClick={submit}>
        {hasReply ? '답글 수정' : '답글 저장'}
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  )
}

export default function MyProfile() {
  const { platform, refresh } = usePlatform()
  const partnerId = usePartnerId()
  const saved = platform.getProfile(partnerId)
  const [name, setName] = useState(saved?.name ?? '')
  const [specialties, setSpecialties] = useState(saved?.specialties ?? '')
  const [region, setRegion] = useState(saved?.region ?? '')
  const [intro, setIntro] = useState(saved?.intro ?? '')
  const [message, setMessage] = useState('')

  const submit = () => {
    setMessage('')
    try {
      const profile: PartnerProfile = { name, specialties, region, intro }
      platform.updateProfile(profile, partnerId)
      setMessage('프로필을 저장했습니다')
      refresh()
    } catch (err) {
      if (isKnownError(err)) setMessage(err.message)
      else throw err
    }
  }

  const stats = platform.bidStats(partnerId)
  const rstats = platform.reviewStats(partnerId)
  const reviews = platform.allReviews(partnerId)

  return (
    <div>
      <MyAccount role="partner" />
      <Card title="입찰 성과">
        <div className="bidstats">
          <span className="rate">{stats.winRate === null ? '—' : `${stats.winRate}%`}</span>
          <span className="part">낙찰률 (결정 {stats.won + stats.lost}건 기준)</span>
          <span className="part">
            총 입찰 {stats.totalBids} · 낙찰 {stats.won} · 미낙찰 {stats.lost} · 대기 {stats.pending}
          </span>
          <span className="part">
            평균 평점 {rstats.average === null ? '—' : `★${rstats.average}`} ({rstats.count}건)
          </span>
        </div>
      </Card>
      <Card title={`고객 리뷰 (${rstats.count}건)`}>
        {reviews.length === 0 && <div className="meta">아직 받은 리뷰가 없습니다 — 작업 완료 후 고객이 남깁니다</div>}
        {reviews.map((rv) => {
          const req = platform.store.get(rv.requestId)
          return (
            <div key={rv.requestId} className="review-item">
              <div>
                <Stars rating={rv.rating} /> <span className="meta">{rv.createdDate}</span>
              </div>
              {rv.text && <div style={{ marginTop: 3 }}>{rv.text}</div>}
              {req && (
                <div className="meta" style={{ marginTop: 2 }}>
                  [{req.category}] {req.description} · {req.customerName}
                </div>
              )}
              {rv.reply && (
                <div className="meta" data-review-reply style={{ marginTop: 3 }}>
                  내 답글 ({rv.repliedDate}): {rv.reply}
                </div>
              )}
              <ReviewReplyForm requestId={rv.requestId} hasReply={rv.reply !== undefined} />
            </div>
          )
        })}
      </Card>
      {saved && (
        <Card>
          <div className="row">
            <div>
              <h3>{saved.name}</h3>
              <div className="meta">
                {saved.specialties && <>전문 분야: {saved.specialties} · </>}
                {saved.region && <>서비스 지역: {saved.region}</>}
              </div>
              {saved.intro && <div className="meta">{saved.intro}</div>}
            </div>
            <span className="chip st-accepted">파트너 {partnerId}</span>
          </div>
        </Card>
      )}
      <Card className="form">
        <h3 style={{ margin: 0 }}>{saved ? '프로필 수정' : '프로필 등록'}</h3>
        <label>
          업체명 (필수)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 반듯인테리어" />
        </label>
        <div className="form-wide">
          <div className="meta" style={{ marginBottom: 6 }}>
            전문 분야 — 선택한 카테고리의 일감만 "맞춤"으로 표시되고 새 일감 알림을 받습니다
          </div>
          <div className="specialty-pick">
            <CategoryPicker
              categories={ALL_CATEGORIES}
              selected={parseTokens(specialties).flatMap((t) =>
                ALL_CATEGORIES.includes(t as RepairCategory) ? [t as RepairCategory] : [],
              )}
              multi
              compact
              onPick={(c) => {
                const cur = parseTokens(specialties)
                setSpecialties((cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]).join(', '))
              }}
            />
          </div>
        </div>
        <label className="form-wide">
          서비스 지역 (쉼표로 구분 — 요청 지역에 포함되면 매칭, 비우면 전국)
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="예: 서울, 경기 고양시"
            aria-label="서비스 지역"
          />
        </label>
        <label className="form-wide">
          소개
          <input
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            placeholder="예: 꼼꼼한 시공, 정직한 견적을 약속드립니다"
          />
        </label>
        <button onClick={submit}>저장</button>
        {message && <div className="meta">{message}</div>}
      </Card>
      <Card title="체크리스트 항목 안내">
        <div className="meta">
          낙찰된 작업 카드에는 다음 체크리스트가 제공됩니다: {CHECKLIST_ITEMS.map((i) => i.label).join(' · ')}
        </div>
      </Card>
      <PartnerDataCard partnerId={partnerId} />
    </div>
  )
}

/**
 * 파트너 열람권 (28-61-03): 고객 카드(MyAccount의 MyDataCard)와 같은 모양 —
 * 내가 입찰했거나 낙찰받은 요청 범위만 담긴다.
 */
function PartnerDataCard({ partnerId }: { partnerId: string }) {
  const { platform, refresh } = usePlatform()
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  return (
    <Card title="내 데이터 내보내기">
      <div className="meta form-wide" style={{ marginBottom: 8 }}>
        내가 입찰했거나 낙찰받은 일감과 그에 딸린 견적·방문·완료 작업·정산·리뷰·분쟁 답변만 담깁니다. 고객 이름·연락처는
        포함되지 않습니다.
      </div>
      <div className="row form-wide" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <button
          data-export-partnerdata
          onClick={() => {
            setErr('')
            try {
              const { json, requests } = platform.exportPartnerData(partnerId)
              downloadText(`my-partner-data-${todayUTC()}.json`, json, 'application/json')
              setMsg(`일감 ${requests}건을 JSON으로 내려받았습니다`)
              refresh()
            } catch (e) {
              if (isKnownError(e)) setErr(e.message)
              else throw e
            }
          }}
        >
          전체 JSON
        </button>
        {msg && (
          <span className="meta" data-partnerdata-msg>
            {msg}
          </span>
        )}
      </div>
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
