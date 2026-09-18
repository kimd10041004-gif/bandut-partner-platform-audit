/**
 * 시공 분야 (28-92, 참고 v12 카탈로그). 라벨이 곧 식별자다 — 부가 정보(코드·설명·그룹)와 옛 13개 라벨의 이전은
 * `catalog.ts`에 있다. 28-16~28-91의 라벨(도배·욕실·누수 등 13개)은 스냅샷을 읽을 때 옮긴다.
 */
export type RepairCategory =
  | '급배수·누수·설비'
  | '문·도어락'
  | '전기·조명'
  | '방충망'
  | '커튼·블라인드'
  | '생활·상업 시설 설치'
  | '냉난방·환기'
  | '스마트홈·보안'
  | '가전·기기 설치'
  | '도배·도장·필름'
  | '바닥·타일'
  | '목공·가구'
  | '창호·유리'
  | '주방·욕실 공사'
  | '방수·외부 보수'
  | '주거 리모델링'
  | '매장·사무실 공사'
  | '철거·원상복구'
  | '청소·공간 관리'
  | '분야를 모르겠어요'

/** 카테고리 런타임 목록 — 참고안 순서, "분야를 모르겠어요"는 늘 마지막. UI는 이 목록을 재사용한다 */
export const ALL_CATEGORIES: RepairCategory[] = [
  '급배수·누수·설비',
  '문·도어락',
  '전기·조명',
  '방충망',
  '커튼·블라인드',
  '생활·상업 시설 설치',
  '냉난방·환기',
  '스마트홈·보안',
  '가전·기기 설치',
  '도배·도장·필름',
  '바닥·타일',
  '목공·가구',
  '창호·유리',
  '주방·욕실 공사',
  '방수·외부 보수',
  '주거 리모델링',
  '매장·사무실 공사',
  '철거·원상복구',
  '청소·공간 관리',
  '분야를 모르겠어요',
]

/** 운영 설정 (28-21-01): 관리자가 코드 수정 없이 바꾸는 값 — 도메인 스냅샷에 영속 */
export interface FaqItem {
  q: string
  a: string
}

export interface SiteSettings {
  /** 랜딩 히어로 타이틀 — \n으로 줄바꿈 */
  heroTitle: string
  heroSub: string
  /** 공지 배너 — 빈 문자열이면 미표시 */
  notice: string
  /** 고객 웹에서 숨길 카테고리 (전부 비활성 불가) */
  disabledCategories: RepairCategory[]
  faqs: FaqItem[]
  /** 이용약관 본문 (28-37-02) — 가입 동의 대상, 랜딩 푸터 공개 */
  terms: string
  /** 개인정보처리방침 본문 (28-37-02) */
  privacy: string
  /** 랜딩 섹션 배치 (28-89-B) — 관리자가 순서·노출·제목을 직접 정한다 */
  landing: LandingLayout
}

/**
 * 관리자가 배치할 수 있는 랜딩 섹션 (28-89-B).
 * 히어로(맨 위)와 파트너/관리자 진입·푸터(맨 아래)는 고정이다 — 그 둘을 옮기면 화면이 아니라 구조가 바뀐다.
 */
export type LandingSectionId = 'categories' | 'steps' | 'services' | 'packages' | 'faq' | 'cta'

export const LANDING_SECTION_IDS: readonly LandingSectionId[] = [
  'categories',
  'steps',
  'services',
  'packages',
  'faq',
  'cta',
]

export interface LandingSection {
  id: LandingSectionId
  visible: boolean
}

export interface LandingLayout {
  /** 위에서 아래 순서 — 여섯 섹션이 **정확히 한 번씩** 들어 있어야 한다 */
  sections: LandingSection[]
  /** 섹션 제목 덮어쓰기 — 없으면 기본 제목. 제목이 없는 섹션(`services`·`cta`)에는 뜻이 없다 */
  titles: Partial<Record<LandingSectionId, string>>
}

/** 표준 가격 패키지 (28-25-01): 관리자가 등록·노출을 관리하고 고객 홈페이지에 정찰가로 노출 */
export interface ServicePackage {
  id: string
  name: string
  category: RepairCategory
  /** 정찰 가격 (정수 KRW) */
  price: number
  description: string
  /** 고객 웹 노출 여부 */
  active: boolean
}

/** 카테고리별 맞춤 질문 (28-26-01, 시안 3 질문 빌더) — options가 있으면 선택형, 없으면 단답형 */
export interface CategoryQuestion {
  id: string
  category: RepairCategory
  label: string
  /** 선택형 보기 (2개 이상) — 없으면 단답형 */
  options?: string[]
  /** 위저드 노출 여부 */
  active: boolean
}

/** 요청에 실리는 질문·답변 쌍 (28-26-02) — 질문 텍스트를 복사 저장해 이후 질문 수정과 무관하게 기록 불변 */
export interface RequestAnswer {
  question: string
  answer: string
}

/** 거래 채팅 (28-27-01, 당근 "현장 채팅"): 거래마다 붙는 고객↔파트너 대화 */
export type ChatSender = 'customer' | 'partner'
export interface ChatMessage {
  id: string
  requestId: string
  sender: ChatSender
  text: string
  /** ISO 타임스탬프 */
  sentAt: string
}

/** 결제 (28-28-01, 시안 "결제 및 예약"): 예약금(낙찰 직후)과 최종 결제(작업 완료 후).
 *  상용 전환 시 PG(토스페이먼츠 등) 승인 결과가 이 레코드를 만든다 — 도메인 규칙은 그대로 유지된다. */
/** 환불 (28-45-01): 예약금 결제 후 취소 시 자동 생성 — 약관 제6조(방문 전 전액, 방문 후 협의 실비 차감) */
export type RefundStatus = 'pending' | 'done'
/** 낙찰 전 입찰 철회 기록 (28-62-02) — 낙찰 후 철회(PartnerCancel)와 같은 대접으로 남긴다 */
export interface BidWithdrawal {
  id: string
  requestId: string
  partnerId: string
  /** ISO 타임스탬프 */
  at: string
  /** 입찰 마감 전이었는가 (마감 후에는 철회 자체가 막힌다 — 기록의 맥락용) */
  beforeDeadline: boolean
}

/** 파트너 낙찰 철회 기록 (28-50-01) — 신뢰 지표·운영 큐의 근거 */
export interface PartnerCancel {
  id: string
  requestId: string
  partnerId: string
  reason: string
  /** YYYY-MM-DD */
  date: string
}

/** 운영 감사 로그 (28-57-01): 관리자 행위·시스템 정리 작업의 불변 기록 */
export interface AuditEntry {
  id: string
  /** ISO 시각 */
  at: string
  actor: 'admin' | 'system'
  action: string
  target: string
  detail?: string
  /** 짧은 시간 안의 같은 행위·대상 반복을 한 줄로 접었을 때의 횟수 (28-59-02) — 2 이상일 때만 있다 */
  count?: number
  /** 접힌 기록의 첫 발생 시각 (28-59-02) — `at`은 마지막 발생 시각 */
  firstAt?: string
  /** 행위자 식별자 (28-60-02) — 관리자 행위는 로그인 계정 ID, 시스템 행위는 없음. 구 스냅샷에는 없다 */
  by?: string
}

/** 계약서 (28-95, 참고 v12 `contracts`): 낙찰 파트너가 발행, 고객이 동의하면 방문 일정·예약금·수수료가 확정된다 */
export type ContractStatus = 'proposed' | 'accepted' | 'declined' | 'superseded'
export interface Contract {
  id: string
  requestId: string
  partnerId: string
  /** 같은 요청 안에서 1부터 — 고객이 수정을 요청하면 다음 버전을 낸다 */
  version: number
  /** 낙찰 견적 총액(VAT 포함, 정수 원) — 발행 시점 스냅샷 */
  total: number
  /** 예약금 (0 이상, 총액 이하, 정수 원) */
  deposit: number
  /** 플랫폼 수수료 (bps, 0~10000) — 관리자가 주문별로 정한 값 또는 기본값 */
  commissionBps: number
  /** 계약 조건 (자유 서술) */
  terms: string
  /** 방문 일정 */
  date: string
  startHour: number
  endHour: number
  status: ContractStatus
  createdAt: string
  decidedAt?: string
}

/** 주문별 수수료 조건 (28-95): 계약 발행 전 관리자가 정한다 */
export interface CommissionTerms {
  requestId: string
  bps: number
  reason: string
  by: string
  at: string
}

/** 방문 일정 변경 제안 (28-95, 참고 v12 `schedule_changes`): 파트너가 제안, 고객이 승인·거절 */
export type ScheduleChangeStatus = 'proposed' | 'approved' | 'rejected' | 'superseded'
export interface ScheduleChange {
  id: string
  requestId: string
  partnerId: string
  date: string
  startHour: number
  endHour: number
  reason: string
  status: ScheduleChangeStatus
  createdAt: string
  decidedAt?: string
}

export interface Refund {
  id: string
  requestId: string
  paymentId: string
  /** 환불 대상 금액 (예약금, 정수 KRW) */
  amount: number
  /** 차감액 (정수 KRW, 완료 시 확정) */
  deduction: number
  /** 방문일 경과 후 취소 — 실비 차감 협의 대상 */
  afterVisit: boolean
  reason: string
  status: RefundStatus
  createdAt: string
  doneAt?: string
}

export type PaymentKind = 'deposit' | 'final'
export type PaymentMethod = 'card' | 'transfer'
/** 결제 상태 (28-97): 준비(결제창 열기 전) → 승인 | 실패. 28-96 이전 기록은 전부 done */
export type PaymentStatus = 'ready' | 'done' | 'failed'
export interface Payment {
  id: string
  requestId: string
  kind: PaymentKind
  /** 결제 금액 (정수 KRW) */
  amount: number
  method: PaymentMethod
  /** 영수증 번호 (RCT-####) */
  receiptNo: string
  /** ISO 타임스탬프 — ready는 준비 시각, done은 승인 시각 */
  paidAt: string
  /**
   * 주문번호 = 결제사 **멱등 키** (28-97, `BD-<요청>-<종류>-<번호>`). 같은 주문의 승인은 몇 번을 보내도 결제 한 건이다.
   * 구 스냅샷은 `LEGACY-<id>`.
   */
  orderId: string
  status: PaymentStatus
  /** 결제사 승인 키(Toss `paymentKey`). 기록 결제(결제사 없음)는 `local:<orderId>`. 반출·가명본에는 나가지 않는다 */
  providerKey?: string
  /** 실패 사유 — failed에서만 */
  failReason?: string
}

/** 인앱 알림 (28-35-01): 거래 이벤트를 역할별로 쌓는다 — DOM Notification과 이름 충돌 회피 */
export type NotificationRole = 'customer' | 'partner' | 'admin'
export interface AppNotification {
  id: string
  role: NotificationRole
  requestId?: string
  /** 계정 범위 (28-42-01) — 있으면 그 계정에만 표시(예: 미낙찰 파트너별 알림) */
  accountId?: string
  text: string
  /** ISO 타임스탬프 */
  createdAt: string
  read: boolean
}

/** 희망 방문 시간대 (28-16-02) */
export type DesiredTime = '오전' | '오후'

/** 작업(수리 요청) 상태 — 전이 규칙은 jobStatus.ts 참조 */
export type JobStatus =
  | 'requested' // 고객 요청 접수
  | 'estimated' // 파트너 견적 제출
  | 'accepted' // 고객 견적 수락
  | 'scheduled' // 방문 일정 확정
  | 'in_progress' // 시공 중
  | 'completed' // 시공 완료
  | 'settled' // 정산 완료
  | 'lost' // 미낙찰 (고객이 다른 업체 선택)
  | 'cancelled' // 취소

/** 고객 수리 요청 */
/** 요청 현장 사진 (28-48-01) — data URL(JPEG/PNG), 브라우저에서 리사이즈해 저장 */
export interface RequestPhoto {
  id: string
  dataUrl: string
  width: number
  height: number
  bytes: number
}

/** 안전 질문 답변 (28-93, 참고 v12 `policy.ts` `safety()`): 묻지 않은 질문의 답은 `null`이어야 한다 */
export interface SafetyAnswers {
  /** "문이 잠겨 들어갈 수 없나요?" — 문·도어락 또는 "분야를 모르겠어요"일 때만 묻는다 */
  isLocked: boolean | null
  /** "타는 냄새·가스 냄새·감전·물이 계속 새는 등 긴급 증상이 있나요?" — 설비·전기·잠금·범위 검토 분야에 묻는다 */
  urgent: boolean | null
  /** 잠김·긴급이면 안전 안내를 읽었다는 확인 */
  ack: boolean
}

/** 접수 검토 결과 (28-93): 자동 통과 / 관리자 수동 검토 */
export type ReviewStatus = 'AUTO_PASS' | 'MANUAL_REVIEW'
/** 수동 검토 사유 (28-93): 잠김 / 긴급 증상 / 작업 범위 검토 */
export type ReviewFlag = 'LOCKOUT' | 'URGENT_SYMPTOM' | 'WORK_SCOPE_REVIEW'

/** 관리자 검토 완료 기록 (28-93) — 있으면 파트너에게 공개된다 */
export interface RequestReview {
  at: string
  by: string
  note: string
}

export interface RepairRequest {
  id: string
  /** 등록한 고객 계정 ID (28-32-01) — 구 데이터에는 없다 */
  customerId?: string
  customerName: string
  region: string
  /** 상세 주소 (28-94, 참고 v12 `address`) — 낙찰 파트너·본인·관리자만 본다. 구 데이터에는 없다 */
  address?: string
  /** 연락처 (28-94, 숫자만 010…) — 낙찰 파트너·본인·관리자만 본다 */
  phone?: string
  /** 주 분야 — `categories`가 있으면 그 첫 항목과 같다 */
  category: RepairCategory
  /** 선택한 분야 전부 (28-93, 첫 항목이 주 분야) — 구 데이터에는 없다(= `[category]`) */
  categories?: RepairCategory[]
  /** 안전 질문 답변 (28-93) — 위저드로 접수한 요청에만 있다 */
  safety?: SafetyAnswers
  /** 접수 검토 결과 (28-93) — `safety`가 있을 때 함께 계산된다 */
  reviewStatus?: ReviewStatus
  reviewFlags?: ReviewFlag[]
  /** 관리자 검토 완료 (28-93) — MANUAL_REVIEW는 이것이 있어야 파트너에게 보인다 */
  review?: RequestReview
  description: string
  /** 희망 방문일 (YYYY-MM-DD) */
  desiredDate: string
  /** 고객 제시 예산 (정수 원, 선택) — 28-6-01 */
  budget?: number
  /** 희망 방문 시간대 (선택) — 28-16-02 */
  desiredTime?: DesiredTime
  /** 희망 예산 범위 표시용 라벨 (선택, 예: "30~50만원") — 28-16-02 */
  budgetRange?: string
  /** 입찰 마감일 (YYYY-MM-DD, 선택) — 28-6-01 */
  bidDeadline?: string
  /** 카테고리 질문 답변 (선택) — 28-26-02 */
  answers?: RequestAnswer[]
  /** 현장 사진 (28-48-01) — 최대 3장, 장당 200KB 이하(클라이언트 리사이즈) */
  photos?: RequestPhoto[]
  /** 시공 완료 사진 (28-49-03) — 낙찰 파트너가 시공 중~최종 결제 전까지, 같은 상한 */
  completionPhotos?: RequestPhoto[]
  /** 작업 전 사진 (28-96, 참고 v12 `before_photos`) — 방문 예정~최종 결제 전, 같은 상한. 계약 경로 작업은 완료에 필수 */
  beforePhotos?: RequestPhoto[]
  /** 요청 수정 기록 (28-52-01) — 낙찰 전 수정 시각·횟수 */
  editedAt?: string
  editCount?: number
  /** 방문 일정 변경 기록 (28-56-01) */
  rescheduledAt?: string
  rescheduleCount?: number
  /** 낙찰 파트너 (28-42-01) — acceptBid 시 기록, 구 데이터는 없음(단일 견적 폴백) */
  acceptedPartnerId?: string
  /** 결제 지연 리마인더를 보낸 완료일 (28-44-01) — 멱등 플래그 */
  paymentReminderFor?: string
  /** 입찰 마감 알림을 보낸 마감일 (28-43-01) — sweepDeadlines 멱등 키, 연장 시 초기화 */
  deadlineNotifiedFor?: string
  status: JobStatus
  createdAt: string
}

/** 파트너가 제출하는 견적 (금액은 모두 정수 원 단위) */
export interface Estimate {
  requestId: string
  partnerId: string
  laborCost: number
  materialCost: number
  transportCost: number
  discount: number
  memo?: string
}

/** 견적 계산 결과 */
export interface EstimateBreakdown {
  subtotal: number
  vat: number
  total: number
  platformFee: number
  partnerPayout: number
}

/** 파트너 방문 일정 슬롯 */
export interface ScheduleSlot {
  id: string
  partnerId: string
  requestId: string
  /** YYYY-MM-DD */
  date: string
  /** 0-23 */
  startHour: number
  /** startHour < endHour <= 24 */
  endHour: number
  /** 방문 전날 리마인더를 보낸 방문일 (28-56-03) — 멱등 키 */
  remindedFor?: string
}

/** 정산 대상 완료 작업 */
export interface CompletedJob {
  requestId: string
  partnerId: string
  /** 시공 완료일 (YYYY-MM-DD) */
  completedDate: string
  /** VAT 포함 총액 (정수 원) */
  total: number
  /** 플랫폼 수수료 (정수 원) */
  platformFee: number
  /** 승인된 추가 작업 합계 (정수 원, 28-6-02) — 구 스냅샷 호환을 위해 선택적 */
  extraTotal?: number
  /** 정산 확정 여부 (28-3-03) */
  settled: boolean
  /**
   * 완료된 환불의 순액 누계 (28-97, 정수 원). 부분 환불이 완료될 때마다 더해지고 `platformFee`는
   * (총액 − 환불) 기준으로 다시 산정된다 — 지급액 = 총액 − 환불 − 수수료. 없으면 0.
   */
  refunded?: number
  /** 지급 완료 기록 (28-38-01) — 정산 확정 후 관리자가 이체하고 남기는 근거 */
  payout?: PayoutRecord
}

export interface PayoutRecord {
  /** 지급 일시 ISO */
  paidAt: string
  /** 지급 금액 (정수 원) = 총액 − 환불 − 수수료 (28-97) */
  amount: number
  /** 지급 시점의 환불 누계·수수료 (28-97) — 지급액의 근거를 기록에 남긴다 */
  refunded?: number
  fee?: number
  /**
   * 이체 계좌 표기 — 계좌번호만 마스킹되고 **예금주는 평문**이다.
   * 28-68-04d 정정: 이 값은 **관리자 원장 CSV·운영 기록 CSV에 실명 포함으로 나간다**(이체 확인 용도).
   * 파트너 산출물(열람권 JSON·정산 CSV)에는 나가지 않는다 — 그쪽은 `accountMasked`를 쓴다.
   */
  account: string
  /**
   * 예금주까지 마스킹한 계좌 표기 (28-67-01) — 열람권 JSON·정산 CSV가 담는 값.
   * 28-67 이전에 저장된 기록에는 없다. 그 경우 산출물에서 계좌 표기가 빠진다(실명이 새는 것보다 낫다).
   */
  accountMasked?: string
}

/** 시공 중 고객이 승인한 추가 작업 (28-6-02) */
export type ExtraWorkStatus = 'pending' | 'approved' | 'rejected'

export interface ExtraWork {
  id: string
  requestId: string
  /** 금액 (정수 원, VAT 포함) — 28-96부터 `supply + vat`, 구 데이터는 이 값만 있다 */
  amount: number
  /** 공급가 (28-96, 참고 v12 `extra_works.supply`) — 구 데이터에는 없다 */
  supply?: number
  /** 부가세 = round(supply × 10%) (28-96) */
  vat?: number
  memo: string
  /** 기록일 (YYYY-MM-DD) — pending은 요청일, 결정 후에는 결정일 */
  approvedDate: string
  /** 승인 상태 (28-15-01) — 없으면 approved (구 스냅샷 하위 호환) */
  status?: ExtraWorkStatus
}

/** 고객 리뷰 (28-17-01): 완료·정산된 요청에만, 요청당 1건 */
export interface Review {
  requestId: string
  /** 별점 1~5 (정수) */
  rating: number
  text: string
  /** 작성일 (YYYY-MM-DD) */
  createdDate: string
  /** 파트너 답글 (28-53-03) */
  reply?: string
  repliedDate?: string
}

/**
 * 분쟁 접수 (28-22-01 → 28-90). 28-89까지는 A/S(보증 기간 안의 무상 재시공)와 분쟁이 따로였다.
 * 참고 v12 대조에서 하나로 합쳤다 — 고객이 "이게 A/S인지 분쟁인지"를 먼저 고르게 하는 것은 고객의 일이
 * 아니다. 접수는 하나이고, 분쟁이 열려 있는 동안 그 거래의 정산·지급은 보류된다(`markPayout`·`settle`).
 */
export type ClaimStatus = 'open' | 'in_review' | 'resolved'

export interface Claim {
  id: string
  requestId: string
  detail: string
  status: ClaimStatus
  /** 접수일 (YYYY-MM-DD) */
  createdDate: string
  resolvedDate?: string
  /** 해결 처리 내용 — resolved에서만 존재 */
  resolution?: string
  /** 파트너 답변 (28-53-02) — 최신 답변으로 덮어쓴다 */
  partnerReply?: string
  repliedDate?: string
}
