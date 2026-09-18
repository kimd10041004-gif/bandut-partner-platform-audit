import { todayUTC, requestForPartner } from '../domain/platform'
import { slotsOn } from '../domain/schedule'
import { usePlatform, usePartnerId } from '../app/PlatformContext'
import ApprovalBanner from '../ui/ApprovalBanner'
import { STATUS_LABEL } from '../ui/constants'
import { krw, koreanDate } from '../ui/format'
import { ICON } from '../ui/icons'
import { Card, Stat, StatusChip } from '../ui/primitives'

export default function Dashboard() {
  const { platform } = usePlatform()
  const partnerId = usePartnerId()
  const today = todayUTC()
  // 28-41-03: 모든 지표는 로그인한 파트너 범위
  const todaySlots = slotsOn(platform.scheduleSlots, partnerId, today)
  const upcoming = platform.upcomingSlots(today, 5, partnerId)
  const counts = platform.statusCounts(partnerId)
  const unsettled = platform.unsettledPayout(partnerId)
  const activeStatuses = (
    ['requested', 'estimated', 'accepted', 'scheduled', 'in_progress', 'completed'] as const
  ).filter((s) => counts[s] > 0)

  const inProgressCount = counts.scheduled + counts.in_progress
  const month = today.slice(0, 7)
  const summary = platform.monthSummary(month, partnerId)
  const bstats = platform.bidStats(partnerId)
  const rstats = platform.reviewStats(partnerId)
  const profileName = platform.getProfile(partnerId)?.name
  return (
    <div>
      <ApprovalBanner />
      <div className="hero">
        <div className="hero-date">{koreanDate(today)}</div>
        <h2 className="hero-greet">{profileName ? `${profileName} 파트너님,` : '파트너님,'} 좋은 하루 되세요!</h2>
      </div>
      <div className="stat-grid">
        <Stat tone="green" icon={ICON.clock} label="오늘의 작업">
          {todaySlots.length}
          <small>건</small>
        </Stat>
        <Stat tone="blue" icon={ICON.search} label="맞춤 일감">
          {platform.matchedRequests(partnerId, today).length}
          <small>건 / 전체 {platform.statusCounts().requested + platform.statusCounts().estimated}</small>
        </Stat>
        <Stat tone="amber" icon={ICON.work} label="진행 중">
          {inProgressCount}
          <small>건</small>
        </Stat>
        <Stat tone="brand" accent icon={ICON.wallet} label="정산 예정 금액">
          {krw(unsettled)}
        </Stat>
      </div>
      <Card title={`이번 달 실적 요약 (${month})`}>
        <div className="bidstats">
          <span className="rate">{krw(summary.unsettledPayout)}</span>
          <span className="part">정산 예정액</span>
          <span className="part">
            완료 {summary.jobCount}건 · 확정 지급 {krw(summary.settledPayout)}
          </span>
          <span className="part">
            낙찰률 {bstats.winRate === null ? '—' : `${bstats.winRate}%`} · 평균 평점{' '}
            {rstats.average === null ? '—' : `★${rstats.average}`}
          </span>
        </div>
      </Card>
      <Card title={`오늘 방문 일정 (${today})`}>
        {todaySlots.length === 0 && <div className="meta">오늘 예정된 방문이 없습니다</div>}
        {todaySlots.map((s) => {
          const raw = platform.store.get(s.requestId)
          const req = raw ? requestForPartner(raw, partnerId) : undefined
          return (
            <div key={s.id} className="list-row">
              <div>
                <div className="lr-title">{req ? `[${req.category}] ${req.description}` : s.requestId}</div>
                {req && (
                  <div className="lr-sub">
                    {req.customerName} · {req.region}
                  </div>
                )}
              </div>
              <div className="lr-right">
                {String(s.startHour).padStart(2, '0')}:00~{String(s.endHour).padStart(2, '0')}:00
                {req && (
                  <div style={{ marginTop: 3 }}>
                    <StatusChip status={req.status} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </Card>
      <Card title="다가오는 일정">
        {upcoming.length === 0 && <div className="meta">예정된 일정이 없습니다</div>}
        {upcoming.map((s) => {
          const raw = platform.store.get(s.requestId)
          const req = raw ? requestForPartner(raw, partnerId) : undefined
          return (
            <div key={s.id} className="list-row">
              <div>
                <div className="lr-title">{req ? `[${req.category}] ${req.description}` : s.requestId}</div>
                {req && <div className="lr-sub">{req.customerName}</div>}
              </div>
              <div className="lr-right">
                {s.date} {String(s.startHour).padStart(2, '0')}:00
              </div>
            </div>
          )
        })}
      </Card>
      <Card title="진행 현황">
        {activeStatuses.length === 0 && <div className="meta">진행 중인 요청이 없습니다</div>}
        <div className="row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
          {activeStatuses.map((s) => (
            <span key={s} className="badge">
              {STATUS_LABEL[s]} {counts[s]}
            </span>
          ))}
        </div>
      </Card>
    </div>
  )
}
