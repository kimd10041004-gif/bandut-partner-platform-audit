/**
 * 접수 안전 검토 (28-93, 참고 v12 `lib/policy.ts` `questions()`/`safety()` 대조).
 *
 * 분야에 따라 두 질문을 묻는다 — **문 잠김**(문·도어락 / 분야를 모르겠어요)과 **긴급 증상**(설비·전기·잠금·범위 검토
 * 분야). 답은 묻지 않은 질문이면 `null`이어야 하고, 잠김·긴급이면 안전 안내 확인(`ack`)이 있어야 한다. 설명 문구가
 * 답과 어긋나면(잠기지 않았다면서 "문이 잠겨"…) 다시 확인시킨다(RECHECK). 결과는 `AUTO_PASS` 또는 `MANUAL_REVIEW` +
 * 사유 플래그다. 판단은 카탈로그의 **코드**(28-92)로 한다 — 라벨은 바뀌어도 코드는 고정이다.
 *
 * 참고안과 다른 점: 희망일은 이 저장소에서 항상 필수라(`RepairRequest.desiredDate`) "긴급이면 희망일 생략" 규칙은 두지 않는다.
 */
import { catalogEntry } from './catalog'
import { DomainError } from '../../server/domain/errors'
import type { RepairCategory, ReviewFlag, ReviewStatus, SafetyAnswers } from './types'

export class SafetyError extends DomainError {}

/** 작업 범위 검토 대상 코드 — 잠금·방충망·커튼·시설 설치처럼 범위가 좁은 분야를 뺀 나머지 전부 */
export const SCOPE_REVIEW_CODES: readonly string[] = [
  'PLUMBING',
  'ELECTRIC',
  'HVAC',
  'SMART_HOME',
  'APPLIANCE',
  'WALL_FINISH',
  'FLOOR',
  'CARPENTRY',
  'WINDOW',
  'KITCHEN_BATH',
  'WATERPROOF',
  'RENOVATION',
  'COMMERCIAL',
  'RESTORATION',
  'MAINTENANCE',
]

/** 긴급 증상을 묻는 코드 — 범위 검토 분야 + 잠금·모름 */
const URGENT_CODES: readonly string[] = ['PLUMBING', 'ELECTRIC', 'LOCK', 'UNKNOWN', ...SCOPE_REVIEW_CODES]

export const LOCKOUT_PATTERN = /(문.{0,5}잠겨|잠겨.{0,5}못|못.{0,5}들어|갇혀)/
export const URGENT_PATTERN = /(타는\s*냄새|가스\s*냄새|연기|감전|물이\s*계속|불꽃)/

export interface SafetyQuestions {
  lock: boolean
  urgent: boolean
}

const codesOf = (categories: readonly RepairCategory[]) => categories.map((c) => catalogEntry(c).code)

export function needsScopeReview(categories: readonly RepairCategory[]): boolean {
  return codesOf(categories).some((c) => SCOPE_REVIEW_CODES.includes(c))
}

/** 어느 질문을 묻는가 — 분야 묶음으로 결정 */
export function safetyQuestions(categories: readonly RepairCategory[]): SafetyQuestions {
  const codes = codesOf(categories)
  return {
    lock: codes.includes('LOCK') || codes.includes('UNKNOWN'),
    urgent: codes.some((c) => URGENT_CODES.includes(c)),
  }
}

/** 빈 답변 — 위저드의 초기 상태 */
export const EMPTY_SAFETY: SafetyAnswers = { isLocked: null, urgent: null, ack: false }

export interface SafetyAssessment {
  reviewStatus: ReviewStatus
  flags: ReviewFlag[]
}

/**
 * 답변·설명·분야로 검토 결과를 낸다. 규칙 위반은 `SafetyError`(사용자에게 그대로 보여도 되는 문구).
 * 답변 형태(boolean|null, boolean)는 여기서도 검사한다 — 스냅샷·API에서 온 값을 그대로 믿지 않는다.
 */
export function assessSafety(input: {
  categories: readonly RepairCategory[]
  description: string
  answers: SafetyAnswers
}): SafetyAssessment {
  const q = safetyQuestions(input.categories)
  const a = input.answers
  const isBoolOrNull = (v: unknown) => v === null || typeof v === 'boolean'
  if (!isBoolOrNull(a.isLocked) || !isBoolOrNull(a.urgent) || typeof a.ack !== 'boolean')
    throw new SafetyError('안전 질문 답변 형식이 올바르지 않습니다')
  if ((q.lock && a.isLocked === null) || (q.urgent && a.urgent === null))
    throw new SafetyError('안전 질문에 답해 주세요')
  if ((!q.lock && a.isLocked !== null) || (!q.urgent && a.urgent !== null))
    throw new SafetyError('질문 대상이 아닌 답변은 비워 주세요')
  if ((a.isLocked || a.urgent) && !a.ack) throw new SafetyError('안전 안내 확인이 필요합니다')
  if (a.isLocked === false && LOCKOUT_PATTERN.test(input.description))
    throw new SafetyError('문 잠김에 대한 설명과 답변을 다시 확인해 주세요')
  if (a.urgent === false && URGENT_PATTERN.test(input.description))
    throw new SafetyError('긴급 증상에 대한 설명과 답변을 다시 확인해 주세요')
  const scope = needsScopeReview(input.categories)
  const unknown = codesOf(input.categories).includes('UNKNOWN')
  const flags: ReviewFlag[] = [
    ...(a.isLocked ? (['LOCKOUT'] as const) : []),
    ...(a.urgent ? (['URGENT_SYMPTOM'] as const) : []),
    ...(scope ? (['WORK_SCOPE_REVIEW'] as const) : []),
  ]
  return { reviewStatus: a.isLocked || a.urgent || unknown || scope ? 'MANUAL_REVIEW' : 'AUTO_PASS', flags }
}

export const REVIEW_FLAG_LABEL: Record<ReviewFlag, string> = {
  LOCKOUT: '문 잠김',
  URGENT_SYMPTOM: '긴급 증상',
  WORK_SCOPE_REVIEW: '작업 범위 검토',
}
