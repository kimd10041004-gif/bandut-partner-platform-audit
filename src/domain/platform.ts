import type {
  CompletedJob,
  Estimate,
  EstimateBreakdown,
  ExtraWork,
  JobStatus,
  Review,
  SiteSettings,
  ServicePackage,
  CategoryQuestion,
  ChatMessage,
  ChatSender,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  AppNotification,
  NotificationRole,
  Claim,
  RepairCategory,
  RepairRequest,
  ScheduleSlot,
  Refund,
  RequestPhoto,
  PartnerCancel,
  BidWithdrawal,
  AuditEntry,
  ReviewFlag,
  Contract,
  CommissionTerms,
  ScheduleChange,
} from './types'
import { ALL_CATEGORIES, LANDING_SECTION_IDS } from './types'
import { normalizeCategory } from './catalog'
import { assessSafety } from './safety'
import type { LandingLayout, LandingSectionId } from './types'
import { calcEstimate, validateEstimate, PLATFORM_FEE_RATE } from './estimate'
import { RequestStore, RequestNotFoundError, type RequestStoreSnapshot } from './store'
import { assertValidDateStr, isValidDateStr, addDays, daysBetween } from './date'
import { addSlot, validateSlot } from './schedule'

/** 방문 전날 리마인더 (28-56-03) */
export const VISIT_REMINDER_DAYS_BEFORE = 1
import { weeklySettlements, type WeeklySettlement } from './settlement'
import { DomainError } from '../../server/domain/errors'

export class PlatformError extends DomainError {
  constructor(message: string) {
    super(message)
    this.name = 'PlatformError'
  }
}

export interface StoredEstimate {
  estimate: Estimate
  breakdown: EstimateBreakdown
  /** 재제출 횟수 (28-52-02) — 원안은 없음, 1차 수정부터 */
  revision?: number
  /** 제출·수정 시각 ISO (28-52-02) */
  submittedAt?: string
}

/** 요청 수정 입력 (28-52-01) — 카테고리는 수정 불가(질문·매칭의 축) */
export type RequestPatch = Partial<
  Pick<RepairRequest, 'description' | 'region' | 'desiredDate' | 'desiredTime' | 'budget' | 'budgetRange' | 'answers'>
>

/** localStorage 호환 최소 인터페이스 — 테스트에서는 인메모리 구현을 주입한다 (28-3-01) */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 백업 모드 (28-60-01): 원본 / 가명 처리본 */
export type BackupMode = 'full' | 'pseudonymous'

/**
 * 가명 처리 허용 목록 (28-61-02): **내보낼 필드를 고르고 나머지는 버린다.**
 * 28-61까지는 "지울 것을 열거"하는 방식이라 필드가 늘 때마다 샜다(알림 문구·감사 로그 상세·클레임 처리 내용·파트너 상호).
 * 자유 서술 필드는 이 목록에 넣지 않는다.
 */
export const PSEUDONYMOUS_REQUEST_KEYS = [
  'id',
  'category',
  // 28-93: 분야 묶음·안전 답변(불리언)·검토 결과는 자유 서술이 아니다. 검토 메모(`review.note`)는 넣지 않는다.
  'categories',
  'safety',
  'reviewStatus',
  'reviewFlags',
  'status',
  'createdAt',
  'desiredDate',
  'desiredTime',
  'budget',
  'budgetRange',
  'bidDeadline',
  'acceptedPartnerId',
  'editCount',
  'editedAt',
  'rescheduleCount',
  'rescheduledAt',
  'paymentReminderFor',
  'deadlineNotifiedFor',
  // 28-64-02: 가명 처리 후 실제로 방출되는 키. 이 넷이 목록 밖이라 구조 검사가 무의미했다
  // (특히 photoCount는 28-64 시점에 아무도 잡지 못한 채 결과에 들어가고 있었다).
  'customerId',
  'customerName',
  'region',
  'description',
  'photoCount',
] as const
/** 28-93: 안전 답변은 불리언 셋뿐이다 — 중첩 객체는 허용 목록을 따로 선언해야 검사가 통과한다(28-65-01) */
export const PSEUDONYMOUS_SAFETY_KEYS = ['isLocked', 'urgent', 'ack'] as const
export const PSEUDONYMOUS_REQUEST_SPEC = {
  keys: PSEUDONYMOUS_REQUEST_KEYS,
  nested: { safety: PSEUDONYMOUS_SAFETY_KEYS },
} as const

/**
 * 보안 감사 행위 (28-64-04) — 상한 축출에서 **마지막까지 남긴다**.
 * `src/domain/auth.ts`의 `emit(...)` 호출부와 짝을 이룬다. 이름이 바뀌면 여기도 함께 바꿔야 한다.
 */
/**
 * detail이 **내용이 아니라 진행 표시**인 행위 (28-64-04) — 이때만 detail을 무시하고 접는다.
 *
 * 기본값은 "접지 않는다"이다. 새 행위가 생겼을 때 조용히 내용을 잃는 쪽이 아니라
 * 줄이 늘어나는 쪽으로 틀리게 하려는 선택이다(안전한 방향으로 실패).
 * 예) `로그인 실패`의 `남은 시도 2회`는 같은 사건의 진행 표시라 마지막 값만 남겨도 잃는 것이 없다.
 *     반면 `설정 변경`의 detail은 **무엇을 바꿨는지** 그 자체라 덮어쓰면 기록이 사라진다.
 */
export const PROGRESS_DETAIL_AUDIT_ACTIONS: ReadonlySet<string> = new Set(['로그인 실패'])

/**
 * 상한 축출에서 관리자 기록·보안 이벤트에 각각 보장하는 최소 보존량 (28-64-04).
 * 어느 한쪽의 폭주가 다른 쪽을 굶기지 못하게 한다.
 */
export const AUDIT_RESERVE = 200

export const SECURITY_AUDIT_ACTIONS: ReadonlySet<string> = new Set([
  '로그인 실패',
  '로그인 잠금',
  'OTP 시도 초과',
  '비밀번호 변경',
  '회원 탈퇴',
])

/** 가명본 파트너 프로필 허용 키 (28-64-02) — [id, obj] 쌍이라 그동안 구조 검사를 받지 못했다 */
export const PSEUDONYMOUS_PROFILE_KEYS = ['name', 'specialties', 'region', 'intro'] as const

/** 가명본 지역 축약이 인정하는 광역 시/도 (28-64-02) — 목록 밖은 실패 시 닫힌다 */
export const PSEUDONYMOUS_REGION_PREFIXES = [
  '서울',
  '부산',
  '대구',
  '인천',
  '광주',
  '대전',
  '울산',
  '세종',
  '경기',
  '강원',
  '충북',
  '충남',
  '전북',
  '전남',
  '경북',
  '경남',
  '제주',
  '충청북도',
  '충청남도',
  '전라북도',
  '전라남도',
  '경상북도',
  '경상남도',
  '강원도',
  '경기도',
  '제주도',
  // 시 단위로 입력하는 경우가 많아 자주 쓰이는 경기·인근 도시도 인정한다
  '고양',
  '성남',
  '용인',
  '부천',
  '안양',
  '안산',
  '수원',
  '남양주',
  '화성',
  '평택',
  '의정부',
  '파주',
  '김포',
  '광명',
  '군포',
  '하남',
  '오산',
  '이천',
  '구리',
  '시흥',
  '양주',
  '포천',
  '청주',
  '천안',
  '전주',
  '창원',
  '김해',
  '포항',
  '진주',
  '원주',
  '춘천',
  '강릉',
] as const

/** 가명본에서 지역을 알아볼 수 없을 때 쓰는 표시 (28-64-02) */
export const PSEUDONYMOUS_REGION_FALLBACK = '[가명 처리] 지역'
export const PSEUDONYMOUS_REVIEW_KEYS = ['requestId', 'rating', 'createdDate', 'repliedDate'] as const
export const PSEUDONYMOUS_CLAIM_KEYS = [
  'id',
  'requestId',
  'status',
  'createdDate',
  'resolvedDate',
  'repliedDate',
] as const
export const PSEUDONYMOUS_NOTIFICATION_KEYS = ['id', 'role', 'requestId', 'accountId', 'createdAt', 'read'] as const
export const PSEUDONYMOUS_AUDIT_KEYS = ['id', 'at', 'actor', 'action', 'count', 'firstAt'] as const
/** 지급 계좌 표기에는 예금주(업체명)가 들어간다 — 자체 검사가 잡아낸 경로 (28-61-02) */
export const PSEUDONYMOUS_JOB_KEYS = [
  'requestId',
  'partnerId',
  'completedDate',
  'total',
  'platformFee',
  'extraTotal',
  'settled',
  'refunded',
] as const
export const PSEUDONYMOUS_PAYOUT_KEYS = ['paidAt', 'amount', 'refunded', 'fee'] as const

/** 28-62-01: 통째로 통과시키던 컬렉션에도 허용 목록을 건다 — 자유 서술(memo·reason)은 목록에 없다 */
/** 견적 금액 계산 결과 (28-65-01) — 그동안 `breakdown` 키만 허용되고 그 안은 한 번도 검사되지 않았다 */
export const PSEUDONYMOUS_BREAKDOWN_KEYS = ['subtotal', 'vat', 'total', 'platformFee', 'partnerPayout'] as const
export const PSEUDONYMOUS_ESTIMATE_KEYS = [
  'requestId',
  'partnerId',
  'laborCost',
  'materialCost',
  'transportCost',
  'discount',
] as const
export const PSEUDONYMOUS_STORED_ESTIMATE_KEYS = ['breakdown', 'revision', 'submittedAt'] as const
export const PSEUDONYMOUS_SLOT_KEYS = [
  'id',
  'partnerId',
  'requestId',
  'date',
  'startHour',
  'endHour',
  'remindedFor',
] as const
/** 28-97: 주문번호·상태는 남고 결제사 승인 키(`providerKey`)는 나가지 않는다 — 환불·조회 권한이 그 키에 걸린다 */
export const PSEUDONYMOUS_PAYMENT_KEYS = [
  'id',
  'requestId',
  'kind',
  'amount',
  'method',
  'paidAt',
  'orderId',
  'status',
] as const
/** 28-95: 계약서·일정 변경 — 조건(`terms`)·사유(`reason`)는 자유 서술이라 넣지 않는다 */
export const PSEUDONYMOUS_CONTRACT_KEYS = [
  'id',
  'requestId',
  'partnerId',
  'version',
  'total',
  'deposit',
  'commissionBps',
  'date',
  'startHour',
  'endHour',
  'status',
  'createdAt',
  'decidedAt',
] as const
export const PSEUDONYMOUS_SCHEDULE_CHANGE_KEYS = [
  'id',
  'requestId',
  'partnerId',
  'date',
  'startHour',
  'endHour',
  'status',
  'createdAt',
  'decidedAt',
] as const
export const PSEUDONYMOUS_COMMISSION_KEYS = ['requestId', 'bps', 'by', 'at'] as const
export const PSEUDONYMOUS_REFUND_KEYS = [
  'id',
  'requestId',
  'paymentId',
  'amount',
  'deduction',
  'afterVisit',
  'status',
  'createdAt',
  'doneAt',
] as const
export const PSEUDONYMOUS_PARTNER_CANCEL_KEYS = ['id', 'requestId', 'partnerId', 'date'] as const
export const PSEUDONYMOUS_PACKAGE_KEYS = ['id', 'name', 'category', 'price', 'active'] as const
export const PSEUDONYMOUS_QUESTION_KEYS = ['id', 'category', 'label', 'options', 'active'] as const
export const PSEUDONYMOUS_SETTINGS_KEYS = ['disabledCategories'] as const
export const PSEUDONYMOUS_BID_WITHDRAWAL_KEYS = ['id', 'requestId', 'partnerId', 'at', 'beforeDeadline'] as const

/**
 * 열람권(DSAR) 내보내기 허용 키 (28-65-02).
 *
 * 28-64-03은 "통째 전개를 끊는다"고 적고 `requests`·`claims` 둘만 고쳤다. 같은 함수 안에
 * `payments`·`refunds`·`reviews`(고객)와 `jobs`·`reviews`(파트너)가 `{...x}` 그대로 남아 있었다.
 * 새 필드가 생기면 조용히 따라 들어가는데 그것을 잡는 장치가 없다 — 가명본에서 28-62-01이
 * 없앤 것과 같은 형태다. 열람권 산출물도 브라우저를 떠나므로 같은 방식으로 관리한다.
 */
export const EXPORT_PAYMENT_KEYS = [
  'id',
  'requestId',
  'kind',
  'amount',
  'method',
  'receiptNo',
  'paidAt',
  'orderId',
  'status',
] as const
export const EXPORT_REFUND_KEYS = [
  'id',
  'requestId',
  'paymentId',
  'amount',
  'deduction',
  'afterVisit',
  'reason',
  'status',
  'createdAt',
  'doneAt',
] as const
export const EXPORT_REVIEW_KEYS = ['requestId', 'rating', 'text', 'createdDate', 'reply', 'repliedDate'] as const
/** 파트너 본인의 정산 기록 — 지급 근거(payout)는 통째로 담지 않고 아래 키만 담는다 */
export const EXPORT_JOB_KEYS = [
  'requestId',
  'partnerId',
  'completedDate',
  'total',
  'platformFee',
  'extraTotal',
  'settled',
] as const
/**
 * 28-67-01: `account`가 아니라 `accountMasked`를 담는다.
 *
 * 28-66-02는 지급 근거를 빼는 것이 "과다 노출을 막는 게 아니라 **과소 제공**"이라며 `account`를
 * 되돌리면서, 그 값을 *"이미 마스킹된 본인 값"*이라 적었다. **절반만 참이었다** — 마스킹되는 것은
 * 계좌번호뿐이고 예금주는 평문이다(`payoutAccountLabel`). 예금주가 가입명과 같으면
 * `assertNoRealIdentifiers`가 잡아 **본인 열람권 자체가 실패**한다.
 *
 * 그래서 빼는 대신 **마스킹한 값을 준다**. 28-66-02의 결론(근거는 줘야 한다)과
 * 자체 검사(실명은 나가면 안 된다)를 둘 다 지키는 형태다.
 * 파트너 정산 CSV(`src/features/Settlement.tsx`)도 같은 값을 쓰게 맞췄다.
 */
export const EXPORT_PAYOUT_KEYS = ['paidAt', 'amount', 'accountMasked'] as const

/**
 * 중첩 허용 목록 (28-65-01). 값이 객체이면 그 안도 목록으로 선언해야 한다.
 * 선언이 없으면 통과가 아니라 **실패**다 — 검사할 수 없는 형태를 통과시키지 않는다.
 */
/**
 * 허용 목록에 있는 키만 담는다 (28-61-02). 가명본과 열람권 내보내기가 함께 쓴다 —
 * 28-65-02에서 열람권의 통째 전개를 끊으면서 메서드 안의 지역 함수를 모듈 수준으로 올렸다.
 */
export function pick<T extends object>(o: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in o) out[k] = (o as Record<string, unknown>)[k]
  return out
}

export type ShapeSpec =
  | readonly string[]
  | { readonly keys: readonly string[]; readonly nested: Readonly<Record<string, ShapeSpec>> }
  /** 28-66-01: `[키, 스칼라 배열]` 행으로 직렬화되는 컬렉션(daysOff) — 레코드가 아니라 값 배열이다 */
  | { readonly pairOf: 'scalars' }

const isPairOfScalars = (spec: ShapeSpec): boolean =>
  !Array.isArray(spec) && (spec as { pairOf?: string }).pairOf === 'scalars'
const specKeys = (spec: ShapeSpec): readonly string[] =>
  Array.isArray(spec) ? spec : (spec as { keys: readonly string[] }).keys
const specNested = (spec: ShapeSpec): Readonly<Record<string, ShapeSpec>> =>
  Array.isArray(spec) ? {} : ((spec as { nested?: Readonly<Record<string, ShapeSpec>> }).nested ?? {})

/** 이 값이 "안을 들여다봐야 하는" 것인지 — 객체, 또는 객체를 담은 배열 */
function rowsNeedingCheck(value: unknown): unknown[] {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.filter((v) => v !== null && typeof v === 'object')
  return [value]
}

function checkRecord(path: string, rec: Record<string, unknown>, spec: ShapeSpec): void {
  const allowed = specKeys(spec)
  const nested = specNested(spec)
  const extra = Object.keys(rec).filter((k) => !allowed.includes(k))
  if (extra.length > 0) {
    throw new PlatformError(
      `가명 처리에 실패했습니다 — ${path}에 허용되지 않은 필드가 남아 있습니다: ${extra.join(', ')}`,
    )
  }
  for (const [key, value] of Object.entries(rec)) {
    const inner = rowsNeedingCheck(value)
    if (inner.length === 0) continue
    const sub = nested[key]
    if (sub === undefined) {
      // 28-65-01: 여기서 조용히 넘어가면 "새 필드가 생기면 기본이 제외"라는 약속이 한 겹 아래에서 거짓이 된다.
      throw new PlatformError(
        `가명 처리에 실패했습니다 — ${path}.${key}가 객체인데 중첩 허용 목록이 선언되지 않았습니다. ` +
          `검사할 수 없는 형태는 통과가 아니라 실패입니다.`,
      )
    }
    for (const row of inner) {
      if (Array.isArray(row) || row === null || typeof row !== 'object') {
        throw new PlatformError(`가명 처리에 실패했습니다 — ${path}.${key}의 원소를 검사할 수 없는 형태입니다`)
      }
      checkRecord(`${path}.${key}`, row as Record<string, unknown>, sub)
    }
  }
}

/**
 * 결과에 실리는데 spec이 없는 컬렉션을 찾는다 (28-66-01).
 *
 * 28-65까지 `assertPseudonymousShape`는 **"spec에 적힌 것"만 확인하고 "적히지 않은 것이 있는지"는 묻지 않았다.**
 * 그래서 `daysOff`가 결과에 실리면서도 `pick()`도 spec도 없는 유일한 컬렉션으로 남아 있었고
 * — 허용 목록 층이 0겹이었고 — 재귀를 넣은 라운드에서도 아무에게도 걸리지 않았다.
 *
 * 스칼라·빈 배열·스칼라 배열은 검사 대상이 아니다(`version`·`rev`·`savedAt`·`settings.disabledCategories` 등).
 * 객체를 담고 있는데 spec이 없으면 실패한다.
 */
function assertSpecCoverage(node: Record<string, unknown>, path: string, specPaths: ReadonlySet<string>): void {
  for (const [key, value] of Object.entries(node)) {
    const here = path === '' ? key : `${path}.${key}`
    if (specPaths.has(here)) continue
    if (rowsNeedingCheck(value).length === 0) continue // 스칼라·빈 배열·스칼라 배열 — 실릴 내용이 없다
    // 컨테이너(out.store)는 안쪽에 spec이 있으면 통과시키고 나머지 키를 마저 본다
    let isContainer = false
    for (const sp of specPaths)
      if (sp.startsWith(`${here}.`)) {
        isContainer = true
        break
      }
    if (isContainer && !Array.isArray(value)) {
      assertSpecCoverage(value as Record<string, unknown>, here, specPaths)
      continue
    }
    throw new PlatformError(
      `가명 처리에 실패했습니다 — ${here}가 결과에 실리는데 허용 목록(spec)이 없습니다. ` +
        `검사받지 않는 컬렉션을 내보내지 않습니다.`,
    )
  }
}

/**
 * 구조 검증 (28-62-01 / 28-64-02 / 28-65-01 / 28-66-01): 결과의 각 컬렉션을 허용 목록과 대조해
 * **목록 밖 키가 하나라도 있으면** 실패시킨다. 값 대조(`assertNoRealIdentifiers`)가
 * "아는 이름"만 잡는 것과 달리, 이 검사는 이름을 몰라도 막는다.
 *
 * 세 라운드에 걸쳐 이 함수의 보장 문구가 실제보다 넓었고, 그때마다 한 층씩 좁혀 왔다:
 *  - 28-64-02: 점 경로 탐색 — `out.store.requests`에 닿지 못하고 있었다.
 *  - 28-65-01: 재귀 — `estimate.memo`·`payout.holder`가 키로만 허용되고 안은 검사되지 않았다.
 *  - 28-66-01: **완전성 + fail-closed** — 아래 셋.
 *      (a) `out`을 훑어 spec 없는 컬렉션이 있으면 실패(`assertSpecCoverage`). `daysOff`가 그렇게 빠져 있었다.
 *      (b) spec 경로를 못 찾으면 조용히 통과하던 것(`continue`)을 실패로. 경로 오타나 키 이름 변경으로
 *          검사가 소리 없이 사라지던 구멍 — 28-64-01이 지적한 "죽은 코드를 검사하는 게이트"와 같은 형태다.
 *      (c) 최상위 `[id, obj]` 행에서 `row[0]`·`row[2..]`를 아무도 보지 않던 비대칭 제거.
 */
export function assertPseudonymousShape(out: Record<string, unknown>, specs: Array<[string, ShapeSpec]>): void {
  assertSpecCoverage(out, '', new Set(specs.map(([path]) => path)))

  for (const [path, spec] of specs) {
    // 점 경로를 따라 들어간다 — 가장 PII가 많은 컬렉션이 out.store.requests에 중첩돼 있다 (28-64-02)
    let node: unknown = out
    let missing = false
    for (const seg of path.split('.')) {
      if (node === null || typeof node !== 'object') {
        missing = true
        break
      }
      if (!(seg in (node as Record<string, unknown>))) {
        missing = true
        break
      }
      node = (node as Record<string, unknown>)[seg]
    }
    // 28-66-01: 못 찾으면 실패다. 예전에는 continue라서, 경로에 오타가 나거나 산출물 키 이름이 바뀌면
    // 그 컬렉션의 검사가 아무 소리 없이 사라졌다.
    if (missing) {
      throw new PlatformError(
        `가명 처리에 실패했습니다 — spec이 가리키는 ${path}를 결과에서 찾을 수 없습니다. ` +
          `검사가 조용히 사라지지 않게 실패로 다룹니다.`,
      )
    }
    if (node === undefined || node === null) continue // 키는 있는데 값이 없다 — 실릴 내용이 없다

    // 28-66-01: [키, 스칼라 배열] 행(daysOff)은 레코드가 아니라 값 배열이다
    if (isPairOfScalars(spec)) {
      if (!Array.isArray(node)) {
        throw new PlatformError(`가명 처리에 실패했습니다 — ${path}가 배열이 아닙니다`)
      }
      for (const row of node) {
        if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !Array.isArray(row[1])) {
          throw new PlatformError(`가명 처리에 실패했습니다 — ${path}의 행은 [문자열, 배열] 두 원소여야 합니다`)
        }
        const bad = (row[1] as unknown[]).filter((v) => v === null || typeof v === 'object')
        if (bad.length > 0) {
          throw new PlatformError(
            `가명 처리에 실패했습니다 — ${path}의 값 배열에 객체가 들어 있습니다. ` +
              `스칼라만 담기로 선언된 컬렉션입니다.`,
          )
        }
      }
      continue
    }

    // 배열이면 각 행을, 객체 하나면(settings) 그 자체를 검사한다
    const rows: unknown[] = Array.isArray(node) ? node : [node]
    for (const row of rows) {
      // [id, obj] 쌍으로 직렬화되는 컬렉션(estimates·profiles)은 두 번째 원소가 실제 레코드다
      let rec: unknown = row
      if (Array.isArray(row)) {
        // 28-66-01: 예전에는 row[1]만 보고 row[0]·row[2..]는 아무도 검사하지 않았다.
        // 3원소 행의 마지막 원소가 그대로 결과에 실려도 통과했다.
        if (row.length !== 2) {
          throw new PlatformError(
            `가명 처리에 실패했습니다 — ${path}의 행은 [id, 레코드] 두 원소여야 합니다 (원소 ${row.length}개)`,
          )
        }
        if (row[0] === null || typeof row[0] === 'object') {
          throw new PlatformError(`가명 처리에 실패했습니다 — ${path}의 행 식별자가 스칼라가 아닙니다`)
        }
        rec = row[1]
      }
      if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
        throw new PlatformError(
          `가명 처리에 실패했습니다 — ${path}의 행을 검사할 수 없는 형태입니다(객체가 아님). ` +
            `허용 목록을 적용할 수 없으면 통과시키지 않습니다.`,
        )
      }
      checkRecord(path, rec as Record<string, unknown>, spec)
    }
  }
}

/** 가명 처리 자체 검사 (28-61-02): 결과에 실명이 남아 있으면 내보내기를 실패시킨다 */
export function assertNoRealNames(json: string, names: readonly string[]): void {
  assertNoRealIdentifiers(json, names)
}

/**
 * 가명 처리 자체 검사 (28-64-02) — 이름뿐 아니라 **연락처·사업자등록번호**까지 본다.
 *
 * 28-63까지는 이름만 대조해서, 계정에 있는 전화번호·사업자번호가 결과에 남아도 통과했다.
 * 숫자 식별자는 구분자(`-`·공백)를 지운 형태로도 대조해 `010-1234-5678` ↔ `01012345678`을 함께 잡는다.
 * 2자 이하 토큰은 오탐(카테고리·패키지명에 부분 문자열로 걸리는 경우)이 커서 제외한다.
 */
export function assertNoRealIdentifiers(json: string, identifiers: readonly string[]): void {
  const digitsOnly = (v: string) => v.replace(/[^0-9]/g, '')
  const jsonDigits = digitsOnly(json)
  const leaked = new Set<string>()
  for (const raw of identifiers) {
    const v = raw.trim()
    if (v.length < 3) continue
    if (json.includes(v)) {
      leaked.add(v)
      continue
    }
    const d = digitsOnly(v)
    // 숫자 식별자(전화·사업자번호)만 구분자 무시 대조 — 짧은 숫자의 우연한 일치는 막는다
    if (d.length >= 9 && jsonDigits.includes(d)) leaked.add(v)
  }
  if (leaked.size > 0) {
    throw new PlatformError(`가명 처리에 실패했습니다 — 결과에 실제 식별자가 남아 있습니다: ${[...leaked].join(', ')}`)
  }
}

export interface PlatformSnapshot {
  /** 가명 처리본 표시 (28-61-01) — 단방향 변환의 산출물이라 복원에 쓸 수 없다 */
  pseudonymous?: boolean
  version: 1
  /** 저장 리비전 (28-55-01) — 저장마다 +1, 탭 간 변경 감지 */
  rev?: number
  savedAt?: string
  store: RequestStoreSnapshot
  estimates: Array<[string, StoredEstimate]>
  jobs: CompletedJob[]
  slots: ScheduleSlot[]
  slotSeq: number
  /** 28-7에서 추가 — 구(28-6 이전) 스냅샷에는 없을 수 있다 (28-6-04) */
  extraWorks?: ExtraWork[]
  extraSeq?: number
  /** 28-95: 계약서·수수료 조건·일정 변경 제안 */
  contracts?: Contract[]
  contractSeq?: number
  commissionTerms?: CommissionTerms[]
  scheduleChanges?: ScheduleChange[]
  scheduleChangeSeq?: number
  /** 28-9에서 추가 — 요청별 작업 체크리스트 상태 (28-8-02) */
  checklists?: Array<[string, Partial<Record<ChecklistKey, boolean>>]>
  /** 28-9에서 추가 — 파트너 프로필 (28-8-04). 28-42부터는 profiles로 대체(구 스냅샷 호환용) */
  profile?: PartnerProfile
  /** 28-42 신규 — 파트너별 프로필 (28-41-02) */
  profiles?: Array<[string, PartnerProfile]>
  /** 28-18 신규 — 없으면 구 스냅샷 */
  reviews?: Review[]
  /** 28-22 신규 — 없으면 기본값 */
  settings?: SiteSettings
  /** 28-23 신규 — 없으면 빈 목록 */
  claims?: Claim[]
  claimSeq?: number
  /** 28-46 신규 — 환불 (28-45-01) */
  refunds?: Refund[]
  /** 28-57에서 추가 — 파트너 휴무일 (28-56-02) */
  daysOff?: Array<[string, string[]]>
  /** 28-51에서 추가 — 파트너 낙찰 철회 기록 (28-50-01) */
  partnerCancels?: PartnerCancel[]
  partnerCancelSeq?: number
  /** 28-63에서 추가 — 낙찰 전 입찰 철회 기록 (28-62-02) */
  bidWithdrawals?: BidWithdrawal[]
  bidWithdrawalSeq?: number
  /** 28-58에서 추가 — 운영 감사 로그 (28-57-01) */
  auditLog?: AuditEntry[]
  auditSeq?: number
  refundSeq?: number
  /** 28-26 신규 — 없으면 기본 시드 */
  packages?: ServicePackage[]
  packageSeq?: number
  /** 28-27 신규 — 없으면 기본 시드 */
  questions?: CategoryQuestion[]
  questionSeq?: number
  /** 28-28 신규 — 없으면 빈 대화 */
  chats?: ChatMessage[]
  chatSeq?: number
  /** 읽음 워터마크: "requestId:viewer" → 읽은 시점의 메시지 수 */
  chatReads?: Array<[string, number]>
  /** 28-29 신규 — 없으면 결제 이력 없음 */
  payments?: Payment[]
  paymentSeq?: number
  /** 28-36 신규 — 없으면 알림 없음 */
  notifications?: AppNotification[]
  notificationSeq?: number
}

/** 작업 체크리스트 고정 항목 (시안: 낙찰/작업 상세) */
export const CHECKLIST_ITEMS = [
  { key: 'visit', label: '현장 방문 및 실측' },
  { key: 'materials', label: '자재 수급' },
  { key: 'schedule', label: '작업 일정 확정' },
] as const

export type ChecklistKey = (typeof CHECKLIST_ITEMS)[number]['key']

export interface ChecklistItemState {
  key: ChecklistKey
  label: string
  done: boolean
}

export interface PartnerProfile {
  name: string
  specialties: string
  region: string
  intro: string
}

/** 사진 상한 (28-48-01) */
export const MAX_PHOTOS = 3
export const MAX_PHOTO_BYTES = 200 * 1024
/** 저장 용량 소프트 한도 (28-49-01): 직렬화 스냅샷 문자 수 기준 — localStorage는 UTF-16 문자 단위(약 5M) */
export const STORAGE_SOFT_LIMIT = 4 * 1024 * 1024
/** 파트너 철회 집계 창·임계 (28-50-02): 최근 90일, 2회 이상이면 운영 큐 */
export const PARTNER_CANCEL_WINDOW_DAYS = 90
export const FREQUENT_CANCEL_THRESHOLD = 2
/** 알림·채팅 보관 규칙 (28-54-01/02) */
export const NOTIFICATION_READ_RETENTION_DAYS = 30
export const NOTIFICATION_UNREAD_RETENTION_DAYS = 90
export const NOTIFICATION_CAP = 500
export const CHAT_MAX_TEXT = 500
export const CHAT_MAX_PER_REQUEST = 300
export const CHAT_RETENTION_DAYS = 180
/** 사진 보관 기간 (28-49-02): 정산·취소 후 이 일수가 지나면 사진 제거 */
export const PHOTO_RETENTION_DAYS = 90
/** 감사 로그 보관 (28-57-01): 180일 경과 제거, 그래도 상한 초과면 오래된 것부터 */
export const AUDIT_RETENTION_DAYS = 180
export const AUDIT_CAP = 1000
/** 같은 행위·대상 반복을 한 줄로 접는 시간 창 (28-59-02): 무차별 로그인이 로그를 밀어내지 못하게 */
export const AUDIT_COLLAPSE_MS = 5 * 60 * 1000

/** 사진 배열이 스냅샷에서 차지하는 문자 수 (data URL 길이 합) */
export function photoChars(photos: readonly RequestPhoto[] | undefined): number {
  return (photos ?? []).reduce((n, p) => n + p.dataUrl.length, 0)
}

/** 저장 용량 관측 (28-49-01) */
export interface StorageUsage {
  chars: number
  photoChars: number
  photoCount: number
  /** 28-54-03: 알림·채팅·기타 내역 */
  notificationChars: number
  notificationCount: number
  chatChars: number
  chatCount: number
  /** 28-58-04: 감사 로그 내역 — 상한(1000건)의 실제 무게를 보이게 */
  auditChars: number
  auditCount: number
  otherChars: number
  /** 28-73-01: 같은 저장소의 다른 키(덮인 변경 보관함 등) */
  externalChars: number
  /** 28-73-01: `chars + externalChars` — 한도와 비교되는 값이다 */
  totalChars: number
  limit: number
  /** 0~1 (한도 대비 **합계**) */
  ratio: number
}

/** 사진 검증 (28-48-01): 장수·크기·data URL 형식(JPEG/PNG)·치수 — 오류는 PlatformError */
export function validatePhotos(photos: readonly RequestPhoto[]): void {
  if (photos.length > MAX_PHOTOS) throw new PlatformError(`사진은 최대 ${MAX_PHOTOS}장까지 첨부할 수 있습니다`)
  const ids = new Set<string>()
  photos.forEach((p, i) => {
    if (typeof p?.id !== 'string' || p.id === '' || ids.has(p.id)) throw new PlatformError(`사진 ${i + 1} id`)
    ids.add(p.id)
    if (typeof p.dataUrl !== 'string' || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(p.dataUrl)) {
      throw new PlatformError(`사진 ${i + 1}은 JPEG/PNG data URL이어야 합니다`)
    }
    if (!Number.isInteger(p.bytes) || p.bytes <= 0 || p.bytes > MAX_PHOTO_BYTES) {
      throw new PlatformError(`사진 ${i + 1}은 ${Math.round(MAX_PHOTO_BYTES / 1024)}KB 이하여야 합니다`)
    }
    if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width <= 0 || p.height <= 0) {
      throw new PlatformError(`사진 ${i + 1} 치수`)
    }
  })
}

/** 쉼표 구분 토큰 파싱 (28-46-01) — 공백 제거, 빈 토큰 제외, 중복 제거 */
export function parseTokens(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter((t) => t !== ''),
    ),
  ]
}

/** 매칭 규칙 (28-46-01): 카테고리 일치 AND (지역 토큰 중 하나가 요청 지역에 포함 — 지역 비어 있으면 통과). 분야가 비어 있으면 매칭 없음 */
/** 요청의 분야 묶음 (28-93) — 구 데이터는 `category` 하나 */
export function categoriesOf(r: Pick<RepairRequest, 'category' | 'categories'>): RepairCategory[] {
  return r.categories && r.categories.length > 0 ? [...r.categories] : [r.category]
}

/** 관리자 검토 보류 중 (28-93): 수동 검토 대상인데 아직 검토 완료 기록이 없다 — 파트너에게 보이지 않는다 */
export function heldForReview(r: Pick<RepairRequest, 'reviewStatus' | 'review'>): boolean {
  return r.reviewStatus === 'MANUAL_REVIEW' && r.review === undefined
}

/** 상세 주소·연락처 규칙 (28-94, 참고 v12 `orderSchema`): 주소 5~200자, 연락처 010 + 7~8자리 */
export const ADDRESS_MIN = 5
export const ADDRESS_MAX = 200
export function normalizeAddress(raw: unknown): string {
  if (typeof raw !== 'string') throw new PlatformError('상세 주소 형식이 올바르지 않습니다')
  const v = raw.trim().replace(/\s+/g, ' ')
  if (v.length < ADDRESS_MIN) throw new PlatformError(`상세 주소를 ${ADDRESS_MIN}자 이상 입력해 주세요`)
  if (v.length > ADDRESS_MAX) throw new PlatformError(`상세 주소는 ${ADDRESS_MAX}자 이하여야 합니다`)
  return v
}
export function normalizeRequestPhone(raw: unknown): string {
  if (typeof raw !== 'string') throw new PlatformError('연락처 형식이 올바르지 않습니다')
  const d = raw.replace(/[^0-9]/g, '')
  if (!/^010\d{7,8}$/.test(d)) throw new PlatformError('연락처는 010으로 시작하는 10~11자리여야 합니다')
  return d
}

/** 이름 가림 (28-94): 첫 글자 + * + 마지막 글자 — 두 글자면 첫 글자 + * */
export function maskName(name: string): string {
  const n = name.trim()
  if (n.length <= 1) return n === '' ? '' : '*'
  if (n.length === 2) return `${n[0]}*`
  return `${n[0]}${'*'.repeat(n.length - 2)}${n[n.length - 1]}`
}

/** 낙찰 파트너에게만 열리는 필드 (28-94) — 이 목록이 곧 "가림"의 정의다 */
export const PARTNER_PRIVATE_KEYS = ['address', 'phone', 'photos'] as const

/**
 * 파트너에게 보이는 요청 (28-94, 참고 v12 `view()`): 낙찰 파트너가 아니면 상세 주소·연락처·현장 사진을 빼고 이름을 가린다.
 * 낙찰 판정은 `acceptedPartnerId`다(28-42-01) — 구 데이터(낙찰 전) 요청은 모두 가려진다.
 */
export function requestForPartner(r: RepairRequest, partnerId: string): RepairRequest {
  if (r.acceptedPartnerId === partnerId) return { ...r }
  // #255 리뷰: 키 목록을 여기서 다시 적지 않는다 — PARTNER_PRIVATE_KEYS 하나가 정의이고, 여기는 그것을 지운다
  const masked: RepairRequest = { ...r, customerName: maskName(r.customerName) }
  for (const k of PARTNER_PRIVATE_KEYS) delete masked[k]
  return masked
}

export function profileMatch(
  profile: PartnerProfile,
  request: Pick<RepairRequest, 'category' | 'categories' | 'region'>,
): boolean {
  const cats = parseTokens(profile.specialties)
  // 28-93: 분야가 여럿이면 하나라도 겹치면 맞는다
  if (cats.length === 0 || !categoriesOf(request).some((c) => cats.includes(c))) return false
  const regions = parseTokens(profile.region)
  if (regions.length === 0) return true
  return regions.some((tok) => request.region.includes(tok))
}

/** 프로필 미설정 시 고객 노출 기본값 (28-31-01) — 파트너가 마이 탭에서 저장하면 대체된다 */
export const DEFAULT_PARTNER_PROFILE: PartnerProfile = {
  name: '반듯 파트너',
  // 28-46-01: 매칭 규칙이 붙으면서 기본값은 비움 — 파트너가 설정해야 맞춤 일감·알림이 동작한다 (화면은 '집수리 전반'으로 폴백)
  specialties: '',
  region: '',
  intro: '반듯집수리 인증 파트너입니다. 방문 전 견적 그대로, 추가 비용은 승인 후에만 청구합니다.',
}

export interface PlatformOptions {
  storage?: StorageLike
  storageKey?: string
  /** 저장 용량 한도(문자 수) — 기본 STORAGE_SOFT_LIMIT (28-49-01) */
  storageLimit?: number
  /** 저장 실패 통지 (28-49-01) */
  onSaveError?: (message: string) => void
  /**
   * **같은 저장소의 다른 키**가 쓰는 문자 수 (28-73-01). 도메인은 저장소를 모르지만, 한도는 브라우저 하나가
   * 공유한다 — 앱이 알려 주지 않으면 용량 카드와 가드가 스냅샷만 보고 "여유 있다"고 답한다.
   *
   * 28-72-03의 덮인 변경 보관함이 실제로 그 상태를 만들었다: 최대 3개 × 4MB를 쓰면서 회계 어디에도 없었고,
   * 가드가 통과시킨 저장이 브라우저 할당량에서 실패했다. 기본값은 `() => 0`이라 이것을 넘기지 않는 호출자의
   * 동작은 그대로다.
   */
  externalChars?: () => number
  /**
   * 28-78-01: **같은 저장소의 다른 키를 줄여 달라**고 앱에 부탁한다 — `need`만큼 확보를 시도하고
   * 실제로 비운 문자 수를 돌려준다. 도메인은 여전히 저장소를 모른다(숫자와 함수 하나다).
   *
   * 28-75-02는 보관함 정리를 **부팅에만** 두었다. 그런데 예산을 넘기는 사건은 쓰는 중에 일어난다
   * (스냅샷이 커지면 `한도 − 스냅샷`이 줄어든다) — 그 순간부터 새로고침 전까지 저장이 막혔다.
   * 보관함은 "잃지 않기"의 장치지 저장을 막는 장치가 아니므로, 둘이 부딪히면 보관함이 양보한다
   * (28-75-02가 "하나도 안 들어가면 비운다"를 택한 것과 같은 순서다).
   */
  trimExternal?: (needChars: number) => number
}

export type SettlementFilter = 'all' | 'settled' | 'unsettled'

/** 운영 큐 (28-44-01) */
export interface OpsQueue {
  overdueRequests: Array<{ request: RepairRequest; bidCount: number; daysOver: number }>
  staleScheduled: Array<{ request: RepairRequest; visitDate: string; daysOver: number }>
  unpaidCompleted: Array<{ request: RepairRequest; completedDate: string; daysSince: number; amount: number }>
  openClaims: Claim[]
  pendingPayouts: CompletedJob[]
  /** 28-45-01: 환불 대기 */
  pendingRefunds: Array<{ refund: Refund; request: RepairRequest }>
  /** 28-50-02: 90일 내 낙찰 철회 2회 이상 파트너 */
  frequentCancellers: Array<{ partnerId: string; count: number; last: string }>
  /** 28-53-02: 접수 2일 경과·파트너 답변 없는 미해결 건 */
  unansweredClaims: Array<{ claim: Claim; daysSince: number }>
  /** 28-93: 관리자 검토 대기 (안전·작업 범위) */
  reviewQueue: Array<{ request: RepairRequest; flags: ReviewFlag[] }>
  counts: {
    overdueRequests: number
    staleScheduled: number
    unpaidCompleted: number
    openClaims: number
    pendingPayouts: number
    pendingRefunds: number
    frequentCancellers: number
    unansweredClaims: number
    reviewQueue: number
  }
}

/** 건별 원장 행 (28-47-01): 입금 +, 출금 − (정수 KRW) */
export type LedgerType = '예약금' | '최종결제' | '환불' | '파트너지급' | '플랫폼수수료'
export interface LedgerRow {
  /** YYYY-MM-DD */
  date: string
  type: LedgerType
  requestId: string
  /** 상대방 표기 — 고객명 또는 파트너명(id) */
  counterparty: string
  amount: number
  /** 영수증·환불·지급 참조 */
  ref: string
  memo: string
}
export interface LedgerSummary {
  month: string
  inflow: number
  outflow: number
  fee: number
  net: number
  rows: number
}

/** 입찰 성과 지표 (28-11-03) */
export interface BidStats {
  totalBids: number
  won: number
  lost: number
  pending: number
  /** 낙찰률(%) — 결정된 입찰이 없으면 null */
  winRate: number | null
}

export interface MonthlyReportRow {
  /** YYYY-MM */
  month: string
  jobCount: number
  totalAmount: number
  totalFee: number
  payout: number
  settledPayout: number
  unsettledPayout: number
}

export interface TimelineEvent {
  key: string
  label: string
  /** 관련 날짜 (YYYY-MM-DD) — 파생 가능한 경우만 */
  date?: string
  done: boolean
}

export interface AdminOverview {
  totalRequests: number
  /** requested~in_progress (진행 계열) */
  activeRequests: number
  completedOrSettled: number
  lostOrCancelled: number
  /** 정산 확정된 작업의 플랫폼 수수료 합 (정수 원) */
  feeConfirmed: number
  /** 완료됐지만 아직 정산 전인 작업의 수수료 합 (정수 원) */
  feePending: number
}

/** 이용약관 초안 (28-37-02) — 시연용 골격. 상용 개통 전 법무 검토본으로 교체(관리자 설정 탭에서 편집) */
export const DEFAULT_TERMS = `반듯집수리 이용약관 (초안)

제1조 (목적) 이 약관은 반듯집수리(이하 "회사")가 제공하는 집수리 견적·매칭·결제 서비스(이하 "서비스")의 이용 조건과 회사·회원 간 권리·의무를 정합니다.
제2조 (정의) "고객"은 수리 요청을 등록하는 회원, "파트너"는 견적을 제안하고 시공하는 회원(사업자 또는 개인)을 말합니다.
제3조 (회원가입) 회원은 휴대폰 본인인증을 거쳐 가입하며, 파트너는 유형(사업자/개인)을 선택하고 사업자는 사업자 정보 조회를 통과해야 합니다. 회사는 파트너 가입을 심사 후 승인할 수 있습니다.
제4조 (서비스 내용) 회사는 견적 비교, 방문 일정, 추가 작업 승인, 예약금·최종 결제, 채팅, 리뷰, 분쟁 접수 기능을 제공합니다. 시공 계약의 당사자는 고객과 파트너입니다.
제5조 (결제·정산) 고객은 낙찰 시 예약금(견적의 10%, 최소 1만 원)을, 작업 완료 후 최종 결제를 진행합니다. 파트너 정산은 최종 결제 완료 후 수수료를 차감하여 진행합니다.
제6조 (취소·환불) 방문 전 취소 시 예약금은 전액 환불되며, 방문 후 취소는 파트너와 협의한 실비를 차감할 수 있습니다.
제7조 (회원의 의무) 회원은 허위 정보를 등록하거나 플랫폼 외 직거래를 유도해서는 안 됩니다. 위반 시 회사는 이용을 정지할 수 있습니다.
제8조 (면책) 회사는 고객과 파트너 간 시공 계약의 이행을 보증하지 않으며, 분쟁 발생 시 중재 절차를 지원합니다.
제9조 (약관 변경) 회사는 관련 법령을 위배하지 않는 범위에서 약관을 변경할 수 있으며, 변경 시 7일 전 공지합니다.
부칙 이 약관은 서비스 개통일부터 시행합니다.`

/** 개인정보처리방침 초안 (28-37-02) */
export const DEFAULT_PRIVACY = `반듯집수리 개인정보처리방침 (초안)

1. 수집 항목 — 필수: 이름(업체명), 휴대폰 번호, 비밀번호, 파트너 유형, 사업자등록번호(사업자 파트너). 서비스 이용 과정에서 수리 요청 내용·주소(지역)·결제 기록·채팅 내용·리뷰가 생성됩니다.
2. 수집·이용 목적 — 회원 식별과 본인인증, 견적 매칭과 방문 일정 조율, 결제·정산·영수증 발급, 분쟁 처리, 서비스 개선 통계.
3. 보유·이용 기간 — 회원 탈퇴 시 지체 없이 파기합니다. 단, 전자상거래법에 따라 계약·결제 기록은 5년, 소비자 불만·분쟁 처리 기록은 3년간 보관합니다.
4. 제3자 제공 — 견적·시공을 위해 고객의 이름·연락처·요청 내용이 낙찰 파트너에게 제공됩니다. 그 밖의 제공은 회원의 별도 동의가 있을 때만 이루어집니다.
5. 처리 위탁 — 결제 대행(PG), 문자(SMS) 발송, 클라우드 호스팅을 위탁할 수 있으며 수탁자는 서비스 개통 시 고지합니다.
6. 정보주체의 권리 — 회원은 언제든 개인정보 열람·정정·삭제·처리정지를 요구할 수 있고, 마케팅 수신 동의는 마이페이지에서 철회할 수 있습니다.
7. 안전성 확보 조치 — 비밀번호 암호화 저장, 접근 권한 관리, 접속 기록 보관.
8. 개인정보 보호책임자 — 서비스 개통 시 성명·연락처를 고지합니다.
이 방침은 서비스 개통일부터 적용됩니다.`

/** 운영 설정 기본값 (28-21-01) — 관리자 설정 탭의 "기본값 복원" 대상 */
/** 분쟁 답변 기한 (28-53 → 28-90) */
export const CLAIM_REPLY_SLA_DAYS = 2

/**
 * 랜딩 기본 배치 (28-89-B) — 28-17부터 코드에 박혀 있던 순서를 **데이터로** 옮긴 것이다.
 * 관리자가 순서를 바꾸고 섹션을 숨기고 제목을 고친다. 히어로와 푸터는 여기 없다(고정).
 */
export const DEFAULT_LANDING: LandingLayout = {
  sections: LANDING_SECTION_IDS.map((id) => ({ id, visible: true })),
  titles: {},
}

/** 섹션의 기본 제목 — 관리자가 덮어쓰지 않으면 이것이 나간다. 제목이 없는 섹션은 `null` */
export const LANDING_DEFAULT_TITLE: Record<LandingSectionId, string | null> = {
  categories: '어떤 작업이 필요하세요?',
  steps: '간편한 4단계, 믿고 맡기세요',
  services: null,
  packages: '표준 가격',
  faq: '자주 묻는 질문',
  cta: null,
}

/** 관리자 화면이 보여 주는 섹션 이름 */
export const LANDING_SECTION_LABEL: Record<LandingSectionId, string> = {
  categories: '카테고리 선택',
  steps: '4단계 안내',
  services: '서비스 카드',
  packages: '표준 가격',
  faq: '자주 묻는 질문',
  cta: '견적 받기 배너',
}

/** 섹션 제목 — 덮어쓴 것이 있으면 그것, 없으면 기본. 제목 없는 섹션은 `null` */
export function landingTitle(layout: LandingLayout, id: LandingSectionId): string | null {
  const custom = layout.titles[id]
  if (custom !== undefined && custom.trim() !== '') return custom
  return LANDING_DEFAULT_TITLE[id]
}

/**
 * 배치를 검증하고 정규화한다 — 여섯 섹션이 정확히 한 번씩, 최소 하나는 보인다.
 * 구 스냅샷(`landing` 없음)과 손으로 고친 JSON 모두 여기를 지난다.
 */
export function normalizeLanding(raw: unknown): LandingLayout {
  if (typeof raw !== 'object' || raw === null) return cloneLanding(DEFAULT_LANDING)
  const r = raw as { sections?: unknown; titles?: unknown }
  const seen = new Set<LandingSectionId>()
  const sections: LandingLayout['sections'] = []
  for (const item of Array.isArray(r.sections) ? r.sections : []) {
    if (typeof item !== 'object' || item === null) continue
    const { id, visible } = item as { id?: unknown; visible?: unknown }
    if (!LANDING_SECTION_IDS.includes(id as LandingSectionId) || seen.has(id as LandingSectionId)) continue
    seen.add(id as LandingSectionId)
    sections.push({ id: id as LandingSectionId, visible: visible !== false })
  }
  // 빠진 섹션은 기본 순서대로 뒤에 붙인다 — 새 섹션이 생겨도 구 배치가 그것을 숨기지 않는다
  for (const id of LANDING_SECTION_IDS) if (!seen.has(id)) sections.push({ id, visible: true })
  const titles: LandingLayout['titles'] = {}
  if (typeof r.titles === 'object' && r.titles !== null) {
    for (const id of LANDING_SECTION_IDS) {
      const t = (r.titles as Record<string, unknown>)[id]
      if (typeof t === 'string' && t.trim() !== '' && LANDING_DEFAULT_TITLE[id] !== null)
        titles[id] = t.trim().slice(0, 60)
    }
  }
  return { sections, titles }
}

export function cloneLanding(l: LandingLayout): LandingLayout {
  return { sections: l.sections.map((x) => ({ ...x })), titles: { ...l.titles } }
}

export const DEFAULT_SETTINGS: SiteSettings = {
  heroTitle: '집수리,\n비교하고 맡기세요.',
  heroSub: '필요한 작업을 자세히 올리면 검증된 파트너가 견적을 제안합니다.\n비교 후 가장 적합한 업체를 선택하세요.',
  notice: '',
  disabledCategories: [],
  faqs: [
    {
      q: '견적은 어떻게 진행되나요?',
      a: '작업을 올리면 파트너가 공급가·부가세가 분리된 견적을 제안하고, 견적함에서 비교 후 수락하면 방문 일정이 잡힙니다.',
    },
    {
      q: '추가 작업 비용은 어떻게 결정되나요?',
      a: '시공 중 추가 작업이 필요하면 파트너가 승인 요청을 보내고, 고객이 승인한 금액만 최종 결제에 반영됩니다.',
    },
  ],
  terms: DEFAULT_TERMS,
  privacy: DEFAULT_PRIVACY,
  landing: DEFAULT_LANDING,
}

function cloneSettings(s: SiteSettings): SiteSettings {
  return {
    ...s,
    disabledCategories: [...s.disabledCategories],
    faqs: s.faqs.map((f) => ({ ...f })),
    landing: cloneLanding(s.landing),
  }
}

/** 기본 가격 패키지 시드 (28-25-01) — 관리자가 수정·숨김·삭제 가능한 출발점 */
export const DEFAULT_PACKAGES: ServicePackage[] = [
  {
    id: 'PK-0001',
    name: '욕실 실리콘 재시공',
    category: '주방·욕실 공사',
    price: 90000,
    description: '욕조·세면대 둘레 곰팡이 실리콘 제거 후 재시공',
    active: true,
  },
  {
    id: 'PK-0002',
    name: '수전 교체 (자재 별도)',
    category: '급배수·누수·설비',
    price: 60000,
    description: '주방·욕실 수전 탈거 및 신규 설치, 누수 점검 포함',
    active: true,
  },
  {
    id: 'PK-0003',
    name: '콘센트·스위치 교체',
    category: '전기·조명',
    price: 40000,
    description: '1구 기준, 추가 1구당 현장 협의',
    active: true,
  },
  {
    id: 'PK-0004',
    name: '도어락 교체 (자재 별도)',
    category: '문·도어락',
    price: 50000,
    description: '기존 타공 활용 디지털 도어락 설치',
    active: true,
  },
  {
    id: 'PK-0005',
    name: '방충망 교체',
    category: '방충망',
    price: 35000,
    description: '창 1짝 기준, 프레임 손상 시 현장 협의',
    active: true,
  },
  {
    id: 'PK-0006',
    name: '스마트 조명 스위치 설치',
    category: '스마트홈·보안',
    price: 70000,
    description: '중성선 확인 포함, 앱 연동 세팅까지',
    active: true,
  },
]

/** 카테고리별 기본 질문 시드 (28-26-01) — 견적 정확도를 올리는 사전 질문, 관리자가 수정 가능 */
export const DEFAULT_QUESTIONS: CategoryQuestion[] = [
  {
    id: 'Q-0001',
    category: '주방·욕실 공사',
    label: '누수나 곰팡이가 있나요?',
    options: ['없음', '곰팡이 있음', '누수 의심'],
    active: true,
  },
  { id: 'Q-0002', category: '주방·욕실 공사', label: '건물 연식이 어떻게 되나요?', active: true },
  {
    id: 'Q-0003',
    category: '전기·조명',
    label: '차단기 위치를 아시나요?',
    options: ['알고 있음', '모름'],
    active: true,
  },
  { id: 'Q-0004', category: '전기·조명', label: '증설·교체할 위치가 몇 곳인가요?', active: true },
  {
    id: 'Q-0005',
    category: '도배·도장·필름',
    label: '가구 이동이 필요한가요?',
    options: ['필요 없음', '일부 필요', '많이 필요'],
    active: true,
  },
  { id: 'Q-0006', category: '급배수·누수·설비', label: '물자국이 보이는 위치는 어디인가요?', active: true },
]

const DEFAULT_STORAGE_KEY = 'banded-platform-v1'

/**
 * 플랫폼 통합 계층 (28-2-03, 28-3-01/02/03): 견적 제출 → 일정 예약 →
 * 시공 완료 → 정산을 하나의 지속되는 상태로 연결한다. 모든 변경은
 * 성공 시 주입된 저장소(storage)에 자동 저장된다.
 */
/**
 * 읽음 워터마크 키 "requestId:viewer"의 뷰어 (28-81-04) — 키를 만드는 곳이 하나여야 한다.
 *
 * 28-82-04: `ChatSender`와 **타입으로 묶는다.** 28-81은 손으로 베낀 목록이라, `ChatSender`에 값이
 * 늘면 이 목록은 조용히 옛 상태로 남고 그 뷰어의 워터마크가 고아로 남았다 — 컴파일러는 아무 말도
 * 하지 않았다. `Record<ChatSender, true>`의 키를 쓰면 **빠뜨린 값이 타입 오류**가 된다.
 */
const CHAT_VIEWER_SET: Record<ChatSender, true> = { customer: true, partner: true }
const CHAT_VIEWERS = Object.keys(CHAT_VIEWER_SET) as ChatSender[]

/** 입찰이 "이겼다"고 보는 요청 상태 */
const WON_STATUSES = ['accepted', 'scheduled', 'in_progress', 'completed', 'settled']

export class PlatformService {
  readonly store = new RequestStore()
  /** 28-42-01: 요청 × 파트너 견적 (다중 입찰) */
  private bids = new Map<string, Map<string, StoredEstimate>>()
  private jobs: CompletedJob[] = []
  private slots: ScheduleSlot[] = []
  private slotSeq = 0
  private extraWorks: ExtraWork[] = []
  private contracts: Contract[] = []
  private contractSeq = 0
  private commissionTerms = new Map<string, CommissionTerms>()
  private scheduleChanges: ScheduleChange[] = []
  private scheduleChangeSeq = 0
  private reviews: Review[] = []
  private settings: SiteSettings = cloneSettings(DEFAULT_SETTINGS)
  private claims: Claim[] = []
  private claimSeq = 0
  private packages: ServicePackage[] = DEFAULT_PACKAGES.map((p) => ({ ...p }))
  private packageSeq = DEFAULT_PACKAGES.length
  private questions: CategoryQuestion[] = DEFAULT_QUESTIONS.map((q) => ({
    ...q,
    ...(q.options ? { options: [...q.options] } : {}),
  }))
  private questionSeq = DEFAULT_QUESTIONS.length
  private chats: ChatMessage[] = []
  private chatSeq = 0
  private chatReads = new Map<string, number>()
  private payments: Payment[] = []
  private paymentSeq = 0
  private refunds: Refund[] = []
  private refundSeq = 0
  private cancelLog: PartnerCancel[] = []
  private bidWithdrawalLog: BidWithdrawal[] = []
  private bidWithdrawalSeq = 0
  private auditEntries: AuditEntry[] = []
  private auditSeq = 0
  /** 현재 로그인한 관리자 식별자 (28-60-02) — PlatformProvider가 세션에서 채운다. 없으면 기록에 남기지 않는다 */
  actorId: string | undefined
  private partnerCancelSeq = 0
  private notifications: AppNotification[] = []
  private notificationSeq = 0
  private extraSeq = 0
  private checklists = new Map<string, Partial<Record<ChecklistKey, boolean>>>()
  private profiles = new Map<string, PartnerProfile>()
  /** 파트너 휴무일 (28-56-02) — YYYY-MM-DD 정렬 배열 */
  private daysOff = new Map<string, string[]>()
  private readonly storage: StorageLike | undefined
  private readonly storageKey: string
  private readonly storageLimit: number
  private readonly externalChars: () => number
  private readonly trimExternal: (needChars: number) => number
  /** 저장 실패 통지 (28-49-01) — 앱 셸이 배너로 띄운다 */
  onSaveError: ((message: string) => void) | undefined
  /**
   * 저장 성공 통지 (28-67-03) — 복제기가 "보낼 것이 생겼다"를 아는 유일한 경로다.
   *
   * 28-67은 `markChanged()`를 만들어 놓고 **프로덕션에서 아무도 부르지 않았다**. 그래서
   * `'pending'` 상태에 도달하는 길이 없었고, 복제기는 사용자가 탭을 포커스할 때만 돌았다.
   * `save()` 호출이 57개 메서드에 흩어져 있어 각 메서드를 고칠 수는 없다 —
   * `onSaveError`와 같은 층에 훅 하나를 더 두어 **한 곳에서** 잇는다.
   */
  onSaved: (() => void) | undefined
  /** 마지막 저장 실패 메시지 (28-49-01) — 성공하면 null */
  lastSaveError: string | null = null
  /** 저장 리비전 (28-55-01) */
  private rev = 0
  /** 다른 탭의 저장을 덮어쓴 횟수 (28-55-02) */
  conflictCount = 0
  onConflict: (() => void) | undefined
  /** 마지막 저장소 동기화 시각 (28-55-01) */
  lastSyncAt: string | null = null

  constructor(options: PlatformOptions = {}) {
    this.storage = options.storage
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
    this.storageLimit = options.storageLimit ?? STORAGE_SOFT_LIMIT
    this.externalChars = options.externalChars ?? (() => 0)
    this.trimExternal = options.trimExternal ?? (() => 0) // 28-78-01
    this.onSaveError = options.onSaveError
  }

  /**
   * 저장소에서 상태를 복원한 서비스를 만든다. 저장 데이터가 없거나
   * 손상됐으면 빈 서비스와 restored=false를 반환한다 (조용한 데이터
   * 유실 대신 새로 시작 — 손상 키는 제거).
   */
  static load(options: PlatformOptions = {}): { service: PlatformService; restored: boolean } {
    const service = new PlatformService(options)
    if (!options.storage) return { service, restored: false }
    const key = options.storageKey ?? DEFAULT_STORAGE_KEY
    let raw: string | null = null
    try {
      raw = options.storage.getItem(key)
    } catch {
      return { service, restored: false }
    }
    if (raw === null) return { service, restored: false }
    try {
      service.applySnapshot(PlatformService.parseSnapshot(raw))
      return { service, restored: true }
    } catch {
      try {
        options.storage.removeItem(key)
      } catch {
        // 저장소 접근 불가 — 무시
      }
      return { service: new PlatformService(options), restored: false }
    }
  }

  /** 신규 일감 등록 (28-3-05). 예산·입찰 마감은 선택이며 검증한다 (28-6-01). 성공 시 자동 저장. */
  /** 기본 입찰 마감일 (28-43-01): min(희망일 − 1일, 오늘 + 3일), 단 오늘 이상 */
  static defaultBidDeadline(desiredDate: string, today: string): string {
    const dayBefore = addDays(desiredDate, -1)
    const plus3 = addDays(today, 3)
    const candidate = dayBefore < plus3 ? dayBefore : plus3
    return candidate < today ? today : candidate
  }

  addRequest(
    input: Omit<RepairRequest, 'id' | 'status' | 'createdAt' | 'reviewStatus' | 'reviewFlags' | 'review'>,
    today: string = todayUTC(),
  ): RepairRequest {
    // 28-92: 옛 라벨('주방·욕실 공사' 등)은 카탈로그 라벨로 옮기고, 목록 밖은 거절한다
    // 28-93: 분야가 여럿이면 전부 옮기고 중복을 빼며, 첫 항목이 주 분야(`category`)다
    const rawCats = input.categories && input.categories.length > 0 ? input.categories : [input.category]
    const categories: RepairCategory[] = []
    for (const raw of rawCats) {
      const c = normalizeCategory(raw)
      if (c === undefined) throw new PlatformError(`알 수 없는 분야: ${String(raw)}`)
      if (!categories.includes(c)) categories.push(c)
    }
    const category = categories[0]!
    const { categories: _cats, safety: _safety, ...rest } = input
    input = categories.length > 1 ? { ...rest, category, categories } : { ...rest, category }
    // 28-93: 안전 질문 답이 실려 오면 접수 검토를 거친다 — 답이 없는 요청(구 데이터·직접 호출)은 검토 대상이 아니다
    const reviewed: Pick<RepairRequest, 'safety' | 'reviewStatus' | 'reviewFlags'> = {}
    if (_safety !== undefined) {
      const verdict = assessSafety({ categories, description: input.description, answers: _safety })
      reviewed.safety = { isLocked: _safety.isLocked, urgent: _safety.urgent, ack: _safety.ack }
      reviewed.reviewStatus = verdict.reviewStatus
      if (verdict.flags.length > 0) reviewed.reviewFlags = verdict.flags
    }
    const held = reviewed.reviewStatus === 'MANUAL_REVIEW'
    // 28-94: 상세 주소·연락처 — 있으면 규칙대로 정리, 없으면 구 데이터와 같은 모양
    if (input.address !== undefined) input = { ...input, address: normalizeAddress(input.address) }
    if (input.phone !== undefined) input = { ...input, phone: normalizeRequestPhone(input.phone) }
    if (input.budget !== undefined && (!Number.isInteger(input.budget) || input.budget < 0)) {
      throw new PlatformError(`예산은 0 이상의 정수(원)여야 합니다: ${input.budget}`)
    }
    assertValidDateStr(input.desiredDate, 'desiredDate')
    if (input.bidDeadline !== undefined) {
      assertValidDateStr(input.bidDeadline, 'bidDeadline')
      if (input.bidDeadline < today)
        throw new PlatformError(`입찰 마감일은 오늘(${today}) 이후여야 합니다: ${input.bidDeadline}`)
    } else {
      // 28-43-01: 모든 요청에 마감일 — 미입력 시 기본값
      input = { ...input, bidDeadline: PlatformService.defaultBidDeadline(input.desiredDate, today) }
    }
    if (input.desiredTime !== undefined && input.desiredTime !== '오전' && input.desiredTime !== '오후') {
      throw new PlatformError(`희망 시간대는 '오전' 또는 '오후'여야 합니다: ${String(input.desiredTime)}`)
    }
    if (input.photos !== undefined) {
      validatePhotos(input.photos)
      this.assertRoom(photoChars(input.photos))
      if (input.photos.length === 0) {
        const { photos: _none, ...rest } = input
        input = rest
      }
    }
    if (input.answers !== undefined) {
      // 28-26-02: 질문 텍스트 공백 거부, 빈 답변은 제출 시 걸러 저장
      for (const a of input.answers) {
        if (typeof a.question !== 'string' || a.question.trim() === '') {
          throw new PlatformError('답변의 질문 텍스트가 비어 있습니다')
        }
        if (typeof a.answer !== 'string') throw new PlatformError('답변 형식이 올바르지 않습니다')
      }
      const kept = input.answers
        .map((a) => ({ question: a.question.trim(), answer: a.answer.trim() }))
        .filter((a) => a.answer !== '')
      const { answers: _drop, ...rest } = input
      input = kept.length > 0 ? { ...rest, answers: kept } : rest
    }
    const request = this.store.add({ ...input, ...reviewed })
    // 28-46-01: 프로필이 매칭되는 파트너 전원에게 새 일감 알림(계정 범위)
    // 28-93: 검토 보류면 알리지 않는다 — 검토 완료(reviewRequest) 때 알린다
    if (held) {
      this.notify(
        'customer',
        `접수 확인 중 — ${this.reqLabel(request.id)} · 안전·작업 범위를 확인한 뒤 파트너에게 공개됩니다`,
        request.id,
      )
    } else {
      this.notifyMatchedPartners(request)
    }
    this.save()
    return request
  }

  private notifyMatchedPartners(request: RepairRequest): void {
    for (const [partnerId, profile] of this.profiles) {
      if (profileMatch(profile, request)) {
        this.notify(
          'partner',
          `내 지역·분야 새 일감 — ${this.reqLabel(request.id)} · ${request.region}`,
          request.id,
          partnerId,
        )
      }
    }
  }

  /** 관리자 검토 완료 조건 (28-93, 참고 v12 `review`): 사유 5자 이상, 연락·안전 안내 확인, 잠김이면 신원, 범위 검토면 범위 */
  static readonly REVIEW_NOTE_MIN = 5

  /**
   * 접수 검토 완료 (28-93): MANUAL_REVIEW 요청을 파트너에게 공개한다. 잠김(LOCKOUT)이면 신원 확인, 작업 범위 검토면
   * 범위 확인이 있어야 한다. 완료되면 매칭 파트너에게 새 일감 알림, 고객에게 공개 알림, 운영 기록.
   */
  reviewRequest(
    requestId: string,
    input: {
      note: string
      contactChecked: boolean
      safetyDelivered: boolean
      identityChecked?: boolean
      scopeChecked?: boolean
    },
    adminId: string,
  ): RepairRequest {
    const r = this.mustGet(requestId)
    if (r.reviewStatus !== 'MANUAL_REVIEW') throw new PlatformError(`검토 대상 요청이 아닙니다: ${requestId}`)
    if (r.review !== undefined) throw new PlatformError(`이미 검토가 끝난 요청입니다: ${requestId}`)
    if (r.status !== 'requested')
      throw new PlatformError(`검토는 접수 상태에서만 가능합니다 (${r.status}): ${requestId}`)
    const note = input.note.trim()
    if (note.length < PlatformService.REVIEW_NOTE_MIN)
      throw new PlatformError(`검토 사유를 ${PlatformService.REVIEW_NOTE_MIN}자 이상 적어 주세요`)
    if (!input.contactChecked) throw new PlatformError('고객 연락 확인이 필요합니다')
    if (!input.safetyDelivered) throw new PlatformError('안전 안내 전달 확인이 필요합니다')
    const flags = r.reviewFlags ?? []
    if (flags.includes('LOCKOUT') && !input.identityChecked)
      throw new PlatformError('문 잠김 건은 신원 확인이 필요합니다')
    if (flags.includes('WORK_SCOPE_REVIEW') && !input.scopeChecked)
      throw new PlatformError('작업 범위 검토 건은 범위 확인이 필요합니다')
    const by = adminId.trim()
    if (by === '') throw new PlatformError('검토자 계정이 비어 있습니다')
    const updated = this.store.setReview(requestId, { at: new Date().toISOString(), by, note })
    this.notify(
      'customer',
      `접수 확인 완료 — ${this.reqLabel(requestId)} · 이제 파트너가 견적을 낼 수 있습니다`,
      requestId,
    )
    this.notifyMatchedPartners(updated)
    this.record('admin', '접수 검토', requestId, note)
    this.save()
    return updated
  }

  /** 검토 대기 목록 (28-93): 오래된 순 */
  reviewQueue(): Array<{ request: RepairRequest; flags: ReviewFlag[] }> {
    return this.store
      .list()
      .filter((r) => r.status === 'requested' && heldForReview(r))
      .map((r) => ({ request: r, flags: r.reviewFlags ?? [] }))
  }

  /** 사진 추가 (28-48-01): 낙찰 전(requested/estimated)만, 상한 검증 */
  addPhoto(requestId: string, photo: RequestPhoto): RepairRequest {
    const r = this.mustGet(requestId)
    if (r.status !== 'requested' && r.status !== 'estimated')
      throw new PlatformError('사진은 낙찰 전에만 추가할 수 있습니다')
    const next = [...(r.photos ?? []), photo]
    validatePhotos(next)
    this.assertRoom(photo.dataUrl.length)
    const result = this.store.setPhotos(requestId, next)
    this.save()
    return result
  }

  removePhoto(requestId: string, photoId: string): RepairRequest {
    const r = this.mustGet(requestId)
    if (r.status !== 'requested' && r.status !== 'estimated')
      throw new PlatformError('사진은 낙찰 전에만 삭제할 수 있습니다')
    const next = (r.photos ?? []).filter((p) => p.id !== photoId)
    if (next.length === (r.photos ?? []).length) throw new PlatformError(`사진이 없습니다: ${photoId}`)
    const result = this.store.setPhotos(requestId, next)
    this.save()
    return result
  }

  /**
   * 시공 완료 사진 교체 (28-49-03): 낙찰 파트너만, 시공 중~작업 완료(최종 결제 전) 상태에서.
   * 같은 사진 규칙(최대 3장·200KB)과 용량 가드를 적용한다. 빈 배열이면 제거.
   */
  setCompletionPhotos(requestId: string, partnerId: string, photos: readonly RequestPhoto[]): RepairRequest {
    const r = this.mustGet(requestId)
    if (this.partnerOf(requestId) !== partnerId) throw new PlatformError('완료 사진은 낙찰 파트너만 올릴 수 있습니다')
    if (r.status !== 'in_progress' && r.status !== 'completed')
      throw new PlatformError('완료 사진은 시공 중 또는 작업 완료 상태에서만 올릴 수 있습니다')
    if (this.paymentFor(requestId, 'final')) throw new PlatformError('최종 결제 후에는 완료 사진을 바꿀 수 없습니다')
    validatePhotos(photos)
    this.assertRoom(photoChars(photos) - photoChars(r.completionPhotos))
    const result = this.store.setCompletionPhotos(requestId, [...photos])
    this.save()
    return result
  }

  /**
   * 작업 전 사진 교체 (28-96): 낙찰 파트너만, 방문 예정~작업 완료(최종 결제 전). 같은 사진 규칙과 용량 가드. 빈 배열이면 제거.
   * 계약 경로(28-95) 작업은 이 사진과 완료 사진이 각 1장 이상 있어야 완료된다.
   */
  setBeforePhotos(requestId: string, partnerId: string, photos: readonly RequestPhoto[]): RepairRequest {
    const r = this.mustGet(requestId)
    if (this.partnerOf(requestId) !== partnerId)
      throw new PlatformError('작업 전 사진은 낙찰 파트너만 올릴 수 있습니다')
    if (r.status !== 'scheduled' && r.status !== 'in_progress' && r.status !== 'completed')
      throw new PlatformError('작업 전 사진은 방문 예정·시공 중·작업 완료 상태에서만 올릴 수 있습니다')
    if (this.paymentFor(requestId, 'final')) throw new PlatformError('최종 결제 후에는 작업 전 사진을 바꿀 수 없습니다')
    validatePhotos(photos)
    this.assertRoom(photoChars(photos) - photoChars(r.beforePhotos))
    const result = this.store.setBeforePhotos(requestId, [...photos])
    this.save()
    return result
  }

  /** 맞춤 일감 (28-46-01): 낙찰 전·마감 전 요청 중 파트너 프로필과 매칭되는 것 */
  matchedRequests(partnerId: string, today: string = todayUTC()): RepairRequest[] {
    const profile = this.profiles.get(partnerId)
    if (!profile) return []
    return this.store.list().filter(
      (r) =>
        (r.status === 'requested' || r.status === 'estimated') &&
        !this.bidClosed(r.id, today) &&
        !heldForReview(r) && // 28-93: 검토 완료 전에는 파트너에게 없는 일감이다
        profileMatch(profile, r),
    )
  }

  /**
   * 견적 제출. requested 상태면 estimated로 전이하고,
   * 이미 estimated면 견적만 교체한다. 그 외 상태에서는 PlatformError.
   */
  submitEstimate(
    requestId: string,
    partnerId: string,
    input: Omit<Estimate, 'requestId' | 'partnerId'>,
    today: string = todayUTC(),
  ): EstimateBreakdown {
    const request = this.mustGet(requestId)
    if (request.status !== 'requested' && request.status !== 'estimated') {
      throw new PlatformError(`견적을 제출할 수 없는 상태입니다 (${request.status}): ${requestId}`)
    }
    if (this.bidClosed(requestId, today)) {
      throw new PlatformError(`입찰이 마감되었습니다 (마감 ${request.bidDeadline}): ${requestId}`)
    }
    // 28-93: 관리자 검토 전에는 견적을 받지 않는다 (화면에서 숨겨도 도메인이 막아야 한다)
    if (heldForReview(request)) throw new PlatformError(`관리자 검토 전에는 견적을 낼 수 없습니다: ${requestId}`)
    const estimate: Estimate = { ...input, requestId, partnerId }
    const breakdown = calcEstimate(estimate)
    // 28-42-01: 파트너별 1건 — 재제출은 자기 견적 교체. 28-52-02: n차 수정으로 기록·통지
    const byPartner = this.bids.get(requestId) ?? new Map<string, StoredEstimate>()
    const prev = byPartner.get(partnerId)
    const revision = prev ? (prev.revision ?? 0) + 1 : 0
    byPartner.set(partnerId, {
      estimate,
      breakdown,
      submittedAt: new Date().toISOString(),
      ...(revision > 0 ? { revision } : {}),
    })
    this.bids.set(requestId, byPartner)
    if (request.status === 'requested') {
      this.store.updateStatus(requestId, 'estimated')
    }
    if (prev) {
      this.notify(
        'customer',
        `견적이 수정되었습니다 (${revision}차) — ${this.reqLabel(requestId)} · ${breakdown.total.toLocaleString('ko-KR')}원 (이전 ${prev.breakdown.total.toLocaleString('ko-KR')}원)`,
        requestId,
      )
    } else {
      this.notify(
        'customer',
        `견적이 도착했습니다 — ${this.reqLabel(requestId)} · ${breakdown.total.toLocaleString('ko-KR')}원 (입찰 ${byPartner.size}건)`,
        requestId,
      )
    }
    this.save()
    return breakdown
  }

  /**
   * 입찰 철회 (28-52-02): 낙찰 전·마감 전, 내 입찰만. 남은 입찰이 없으면 requested로 되돌린다.
   * 낙찰 후 철회(withdrawAward)와 달리 신뢰 지표에 기록하지 않는다 — 낙찰 전 철회는 정상 행위.
   */
  withdrawBid(requestId: string, partnerId: string, today: string = todayUTC()): RepairRequest {
    const r = this.mustGet(requestId)
    if (r.status !== 'requested' && r.status !== 'estimated') {
      throw new PlatformError(`입찰 철회는 낙찰 전에만 가능합니다 (${r.status}) — 낙찰 후에는 낙찰 철회를 사용하세요`)
    }
    if (this.bidClosed(requestId, today))
      throw new PlatformError(
        `입찰이 마감된 요청은 철회할 수 없습니다 (마감 ${r.bidDeadline}) — 고객 결정을 기다려 주세요`,
      )
    const byPartner = this.bids.get(requestId)
    if (!byPartner?.has(partnerId)) throw new PlatformError('내 입찰이 없습니다')
    // 28-62-02: 지우기 전에 흔적을 남긴다 — 낙찰 후 철회(PartnerCancel)와 같은 대접
    this.bidWithdrawalSeq += 1
    this.bidWithdrawalLog.push({
      id: `BW-${String(this.bidWithdrawalSeq).padStart(4, '0')}`,
      requestId,
      partnerId,
      at: new Date().toISOString(),
      beforeDeadline: r.bidDeadline === undefined || r.bidDeadline >= today,
    })
    byPartner.delete(partnerId)
    if (byPartner.size === 0) {
      this.bids.delete(requestId)
      if (r.status === 'estimated') this.store.reopen(requestId, 'requested')
    }
    this.notify(
      'customer',
      `파트너가 입찰을 철회했습니다 — ${this.reqLabel(requestId)} (남은 견적 ${byPartner.size}건)`,
      requestId,
    )
    this.save()
    return this.mustGet(requestId)
  }

  /**
   * 요청 수정 (28-52-01): 낙찰 전(requested/estimated)만. addRequest와 같은 검증.
   * 희망일이 현재 마감보다 앞당겨지면 마감을 기본값으로 재계산. editedAt/editCount 기록, 입찰자 전원 알림.
   */
  updateRequest(requestId: string, patch: RequestPatch, today: string = todayUTC()): RepairRequest {
    assertValidDateStr(today, 'today')
    const r = this.mustGet(requestId)
    if (r.status !== 'requested' && r.status !== 'estimated')
      throw new PlatformError(`요청 수정은 낙찰 전에만 가능합니다 (${r.status})`)
    const next: RequestPatch = {}
    if (patch.description !== undefined) {
      const d = patch.description.trim()
      if (d === '') throw new PlatformError('요청 내용은 비울 수 없습니다')
      next.description = d
    }
    if (patch.region !== undefined) {
      const g = patch.region.trim()
      if (g === '') throw new PlatformError('지역은 비울 수 없습니다')
      next.region = g
    }
    if (patch.desiredDate !== undefined) {
      assertValidDateStr(patch.desiredDate, 'desiredDate')
      if (patch.desiredDate < today)
        throw new PlatformError(`희망 방문일은 오늘(${today}) 이후여야 합니다: ${patch.desiredDate}`)
      next.desiredDate = patch.desiredDate
    }
    if (patch.desiredTime !== undefined) {
      if (patch.desiredTime !== '오전' && patch.desiredTime !== '오후')
        throw new PlatformError(`희망 시간대는 '오전' 또는 '오후'여야 합니다: ${String(patch.desiredTime)}`)
      next.desiredTime = patch.desiredTime
    }
    if (patch.budget !== undefined) {
      if (!Number.isInteger(patch.budget) || patch.budget < 0)
        throw new PlatformError(`예산은 0 이상의 정수(원)여야 합니다: ${patch.budget}`)
      next.budget = patch.budget
    }
    if (patch.budgetRange !== undefined) next.budgetRange = patch.budgetRange.trim()
    if (patch.answers !== undefined) {
      for (const a of patch.answers) {
        if (typeof a.question !== 'string' || a.question.trim() === '')
          throw new PlatformError('답변의 질문 텍스트가 비어 있습니다')
        if (typeof a.answer !== 'string') throw new PlatformError('답변 형식이 올바르지 않습니다')
      }
      next.answers = patch.answers
        .map((a) => ({ question: a.question.trim(), answer: a.answer.trim() }))
        .filter((a) => a.answer !== '')
    }
    if (Object.keys(next).length === 0) throw new PlatformError('수정할 내용이 없습니다')
    // 28-93: 설명을 고치면 안전 답변과 다시 대조한다 — "아니오"라 해 놓고 설명에 "타는 냄새"를 쓰는 경로를 막는다
    if (next.description !== undefined && r.safety !== undefined)
      assessSafety({ categories: categoriesOf(r), description: next.description, answers: r.safety })
    const updated = this.store.update(requestId, next)
    if (
      next.desiredDate !== undefined &&
      updated.bidDeadline !== undefined &&
      next.desiredDate <= updated.bidDeadline
    ) {
      this.store.setBidDeadline(requestId, PlatformService.defaultBidDeadline(next.desiredDate, today))
    }
    const label = this.reqLabel(requestId)
    for (const bidder of this.bids.get(requestId)?.keys() ?? []) {
      this.notify('partner', `요청 내용이 수정되었습니다 — ${label}. 견적을 확인해 주세요`, requestId, bidder)
    }
    this.save()
    return this.mustGet(requestId)
  }

  /** 입찰 마감 여부 (28-43-01): 마감일이 오늘보다 이전이면 마감 (마감일 당일은 입찰 가능) */
  bidClosed(requestId: string, today: string = todayUTC()): boolean {
    const r = this.mustGet(requestId)
    return r.bidDeadline !== undefined && r.bidDeadline < today
  }

  /**
   * 마감 정리 (28-43-01) — 멱등. 마감이 지난 낙찰 전 요청에 고객 알림 1회:
   * 견적 0건 → "마감 연장 또는 취소", 견적 n건 → "비교 후 선택". 처리 건수를 돌려준다.
   */
  sweepDeadlines(today: string = todayUTC()): number {
    let n = 0
    for (const r of this.store.list()) {
      if (r.status !== 'requested' && r.status !== 'estimated') continue
      if (r.bidDeadline === undefined || r.bidDeadline >= today) continue
      if (r.deadlineNotifiedFor === r.bidDeadline) continue
      const count = this.bidCount(r.id)
      if (count === 0) {
        this.notify(
          'customer',
          `입찰 마감 — 견적이 들어오지 않았습니다. 마감을 연장하거나 요청을 취소해 주세요 (${this.reqLabel(r.id)})`,
          r.id,
        )
        // 28-44-01: 견적 0건 마감 경과는 운영 개입 대상 — 관리자에게도
        this.notify('admin', `입찰 마감 경과 — 견적 0건 (${this.reqLabel(r.id)}) · 운영 확인 필요`, r.id)
      } else {
        this.notify('customer', `입찰 마감 — 견적 ${count}건을 비교하고 선택해 주세요 (${this.reqLabel(r.id)})`, r.id)
      }
      this.store.setDeadlineNotified(r.id, r.bidDeadline)
      n += 1
    }
    if (n > 0) {
      this.record('system', '마감 정리', String(n))
      this.save()
    }
    return n
  }

  /** 결제 지연 리마인더 (28-44-01): 완료 후 3일 지나도 최종 결제가 없으면 고객·관리자 알림 1회 (멱등) */
  sweepPaymentReminders(today: string = todayUTC()): number {
    let n = 0
    for (const r of this.store.list()) {
      if (r.status !== 'completed') continue
      const job = this.jobs.find((j) => j.requestId === r.id)
      if (!job) continue
      if (this.hasPaid(r.id, 'final')) continue
      if (addDays(job.completedDate, PlatformService.PAYMENT_REMINDER_DAYS) > today) continue
      if (r.paymentReminderFor === job.completedDate) continue
      const days = daysBetween(job.completedDate, today)
      this.notify(
        'customer',
        `최종 결제가 ${days}일째 미완료입니다 — 결제를 진행해 주세요 (${this.reqLabel(r.id)})`,
        r.id,
      )
      this.notify('admin', `결제 지연 ${days}일 — ${this.reqLabel(r.id)} · 고객 확인 필요`, r.id)
      this.store.setPaymentReminder(r.id, job.completedDate)
      n += 1
    }
    if (n > 0) {
      this.record('system', '결제 리마인더', String(n))
      this.save()
    }
    return n
  }

  /** 완료 후 결제 리마인더까지의 유예일 */
  static readonly PAYMENT_REMINDER_DAYS = 3

  /** 운영 큐 (28-44-01): 오늘 조치할 항목 — 오래된 순 */
  opsQueue(today: string = todayUTC()): OpsQueue {
    const overdueRequests = this.store
      .list()
      .filter(
        (r) =>
          (r.status === 'requested' || r.status === 'estimated') &&
          r.bidDeadline !== undefined &&
          r.bidDeadline < today,
      )
      .map((r) => ({ request: r, bidCount: this.bidCount(r.id), daysOver: daysBetween(r.bidDeadline!, today) }))
      .sort((a, b) => b.daysOver - a.daysOver)
    const staleScheduled = this.store
      .list()
      .filter((r) => r.status === 'scheduled')
      .map((r) => ({ request: r, visitDate: this.slots.find((sl) => sl.requestId === r.id)?.date }))
      .filter(
        (x): x is { request: RepairRequest; visitDate: string } => x.visitDate !== undefined && x.visitDate < today,
      )
      .map((x) => ({ request: x.request, visitDate: x.visitDate, daysOver: daysBetween(x.visitDate, today) }))
      .sort((a, b) => b.daysOver - a.daysOver)
    const unpaidCompleted = this.store
      .list()
      .filter((r) => r.status === 'completed' && !this.hasPaid(r.id, 'final'))
      .map((r) => {
        const job = this.jobs.find((j) => j.requestId === r.id)
        return {
          request: r,
          completedDate: job?.completedDate ?? '',
          daysSince: job ? daysBetween(job.completedDate, today) : 0,
          amount: job ? job.total : 0,
        }
      })
      .sort((a, b) => b.daysSince - a.daysSince)
    const openClaims = this.allClaims().filter((c) => c.status !== 'resolved')
    const pendingPayouts = this.pendingPayouts()
    const pendingRefunds = this.pendingRefunds().map((refund) => ({ refund, request: this.mustGet(refund.requestId) }))
    const byPartner = new Map<string, { count: number; last: string }>()
    for (const c of this.cancelLog) {
      if (daysBetween(c.date, today) > PARTNER_CANCEL_WINDOW_DAYS || c.date > today) continue
      const cur = byPartner.get(c.partnerId) ?? { count: 0, last: c.date }
      byPartner.set(c.partnerId, { count: cur.count + 1, last: c.date > cur.last ? c.date : cur.last })
    }
    const frequentCancellers = [...byPartner.entries()]
      .filter(([, v]) => v.count >= FREQUENT_CANCEL_THRESHOLD)
      .map(([partnerId, v]) => ({ partnerId, count: v.count, last: v.last }))
      .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    const unansweredClaims = this.claims
      .filter(
        (c) =>
          c.status !== 'resolved' &&
          !c.partnerReply &&
          c.createdDate <= today &&
          daysBetween(c.createdDate, today) >= CLAIM_REPLY_SLA_DAYS,
      )
      .map((c) => ({ claim: { ...c }, daysSince: daysBetween(c.createdDate, today) }))
      .sort((a, b) => b.daysSince - a.daysSince)
    const reviewQueue = this.reviewQueue()
    return {
      overdueRequests,
      staleScheduled,
      unpaidCompleted,
      openClaims,
      pendingPayouts,
      pendingRefunds,
      frequentCancellers,
      unansweredClaims,
      reviewQueue,
      counts: {
        overdueRequests: overdueRequests.length,
        staleScheduled: staleScheduled.length,
        unpaidCompleted: unpaidCompleted.length,
        openClaims: openClaims.length,
        pendingPayouts: pendingPayouts.length,
        pendingRefunds: pendingRefunds.length,
        frequentCancellers: frequentCancellers.length,
        unansweredClaims: unansweredClaims.length,
        reviewQueue: reviewQueue.length,
      },
    }
  }

  /** 마감 연장 (28-43-01): 낙찰 전(requested/estimated)만, 오늘 이후로만 — 알림 플래그 초기화 */
  extendDeadline(requestId: string, newDeadline: string, today: string = todayUTC()): RepairRequest {
    const r = this.mustGet(requestId)
    if (r.status !== 'requested' && r.status !== 'estimated') {
      throw new PlatformError(`마감 연장은 낙찰 전에만 가능합니다 (${r.status}): ${requestId}`)
    }
    assertValidDateStr(newDeadline, 'bidDeadline')
    if (newDeadline < today) throw new PlatformError(`새 마감일은 오늘(${today}) 이후여야 합니다: ${newDeadline}`)
    if (r.bidDeadline !== undefined && newDeadline <= r.bidDeadline) {
      throw new PlatformError(`새 마감일은 현재 마감일(${r.bidDeadline}) 이후여야 합니다: ${newDeadline}`)
    }
    const result = this.store.setBidDeadline(requestId, newDeadline)
    this.save()
    return result
  }

  /** 대표 견적 (28-42-01): 낙찰 견적, 낙찰 전이면 단일 견적일 때만(구 데이터 호환) — 일정·완료·결제·타임라인의 기준 */
  private primaryBid(requestId: string): StoredEstimate | undefined {
    const byPartner = this.bids.get(requestId)
    if (!byPartner || byPartner.size === 0) return undefined
    const accepted = this.store.get(requestId)?.acceptedPartnerId
    if (accepted !== undefined) return byPartner.get(accepted)
    return byPartner.size === 1 ? [...byPartner.values()][0] : undefined
  }

  private cloneBid(b: StoredEstimate): StoredEstimate {
    return { ...b, estimate: { ...b.estimate }, breakdown: { ...b.breakdown } }
  }

  getEstimate(requestId: string): StoredEstimate | undefined {
    const stored = this.primaryBid(requestId)
    return stored ? this.cloneBid(stored) : undefined
  }

  /** 요청의 전체 입찰 (28-42-01) — 견적 합계 오름차순 */
  bidsFor(requestId: string): StoredEstimate[] {
    const byPartner = this.bids.get(requestId)
    if (!byPartner) return []
    return [...byPartner.values()]
      .sort((a, b) => a.breakdown.total - b.breakdown.total || a.estimate.partnerId.localeCompare(b.estimate.partnerId))
      .map((b) => this.cloneBid(b))
  }

  /** 특정 파트너의 입찰 (28-42-01) */
  bidOf(requestId: string, partnerId: string): StoredEstimate | undefined {
    const b = this.bids.get(requestId)?.get(partnerId)
    return b ? this.cloneBid(b) : undefined
  }

  /** 입찰 수 */
  bidCount(requestId: string): number {
    return this.bids.get(requestId)?.size ?? 0
  }

  /** 견적 수락 (28-42-01): 고객이 입찰 중 하나를 선택 — 낙찰 파트너 기록 + 낙찰/미낙찰 알림 */
  acceptBid(requestId: string, partnerId: string): RepairRequest {
    const request = this.mustGet(requestId)
    if (request.status !== 'estimated') {
      throw new PlatformError(
        `견적 수락은 견적 대기(estimated) 상태에서만 가능합니다 (${request.status}): ${requestId}`,
      )
    }
    const byPartner = this.bids.get(requestId)
    if (!byPartner?.has(partnerId)) throw new PlatformError(`해당 파트너의 견적이 없습니다: ${partnerId}`)
    this.store.setAcceptedPartner(requestId, partnerId)
    const result = this.store.updateStatus(requestId, 'accepted')
    for (const bidder of byPartner.keys()) {
      if (bidder === partnerId)
        this.notify('partner', `낙찰되었습니다 — ${this.reqLabel(requestId)}`, requestId, bidder)
      else this.notify('partner', `미낙찰 — ${this.reqLabel(requestId)} (다른 파트너 견적이 선택됨)`, requestId, bidder)
    }
    this.save()
    return result
  }

  /**
   * 방문 일정 예약 (28-3-02): accepted 상태의 실제 요청만 가능.
   * 슬롯 검증·충돌 검사 후 scheduled 전이까지 원자적으로 수행한다.
   */
  scheduleVisit(requestId: string, input: { date: string; startHour: number; endHour: number }): ScheduleSlot {
    const request = this.mustGet(requestId)
    if (request.status !== 'accepted') {
      throw new PlatformError(
        `일정은 견적 수락(accepted) 상태에서만 예약할 수 있습니다 (${request.status}): ${requestId}`,
      )
    }
    // 28-95: 계약서가 오간 요청은 계약 동의로만 예약된다 — 직접 예약은 계약 없는 구 경로에만 남는다.
    // #257 리뷰: 수정 요청(declined)된 계약도 "오간 계약"이다 — 거절 뒤에 직접 예약으로 우회하지 못한다.
    if (this.contracts.some((c) => c.requestId === requestId))
      throw new PlatformError(`계약서가 있는 요청은 고객의 계약 동의로 일정이 잡힙니다: ${requestId}`)
    const stored = this.primaryBid(requestId)
    const slot: ScheduleSlot = {
      id: `S-${this.slotSeq + 1}`,
      partnerId: stored?.estimate.partnerId ?? PlatformService.LEGACY_PARTNER_ID,
      requestId,
      ...input,
    }
    // 28-56-02: 휴무일 거부 — 충돌 검사 전에
    if (this.isDayOff(slot.partnerId, slot.date))
      throw new PlatformError(`파트너 휴무일에는 예약할 수 없습니다: ${slot.date}`)
    // addSlot이 검증·충돌 검사에 실패하면 여기서 던지고 아무 상태도 변하지 않는다
    const nextSlots = addSlot(this.slots, slot)
    this.store.updateStatus(requestId, 'scheduled')
    this.slots = nextSlots
    this.slotSeq += 1
    this.notify(
      'customer',
      `방문 일정이 확정되었습니다 — ${slot.date} ${String(slot.startHour).padStart(2, '0')}:00`,
      requestId,
    )
    this.save()
    return { ...slot }
  }

  // ── 계약서 · 수수료 조건 · 일정 변경 제안 (28-95, 참고 v12 `contracts`/`trade_terms`/`schedule_changes`) ──

  static readonly DEFAULT_COMMISSION_BPS = Math.round(PLATFORM_FEE_RATE * 10000)
  static readonly CONTRACT_TERMS_MIN = 2
  static readonly SCHEDULE_REASON_MIN = 2

  contractsFor(requestId: string): Contract[] {
    return this.contracts.filter((c) => c.requestId === requestId).map((c) => ({ ...c }))
  }

  acceptedContract(requestId: string): Contract | undefined {
    const c = this.contracts.find((x) => x.requestId === requestId && x.status === 'accepted')
    return c ? { ...c } : undefined
  }

  proposedContract(requestId: string): Contract | undefined {
    const c = this.contracts.find((x) => x.requestId === requestId && x.status === 'proposed')
    return c ? { ...c } : undefined
  }

  commissionTermsFor(requestId: string): CommissionTerms | undefined {
    const t = this.commissionTerms.get(requestId)
    return t ? { ...t } : undefined
  }

  /** 적용 수수료 bps: 동의된 계약 > 관리자 조건 > 기본(3%) */
  commissionBpsFor(requestId: string): number {
    return (
      this.acceptedContract(requestId)?.commissionBps ??
      this.commissionTerms.get(requestId)?.bps ??
      PlatformService.DEFAULT_COMMISSION_BPS
    )
  }

  /** 관리자 주문별 수수료 (28-95): 낙찰 뒤·계약 동의 전에만 */
  setCommissionTerms(requestId: string, bps: number, reason: string, adminId: string): CommissionTerms {
    const r = this.mustGet(requestId)
    if (this.acceptedContract(requestId)) throw new PlatformError('이미 동의된 계약이 있어 수수료를 바꿀 수 없습니다')
    if (r.status !== 'accepted') throw new PlatformError(`수수료 조건은 낙찰(accepted) 상태에서 정합니다 (${r.status})`)
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new PlatformError('수수료는 0~10000bps 정수여야 합니다')
    const why = reason.trim()
    if (why.length < PlatformService.SCHEDULE_REASON_MIN) throw new PlatformError('수수료 조건의 사유를 적어 주세요')
    const by = adminId.trim()
    if (by === '') throw new PlatformError('관리자 계정이 비어 있습니다')
    const terms: CommissionTerms = { requestId, bps, reason: why, by, at: new Date().toISOString() }
    this.commissionTerms.set(requestId, terms)
    // 제안 중인 계약은 옛 수수료를 담고 있다 — 다시 내게 한다
    for (const c of this.contracts) if (c.requestId === requestId && c.status === 'proposed') c.status = 'superseded'
    this.record('admin', '수수료 조건', requestId, `${bps}bps · ${why}`)
    this.notify(
      'partner',
      `수수료 조건이 정해졌습니다 — ${this.reqLabel(requestId)} · ${bps / 100}% (계약서를 발행해 주세요)`,
      requestId,
      this.partnerOf(requestId),
    )
    this.save()
    return { ...terms }
  }

  /** 계약서 발행 (28-95): 낙찰 파트너가, 낙찰(accepted) 상태에서. 이전 제안은 superseded, 버전은 +1 */
  proposeContract(
    requestId: string,
    partnerId: string,
    input: { deposit: number; terms: string; date: string; startHour: number; endHour: number },
    today: string = todayUTC(),
  ): Contract {
    assertValidDateStr(today, 'today')
    const r = this.mustGet(requestId)
    if (r.status !== 'accepted') throw new PlatformError(`계약서는 낙찰(accepted) 상태에서 발행합니다 (${r.status})`)
    const stored = this.primaryBid(requestId)
    if (!stored || stored.estimate.partnerId !== partnerId)
      throw new PlatformError('낙찰 파트너만 계약서를 발행할 수 있습니다')
    if (this.acceptedContract(requestId)) throw new PlatformError('이미 동의된 계약이 있습니다')
    const total = stored.breakdown.total
    if (!Number.isInteger(input.deposit) || input.deposit < 0)
      throw new PlatformError('예약금은 0 이상의 정수(원)여야 합니다')
    if (input.deposit > total)
      throw new PlatformError(`예약금은 총액(${total.toLocaleString('ko-KR')}원)을 넘을 수 없습니다`)
    const terms = input.terms.trim()
    if (terms.length < PlatformService.CONTRACT_TERMS_MIN) throw new PlatformError('계약 조건을 적어 주세요')
    const probe: ScheduleSlot = {
      id: 'probe',
      partnerId,
      requestId,
      date: input.date,
      startHour: input.startHour,
      endHour: input.endHour,
    }
    validateSlot(probe)
    if (probe.date < today) throw new PlatformError(`지난 날짜로는 일정을 잡을 수 없습니다: ${probe.date}`)
    if (this.isDayOff(partnerId, probe.date)) throw new PlatformError(`파트너 휴무일입니다: ${probe.date}`)
    addSlot(this.slots, probe) // 충돌이면 여기서 던진다 — 저장하지 않는다
    for (const c of this.contracts) if (c.requestId === requestId && c.status === 'proposed') c.status = 'superseded'
    const version =
      this.contracts.filter((c) => c.requestId === requestId).reduce((m, c) => Math.max(m, c.version), 0) + 1
    this.contractSeq += 1
    const contract: Contract = {
      id: `CT-${String(this.contractSeq).padStart(4, '0')}`,
      requestId,
      partnerId,
      version,
      total,
      deposit: input.deposit,
      commissionBps: this.commissionBpsFor(requestId),
      terms,
      date: probe.date,
      startHour: probe.startHour,
      endHour: probe.endHour,
      status: 'proposed',
      createdAt: new Date().toISOString(),
    }
    this.contracts.push(contract)
    this.notify(
      'customer',
      `계약서 v${version}이 도착했습니다 — ${this.reqLabel(requestId)} · 예약금 ${input.deposit.toLocaleString('ko-KR')}원 · 방문 ${probe.date} ${String(probe.startHour).padStart(2, '0')}:00`,
      requestId,
    )
    this.save()
    return { ...contract }
  }

  /** 계약 결정 (28-95): 고객이 동의하면 슬롯이 생기고 scheduled, 거절하면 파트너가 새 버전을 낸다 */
  decideContract(requestId: string, contractId: string, accept: boolean, today: string = todayUTC()): Contract {
    assertValidDateStr(today, 'today')
    const r = this.mustGet(requestId)
    if (r.status !== 'accepted')
      throw new PlatformError(`계약 결정은 낙찰(accepted) 상태에서만 가능합니다 (${r.status})`)
    const c = this.contracts.find((x) => x.id === contractId && x.requestId === requestId)
    if (!c) throw new PlatformError(`계약서를 찾을 수 없습니다: ${contractId}`)
    if (c.status !== 'proposed') throw new PlatformError(`최신 계약서를 다시 확인해 주세요 (${c.status})`)
    const now = new Date().toISOString()
    if (!accept) {
      c.status = 'declined'
      c.decidedAt = now
      this.notify(
        'partner',
        `고객이 계약서 v${c.version} 수정을 요청했습니다 — ${this.reqLabel(requestId)}`,
        requestId,
        c.partnerId,
      )
      this.save()
      return { ...c }
    }
    if (c.date < today) throw new PlatformError(`계약의 방문일이 지났습니다 — 새 계약서를 요청해 주세요: ${c.date}`)
    if (this.isDayOff(c.partnerId, c.date)) throw new PlatformError(`파트너 휴무일입니다: ${c.date}`)
    const slot: ScheduleSlot = {
      id: `S-${this.slotSeq + 1}`,
      partnerId: c.partnerId,
      requestId,
      date: c.date,
      startHour: c.startHour,
      endHour: c.endHour,
    }
    const nextSlots = addSlot(this.slots, slot)
    this.store.updateStatus(requestId, 'scheduled')
    this.slots = nextSlots
    this.slotSeq += 1
    c.status = 'accepted'
    c.decidedAt = now
    this.notify(
      'partner',
      `고객이 계약서 v${c.version}에 동의했습니다 — ${this.reqLabel(requestId)} · 방문 ${slot.date} ${String(slot.startHour).padStart(2, '0')}:00`,
      requestId,
      c.partnerId,
    )
    this.notify(
      'customer',
      `방문 일정이 확정되었습니다 — ${slot.date} ${String(slot.startHour).padStart(2, '0')}:00${c.deposit > 0 ? ` · 예약금 ${c.deposit.toLocaleString('ko-KR')}원을 결제해 주세요` : ''}`,
      requestId,
    )
    this.save()
    return { ...c }
  }

  scheduleChangesFor(requestId: string): ScheduleChange[] {
    return this.scheduleChanges.filter((c) => c.requestId === requestId).map((c) => ({ ...c }))
  }

  proposedScheduleChange(requestId: string): ScheduleChange | undefined {
    const c = this.scheduleChanges.find((x) => x.requestId === requestId && x.status === 'proposed')
    return c ? { ...c } : undefined
  }

  /** 일정 변경 제안 (28-95): 낙찰 파트너가 방문 예정(scheduled)에서. 이전 제안은 superseded */
  proposeSchedule(
    requestId: string,
    partnerId: string,
    input: { date: string; startHour: number; endHour: number; reason: string },
    today: string = todayUTC(),
  ): ScheduleChange {
    assertValidDateStr(today, 'today')
    const r = this.mustGet(requestId)
    if (r.status !== 'scheduled')
      throw new PlatformError(`일정 변경 제안은 방문 예정(scheduled) 상태에서만 가능합니다 (${r.status})`)
    const current = this.slots.find((s) => s.requestId === requestId)
    if (!current) throw new PlatformError(`예약된 일정이 없습니다: ${requestId}`)
    if (current.partnerId !== partnerId) throw new PlatformError('담당 파트너만 일정 변경을 제안할 수 있습니다')
    const reason = input.reason.trim()
    if (reason.length < PlatformService.SCHEDULE_REASON_MIN) throw new PlatformError('변경 사유를 적어 주세요')
    const probe: ScheduleSlot = {
      id: current.id,
      partnerId,
      requestId,
      date: input.date,
      startHour: input.startHour,
      endHour: input.endHour,
    }
    validateSlot(probe)
    if (probe.date < today) throw new PlatformError(`지난 날짜로는 변경할 수 없습니다: ${probe.date}`)
    if (current.date === probe.date && current.startHour === probe.startHour && current.endHour === probe.endHour)
      throw new PlatformError('같은 일정입니다 — 날짜나 시간을 바꿔 주세요')
    if (this.isDayOff(partnerId, probe.date)) throw new PlatformError(`파트너 휴무일입니다: ${probe.date}`)
    addSlot(
      this.slots.filter((s) => s.requestId !== requestId),
      probe,
    )
    for (const c of this.scheduleChanges)
      if (c.requestId === requestId && c.status === 'proposed') c.status = 'superseded'
    this.scheduleChangeSeq += 1
    const change: ScheduleChange = {
      id: `SC-${String(this.scheduleChangeSeq).padStart(4, '0')}`,
      requestId,
      partnerId,
      date: probe.date,
      startHour: probe.startHour,
      endHour: probe.endHour,
      reason,
      status: 'proposed',
      createdAt: new Date().toISOString(),
    }
    this.scheduleChanges.push(change)
    this.notify(
      'customer',
      `파트너가 방문 일정 변경을 제안했습니다 — ${this.reqLabel(requestId)} · ${probe.date} ${String(probe.startHour).padStart(2, '0')}:00~${String(probe.endHour).padStart(2, '0')}:00 (${reason})`,
      requestId,
    )
    this.save()
    return { ...change }
  }

  /** 일정 변경 결정 (28-95): 고객이 승인하면 슬롯 교체(28-56 규칙 그대로), 거절하면 파트너에게 알림 */
  decideSchedule(requestId: string, changeId: string, accept: boolean, today: string = todayUTC()): ScheduleChange {
    assertValidDateStr(today, 'today')
    const c = this.scheduleChanges.find((x) => x.id === changeId && x.requestId === requestId)
    if (!c) throw new PlatformError(`일정 변경 제안을 찾을 수 없습니다: ${changeId}`)
    if (c.status !== 'proposed') throw new PlatformError(`유효한 일정 변경 제안이 아닙니다 (${c.status})`)
    const now = new Date().toISOString()
    if (!accept) {
      c.status = 'rejected'
      c.decidedAt = now
      this.notify(
        'partner',
        `고객이 일정 변경을 거절했습니다 — ${this.reqLabel(requestId)} (기존 일정 유지)`,
        requestId,
        c.partnerId,
      )
      this.save()
      return { ...c }
    }
    const slot = this.applyReschedule(
      requestId,
      { date: c.date, startHour: c.startHour, endHour: c.endHour },
      'partner',
      today,
    )
    c.status = 'approved'
    c.decidedAt = now
    // #257 리뷰: 거절만 알리고 승인은 알리지 않았다 — 파트너가 새 일정을 놓치지 않게 승인도 알린다
    this.notify(
      'partner',
      `고객이 일정 변경을 승인했습니다 — ${this.reqLabel(requestId)} · ${slot.date} ${String(slot.startHour).padStart(2, '0')}:00~${String(slot.endHour).padStart(2, '0')}:00`,
      requestId,
      c.partnerId,
    )
    this.save()
    return { ...c }
  }

  get scheduleSlots(): ScheduleSlot[] {
    return this.slots.map((s) => ({ ...s }))
  }

  /** 파트너 휴무일 설정 (28-56-02): 날짜 검증·중복 제거·정렬, 빈 배열이면 제거 */
  setDaysOff(partnerId: string, dates: readonly string[]): string[] {
    const uniq = [...new Set(dates.map((d) => d.trim()))].filter((d) => d !== '')
    for (const d of uniq) assertValidDateStr(d, 'dayOff')
    uniq.sort()
    if (uniq.length === 0) this.daysOff.delete(partnerId)
    else this.daysOff.set(partnerId, uniq)
    this.save()
    return [...uniq]
  }

  daysOffOf(partnerId: string): string[] {
    return [...(this.daysOff.get(partnerId) ?? [])]
  }

  isDayOff(partnerId: string, date: string): boolean {
    return (this.daysOff.get(partnerId) ?? []).includes(date)
  }

  /** 휴무 토글 (28-56-02) — 새 상태(true = 휴무) 반환 */
  toggleDayOff(partnerId: string, date: string): boolean {
    const cur = this.daysOffOf(partnerId)
    const next = cur.includes(date) ? cur.filter((d) => d !== date) : [...cur, date]
    this.setDaysOff(partnerId, next)
    return next.includes(date)
  }

  /**
   * 방문 일정 변경 (28-56-01): scheduled에서만. 지난 날짜·같은 일정·파트너 휴무일 거부, 자기 슬롯을 제외한
   * 충돌 검사(addSlot), 슬롯 교체(id 유지), rescheduleCount 기록, 상대방 알림(이전 → 새 일정).
   */
  rescheduleVisit(
    requestId: string,
    input: { date: string; startHour: number; endHour: number },
    by: 'customer' | 'partner',
    today: string = todayUTC(),
  ): ScheduleSlot {
    assertValidDateStr(today, 'today')
    // 28-95: 파트너는 단독으로 바꾸지 못한다 — 제안(proposeSchedule)하고 고객이 승인한다
    if (by === 'partner') throw new PlatformError('파트너는 일정 변경을 제안해야 합니다 — 고객이 승인하면 바뀝니다')
    return this.applyReschedule(requestId, input, 'customer', today)
  }

  /** 슬롯 교체의 공통 본체 (28-56-01 / 28-95): 고객 직접 변경과 파트너 제안 승인이 같은 검증·기록을 지난다 */
  private applyReschedule(
    requestId: string,
    input: { date: string; startHour: number; endHour: number },
    by: 'customer' | 'partner',
    today: string,
  ): ScheduleSlot {
    const r = this.mustGet(requestId)
    if (r.status !== 'scheduled')
      throw new PlatformError(`일정 변경은 방문 예정(scheduled) 상태에서만 가능합니다 (${r.status}): ${requestId}`)
    const current = this.slots.find((s) => s.requestId === requestId)
    if (!current) throw new PlatformError(`예약된 일정이 없습니다: ${requestId}`)
    const slot: ScheduleSlot = {
      id: current.id,
      partnerId: current.partnerId,
      requestId,
      date: input.date,
      startHour: input.startHour,
      endHour: input.endHour,
    }
    validateSlot(slot)
    if (slot.date < today) throw new PlatformError(`지난 날짜로는 변경할 수 없습니다: ${slot.date}`)
    if (current.date === slot.date && current.startHour === slot.startHour && current.endHour === slot.endHour)
      throw new PlatformError('같은 일정입니다 — 날짜나 시간을 바꿔 주세요')
    if (this.isDayOff(slot.partnerId, slot.date)) throw new PlatformError(`파트너 휴무일입니다: ${slot.date}`)
    const nextSlots = addSlot(
      this.slots.filter((s) => s.requestId !== requestId),
      slot,
    )
    this.slots = nextSlots
    this.store.markRescheduled(requestId)
    const fmt = (s: ScheduleSlot) =>
      `${s.date} ${String(s.startHour).padStart(2, '0')}:00~${String(s.endHour).padStart(2, '0')}:00`
    const label = this.reqLabel(requestId)
    if (by === 'customer')
      this.notify(
        'partner',
        `고객이 방문 일정을 변경했습니다 — ${label}: ${fmt(current)} → ${fmt(slot)}`,
        requestId,
        slot.partnerId,
      )
    else
      this.notify('customer', `파트너가 방문 일정을 변경했습니다 — ${label}: ${fmt(current)} → ${fmt(slot)}`, requestId)
    this.save()
    return { ...slot }
  }

  /** 방문 전날 리마인더 (28-56-03): 내일 방문 슬롯(요청 scheduled)에 고객·파트너 알림 1회 — 멱등, 처리 수 반환 */
  sweepVisitReminders(today: string = todayUTC()): number {
    assertValidDateStr(today, 'today')
    const target = addDays(today, VISIT_REMINDER_DAYS_BEFORE)
    let n = 0
    for (const s of this.slots) {
      if (s.date !== target || s.remindedFor === target) continue
      const r = this.store.get(s.requestId)
      if (!r || r.status !== 'scheduled') continue
      s.remindedFor = target
      const when = `${s.date} ${String(s.startHour).padStart(2, '0')}:00~${String(s.endHour).padStart(2, '0')}:00`
      const label = this.reqLabel(s.requestId)
      this.notify('customer', `내일 방문 예정 — ${label} · ${when}`, s.requestId)
      this.notify('partner', `내일 방문 예정 — ${label} · ${when} · ${r.region}`, s.requestId, s.partnerId)
      n += 1
    }
    if (n > 0) {
      this.record('system', '방문 리마인더', String(n))
      this.save()
    }
    return n
  }

  /**
   * 상태 전이의 단일 진입점. 데이터가 함께 움직여야 하는 전이는
   * 전용 경로로 강제한다: estimated→submitEstimate, scheduled→scheduleVisit,
   * completed→completeJob, settled→settle.
   */
  transitionRequest(requestId: string, to: JobStatus, options?: { completedDate?: string }): RepairRequest {
    if (to === 'estimated') {
      throw new PlatformError('estimated 전이는 submitEstimate()로만 가능합니다')
    }
    if (to === 'scheduled') {
      throw new PlatformError('scheduled 전이는 scheduleVisit()로만 가능합니다')
    }
    if (to === 'completed') {
      this.completeJob(requestId, options?.completedDate)
      return this.mustGet(requestId)
    }
    if (to === 'settled') {
      return this.settle(requestId)
    }
    if (to === 'accepted') {
      // 28-42-01: 입찰이 1건일 때만 하위 호환 — 여러 건이면 acceptBid로 파트너를 지정해야 한다
      const byPartner = this.bids.get(requestId)
      if (!byPartner || byPartner.size === 0) throw new PlatformError(`견적 없이 수락할 수 없습니다: ${requestId}`)
      if (byPartner.size > 1)
        throw new PlatformError('입찰이 여러 건입니다 — acceptBid(requestId, partnerId)로 견적을 지정하세요')
      return this.acceptBid(requestId, [...byPartner.keys()][0]!)
    }
    const today = todayUTC()
    const visitPassed = this.slots.some((s) => s.requestId === requestId && s.date <= today)
    const result = this.store.updateStatus(requestId, to)
    if (to === 'cancelled') {
      // 28-4-01: 취소 성공 시 해당 요청의 방문 슬롯을 해제해 시간대 차단을 푼다
      this.slots = this.slots.filter((s) => s.requestId !== requestId)
      // 28-45-01: 예약금이 결제돼 있으면 환불 대기 생성 — 방문 전 전액, 방문일 경과면 차감 협의
      const deposit = this.payments.find(
        (p) => p.requestId === requestId && p.kind === 'deposit' && p.status === 'done',
      )
      if (deposit && !this.refunds.some((r) => r.paymentId === deposit.id)) {
        this.refundSeq += 1
        this.refunds.push({
          id: `RF-${String(this.refundSeq).padStart(4, '0')}`,
          requestId,
          paymentId: deposit.id,
          amount: deposit.amount,
          deduction: 0,
          afterVisit: visitPassed,
          reason: visitPassed ? '방문일 경과 후 취소 — 실비 차감 협의' : '방문 전 취소 — 전액 환불',
          status: 'pending',
          createdAt: new Date().toISOString(),
        })
        this.notify(
          'admin',
          `환불 대기 — 예약금 ${deposit.amount.toLocaleString('ko-KR')}원 (${this.reqLabel(requestId)})`,
          requestId,
        )
        this.notify(
          'customer',
          `요청이 취소되었습니다 — 예약금 ${deposit.amount.toLocaleString('ko-KR')}원은 ${visitPassed ? '협의 후 실비를 차감하고' : '전액'} 환불됩니다`,
          requestId,
        )
      }
      // 28-42-03: 입찰한 파트너 전원에게 취소 알림(계정 범위)
      for (const bidder of this.bids.get(requestId)?.keys() ?? []) {
        this.notify('partner', `요청이 취소되었습니다 — ${this.reqLabel(requestId)}`, requestId, bidder)
      }
    }
    if (to === 'lost') {
      for (const bidder of this.bids.get(requestId)?.keys() ?? []) {
        this.notify('partner', `미낙찰 — ${this.reqLabel(requestId)}`, requestId, bidder)
      }
    }
    this.save()
    return result
  }

  /**
   * 시공 중 추가 작업 승인 (28-6-02): in_progress 상태에서만,
   * 고객이 승인한 금액(VAT 포함 정수 원)과 메모를 기록한다.
   */
  approveExtraWork(requestId: string, input: { amount: number; memo: string; approvedDate?: string }): ExtraWork {
    const request = this.mustGet(requestId)
    if (request.status !== 'in_progress') {
      throw new PlatformError(`추가 작업 승인은 시공 중(in_progress)에만 가능합니다 (${request.status}): ${requestId}`)
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new PlatformError(`추가 작업 금액은 1 이상의 정수(원)여야 합니다: ${input.amount}`)
    }
    const date = input.approvedDate ?? todayUTC()
    assertValidDateStr(date, 'approvedDate')
    this.extraSeq += 1
    const extra: ExtraWork = {
      id: `EW-${String(this.extraSeq).padStart(4, '0')}`,
      requestId,
      amount: input.amount,
      memo: input.memo.trim(),
      approvedDate: date,
    }
    this.extraWorks.push(extra)
    this.save()
    return { ...extra }
  }

  /**
   * 추가 작업 승인 요청 (28-15-01): 파트너가 시공 중 발견한 추가 작업을
   * pending 상태로 등록한다 — 확정은 고객의 decideExtraWork()로만.
   */
  /** 부가세 (28-96, 참고 v12): 공급가의 10%, 원 미만 반올림 */
  static vatOf(supply: number): number {
    return Math.round(supply * 0.1)
  }

  /**
   * 추가 작업 요청 (28-15-01 / 28-96): `supply`(공급가)를 주면 VAT 10%를 얹어 `amount = supply + vat`로 기록한다.
   * `amount`만 주는 구 호출은 VAT 포함 금액으로 그대로 둔다(구 데이터와 같은 모양).
   */
  requestExtraWork(
    requestId: string,
    input: { supply?: number; amount?: number; memo: string; requestedDate?: string },
  ): ExtraWork {
    const request = this.mustGet(requestId)
    if (request.status !== 'in_progress') {
      throw new PlatformError(`추가 작업 요청은 시공 중(in_progress)에만 가능합니다 (${request.status}): ${requestId}`)
    }
    let money: Pick<ExtraWork, 'amount' | 'supply' | 'vat'>
    if (input.supply !== undefined) {
      if (!Number.isInteger(input.supply) || input.supply <= 0)
        throw new PlatformError(`추가 작업 공급가는 1 이상의 정수(원)여야 합니다: ${input.supply}`)
      const vat = PlatformService.vatOf(input.supply)
      money = { amount: input.supply + vat, supply: input.supply, vat }
    } else {
      if (input.amount === undefined || !Number.isInteger(input.amount) || input.amount <= 0)
        throw new PlatformError(`추가 작업 금액은 1 이상의 정수(원)여야 합니다: ${String(input.amount)}`)
      money = { amount: input.amount }
    }
    const date = input.requestedDate ?? todayUTC()
    assertValidDateStr(date, 'requestedDate')
    this.extraSeq += 1
    const extra: ExtraWork = {
      id: `EW-${String(this.extraSeq).padStart(4, '0')}`,
      requestId,
      ...money,
      memo: input.memo.trim(),
      approvedDate: date,
      status: 'pending',
    }
    this.extraWorks.push(extra)
    this.notify(
      'customer',
      `추가 작업 승인 요청 — ${extra.memo || '추가 작업'} +${extra.amount.toLocaleString('ko-KR')}원${
        extra.supply !== undefined
          ? ` (공급가 ${extra.supply.toLocaleString('ko-KR')}원 + VAT ${extra.vat!.toLocaleString('ko-KR')}원)`
          : ''
      }`,
      requestId,
    )
    this.save()
    return { ...extra }
  }

  /** 추가 작업 결정 (28-15-01): 고객이 pending 요청을 승인/거절한다 */
  decideExtraWork(extraWorkId: string, decision: 'approved' | 'rejected', decidedDate?: string): ExtraWork {
    const extra = this.extraWorks.find((e) => e.id === extraWorkId)
    if (!extra) {
      throw new PlatformError(`추가 작업을 찾을 수 없습니다: ${extraWorkId}`)
    }
    if ((extra.status ?? 'approved') !== 'pending') {
      throw new PlatformError(`이미 결정된 추가 작업입니다 (${extra.status ?? 'approved'}): ${extraWorkId}`)
    }
    const date = decidedDate ?? todayUTC()
    assertValidDateStr(date, 'decidedDate')
    extra.status = decision
    extra.approvedDate = date
    this.notify(
      'partner',
      `추가 작업 ${decision === 'approved' ? '승인' : '거절'} — ${extra.memo || '추가 작업'}`,
      extra.requestId,
    )
    this.save()
    return { ...extra }
  }

  extraWorksFor(requestId: string): ExtraWork[] {
    return this.extraWorks.filter((e) => e.requestId === requestId).map((e) => ({ ...e }))
  }

  /** 요청별 작업 체크리스트 상태 (28-8-02) — 고정 3항목 */
  checklistFor(requestId: string): ChecklistItemState[] {
    const state = this.checklists.get(requestId) ?? {}
    return CHECKLIST_ITEMS.map((item) => ({
      key: item.key,
      label: item.label,
      done: state[item.key] === true,
    }))
  }

  /** 체크리스트 항목 토글. 존재하는 요청·유효한 키만 허용. */
  toggleChecklistItem(requestId: string, key: ChecklistKey): ChecklistItemState[] {
    this.mustGet(requestId)
    if (!CHECKLIST_ITEMS.some((item) => item.key === key)) {
      throw new PlatformError(`알 수 없는 체크리스트 항목입니다: ${String(key)}`)
    }
    const state = this.checklists.get(requestId) ?? {}
    state[key] = !(state[key] === true)
    this.checklists.set(requestId, state)
    this.save()
    return this.checklistFor(requestId)
  }

  /** 구 스냅샷(28-41 이전)의 단일 프로필이 귀속되는 파트너 id — 28-91에 시연 시드를 없앤 뒤 남은 유일한 용도 */
  static readonly LEGACY_PARTNER_ID = 'P-001'

  /** 요청의 견적 파트너 (28-41-01) — 견적이 없으면 undefined */
  partnerOf(requestId: string): string | undefined {
    return this.primaryBid(requestId)?.estimate.partnerId
  }

  /** 파트너 범위: 내 입찰이 있는 요청 (28-41-01/28-42-01) */
  partnerRequests(partnerId: string): RepairRequest[] {
    return this.store.list().filter((r) => this.bids.get(r.id)?.has(partnerId) === true)
  }

  /** 파트너 관점 상태 (28-42-01): 타 파트너에게 낙찰된 내 입찰은 미낙찰(lost)로 본다 */
  statusFor(requestId: string, partnerId: string): JobStatus {
    const r = this.mustGet(requestId)
    if (
      r.acceptedPartnerId !== undefined &&
      r.acceptedPartnerId !== partnerId &&
      r.status !== 'requested' &&
      r.status !== 'estimated'
    ) {
      return 'lost'
    }
    return r.status
  }

  /** 파트너 프로필 (28-8-04) — 28-42부터 파트너별 (28-41-02) */
  getProfile(partnerId: string = PlatformService.LEGACY_PARTNER_ID): PartnerProfile | undefined {
    const p = this.profiles.get(partnerId)
    return p ? { ...p } : undefined
  }

  /** 업체 요약 (28-31-01, 시안 3 "업체 상세"): 프로필 + 실적 + 평판. 고객 견적함·관리자·파트너 본인이 같은 값을 본다 */
  partnerSummary(
    partnerId: string = PlatformService.LEGACY_PARTNER_ID,
    today: string = todayUTC(),
  ): {
    profile: PartnerProfile
    completedCount: number
    winRate: number | null
    reviewCount: number
    average: number | null
    /** 28-50-02: 최근 90일 낙찰 후 철회 횟수 */
    cancelCount: number
  } {
    const counts = this.statusCounts(partnerId)
    const rstats = this.reviewStats(partnerId)
    const saved = this.profiles.get(partnerId)
    return {
      profile: saved ? { ...saved } : { ...DEFAULT_PARTNER_PROFILE },
      completedCount: counts.completed + counts.settled,
      winRate: this.bidStats(partnerId).winRate,
      reviewCount: rstats.count,
      average: rstats.average,
      cancelCount: this.partnerCancelCount(partnerId, PARTNER_CANCEL_WINDOW_DAYS, today),
    }
  }

  /**
   * 파트너 낙찰 철회 + 재오픈 (28-50-01): 낙찰 파트너만, accepted/scheduled에서만, 사유 필수.
   * 그 파트너 입찰 제거·슬롯 해제·체크리스트 초기화·낙찰 해제 후 다른 입찰이 남아 있으면 estimated, 없으면 requested로
   * 재오픈하고 마감을 오늘 기준 기본값으로 재설정한다. 예약금이 있으면 전액 환불 대기. 고객·관리자·다른 입찰자 알림.
   */
  withdrawAward(requestId: string, partnerId: string, reason: string, today: string = todayUTC()): RepairRequest {
    assertValidDateStr(today, 'today')
    const r = this.mustGet(requestId)
    if (this.partnerOf(requestId) !== partnerId) throw new PlatformError('낙찰 철회는 낙찰 파트너만 할 수 있습니다')
    if (r.status !== 'accepted' && r.status !== 'scheduled') {
      throw new PlatformError(
        `낙찰 철회는 낙찰·방문 예정 상태에서만 가능합니다 (${r.status}) — 시공이 시작된 뒤에는 고객·관리자와 협의하세요`,
      )
    }
    const why = reason.trim()
    if (why === '') throw new PlatformError('철회 사유를 입력하세요')
    const byPartner = this.bids.get(requestId)
    byPartner?.delete(partnerId)
    if (byPartner && byPartner.size === 0) this.bids.delete(requestId)
    const others = [...(byPartner?.keys() ?? [])]
    this.slots = this.slots.filter((s) => s.requestId !== requestId)
    this.checklists.delete(requestId)
    this.store.clearAcceptedPartner(requestId)
    this.store.reopen(requestId, others.length > 0 ? 'estimated' : 'requested')
    this.store.setBidDeadline(requestId, PlatformService.defaultBidDeadline(r.desiredDate, today))
    const deposit = this.payments.find(
      (p) =>
        p.requestId === requestId &&
        p.kind === 'deposit' &&
        p.status === 'done' &&
        !this.refunds.some((f) => f.paymentId === p.id),
    )
    if (deposit) {
      this.refundSeq += 1
      this.refunds.push({
        id: `RF-${String(this.refundSeq).padStart(4, '0')}`,
        requestId,
        paymentId: deposit.id,
        amount: deposit.amount,
        deduction: 0,
        afterVisit: false,
        reason: `파트너 철회 — 전액 환불 (${why})`,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
    }
    this.partnerCancelSeq += 1
    this.cancelLog.push({
      id: `PC-${String(this.partnerCancelSeq).padStart(4, '0')}`,
      requestId,
      partnerId,
      reason: why,
      date: today,
    })
    const label = this.reqLabel(requestId)
    const deadline = this.store.get(requestId)?.bidDeadline ?? today
    this.notify(
      'customer',
      `파트너 사정으로 낙찰이 철회되었습니다 — ${label}. 다시 입찰을 받습니다 (마감 ${deadline})${deposit ? ' · 예약금은 전액 환불 대기' : ''}`,
      requestId,
    )
    this.notify('admin', `파트너 낙찰 철회 — ${label} (${partnerId}: ${why})`, requestId)
    for (const bidder of others)
      this.notify('partner', `재오픈 — ${label}: 낙찰 파트너 철회로 견적이 다시 검토됩니다`, requestId, bidder)
    this.save()
    return this.mustGet(requestId)
  }

  /** 파트너 철회 기록 (28-50-01) — 파트너 지정 시 그 파트너만, 최신순 */
  partnerCancels(partnerId?: string): PartnerCancel[] {
    return this.cancelLog
      .filter((c) => partnerId === undefined || c.partnerId === partnerId)
      .map((c) => ({ ...c }))
      .reverse()
  }

  /** 최근 sinceDays일 내 철회 횟수 (28-50-02) */
  /** 낙찰 전 입찰 철회 기록 (28-62-02) — 파트너 지정 시 그 파트너만, 최신순 */
  bidWithdrawals(partnerId?: string): BidWithdrawal[] {
    return this.bidWithdrawalLog
      .filter((w) => partnerId === undefined || w.partnerId === partnerId)
      .map((w) => ({ ...w }))
      .reverse()
  }

  /** 최근 n일 입찰 철회 횟수 (28-62-02) — partnerCancelCount와 같은 창·같은 모양 */
  bidWithdrawalCount(
    partnerId: string,
    sinceDays: number = PARTNER_CANCEL_WINDOW_DAYS,
    today: string = todayUTC(),
  ): number {
    const from = addDays(today, -sinceDays)
    return this.bidWithdrawalLog.filter((w) => w.partnerId === partnerId && w.at.slice(0, 10) >= from).length
  }

  partnerCancelCount(
    partnerId: string,
    sinceDays: number = PARTNER_CANCEL_WINDOW_DAYS,
    today: string = todayUTC(),
  ): number {
    return this.cancelLog.filter(
      (c) => c.partnerId === partnerId && c.date <= today && daysBetween(c.date, today) <= sinceDays,
    ).length
  }

  updateProfile(input: PartnerProfile, partnerId: string = PlatformService.LEGACY_PARTNER_ID): PartnerProfile {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      throw new PlatformError('업체명은 필수입니다')
    }
    // 28-46-01: 전문 분야 토큰은 서비스 카테고리 목록에 있어야 매칭에 쓸 수 있다 (28-92: 옛 라벨은 옮긴다)
    const specialties: RepairCategory[] = []
    for (const tok of parseTokens(input.specialties)) {
      const c = normalizeCategory(tok)
      if (c === undefined) throw new PlatformError(`알 수 없는 전문 분야: ${tok}`)
      if (!specialties.includes(c)) specialties.push(c)
    }
    const profile: PartnerProfile = {
      name: input.name.trim(),
      specialties: specialties.join(', '),
      region: input.region.trim(),
      intro: input.intro.trim(),
    }
    this.profiles.set(partnerId, profile)
    this.save()
    return { ...profile }
  }

  /**
   * 시공 완료 처리: in_progress → completed 전이와 함께 정산 대상을 생성한다.
   * 최종 총액 = 낙찰 견적 총액 + 승인된 추가 작업 합계이고,
   * 수수료는 최종 총액 기준으로 재산정한다 (28-6-02).
   */
  completeJob(requestId: string, completedDate?: string): CompletedJob {
    this.mustGet(requestId)
    const stored = this.primaryBid(requestId)
    if (!stored) {
      throw new PlatformError(`견적 없이 완료할 수 없습니다: ${requestId}`)
    }
    const date = completedDate ?? todayUTC()
    assertValidDateStr(date, 'completedDate')
    const extras = this.extraWorks.filter((e) => e.requestId === requestId)
    const pending = extras.filter((e) => e.status === 'pending')
    if (pending.length > 0) {
      throw new PlatformError(
        `고객이 결정하지 않은 추가 작업이 ${pending.length}건 있습니다 — 승인/거절 후 완료하세요: ${requestId}`,
      )
    }
    // 28-96: 계약 경로 작업은 전/후 사진이 증빙이다 — 각 1장 이상 없으면 완료할 수 없다 (계약 없는 구 경로는 종전대로)
    if (this.acceptedContract(requestId)) {
      const r = this.mustGet(requestId)
      if (!r.beforePhotos?.length || !r.completionPhotos?.length)
        throw new PlatformError('작업 전 사진과 완료 사진을 각각 1장 이상 올려야 완료할 수 있습니다')
    }
    // 전이 규칙 검증이 먼저 — 실패하면 job이 생기지 않는다
    this.store.updateStatus(requestId, 'completed')
    const extraTotal = extras
      .filter((e) => (e.status ?? 'approved') === 'approved')
      .reduce((sum, e) => sum + e.amount, 0)
    const total = stored.breakdown.total + extraTotal
    const job: CompletedJob = {
      requestId,
      partnerId: stored.estimate.partnerId,
      completedDate: date,
      total,
      // 28-95: 수수료는 계약의 bps(없으면 기본 3%) — 추가 작업까지 같은 율
      platformFee: Math.round((total * this.commissionBpsFor(requestId)) / 10000),
      extraTotal,
      settled: false,
    }
    this.jobs.push(job)
    this.notify(
      'customer',
      `작업이 완료되었습니다 — 최종 결제를 진행해 주세요 (${this.reqLabel(requestId)})`,
      requestId,
    )
    this.save()
    return { ...job }
  }

  /** 정산 확정: completed → settled 전이 + 해당 job에 정산 표시 (28-3-03) */
  settle(requestId: string): RepairRequest {
    // 28-28-01 상용 불변식: 고객의 최종 결제 없이는 정산할 수 없다
    // (완료 상태가 아닌 전이 위반은 아래 updateStatus의 InvalidTransitionError가 담당)
    if (this.mustGet(requestId).status === 'completed' && !this.hasPaid(requestId, 'final')) {
      throw new PlatformError('고객 결제 완료 후 정산할 수 있습니다')
    }
    // 28-90: 분쟁이 열려 있으면 정산을 확정하지 않는다 — 해결 뒤 다시 시도한다
    if (this.hasOpenClaim(requestId))
      throw new PlatformError('분쟁 검토 중인 거래는 정산할 수 없습니다 — 해결 처리 뒤 다시 시도하세요')
    // 28-97: 환불이 처리 대기 중이면 지급액이 정해지지 않았다 — 환불 완료 뒤 확정한다
    if (this.pendingRefundAmount(requestId) > 0)
      throw new PlatformError('환불 대기 중인 거래는 정산할 수 없습니다 — 환불 처리 뒤 다시 시도하세요')
    const result = this.store.updateStatus(requestId, 'settled')
    const job = this.jobs.find((j) => j.requestId === requestId)
    if (job) job.settled = true
    this.save()
    return result
  }

  /**
   * 지급 완료 (28-38-01): 정산 확정(settled) 건만, 파트너 정산 계좌 필수, 중복 지급 거부 → 파트너 알림.
   *
   * 28-67-01: 계좌 표기를 **한 덩어리 문자열이 아니라 두 벌로** 받는다(`domain/auth`의 `payoutAccountLabels`).
   * `label`은 운영 내부 기록·알림용(예금주 실명 포함), `masked`는 파일로 나가는 산출물용이다.
   * 문자열 하나만 받던 때는 호출부가 어느 쪽인지 고를 수 없어 실명이 열람권 JSON까지 따라갔다.
   */
  markPayout(
    requestId: string,
    account: { label: string; masked: string; verified?: boolean } | string | undefined,
  ): CompletedJob {
    const job = this.jobs.find((j) => j.requestId === requestId)
    if (!job) throw new PlatformError(`완료 작업이 없습니다: ${requestId}`)
    if (!job.settled) throw new PlatformError('정산 확정 후 지급할 수 있습니다')
    if (job.payout) throw new PlatformError(`이미 지급된 작업입니다 (${job.payout.paidAt.slice(0, 10)})`)
    // 28-90: 분쟁이 열려 있으면 지급을 보류한다 — 이미 지급된 것은 되돌리지 않는다(기록만 남는다)
    if (this.hasOpenClaim(requestId))
      throw new PlatformError('분쟁 검토 중인 거래는 지급할 수 없습니다 — 해결 처리 뒤 다시 시도하세요')
    // 28-97: 환불 대기 중이면 지급액이 아직 정해지지 않았다
    if (this.pendingRefundAmount(requestId) > 0)
      throw new PlatformError('환불 대기 중인 거래는 지급할 수 없습니다 — 환불 처리 뒤 지급액이 다시 산정됩니다')
    // 문자열도 받아 준다 — 그 경우 마스킹본을 만들 수 없으므로 산출물에서 계좌 표기가 빠진다
    const label = (typeof account === 'string' ? account : account?.label) ?? ''
    const masked = typeof account === 'string' ? undefined : account?.masked
    if (label.trim() === '') throw new PlatformError('정산 계좌가 등록되지 않은 파트너입니다')
    // 28-90: 관리자 인증을 거치지 않은 계좌에는 지급하지 않는다
    if (typeof account !== 'string' && account?.verified === false) {
      throw new PlatformError('인증되지 않은 정산 계좌입니다 — 예금주·계좌를 확인하고 계좌 인증을 기록한 뒤 지급하세요')
    }
    // 28-97: 지급액 = 총액 − 환불 − 수수료. 근거(환불 누계·수수료)를 기록에 함께 남긴다
    const amount = PlatformService.payableOf(job)
    job.payout = {
      paidAt: new Date().toISOString(),
      amount,
      ...(job.refunded !== undefined && job.refunded > 0 ? { refunded: job.refunded } : {}),
      fee: job.platformFee,
      account: label.trim(),
      ...(masked !== undefined && masked.trim() !== '' ? { accountMasked: masked.trim() } : {}),
    }
    this.notify(
      'partner',
      `정산금 지급 완료 — ${this.reqLabel(requestId)} · ${amount.toLocaleString('ko-KR')}원 (${job.payout.account})`,
      requestId,
    )
    this.record('admin', '지급 완료', requestId, `${amount.toLocaleString('ko-KR')}원 · ${job.payout.account}`)
    this.save()
    return { ...job, payout: { ...job.payout } }
  }

  /** 진행 중 거래 수 (28-39-01): 수락~시공 중, 또는 완료됐지만 최종 결제 전 — 탈퇴 차단 근거 */
  openTransactionCount(customerId: string): number {
    return this.store.list().filter((r) => {
      if (r.customerId !== customerId) return false
      if (['accepted', 'scheduled', 'in_progress'].includes(r.status)) return true
      if (r.status === 'cancelled' && this.refunds.some((f) => f.requestId === r.id && f.status === 'pending'))
        return true
      return r.status === 'completed' && !this.hasPaid(r.id, 'final')
    }).length
  }

  /** 파트너 진행 중 작업·지급 대기 존재 여부 (28-39-01) — 단일 파트너 시연 구조 */
  partnerHasOpenWork(partnerId?: string): boolean {
    const open = this.store
      .list()
      .some(
        (r) =>
          (partnerId === undefined || this.partnerOf(r.id) === partnerId) &&
          (['accepted', 'scheduled', 'in_progress'].includes(r.status) ||
            (r.status === 'completed' && !this.hasPaid(r.id, 'final'))),
      )
    return open || this.pendingPayouts().some((j) => partnerId === undefined || j.partnerId === partnerId)
  }

  /** 고객 비식별화 (28-39-01): 탈퇴 고객의 요청 표시명을 치환 — 거래·결제 기록 자체는 보존 */
  anonymizeCustomer(customerId: string): number {
    const n = this.store.anonymizeCustomer(customerId)
    if (n > 0) this.save()
    return n
  }

  /** 환불 처리 (28-45-01): 관리자 — 차감액 ≤ 금액, 완료 시 고객 알림(+차감분 있으면 파트너 알림) */
  settleRefund(refundId: string, input: { deduction?: number; reason?: string } = {}): Refund {
    const refund = this.refunds.find((r) => r.id === refundId)
    if (!refund) throw new PlatformError(`환불 건이 없습니다: ${refundId}`)
    if (refund.status === 'done') throw new PlatformError(`이미 환불 처리된 건입니다 (${refund.doneAt?.slice(0, 10)})`)
    const deduction = input.deduction ?? 0
    if (!Number.isInteger(deduction) || deduction < 0)
      throw new PlatformError(`차감액은 0 이상의 정수(원)여야 합니다: ${deduction}`)
    if (deduction > refund.amount)
      throw new PlatformError(`차감액이 예약금(${refund.amount.toLocaleString('ko-KR')}원)을 넘을 수 없습니다`)
    if (deduction > 0 && !refund.afterVisit)
      throw new PlatformError('방문 전 취소는 전액 환불입니다 — 차감할 수 없습니다')
    if (deduction > 0 && (input.reason ?? '').trim() === '') throw new PlatformError('차감 사유를 입력하세요')
    refund.deduction = deduction
    if ((input.reason ?? '').trim() !== '') refund.reason = input.reason!.trim()
    refund.status = 'done'
    refund.doneAt = new Date().toISOString()
    const net = refund.amount - deduction
    // 28-97: 완료 작업의 환불이면 수수료를 (총액 − 환불) 기준으로 다시 산정한다 — 지급액 = 총액 − 환불 − 수수료
    const job = this.jobs.find((j) => j.requestId === refund.requestId)
    if (job) {
      job.refunded = (job.refunded ?? 0) + net
      job.platformFee = Math.round(((job.total - job.refunded) * this.commissionBpsFor(refund.requestId)) / 10000)
    }
    this.notify(
      'customer',
      `${this.payments.find((p) => p.id === refund.paymentId)?.kind === 'deposit' ? '예약금 ' : ''}환불 완료 — ${net.toLocaleString('ko-KR')}원${deduction > 0 ? ` (실비 ${deduction.toLocaleString('ko-KR')}원 차감: ${refund.reason})` : ''} (${this.reqLabel(refund.requestId)})`,
      refund.requestId,
    )
    if (deduction > 0) {
      const partnerId = this.partnerOf(refund.requestId)
      if (partnerId)
        this.notify(
          'partner',
          `취소 실비 ${deduction.toLocaleString('ko-KR')}원 정산 예정 — ${this.reqLabel(refund.requestId)}`,
          refund.requestId,
          partnerId,
        )
    }
    this.record(
      'admin',
      '환불 완료',
      refundId,
      `${refund.requestId} · ${net.toLocaleString('ko-KR')}원${deduction > 0 ? ` (차감 ${deduction.toLocaleString('ko-KR')}원)` : ''}`,
    )
    this.save()
    return { ...refund }
  }

  /** 요청의 환불 — 여러 건(파트너 철회 후 고객 취소 등)이면 최신 건 (28-50-01) */
  /** 28-97: 부분 환불 사유 최소 길이 */
  static readonly REFUND_REASON_MIN = 2

  /**
   * 부분 환불 등록 (28-97, 참고 v12 `refund`): 관리자가 **완료·정산 거래(지급 전)** 에 환불을 건다.
   * 결제가 있는 것(최종 결제 → 없으면 예약금) 하나에 걸리고, 그 결제의 남은 금액을 넘지 못한다.
   * 등록되면 환불 대기 → `settleRefund`로 완료되고, 완료될 때 수수료·지급액이 다시 산정된다.
   * 대기 중에는 정산 확정·지급이 보류된다. 결제사 환불 호출은 `api/payments`(서버)의 일이다.
   */
  requestRefund(requestId: string, input: { amount: number; reason: string }): Refund {
    this.mustGet(requestId)
    const job = this.jobs.find((j) => j.requestId === requestId)
    if (!job) throw new PlatformError('완료된 거래에만 부분 환불을 등록할 수 있습니다')
    if (job.payout) throw new PlatformError('이미 지급된 거래는 환불을 등록할 수 없습니다 — 별도 정산으로 처리하세요')
    if (this.pendingRefundAmount(requestId) > 0) throw new PlatformError('처리 대기 중인 환불이 있습니다')
    if (!Number.isInteger(input.amount) || input.amount <= 0)
      throw new PlatformError('환불 금액은 1 이상의 정수(원)여야 합니다')
    const reason = input.reason.trim()
    if (reason.length < PlatformService.REFUND_REASON_MIN)
      throw new PlatformError(`환불 사유를 ${PlatformService.REFUND_REASON_MIN}자 이상 적으세요`)
    const target = this.paymentFor(requestId, 'final') ?? this.paymentFor(requestId, 'deposit')
    if (!target) throw new PlatformError('환불할 결제가 없습니다')
    const remaining = target.amount - this.refundedOn(target.id)
    if (input.amount > remaining)
      throw new PlatformError(`환불 가능 금액(${remaining.toLocaleString('ko-KR')}원)을 넘을 수 없습니다`)
    this.refundSeq += 1
    const refund: Refund = {
      id: `RF-${String(this.refundSeq).padStart(4, '0')}`,
      requestId,
      paymentId: target.id,
      amount: input.amount,
      deduction: 0,
      afterVisit: false,
      reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    this.refunds.push(refund)
    this.notify(
      'customer',
      `환불 등록 — ${input.amount.toLocaleString('ko-KR')}원 (${reason}) · 처리되면 알려 드립니다 (${this.reqLabel(requestId)})`,
      requestId,
    )
    this.record('admin', '환불 등록', requestId, `${input.amount.toLocaleString('ko-KR')}원 · ${reason}`)
    this.save()
    return { ...refund }
  }

  /** 한 결제에 걸린 환불 금액 합(대기 포함) — 남은 환불 가능액의 근거 */
  private refundedOn(paymentId: string): number {
    return this.refunds.filter((f) => f.paymentId === paymentId).reduce((sum, f) => sum + f.amount, 0)
  }

  /** 환불이 결제를 다 덮었는가 — 취소·철회의 전액 환불이 여기에 해당하고, 부분 환불은 결제를 살려 둔다 (28-97) */
  private fullyRefunded(payment: Payment): boolean {
    return this.refundedOn(payment.id) >= payment.amount
  }

  /** 처리 대기 중인 환불 금액 합 (28-97) — 0이 아니면 정산·지급이 보류된다 */
  private pendingRefundAmount(requestId: string): number {
    return this.refunds
      .filter((f) => f.requestId === requestId && f.status === 'pending')
      .reduce((sum, f) => sum + f.amount, 0)
  }

  /** 지급액 = 총액 − 환불 누계 − 수수료 (28-97). 화면과 도메인이 같은 식을 쓴다 */
  static payableOf(job: Pick<CompletedJob, 'total' | 'platformFee' | 'refunded'>): number {
    return job.total - (job.refunded ?? 0) - job.platformFee
  }

  /** 정산 내역 (28-97, 참고 v12 `settlements`): 총액·환불·수수료·지급액 — 완료 기록이 없으면 undefined */
  settlementFor(
    requestId: string,
  ): { gross: number; refunded: number; pendingRefund: number; fee: number; bps: number; payable: number } | undefined {
    const job = this.jobs.find((j) => j.requestId === requestId)
    if (!job) return undefined
    return {
      gross: job.total,
      refunded: job.refunded ?? 0,
      pendingRefund: this.pendingRefundAmount(requestId),
      fee: job.platformFee,
      bps: this.commissionBpsFor(requestId),
      payable: PlatformService.payableOf(job),
    }
  }

  /** 이 거래의 환불 전체 (28-97) — 등록순. 부분 환불이 여러 건일 수 있다 */
  refundsFor(requestId: string): Refund[] {
    return this.refunds.filter((r) => r.requestId === requestId).map((r) => ({ ...r }))
  }

  refundFor(requestId: string): Refund | undefined {
    const mine = this.refunds.filter((x) => x.requestId === requestId)
    const r = mine[mine.length - 1]
    return r ? { ...r } : undefined
  }

  pendingRefunds(): Refund[] {
    return this.refunds
      .filter((r) => r.status === 'pending')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => ({ ...r }))
  }

  /** 파트너 표시명 (28-47-01): 프로필명(id) — 프로필 없으면 id */
  private partnerLabel(partnerId: string): string {
    const name = this.profiles.get(partnerId)?.name
    return name ? `${name}(${partnerId})` : partnerId
  }

  /** 건별 원장 (28-47-01): 결제·환불·지급·수수료를 날짜순으로. month(YYYY-MM) 생략 시 전체 */
  ledger(month?: string): LedgerRow[] {
    const rows: LedgerRow[] = []
    const label = (id: string) => this.store.get(id)?.customerName ?? id
    for (const p of this.payments) {
      if (p.status !== 'done') continue // 28-97: 준비·실패 주문은 돈이 오가지 않았다
      rows.push({
        date: p.paidAt.slice(0, 10),
        type: p.kind === 'deposit' ? '예약금' : '최종결제',
        requestId: p.requestId,
        counterparty: label(p.requestId),
        amount: p.amount,
        ref: p.receiptNo,
        memo: p.method === 'card' ? '카드' : '계좌이체',
      })
    }
    for (const r of this.refunds) {
      if (r.status !== 'done' || !r.doneAt) continue
      rows.push({
        date: r.doneAt.slice(0, 10),
        type: '환불',
        requestId: r.requestId,
        counterparty: label(r.requestId),
        amount: -(r.amount - r.deduction),
        ref: r.id,
        memo: r.deduction > 0 ? `실비 차감 ${r.deduction} · ${r.reason}` : r.reason,
      })
    }
    for (const j of this.jobs) {
      if (j.settled) {
        rows.push({
          date: j.completedDate,
          type: '플랫폼수수료',
          requestId: j.requestId,
          counterparty: this.partnerLabel(j.partnerId),
          amount: j.platformFee,
          ref: `JOB-${j.requestId}`,
          // 28-97: 수수료 기준액 = 총액 − 환불, 요율은 계약의 bps (28-95) — "총액의 3%"로 굳어 있던 문구를 실제 값으로
          memo: `정산 기준 ${(j.total - (j.refunded ?? 0)).toLocaleString('ko-KR')}원의 ${this.commissionBpsFor(j.requestId) / 100}%${
            (j.refunded ?? 0) > 0 ? ` (환불 ${(j.refunded ?? 0).toLocaleString('ko-KR')}원 반영)` : ''
          }`,
        })
      }
      if (j.payout) {
        rows.push({
          date: j.payout.paidAt.slice(0, 10),
          type: '파트너지급',
          requestId: j.requestId,
          counterparty: this.partnerLabel(j.partnerId),
          amount: -j.payout.amount,
          ref: j.payout.account,
          memo: '정산 지급',
        })
      }
    }
    return rows
      .filter((r) => month === undefined || r.date.startsWith(month))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.requestId.localeCompare(b.requestId) || a.type.localeCompare(b.type),
      )
  }

  /** 원장이 있는 월 목록 (최신순) */
  ledgerMonths(): string[] {
    return [...new Set(this.ledger().map((r) => r.date.slice(0, 7)))].sort((a, b) => b.localeCompare(a))
  }

  /** 월 요약 (28-47-01): 입금(결제)·출금(환불+지급)·수수료·순액 */
  ledgerSummary(month?: string): LedgerSummary {
    const rows = this.ledger(month)
    let inflow = 0
    let outflow = 0
    let fee = 0
    for (const r of rows) {
      if (r.type === '플랫폼수수료') fee += r.amount
      else if (r.amount >= 0) inflow += r.amount
      else outflow += -r.amount
    }
    return { month: month ?? '전체', inflow, outflow, fee, net: inflow - outflow, rows: rows.length }
  }

  /** 파트너 정산 내역 (28-47-03): 내 완료 작업의 총액·수수료·지급액·지급 상태 */
  partnerLedger(partnerId: string): Array<{
    requestId: string
    completedDate: string
    total: number
    fee: number
    payout: number
    settled: boolean
    paidAt: string
    account: string
  }> {
    return this.completedJobsOf(partnerId).map((j) => ({
      requestId: j.requestId,
      completedDate: j.completedDate,
      total: j.total,
      fee: j.platformFee,
      payout: PlatformService.payableOf(j),
      settled: j.settled,
      paidAt: j.payout?.paidAt.slice(0, 10) ?? '',
      // 28-67-01: CSV는 파일로 나간다 — 예금주 실명이 든 `account`가 아니라 마스킹본을 쓴다(열람권 JSON과 같은 값)
      account: j.payout?.accountMasked ?? '',
    }))
  }

  /** 지급 대기 작업 (28-38-01): 정산 확정됐지만 아직 지급되지 않은 건, 완료일 오름차순 */
  pendingPayouts(): CompletedJob[] {
    return this.jobs
      .filter((j) => j.settled && !j.payout)
      .sort((a, b) => a.completedDate.localeCompare(b.completedDate))
      .map((j) => ({ ...j }))
  }

  /** 지급 완료 작업 (28-38-01): 최근 지급순 */
  paidPayouts(): CompletedJob[] {
    return this.jobs
      .filter((j) => j.payout !== undefined)
      .sort((a, b) => b.payout!.paidAt.localeCompare(a.payout!.paidAt))
      .map((j) => ({ ...j, payout: { ...j.payout! } }))
  }

  /** 지급 대기 금액 합계 (28-38-01) */
  pendingPayoutAmount(): number {
    return this.pendingPayouts().reduce((sum, j) => sum + PlatformService.payableOf(j), 0)
  }

  /** 완료 작업 조회 (파트너 정산 탭 행 표시용) */
  jobFor(requestId: string): CompletedJob | undefined {
    const job = this.jobs.find((j) => j.requestId === requestId)
    return job ? { ...job, ...(job.payout ? { payout: { ...job.payout } } : {}) } : undefined
  }

  // ── 결제 (28-28-01, 시안 "결제 및 예약") ──
  // 상용 전환 시 이 두 메서드의 몸통이 PG 승인 콜백(서버)으로 대체된다.
  // 도메인 규칙(상태 제약·금액 산정·중복 방지·영수증 발번)은 그대로 유지된다.

  /** 결제 상태 목록 (28-97) — 스냅샷 검증과 같은 집합 */
  static readonly PAYMENT_STATUSES: readonly PaymentStatus[] = ['ready', 'done', 'failed']

  /**
   * 결제 준비 (28-97, 참고 v12 `payments.READY`): 금액은 도메인이 정하고 **주문번호(멱등 키)** 를 발급한다.
   * 결제창은 이 주문번호와 금액으로 열리고, 승인은 `confirmPayment(orderId, …)`로 돌아온다.
   * 같은 요청·종류·금액·수단의 준비가 이미 열려 있으면 그것을 돌려준다(결제창을 다시 열어도 주문이 늘지 않는다);
   * 금액이나 수단이 달라졌으면 옛 주문을 실패로 닫고 새로 발급한다.
   */
  preparePayment(requestId: string, kind: PaymentKind, method: PaymentMethod): Payment {
    this.assertPayMethod(method)
    const amount = kind === 'deposit' ? this.depositDue(requestId) : this.finalDue(requestId)
    const open = this.payments.find((p) => p.requestId === requestId && p.kind === kind && p.status === 'ready')
    if (open) {
      if (open.amount === amount && open.method === method) return { ...open }
      open.status = 'failed'
      open.failReason = '금액·수단이 바뀌어 새 주문으로 대체'
    }
    this.paymentSeq += 1
    const seq = String(this.paymentSeq).padStart(4, '0')
    const payment: Payment = {
      id: `PAY-${seq}`,
      orderId: `BD-${requestId}-${kind}-${seq}`,
      requestId,
      kind,
      amount,
      method,
      receiptNo: `RCT-${seq}`,
      paidAt: new Date().toISOString(),
      status: 'ready',
    }
    this.payments.push(payment)
    this.save()
    return { ...payment }
  }

  /**
   * 결제 승인 (28-97): 결제사(또는 기록 결제)의 승인 키와 금액으로 준비된 주문을 done으로 만든다.
   * **멱등**: 같은 주문에 같은 키로 다시 오면 같은 결제를 돌려준다(네트워크 재시도·새로고침). 다른 키·다른 금액·
   * 실패한 주문·다른 주문에 쓰인 키는 거부한다. 준비 뒤 거래가 바뀌어 규칙이 더는 맞지 않으면(예: 취소) 주문을
   * 실패로 닫고 거부한다 — 결제사 승인이 났다면 그 돈은 결제사 쪽에서 취소해야 한다(§C 문서).
   */
  confirmPayment(orderId: string, input: { providerKey: string; amount: number }): Payment {
    const payment = this.payments.find((p) => p.orderId === orderId)
    if (!payment) throw new PlatformError(`주문번호를 찾을 수 없습니다: ${orderId}`)
    const key = input.providerKey.trim()
    if (key === '') throw new PlatformError('승인 키가 비어 있습니다')
    if (payment.status === 'done') {
      if (payment.providerKey === key) return { ...payment }
      throw new PlatformError('이미 다른 승인 키로 승인된 주문입니다')
    }
    if (payment.status === 'failed')
      throw new PlatformError(`실패한 주문입니다 (${payment.failReason ?? '사유 없음'}) — 결제를 다시 준비하세요`)
    if (!Number.isInteger(input.amount) || input.amount !== payment.amount)
      throw new PlatformError(
        `결제 금액 불일치 — 주문 ${payment.amount.toLocaleString('ko-KR')}원, 승인 ${String(input.amount)}원`,
      )
    if (this.payments.some((p) => p !== payment && p.providerKey === key))
      throw new PlatformError('이미 다른 주문에 쓰인 승인 키입니다')
    // 준비 뒤 거래가 바뀌었을 수 있다 — 지금도 같은 금액이 청구되는지 다시 본다
    let due: number
    try {
      due = payment.kind === 'deposit' ? this.depositDue(payment.requestId) : this.finalDue(payment.requestId)
      if (due !== payment.amount) throw new PlatformError('청구 금액이 바뀌었습니다')
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      payment.status = 'failed'
      payment.failReason = why
      this.save()
      throw new PlatformError(`승인할 수 없습니다 — ${why}`)
    }
    payment.status = 'done'
    payment.providerKey = key
    payment.paidAt = new Date().toISOString()
    const amount = payment.amount
    const requestId = payment.requestId
    if (payment.kind === 'deposit')
      this.notify(
        'partner',
        `예약금 ${amount.toLocaleString('ko-KR')}원 결제됨 — ${this.reqLabel(requestId)}`,
        requestId,
      )
    else {
      this.notify('partner', `최종 결제 완료 ${amount.toLocaleString('ko-KR')}원 — 정산할 수 있습니다`, requestId)
      this.notify(
        'admin',
        `결제 완료 ${payment.receiptNo} · ${amount.toLocaleString('ko-KR')}원 (${this.reqLabel(requestId)})`,
        requestId,
      )
    }
    this.save()
    return { ...payment }
  }

  /** 결제 실패 기록 (28-97): 결제창 닫힘·결제사 거절. 승인된 주문은 실패로 되돌리지 않는다. 실패 재기록은 멱등 */
  failPayment(orderId: string, reason: string): Payment {
    const payment = this.payments.find((p) => p.orderId === orderId)
    if (!payment) throw new PlatformError(`주문번호를 찾을 수 없습니다: ${orderId}`)
    if (payment.status === 'done') throw new PlatformError('이미 승인된 주문은 실패로 바꿀 수 없습니다')
    if (payment.status === 'failed') return { ...payment }
    payment.status = 'failed'
    payment.failReason = reason.trim() === '' ? '결제 실패' : reason.trim()
    this.save()
    return { ...payment }
  }

  /** 승인된 결제가 있는가 (28-97) — 준비·실패 주문은 결제가 아니다 */
  private hasPaid(requestId: string, kind: PaymentKind): boolean {
    return this.payments.some((p) => p.requestId === requestId && p.kind === kind && p.status === 'done')
  }

  private assertPayMethod(method: PaymentMethod) {
    if (method !== 'card' && method !== 'transfer') {
      throw new PlatformError(`알 수 없는 결제 수단: ${String(method)}`)
    }
  }

  /** 지금 청구되는 예약금 (28-97에서 `payDeposit`의 규칙을 분리) — 낼 수 없으면 던진다 */
  private depositDue(requestId: string): number {
    const request = this.mustGet(requestId)
    if (this.paymentFor(requestId, 'deposit')) {
      throw new PlatformError('이미 예약금이 결제되었습니다')
    }
    const stored = this.primaryBid(requestId)
    if (!stored) throw new PlatformError('견적이 없는 요청에는 예약금을 결제할 수 없습니다')
    // 28-95: 계약이 동의됐으면 예약금은 계약의 금액이고 방문 예정(scheduled)에서 낸다. 계약이 없는 구 경로는 낙찰 상태에서 10%.
    const contract = this.acceptedContract(requestId)
    if (contract) {
      if (contract.deposit === 0) throw new PlatformError('예약금이 없는 계약입니다')
      if (request.status !== 'scheduled' && request.status !== 'accepted')
        throw new PlatformError(`예약금은 계약 동의 뒤 방문 전에 결제합니다 (${request.status})`)
      return contract.deposit
    }
    if (request.status !== 'accepted') {
      throw new PlatformError('예약금은 낙찰(accepted) 상태에서 결제할 수 있습니다')
    }
    return Math.max(10_000, Math.floor(stored.breakdown.total / 10))
  }

  /** 지금 청구되는 최종 결제액 (28-97) — 완료(completed) 상태에서만, 최종 금액 − 기결제 예약금 */
  private finalDue(requestId: string): number {
    const request = this.mustGet(requestId)
    if (request.status !== 'completed') {
      throw new PlatformError('최종 결제는 작업 완료(completed) 상태에서 할 수 있습니다')
    }
    if (this.paymentFor(requestId, 'final')) {
      throw new PlatformError('이미 결제가 완료되었습니다')
    }
    const job = this.jobs.find((j) => j.requestId === requestId)
    if (!job) throw new PlatformError('완료 기록이 없어 결제할 수 없습니다')
    const deposit = this.paymentFor(requestId, 'deposit')?.amount ?? 0
    return Math.max(0, job.total - deposit)
  }

  /** 기록 결제 (28-97): 결제사 없이 준비·승인을 한 번에 — 로컬 모드와 결제사 연결 전의 서버 모드가 쓴다 */
  private recordPayment(requestId: string, kind: PaymentKind, method: PaymentMethod): Payment {
    const prepared = this.preparePayment(requestId, kind, method)
    return this.confirmPayment(prepared.orderId, { providerKey: `local:${prepared.orderId}`, amount: prepared.amount })
  }

  /** 예약금 결제(기록) — 낙찰(accepted) 상태에서만, 낙찰가의 10%(최소 10,000원) 또는 계약 예약금, 중복 거부 */
  payDeposit(requestId: string, method: PaymentMethod): Payment {
    this.assertPayMethod(method)
    return this.recordPayment(requestId, 'deposit', method)
  }

  /** 예약금 예상액 (28-95): 동의된 계약이 있으면 그 금액, 없으면 낙찰가의 10%(최소 1만 원) */
  depositAmountFor(requestId: string): number {
    const contract = this.acceptedContract(requestId)
    if (contract) return contract.deposit
    const stored = this.primaryBid(requestId)
    return stored ? Math.max(10_000, Math.floor(stored.breakdown.total / 10)) : 0
  }

  /** 최종 결제(기록) — 작업 완료(completed) 상태에서만, 최종 금액 − 기결제 예약금, 중복 거부 */
  payFinal(requestId: string, method: PaymentMethod): Payment {
    this.assertPayMethod(method)
    return this.recordPayment(requestId, 'final', method)
  }

  /** 해당 거래의 결제 이력 — 결제순 */
  paymentsFor(requestId: string): Payment[] {
    return this.payments.filter((p) => p.requestId === requestId).map((p) => ({ ...p }))
  }

  // ── 인앱 알림 (28-35-01) ──

  private reqLabel(requestId: string): string {
    const r = this.store.get(requestId)
    return r ? `[${categoriesOf(r).join(' + ')}] ${r.description}` : requestId
  }

  /** 알림 생성 — 각 도메인 액션의 저장 직전에 호출 (저장은 호출부가 담당) */
  private notify(role: NotificationRole, text: string, requestId?: string, accountId?: string): void {
    this.notificationSeq += 1
    this.notifications.push({
      id: `NT-${String(this.notificationSeq).padStart(4, '0')}`,
      role,
      ...(requestId ? { requestId } : {}),
      ...(accountId ? { accountId } : {}),
      text,
      createdAt: new Date().toISOString(),
      read: false,
    })
  }

  /** 역할(+고객은 계정) 스코프 — 고객 알림은 자기 요청(customerId 일치)만 (28-33 스코프와 정합) */
  private inScope(n: AppNotification, role: NotificationRole, accountId?: string): boolean {
    if (n.role !== role) return false
    if (accountId === undefined || role === 'admin') return true
    // 28-42-01: 계정 범위가 명시된 알림은 그 계정에만
    if (n.accountId !== undefined) return n.accountId === accountId
    if (role === 'customer') {
      const r = n.requestId ? this.store.get(n.requestId) : undefined
      return r?.customerId === accountId
    }
    // 28-41-01: 파트너 알림은 요청의 견적 파트너 = 계정만 (요청 없는 알림은 전체 파트너)
    return n.requestId ? this.partnerOf(n.requestId) === accountId : true
  }

  /** 역할별 알림 — 최신순. 고객은 accountId를 주면 내 요청 알림만 */
  notificationsFor(role: NotificationRole, accountId?: string): AppNotification[] {
    return this.notifications
      .filter((n) => this.inScope(n, role, accountId))
      .map((n) => ({ ...n }))
      .reverse()
  }

  unreadNotificationCount(role: NotificationRole, accountId?: string): number {
    return this.notifications.filter((n) => this.inScope(n, role, accountId) && !n.read).length
  }

  /** 패널을 열면 스코프 내 전부 읽음 처리 */
  markAllNotificationsRead(role: NotificationRole, accountId?: string): void {
    let changed = false
    for (const n of this.notifications) {
      if (this.inScope(n, role, accountId) && !n.read) {
        n.read = true
        changed = true
      }
    }
    if (changed) this.save()
  }

  /** 시드 직후 호출 — 데모 시드가 만든 알림은 실제 이벤트가 아니므로 비운다 */
  clearNotifications(): void {
    if (this.notifications.length === 0) return
    this.notifications = []
    this.save()
  }

  /** 특정 종류의 결제 (없으면 undefined) */
  /** 유효 결제 (28-50-01): 환불(대기·완료)이 걸린 결제는 제외, 여러 건이면 최신 — 재낙찰 후 예약금 재결제를 허용한다 */
  paymentFor(requestId: string, kind: PaymentKind): Payment | undefined {
    // 28-97: 승인된(done) 결제만이 결제다. 전액 환불이 걸린 결제는 소진된 것이고, 부분 환불은 결제를 살려 둔다
    const live = this.payments.filter(
      (p) => p.requestId === requestId && p.kind === kind && p.status === 'done' && !this.fullyRefunded(p),
    )
    const found = live[live.length - 1]
    return found ? { ...found } : undefined
  }

  get completedJobs(): CompletedJob[] {
    return this.jobs.map((j) => ({ ...j }))
  }

  /**
   * 입찰 성과 지표 (28-11-03).
   * 낙찰률은 결정된 입찰(낙찰+미낙찰) 기준이며, 결정된 건이 없으면 null.
   * 입찰 후 취소된 건은 totalBids에만 포함된다.
   */
  bidStats(partnerId?: string): BidStats {
    let won = 0
    let lost = 0
    let pending = 0
    let totalBids = 0
    const WON = WON_STATUSES
    for (const r of this.store.list()) {
      const byPartner = this.bids.get(r.id)
      if (!byPartner || byPartner.size === 0) continue
      const bidders = partnerId === undefined ? [...byPartner.keys()] : byPartner.has(partnerId) ? [partnerId] : []
      for (const bidder of bidders) {
        totalBids += 1
        const st = this.statusFor(r.id, bidder)
        if (WON.includes(st)) won += 1
        else if (st === 'lost') lost += 1
        else if (st === 'estimated') pending += 1
      }
    }
    const decided = won + lost
    return {
      totalBids,
      won,
      lost,
      pending,
      winRate: decided === 0 ? null : Math.round((won / decided) * 100),
    }
  }

  /** 파트너×주차 정산 집계. filter로 정산 확정/미정산을 구분한다 (28-3-03). */
  settlements(filter: SettlementFilter = 'all', partnerId?: string): WeeklySettlement[] {
    const jobs = this.jobsOf(partnerId).filter((j) => filter === 'all' || j.settled === (filter === 'settled'))
    return weeklySettlements(jobs)
  }

  /** 파트너 범위 작업 (28-41-01) — partnerId 생략 시 전체 */
  private jobsOf(partnerId?: string): CompletedJob[] {
    return partnerId === undefined ? this.jobs : this.jobs.filter((j) => j.partnerId === partnerId)
  }

  /** 파트너의 완료 작업 (28-41-01) — 완료일 내림차순 */
  completedJobsOf(partnerId: string): CompletedJob[] {
    return this.jobsOf(partnerId)
      .slice()
      .sort((a, b) => b.completedDate.localeCompare(a.completedDate))
      .map((j) => ({ ...j, ...(j.payout ? { payout: { ...j.payout } } : {}) }))
  }

  /** 미정산 지급 예정 합계 (정수 원) — partnerId 생략 시 전체 */
  unsettledPayout(partnerId?: string): number {
    return this.jobsOf(partnerId)
      .filter((j) => !j.settled)
      .reduce((sum, j) => sum + PlatformService.payableOf(j), 0)
  }

  /** 스냅샷 문자열 파싱 + 형태 검증. 실패 시 PlatformError. */
  private static parseSnapshot(raw: string): PlatformSnapshot {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new PlatformError('백업 데이터가 올바른 JSON이 아닙니다')
    }
    const snap = parsed as PlatformSnapshot
    if (
      snap === null ||
      typeof snap !== 'object' ||
      snap.version !== 1 ||
      typeof snap.store !== 'object' ||
      !Array.isArray(snap.store?.requests) ||
      !Number.isInteger(snap.store?.seq) ||
      !Array.isArray(snap.estimates) ||
      !Array.isArray(snap.jobs) ||
      !Array.isArray(snap.slots) ||
      !Number.isInteger(snap.slotSeq)
    ) {
      throw new PlatformError('백업 데이터 형식이 올바르지 않습니다 (version 1 스냅샷이 아님)')
    }
    PlatformService.migrateLegacyCategories(snap)
    PlatformService.validateSnapshotElements(snap)
    return snap
  }

  /**
   * 28-92: 28-16~28-91의 카테고리 라벨(13개)을 카탈로그 라벨(20개)로 옮긴다 — 검증 **전에** 돈다.
   * 요청·패키지·질문·비활성 목록·파트너 전문 분야가 대상이다. 옮길 수 없는 값은 요청이면 "분야를 모르겠어요"로
   * 떨어뜨리고(요청을 잃지 않는다), 나머지(패키지·질문·비활성·전문 분야)는 버린다 — 그것은 운영 설정이라
   * 관리자가 다시 고르면 된다. 검증 단계가 '알 수 없는 카테고리'로 스냅샷 전체를 거절하지 않게 하는 것이 요지다.
   */
  private static migrateLegacyCategories(snap: PlatformSnapshot): void {
    const raw = snap as unknown as {
      store?: { requests?: Array<{ category?: unknown; categories?: unknown }> }
      packages?: Array<{ category?: unknown }>
      questions?: Array<{ category?: unknown }>
      settings?: { disabledCategories?: unknown }
      profiles?: Array<[string, { specialties?: unknown }]>
      profile?: { specialties?: unknown }
    }
    for (const r of raw.store?.requests ?? []) {
      if (r === null || typeof r !== 'object') continue
      r.category = normalizeCategory(r.category) ?? '분야를 모르겠어요'
      // 28-93: 분야 묶음도 옮긴다 — 옮길 수 없는 항목은 버리고, 주 분야가 첫 항목이 되게 한다
      if (Array.isArray(r.categories)) {
        const moved = [...new Set(r.categories.map(normalizeCategory).filter((c) => c !== undefined))]
        const rest = moved.filter((c) => c !== r.category)
        if (rest.length === 0) delete r.categories
        else r.categories = [r.category, ...rest]
      }
    }
    // #251 리뷰: null·비객체 행도 여기서 버린다 — 남겨 두면 바로 뒤 검증이 스냅샷 전체를 거절한다
    const keep = <T extends { category?: unknown }>(rows: T[]): T[] =>
      rows
        .filter((x): x is T => x !== null && typeof x === 'object')
        .map((x) => ({ ...x, category: normalizeCategory(x.category) }))
        .filter((x) => x.category !== undefined)
    if (Array.isArray(raw.packages)) raw.packages = keep(raw.packages)
    if (Array.isArray(raw.questions)) raw.questions = keep(raw.questions)
    if (raw.settings && Array.isArray(raw.settings.disabledCategories)) {
      raw.settings.disabledCategories = [
        ...new Set(raw.settings.disabledCategories.map(normalizeCategory).filter((c) => c !== undefined)),
      ]
    }
    const tokens = (v: unknown) =>
      typeof v === 'string'
        ? [
            ...new Set(
              parseTokens(v)
                .map(normalizeCategory)
                .filter((c) => c !== undefined),
            ),
          ].join(', ')
        : v
    for (const entry of raw.profiles ?? []) {
      const prof = entry?.[1]
      if (prof && typeof prof === 'object') prof.specialties = tokens(prof.specialties)
    }
    if (raw.profile && typeof raw.profile === 'object') raw.profile.specialties = tokens(raw.profile.specialties)
  }

  /** 요소 수준 검증 (28-5-02): 오염된 백업이 NaN 정산·불량 상태를 만들지 못하게 한다 */
  private static validateSnapshotElements(snap: PlatformSnapshot): void {
    const STATUSES: JobStatus[] = [
      'requested',
      'estimated',
      'accepted',
      'scheduled',
      'in_progress',
      'completed',
      'settled',
      'lost',
      'cancelled',
    ]
    const fail = (what: string): never => {
      throw new PlatformError(`백업 데이터 검증 실패: ${what}`)
    }
    snap.store.requests.forEach((r, i) => {
      if (typeof r?.id !== 'string' || r.id === '') fail(`requests[${i}].id`)
      if (!STATUSES.includes(r.status)) fail(`requests[${i}].status: ${String(r.status)}`)
      if (!isValidDateStr(r.desiredDate)) fail(`requests[${i}].desiredDate: ${String(r.desiredDate)}`)
      if (typeof r.customerName !== 'string' || typeof r.region !== 'string' || typeof r.description !== 'string') {
        fail(`requests[${i}] 텍스트 필드`)
      }
      if (r.budget !== undefined && (!Number.isInteger(r.budget) || r.budget < 0)) {
        fail(`requests[${i}].budget: ${String(r.budget)}`)
      }
      if (r.desiredTime !== undefined && r.desiredTime !== '오전' && r.desiredTime !== '오후') {
        fail(`requests[${i}].desiredTime: ${String(r.desiredTime)}`)
      }
      if (
        r.answers !== undefined &&
        (!Array.isArray(r.answers) ||
          r.answers.some(
            (a) => typeof a?.question !== 'string' || a.question.trim() === '' || typeof a?.answer !== 'string',
          ))
      ) {
        fail(`requests[${i}].answers`)
      }
      if (r.customerId !== undefined && (typeof r.customerId !== 'string' || r.customerId === '')) {
        fail(`requests[${i}].customerId`)
      }
      if (r.photos !== undefined) {
        if (!Array.isArray(r.photos)) fail(`requests[${i}].photos 형식`)
        try {
          validatePhotos(r.photos)
        } catch (err) {
          fail(`requests[${i}].photos: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (r.editCount !== undefined && (!Number.isInteger(r.editCount) || r.editCount < 1))
        fail(`requests[${i}].editCount`)
      if (r.editedAt !== undefined && typeof r.editedAt !== 'string') fail(`requests[${i}].editedAt`)
      if (r.rescheduleCount !== undefined && (!Number.isInteger(r.rescheduleCount) || r.rescheduleCount < 1))
        fail(`requests[${i}].rescheduleCount`)
      if (r.completionPhotos !== undefined) {
        if (!Array.isArray(r.completionPhotos)) fail(`requests[${i}].completionPhotos 형식`)
        try {
          validatePhotos(r.completionPhotos)
        } catch (err) {
          fail(`requests[${i}].completionPhotos: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (r.beforePhotos !== undefined) {
        if (!Array.isArray(r.beforePhotos)) fail(`requests[${i}].beforePhotos 형식`)
        try {
          validatePhotos(r.beforePhotos)
        } catch (err) {
          fail(`requests[${i}].beforePhotos: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (
        r.acceptedPartnerId !== undefined &&
        (typeof r.acceptedPartnerId !== 'string' || r.acceptedPartnerId === '')
      ) {
        fail(`requests[${i}].acceptedPartnerId`)
      }
      if (r.paymentReminderFor !== undefined && !isValidDateStr(r.paymentReminderFor)) {
        fail(`requests[${i}].paymentReminderFor`)
      }
      if (r.deadlineNotifiedFor !== undefined && !isValidDateStr(r.deadlineNotifiedFor)) {
        fail(`requests[${i}].deadlineNotifiedFor`)
      }
      if (r.budgetRange !== undefined && typeof r.budgetRange !== 'string') {
        fail(`requests[${i}].budgetRange`)
      }
      if (r.bidDeadline !== undefined && !isValidDateStr(r.bidDeadline)) {
        fail(`requests[${i}].bidDeadline: ${String(r.bidDeadline)}`)
      }
      // 28-94: 상세 주소·연락처
      if (r.address !== undefined && (typeof r.address !== 'string' || r.address.trim().length < ADDRESS_MIN))
        fail(`requests[${i}].address`)
      if (r.phone !== undefined && (typeof r.phone !== 'string' || !/^010\d{7,8}$/.test(r.phone)))
        fail(`requests[${i}].phone`)
      // 28-93: 분야 묶음·안전 답변·검토 결과
      if (r.categories !== undefined) {
        if (!Array.isArray(r.categories) || r.categories.length === 0) fail(`requests[${i}].categories 형식`)
        if (r.categories[0] !== r.category) fail(`requests[${i}].categories[0] ≠ category`)
        if (new Set(r.categories).size !== r.categories.length) fail(`requests[${i}].categories 중복`)
        r.categories.forEach((c, j) => {
          if (!ALL_CATEGORIES.includes(c)) fail(`requests[${i}].categories[${j}]: ${String(c)}`)
        })
      }
      if (r.safety !== undefined) {
        const sf = r.safety as unknown as Record<string, unknown> | null
        const boolOrNull = (v: unknown) => v === null || typeof v === 'boolean'
        if (
          sf === null ||
          typeof sf !== 'object' ||
          !boolOrNull(sf.isLocked) ||
          !boolOrNull(sf.urgent) ||
          typeof sf.ack !== 'boolean'
        )
          fail(`requests[${i}].safety`)
      }
      if (r.reviewStatus !== undefined && r.reviewStatus !== 'AUTO_PASS' && r.reviewStatus !== 'MANUAL_REVIEW')
        fail(`requests[${i}].reviewStatus: ${String(r.reviewStatus)}`)
      if (r.reviewFlags !== undefined) {
        if (!Array.isArray(r.reviewFlags)) fail(`requests[${i}].reviewFlags 형식`)
        r.reviewFlags.forEach((f, j) => {
          if (!['LOCKOUT', 'URGENT_SYMPTOM', 'WORK_SCOPE_REVIEW'].includes(f))
            fail(`requests[${i}].reviewFlags[${j}]: ${String(f)}`)
        })
      }
      if (r.review !== undefined) {
        const rv = r.review as unknown as Record<string, unknown> | null
        if (
          rv === null ||
          typeof rv !== 'object' ||
          typeof rv.at !== 'string' ||
          typeof rv.by !== 'string' ||
          rv.by === '' ||
          typeof rv.note !== 'string'
        )
          fail(`requests[${i}].review`)
      }
    })
    snap.estimates.forEach((entry, i) => {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1]?.estimate !== 'object') {
        fail(`estimates[${i}] 구조`)
      }
      try {
        validateEstimate(entry[1].estimate)
      } catch (err) {
        fail(`estimates[${i}]: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
    snap.jobs.forEach((j, i) => {
      if (typeof j?.requestId !== 'string' || typeof j.partnerId !== 'string') fail(`jobs[${i}] id`)
      if (!Number.isInteger(j.total) || j.total < 0) fail(`jobs[${i}].total: ${String(j.total)}`)
      if (!Number.isInteger(j.platformFee) || j.platformFee < 0)
        fail(`jobs[${i}].platformFee: ${String(j.platformFee)}`)
      if (!isValidDateStr(j.completedDate)) fail(`jobs[${i}].completedDate: ${String(j.completedDate)}`)
      if (typeof j.settled !== 'boolean') fail(`jobs[${i}].settled`)
      // 28-97: 환불 누계는 0 이상 총액 이하의 정수
      if (j.refunded !== undefined && (!Number.isInteger(j.refunded) || j.refunded < 0 || j.refunded > j.total))
        fail(`jobs[${i}].refunded: ${String(j.refunded)}`)
      if (j.payout !== undefined) {
        if (
          typeof j.payout?.paidAt !== 'string' ||
          !Number.isInteger(j.payout.amount) ||
          j.payout.amount < 0 ||
          typeof j.payout.account !== 'string' ||
          (j.payout.refunded !== undefined && (!Number.isInteger(j.payout.refunded) || j.payout.refunded < 0)) ||
          (j.payout.fee !== undefined && (!Number.isInteger(j.payout.fee) || j.payout.fee < 0))
        ) {
          fail(`jobs[${i}].payout`)
        }
        if (!j.settled) fail(`jobs[${i}].payout: 정산 확정 전 지급`)
      }
      if (j.extraTotal !== undefined && (!Number.isInteger(j.extraTotal) || j.extraTotal < 0)) {
        fail(`jobs[${i}].extraTotal: ${String(j.extraTotal)}`)
      }
    })
    snap.slots.forEach((s, i) => {
      if (typeof s?.id !== 'string' || typeof s.partnerId !== 'string' || typeof s.requestId !== 'string') {
        fail(`slots[${i}] id`)
      }
      if (s.remindedFor !== undefined && !isValidDateStr(s.remindedFor)) fail(`slots[${i}].remindedFor`)
      try {
        validateSlot(s)
      } catch (err) {
        fail(`slots[${i}]: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
    // 28-6-04: extraWorks는 28-7 신규 필드 — 없으면 통과(구 스냅샷), 있으면 검증
    if (snap.extraWorks !== undefined) {
      if (!Array.isArray(snap.extraWorks)) fail('extraWorks 형식')
      snap.extraWorks.forEach((e, i) => {
        if (typeof e?.id !== 'string' || typeof e.requestId !== 'string' || typeof e.memo !== 'string') {
          fail(`extraWorks[${i}] 필드`)
        }
        if (!Number.isInteger(e.amount) || e.amount <= 0) fail(`extraWorks[${i}].amount: ${String(e.amount)}`)
        // 28-96: 공급가·VAT가 있으면 셋이 맞아야 한다 (amount = supply + vat, vat = round(supply × 10%))
        if (e.supply !== undefined || e.vat !== undefined) {
          if (!Number.isInteger(e.supply) || (e.supply as number) <= 0 || !Number.isInteger(e.vat))
            fail(`extraWorks[${i}] 공급가·VAT`)
          if (
            e.vat !== PlatformService.vatOf(e.supply as number) ||
            e.amount !== (e.supply as number) + (e.vat as number)
          )
            fail(`extraWorks[${i}] 금액 불일치`)
        }
        if (!isValidDateStr(e.approvedDate)) fail(`extraWorks[${i}].approvedDate: ${String(e.approvedDate)}`)
        if (e.status !== undefined && !['pending', 'approved', 'rejected'].includes(e.status))
          fail(`extraWorks[${i}].status: ${String(e.status)}`)
      })
    }
    if (snap.extraSeq !== undefined && !Number.isInteger(snap.extraSeq)) fail('extraSeq')
    // 28-95: 계약서·수수료 조건·일정 변경 제안 — 없으면 통과(구 스냅샷), 있으면 검증
    const hours = (o: { date: unknown; startHour: unknown; endHour: unknown }) =>
      isValidDateStr(o.date as string) &&
      Number.isInteger(o.startHour) &&
      Number.isInteger(o.endHour) &&
      (o.startHour as number) >= 0 &&
      (o.startHour as number) < (o.endHour as number) &&
      (o.endHour as number) <= 24
    if (snap.contracts !== undefined) {
      if (!Array.isArray(snap.contracts)) fail('contracts 형식')
      snap.contracts.forEach((c, i) => {
        if (typeof c?.id !== 'string' || typeof c.requestId !== 'string' || typeof c.partnerId !== 'string')
          fail(`contracts[${i}] 필드`)
        if (!Number.isInteger(c.version) || c.version < 1) fail(`contracts[${i}].version`)
        if (
          !Number.isInteger(c.total) ||
          c.total < 0 ||
          !Number.isInteger(c.deposit) ||
          c.deposit < 0 ||
          c.deposit > c.total
        )
          fail(`contracts[${i}] 금액`)
        if (!Number.isInteger(c.commissionBps) || c.commissionBps < 0 || c.commissionBps > 10000)
          fail(`contracts[${i}].commissionBps`)
        if (typeof c.terms !== 'string' || typeof c.createdAt !== 'string') fail(`contracts[${i}] 형식`)
        if (!hours(c)) fail(`contracts[${i}] 일정`)
        if (!['proposed', 'accepted', 'declined', 'superseded'].includes(c.status))
          fail(`contracts[${i}].status: ${String(c.status)}`)
      })
      const acceptedPer = new Map<string, number>()
      for (const c of snap.contracts)
        if (c.status === 'accepted') acceptedPer.set(c.requestId, (acceptedPer.get(c.requestId) ?? 0) + 1)
      for (const [rid, n] of acceptedPer) if (n > 1) fail(`contracts: ${rid}에 동의된 계약이 ${n}건`)
    }
    if (snap.contractSeq !== undefined && !Number.isInteger(snap.contractSeq)) fail('contractSeq')
    if (snap.commissionTerms !== undefined) {
      if (!Array.isArray(snap.commissionTerms)) fail('commissionTerms 형식')
      snap.commissionTerms.forEach((t, i) => {
        if (typeof t?.requestId !== 'string' || typeof t.reason !== 'string' || typeof t.by !== 'string')
          fail(`commissionTerms[${i}] 필드`)
        if (!Number.isInteger(t.bps) || t.bps < 0 || t.bps > 10000) fail(`commissionTerms[${i}].bps`)
      })
    }
    if (snap.scheduleChanges !== undefined) {
      if (!Array.isArray(snap.scheduleChanges)) fail('scheduleChanges 형식')
      snap.scheduleChanges.forEach((c, i) => {
        if (typeof c?.id !== 'string' || typeof c.requestId !== 'string' || typeof c.partnerId !== 'string')
          fail(`scheduleChanges[${i}] 필드`)
        if (typeof c.reason !== 'string' || typeof c.createdAt !== 'string') fail(`scheduleChanges[${i}] 형식`)
        if (!hours(c)) fail(`scheduleChanges[${i}] 일정`)
        if (!['proposed', 'approved', 'rejected', 'superseded'].includes(c.status))
          fail(`scheduleChanges[${i}].status: ${String(c.status)}`)
      })
    }
    if (snap.scheduleChangeSeq !== undefined && !Number.isInteger(snap.scheduleChangeSeq)) fail('scheduleChangeSeq')
    // 28-18: reviews는 신규 필드 — 없으면 통과(구 스냅샷), 있으면 검증
    if (snap.reviews !== undefined) {
      if (!Array.isArray(snap.reviews)) fail('reviews 형식')
      snap.reviews.forEach((r, i) => {
        if (typeof r?.requestId !== 'string' || typeof r.text !== 'string') fail(`reviews[${i}] 필드`)
        if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5)
          fail(`reviews[${i}].rating: ${String(r.rating)}`)
        if (!isValidDateStr(r.createdDate)) fail(`reviews[${i}].createdDate: ${String(r.createdDate)}`)
        if (r.reply !== undefined && (typeof r.reply !== 'string' || r.reply.trim() === '')) fail(`reviews[${i}].reply`)
        if (r.repliedDate !== undefined && !isValidDateStr(r.repliedDate)) fail(`reviews[${i}].repliedDate`)
      })
    }
    // 28-22: settings는 신규 필드 — 없으면 기본값, 있으면 검증
    if (snap.settings !== undefined) {
      const st = snap.settings
      if (typeof st !== 'object' || st === null) fail('settings 형식')
      if (st.heroTitle !== undefined && (typeof st.heroTitle !== 'string' || st.heroTitle.trim() === ''))
        fail('settings.heroTitle')
      if (st.heroSub !== undefined && (typeof st.heroSub !== 'string' || st.heroSub.trim() === ''))
        fail('settings.heroSub')
      if (st.notice !== undefined && typeof st.notice !== 'string') fail('settings.notice')
      if (st.terms !== undefined && (typeof st.terms !== 'string' || st.terms.trim() === '')) fail('settings.terms')
      if (st.privacy !== undefined && (typeof st.privacy !== 'string' || st.privacy.trim() === ''))
        fail('settings.privacy')
      if (st.disabledCategories !== undefined) {
        if (!Array.isArray(st.disabledCategories)) fail('settings.disabledCategories 형식')
        st.disabledCategories.forEach((c, i) => {
          if (!ALL_CATEGORIES.includes(c)) fail(`settings.disabledCategories[${i}]: ${String(c)}`)
        })
        if (ALL_CATEGORIES.length - st.disabledCategories.length < 1)
          fail('settings.disabledCategories: 전 카테고리 비활성')
      }
      if (st.faqs !== undefined) {
        if (!Array.isArray(st.faqs)) fail('settings.faqs 형식')
        st.faqs.forEach((f, i) => {
          if (typeof f?.q !== 'string' || f.q.trim() === '' || typeof f.a !== 'string') fail(`settings.faqs[${i}]`)
        })
      }
    }
    // 28-23: claims는 신규 필드 — 없으면 통과, 있으면 검증
    if (snap.claims !== undefined) {
      if (!Array.isArray(snap.claims)) fail('claims 형식')
      snap.claims.forEach((c, i) => {
        if (typeof c?.id !== 'string' || typeof c.requestId !== 'string') fail(`claims[${i}] 필드`)
        if (!['open', 'in_review', 'resolved'].includes(c.status)) fail(`claims[${i}].status: ${String(c.status)}`)
        if (typeof c.detail !== 'string' || c.detail.trim() === '') fail(`claims[${i}].detail`)
        if (!isValidDateStr(c.createdDate)) fail(`claims[${i}].createdDate: ${String(c.createdDate)}`)
        if (c.status === 'resolved' && (typeof c.resolution !== 'string' || c.resolution.trim() === ''))
          fail(`claims[${i}].resolution`)
        if (c.partnerReply !== undefined && (typeof c.partnerReply !== 'string' || c.partnerReply.trim() === ''))
          fail(`claims[${i}].partnerReply`)
        if (c.repliedDate !== undefined && !isValidDateStr(c.repliedDate)) fail(`claims[${i}].repliedDate`)
      })
    }
    if (snap.claimSeq !== undefined && !Number.isInteger(snap.claimSeq)) fail('claimSeq')
    // 28-26: packages는 신규 필드 — 없으면 통과(기본 시드), 있으면 검증
    if (snap.packages !== undefined) {
      if (!Array.isArray(snap.packages)) fail('packages 형식')
      snap.packages.forEach((p, i) => {
        if (typeof p?.id !== 'string' || typeof p.name !== 'string' || p.name.trim() === '') fail(`packages[${i}] 필드`)
        if (!ALL_CATEGORIES.includes(p.category)) fail(`packages[${i}].category: ${String(p.category)}`)
        if (!Number.isInteger(p.price) || p.price <= 0) fail(`packages[${i}].price: ${String(p.price)}`)
        if (typeof p.description !== 'string') fail(`packages[${i}].description`)
        if (typeof p.active !== 'boolean') fail(`packages[${i}].active`)
      })
    }
    if (snap.packageSeq !== undefined && !Number.isInteger(snap.packageSeq)) fail('packageSeq')
    // 28-27: questions는 신규 필드 — 없으면 통과(기본 시드), 있으면 검증
    if (snap.questions !== undefined) {
      if (!Array.isArray(snap.questions)) fail('questions 형식')
      snap.questions.forEach((q, i) => {
        if (typeof q?.id !== 'string' || typeof q.label !== 'string' || q.label.trim() === '')
          fail(`questions[${i}] 필드`)
        if (!ALL_CATEGORIES.includes(q.category)) fail(`questions[${i}].category: ${String(q.category)}`)
        if (
          q.options !== undefined &&
          (!Array.isArray(q.options) ||
            q.options.length < 2 ||
            q.options.some((o) => typeof o !== 'string' || o.trim() === ''))
        )
          fail(`questions[${i}].options`)
        if (typeof q.active !== 'boolean') fail(`questions[${i}].active`)
      })
    }
    if (snap.questionSeq !== undefined && !Number.isInteger(snap.questionSeq)) fail('questionSeq')
    // 28-28: chats는 신규 필드 — 없으면 통과(빈 대화), 있으면 검증
    if (snap.chats !== undefined) {
      if (!Array.isArray(snap.chats)) fail('chats 형식')
      snap.chats.forEach((m, i) => {
        if (typeof m?.id !== 'string' || typeof m.requestId !== 'string') fail(`chats[${i}] 필드`)
        if (m.sender !== 'customer' && m.sender !== 'partner') fail(`chats[${i}].sender: ${String(m.sender)}`)
        if (typeof m.text !== 'string' || m.text.trim() === '') fail(`chats[${i}].text`)
        if (typeof m.sentAt !== 'string') fail(`chats[${i}].sentAt`)
      })
    }
    if (snap.chatSeq !== undefined && !Number.isInteger(snap.chatSeq)) fail('chatSeq')
    if (snap.chatReads !== undefined) {
      if (!Array.isArray(snap.chatReads)) fail('chatReads 형식')
      snap.chatReads.forEach((e, i) => {
        if (!Array.isArray(e) || typeof e[0] !== 'string' || !Number.isInteger(e[1]) || e[1] < 0)
          fail(`chatReads[${i}]`)
      })
    }
    // 28-29: payments는 신규 필드 — 없으면 통과(결제 이력 없음), 있으면 검증
    if (snap.payments !== undefined) {
      if (!Array.isArray(snap.payments)) fail('payments 형식')
      snap.payments.forEach((p, i) => {
        if (typeof p?.id !== 'string' || typeof p.requestId !== 'string' || typeof p.receiptNo !== 'string')
          fail(`payments[${i}] 필드`)
        if (p.kind !== 'deposit' && p.kind !== 'final') fail(`payments[${i}].kind: ${String(p.kind)}`)
        if (p.method !== 'card' && p.method !== 'transfer') fail(`payments[${i}].method: ${String(p.method)}`)
        if (!Number.isInteger(p.amount) || p.amount < 0) fail(`payments[${i}].amount: ${String(p.amount)}`)
        if (typeof p.paidAt !== 'string') fail(`payments[${i}].paidAt`)
        // 28-97: 상태·주문번호는 신규 필드 — 없으면 구 기록(done), 있으면 검증
        if (p.status !== undefined && !PlatformService.PAYMENT_STATUSES.includes(p.status))
          fail(`payments[${i}].status: ${String(p.status)}`)
        if (p.orderId !== undefined && (typeof p.orderId !== 'string' || p.orderId === ''))
          fail(`payments[${i}].orderId`)
        if (p.providerKey !== undefined && typeof p.providerKey !== 'string') fail(`payments[${i}].providerKey`)
        if (p.failReason !== undefined && typeof p.failReason !== 'string') fail(`payments[${i}].failReason`)
      })
      const orderIds = snap.payments.map((p) => p.orderId).filter((v): v is string => typeof v === 'string')
      if (new Set(orderIds).size !== orderIds.length) fail('payments: orderId 중복')
      const keys = snap.payments.map((p) => p.providerKey).filter((v): v is string => typeof v === 'string')
      if (new Set(keys).size !== keys.length) fail('payments: providerKey 중복')
    }
    if (snap.paymentSeq !== undefined && !Number.isInteger(snap.paymentSeq)) fail('paymentSeq')
    if (snap.rev !== undefined && (!Number.isInteger(snap.rev) || snap.rev < 0)) fail('rev')
    if (snap.daysOff !== undefined) {
      if (!Array.isArray(snap.daysOff)) fail('daysOff 형식')
      snap.daysOff.forEach((entry, i) => {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1]))
          fail(`daysOff[${i}] 구조`)
        entry[1].forEach((d) => {
          if (!isValidDateStr(d)) fail(`daysOff[${i}] 날짜: ${String(d)}`)
        })
      })
    }
    if (snap.partnerCancels !== undefined) {
      if (!Array.isArray(snap.partnerCancels)) fail('partnerCancels 형식')
      snap.partnerCancels.forEach((c, i) => {
        if (
          typeof c?.id !== 'string' ||
          typeof c.requestId !== 'string' ||
          typeof c.partnerId !== 'string' ||
          typeof c.reason !== 'string'
        )
          fail(`partnerCancels[${i}] 필드`)
        if (!isValidDateStr(c.date)) fail(`partnerCancels[${i}].date`)
      })
    }
    if (snap.pseudonymous !== undefined && typeof snap.pseudonymous !== 'boolean') fail('pseudonymous 형식')
    if (snap.auditLog !== undefined) {
      if (!Array.isArray(snap.auditLog)) fail('auditLog 형식')
      snap.auditLog.forEach((e, i) => {
        if (
          typeof e?.id !== 'string' ||
          typeof e.at !== 'string' ||
          typeof e.action !== 'string' ||
          typeof e.target !== 'string'
        )
          fail(`auditLog[${i}] 필드`)
        if (e.actor !== 'admin' && e.actor !== 'system') fail(`auditLog[${i}].actor: ${String(e.actor)}`)
        if (e.detail !== undefined && typeof e.detail !== 'string') fail(`auditLog[${i}].detail`)
        if (e.count !== undefined && (!Number.isInteger(e.count) || e.count < 2)) fail(`auditLog[${i}].count`)
        if (e.firstAt !== undefined && typeof e.firstAt !== 'string') fail(`auditLog[${i}].firstAt`)
        if (e.by !== undefined && (typeof e.by !== 'string' || e.by === '')) fail(`auditLog[${i}].by`)
      })
    }
    if (snap.bidWithdrawals !== undefined) {
      if (!Array.isArray(snap.bidWithdrawals)) fail('bidWithdrawals 형식')
      snap.bidWithdrawals.forEach((w, i) => {
        if (
          typeof w?.id !== 'string' ||
          typeof w.requestId !== 'string' ||
          typeof w.partnerId !== 'string' ||
          typeof w.at !== 'string'
        )
          fail(`bidWithdrawals[${i}] 필드`)
        if (typeof w.beforeDeadline !== 'boolean') fail(`bidWithdrawals[${i}].beforeDeadline`)
      })
    }
    if (snap.refunds !== undefined) {
      if (!Array.isArray(snap.refunds)) fail('refunds 형식')
      snap.refunds.forEach((r, i) => {
        if (typeof r?.id !== 'string' || typeof r.requestId !== 'string' || typeof r.paymentId !== 'string')
          fail(`refunds[${i}] 필드`)
        if (
          !Number.isInteger(r.amount) ||
          r.amount < 0 ||
          !Number.isInteger(r.deduction) ||
          r.deduction < 0 ||
          r.deduction > r.amount
        )
          fail(`refunds[${i}] 금액`)
        if (typeof r.afterVisit !== 'boolean' || typeof r.reason !== 'string' || typeof r.createdAt !== 'string')
          fail(`refunds[${i}] 형식`)
        if (r.status !== 'pending' && r.status !== 'done') fail(`refunds[${i}].status`)
        if (r.status === 'done' && typeof r.doneAt !== 'string') fail(`refunds[${i}].doneAt`)
      })
    }
    if (snap.refundSeq !== undefined && !Number.isInteger(snap.refundSeq)) fail('refundSeq')
    // 28-36: notifications는 신규 필드 — 없으면 통과, 있으면 검증
    if (snap.notifications !== undefined) {
      if (!Array.isArray(snap.notifications)) fail('notifications 형식')
      snap.notifications.forEach((n, i) => {
        if (typeof n?.id !== 'string' || typeof n.text !== 'string' || n.text.trim() === '')
          fail(`notifications[${i}] 필드`)
        if (!['customer', 'partner', 'admin'].includes(n.role)) fail(`notifications[${i}].role: ${String(n.role)}`)
        if (typeof n.createdAt !== 'string' || typeof n.read !== 'boolean') fail(`notifications[${i}] createdAt/read`)
      })
    }
    if (snap.notificationSeq !== undefined && !Number.isInteger(snap.notificationSeq)) fail('notificationSeq')
    // 28-9 신규 필드 — 없으면 통과(구 스냅샷), 있으면 검증
    if (snap.checklists !== undefined) {
      if (!Array.isArray(snap.checklists)) fail('checklists 형식')
      snap.checklists.forEach((entry, i) => {
        if (
          !Array.isArray(entry) ||
          typeof entry[0] !== 'string' ||
          typeof entry[1] !== 'object' ||
          entry[1] === null
        ) {
          fail(`checklists[${i}] 구조`)
        }
        for (const [k, v] of Object.entries(entry[1])) {
          if (!CHECKLIST_ITEMS.some((item) => item.key === k)) fail(`checklists[${i}] 키: ${k}`)
          if (typeof v !== 'boolean') fail(`checklists[${i}].${k} 값`)
        }
      })
    }
    const checkProfile = (p: unknown, label: string) => {
      const q = p as PartnerProfile | null
      if (
        typeof q !== 'object' ||
        q === null ||
        typeof q.name !== 'string' ||
        typeof q.specialties !== 'string' ||
        typeof q.region !== 'string' ||
        typeof q.intro !== 'string'
      ) {
        fail(`${label} 형식`)
      }
    }
    if (snap.profile !== undefined) checkProfile(snap.profile, 'profile')
    if (snap.profiles !== undefined) {
      if (!Array.isArray(snap.profiles)) fail('profiles 형식')
      snap.profiles.forEach((entry, i) => {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || entry[0] === '') fail(`profiles[${i}] 키`)
        checkProfile(entry[1], `profiles[${i}]`)
      })
    }
  }

  /** 검증된 스냅샷을 현재 인스턴스에 적용 */
  private applySnapshot(snapshot: PlatformSnapshot): void {
    this.rev = Number.isInteger(snapshot.rev) && snapshot.rev! >= 0 ? snapshot.rev! : 0
    this.store.restore(snapshot.store)
    // 28-42-01: 같은 requestId가 여러 항목(파트너별)일 수 있다 — 구 스냅샷(1건)도 동일 경로
    this.bids = new Map()
    for (const [id, st] of snapshot.estimates) {
      const byPartner = this.bids.get(id) ?? new Map<string, StoredEstimate>()
      // breakdown은 저장값을 신뢰하지 않고 재계산한다 (28-5-02)
      byPartner.set(st.estimate.partnerId, {
        estimate: { ...st.estimate },
        breakdown: calcEstimate(st.estimate),
        // 28-52-02: 수정 차수·제출 시각은 저장값 유지
        ...(Number.isInteger(st.revision) && st.revision! > 0 ? { revision: st.revision! } : {}),
        ...(typeof st.submittedAt === 'string' ? { submittedAt: st.submittedAt } : {}),
      })
      this.bids.set(id, byPartner)
    }
    this.jobs = snapshot.jobs.map((j) => ({ ...j }))
    this.slots = snapshot.slots.map((s) => ({ ...s }))
    this.slotSeq = snapshot.slotSeq
    this.extraWorks = (snapshot.extraWorks ?? []).map((e) => ({ ...e }))
    this.contracts = (snapshot.contracts ?? []).map((c) => ({ ...c }))
    this.contractSeq = snapshot.contractSeq ?? this.contracts.length
    this.commissionTerms = new Map((snapshot.commissionTerms ?? []).map((t) => [t.requestId, { ...t }]))
    this.scheduleChanges = (snapshot.scheduleChanges ?? []).map((c) => ({ ...c }))
    this.scheduleChangeSeq = snapshot.scheduleChangeSeq ?? this.scheduleChanges.length
    this.extraSeq = snapshot.extraSeq ?? this.extraWorks.length
    this.checklists = new Map((snapshot.checklists ?? []).map(([id, s]) => [id, { ...s }]))
    // 28-41-02: 구 스냅샷의 단일 profile은 시드 파트너(P-001)로 이전
    this.profiles = new Map((snapshot.profiles ?? []).map(([id, p]) => [id, { ...p }]))
    this.daysOff = new Map((snapshot.daysOff ?? []).map(([id, d]) => [id, [...d]]))
    if (snapshot.profile && !this.profiles.has(PlatformService.LEGACY_PARTNER_ID)) {
      this.profiles.set(PlatformService.LEGACY_PARTNER_ID, { ...snapshot.profile })
    }
    this.reviews = (snapshot.reviews ?? []).map((r) => ({ ...r }))
    // 28-89-B: `landing`은 28-89부터다 — 구 스냅샷은 없고, 손으로 고친 JSON은 틀릴 수 있다. 둘 다 정규화한다.
    const merged = { ...DEFAULT_SETTINGS, ...(snapshot.settings ?? {}) }
    this.settings = cloneSettings({
      ...merged,
      landing: normalizeLanding((snapshot.settings as { landing?: unknown } | undefined)?.landing),
    })
    this.claims = (snapshot.claims ?? []).map((c) => ({ ...c }))
    this.claimSeq = snapshot.claimSeq ?? this.claims.length
    this.packages = (snapshot.packages ?? DEFAULT_PACKAGES).map((p) => ({ ...p }))
    this.packageSeq = snapshot.packageSeq ?? this.packages.length
    this.questions = (snapshot.questions ?? DEFAULT_QUESTIONS).map((q) => ({
      ...q,
      ...(q.options ? { options: [...q.options] } : {}),
    }))
    this.questionSeq = snapshot.questionSeq ?? this.questions.length
    this.chats = (snapshot.chats ?? []).map((m) => ({ ...m }))
    this.chatSeq = snapshot.chatSeq ?? this.chats.length
    this.chatReads = new Map(snapshot.chatReads ?? [])
    // 28-97: 구 기록(상태·주문번호 없음)은 승인된 결제로 올라온다 — 그때는 기록이 곧 결제였다
    this.payments = (snapshot.payments ?? []).map((p) => ({
      ...p,
      status: p.status ?? 'done',
      orderId: p.orderId ?? `LEGACY-${p.id}`,
    }))
    this.paymentSeq = snapshot.paymentSeq ?? this.payments.length
    this.refunds = (snapshot.refunds ?? []).map((r) => ({ ...r }))
    this.refundSeq = snapshot.refundSeq ?? this.refunds.length
    this.cancelLog = (snapshot.partnerCancels ?? []).map((c) => ({ ...c }))
    this.partnerCancelSeq = snapshot.partnerCancelSeq ?? this.cancelLog.length
    this.bidWithdrawalLog = (snapshot.bidWithdrawals ?? []).map((w) => ({ ...w }))
    this.bidWithdrawalSeq = snapshot.bidWithdrawalSeq ?? this.bidWithdrawalLog.length
    this.auditEntries = (snapshot.auditLog ?? []).map((e) => ({ ...e }))
    this.auditSeq = snapshot.auditSeq ?? this.auditEntries.length
    this.notifications = (snapshot.notifications ?? []).map((n) => ({ ...n }))
    this.notificationSeq = snapshot.notificationSeq ?? this.notifications.length
  }

  /** 백업용 JSON 내보내기 (28-4-03) */
  exportData(): string {
    return JSON.stringify(this.snapshot(), null, 2)
  }

  /**
   * 백업 JSON 가져오기 (28-4-03). 검증 실패 시 PlatformError를 던지고
   * 기존 데이터는 그대로 보존된다. 성공 시 전체 상태를 교체하고 저장한다.
   */
  importSnapshot(raw: string): void {
    const snapshot = PlatformService.parseSnapshot(raw)
    this.applySnapshot(snapshot)
    this.save()
  }

  /** 상태별 요청 수 (28-4-02 대시보드) */
  statusCounts(partnerId?: string): Record<JobStatus, number> {
    const counts: Record<JobStatus, number> = {
      requested: 0,
      estimated: 0,
      accepted: 0,
      scheduled: 0,
      in_progress: 0,
      completed: 0,
      settled: 0,
      lost: 0,
      cancelled: 0,
    }
    for (const r of this.store.list()) {
      if (partnerId === undefined) {
        counts[r.status] += 1
        continue
      }
      if (this.bids.get(r.id)?.has(partnerId) !== true) continue
      counts[this.statusFor(r.id, partnerId)] += 1
    }
    return counts
  }

  /**
   * fromDate(포함) 이후의 방문 슬롯을 날짜·시각 순으로 최대 limit개 (28-4-02).
   * 활성(scheduled/in_progress) 요청의 슬롯만 — 완료·정산된 방문은 제외한다 (28-5-01).
   */
  upcomingSlots(fromDate: string, limit = 5, partnerId?: string): ScheduleSlot[] {
    return this.slots
      .filter((s) => {
        if (s.date < fromDate) return false
        if (partnerId !== undefined && s.partnerId !== partnerId) return false
        const status = this.store.get(s.requestId)?.status
        return status === 'scheduled' || status === 'in_progress'
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
      .slice(0, limit)
      .map((s) => ({ ...s }))
  }

  /** 월별 매출 요약 — 최신 월부터 (28-5-03) */
  monthlyReport(partnerId?: string): MonthlyReportRow[] {
    const byMonth = new Map<string, MonthlyReportRow>()
    for (const j of this.jobsOf(partnerId)) {
      const month = j.completedDate.slice(0, 7)
      let row = byMonth.get(month)
      if (!row) {
        row = {
          month,
          jobCount: 0,
          totalAmount: 0,
          totalFee: 0,
          payout: 0,
          settledPayout: 0,
          unsettledPayout: 0,
        }
        byMonth.set(month, row)
      }
      const jobPayout = PlatformService.payableOf(j)
      row.jobCount += 1
      row.totalAmount += j.total
      row.totalFee += j.platformFee
      row.payout += jobPayout
      if (j.settled) row.settledPayout += jobPayout
      else row.unsettledPayout += jobPayout
    }
    return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month))
  }

  /**
   * 거래 진행 타임라인 (28-15-03): 현재 데이터(등록일·견적·슬롯·완료 잡)에서 파생.
   * 이탈(미낙찰/취소)은 파생 가능한 단계까지 표시 후 종결 이벤트로 닫는다.
   */
  requestTimeline(requestId: string): TimelineEvent[] {
    const request = this.mustGet(requestId)
    const FLOW = ['requested', 'estimated', 'accepted', 'scheduled', 'in_progress', 'completed', 'settled']
    const idx = FLOW.indexOf(request.status)
    const reached = (target: string) => idx >= FLOW.indexOf(target)
    const estimate = this.primaryBid(requestId)
    const slots = this.slots
      .filter((sl) => sl.requestId === requestId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
    const job = this.jobs.find((j) => j.requestId === requestId)
    const extras = this.extraWorks.filter((e) => e.requestId === requestId)
    const terminal = request.status === 'lost' || request.status === 'cancelled'

    const events: TimelineEvent[] = [
      { key: 'created', label: '요청 등록', date: request.createdAt.slice(0, 10), done: true },
      { key: 'estimated', label: '견적 도착', done: estimate !== undefined },
      { key: 'accepted', label: '견적 수락(낙찰)', done: !terminal && reached('accepted') },
      {
        key: 'scheduled',
        label: '방문 예약',
        ...(slots[0] ? { date: slots[0].date } : {}),
        done: slots.length > 0 && !terminal && reached('scheduled'),
      },
      { key: 'in_progress', label: '시공 시작', done: !terminal && reached('in_progress') },
    ]
    // 28-95: 계약 이벤트 — 낙찰 다음, 예약 앞
    const contract =
      this.acceptedContract(requestId) ??
      this.contracts.find((c) => c.requestId === requestId && c.status === 'proposed')
    if (contract) {
      events.splice(3, 0, {
        key: 'contract',
        label:
          contract.status === 'accepted' ? `계약 v${contract.version} 동의` : `계약 v${contract.version} 확인 대기`,
        ...(contract.decidedAt ? { date: contract.decidedAt.slice(0, 10) } : {}),
        done: contract.status === 'accepted',
      })
    }
    // 28-28-02: 결제 이벤트 — 예약금은 낙찰 다음 위치에 삽입
    const deposit = this.payments.find((p) => p.requestId === requestId && p.kind === 'deposit' && p.status === 'done')
    if (deposit) {
      events.splice(contract ? 4 : 3, 0, {
        key: 'deposit',
        label: `예약금 결제 (${deposit.amount.toLocaleString('ko-KR')}원)`,
        date: deposit.paidAt.slice(0, 10),
        done: true,
      })
    }
    if (extras.length > 0) {
      const pending = extras.filter((e) => e.status === 'pending').length
      events.push({
        key: 'extra',
        label: pending > 0 ? `추가 작업 승인 대기 ${pending}건` : `추가 작업 ${extras.length}건 결정됨`,
        done: pending === 0,
      })
    }
    events.push({
      key: 'completed',
      label: '작업 완료',
      ...(job ? { date: job.completedDate } : {}),
      done: !terminal && reached('completed'),
    })
    const finalPay = this.payments.find((p) => p.requestId === requestId && p.kind === 'final' && p.status === 'done')
    if (finalPay) {
      events.push({
        key: 'payment',
        label: `결제 완료 (${finalPay.amount.toLocaleString('ko-KR')}원)`,
        date: finalPay.paidAt.slice(0, 10),
        done: true,
      })
    }
    events.push({ key: 'settled', label: '정산 완료', done: !terminal && reached('settled') })
    const review = this.reviews.find((r) => r.requestId === requestId)
    if (review) {
      events.push({ key: 'review', label: `리뷰 작성 (★${review.rating})`, date: review.createdDate, done: true })
    }
    if (terminal) {
      events.push({
        key: request.status,
        label: request.status === 'lost' ? '미낙찰 종료' : '취소 종료',
        done: true,
      })
    }
    return events
  }

  /**
   * 리뷰 작성 (28-17-01): 완료(completed)·정산(settled)된 요청에만, 요청당 1건.
   * rating은 1~5 정수.
   */
  writeReview(requestId: string, input: { rating: number; text: string; createdDate?: string }): Review {
    const request = this.mustGet(requestId)
    if (request.status !== 'completed' && request.status !== 'settled') {
      throw new PlatformError(`리뷰는 작업 완료 후에만 작성할 수 있습니다 (${request.status}): ${requestId}`)
    }
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new PlatformError(`별점은 1~5 사이의 정수여야 합니다: ${String(input.rating)}`)
    }
    if (this.reviews.some((r) => r.requestId === requestId)) {
      throw new PlatformError(`이미 리뷰를 작성한 요청입니다: ${requestId}`)
    }
    const date = input.createdDate ?? todayUTC()
    assertValidDateStr(date, 'createdDate')
    const review: Review = {
      requestId,
      rating: input.rating,
      text: input.text.trim(),
      createdDate: date,
    }
    this.reviews.push(review)
    this.notify('partner', `새 리뷰 ★${review.rating} — ${this.reqLabel(requestId)}`, requestId)
    this.save()
    return { ...review }
  }

  /** 리뷰 답글 (28-53-03): 그 요청의 파트너만, 빈 답글 거부, 수정 가능, 고객 알림 */
  replyReview(requestId: string, partnerId: string, text: string, date: string = todayUTC()): Review {
    const review = this.reviews.find((r) => r.requestId === requestId)
    if (!review) throw new PlatformError(`리뷰가 없습니다: ${requestId}`)
    if (this.partnerOf(requestId) !== partnerId) throw new PlatformError('답글은 그 작업의 파트너만 남길 수 있습니다')
    const reply = text.trim()
    if (reply === '') throw new PlatformError('답글 내용을 입력하세요')
    assertValidDateStr(date, 'date')
    review.reply = reply
    review.repliedDate = date
    this.notify('customer', `리뷰 답글 — ${this.reqLabel(requestId)}: ${reply}`, requestId)
    this.save()
    return { ...review }
  }

  reviewFor(requestId: string): Review | undefined {
    const r = this.reviews.find((x) => x.requestId === requestId)
    return r ? { ...r } : undefined
  }

  /** 전체 리뷰 — 최신 작성일부터 */
  allReviews(partnerId?: string): Review[] {
    return [...this.reviewsOf(partnerId)]
      .sort((a, b) => b.createdDate.localeCompare(a.createdDate))
      .map((r) => ({ ...r }))
  }

  /** 평점 요약 (28-17-01): 건수와 평균(소수 1자리) — 리뷰 없으면 average null */
  reviewStats(partnerId?: string): { count: number; average: number | null } {
    const reviews = this.reviewsOf(partnerId)
    if (reviews.length === 0) return { count: 0, average: null }
    const sum = reviews.reduce((s, r) => s + r.rating, 0)
    return {
      count: reviews.length,
      average: Math.round((sum / reviews.length) * 10) / 10,
    }
  }

  /** 파트너 범위 리뷰 (28-41-01): 리뷰의 요청 → 견적 파트너 */
  private reviewsOf(partnerId?: string): Review[] {
    return partnerId === undefined
      ? this.reviews
      : this.reviews.filter((r) => this.partnerOf(r.requestId) === partnerId)
  }

  /**
   * 분쟁 접수 (28-22-01 → 28-90): 낙찰 이후(accepted~settled) 거래에만. 고객 거래 상세에서 호출.
   * 접수되면 그 거래의 정산·지급이 **보류**된다 — 해결될 때까지 `settle`·`markPayout`이 거부한다.
   */
  fileClaim(requestId: string, input: { detail: string; createdDate?: string }): Claim {
    const request = this.mustGet(requestId)
    const DISPUTE_OK = ['accepted', 'scheduled', 'in_progress', 'completed', 'settled']
    if (!DISPUTE_OK.includes(request.status)) {
      throw new PlatformError(`분쟁은 낙찰 이후 거래에만 접수할 수 있습니다 (${request.status}): ${requestId}`)
    }
    const detail = input.detail.trim()
    if (detail === '') {
      throw new PlatformError('접수 사유를 입력하세요')
    }
    const date = input.createdDate ?? todayUTC()
    assertValidDateStr(date, 'createdDate')
    this.claimSeq += 1
    const claim: Claim = {
      id: `CL-${String(this.claimSeq).padStart(4, '0')}`,
      requestId,
      detail,
      status: 'open',
      createdDate: date,
    }
    this.claims.push(claim)
    this.notify('admin', `분쟁 접수 — ${this.reqLabel(requestId)} · 정산·지급 보류`, requestId)
    this.notify('partner', `분쟁 접수됨 — ${this.reqLabel(requestId)} · 해결 전까지 정산·지급이 보류됩니다`, requestId)
    this.save()
    return { ...claim }
  }

  /** 이 거래에 해결되지 않은 분쟁이 있는가 (28-90) — 정산·지급 보류의 근거 */
  hasOpenClaim(requestId: string): boolean {
    return this.claims.some((c) => c.requestId === requestId && c.status !== 'resolved')
  }

  /** 파트너 분쟁 답변 (28-53-02): 낙찰 파트너만, 미해결 건만, 빈 답변 거부, 최신 답변으로 덮어쓴다 */
  replyClaim(claimId: string, partnerId: string, text: string, date: string = todayUTC()): Claim {
    const claim = this.claims.find((c) => c.id === claimId)
    if (!claim) throw new PlatformError(`접수를 찾을 수 없습니다: ${claimId}`)
    if (this.partnerOf(claim.requestId) !== partnerId) throw new PlatformError('답변은 낙찰 파트너만 남길 수 있습니다')
    if (claim.status === 'resolved') throw new PlatformError(`이미 해결된 접수입니다: ${claimId}`)
    const reply = text.trim()
    if (reply === '') throw new PlatformError('답변 내용을 입력하세요')
    assertValidDateStr(date, 'date')
    claim.partnerReply = reply
    claim.repliedDate = date
    this.notify('customer', `파트너 답변 — ${this.reqLabel(claim.requestId)}: ${reply}`, claim.requestId)
    this.notify('admin', `파트너 답변 등록 — ${claim.id} (${this.reqLabel(claim.requestId)})`, claim.requestId)
    this.save()
    return { ...claim }
  }

  /** 검토 시작 (28-22-03): open → in_review — 관리자 액션 */
  reviewClaim(claimId: string): Claim {
    const claim = this.claims.find((c) => c.id === claimId)
    if (!claim) throw new PlatformError(`접수를 찾을 수 없습니다: ${claimId}`)
    if (claim.status !== 'open') {
      throw new PlatformError(`검토 시작은 접수(open) 상태에서만 가능합니다 (${claim.status}): ${claimId}`)
    }
    claim.status = 'in_review'
    this.record('admin', '검토 시작', claimId, claim.requestId)
    this.save()
    return { ...claim }
  }

  /** 해결 처리 (28-22-03): open·in_review → resolved, 처리 내용 필수 — 관리자 액션 */
  resolveClaim(claimId: string, resolution: string, resolvedDate?: string): Claim {
    const claim = this.claims.find((c) => c.id === claimId)
    if (!claim) throw new PlatformError(`접수를 찾을 수 없습니다: ${claimId}`)
    if (claim.status === 'resolved') {
      throw new PlatformError(`이미 해결된 접수입니다: ${claimId}`)
    }
    const note = resolution.trim()
    if (note === '') throw new PlatformError('처리 내용을 입력하세요')
    const date = resolvedDate ?? todayUTC()
    assertValidDateStr(date, 'resolvedDate')
    claim.status = 'resolved'
    claim.resolution = note
    claim.resolvedDate = date
    this.notify('customer', `분쟁 처리 완료 — ${note}`, claim.requestId)
    this.record('admin', '해결 처리', claimId, note)
    this.save()
    return { ...claim }
  }

  claimsFor(requestId: string): Claim[] {
    return this.claims.filter((c) => c.requestId === requestId).map((c) => ({ ...c }))
  }

  /** 전체 접수 — 미해결(open→in_review) 우선, 같은 상태는 최신 접수일부터 */
  allClaims(): Claim[] {
    const rank = { open: 0, in_review: 1, resolved: 2 }
    return [...this.claims]
      .sort((a, b) => rank[a.status] - rank[b.status] || b.createdDate.localeCompare(a.createdDate))
      .map((c) => ({ ...c }))
  }

  openClaimCount(): number {
    return this.claims.filter((c) => c.status !== 'resolved').length
  }

  /** 운영 설정 조회 (28-21-01) — 항상 기본값이 병합된 완전한 형태 */
  getSettings(): SiteSettings {
    return cloneSettings(this.settings)
  }

  /**
   * 운영 설정 부분 갱신 (28-21-01): 관리자 설정 탭에서만 호출.
   * 히어로 문구 공백 불가, 전 카테고리 비활성 불가, 미지의 카테고리·빈 FAQ 질문 거부.
   */
  updateSettings(patch: Partial<SiteSettings>): SiteSettings {
    const next = cloneSettings(this.settings)
    if (patch.heroTitle !== undefined) {
      if (patch.heroTitle.trim() === '') throw new PlatformError('히어로 타이틀은 비울 수 없습니다')
      next.heroTitle = patch.heroTitle
    }
    if (patch.heroSub !== undefined) {
      if (patch.heroSub.trim() === '') throw new PlatformError('히어로 서브 문구는 비울 수 없습니다')
      next.heroSub = patch.heroSub
    }
    if (patch.notice !== undefined) next.notice = patch.notice
    if (patch.terms !== undefined) {
      if (patch.terms.trim() === '') throw new PlatformError('이용약관 본문은 비울 수 없습니다')
      next.terms = patch.terms
    }
    if (patch.privacy !== undefined) {
      if (patch.privacy.trim() === '') throw new PlatformError('개인정보처리방침 본문은 비울 수 없습니다')
      next.privacy = patch.privacy
    }
    if (patch.disabledCategories !== undefined) {
      for (const c of patch.disabledCategories) {
        if (!ALL_CATEGORIES.includes(c)) throw new PlatformError(`알 수 없는 카테고리: ${String(c)}`)
      }
      if (ALL_CATEGORIES.length - patch.disabledCategories.length < 1) {
        throw new PlatformError('최소 1개의 카테고리는 활성 상태여야 합니다')
      }
      next.disabledCategories = [...patch.disabledCategories]
    }
    if (patch.faqs !== undefined) {
      next.faqs = patch.faqs.map((f, i) => {
        const q = f.q.trim()
        if (q === '') throw new PlatformError(`FAQ ${i + 1}번의 질문이 비어 있습니다`)
        return { q, a: f.a.trim() }
      })
    }
    if (patch.landing !== undefined) {
      // 28-89-B: 여섯 섹션이 정확히 한 번씩 — 빠지거나 겹치면 관리자가 실수한 것이고 조용히 고치면 안 된다
      const ids = patch.landing.sections.map((x) => x.id)
      const dup = ids.find((id, i) => ids.indexOf(id) !== i)
      if (dup !== undefined)
        throw new PlatformError(`섹션이 두 번 들어 있습니다: ${LANDING_SECTION_LABEL[dup] ?? String(dup)}`)
      for (const id of LANDING_SECTION_IDS) {
        if (!ids.includes(id)) throw new PlatformError(`섹션이 빠졌습니다: ${LANDING_SECTION_LABEL[id]}`)
      }
      for (const id of ids)
        if (!LANDING_SECTION_IDS.includes(id)) throw new PlatformError(`알 수 없는 섹션: ${String(id)}`)
      if (!patch.landing.sections.some((x) => x.visible)) throw new PlatformError('최소 1개의 섹션은 보여야 합니다')
      for (const [id, t] of Object.entries(patch.landing.titles)) {
        if (t !== undefined && t.length > 60)
          throw new PlatformError(`제목이 너무 깁니다 (60자 이하): ${LANDING_SECTION_LABEL[id as LandingSectionId]}`)
      }
      next.landing = normalizeLanding(patch.landing)
    }
    this.settings = next
    const changed = (Object.keys(patch) as Array<keyof SiteSettings>).filter((k) => patch[k] !== undefined)
    if (changed.length > 0) this.record('admin', '설정 변경', 'settings', changed.join(', '))
    this.save()
    return cloneSettings(next)
  }

  /** 고객 웹에 노출되는 카테고리 (28-21-03) — 시안 순서 유지 */
  enabledCategories() {
    return ALL_CATEGORIES.filter((c) => !this.settings.disabledCategories.includes(c))
  }

  // ── 가격 패키지 (28-25-01) — 관리자 CRUD + 고객 노출 ──

  private packageValidate(name: string, category: RepairCategory, price: number) {
    if (name.trim() === '') throw new PlatformError('패키지 이름은 비울 수 없습니다')
    if (!ALL_CATEGORIES.includes(category)) throw new PlatformError(`알 수 없는 카테고리: ${String(category)}`)
    if (!Number.isInteger(price) || price <= 0) {
      throw new PlatformError(`패키지 가격은 1원 이상의 정수여야 합니다: ${String(price)}`)
    }
  }

  private packageAt(id: string): number {
    const idx = this.packages.findIndex((p) => p.id === id)
    if (idx === -1) throw new PlatformError(`패키지를 찾을 수 없습니다: ${id}`)
    return idx
  }

  /** 패키지 등록 — 이름 공백·비정수/0 이하 가격·미지의 카테고리 거부 */
  addPackage(input: { name: string; category: RepairCategory; price: number; description?: string }): ServicePackage {
    this.packageValidate(input.name, input.category, input.price)
    this.packageSeq += 1
    const pkg: ServicePackage = {
      id: `PK-${String(this.packageSeq).padStart(4, '0')}`,
      name: input.name.trim(),
      category: input.category,
      price: input.price,
      description: (input.description ?? '').trim(),
      active: true,
    }
    this.packages.push(pkg)
    this.record('admin', '패키지 등록', pkg.id, pkg.name)
    this.save()
    return { ...pkg }
  }

  /** 패키지 수정 — 등록과 동일한 검증 */
  updatePackage(
    id: string,
    patch: Partial<Pick<ServicePackage, 'name' | 'category' | 'price' | 'description'>>,
  ): ServicePackage {
    const cur = this.packages[this.packageAt(id)]!
    const next: ServicePackage = {
      ...cur,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.price !== undefined ? { price: patch.price } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    }
    this.packageValidate(next.name, next.category, next.price)
    this.packages[this.packageAt(id)] = next
    this.record('admin', '패키지 수정', id, next.name)
    this.save()
    return { ...next }
  }

  /** 노출/숨김 토글 */
  togglePackage(id: string): ServicePackage {
    const idx = this.packageAt(id)
    const next = { ...this.packages[idx]!, active: !this.packages[idx]!.active }
    this.packages[idx] = next
    this.save()
    return { ...next }
  }

  /** 패키지 삭제 */
  removePackage(id: string): void {
    const [removed] = this.packages.splice(this.packageAt(id), 1)
    this.record('admin', '패키지 삭제', id, removed?.name)
    this.save()
  }

  /** 관리자용 전체 목록 — 등록순 */
  listPackages(): ServicePackage[] {
    return this.packages.map((p) => ({ ...p }))
  }

  /** 고객 웹 노출 목록 — active이면서 카테고리도 활성인 것만 */
  activePackages(): ServicePackage[] {
    const enabled = this.enabledCategories()
    return this.packages.filter((p) => p.active && enabled.includes(p.category)).map((p) => ({ ...p }))
  }

  // ── 질문 빌더 (28-26-01) — 카테고리별 맞춤 질문 ──

  private questionAt(id: string): number {
    const idx = this.questions.findIndex((q) => q.id === id)
    if (idx === -1) throw new PlatformError(`질문을 찾을 수 없습니다: ${id}`)
    return idx
  }

  private static cloneQuestion(q: CategoryQuestion): CategoryQuestion {
    return { ...q, ...(q.options ? { options: [...q.options] } : {}) }
  }

  /** 질문 등록 — 질문 공백 거부, 선택지는 있으면 2개 이상·공백 항목 거부 */
  addQuestion(input: { category: RepairCategory; label: string; options?: string[] }): CategoryQuestion {
    if (input.label.trim() === '') throw new PlatformError('질문은 비울 수 없습니다')
    if (!ALL_CATEGORIES.includes(input.category)) {
      throw new PlatformError(`알 수 없는 카테고리: ${String(input.category)}`)
    }
    let options: string[] | undefined
    if (input.options !== undefined) {
      options = input.options.map((o) => o.trim()).filter((o) => o !== '')
      if (options.length === 0) options = undefined
      else if (options.length < 2) throw new PlatformError('선택지는 2개 이상이어야 합니다 (단답형은 비워두세요)')
    }
    this.questionSeq += 1
    const q: CategoryQuestion = {
      id: `Q-${String(this.questionSeq).padStart(4, '0')}`,
      category: input.category,
      label: input.label.trim(),
      ...(options ? { options } : {}),
      active: true,
    }
    this.questions.push(q)
    this.record('admin', '질문 등록', q.id, q.label)
    this.save()
    return PlatformService.cloneQuestion(q)
  }

  /** 노출/숨김 토글 */
  toggleQuestion(id: string): CategoryQuestion {
    const idx = this.questionAt(id)
    const next = { ...this.questions[idx]!, active: !this.questions[idx]!.active }
    this.questions[idx] = next
    this.save()
    return PlatformService.cloneQuestion(next)
  }

  /** 질문 삭제 — 과거 요청의 answers는 텍스트 복사본이라 영향 없음 */
  removeQuestion(id: string): void {
    const [removed] = this.questions.splice(this.questionAt(id), 1)
    this.record('admin', '질문 삭제', id, removed?.label)
    this.save()
  }

  /** 관리자용 전체 목록 — 등록순 */
  listQuestions(): CategoryQuestion[] {
    return this.questions.map(PlatformService.cloneQuestion)
  }

  /** 위저드용 — 해당 카테고리의 활성 질문만 */
  questionsFor(category: RepairCategory | readonly RepairCategory[]): CategoryQuestion[] {
    // 28-93: 분야가 여럿이면 분야 순서대로 합친다 (질문 id는 분야마다 다르므로 중복은 없다)
    const cats = typeof category === 'string' ? [category] : category
    return cats.flatMap((c) =>
      this.questions.filter((q) => q.active && q.category === c).map(PlatformService.cloneQuestion),
    )
  }

  // ── 거래 채팅 (28-27-01, 당근 "현장 채팅") ──

  /** 메시지 전송 — 견적 전(requested)·종료 거래(lost/cancelled) 거부, 공백 거부 */
  sendMessage(requestId: string, sender: ChatSender, text: string): ChatMessage {
    if (sender !== 'customer' && sender !== 'partner') {
      throw new PlatformError(`알 수 없는 발신자: ${String(sender)}`)
    }
    const trimmed = text.trim()
    if (trimmed === '') throw new PlatformError('메시지를 입력하세요')
    if (trimmed.length > CHAT_MAX_TEXT)
      throw new PlatformError(`메시지는 ${CHAT_MAX_TEXT}자 이하여야 합니다 (${trimmed.length}자)`)
    const request = this.store.get(requestId)
    if (!request) throw new RequestNotFoundError(requestId)
    if (this.chats.filter((m) => m.requestId === requestId).length >= CHAT_MAX_PER_REQUEST) {
      throw new PlatformError(
        `이 거래의 채팅이 ${CHAT_MAX_PER_REQUEST}건에 도달했습니다 — 긴 논의는 전화나 분쟁 접수를 이용해 주세요`,
      )
    }
    if (request.status === 'requested') {
      throw new PlatformError('견적이 도착한 뒤 채팅할 수 있습니다')
    }
    if (request.status === 'lost' || request.status === 'cancelled') {
      throw new PlatformError('종료된 거래에는 채팅할 수 없습니다')
    }
    this.chatSeq += 1
    const msg: ChatMessage = {
      id: `MSG-${String(this.chatSeq).padStart(4, '0')}`,
      requestId,
      sender,
      text: trimmed,
      sentAt: new Date().toISOString(),
    }
    this.chats.push(msg)
    this.save()
    return { ...msg }
  }

  /** 해당 거래의 대화 — 보낸 순서 그대로 */
  chatFor(requestId: string): ChatMessage[] {
    return this.chats.filter((m) => m.requestId === requestId).map((m) => ({ ...m }))
  }

  /** 상대가 보낸 메시지 중 아직 읽지 않은 수 (읽음 워터마크 이후분) */
  unreadCount(requestId: string, viewer: ChatSender): number {
    const msgs = this.chats.filter((m) => m.requestId === requestId)
    const seen = this.chatReads.get(`${requestId}:${viewer}`) ?? 0
    return msgs.slice(seen).filter((m) => m.sender !== viewer).length
  }

  /** 대화 열람 시 읽음 처리 — 현재 메시지 수를 워터마크로 기록 */
  markRead(requestId: string, viewer: ChatSender): void {
    const count = this.chats.filter((m) => m.requestId === requestId).length
    const key = `${requestId}:${viewer}`
    if ((this.chatReads.get(key) ?? 0) === count) return
    this.chatReads.set(key, count)
    this.save()
  }

  /** 관리자 현황 (28-14-03): 요청 집계 + 플랫폼 수수료 수익(확정/예정) */
  adminOverview(): AdminOverview {
    const counts = this.statusCounts()
    let feeConfirmed = 0
    let feePending = 0
    for (const j of this.jobs) {
      if (j.settled) feeConfirmed += j.platformFee
      else feePending += j.platformFee
    }
    return {
      totalRequests: this.store.list().length,
      activeRequests: counts.requested + counts.estimated + counts.accepted + counts.scheduled + counts.in_progress,
      completedOrSettled: counts.completed + counts.settled,
      lostOrCancelled: counts.lost + counts.cancelled,
      feeConfirmed,
      feePending,
    }
  }

  /** 해당 월(YYYY-MM)의 실적 요약 (28-24-01) — 완료 잡이 없으면 0 행 */
  monthSummary(month: string, partnerId?: string): MonthlyReportRow {
    const row = this.monthlyReport(partnerId).find((r) => r.month === month)
    return (
      row ?? {
        month,
        jobCount: 0,
        totalAmount: 0,
        totalFee: 0,
        payout: 0,
        settledPayout: 0,
        unsettledPayout: 0,
      }
    )
  }

  /** 현재 상태의 직렬화 스냅샷 */
  snapshot(): PlatformSnapshot {
    return {
      version: 1,
      rev: this.rev,
      savedAt: new Date().toISOString(),
      store: this.store.snapshot(),
      estimates: [...this.bids.entries()].flatMap(([id, byPartner]) =>
        [...byPartner.values()].map(
          (b) => [id, { ...b, estimate: { ...b.estimate }, breakdown: { ...b.breakdown } }] as [string, StoredEstimate],
        ),
      ),
      jobs: this.completedJobs,
      slots: this.scheduleSlots,
      slotSeq: this.slotSeq,
      extraWorks: this.extraWorks.map((e) => ({ ...e })),
      contracts: this.contracts.map((c) => ({ ...c })),
      contractSeq: this.contractSeq,
      commissionTerms: [...this.commissionTerms.values()].map((t) => ({ ...t })),
      scheduleChanges: this.scheduleChanges.map((c) => ({ ...c })),
      scheduleChangeSeq: this.scheduleChangeSeq,
      extraSeq: this.extraSeq,
      checklists: [...this.checklists.entries()].map(([id, s]) => [id, { ...s }]),
      profiles: [...this.profiles.entries()].map(([id, p]) => [id, { ...p }] as [string, PartnerProfile]),
      daysOff: [...this.daysOff.entries()].map(([id, d]) => [id, [...d]] as [string, string[]]),
      reviews: this.reviews.map((r) => ({ ...r })),
      settings: cloneSettings(this.settings),
      claims: this.claims.map((c) => ({ ...c })),
      claimSeq: this.claimSeq,
      packages: this.packages.map((p) => ({ ...p })),
      packageSeq: this.packageSeq,
      questions: this.questions.map((q) => ({ ...q, ...(q.options ? { options: [...q.options] } : {}) })),
      questionSeq: this.questionSeq,
      chats: this.chats.map((m) => ({ ...m })),
      chatSeq: this.chatSeq,
      chatReads: [...this.chatReads.entries()],
      payments: this.payments.map((p) => ({ ...p })),
      paymentSeq: this.paymentSeq,
      refunds: this.refunds.map((r) => ({ ...r })),
      partnerCancels: this.cancelLog.map((c) => ({ ...c })),
      partnerCancelSeq: this.partnerCancelSeq,
      bidWithdrawals: this.bidWithdrawalLog.map((w) => ({ ...w })),
      bidWithdrawalSeq: this.bidWithdrawalSeq,
      auditLog: this.auditEntries.map((e) => ({ ...e })),
      auditSeq: this.auditSeq,
      refundSeq: this.refundSeq,
      notifications: this.notifications.map((n) => ({ ...n })),
      notificationSeq: this.notificationSeq,
    }
  }

  /**
   * 주입된 저장소에 저장 (28-49-01). 저장소가 없으면 true(저장 대상 없음).
   * 실패(용량 초과·프라이빗 모드)하면 lastSaveError에 기록하고 onSaveError로 통지한 뒤 false —
   * 동작은 계속하되 무언의 유실은 없게 한다. 성공하면 lastSaveError를 지운다.
   */
  save(): boolean {
    if (!this.storage) {
      this.rev += 1
      this.onSaved?.()
      return true
    }
    // 28-55-02: 쓰기 전에 저장소 리비전을 확인 — 내가 모르는 사이 다른 탭이 저장했으면 충돌로 기록(마지막 쓰기 우선)
    const revKey = `${this.storageKey}:rev`
    let stored: number | null = null
    try {
      const s = this.storage.getItem(revKey)
      stored = s === null ? null : Number(s)
    } catch {
      stored = null
    }
    if (stored !== null && Number.isFinite(stored) && stored !== this.rev) {
      this.conflictCount += 1
      this.onConflict?.()
    }
    const prev = this.rev
    this.rev = Math.max(this.rev, stored ?? 0) + 1
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.snapshot()))
      this.storage.setItem(revKey, String(this.rev))
      this.lastSaveError = null
      // 28-67-03: 저장이 실제로 성공한 뒤에만 알린다 — 실패한 변경을 복제 대상으로 세지 않는다
      this.onSaved?.()
      return true
    } catch (err) {
      this.rev = prev
      const detail = err instanceof Error && err.message ? err.message : String(err)
      const quota = /quota|exceed|storage/i.test(detail) || (err instanceof Error && err.name === 'QuotaExceededError')
      this.lastSaveError = quota
        ? '저장 공간이 부족해 마지막 변경이 저장되지 않았습니다 — 관리자 현황에서 오래된 사진을 정리하세요'
        : `변경을 저장하지 못했습니다: ${detail}`
      this.onSaveError?.(this.lastSaveError)
      return false
    }
  }

  /** 현재 리비전 (28-55-01) */
  get revision(): number {
    return this.rev
  }

  /**
   * 저장소 동기화 (28-55-01): 다른 탭이 저장했으면(리비전 키가 다름) 스냅샷을 다시 적용하고 true.
   * 리비전 키만 먼저 읽어 큰 JSON 파싱을 피한다. 저장소가 없거나 손상됐으면 false.
   */
  syncFromStorage(): boolean {
    if (!this.storage) return false
    let stored: string | null
    try {
      stored = this.storage.getItem(`${this.storageKey}:rev`)
    } catch {
      return false
    }
    if (stored === null || Number(stored) === this.rev) return false
    let raw: string | null
    try {
      raw = this.storage.getItem(this.storageKey)
    } catch {
      return false
    }
    if (raw === null) return false
    try {
      this.applySnapshot(PlatformService.parseSnapshot(raw))
    } catch {
      return false
    }
    this.lastSyncAt = new Date().toISOString()
    return true
  }

  /** 저장 용량 관측 (28-49-01): 직렬화 스냅샷 문자 수·사진 비중·한도 */
  storageUsage(): StorageUsage {
    const chars = JSON.stringify(this.snapshot()).length
    let photoCharsSum = 0
    let photoCount = 0
    for (const r of this.store.list()) {
      photoCharsSum += photoChars(r.photos) + photoChars(r.completionPhotos) + photoChars(r.beforePhotos)
      photoCount += (r.photos?.length ?? 0) + (r.completionPhotos?.length ?? 0) + (r.beforePhotos?.length ?? 0)
    }
    const notificationChars = JSON.stringify(this.notifications).length
    const chatChars = JSON.stringify(this.chats).length
    const auditChars = JSON.stringify(this.auditEntries).length
    const otherChars = Math.max(0, chars - photoCharsSum - notificationChars - chatChars - auditChars)
    // 28-73-01: 한도는 브라우저 하나가 공유한다 — 다른 키가 쓰는 만큼도 세야 카드와 가드가 사실을 말한다
    let externalChars = 0
    try {
      externalChars = Math.max(0, this.externalChars())
    } catch {
      // 앱이 알려 주지 못하면 0으로 — 용량 계산이 앱 때문에 던지지는 않는다
    }
    const totalChars = chars + externalChars
    return {
      chars,
      photoChars: photoCharsSum,
      photoCount,
      notificationChars,
      notificationCount: this.notifications.length,
      chatChars,
      chatCount: this.chats.length,
      auditChars,
      auditCount: this.auditEntries.length,
      otherChars,
      externalChars,
      totalChars,
      limit: this.storageLimit,
      ratio: totalChars / this.storageLimit,
    }
  }

  /** 사진을 늘리는 쓰기 전 용량 가드 (28-49-01): 예상 문자 수가 한도를 넘으면 변경 전에 거부 */
  private assertRoom(extraChars: number): void {
    if (extraChars <= 0) return
    let usage = this.storageUsage()
    // 28-78-01: 넘칠 것 같으면 **먼저 보관함에 양보를 청한다.** 그래도 모자라면 그때 거절한다 —
    //   가드는 그대로 살아 있고, 다만 "새로고침 전까지 아무것도 풀리지 않는" 자리가 사라진다.
    if (usage.totalChars + extraChars > usage.limit && usage.externalChars > 0) {
      const need = usage.totalChars + extraChars - usage.limit
      // 28-78 리뷰(Copilot): 앱 포트가 던져도 **가드는 결정적이어야 한다.** 바로 위 `externalChars()`가
      //   같은 이유로 try/catch를 두고 있는데(`용량 계산이 앱 때문에 던지지는 않는다`) 이쪽만 벗겨져
      //   있었다 — 저장소 접근이 막힌 브라우저에서 화면이 도메인 오류 대신 정체불명 예외를 받는다.
      let freed = 0
      try {
        freed = this.trimExternal(need)
      } catch {
        freed = 0 // 줄이지 못했을 뿐이다 — 판정은 아래에서 그대로 한다
      }
      if (freed > 0) usage = this.storageUsage()
    }
    // 28-73-01: 보관함 등 다른 키를 포함한 **합계**로 판정한다. 스냅샷만 보면 가드가 통과시킨 저장이
    // 브라우저 할당량에서 실패한다 — 원인이 어디에도 보이지 않는 실패였다
    if (usage.totalChars + extraChars > usage.limit) {
      const stash = usage.externalChars > 0 ? `, 보관함 ${Math.round(usage.externalChars / 1024)}KB 포함` : ''
      throw new PlatformError(
        `저장 공간이 부족합니다 (사용 ${Math.round(usage.totalChars / 1024)}KB${stash} / 한도 ${Math.round(usage.limit / 1024)}KB) — 오래된 사진을 정리하거나 사진 수를 줄이세요`,
      )
    }
  }

  /**
   * 보관함 정리를 운영 기록에 남긴다 (28-78-02 · 28-79-03에서 인자를 좁혔다 — 행위명은 도메인이
   * 정한다. 임의 문자열을 받는 통로는 감사 로그의 무결성을 앱에 맡기는 셈이었다). 부팅 정리 셋(알림·채팅·사진)은 이미
   * `record('system', 'X 정리', n)`을 남기는데 **보관함만** 남기지 않았다 — 넷 중 유일하게
   * "사용자가 잃은 것"인데 4초짜리 안내가 지나가면 어디에도 흔적이 없었다.
   */
  recordStashTrim(count: number): void {
    if (count <= 0) return
    this.record('system', '보관함 정리', String(count))
    this.save()
  }

  /** 감사 기록 추가 (28-57-01) — 저장은 호출자가 한다 (행위와 같은 save 안에 묶임) */
  private record(actor: AuditEntry['actor'], action: string, target: string, detail?: string): AuditEntry {
    const at = new Date().toISOString()
    // 28-59-02: 창(5분) 안의 같은 주체·행위·대상 반복은 마지막 줄에 접는다 — 첫 시각과 횟수는 남긴다
    const last = this.auditEntries[this.auditEntries.length - 1]
    const by = actor === 'admin' && this.actorId !== undefined && this.actorId !== '' ? this.actorId : undefined
    // 28-64-04: detail도 병합 키다. 이전에는 키가 아니면서 최신 값으로 덮어써서,
    // 5분 안에 설정을 두 번 바꾸면 한 줄로 접히고 **첫 변경 내역이 사라졌다**
    // (`설정 변경`은 target이 상수 'settings'이고 바뀐 필드 목록이 detail에 들어간다).
    const norm = detail !== undefined && detail.trim() !== '' ? detail.trim() : undefined
    // 진행 표시 detail은 마지막 값만 남겨도 잃는 것이 없으므로 무시하고 접는다.
    const detailMatches = PROGRESS_DETAIL_AUDIT_ACTIONS.has(action) || last?.detail === norm
    if (
      last &&
      last.actor === actor &&
      last.action === action &&
      last.target === target &&
      last.by === by &&
      detailMatches
    ) {
      const lastAt = Date.parse(last.at)
      if (!Number.isNaN(lastAt) && Date.parse(at) - lastAt <= AUDIT_COLLAPSE_MS) {
        last.firstAt = last.firstAt ?? last.at
        last.at = at
        last.count = (last.count ?? 1) + 1
        if (norm !== undefined) last.detail = norm
        this.lastRecordMerged = true
        return { ...last }
      }
    }
    this.lastRecordMerged = false
    this.auditSeq += 1
    const entry: AuditEntry = {
      id: `AUD-${String(this.auditSeq).padStart(5, '0')}`,
      at,
      actor,
      action,
      target,
      ...(detail !== undefined && detail.trim() !== '' ? { detail: detail.trim() } : {}),
      ...(actor === 'admin' && this.actorId !== undefined && this.actorId !== '' ? { by: this.actorId } : {}),
    }
    this.auditEntries.push(entry)
    return entry
  }

  /** 외부(인증 등 다른 서비스) 행위의 감사 기록 — 관리자 UI가 호출, 즉시 저장 */
  audit(actor: AuditEntry['actor'], action: string, target: string, detail?: string): AuditEntry {
    return this.auditWithMeta(actor, action, target, detail).entry
  }

  /**
   * 28-64-04: 감사 기록을 남기고 **새 줄인지 기존 줄에 접혔는지** 함께 알려준다.
   * `audit()`는 접힌 경우 이미 발급된 id를 돌려주므로, 반환값을 "방금 만든 줄"로 다루면 틀린다.
   */
  auditWithMeta(
    actor: AuditEntry['actor'],
    action: string,
    target: string,
    detail?: string,
  ): { entry: AuditEntry; merged: boolean } {
    if (action.trim() === '' || target.trim() === '')
      throw new PlatformError('감사 기록의 행위·대상은 비울 수 없습니다')
    const entry = this.record(actor, action.trim(), target.trim(), detail)
    const merged = this.lastRecordMerged
    this.save()
    return { entry: { ...entry }, merged }
  }

  /**
   * 백업 내보내기 (28-59-01): 데이터 반출은 상태 변경보다 먼저 추적돼야 한다 —
   * 내보낸 리비전·요청 건수·크기를 감사 기록으로 남기고 JSON을 돌려준다.
   * 돌려주는 JSON은 기록 직전 스냅샷이다(내보내기 기록 자체는 다음 백업부터 담긴다).
   */
  exportBackup(mode: BackupMode = 'full'): { json: string; chars: number } {
    const json = mode === 'pseudonymous' ? this.exportPseudonymous() : this.exportData()
    const label = mode === 'pseudonymous' ? '가명본' : '원본'
    this.record(
      'admin',
      '백업 내보내기',
      `rev ${this.revision}`,
      `${label} · 요청 ${this.store.list().length}건 · ${Math.round(json.length / 1024)}KB`,
    )
    this.save()
    return { json, chars: json.length }
  }

  /**
   * 가명 처리 백업 (28-60-01): 운영 분석·이관용. 개인을 특정할 수 있는 값을 지운다 —
   * 고객 이름은 `고객 A`류로 치환(같은 고객은 같은 이름), 지역은 시·구까지만,
   * 요청 내용·채팅 본문·사진은 제외하고 건수만 남긴다. 금액·상태·일정 등 운영 지표는 그대로 둔다.
   * 복원용이 아니다 — 되돌릴 수 없는 변환이므로 `restoreBackup`에 넣으면 원본이 돌아오지 않는다.
   */
  private exportPseudonymous(): string {
    const snap = JSON.parse(this.exportData()) as PlatformSnapshot
    // 가명 사전 — 같은 대상은 항상 같은 가명. 고객·파트너는 계열을 나눈다.
    const aliases = new Map<string, string>()
    const aliasFor = (prefix: string, key: string): string => {
      const cacheKey = `${prefix}:${key}`
      const hit = aliases.get(cacheKey)
      if (hit) return hit
      const n = [...aliases.keys()].filter((k) => k.startsWith(`${prefix}:`)).length
      const name = `${prefix} ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? String(Math.floor(n / 26)) : ''}`
      aliases.set(cacheKey, name)
      return name
    }
    /**
     * 28-64-02: 지역 축약을 **실패 시 닫히는** 방식으로 바꾼다.
     * 이전 구현(`split(/\s+/).slice(0,2)`)은 자유 입력이라 공백이 없으면 상세 주소를 그대로 남겼고
     * ("서울강서구화곡동123-45 202호" → 원문), 공백이 있어도 도로명까지 남겼다.
     * 이제는 알려진 시/도로 시작하고 숫자가 없는 경우에만 `시/도 + 시군구` 2토큰을 남긴다.
     */
    const city = (region: string) => {
      const t = region
        .trim()
        .split(/\s+/)
        .filter((x) => x !== '')
      const head = t[0]
      if (head === undefined) return PSEUDONYMOUS_REGION_FALLBACK
      if (
        !PSEUDONYMOUS_REGION_PREFIXES.some(
          (pre) => head === pre || head === `${pre}시` || head === `${pre}특별시` || head === `${pre}광역시`,
        )
      ) {
        return PSEUDONYMOUS_REGION_FALLBACK
      }
      const second = t[1]
      // 시군구가 아니거나 번지·건물번호가 섞이면 시/도까지만 남긴다
      if (second === undefined || /[0-9]/.test(second)) return head
      if (!/(구|시|군)$/.test(second)) return head
      return `${head} ${second}`
    }

    // 결과는 그대로 직렬화만 하므로 느슨한 레코드로 조립한다 — 허용 목록이 형태를 정한다
    const out: Record<string, unknown> = {
      ...pick(snap, ['version', 'rev', 'savedAt']),
      pseudonymous: true,
      store: {
        ...pick(snap.store, ['seq']),
        requests: snap.store.requests.map((r) => ({
          ...pick(r, PSEUDONYMOUS_REQUEST_KEYS),
          customerId: aliasFor('고객', r.customerId ?? r.customerName),
          customerName: aliasFor('고객', r.customerId ?? r.customerName),
          region: city(r.region),
          description: `[가명 처리] ${r.category} 요청`,
          photoCount: (r.photos?.length ?? 0) + (r.completionPhotos?.length ?? 0) + (r.beforePhotos?.length ?? 0),
        })),
      },
    }

    out.estimates = (snap.estimates ?? []).map(([id, b]) => [
      id,
      { ...pick(b, PSEUDONYMOUS_STORED_ESTIMATE_KEYS), estimate: pick(b.estimate, PSEUDONYMOUS_ESTIMATE_KEYS) },
    ])
    out.jobs = (snap.jobs ?? []).map((j) => ({
      ...pick(j, PSEUDONYMOUS_JOB_KEYS),
      ...(j.payout ? { payout: pick(j.payout, PSEUDONYMOUS_PAYOUT_KEYS) } : {}),
    }))
    out.slots = (snap.slots ?? []).map((s) => pick(s, PSEUDONYMOUS_SLOT_KEYS))
    out.payments = (snap.payments ?? []).map((p) => pick(p, PSEUDONYMOUS_PAYMENT_KEYS))
    out.refunds = (snap.refunds ?? []).map((r) => pick(r, PSEUDONYMOUS_REFUND_KEYS))
    out.contracts = (snap.contracts ?? []).map((c) => pick(c, PSEUDONYMOUS_CONTRACT_KEYS))
    out.commissionTerms = (snap.commissionTerms ?? []).map((t) => pick(t, PSEUDONYMOUS_COMMISSION_KEYS))
    out.scheduleChanges = (snap.scheduleChanges ?? []).map((c) => pick(c, PSEUDONYMOUS_SCHEDULE_CHANGE_KEYS))
    out.partnerCancels = (snap.partnerCancels ?? []).map((c) => pick(c, PSEUDONYMOUS_PARTNER_CANCEL_KEYS))
    out.bidWithdrawals = (snap.bidWithdrawals ?? []).map((w) => pick(w, PSEUDONYMOUS_BID_WITHDRAWAL_KEYS))
    // 28-64-02: 통째 통과를 끊는다 — [partnerId, 날짜 문자열[]] 형태만 재조립해 새 필드가 조용히 따라오지 못하게 한다
    out.daysOff = (snap.daysOff ?? []).map(([partnerId, dates]) => [
      partnerId,
      (dates ?? []).filter((d): d is string => typeof d === 'string'),
    ])
    out.packages = (snap.packages ?? []).map((p) => pick(p, PSEUDONYMOUS_PACKAGE_KEYS))
    out.questions = (snap.questions ?? []).map((q) => pick(q, PSEUDONYMOUS_QUESTION_KEYS))
    out.settings = pick(snap.settings ?? {}, PSEUDONYMOUS_SETTINGS_KEYS)
    out.reviews = (snap.reviews ?? []).map((v) => pick(v, PSEUDONYMOUS_REVIEW_KEYS))
    out.claims = (snap.claims ?? []).map((c) => pick(c, PSEUDONYMOUS_CLAIM_KEYS))
    out.chats = []
    // 알림 문구는 reqLabel(`[분야] 요청 내용`)을 담는다 — 뼈대만 남긴다 (28-60-01에서 발견)
    out.notifications = (snap.notifications ?? []).map((n) => ({
      ...pick(n, PSEUDONYMOUS_NOTIFICATION_KEYS),
      text: '[가명 처리]',
    }))
    // 감사 로그 상세에는 회원 이름이 들어간다(`파트너 승인 · 반듯설비`) — 행위·시각·주체만 남긴다 (28-61-02)
    out.auditLog = (snap.auditLog ?? []).map((e) => pick(e, PSEUDONYMOUS_AUDIT_KEYS))
    // 파트너 프로필: 상호는 개인사업자면 사실상 실명, 소개는 자유 서술 (28-61-02)
    out.profiles = (snap.profiles ?? []).map(([id, p]) => [
      id,
      { name: aliasFor('파트너', id), specialties: p.specialties, region: city(p.region), intro: '' },
    ])

    // 구조 대조(키) → 값 대조(이름) 순으로 두 겹 (28-62-01)
    assertPseudonymousShape(out, [
      // 28-64-02: 가장 PII가 많은 컬렉션이 중첩돼 있어 그동안 검사에서 통째로 빠져 있었다
      ['store.requests', PSEUDONYMOUS_REQUEST_SPEC],
      // 28-66-01: 결과에 실리면서 pick()도 spec도 없던 유일한 컬렉션. 값 배열에 객체가 섞이면 실패한다
      // (휴무 사유 같은 필드가 붙는 날 조용히 사라지거나 조용히 새지 않게).
      ['daysOff', { pairOf: 'scalars' }],
      ['profiles', PSEUDONYMOUS_PROFILE_KEYS],
      ['settings', PSEUDONYMOUS_SETTINGS_KEYS],
      // 28-65-01: 중첩을 선언한다. 예전에는 이 두 줄이 `estimate`·`payout`을 **키로만** 허용하고
      // 그 안은 한 번도 보지 않았다 — 자유 서술 memo와 예금주가 그대로 통과했다(탐침으로 확인).
      [
        'estimates',
        {
          keys: [...PSEUDONYMOUS_STORED_ESTIMATE_KEYS, 'estimate'],
          nested: { estimate: PSEUDONYMOUS_ESTIMATE_KEYS, breakdown: PSEUDONYMOUS_BREAKDOWN_KEYS },
        },
      ],
      ['slots', PSEUDONYMOUS_SLOT_KEYS],
      ['payments', PSEUDONYMOUS_PAYMENT_KEYS],
      ['refunds', PSEUDONYMOUS_REFUND_KEYS],
      ['contracts', PSEUDONYMOUS_CONTRACT_KEYS],
      ['commissionTerms', PSEUDONYMOUS_COMMISSION_KEYS],
      ['scheduleChanges', PSEUDONYMOUS_SCHEDULE_CHANGE_KEYS],
      ['partnerCancels', PSEUDONYMOUS_PARTNER_CANCEL_KEYS],
      ['bidWithdrawals', PSEUDONYMOUS_BID_WITHDRAWAL_KEYS],
      ['packages', PSEUDONYMOUS_PACKAGE_KEYS],
      ['questions', PSEUDONYMOUS_QUESTION_KEYS],
      ['reviews', PSEUDONYMOUS_REVIEW_KEYS],
      ['claims', PSEUDONYMOUS_CLAIM_KEYS],
      ['notifications', [...PSEUDONYMOUS_NOTIFICATION_KEYS, 'text']],
      ['auditLog', PSEUDONYMOUS_AUDIT_KEYS],
      [
        'jobs',
        {
          keys: [...PSEUDONYMOUS_JOB_KEYS, 'payout'],
          nested: { payout: PSEUDONYMOUS_PAYOUT_KEYS },
        },
      ],
    ])
    const json = JSON.stringify(out)
    assertNoRealIdentifiers(json, this.realIdentifiers())
    return json
  }

  /**
   * 자체 검사가 알아야 할 이름 출처 (28-63-02) — 플랫폼 스냅샷에는 **요청을 낸 고객**과
   * **프로필을 쓴 파트너**의 이름만 있다. 계정 서비스가 아는 이름(가입만 한 회원 등)은 여기 없으므로
   * `PlatformProvider`가 로그인·회원 목록에서 얻은 이름을 넣어 준다. 검사 범위를 넓히기만 하고,
   * 비어 있어도 기존 동작은 그대로다.
   */
  extraNames: readonly string[] = []

  /** 28-64-04: 직전 record()가 기존 줄에 접혔는지 — auditWithMeta가 읽는다 */
  private lastRecordMerged = false

  /**
   * 가명 처리 자체 검사용 식별자 (28-61-02, 28-63-02, 28-64-02).
   * 스냅샷에 있는 이름 + 계정 서비스가 주입한 이름·연락처·사업자등록번호.
   */
  private realIdentifiers(): string[] {
    const ids = new Set<string>()
    for (const r of this.store.list()) if (r.customerName.trim() !== '') ids.add(r.customerName.trim())
    for (const [, p] of this.profiles) if (p.name.trim() !== '') ids.add(p.name.trim())
    for (const n of this.extraNames) if (n.trim() !== '') ids.add(n.trim())
    return [...ids]
  }

  /**
   * 데이터 주체 열람권 (28-60-03): 로그인한 고객 **본인 요청 범위**의 데이터만 모아 돌려준다.
   * 다른 고객의 데이터는 어떤 경로로도 섞이지 않는다(요청 id 집합으로만 필터).
   * 파트너 식별자·수수료 같은 운영 내부 값은 담지 않는다.
   */
  exportCustomerData(customerId: string): { json: string; requests: number } {
    if (customerId.trim() === '') throw new PlatformError('로그인 후 내려받을 수 있습니다')
    const mine = this.store.list().filter((r) => r.customerId === customerId)
    const ids = new Set(mine.map((r) => r.id))
    const data = {
      exportedAt: new Date().toISOString(),
      customerId,
      // 28-64-03: 통째 전개를 끊는다 — 새 필드가 조용히 따라오지 않게 담을 것을 고른다.
      // 사진은 데이터 URL 대신 개수만(용량·재배포 위험).
      requests: mine.map((r) => ({
        // customerId는 정보주체 본인의 식별자다 — 범위가 본인으로 좁혀졌음을 결과에서 확인할 수 있게 담는다
        id: r.id,
        customerId: r.customerId,
        category: r.category,
        region: r.region,
        // 28-94: 본인의 주소·연락처는 본인 반출에 담는다(정보주체) — 파트너 반출·가명본에는 없다
        address: r.address,
        phone: r.phone,
        description: r.description,
        status: r.status,
        createdAt: r.createdAt,
        desiredDate: r.desiredDate,
        desiredTime: r.desiredTime,
        budget: r.budget,
        budgetRange: r.budgetRange,
        bidDeadline: r.bidDeadline,
        answers: r.answers,
        photoCount: (r.photos?.length ?? 0) + (r.completionPhotos?.length ?? 0) + (r.beforePhotos?.length ?? 0),
      })),
      estimates: mine.flatMap((r) =>
        this.bidsFor(r.id).map((b) => ({
          requestId: r.id,
          total: b.breakdown.total,
          submittedAt: b.submittedAt,
          revision: b.revision,
        })),
      ),
      visits: this.slots
        .filter((s) => ids.has(s.requestId))
        .map((s) => ({ requestId: s.requestId, date: s.date, startHour: s.startHour, endHour: s.endHour })),
      payments: this.payments.filter((p) => ids.has(p.requestId)).map((p) => pick(p, EXPORT_PAYMENT_KEYS)),
      refunds: this.refunds.filter((f) => ids.has(f.requestId)).map((f) => pick(f, EXPORT_REFUND_KEYS)),
      reviews: this.reviews.filter((v) => ids.has(v.requestId)).map((v) => pick(v, EXPORT_REVIEW_KEYS)),
      // resolution은 관리자가 남기는 내부 처리 메모다 — 정보주체 열람권의 대상이 아니다
      claims: this.claims
        .filter((c) => ids.has(c.requestId))
        .map((c) => ({
          id: c.id,
          requestId: c.requestId,
          detail: c.detail,
          status: c.status,
          createdDate: c.createdDate,
          resolvedDate: c.resolvedDate,
          partnerReply: c.partnerReply,
          repliedDate: c.repliedDate,
        })),
      chats: this.chats
        .filter((m) => ids.has(m.requestId))
        .map((m) => ({
          id: m.id,
          requestId: m.requestId,
          sender: m.sender,
          text: m.text,
          sentAt: m.sentAt,
        })),
    }
    const json = JSON.stringify(data, null, 2)
    // 28-64-03: 파트너 경로와 대칭으로 자체 검사를 건다 — 본인 이름·연락처는 제외한다
    // 28-94: 요청에 실린 본인 연락처(숫자만)도 제외 — 계정 연락처 목록(extraNames)과 자릿수 형태가 달라도 같은 번호다
    const mineNames = new Set(mine.map((r) => r.customerName.trim()).filter((n) => n !== ''))
    const minePhones = new Set(mine.map((r) => r.phone ?? '').filter((d) => d !== ''))
    assertNoRealIdentifiers(
      json,
      this.realIdentifiers().filter((n) => !mineNames.has(n) && !minePhones.has(n.replace(/[^0-9]/g, ''))),
    )
    this.record(
      'system',
      '내 데이터 내보내기',
      customerId,
      `요청 ${mine.length}건 · ${Math.round(json.length / 1024)}KB`,
    )
    this.save()
    return { json, requests: mine.length }
  }

  /**
   * 파트너 열람권 (28-61-03): 내가 입찰했거나 낙찰받은 요청 범위만. 고객 이름·연락 정보는 담지 않는다
   * (파트너가 볼 수 있는 것은 이미 화면에 있는 만큼 — 분야·지역·일정·금액).
   */
  exportPartnerData(partnerId: string): { json: string; requests: number } {
    if (partnerId.trim() === '') throw new PlatformError('로그인 후 내려받을 수 있습니다')
    const withdrawnIds = new Set(this.bidWithdrawalLog.filter((w) => w.partnerId === partnerId).map((w) => w.requestId))
    const mine = this.store.list().filter((r) => this.bidsOf(r.id, partnerId) !== undefined || withdrawnIds.has(r.id))
    const ids = new Set(mine.map((r) => r.id))
    const data = {
      exportedAt: new Date().toISOString(),
      partnerId,
      requests: mine.map((r) => ({
        id: r.id,
        category: r.category,
        region: r.region,
        status: r.status,
        desiredDate: r.desiredDate,
        createdAt: r.createdAt,
        accepted: r.acceptedPartnerId === partnerId,
      })),
      estimates: mine.flatMap((r) => {
        const b = this.bidsOf(r.id, partnerId)
        return b
          ? [{ requestId: r.id, total: b.breakdown.total, submittedAt: b.submittedAt, revision: b.revision }]
          : []
      }),
      visits: this.slots
        .filter((s) => ids.has(s.requestId) && s.partnerId === partnerId)
        .map((s) => ({ requestId: s.requestId, date: s.date, startHour: s.startHour, endHour: s.endHour })),
      jobs: this.jobs
        .filter((j) => ids.has(j.requestId) && j.partnerId === partnerId)
        .map((j) => ({
          ...pick(j, EXPORT_JOB_KEYS),
          ...(j.payout ? { payout: pick(j.payout, EXPORT_PAYOUT_KEYS) } : {}),
        })),
      reviews: this.reviews
        .filter((v) => ids.has(v.requestId) && this.store.get(v.requestId)?.acceptedPartnerId === partnerId)
        .map((v) => pick(v, EXPORT_REVIEW_KEYS)),
      // 28-64-03: 형제 줄과 같은 규칙으로 좁힌다. `ids`는 '입찰했거나 철회한' 요청 전부라
      // 이 줄만 범위가 없으면 낙찰 실패한 파트너가 낙찰 파트너의 자유 서술 답변까지 받는다.
      // Claim에는 partnerId가 없으므로 reviews와 동일하게 수행 파트너로 판정한다.
      claims: this.claims
        .filter((c) => ids.has(c.requestId) && this.store.get(c.requestId)?.acceptedPartnerId === partnerId)
        .map((c) => ({
          id: c.id,
          requestId: c.requestId,
          status: c.status,
          createdDate: c.createdDate,
          partnerReply: c.partnerReply,
        })),
      // 28-62-02: 내가 냈다가 거둔 견적도 내 이력이다
      withdrawnBids: this.bidWithdrawals(partnerId).map((w) => ({
        requestId: w.requestId,
        at: w.at,
        beforeDeadline: w.beforeDeadline,
      })),
    }
    const json = JSON.stringify(data, null, 2)
    // 28-62-02: 고객·타 파트너 이름이 섞이지 않는다는 것을 구조가 아니라 검사로 보장한다(본인 상호는 제외)
    assertNoRealIdentifiers(
      json,
      this.realIdentifiers().filter((n) => n !== this.profiles.get(partnerId)?.name),
    )
    this.record(
      'system',
      '내 데이터 내보내기',
      partnerId,
      `일감 ${mine.length}건 · ${Math.round(json.length / 1024)}KB`,
    )
    this.save()
    return { json, requests: mine.length }
  }

  /** 특정 파트너의 입찰 (28-61-03) — 없으면 undefined */
  private bidsOf(requestId: string, partnerId: string): StoredEstimate | undefined {
    return this.bids.get(requestId)?.get(partnerId)
  }

  /** 열람권 요약 행 (28-60-03) — 거래 한 줄씩. 상태 라벨은 표시층(STATUS_LABEL)이 붙인다 */
  customerDataRows(customerId: string): Array<[string, string, string, string, JobStatus, string, string]> {
    return this.store
      .list()
      .filter((r) => r.customerId === customerId)
      .map((r) => {
        const bid = this.getEstimate(r.id)
        const paid = this.paymentsFor(r.id)
          .filter((p) => p.status === 'done')
          .reduce((s, p) => s + p.amount, 0)
        return [
          r.id,
          r.createdAt.slice(0, 10),
          r.category,
          r.region,
          r.status,
          bid ? String(bid.breakdown.total) : '',
          String(paid),
        ]
      })
  }

  /** 가명 처리본인가 (28-61-01) — 파싱 실패는 여기서 판단하지 않고 복원 검증에 맡긴다. UI가 미리 걸러 쓸 수 있게 공개 */
  static isPseudonymousBackup(json: string): boolean {
    try {
      return (JSON.parse(json) as { pseudonymous?: unknown }).pseudonymous === true
    } catch {
      return false
    }
  }

  /** 복원 직전 상태 (28-59-03) — 같은 세션 동안만 유지되는 되돌리기 지점 */
  private prevBackup: string | undefined

  /** 되돌릴 수 있는 복원이 있는가 (28-59-03) */
  get canUndoRestore(): boolean {
    return this.prevBackup !== undefined
  }

  /**
   * 복원 되돌리기 (28-59-03): 직전 상태로 되돌린다. 감사 로그는 복원과 마찬가지로 보존되고,
   * 되돌린 사실도 기록된다. 되돌리기 지점은 한 번 쓰면 사라진다(연쇄 되돌리기 없음).
   */
  undoRestore(): { kept: number } {
    if (this.prevBackup === undefined) throw new PlatformError('되돌릴 복원이 없습니다')
    const json = this.prevBackup
    const kept = this.auditEntries.map((e) => ({ ...e }))
    const keptCount = kept.length
    const keptSeq = this.auditSeq
    this.importSnapshot(json)
    this.auditEntries = kept
    this.auditSeq = Math.max(keptSeq, keptCount)
    this.prevBackup = undefined
    this.record('admin', '복원 되돌리기', `rev ${this.revision}`, `직전 상태로 · 운영 기록 ${keptCount}건 보존`)
    this.save()
    return { kept: keptCount }
  }

  /**
   * 백업 복원 (28-58-02): 사용자가 일으키는 복원 경로. 스냅샷을 적용하되 **현재 감사 로그는 보존**해
   * 복원으로 운영 기록이 지워지거나 위조되지 않게 하고, 복원 사실 자체를 기록한다.
   * `importSnapshot`(다중 탭 동기화·기동 로드가 쓰는 경로)의 의미는 바꾸지 않는다.
   */
  restoreBackup(json: string): { kept: number; ignored: number } {
    // 28-61-01: 가명 처리는 단방향이라 복원하면 원본을 되돌릴 수 없게 덮는다 — 상태를 건드리기 전에 거부한다
    if (PlatformService.isPseudonymousBackup(json)) {
      throw new PlatformError('가명 처리된 백업은 복원할 수 없습니다 — 원본 백업 파일을 사용하세요')
    }
    const prev = this.exportData() // 28-59-03: 되돌리기 지점(세션 한정)
    const kept = this.auditEntries.map((e) => ({ ...e }))
    const keptCount = kept.length
    const keptSeq = this.auditSeq
    this.importSnapshot(json)
    const ignored = this.auditEntries.length
    this.auditEntries = kept
    this.auditSeq = Math.max(keptSeq, keptCount)
    this.prevBackup = prev
    this.record('admin', '백업 복원', `rev ${this.revision}`, `보존 ${keptCount}건 · 가져온 기록 ${ignored}건 무시`)
    this.save()
    return { kept: keptCount, ignored }
  }

  /** 감사 로그 — 최신순, limit 지정 시 그 수만 */
  auditLog(limit?: number): AuditEntry[] {
    const all = [...this.auditEntries].reverse().map((e) => ({ ...e }))
    return limit === undefined ? all : all.slice(0, Math.max(0, limit))
  }

  /** 감사 로그 보관 정책 (28-57-01): 180일 경과 제거, 상한(1000) 초과면 오래된 것부터. 제거 수 반환(멱등) */
  pruneAuditLog(now: number = Date.now()): number {
    const before = this.auditEntries.length
    const cut = now - AUDIT_RETENTION_DAYS * 86400000
    // 28-64-04: 파싱 불가 타임스탬프를 잔류시키지 않는다. 이전에는 true를 돌려줘
    // 보관 정책을 영원히 통과했고, 병합 비교도 영구히 막았다(손상 스냅샷 유입 경로).
    this.auditEntries = this.auditEntries.filter((e) => {
      const t = Date.parse(e.at)
      return Number.isNaN(t) ? false : t > cut
    })
    if (this.auditEntries.length > AUDIT_CAP) {
      // 28-59-02 / 28-64-04: 양이 아니라 **가치 순**으로 버리되, 한쪽으로 기울지 않게 예약분을 둔다.
      //
      // 순수한 우선순위 정렬은 어느 방향이든 반대 사고를 낳는다:
      //   - 'system 먼저'(28-59-02 원안) → 28-58-03이 인증 이벤트를 system으로 넣은 뒤로는
      //     평범한 관리자 작업 폭주가 **로그인 잠금 이력**을 지웠다.
      //   - '보안 마지막' → 대상을 매번 바꾸는 분산 무차별 로그인이 **관리자 행위 기록**을 밀어낸다.
      // 그래서 관리자 기록과 보안 이벤트에 각각 예약분을 주고, **예약분을 넘긴 쪽에서 오래된 것부터**
      // 버린다. 어느 쪽도 다른 쪽을 굶기지 못한다.
      type AuditClass = 'security' | 'admin' | 'system'
      const classOf = (e: AuditEntry): AuditClass =>
        SECURITY_AUDIT_ACTIONS.has(e.action) ? 'security' : e.actor === 'admin' ? 'admin' : 'system'

      // 클래스별로 오래된 것부터의 인덱스 목록을 만들어 둔다
      const byClass: Record<AuditClass, number[]> = { security: [], admin: [], system: [] }
      this.auditEntries.forEach((e, i) => byClass[classOf(e)].push(i))

      const reserve: Record<AuditClass, number> = { security: AUDIT_RESERVE, admin: AUDIT_RESERVE, system: 0 }
      const cursor: Record<AuditClass, number> = { security: 0, admin: 0, system: 0 }
      const left: Record<AuditClass, number> = {
        security: byClass.security.length,
        admin: byClass.admin.length,
        system: byClass.system.length,
      }

      const CLASSES: readonly AuditClass[] = ['system', 'admin', 'security']
      let excess = this.auditEntries.length - AUDIT_CAP
      const drop = new Set<number>()
      while (excess > 0) {
        // 예약분을 가장 많이 초과한 클래스에서 하나 버린다.
        // 전부 예약분 이하라면(상한이 예약분 합보다 작은 경우) 남은 수가 가장 많은 클래스에서 버린다.
        let pick: AuditClass = 'system'
        let bestOver = -Infinity
        for (const c of CLASSES) {
          if (cursor[c] >= byClass[c].length) continue
          const over = left[c] - reserve[c]
          if (over > bestOver) {
            bestOver = over
            pick = c
          }
        }
        const idx = byClass[pick][cursor[pick]]
        if (idx === undefined) break
        cursor[pick] += 1
        drop.add(idx)
        left[pick] -= 1
        excess -= 1
      }
      this.auditEntries = this.auditEntries.filter((_, i) => !drop.has(i))
    }
    const n = before - this.auditEntries.length
    if (n > 0) this.save()
    return n
  }

  /**
   * 사진 보관 정책 (28-49-02): 정산 완료(완료일 기준)·취소(환불 생성일, 없으면 요청 생성일 기준) 거래가
   * 보관 기간을 지나면 현장 사진·완료 사진을 제거한다. 제거한 요청 수 반환(멱등).
   */
  prunePhotos(today: string = todayUTC(), retentionDays: number = PHOTO_RETENTION_DAYS): number {
    assertValidDateStr(today, 'today')
    let n = 0
    for (const r of this.store.list()) {
      if (!r.photos && !r.completionPhotos && !r.beforePhotos) continue
      const terminal = this.terminalDate(r)
      if (!terminal || daysBetween(terminal, today) < retentionDays) continue
      this.store.setPhotos(r.id, [])
      this.store.setCompletionPhotos(r.id, [])
      this.store.setBeforePhotos(r.id, [])
      n += 1
    }
    if (n > 0) {
      this.record('system', '사진 정리', String(n))
      this.save()
    }
    return n
  }

  /** 거래 종료일 (28-49-02/28-54-02): 정산 완료는 완료일, 취소는 환불 생성일(없으면 요청 생성일). 그 외 undefined */
  private terminalDate(r: RepairRequest): string | undefined {
    if (r.status === 'settled') return this.jobs.find((j) => j.requestId === r.id)?.completedDate
    if (r.status === 'cancelled')
      return (this.refunds.find((f) => f.requestId === r.id)?.createdAt ?? r.createdAt).slice(0, 10)
    return undefined
  }

  /**
   * 알림 보관 정책 (28-54-01): 읽은 알림 30일·안 읽은 알림 90일 경과 제거, 그래도 상한(500) 초과면
   * 오래된 것부터(읽은 것 우선) 제거. 제거 수 반환(멱등).
   */
  pruneNotifications(now: number = Date.now()): number {
    const before = this.notifications.length
    const readCut = now - NOTIFICATION_READ_RETENTION_DAYS * 86400000
    const unreadCut = now - NOTIFICATION_UNREAD_RETENTION_DAYS * 86400000
    this.notifications = this.notifications.filter((n) => {
      const t = Date.parse(n.createdAt)
      if (Number.isNaN(t)) return true
      return n.read ? t > readCut : t > unreadCut
    })
    if (this.notifications.length > NOTIFICATION_CAP) {
      const excess = this.notifications.length - NOTIFICATION_CAP
      const drop = new Set<number>()
      this.notifications.forEach((n, i) => {
        if (drop.size < excess && n.read) drop.add(i)
      })
      for (let i = 0; i < this.notifications.length && drop.size < excess; i += 1) drop.add(i)
      this.notifications = this.notifications.filter((_, i) => !drop.has(i))
    }
    const n = before - this.notifications.length
    if (n > 0) {
      this.record('system', '알림 정리', String(n))
      this.save()
    }
    return n
  }

  /** 채팅 보관 정책 (28-54-02): 거래 종료 후 180일 경과 요청의 채팅·읽음 기록 제거. 제거한 요청 수 반환(멱등) */
  pruneChats(today: string = todayUTC(), retentionDays: number = CHAT_RETENTION_DAYS): number {
    assertValidDateStr(today, 'today')
    let n = 0
    for (const r of this.store.list()) {
      if (!this.chats.some((m) => m.requestId === r.id)) continue
      const terminal = this.terminalDate(r)
      if (!terminal || daysBetween(terminal, today) < retentionDays) continue
      this.chats = this.chats.filter((m) => m.requestId !== r.id)
      for (const v of CHAT_VIEWERS) this.chatReads.delete(`${r.id}:${v}`)
      n += 1
    }
    if (n > 0) {
      this.record('system', '채팅 정리', String(n))
      this.save()
    }
    return n
  }

  private mustGet(requestId: string): RepairRequest {
    const request = this.store.get(requestId)
    if (!request) throw new RequestNotFoundError(requestId)
    return request
  }
}

/** UTC 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}
