import { useEffect, useState } from 'react'
import { usePlatform } from '../../app/PlatformContext'
import { payoutAccountLabels } from '../../../server/domain/auth'
import {
  todayUTC,
  PHOTO_RETENTION_DAYS,
  NOTIFICATION_READ_RETENTION_DAYS,
  CHAT_RETENTION_DAYS,
  AUDIT_RETENTION_DAYS,
  AUDIT_CAP,
} from '../../domain/platform'
import { toCsv } from '../../domain/csv'
import { downloadText } from '../../ui/download'
import { STATUS_LABEL } from '../../ui/constants'
import { krw, isKnownError } from '../../ui/format'
import { REVIEW_FLAG_LABEL } from '../../domain/safety'
import { categoriesOf } from '../../domain/platform'
import { ICON } from '../../ui/icons'
import { Card, Stat, ToggleGroup } from '../../ui/primitives'
import type { JobStatus } from '../../domain/types'

/** 조치 필요 (28-44-02): 오늘 처리할 항목을 한 카드로 — 승인·지급은 바로 처리, 나머지는 해당 탭 안내 */
function OpsQueueCard() {
  const { platform, auth, authActions, refresh } = usePlatform()
  const today = todayUTC()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const q = platform.opsQueue(today)
  const accounts = auth.listAccounts()
  const pendingPartners = accounts.filter(
    (a) => a.role === 'partner' && !a.withdrawnAt && (a.approval ?? 'pending') === 'pending' && a.verified,
  )
  const total =
    pendingPartners.length +
    q.counts.overdueRequests +
    q.counts.staleScheduled +
    q.counts.unpaidCompleted +
    q.counts.openClaims +
    q.counts.pendingPayouts +
    q.counts.pendingRefunds +
    q.counts.frequentCancellers +
    q.counts.unansweredClaims +
    q.counts.reviewQueue
  // 28-45-03: 환불 처리 입력(건별 차감액·사유)
  const [deduction, setDeduction] = useState<Record<string, string>>({})
  const [reason, setReason] = useState<Record<string, string>>({})
  // 28-93: 접수 검토 입력(건별 사유·확인 항목)
  type ReviewForm = {
    note: string
    contactChecked: boolean
    safetyDelivered: boolean
    identityChecked: boolean
    scopeChecked: boolean
  }
  const EMPTY_REVIEW: ReviewForm = {
    note: '',
    contactChecked: false,
    safetyDelivered: false,
    identityChecked: false,
    scopeChecked: false,
  }
  const [reviewForm, setReviewForm] = useState<Record<string, ReviewForm>>({})
  const reviewOf = (id: string) => reviewForm[id] ?? EMPTY_REVIEW
  const patchReview = (id: string, patch: Partial<ReviewForm>) =>
    setReviewForm((cur) => ({ ...cur, [id]: { ...(cur[id] ?? EMPTY_REVIEW), ...patch } }))
  const adminId = auth.sessionFor('admin')?.accountId ?? 'admin'

  // 28-70: 계정 변경(승인)은 async — 같은 run이 동기·비동기 둘 다 받는다
  const run = (fn: () => string | Promise<string>) => {
    setError('')
    setMessage('')
    void (async () => {
      try {
        setMessage(await fn())
        refresh()
      } catch (err) {
        if (isKnownError(err)) setError(err.message)
        else throw err
      }
    })()
  }
  const accountLabelOf = (partnerId: string) => {
    const acc = accounts.find((a) => a.id === partnerId)?.payoutAccount
    // 28-67-01: 표기 두 벌을 넘긴다 — 운영 기록에는 실명, 파일로 나가는 산출물에는 마스킹본
    return acc ? payoutAccountLabels(acc) : undefined
  }

  return (
    <Card title={`조치 필요 (${total}건)`} className="ops-card">
      {error && (
        <div className="error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      {message && (
        <div className="meta" style={{ marginBottom: 8 }}>
          {message}
        </div>
      )}
      {total === 0 && (
        <div className="meta" data-ops-empty>
          오늘 처리할 항목이 없습니다.
        </div>
      )}
      {q.counts.reviewQueue > 0 && (
        <div className="ops-group" data-ops="review">
          <div className="lr-title">
            접수 검토 필요 {q.counts.reviewQueue}건{' '}
            <span className="meta">— 고객에게 연락해 안전·작업 범위를 확인한 뒤 파트너에게 공개</span>
          </div>
          {q.reviewQueue.map(({ request, flags }) => {
            const f = reviewOf(request.id)
            const check = (key: keyof Omit<ReviewForm, 'note'>, label: string) => (
              <label className="row" style={{ justifyContent: 'flex-start', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={f[key]}
                  onChange={(e) => patchReview(request.id, { [key]: e.target.checked })}
                />
                {label}
              </label>
            )
            return (
              <div key={request.id} className="list-row" data-review={request.id}>
                <div>
                  <div className="lr-title">
                    [{categoriesOf(request).join(' + ')}] {request.description}
                    {flags.map((fl) => (
                      <span key={fl} className="svc-tag" data-review-flag={fl} style={{ marginLeft: 6 }}>
                        {REVIEW_FLAG_LABEL[fl]}
                      </span>
                    ))}
                  </div>
                  <div className="lr-sub">
                    {request.id} · {request.customerName} · {request.region} · 희망일 {request.desiredDate}
                    {request.safety && (
                      <>
                        {' '}
                        · 잠김 {request.safety.isLocked === null ? '—' : request.safety.isLocked ? '예' : '아니요'} ·
                        긴급 {request.safety.urgent === null ? '—' : request.safety.urgent ? '예' : '아니요'}
                      </>
                    )}
                  </div>
                  <div
                    className="row"
                    style={{ justifyContent: 'flex-start', gap: 10, marginTop: 6, flexWrap: 'wrap' }}
                  >
                    {check('contactChecked', '고객 연락 확인')}
                    {check('safetyDelivered', '안전 안내 전달')}
                    {flags.includes('LOCKOUT') && check('identityChecked', '신원 확인')}
                    {flags.includes('WORK_SCOPE_REVIEW') && check('scopeChecked', '작업 범위 확인')}
                  </div>
                  <input
                    value={f.note}
                    onChange={(e) => patchReview(request.id, { note: e.target.value })}
                    placeholder="검토 사유 (5자 이상)"
                    aria-label="검토 사유"
                    style={{ width: 280, marginTop: 6 }}
                  />
                </div>
                <div className="lr-right">
                  <button
                    onClick={() =>
                      run(() => {
                        platform.reviewRequest(request.id, f, adminId)
                        return `${request.id} 검토 완료 — 파트너에게 공개됐습니다`
                      })
                    }
                  >
                    검토 완료
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {pendingPartners.length > 0 && (
        <div className="ops-group" data-ops="approval">
          <div className="lr-title">승인 대기 파트너 {pendingPartners.length}건</div>
          {pendingPartners.map((a) => (
            <div key={a.id} className="list-row">
              <div>
                <div className="lr-title">
                  {a.name} <span className="meta">({a.id})</span>
                </div>
                <div className="lr-sub">
                  가입 {a.createdAt.slice(0, 10)} · {a.partnerType === 'business' ? '사업자' : '개인'}
                </div>
              </div>
              <div className="lr-right">
                <button
                  onClick={() =>
                    run(async () => {
                      await authActions.approvePartner(a.id)
                      platform.audit('admin', '파트너 승인', a.id, a.name)
                      return `${a.name} 승인 완료`
                    })
                  }
                >
                  승인
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {q.counts.overdueRequests > 0 && (
        <div className="ops-group" data-ops="overdue">
          <div className="lr-title">
            입찰 마감 경과 {q.counts.overdueRequests}건{' '}
            <span className="meta">— 고객 결정 대기, 견적 0건은 연장·취소 안내</span>
          </div>
          {q.overdueRequests.map((x) => (
            <div key={x.request.id} className="list-row">
              <div>
                <div className="lr-title">
                  [{x.request.category}] {x.request.description}
                </div>
                <div className="lr-sub">
                  {x.request.id} · {x.request.customerName} · 마감 {x.request.bidDeadline} ({x.daysOver}일 경과) · 견적{' '}
                  {x.bidCount}건
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {q.counts.staleScheduled > 0 && (
        <div className="ops-group" data-ops="stale">
          <div className="lr-title">
            방문일 경과·시공 미시작 {q.counts.staleScheduled}건 <span className="meta">— 파트너 확인</span>
          </div>
          {q.staleScheduled.map((x) => (
            <div key={x.request.id} className="list-row">
              <div>
                <div className="lr-title">
                  [{x.request.category}] {x.request.description}
                </div>
                <div className="lr-sub">
                  {x.request.id} · 방문일 {x.visitDate} ({x.daysOver}일 경과)
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {q.counts.unpaidCompleted > 0 && (
        <div className="ops-group" data-ops="unpaid">
          <div className="lr-title">
            결제 지연 {q.counts.unpaidCompleted}건{' '}
            <span className="meta">— 완료 후 미결제, 3일 지나면 자동 리마인더</span>
          </div>
          {q.unpaidCompleted.map((x) => (
            <div key={x.request.id} className="list-row">
              <div>
                <div className="lr-title">
                  [{x.request.category}] {x.request.description}
                </div>
                <div className="lr-sub">
                  {x.request.id} · {x.request.customerName} · 완료 {x.completedDate} ({x.daysSince}일) · {krw(x.amount)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {q.counts.openClaims > 0 && (
        <div className="ops-group" data-ops="claims">
          <div className="lr-title">
            미해결 분쟁 {q.counts.openClaims}건{' '}
            <span className="meta">— 분쟁 탭에서 처리 · 해당 거래는 정산·지급 보류</span>
          </div>
          {q.openClaims.map((c) => (
            <div key={c.id} className="list-row">
              <div>
                <div className="lr-title">분쟁 · {c.detail}</div>
                <div className="lr-sub">
                  {c.id} · {c.requestId} · 접수 {c.createdDate}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {q.counts.unansweredClaims > 0 && (
        <div className="ops-group" data-ops="unanswered">
          <div className="lr-title">
            파트너 무응답 분쟁 {q.counts.unansweredClaims}건{' '}
            <span className="meta">— 접수 2일 경과, 파트너 독촉 필요</span>
          </div>
          {q.unansweredClaims.map(({ claim, daysSince }) => (
            <div key={claim.id} className="list-row" data-unanswered={claim.id}>
              <div>
                <div className="lr-title">분쟁 · {claim.detail}</div>
                <div className="lr-sub">
                  {claim.id} · {claim.requestId} · 접수 {claim.createdDate} ({daysSince}일 경과)
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {q.counts.frequentCancellers > 0 && (
        <div className="ops-group" data-ops="cancels">
          <div className="lr-title">
            낙찰 후 취소 잦은 파트너 {q.counts.frequentCancellers}곳{' '}
            <span className="meta">— 90일 내 2회 이상, 회원 탭에서 정지 검토</span>
          </div>
          {q.frequentCancellers.map((x) => (
            <div key={x.partnerId} className="list-row" data-canceller={x.partnerId}>
              <div>
                <div className="lr-title">
                  {platform.getProfile(x.partnerId)?.name ?? x.partnerId} <span className="meta">({x.partnerId})</span>
                </div>
                <div className="lr-sub">
                  철회 {x.count}회 · 최근 {x.last}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {q.counts.pendingRefunds > 0 && (
        <div className="ops-group" data-ops="refund">
          <div className="lr-title">
            환불 대기 {q.counts.pendingRefunds}건{' '}
            <span className="meta">
              — 방문 전 취소는 전액, 방문일 경과는 실비 차감 협의. 완료 거래의 부분 환불(28-97)은 처리하면
              수수료·지급액이 다시 산정됩니다
            </span>
          </div>
          {q.pendingRefunds.map(({ refund, request }) => (
            <div key={refund.id} className="list-row" data-refund={refund.id}>
              <div>
                <div className="lr-title">
                  [{request.category}] {request.description} · 환불 {krw(refund.amount)}
                </div>
                <div className="lr-sub">
                  {refund.id} · {request.id} · {request.customerName} ·{' '}
                  {refund.afterVisit ? '방문일 경과 후 취소' : '방문 전 취소'}
                </div>
                {refund.afterVisit && (
                  <div className="row" style={{ justifyContent: 'flex-start', gap: 6, marginTop: 6 }}>
                    <input
                      value={deduction[refund.id] ?? ''}
                      onChange={(e) => setDeduction({ ...deduction, [refund.id]: e.target.value })}
                      inputMode="numeric"
                      placeholder="차감액(원)"
                      aria-label="차감액"
                      style={{ width: 120 }}
                    />
                    <input
                      value={reason[refund.id] ?? ''}
                      onChange={(e) => setReason({ ...reason, [refund.id]: e.target.value })}
                      placeholder="차감 사유"
                      aria-label="차감 사유"
                      style={{ width: 200 }}
                    />
                  </div>
                )}
              </div>
              <div className="lr-right">
                <button
                  onClick={() =>
                    run(() => {
                      const d = Number((deduction[refund.id] ?? '0').replace(/[^0-9]/g, '') || '0')
                      const done = platform.settleRefund(refund.id, { deduction: d, reason: reason[refund.id] ?? '' })
                      return `${refund.id} 환불 완료 — ${krw(done.amount - done.deduction)}`
                    })
                  }
                >
                  환불 완료
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {q.counts.pendingPayouts > 0 && (
        <div className="ops-group" data-ops="payout">
          <div className="lr-title">
            지급 대기 {q.counts.pendingPayouts}건 <span className="meta">— 이체 후 지급 완료</span>
          </div>
          {q.pendingPayouts.map((j) => (
            <div key={j.requestId} className="list-row">
              <div>
                <div className="lr-title">
                  {j.requestId} · {krw(platform.settlementFor(j.requestId)?.payable ?? j.total - j.platformFee)}
                </div>
                <div className="lr-sub">
                  {j.partnerId} · 완료 {j.completedDate} · {accountLabelOf(j.partnerId)?.label ?? '계좌 미등록'}
                </div>
              </div>
              <div className="lr-right">
                <button
                  onClick={() =>
                    run(() => {
                      const job = platform.markPayout(j.requestId, accountLabelOf(j.partnerId))
                      return `${j.requestId} 지급 완료 — ${krw(job.payout?.amount ?? 0)}`
                    })
                  }
                >
                  지급 완료
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/** 저장 용량 (28-49-01/02): 스냅샷 문자 수·사진 비중·한도 막대 + 오래된 사진 정리 */
function StorageCard() {
  const { platform, refresh } = usePlatform()
  const [message, setMessage] = useState('')
  const u = platform.storageUsage()
  const pct = Math.min(100, Math.round(u.ratio * 100))
  const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('ko-KR')}KB`
  const tone = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok'
  return (
    <Card title="저장 용량" className="storage-card">
      <div data-storage data-storage-pct={pct}>
        <div
          className="storage-bar"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="저장 용량 사용률"
        >
          <div className={`storage-fill ${tone}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="meta" style={{ marginTop: 6 }}>
          사용 {kb(u.totalChars)} / 한도 {kb(u.limit)} ({pct}%) · 리비전 {platform.revision} ·{' '}
          <span data-conflicts={platform.conflictCount}>탭 충돌 {platform.conflictCount}회</span>
        </div>
        <div className="storage-breakdown" data-storage-breakdown style={{ marginTop: 6 }}>
          <div className="storage-bar" aria-hidden="true">
            {(
              [
                ['photo', u.photoChars],
                ['notif', u.notificationChars],
                ['chat', u.chatChars],
                ['audit', u.auditChars],
                ['other', u.otherChars],
                // 28-73-01: 보관함은 스냅샷 밖이지만 같은 한도를 쓴다 — 카드에 보여야 사실이 된다
                ['stash', u.externalChars],
              ] as const
            ).map(([k, v]) => (
              <div
                key={k}
                className={`seg ${k}`}
                style={{ width: `${u.totalChars > 0 ? (v / u.totalChars) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="meta" style={{ marginTop: 4 }}>
            <span className="seg-dot photo" /> 사진 {u.photoCount}장 {kb(u.photoChars)} ·{' '}
            <span className="seg-dot notif" /> 알림 {u.notificationCount}건 {kb(u.notificationChars)} ·{' '}
            <span className="seg-dot chat" /> 채팅 {u.chatCount}건 {kb(u.chatChars)} ·{' '}
            <span className="seg-dot audit" data-storage-audit={u.auditCount} /> 기록 {u.auditCount}건{' '}
            {kb(u.auditChars)} · <span className="seg-dot other" /> 기타 {kb(u.otherChars)}
            {u.externalChars > 0 && (
              <>
                {' '}
                · <span className="seg-dot stash" data-storage-stash={u.externalChars} /> 덮인 변경 보관함{' '}
                {kb(u.externalChars)}
              </>
            )}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            data-prune-photos
            onClick={() => {
              const n = platform.prunePhotos()
              setMessage(
                n > 0
                  ? `${n}건의 사진을 정리했습니다`
                  : '정리할 사진이 없습니다 (정산·취소 후 ' + PHOTO_RETENTION_DAYS + '일 경과 건만)',
              )
              refresh()
            }}
          >
            오래된 사진 정리 ({PHOTO_RETENTION_DAYS}일)
          </button>
          <button
            className="btn-secondary"
            data-prune-notifications
            onClick={() => {
              const n = platform.pruneNotifications()
              setMessage(
                n > 0
                  ? `${n}건의 알림을 정리했습니다`
                  : `정리할 알림이 없습니다 (읽은 알림 ${NOTIFICATION_READ_RETENTION_DAYS}일·안 읽은 알림 90일 경과 건만)`,
              )
              refresh()
            }}
          >
            오래된 알림 정리
          </button>
          <button
            className="btn-secondary"
            data-prune-chats
            onClick={() => {
              const n = platform.pruneChats()
              setMessage(
                n > 0
                  ? `${n}건 거래의 채팅을 정리했습니다`
                  : `정리할 채팅이 없습니다 (거래 종료 후 ${CHAT_RETENTION_DAYS}일 경과 건만)`,
              )
              refresh()
            }}
          >
            오래된 채팅 정리 ({CHAT_RETENTION_DAYS}일)
          </button>
          {message && (
            <span className="meta" data-prune-msg>
              {message}
            </span>
          )}
        </div>
        <div className="meta" style={{ marginTop: 6 }}>
          브라우저 저장소(localStorage) 기준. 한도를 넘는 사진 첨부는 거부되고, 저장 실패는 상단 배너로 알립니다.
        </div>
      </div>
    </Card>
  )
}

const AUDIT_SHOW = 20
const fmtAt = (iso: string) => iso.slice(0, 16).replace('T', ' ')

/** 운영 기록 (28-57-02): 관리자 행위·시스템 정리 최근 20건 + 전체 CSV */
function AuditLogCard() {
  const { platform } = usePlatform()
  // 28-58-04: 주체 필터·검색·더 보기 — 사고 조사를 화면에서 끝낼 수 있게
  const [actor, setActor] = useState<'all' | 'admin' | 'system'>('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(AUDIT_SHOW)
  const all = platform.auditLog()
  const q = query.trim().toLowerCase()
  const filtered = all.filter((e) => {
    if (actor !== 'all' && e.actor !== actor) return false
    if (q === '') return true
    return (
      e.action.toLowerCase().includes(q) ||
      e.target.toLowerCase().includes(q) ||
      (e.detail ?? '').toLowerCase().includes(q) ||
      (e.by ?? '').toLowerCase().includes(q)
    )
  })
  const rows = filtered.slice(0, limit)
  const exportAudit = () => {
    const csv = toCsv(
      ['시각', '주체', '행위자', '행위', '대상', '상세', '첫 시각', '횟수'],
      filtered.map((e) => [
        e.at,
        e.actor === 'admin' ? '관리자' : '시스템',
        e.by ?? '',
        e.action,
        e.target,
        e.detail ?? '',
        e.firstAt ?? '',
        String(e.count ?? 1),
      ]),
    )
    downloadText(`audit-${todayUTC()}.csv`, csv, 'text/csv')
  }
  const narrowed = filtered.length !== all.length
  return (
    <Card title={`운영 기록 (${narrowed ? `${filtered.length}/${all.length}` : all.length}건)`}>
      <div className="row" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <ToggleGroup
          label="운영 기록 주체 필터"
          value={actor}
          options={(['all', 'admin', 'system'] as const).map((k) => ({
            value: k,
            label: k === 'all' ? '전체' : k === 'admin' ? '관리자' : '시스템',
            data: { 'data-audit-filter': k },
          }))}
          onChange={(k) => {
            setActor(k)
            setLimit(AUDIT_SHOW)
          }}
        />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(AUDIT_SHOW)
          }}
          placeholder="행위·대상·상세"
          aria-label="기록 검색"
          style={{ maxWidth: 220 }}
        />
        <button className="btn-secondary" onClick={exportAudit} disabled={filtered.length === 0} data-export-audit>
          운영 기록 CSV
        </button>
      </div>
      <div className="row" style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
        <span className="meta">
          관리자 행위와 시스템 정리 작업의 기록 — {AUDIT_RETENTION_DAYS}일·{AUDIT_CAP}건 보관
        </span>
      </div>
      {rows.length === 0 && (
        <div className="meta" data-audit-log>
          {all.length === 0 ? '아직 기록이 없습니다' : '조건에 맞는 기록이 없습니다'}
        </div>
      )}
      {rows.length > 0 && (
        <div className="table-wrap" style={{ boxShadow: 'none', border: 'none' }} data-audit-log>
          <table>
            <thead>
              <tr>
                <th>시각</th>
                <th>주체</th>
                <th>행위</th>
                <th>대상</th>
                <th>상세</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="audit-row" data-audit-actor={e.actor}>
                  <td className="meta">{e.firstAt ? `${fmtAt(e.firstAt)} ~ ${fmtAt(e.at).slice(11)}` : fmtAt(e.at)}</td>
                  <td>
                    <span className={`svc-tag${e.actor === 'system' ? ' indiv' : ''}`}>
                      {e.actor === 'admin' ? '관리자' : '시스템'}
                    </span>
                    {e.by && (
                      <div className="meta" data-audit-by={e.by}>
                        {e.by}
                      </div>
                    )}
                  </td>
                  <td>
                    {e.action}
                    {e.count ? (
                      <span className="badge" data-audit-count={e.count} style={{ marginLeft: 6 }}>
                        ×{e.count}
                      </span>
                    ) : null}
                  </td>
                  <td className="meta">{e.target}</td>
                  <td className="meta">{e.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > rows.length && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
          <button className="btn-secondary" onClick={() => setLimit((n) => n + AUDIT_SHOW)} data-audit-more>
            더 보기 ({rows.length}/{filtered.length})
          </button>
        </div>
      )}
    </Card>
  )
}

/** 플랫폼 현황 (28-14-03): 관리자용 전체 지표 + 수수료 수익 */
export default function AdminOverview() {
  const { platform, refresh } = usePlatform()
  // 28-44-03: 화면 진입 시 지연 이벤트 정리(멱등)
  useEffect(() => {
    const n =
      platform.sweepDeadlines() +
      platform.sweepPaymentReminders() +
      platform.sweepVisitReminders() +
      platform.prunePhotos() +
      platform.pruneNotifications() +
      platform.pruneChats() +
      platform.pruneAuditLog()
    if (n > 0) refresh()
  }, [platform, refresh])
  const ov = platform.adminOverview()
  const counts = platform.statusCounts()
  const stats = platform.bidStats()
  const nonZero = (Object.keys(counts) as JobStatus[]).filter((s) => counts[s] > 0)

  return (
    <div>
      <OpsQueueCard />
      <StorageCard />
      <div className="stat-grid">
        <Stat tone="blue" icon={ICON.search} label="전체 요청">
          {ov.totalRequests}
          <small>건</small>
        </Stat>
        <Stat tone="amber" icon={ICON.work} label="진행 중">
          {ov.activeRequests}
          <small>건</small>
        </Stat>
        <Stat tone="green" icon={ICON.clock} label="완료·정산">
          {ov.completedOrSettled}
          <small>건</small>
        </Stat>
        <Stat tone="brand" accent icon={ICON.wallet} label="수수료 수익 (확정)">
          {krw(ov.feeConfirmed)}
        </Stat>
        <Stat tone="amber" icon={ICON.work} label="미해결 분쟁">
          {platform.openClaimCount()}
          <small>건</small>
        </Stat>
      </div>
      <Card title="수수료 수익">
        <div className="bidstats">
          <span className="rate">{krw(ov.feeConfirmed + ov.feePending)}</span>
          <span className="part">
            누적 (확정 {krw(ov.feeConfirmed)} + 정산 예정 {krw(ov.feePending)})
          </span>
        </div>
        <div className="meta" style={{ marginTop: 4 }}>
          완료된 작업 금액의 3%가 플랫폼 수수료로 집계됩니다.
        </div>
      </Card>
      <Card title="요청 상태 분포">
        {nonZero.length === 0 && <div className="meta">등록된 요청이 없습니다</div>}
        <div className="row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
          {nonZero.map((s) => (
            <span key={s} className="badge">
              {STATUS_LABEL[s]} {counts[s]}
            </span>
          ))}
        </div>
        <div className="meta" style={{ marginTop: 8 }}>
          이탈(미낙찰·취소) {ov.lostOrCancelled}건
        </div>
      </Card>
      <Card title="파트너 입찰 성과">
        <div className="bidstats">
          <span className="rate">{stats.winRate === null ? '—' : `${stats.winRate}%`}</span>
          <span className="part">낙찰률 (결정 {stats.won + stats.lost}건 기준)</span>
          <span className="part">
            총 입찰 {stats.totalBids} · 낙찰 {stats.won} · 미낙찰 {stats.lost} · 대기 {stats.pending}
          </span>
        </div>
      </Card>
      <AuditLogCard />
    </div>
  )
}
