import type { RepairRequest, JobStatus, RequestPhoto, RequestReview } from './types'
import { transition } from './jobStatus'
import { assertValidDateStr, DateFormatError } from './date'
import { DomainError } from '../../server/domain/errors'

export class RequestNotFoundError extends DomainError {
  constructor(id: string) {
    super(`요청을 찾을 수 없습니다: ${id}`)
    this.name = 'RequestNotFoundError'
  }
}

export { DateFormatError }

/** 재오픈 불가 상태 (28-50-01) */
export class PlatformReopenError extends DomainError {
  constructor(status: JobStatus) {
    super(`재오픈은 낙찰·방문 예정 상태에서만 가능합니다 (${status})`)
    this.name = 'PlatformReopenError'
  }
}

/** 영속화용 스냅샷 (28-3-01) */
export interface RequestStoreSnapshot {
  seq: number
  requests: RepairRequest[]
}

/**
 * 인메모리 수리요청 저장소.
 * 반환되는 객체는 방어적 복사본이므로 외부에서 수정해도 내부 상태에 영향이 없다.
 */
export class RequestStore {
  private requests = new Map<string, RepairRequest>()
  private seq = 0

  /** desiredDate는 실제 달력 날짜여야 한다 (28-1-06). 위반 시 DateFormatError. */
  add(input: Omit<RepairRequest, 'id' | 'status' | 'createdAt'>): RepairRequest {
    assertValidDateStr(input.desiredDate, 'desiredDate')
    this.seq += 1
    const request: RepairRequest = {
      ...input,
      id: `REQ-${String(this.seq).padStart(4, '0')}`,
      status: 'requested',
      createdAt: new Date().toISOString(),
    }
    this.requests.set(request.id, request)
    return { ...request }
  }

  get(id: string): RepairRequest | undefined {
    const r = this.requests.get(id)
    return r ? { ...r } : undefined
  }

  list(status?: JobStatus): RepairRequest[] {
    const all = [...this.requests.values()]
    const filtered = status ? all.filter((r) => r.status === status) : all
    return filtered.map((r) => ({ ...r }))
  }

  /**
   * 상태 전이 규칙(jobStatus.ts)을 통과해야만 상태가 바뀐다.
   * 미존재 요청은 RequestNotFoundError (28-1-07: 오류 타입 구분).
   */
  /** 고객 비식별화 (28-39-01): customerId가 일치하는 요청의 표시명을 치환 — 저장소 내부 객체를 직접 갱신 */
  anonymizeCustomer(customerId: string, label = '탈퇴 회원'): number {
    let n = 0
    for (const r of this.requests.values()) {
      if (r.customerId === customerId && r.customerName !== label) {
        r.customerName = label
        n += 1
      }
    }
    return n
  }

  /** 마감 알림 기록 (28-43-01) */
  setDeadlineNotified(id: string, deadline: string): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    r.deadlineNotifiedFor = deadline
    return { ...r }
  }

  /** 마감 연장 (28-43-01) — 알림 플래그 초기화 */
  setBidDeadline(id: string, deadline: string): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    r.bidDeadline = deadline
    delete r.deadlineNotifiedFor
    return { ...r }
  }

  /** 관리자 검토 완료 기록 (28-93) — 한 번만 */
  setReview(id: string, review: RequestReview): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    r.review = { ...review }
    return { ...r }
  }

  /** 결제 지연 리마인더 기록 (28-44-01) */
  setPaymentReminder(id: string, completedDate: string): void {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    r.paymentReminderFor = completedDate
  }

  /** 사진 목록 교체 (28-48-01) */
  setPhotos(id: string, photos: RequestPhoto[]): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    if (photos.length === 0) delete r.photos
    else r.photos = photos.map((p) => ({ ...p }))
    return { ...r }
  }

  /** 시공 완료 사진 교체 (28-49-03) — 빈 배열이면 키 제거 */
  setCompletionPhotos(id: string, photos: RequestPhoto[]): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    if (photos.length === 0) delete r.completionPhotos
    else r.completionPhotos = photos.map((p) => ({ ...p }))
    return { ...r }
  }

  /** 작업 전 사진 교체 (28-96) — 빈 배열이면 제거 */
  setBeforePhotos(id: string, photos: RequestPhoto[]): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    if (photos.length === 0) delete r.beforePhotos
    else r.beforePhotos = photos.map((p) => ({ ...p }))
    return { ...r }
  }

  /** 낙찰 파트너 기록 (28-42-01) */
  setAcceptedPartner(id: string, partnerId: string): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    r.acceptedPartnerId = partnerId
    return { ...r }
  }

  /** 요청 수정 (28-52-01): 낙찰 전 편집 가능 필드만 병합, 빈 답변·빈 예산 범위는 키 제거, editedAt/editCount 기록 */
  update(
    id: string,
    patch: Partial<
      Pick<
        RepairRequest,
        'description' | 'region' | 'desiredDate' | 'desiredTime' | 'budget' | 'budgetRange' | 'answers'
      >
    >,
  ): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    if (patch.description !== undefined) r.description = patch.description
    if (patch.region !== undefined) r.region = patch.region
    if (patch.desiredDate !== undefined) r.desiredDate = patch.desiredDate
    if (patch.desiredTime !== undefined) r.desiredTime = patch.desiredTime
    if (patch.budget !== undefined) r.budget = patch.budget
    if (patch.budgetRange !== undefined) {
      if (patch.budgetRange === '') delete r.budgetRange
      else r.budgetRange = patch.budgetRange
    }
    if (patch.answers !== undefined) {
      if (patch.answers.length === 0) delete r.answers
      else r.answers = patch.answers.map((a) => ({ ...a }))
    }
    r.editedAt = new Date().toISOString()
    r.editCount = (r.editCount ?? 0) + 1
    return { ...r }
  }

  /** 방문 일정 변경 기록 (28-56-01) */
  markRescheduled(id: string): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    r.rescheduledAt = new Date().toISOString()
    r.rescheduleCount = (r.rescheduleCount ?? 0) + 1
    return { ...r }
  }

  /** 낙찰 파트너 해제 (28-50-01) */
  clearAcceptedPartner(id: string): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    delete r.acceptedPartnerId
    return { ...r }
  }

  /** 재오픈 (28-50-01): 낙찰 철회로 낙찰 전 상태로 되돌리는 관리 전이 — 전이표 밖이므로 전용 메서드 */
  reopen(id: string, to: 'requested' | 'estimated'): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    const fromAward = r.status === 'accepted' || r.status === 'scheduled'
    const fromBids = r.status === 'estimated' && to === 'requested' // 28-52-02: 마지막 입찰 철회
    if (!fromAward && !fromBids) throw new PlatformReopenError(r.status)
    r.status = to
    return { ...r }
  }

  updateStatus(id: string, to: JobStatus): RepairRequest {
    const r = this.requests.get(id)
    if (!r) throw new RequestNotFoundError(id)
    r.status = transition(r.status, to)
    return { ...r }
  }

  get size(): number {
    return this.requests.size
  }

  /** 영속화용 스냅샷 (방어적 복사) */
  snapshot(): RequestStoreSnapshot {
    return { seq: this.seq, requests: this.list() }
  }

  /** 스냅샷에서 상태 복원 — ID 순번(seq)까지 이어져 신규 ID가 충돌하지 않는다 */
  restore(snapshot: RequestStoreSnapshot): void {
    this.requests = new Map(snapshot.requests.map((r) => [r.id, { ...r }]))
    this.seq = snapshot.seq
  }
}
