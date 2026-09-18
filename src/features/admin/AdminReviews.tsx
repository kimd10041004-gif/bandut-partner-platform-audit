import { usePlatform } from '../../app/PlatformContext'
import { ICON } from '../../ui/icons'
import { Card, EmptyState, Stars } from '../../ui/primitives'

/** 리뷰 관리 (28-17-04, 시안 4 메뉴): 전체 리뷰 + 평점 요약 */
export default function AdminReviews() {
  const { platform } = usePlatform()
  const stats = platform.reviewStats()
  const reviews = platform.allReviews()

  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={ICON.user}
        title="아직 등록된 리뷰가 없습니다"
        sub="고객이 작업 완료 후 리뷰를 남기면 여기에 표시됩니다"
      />
    )
  }

  return (
    <div>
      <Card title="평점 요약">
        <div className="bidstats">
          <span className="rate">★{stats.average}</span>
          <span className="part">평균 평점 (리뷰 {stats.count}건 기준)</span>
        </div>
      </Card>
      <Card title={`전체 리뷰 (${reviews.length}건)`}>
        <div className="table-wrap" style={{ boxShadow: 'none', border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>요청</th>
                <th>고객</th>
                <th>별점</th>
                <th>내용</th>
                <th>작성일</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((rv) => {
                const req = platform.store.get(rv.requestId)
                return (
                  <tr key={rv.requestId}>
                    <td>{req ? `[${req.category}] ${req.description}` : rv.requestId}</td>
                    <td>{req?.customerName ?? '—'}</td>
                    <td>
                      <Stars rating={rv.rating} />
                    </td>
                    <td>
                      {rv.text || '—'}
                      {rv.reply && (
                        <div className="meta" data-review-reply>
                          ↳ 답글 ({rv.repliedDate}): {rv.reply}
                        </div>
                      )}
                    </td>
                    <td className="meta">{rv.createdDate}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
