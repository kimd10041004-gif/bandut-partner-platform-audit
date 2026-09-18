import { useState } from 'react'
import type { RepairRequest, JobStatus, RequestPhoto } from '../domain/types'
import { MAX_PHOTOS, PlatformService, requestForPartner } from '../domain/platform'
import { resizeImageFile } from '../ui/image'
import { nextStatuses } from '../domain/jobStatus'
import { parseWonInput } from '../domain/money'
import { usePlatform, usePartnerId } from '../app/PlatformContext'
import { STATUS_LABEL } from '../ui/constants'
import { krw, isKnownError, fmtPhone } from '../ui/format'
import { ICON } from '../ui/icons'
import { Card, StatusChip, WorkStepper, EmptyState, ToggleGroup } from '../ui/primitives'
import PhotoStrip from '../ui/PhotoStrip'
import ChatBox from '../ui/ChatBox'

/** 추가 작업 승인 요청 폼 (28-15-01): 파트너가 요청하고 고객이 견적함·거래 상세에서 결정한다 */
function ExtraWorkForm({ requestId }: { requestId: string }) {
  const { platform, refresh } = usePlatform()
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  // 28-96: 공급가를 받고 VAT 10%를 얹어 보낸다
  const supplyPreview = (() => {
    try {
      return amount.trim() === '' ? 0 : parseWonInput(amount)
    } catch {
      return 0
    }
  })()

  const submit = () => {
    setError('')
    try {
      platform.requestExtraWork(requestId, { supply: parseWonInput(amount), memo })
      setAmount('')
      setMemo('')
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  return (
    <div className="form" style={{ marginTop: 8, maxWidth: 420 }}>
      <div className="meta">추가 작업 승인 요청 — 고객이 승인해야 최종 금액에 반영됩니다</div>
      <label>
        공급가 (원) — VAT 10%가 더해집니다
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="예: 50000" />
        {supplyPreview > 0 && (
          <span className="meta" data-extra-preview>
            VAT {krw(PlatformService.vatOf(supplyPreview))} · 합계{' '}
            {krw(supplyPreview + PlatformService.vatOf(supplyPreview))}
          </span>
        )}
      </label>
      <label>
        내용
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 곰팡이 제거" />
      </label>
      <button onClick={submit}>고객에게 승인 요청</button>
      {error && <div className="error">{error}</div>}
    </div>
  )
}

/** 분쟁 답변 (28-53-02): 미해결 접수에 파트너가 답변을 남긴다 — 최신 답변으로 덮어쓰기 */
function ClaimReplyBox({ request }: { request: RepairRequest }) {
  const { platform, refresh } = usePlatform()
  const partnerId = usePartnerId()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const claims = platform.claimsFor(request.id).filter((c) => c.status !== 'resolved')
  if (claims.length === 0) return null
  const submit = (claimId: string) => {
    setError('')
    try {
      platform.replyClaim(claimId, partnerId, drafts[claimId] ?? '')
      setDrafts({ ...drafts, [claimId]: '' })
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  return (
    <div className="claim-replies" data-claim-replies>
      {claims.map((c) => (
        <div key={c.id} className="list-row" data-claim={c.id}>
          <div style={{ flex: 1 }}>
            <div className="lr-title">
              <span className="claim-tag dispute">분쟁</span> {c.detail}
            </div>
            <div className="lr-sub">
              접수 {c.createdDate}
              {c.partnerReply ? (
                <>
                  {' '}
                  · 내 답변 ({c.repliedDate}): {c.partnerReply}
                </>
              ) : (
                <>
                  {' '}
                  · <strong>답변 없음</strong> — 2일 안에 답변해 주세요
                </>
              )}
            </div>
            <div className="row" style={{ justifyContent: 'flex-start', gap: 6, marginTop: 6 }}>
              <input
                value={drafts[c.id] ?? ''}
                onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })}
                placeholder="예: 내일 오전 재방문하겠습니다"
                aria-label="분쟁 답변"
                style={{ flex: 1, minWidth: 200 }}
              />
              <button className="btn-secondary" onClick={() => submit(c.id)}>
                답변 저장
              </button>
            </div>
          </div>
        </div>
      ))}
      {error && <div className="error">{error}</div>}
    </div>
  )
}

/** 작업 사진 세트 (28-49-03 / 28-96): 작업 전(방문 예정부터)·완료(시공 중부터) — 낙찰 파트너가 최종 결제 전까지 첨부·삭제 */
function JobPhotos({ request, kind }: { request: RepairRequest; kind: 'before' | 'completion' }) {
  const { platform, refresh } = usePlatform()
  const partnerId = usePartnerId()
  const [msg, setMsg] = useState('')
  const photos = (kind === 'before' ? request.beforePhotos : request.completionPhotos) ?? []
  const label = kind === 'before' ? '작업 전 사진' : '완료 사진'
  const stages: JobStatus[] =
    kind === 'before' ? ['scheduled', 'in_progress', 'completed'] : ['in_progress', 'completed']
  const editable = stages.includes(request.status) && !platform.paymentFor(request.id, 'final')
  const apply = (next: RequestPhoto[]) => {
    try {
      if (kind === 'before') platform.setBeforePhotos(request.id, partnerId, next)
      else platform.setCompletionPhotos(request.id, partnerId, next)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setMsg(err.message)
      else throw err
    }
  }
  const addFiles = async (files: FileList | null) => {
    setMsg('')
    if (!files) return
    const room = MAX_PHOTOS - photos.length
    if (files.length > room) setMsg(`${label}은 최대 ${MAX_PHOTOS}장까지 첨부됩니다`)
    const next: RequestPhoto[] = []
    for (const f of [...files].slice(0, room)) {
      try {
        next.push(await resizeImageFile(f))
      } catch (err) {
        // 28-67-04: `err instanceof Error`는 TypeError 같은 진짜 버그의 메시지까지 사용자에게 보였다.
        if (!isKnownError(err)) throw err
        setMsg(err.message)
      }
    }
    if (next.length > 0) apply([...photos, ...next].slice(0, MAX_PHOTOS))
  }
  if (!editable && photos.length === 0) return null
  return (
    <div className="completion-photos" data-photo-kind={kind}>
      {editable && (
        <label className="photo-label">
          {label} (최대 {MAX_PHOTOS}장 —{' '}
          {kind === 'before' ? '완료 확인의 증빙, 계약 작업은 필수' : '고객이 최종 결제 전에 확인합니다'})
          <input
            type="file"
            accept="image/*"
            multiple
            className="photo-input"
            aria-label={label}
            disabled={photos.length >= MAX_PHOTOS}
            onChange={(e) => {
              void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      )}
      <PhotoStrip
        photos={photos}
        completion={kind === 'completion'}
        before={kind === 'before'}
        {...(editable
          ? { onRemove: (id: string) => apply(photos.filter((p) => p.id !== id)) }
          : { title: kind === 'before' ? '작업 전 사진' : '시공 완료 사진' })}
      />
      {msg && <div className="meta">{msg}</div>}
    </div>
  )
}

/** 낙찰 철회 (28-50-03): 낙찰·방문 예정 상태에서 사유를 남기고 2단계 확인 — 요청은 재오픈, 예약금은 환불 대기 */
function WithdrawAward({ request }: { request: RepairRequest }) {
  const { platform, refresh } = usePlatform()
  const partnerId = usePartnerId()
  const [armed, setArmed] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const submit = () => {
    setError('')
    try {
      platform.withdrawAward(request.id, partnerId, reason)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  return (
    <div className="withdraw-box" data-withdraw>
      {!armed ? (
        <button className="btn-danger" onClick={() => setArmed(true)}>
          낙찰 철회
        </button>
      ) : (
        <div className="form" style={{ gap: 6 }}>
          <div className="form-wide meta">
            사유를 남기면 요청이 다시 입찰에 열리고, 결제된 예약금은 고객에게 전액 환불됩니다. 철회 기록은 업체 카드에
            90일간 표시됩니다.
          </div>
          <label>
            철회 사유
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 일정 충돌"
              aria-label="철회 사유"
            />
          </label>
          <div className="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <button className="btn-danger" onClick={submit}>
              철회 확정
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setArmed(false)
                setError('')
              }}
            >
              돌아가기
            </button>
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  )
}

/** 내 작업 탭: 낙찰 이후 진행 흐름 + 추가 작업 승인 (28-6-02) */
const WORK_FILTERS = [
  {
    key: 'all',
    label: '전체',
    statuses: ['accepted', 'scheduled', 'in_progress', 'completed', 'settled', 'lost', 'cancelled'],
  },
  { key: 'accepted', label: '낙찰', statuses: ['accepted'] },
  { key: 'scheduled', label: '작업 예정', statuses: ['scheduled'] },
  { key: 'in_progress', label: '진행 중', statuses: ['in_progress'] },
  { key: 'completed', label: '완료·정산', statuses: ['completed', 'settled'] },
  { key: 'closed', label: '종결', statuses: ['lost', 'cancelled'] },
] as const

export default function Work() {
  const { platform, refresh } = usePlatform()
  const partnerId = usePartnerId()
  const [filterKey, setFilterKey] = useState<(typeof WORK_FILTERS)[number]['key']>('all')
  // 28-27-03: 카드별 채팅 펼침 (한 번에 하나)
  const [chatOpen, setChatOpen] = useState('')
  // 28-41-03/28-42-03: 내 입찰 건 중 결정된 건 — 타 파트너에게 낙찰된 건은 미낙찰(lost)로 본다
  const allWork = platform.store
    .list()
    .filter((r) => platform.bidOf(r.id, partnerId) !== undefined)
    // 28-94: 낙찰 파트너에게만 주소·연락처·사진이 열린다 — 미낙찰(lost)·낙찰 전 행은 가려진 채다
    .map((r) => ({ ...requestForPartner(r, partnerId), status: platform.statusFor(r.id, partnerId) }))
    .filter((r) =>
      ['accepted', 'scheduled', 'in_progress', 'completed', 'settled', 'lost', 'cancelled'].includes(r.status),
    )
  const statuses = WORK_FILTERS.find((f) => f.key === filterKey)!.statuses as readonly JobStatus[]
  const active = allWork.filter((r) => statuses.includes(r.status))
  const [error, setError] = useState('')

  const doTransition = (r: RepairRequest, to: JobStatus) => {
    setError('')
    try {
      platform.transitionRequest(r.id, to)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(`${r.id}: ${err.message}`)
      else throw err
    }
  }

  return (
    <div>
      {error && (
        <div className="error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
        <ToggleGroup
          label="작업 상태 필터"
          value={filterKey}
          buttonStyle={{ marginRight: 6 }}
          options={WORK_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
          onChange={(k) => setFilterKey(k as typeof filterKey)}
        />
      </div>
      {active.length === 0 && allWork.length > 0 && (
        <EmptyState icon={ICON.work} title="이 상태의 작업이 없습니다" sub="다른 필터를 선택해 보세요" />
      )}
      {active.length === 0 && allWork.length === 0 && (
        <EmptyState
          icon={ICON.work}
          title="진행 중인 작업이 없습니다"
          sub="일감·입찰 탭에서 입찰하고 낙찰되면 여기에 표시됩니다"
        />
      )}
      {active.map((r) => {
        const bid = platform.bidOf(r.id, partnerId)
        const extras = platform.extraWorksFor(r.id)
        const openClaims = platform.claimsFor(r.id).filter((c) => c.status !== 'resolved')
        const extraSum = extras.filter((e) => (e.status ?? 'approved') === 'approved').reduce((s, e) => s + e.amount, 0)
        return (
          <Card key={r.id}>
            <div className="row">
              <div>
                <h3>
                  [{r.category}] {r.description}
                </h3>
                <div className="meta">
                  {r.id} · {r.customerName} · {r.region} · 희망일 {r.desiredDate}
                  {bid && r.status !== 'cancelled' && r.status !== 'lost' && (
                    <> · 낙찰 금액 {krw(bid.breakdown.total)}</>
                  )}
                  {extraSum > 0 && <> · 승인된 추가 작업 +{krw(extraSum)}</>}
                </div>
                {(r.address || r.phone) && (
                  <div className="meta" data-private-details>
                    {r.address && <>방문지 {r.address}</>}
                    {r.address && r.phone && <> · </>}
                    {r.phone && <>연락처 {fmtPhone(r.phone)}</>}
                  </div>
                )}
                <PhotoStrip photos={r.photos} />
                {extras.map((e) => {
                  const st = e.status ?? 'approved'
                  const label = st === 'pending' ? '승인 대기' : st === 'approved' ? '승인됨' : '거절됨'
                  return (
                    <div key={e.id} className="meta">
                      └ {e.memo || '추가 작업'} +{krw(e.amount)}
                      {e.supply !== undefined && ` (공급가 ${krw(e.supply)} + VAT ${krw(e.vat ?? 0)})`} (
                      {e.approvedDate}) <span className={`extra-status ${st}`}>{label}</span>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
                <StatusChip status={r.status} />
                {openClaims.map((c) => (
                  <span key={c.id} className="claim-tag dispute">
                    분쟁 접수됨 · 정산 보류
                  </span>
                ))}
                {platform.paymentFor(r.id, 'final') ? (
                  <span className="pay-tag paid">결제 완료</span>
                ) : r.status === 'completed' ? (
                  <span className="pay-tag waiting">결제 대기</span>
                ) : platform.paymentFor(r.id, 'deposit') ? (
                  <span className="pay-tag paid">예약금 결제됨</span>
                ) : null}
              </div>
            </div>
            <WorkStepper status={r.status} />
            {['accepted', 'scheduled', 'in_progress'].includes(r.status) && (
              <div className="checklist">
                {platform.checklistFor(r.id).map((item) => (
                  <label key={item.key} className={item.done ? 'done' : ''}>
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => {
                        platform.toggleChecklistItem(r.id, item.key)
                        refresh()
                      }}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 8, justifyContent: 'flex-start' }}>
              {nextStatuses(r.status)
                // 28-50-03: 파트너 쪽 '→ 취소'는 제거 — 파트너 귀책 이탈은 '낙찰 철회'(사유·기록·재오픈)로만
                .filter(
                  (next) => next !== 'estimated' && next !== 'scheduled' && next !== 'lost' && next !== 'cancelled',
                )
                .map((next) => (
                  <button key={next} onClick={() => doTransition(r, next)}>
                    → {STATUS_LABEL[next]}
                  </button>
                ))}
              {r.status === 'accepted' && (
                <span className="meta" data-contract-hint>
                  {platform.proposedContract(r.id)
                    ? `계약서 v${platform.proposedContract(r.id)!.version} 고객 확인 대기`
                    : "계약서 보내기는 '일정' 탭에서"}
                </span>
              )}
              {r.status !== 'lost' && r.status !== 'cancelled' && (
                <button className="btn-secondary" onClick={() => setChatOpen(chatOpen === r.id ? '' : r.id)}>
                  채팅 {chatOpen === r.id ? '접기' : '열기'}
                  {platform.unreadCount(r.id, 'partner') > 0 && (
                    <span className="chat-unread" style={{ marginLeft: 6 }}>
                      {platform.unreadCount(r.id, 'partner')}
                    </span>
                  )}
                </button>
              )}
            </div>
            {chatOpen === r.id && <ChatBox requestId={r.id} viewer="partner" />}
            <ClaimReplyBox request={r} />
            <JobPhotos request={r} kind="before" />
            <JobPhotos request={r} kind="completion" />
            {(r.status === 'accepted' || r.status === 'scheduled') && <WithdrawAward request={r} />}
            {r.status === 'in_progress' && <ExtraWorkForm requestId={r.id} />}
          </Card>
        )
      })}
    </div>
  )
}
