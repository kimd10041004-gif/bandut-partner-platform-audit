import { useState } from 'react'
import { usePlatform } from '../../app/PlatformContext'
import { CLAIM_STATUS_LABEL } from '../../ui/constants'
import { ICON } from '../../ui/icons'
import { isKnownError } from '../../ui/format'
import { Card, EmptyState } from '../../ui/primitives'

/** 분쟁 처리 콘솔 (28-22-03 → 28-90): 미해결 우선 목록 + 검토/해결 액션. 열린 분쟁은 그 거래의 정산·지급을 보류한다 */
export default function AdminClaims() {
  const { platform, refresh } = usePlatform()
  const claims = platform.allClaims()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const act = (fn: () => void) => {
    setError('')
    try {
      fn()
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  if (claims.length === 0) {
    return (
      <EmptyState
        icon={ICON.user}
        title="접수된 분쟁이 없습니다"
        sub="고객이 거래 상세에서 접수하면 여기에 표시됩니다"
      />
    )
  }

  const open = claims.filter((c) => c.status !== 'resolved')
  const resolved = claims.filter((c) => c.status === 'resolved')

  return (
    <div>
      {error && (
        <div className="error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      <Card title={`처리 대기 (${open.length}건)`}>
        <div className="meta" style={{ marginBottom: 6 }}>
          열린 분쟁이 있는 거래는 해결 처리 전까지 정산 확정·지급이 보류됩니다.
        </div>
        {open.length === 0 && <div className="meta">모든 접수가 해결됐습니다</div>}
        {open.map((c) => {
          const req = platform.store.get(c.requestId)
          return (
            <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="row">
                <div>
                  <div style={{ fontWeight: 700 }}>
                    <span className="claim-tag dispute">분쟁</span> {c.detail}
                  </div>
                  <div className="meta" style={{ marginTop: 3 }}>
                    {c.id} · {req ? `[${req.category}] ${req.description} · ${req.customerName}` : c.requestId} · 접수{' '}
                    {c.createdDate}
                  </div>
                  {c.partnerReply ? (
                    <div className="meta" data-claim-reply style={{ marginTop: 3 }}>
                      파트너 답변 ({c.repliedDate}): {c.partnerReply}
                    </div>
                  ) : (
                    <div className="meta" style={{ marginTop: 3 }}>
                      <span className="pay-tag waiting">파트너 답변 없음</span>
                    </div>
                  )}
                </div>
                <span className={`claim-status ${c.status}`}>{CLAIM_STATUS_LABEL[c.status]}</span>
              </div>
              <div className="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
                {c.status === 'open' && (
                  <button className="btn-secondary" onClick={() => act(() => platform.reviewClaim(c.id))}>
                    검토 시작
                  </button>
                )}
                <input
                  value={notes[c.id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                  placeholder="처리 내용 (예: 재방문 보수 완료)"
                  style={{ flex: 1, minWidth: 180 }}
                />
                <button onClick={() => act(() => platform.resolveClaim(c.id, notes[c.id] ?? ''))}>해결 처리</button>
              </div>
            </div>
          )
        })}
      </Card>
      {resolved.length > 0 && (
        <Card title={`해결 이력 (${resolved.length}건)`}>
          {resolved.map((c) => {
            const req = platform.store.get(c.requestId)
            return (
              <div key={c.id} className="list-row">
                <div>
                  <div className="lr-title">
                    <span className="claim-tag dispute">분쟁</span> {c.detail}
                  </div>
                  <div className="lr-sub">
                    {req ? `[${req.category}] ${req.description}` : c.requestId} · 처리: {c.resolution} (
                    {c.resolvedDate})
                  </div>
                </div>
                <div className="lr-right">
                  <span className="claim-status resolved">{CLAIM_STATUS_LABEL.resolved}</span>
                </div>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
