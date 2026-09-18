import type { JobStatus } from './types'
import { DomainError } from '../../server/domain/errors'

/** 상태별 허용 전이. 명시되지 않은 전이는 모두 금지. */
const ALLOWED: Record<JobStatus, readonly JobStatus[]> = {
  requested: ['estimated', 'cancelled'],
  estimated: ['accepted', 'lost', 'cancelled'],
  accepted: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: ['settled'],
  settled: [],
  lost: [],
  cancelled: [],
}

export class InvalidTransitionError extends DomainError {
  constructor(from: JobStatus, to: JobStatus) {
    super(`상태 전이 불가: ${from} → ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED[from].includes(to)
}

/** 허용된 전이면 다음 상태를 반환, 아니면 InvalidTransitionError */
export function transition(from: JobStatus, to: JobStatus): JobStatus {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)
  return to
}

/** 해당 상태에서 이동 가능한 다음 상태 목록 */
export function nextStatuses(from: JobStatus): readonly JobStatus[] {
  return ALLOWED[from]
}

/** 종결 상태 여부 (더 이상 전이 불가) */
export function isTerminal(status: JobStatus): boolean {
  return ALLOWED[status].length === 0
}
