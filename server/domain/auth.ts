import type { StorageLike } from './storage'
import { hashPassword, verifyPassword, isPasswordHash, needsRehash, sha256Hex, randomSalt } from './hash'
import { DomainError } from './errors'
import { canAdmin, isAdminGrade, ADMIN_ID_RE, type AdminGrade } from './adminGrade'

/** 인증 도메인 (28-30-01, 시안 1 "로그인/가입"·시안 2 "OTP 간편가입"·시안 4 "관리자 로그인").
 *
 *  서버가 없는 현 단계의 경계:
 *  - OTP "발송"은 시뮬레이션 — register()가 코드를 반환해 화면에 표시한다.
 *    상용 전환 시 이 반환을 없애고 서버가 SMS로 발송, verifyOtp()는 서버 검증 호출로 교체된다.
 *  - 비밀번호는 솔트·반복 SHA-256 해시로 저장한다 (28-51-01, `hash.ts`). 구 스냅샷의 평문은 로드 시 해시로
 *    마이그레이션. 상용 전환 시 서버 해시(bcrypt/argon2)로 대체 — 규칙(형식·미인증 로그인 거부·역할별 세션)은 유지.
 *  - 로그인 잠금(28-51-02): 5회 실패 → 15분 잠금. OTP는 5분 만료·5회 시도. 세션은 24h(관리자 8h) 만료(28-51-03).
 */

/** 로그인 잠금 규칙 (28-51-02) */
/** 보안 이벤트 (28-58-03): 인증 쪽 행위를 감사 로그로 잇는 훅의 payload */
export interface SecurityEvent {
  action: string
  target: string
  detail?: string
}

/** 휴대폰 마스킹 (28-58-03): 감사 로그에는 원문 번호를 남기지 않는다 — 010****5678 */
export function maskPhone(phone: string): string {
  const d = phone.replace(/[^0-9]/g, '')
  if (d === '') return '(없음)'
  if (d.length < 7) return `${d.slice(0, 3)}****`
  return `${d.slice(0, 3)}****${d.slice(-4)}`
}

export const LOGIN_MAX_FAILS = 5
export const LOGIN_LOCK_MS = 15 * 60 * 1000
/**
 * 계정 단위 실패 상한 (28-72-02). 28-71-02가 잠금 키에 요청 IP를 넣어 "남이 내 계정을 잠그는" DoS를 막았는데,
 * 그 대가로 **IP를 바꾸면 카운터도 바뀌는** 상태가 됐다 — 프록시 200개면 한 계정에 15분당 1,000회를 시도할 수
 * 있다. IP와 무관한 카운터를 하나 더 둬서 그 문을 닫는다. 임계값이 5보다 훨씬 높아 DoS 비용은 6배가 되고,
 * 무차별 대입은 15분당 이 횟수로 막힌다.
 */
export const ACCOUNT_MAX_FAILS = 30
/**
 * 계정 잠금의 IP 면제 (28-73-03). 28-72-02의 계정 카운터는 무차별 대입을 막았지만, 아이디가 고정된 관리자에게는
 * "누구나 30회로 운영을 15분 멈춘다"가 되어 28-71-02가 없앤 DoS를 되살렸다. **최근 성공한 IP는 계정 잠금에서
 * 면제**하면 둘 다 성립한다: 공격자의 IP는 성공한 적이 없어 여전히 30회에 막히고, 운영자는 늘 쓰던 자리에서
 * 계속 들어온다. (계정, IP) 잠금 5회는 그대로라 그 IP에서의 무차별 대입도 여전히 막힌다.
 */
export const TRUSTED_IP_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** 계정당 기억하는 IP 수 — 스냅샷이 무한히 커지지 않게 */
export const TRUSTED_IP_MAX = 5
/**
 * 신뢰 IP 스윕 간격 (28-75-03). 28-74-02는 `login()`마다 **모든 계정 × 모든 IP**를 훑었다 —
 * 계정 1만이면 로그인 시도 한 번에 5만 번의 Map 연산이고, 무차별 대입은 정확히 그 시도를 많이 만든다.
 * 막으려는 공격이 CPU를 계정 수만큼 증폭해 먹는 구조라 게이트를 둔다.
 *
 * 만료의 목적은 "영영 남지 않게"이지 밀리초 정확도가 아니다 — 늦게 지워지는 동안에도 `isTrustedIp`가
 * TTL을 직접 보므로 **면제가 새지는 않는다**(테스트로 고정했다). 게이트 시각은 스냅샷에 남긴다:
 * 서버 모드는 요청마다 AuthService를 새로 만들어서, 메모리에만 두면 게이트가 없는 것과 같다.
 */
export const TRUSTED_IP_SWEEP_MS = 60 * 60 * 1000
/**
 * 28-77-02: **잠금·신뢰 IP 키에 원문 식별자를 담지 않는다.**
 *
 * 28-73-03의 키는 `acct|customer:01012345678` → `203.0.113.5`였다. 즉 인증 스냅샷(서버 모드에서는
 * `auth_state` 행, 로컬 모드에서는 브라우저 저장소)을 **열어 보는 것만으로** "이 번호가 어디서
 * 접속했는지"가 목록으로 읽혔다. 28-74-02의 주석이 이 사실을 적어 두었지만 만료만 다뤘다.
 * 같은 파일이 감사 로그에는 `maskKey`로 가려서 남긴다 — 로그에는 가리고 상태에는 그대로 두고 있었다.
 *
 * **막는 것과 막지 못하는 것을 분명히 한다**(이 저장소의 규율은 말과 사실을 맞추는 것이다):
 * - 막는다: **목록화.** 행을 읽어도 계정별 접속 IP 목록이 나오지 않는다. 뒤집으려면 계정마다
 *   IP 공간을 훑어야 한다(IPv6면 사실상 불가능).
 * - 막지 못한다: **지목 확인.** "이 번호가 이 IP에서 접속했나"는 해시 한 번이면 확인된다.
 *   전화번호 자체는 로그인 식별자라 `accounts`에 원문으로 남아 있다 — 이 항목이 없애는 것은
 *   그 번호와 **IP의 결합**이 눈에 보이는 것이다.
 */
const KEY_DIGEST_LEN = 32
const KEY_DIGEST_RE = /^[0-9a-f]{32}$/
/**
 * 28-78-03: **설치별 소금**을 함께 넣는다. 소금이 없으면 `sha256('customer:01012345678')`이 어느
 * 배포에서나 같은 값이라, 스테이징·프로덕션이나 서로 다른 워크스페이스의 행을 나란히 놓는 것만으로
 * "같은 사람이 두 곳에 있다"가 **번호를 몰라도** 읽힌다. 지목 확인(해시 한 번)과 달리 이것은 대상을
 * 특정하지 않고도 얻어지는 정보라 성격이 다르다 — 28-77-02가 적어 두지 않은 잔여물이었다.
 *
 * 행을 가진 사람에 대한 방어는 원래도 아니므로 잃는 것은 없다. 소금은 스냅샷에 남고, 없으면 새로 만든다.
 */
function keyDigest(salt: string, value: string): string {
  return sha256Hex(`${salt}|${value}`).slice(0, KEY_DIGEST_LEN)
}
/** 새 형식(가명) 키인가 — 옛 평문 키를 불러올 때 걸러 내는 잣대 (28-77-02) */
function isPseudonymKey(key: string): boolean {
  const bare = key.startsWith('acct|') ? key.slice(5) : key
  const parts = bare.split(':')
  if (parts.length < 2 || parts.length > 3) return false
  const [role, id, scope] = parts
  if (scope !== undefined && !KEY_DIGEST_RE.test(scope)) return false
  if (role === 'admin') return id === 'admin' || KEY_DIGEST_RE.test(id ?? '') // 28-89-A: 관리자마다 따로 잠근다(구 키 'admin' 도 받는다)
  if (role !== 'customer' && role !== 'partner') return false
  return KEY_DIGEST_RE.test(id ?? '')
}
/** OTP 규칙 (28-51-02) */
export const OTP_TTL_MS = 5 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
/**
 * 인증번호 시도 초과 뒤 쉬는 시간 (29-21-C).
 *
 * 28-51-02는 5회를 넘기면 인증번호를 **지웠다**. 그때는 `verifyOtp` 앞에 가입 코드가 있어서
 * 남의 번호로 그 5회를 태울 수 없었는데(28-71-03b), 29-21에서 가입 코드를 없애며 그 문이 열렸다.
 * 지우면 남이 내 가입을 끝낼 수 있다. 지우는 대신 쉬게 한다 — 무차별 대입은 여전히 창당 5회로
 * 막히고, 정당한 사용자는 가입을 처음부터 다시 하지 않는다. 5분 만료는 그대로다.
 */
export const OTP_LOCK_MS = 60 * 1000
/** 세션 만료 (28-51-03) */
export const SESSION_TTL_MS: Record<AuthRole, number> = {
  customer: 24 * 60 * 60 * 1000,
  partner: 24 * 60 * 60 * 1000,
  admin: 8 * 60 * 60 * 1000,
}

interface OtpRecord {
  code: string
  /** 발급 시각 epoch ms */
  issuedAt: number
  attempts: number
  /** 시도 초과로 쉬는 중이면 해제 시각 epoch ms (29-21-C) */
  lockedUntil?: number
}
interface LoginFailRecord {
  count: number
  /** 잠금 해제 시각 epoch ms */
  lockedUntil?: number
  /** 마지막 실패 시각 epoch ms (28-71-02: 오래된 기록 정리용) */
  lastAt?: number
}

export type AuthRole = 'customer' | 'partner' | 'admin'
export type SignupRole = 'customer' | 'partner'

export interface Account {
  id: string
  role: SignupRole
  name: string
  /** 010 시작 휴대폰 번호 (숫자만 저장) */
  phone: string
  /** 솔트·반복 SHA-256 해시 (28-51-01) — `s256$…`, 탈퇴 계정은 빈 문자열 */
  passwordHash: string
  /** 파트너 유형 (28-36-01): 사업자 | 개인 — 파트너 필수 */
  partnerType?: PartnerType
  /** 사업자등록번호 10자리 (사업자 파트너만) */
  bizNo?: string
  /** 사업자 정보 조회 통과 (사업자 파트너만) */
  bizVerified?: boolean
  verified: boolean
  /** 관리자 정지 (28-33-01) — 정지 계정은 로그인 거부 */
  suspended?: boolean
  /** 파트너 승인 상태 (28-34-01, 시안 4) — 파트너만, 가입 시 pending */
  approval?: PartnerApproval
  /** 거절 사유 (approval === 'rejected') */
  rejectReason?: string
  /** 약관·개인정보 동의 기록 (28-37-01) — 가입 시 필수 동의 일시 + 선택 마케팅 수신 */
  consent: ConsentRecord
  /** 정산 계좌 (28-38-01) — 파트너만, 지급의 전제 */
  payoutAccount?: PayoutAccount
  /** 탈퇴 일시 (28-39-01) — 설정되면 식별 정보는 파기된 상태, 기록은 법정 보관 후 관리자가 파기 */
  withdrawnAt?: string
  /**
   * 이메일 (29-27) — 소문자로 정규화해 저장. 비밀번호 찾기의 두 번째 길이다.
   * **인증된 것만 복구에 쓴다**(`emailVerifiedAt`) — 오타로 적은 남의 주소로 내 복구 코드가 가면 안 된다.
   */
  email?: string
  /** 이메일 인증 완료 시각 ISO (29-27). 주소를 바꾸면 지워진다 */
  emailVerifiedAt?: string
  createdAt: string
}

export interface PayoutAccount {
  /** 은행명 (예: 국민은행) */
  bank: string
  /** 계좌번호 숫자만 10~14자리 */
  number: string
  /** 예금주 — 가입한 이름(실명·상호)과 같아야 등록된다 (28-90) */
  holder: string
  /** 등록·수정 일시 ISO */
  updatedAt: string
  /**
   * 관리자 인증 (28-90). 예금주가 가입 이름과 같은 것은 코드가 확인하지만, 그 계좌가 실제로 그 사람
   * 것인지는 관리자가 외부에서 확인하고 여기 기록한다. 계좌를 바꾸면 인증은 사라진다. 인증 전에는 지급되지 않는다.
   */
  verifiedAt?: string
  verifiedBy?: string
}

/** 계좌번호 마스킹 — 앞 3자리·뒤 3자리만 노출 (28-38-01) */
export function maskAccountNumber(n: string): string {
  if (n.length <= 6) return '*'.repeat(n.length)
  return `${n.slice(0, 3)}${'*'.repeat(n.length - 6)}${n.slice(-3)}`
}

/** 계좌 한 줄 표기 (계좌번호만 마스킹) — 파트너·관리자 **화면** 공용. 예금주는 평문이다 */
export function payoutAccountLabel(a: PayoutAccount): string {
  return `${a.bank} ${maskAccountNumber(a.number)} (${a.holder})`
}

/**
 * 예금주 마스킹 (28-67-01) — 첫 글자만 남긴다.
 * `assertNoRealIdentifiers`가 3자 미만 토큰을 건너뛰므로, 2자 이름도 `김*`이 되어 대조에 걸리지 않는다.
 */
export function maskHolder(h: string): string {
  const v = h.trim()
  if (v.length <= 1) return '*'
  return `${v.slice(0, 1)}${'*'.repeat(v.length - 1)}`
}

/**
 * 내보내기용 계좌 표기 (28-67-01) — **예금주까지** 마스킹한다.
 *
 * 화면용 `payoutAccountLabel`은 계좌번호만 가려서 예금주 실명이 그대로 남는다. 그 문자열이
 * `payout.account`에 통째로 저장되고 열람권 JSON에 실리면, 예금주가 가입명과 같은 흔한 경우
 * `exportPartnerData`의 자체 검사(`assertNoRealIdentifiers`)가 잡아 **본인 열람권이 실패한다.**
 * 그래서 파일로 나가는 산출물(열람권 JSON·정산 CSV)은 이쪽을 쓴다.
 */
export function payoutAccountLabelMasked(a: PayoutAccount): string {
  return `${a.bank} ${maskAccountNumber(a.number)} (${maskHolder(a.holder)})`
}

/**
 * 지급 계좌 표기 한 쌍 (28-67-01).
 * `label`은 예금주 실명이 든 운영 내부 표기, `masked`는 파일로 나가도 되는 표기다.
 * 하나의 문자열로 합쳐 두면 **호출부가 어느 쪽이 필요한지 고를 수 없다** — 28-67-01이 정확히 그 사고였다.
 */
export interface PayoutAccountLabels {
  label: string
  masked: string
  /** 28-90: 관리자 인증을 거친 계좌인가 — `markPayout`이 인증 전 지급을 거부한다 */
  verified: boolean
}

/** 계좌 하나에서 표기 두 벌을 만든다 (28-67-01) — 관리자 지급 화면이 `markPayout`에 넘긴다 */
export function payoutAccountLabels(a: PayoutAccount): PayoutAccountLabels {
  return { label: payoutAccountLabel(a), masked: payoutAccountLabelMasked(a), verified: a.verifiedAt !== undefined }
}

/** 예금주 비교용 — 공백만 뺀다. "반듯 설비"와 "반듯설비"는 같은 이름이다 */
export function normalizeHolder(v: string): string {
  return v.replace(/\s+/g, '')
}

export interface ConsentRecord {
  /** 이용약관(필수) 동의 일시 ISO */
  termsAt: string
  /** 개인정보 수집·이용(필수) 동의 일시 ISO */
  privacyAt: string
  /** 마케팅 수신(선택) 현재 상태 */
  marketing: boolean
  /** 마케팅 수신 동의·철회 최종 변경 일시 (한 번도 동의하지 않았으면 없음) */
  marketingAt?: string
}

export type PartnerApproval = 'pending' | 'approved' | 'rejected'
export type PartnerType = 'business' | 'individual'
export const PARTNER_TYPE_LABEL: Record<PartnerType, string> = { business: '사업자', individual: '개인' }

/** 국세청 사업자등록번호 검증 규칙 (28-36-01): 가중치 1·3·7·1·3·7·1·3·5, 9번째 자리×5의 십의 자리 가산,
 *  검증 자리 = (10 − 합%10)%10. 형식·체크섬만 검증한다(휴폐업 상태는 조회 API 영역). */
export function isValidBusinessNumber(raw: string): boolean {
  const d = raw.replace(/[^0-9]/g, '')
  if (!/^\d{10}$/.test(d)) return false
  if (/^(\d)\1{9}$/.test(d)) return false // 0000000000 같은 동일 숫자 반복은 체크섬을 통과하므로 별도 거부
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  let sum = 0
  for (let i = 0; i < 9; i += 1) sum += Number(d[i]) * w[i]!
  sum += Math.floor((Number(d[8]) * 5) / 10)
  return (10 - (sum % 10)) % 10 === Number(d[9])
}

/** 사업자 정보 조회 경계 (28-36-01) — 현재: 체크섬 검증. 상용 전환: 국세청 진위확인 API(서버 호출)로 교체. */
export function verifyBusiness(bizNo: string): boolean {
  return isValidBusinessNumber(bizNo)
}

/** 관리자용 계정 뷰 — 비밀번호 해시 제외 */
export type AccountView = Omit<Account, 'passwordHash'>

/**
 * 관리자 계정 (28-89-A). 28-88까지는 `admin` 하나뿐이었고 비밀번호 해시만 따로 들고 있었다.
 * 이제 여럿이고 등급이 있다. 첫 소유자는 언제나 `admin`이다 — 구 스냅샷의 해시가 그 계정으로 옮겨진다.
 */
export interface AdminAccount {
  id: string
  name: string
  grade: AdminGrade
  passwordHash: string
  createdAt: string
  /** 누가 만들었나 — 첫 소유자는 'seed' */
  createdBy: string
}
export type AdminAccountView = Omit<AdminAccount, 'passwordHash'>

export interface AuthSession {
  role: AuthRole
  name: string
  /** 계정 ID (관리자는 관리자 아이디) */
  accountId: string
  /** 발급·만료 시각 ISO (28-51-03) */
  issuedAt: string
  expiresAt: string
  /** 28-89-A: 관리자 세션의 등급 — 화면·서버가 이것으로 버튼과 op 를 연다. 다른 역할은 없다 */
  grade?: AdminGrade
}

interface AuthSnapshot {
  version: 1
  accounts: Account[]
  accountSeq: number
  /** 발급된 미사용 OTP: "role:phone" → 기록 (구 스냅샷은 code 문자열) */
  otps: Array<[string, OtpRecord | string]>
  /** 역할별 독립 세션 — 한 브라우저 시연 전제 */
  sessions: Array<[AuthRole, AuthSession]>
  /** 28-51-01: 관리자 비밀번호 해시 (구 스냅샷은 adminPassword 평문) — 28-89부터는 `admins`로 옮겨진다 */
  adminPasswordHash?: string
  adminPassword?: string
  /** 28-89-A: 관리자 계정들 — 없으면 위 해시로 소유자 `admin` 하나를 만든다 */
  admins?: AdminAccount[]
  /** 28-51-02: 로그인 실패·잠금 */
  loginFails?: Array<[string, LoginFailRecord]>
  /** 28-73-03: 계정별 최근 성공 IP — 계정 잠금의 면제 대상 */
  trustedIps?: Array<[string, Array<[string, number]>]>
  /** 28-75-03: 마지막 신뢰 IP 스윕 시각 — 게이트가 서버리스에서도 살아 있게 */
  trustedSweptAt?: number
  /** 28-78-03: 설치별 소금 — 가명 키가 배포를 넘어 대조되지 않게 */
  keySalt?: string
  /** 28-55-03: 저장 리비전 — 탭 간 세션 동기화 */
  rev?: number
}

export class AuthError extends DomainError {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export const AUTH_STORAGE_KEY = 'banded-auth-v1'
/** 관리자 데모 계정 (시드) — 상용 전환 시 서버 계정으로 대체 */
export const ADMIN_ID = 'admin'
export const ADMIN_INITIAL_PASSWORD = 'bandut1234!'

const normalizePhone = (raw: string) => raw.replace(/[^0-9]/g, '')

/** 29-12: 재설정 인증번호의 키 접두사 — 가입 인증(`role:phone`)과 섞이지 않게 */
const RESET_PREFIX = 'reset:'
/** 29-27: 이메일로 받은 재설정 인증번호 — 휴대폰 재설정(`reset:role:phone`)과도 섞이지 않게 */
const RESET_EMAIL_PREFIX = 'reset:email:'
/** 29-27: 이메일 인증번호 — 계정 단위(`emailverify:role:accountId`) */
const EMAIL_VERIFY_PREFIX = 'emailverify:'

/**
 * 이메일 정규화 (29-27) — 앞뒤 공백을 버리고 소문자로. 사람이 대문자로 적어도 같은 주소다.
 * 도메인 부분만 소문자로 하는 것이 엄밀하지만, 로컬 파트를 대소문자로 구분하는 메일 서버는 실제로
 * 없다시피 하고 사용자는 그 차이를 모른다 — 같은 사람이 두 번 등록되는 쪽이 더 나쁘다.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** 이메일 모양인가 — 엄격한 RFC 가 아니라 "메일이 갈 수 있는 모양"이다. 진짜 검증은 인증번호가 한다 */
export function isEmailAddress(v: string): boolean {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
}

/**
 * 여섯 자리 인증번호 (29-27 자체 감사 07).
 *
 * 전에는 세 자리에서 `Math.random` 을 따로 썼다. 이 번호는 비밀번호를 바꾸는 문이라 예측 가능하면 안 된다 —
 * WebCrypto 의 난수를 쓰고, 2^32 를 900000 으로 나눈 나머지 구간은 버려 편향을 없앤다. 브라우저와 Node 양쪽에
 * `globalThis.crypto` 가 있다(이 파일은 둘 다에서 돈다).
 */
function newOtp(): string {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => void } }).crypto
  if (!c?.getRandomValues) throw new AuthError('이 환경에는 안전한 난수원이 없습니다')
  const buf = new Uint32Array(1)
  const span = 900000
  const limit = 4294967296 - (4294967296 % span)
  let v: number
  do {
    c.getRandomValues(buf)
    v = buf[0]!
  } while (v >= limit)
  return String(100000 + (v % span))
}

/** 감사 로그용 마스킹 — `k***@example.com`. 로컬 파트 첫 글자만 남긴다 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '(없음)'
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

/** 재설정 대상이 휴대폰인가 이메일인가 — `@` 하나로 가른다. 휴대폰 번호에는 `@` 가 없다 */
export type RecoveryChannel = 'phone' | 'email'
export function recoveryChannelOf(target: string): RecoveryChannel {
  return target.includes('@') ? 'email' : 'phone'
}

/**
 * 같은 곳으로 인증번호를 다시 내는 최소 간격 (29-27 자체 감사 02).
 *
 * 인증번호 발급은 곧 **메일 한 통**이다. 간격이 없으면 로그인한 사람이 `setEmail` 을 돌려 남의 메일함을
 * 넘치게 하거나, 아는 주소로 `requestPasswordReset` 을 돌려 발송사 평판을 태울 수 있다. 60초 안에 다시
 * 요청하면 새로 만들지도 보내지도 않는다 — 재설정 쪽은 응답 모양이 같아야 하므로 조용히(`to: null`),
 * 이메일 등록 쪽은 본인 세션이라 남은 시간을 말해 준다.
 */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000

export class AuthService {
  private accounts: Account[] = []
  private accountSeq = 0
  private otps = new Map<string, OtpRecord>()
  private sessions = new Map<AuthRole, AuthSession>()
  /** 28-89-A: 관리자 계정들. 처음에는 시연 소유자 하나 */
  private admins: AdminAccount[] = [AuthService.seedOwner()]
  private loginFails = new Map<string, LoginFailRecord>()
  /** 28-73-03: 계정 키 → (IP → 마지막 성공 시각) */
  private trustedIps = new Map<string, Map<string, number>>()
  /** 28-75-03: 마지막 스윕 시각 — `TRUSTED_IP_SWEEP_MS` 간격으로만 전체를 훑는다 */
  private trustedSweptAt = 0
  /** 28-78-03: 이 설치의 키 소금 — 생성 시 새로 만들고, 스냅샷이 있으면 그것을 쓴다 */
  private keySalt = randomSalt()
  /** 보안 이벤트 통지 (28-58-03) — PlatformProvider가 감사 로그로 잇는다. 미설정이면 아무 일도 하지 않는다 */
  onSecurityEvent: ((e: SecurityEvent) => void) | undefined
  private rev = 0
  private readonly storage: StorageLike | undefined
  /**
   * 거울 모드 (28-70). 서버 모드의 클라이언트는 계정·세션의 **사본**만 들고 있다 — 읽기(`sessionFor`·`listAccounts`·
   * `accountFor`)는 그대로 동기로 쓰되, 규칙을 적용하는 변경 메서드는 서버(`api/auth.ts`)가 같은 클래스로 돌린다.
   * 거울에서 변경 메서드를 직접 부르면 **던진다** — 호출부를 빠뜨렸을 때 조용히 갈라지지 않게.
   */
  private readonly mirror: boolean

  constructor(storage?: StorageLike, options: { mirror?: boolean } = {}) {
    this.storage = storage
    this.mirror = options.mirror === true
    this.load()
  }

  /** 거울 모드면 던진다 — 변경 메서드의 첫 줄 */
  private assertWritable(): void {
    if (this.mirror) throw new AuthError('서버 모드에서는 이 작업이 서버를 거칩니다 — authActions를 쓰세요')
  }

  /** 거울 모드인가 (28-70) */
  get isMirror(): boolean {
    return this.mirror
  }

  /**
   * 서버가 발급한 세션을 받아들인다 (28-70). 서버 쪽에서는 요청의 세션을 AuthService에 심는 데도 쓴다
   * (`withdraw`·`setPayoutAccount` 같은 메서드가 `sessions.get(role)`을 본다).
   */
  adoptSession(session: AuthSession): void {
    // 같은 세션이면 쓰지 않는다 — 저장이 storage 이벤트를 내고, 그 이벤트가 다른 탭의 복원(me)을 부르고,
    // 그 복원이 다시 여기로 오면 탭 둘이 영원히 핑퐁한다(서버 모드 e2e에서 실제로 났다)
    const cur = this.sessions.get(session.role)
    if (
      cur &&
      cur.accountId === session.accountId &&
      cur.expiresAt === session.expiresAt &&
      cur.issuedAt === session.issuedAt &&
      cur.name === session.name &&
      cur.grade === session.grade
    )
      return
    this.sessions.set(session.role, { ...session })
    this.save()
  }

  /**
   * 서버가 준 계정 뷰를 거울에 넣는다 (28-70). `complete`면 목록 전체를 교체(관리자), 아니면 있는 것만 갱신·추가.
   * 비밀번호 해시는 서버에만 있다 — 거울의 해시는 빈 문자열이라 거울에서는 어떤 비밀번호도 맞지 않는다.
   */
  applyMirror(accounts: AccountView[], complete: boolean, admins?: AdminAccountView[]): void {
    // 28-89-A: 관리자 목록도 거울이다 — 해시는 서버에만 있다
    if (admins !== undefined) {
      const nextAdmins = admins.map((a) => ({ ...a, passwordHash: '' }))
      if (JSON.stringify(nextAdmins) !== JSON.stringify(this.admins)) {
        this.admins = nextAdmins
        this.save()
      }
    }
    const incoming = accounts.map((a) => ({ ...a, passwordHash: '' }) as Account)
    const before = JSON.stringify(this.accounts)
    let next: Account[]
    if (complete) {
      next = incoming
    } else {
      next = this.accounts.map((a) => ({ ...a }))
      for (const a of incoming) {
        const i = next.findIndex((x) => x.id === a.id)
        if (i >= 0) next[i] = a
        else next.push(a)
      }
    }
    if (JSON.stringify(next) === before) return // 바뀐 것이 없으면 쓰지 않는다 (adoptSession과 같은 이유)
    this.accounts = next
    this.save()
  }

  /**
   * 서버 저장용 직렬화 (28-70) — 브라우저 세션과 저장 리비전을 **뺀** 상태. 서버 행의 rev는 저장소가 발급하고,
   * 세션은 `sessions` 테이블이 맡는다. 같은 상태면 같은 문자열이라 변경 감지에 쓴다.
   */
  exportState(): string {
    const snap: AuthSnapshot = {
      version: 1,
      accounts: this.accounts.map((a) => ({ ...a })),
      accountSeq: this.accountSeq,
      otps: [...this.otps.entries()],
      sessions: [],
      admins: this.admins.map((a) => ({ ...a })),
      loginFails: [...this.loginFails.entries()],
      trustedIps: [...this.trustedIps.entries()].map(
        ([k, v]) => [k, [...v.entries()]] as [string, Array<[string, number]>],
      ),
      trustedSweptAt: this.trustedSweptAt,
      keySalt: this.keySalt,
    }
    return JSON.stringify(snap)
  }

  private load(): void {
    if (!this.storage) return
    let raw: string | null = null
    try {
      raw = this.storage.getItem(AUTH_STORAGE_KEY)
    } catch {
      return
    }
    if (raw === null) return
    let migrated = false
    try {
      const snap = JSON.parse(raw) as Omit<AuthSnapshot, 'accounts'> & {
        accounts: Array<Account & { password?: string }>
      }
      if (snap.version !== 1 || !Array.isArray(snap.accounts) || !Number.isInteger(snap.accountSeq)) {
        throw new AuthError('형식')
      }
      this.rev = Number.isInteger(snap.rev) && snap.rev! >= 0 ? snap.rev! : 0
      snap.accounts.forEach((a) => {
        if (
          typeof a?.id !== 'string' ||
          (a.role !== 'customer' && a.role !== 'partner') ||
          typeof a.name !== 'string' ||
          a.name.trim() === '' ||
          typeof a.phone !== 'string' ||
          (typeof a.passwordHash !== 'string' && typeof a.password !== 'string') ||
          typeof a.verified !== 'boolean' ||
          (a.suspended !== undefined && typeof a.suspended !== 'boolean') ||
          (a.approval !== undefined && !['pending', 'approved', 'rejected'].includes(a.approval)) ||
          (a.partnerType !== undefined && a.partnerType !== 'business' && a.partnerType !== 'individual') ||
          typeof a.consent?.termsAt !== 'string' ||
          typeof a.consent.privacyAt !== 'string' ||
          typeof a.consent.marketing !== 'boolean' ||
          (a.withdrawnAt !== undefined && typeof a.withdrawnAt !== 'string') ||
          (a.email !== undefined && typeof a.email !== 'string') ||
          (a.emailVerifiedAt !== undefined && typeof a.emailVerifiedAt !== 'string') ||
          (a.payoutAccount !== undefined &&
            (typeof a.payoutAccount?.bank !== 'string' ||
              typeof a.payoutAccount.number !== 'string' ||
              !/^\d{10,14}$/.test(a.payoutAccount.number) ||
              typeof a.payoutAccount.holder !== 'string' ||
              typeof a.payoutAccount.updatedAt !== 'string' ||
              (a.payoutAccount.verifiedAt !== undefined && typeof a.payoutAccount.verifiedAt !== 'string')))
        ) {
          throw new AuthError('계정 형식')
        }
      })
      const now = Date.now()
      // 28-51-01: 구 스냅샷(평문 password) → 해시 마이그레이션. 탈퇴 계정(빈 문자열)은 빈 해시 유지
      this.accounts = snap.accounts.map((a) => {
        const { password, ...rest } = a
        if (typeof rest.passwordHash === 'string' && (rest.passwordHash === '' || isPasswordHash(rest.passwordHash)))
          return { ...rest }
        migrated = true
        return { ...rest, passwordHash: password === undefined || password === '' ? '' : hashPassword(password) }
      })
      this.accountSeq = snap.accountSeq
      // 28-51-02: 구 OTP(문자열) → 기록으로. 발급 시각은 로드 시각
      this.otps = new Map(
        (Array.isArray(snap.otps) ? snap.otps : []).map(([k, v]) => {
          if (typeof v === 'string') {
            migrated = true
            return [k, { code: v, issuedAt: now, attempts: 0 }] as [string, OtpRecord]
          }
          return [k, { ...v }] as [string, OtpRecord]
        }),
      )
      // 28-51-03: 구 세션(만료 없음) → 로드 시각부터 TTL
      this.sessions = new Map(
        (Array.isArray(snap.sessions) ? snap.sessions : []).map(([role, se]) => {
          if (typeof se.expiresAt !== 'string' || typeof se.issuedAt !== 'string') {
            migrated = true
            return [
              role,
              {
                ...se,
                issuedAt: new Date(now).toISOString(),
                expiresAt: new Date(now + SESSION_TTL_MS[role]).toISOString(),
              },
            ] as [AuthRole, AuthSession]
          }
          return [role, { ...se }] as [AuthRole, AuthSession]
        }),
      )
      // 28-89-A: 관리자 계정 목록. 구 스냅샷은 해시 하나뿐이라 그것으로 소유자 `admin`을 만든다.
      const admins = Array.isArray(snap.admins) ? snap.admins.filter(AuthService.isAdminAccount) : []
      if (admins.length > 0 && admins.some((a) => a.grade === 'owner')) {
        this.admins = admins.map((a) => ({ ...a }))
      } else {
        let hash: string | undefined
        if (typeof snap.adminPasswordHash === 'string' && isPasswordHash(snap.adminPasswordHash))
          hash = snap.adminPasswordHash
        else if (typeof snap.adminPassword === 'string') hash = hashPassword(snap.adminPassword)
        this.admins = [{ ...AuthService.seedOwner(), ...(hash !== undefined ? { passwordHash: hash } : {}) }]
        migrated = true
      }
      // 28-77-02: 옛 평문 키(`customer:01012345678:203.0.113.5`)는 버린다. 남기면 가명화가 반쪽이 되고,
      //   버리는 방향은 안전하다 — 실패 기록이 사라지면 잠금이 풀릴 뿐 잠기지 않는다(15분짜리 기록이다).
      this.loginFails = new Map(
        Array.isArray(snap.loginFails)
          ? snap.loginFails
              .filter(([k]) => typeof k === 'string' && isPseudonymKey(k))
              .map(([k, v]) => [k, { ...v }] as [string, LoginFailRecord])
          : [],
      )
      // 28-74 리뷰: `[string, 유한한 number]`만 받는다. `typeof at === 'number'`만 보면
      //   `Infinity`가 통과해 `now - at <= TTL`이 **항상** 참이 되고(영구 면제), `NaN`은 TTL 정리에도
      //   상한 정렬에도 걸리지 않아 자리만 차지하다 진짜 IP를 밀어낸다. 문자열 아닌 키는 조회되지 않는 죽은 항목이다.
      this.trustedIps = new Map(
        Array.isArray(snap.trustedIps)
          ? snap.trustedIps
              // 28-77-02: 옛 평문 키·평문 IP는 버린다. 면제가 사라지는 방향이라 안전하다(잠금이 그대로 걸린다)
              .filter(
                (e) => Array.isArray(e) && typeof e[0] === 'string' && isPseudonymKey(e[0]) && Array.isArray(e[1]),
              )
              .map(
                ([k, v]) =>
                  [
                    k,
                    new Map(
                      v.filter(
                        (p) =>
                          Array.isArray(p) &&
                          typeof p[0] === 'string' &&
                          KEY_DIGEST_RE.test(p[0]) &&
                          Number.isFinite(p[1]),
                      ),
                    ),
                  ] as [string, Map<string, number>],
              )
          : [],
      )
      this.trustedSweptAt = Number.isFinite(snap.trustedSweptAt) ? (snap.trustedSweptAt as number) : 0
      // 28-78-03: 소금이 있으면 그것을 쓴다. 없으면(소금 이전 스냅샷) 새 소금이 유지되고, 옛 소금으로
      //   만든 키는 이제 아무것과도 맞지 않으므로 여기서 버린다 — 남겨 두면 조회되지 않는 죽은 항목이
      //   자리만 차지하고(신뢰 IP 상한 5를 밀어낸다), 버리는 방향은 안전하다(면제가 사라져 잠금이 걸린다).
      if (typeof snap.keySalt === 'string' && snap.keySalt !== '') {
        this.keySalt = snap.keySalt
      } else {
        this.loginFails.clear()
        this.trustedIps.clear()
        migrated = true
      }
      if (migrated) this.save()
    } catch {
      // 손상 데이터 — 조용한 오동작 대신 초기화
      try {
        this.storage.removeItem(AUTH_STORAGE_KEY)
      } catch {
        // 저장소 접근 불가 — 무시
      }
    }
  }

  private save(): void {
    if (!this.storage) {
      this.rev += 1
      return
    }
    this.rev += 1
    const snap: AuthSnapshot = {
      version: 1,
      rev: this.rev,
      accounts: this.accounts.map((a) => ({ ...a })),
      accountSeq: this.accountSeq,
      otps: [...this.otps.entries()],
      sessions: [...this.sessions.entries()],
      admins: this.admins.map((a) => ({ ...a })),
      loginFails: [...this.loginFails.entries()],
      trustedIps: [...this.trustedIps.entries()].map(
        ([k, v]) => [k, [...v.entries()]] as [string, Array<[string, number]>],
      ),
      trustedSweptAt: this.trustedSweptAt,
      keySalt: this.keySalt,
    }
    try {
      this.storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(snap))
      this.storage.setItem(`${AUTH_STORAGE_KEY}:rev`, String(this.rev))
    } catch {
      // 저장 불가 환경 — 동작은 계속
    }
  }

  /** 현재 리비전 (28-55-03) */
  get revision(): number {
    return this.rev
  }

  /** 저장소 동기화 (28-55-03): 다른 탭의 로그인·로그아웃·잠금이 반영된다. 변경이 있었으면 true */
  syncFromStorage(): boolean {
    if (!this.storage) return false
    let stored: string | null
    try {
      stored = this.storage.getItem(`${AUTH_STORAGE_KEY}:rev`)
    } catch {
      return false
    }
    if (stored === null || Number(stored) === this.rev) return false
    this.load()
    return true
  }

  /** 가입 — 검증 통과 시 미인증 계정 생성 + OTP 발급(시뮬레이션 반환) */
  register(input: {
    role: SignupRole
    name: string
    phone: string
    password: string
    partnerType?: PartnerType
    bizNo?: string
    /** 이용약관(필수) 동의 */
    agreeTerms: boolean
    /** 개인정보 수집·이용(필수) 동의 */
    agreePrivacy: boolean
    /** 마케팅 수신(선택) 동의 */
    marketing?: boolean
    /** 이메일 (29-27, 선택) — 비밀번호 찾기의 두 번째 길. 가입 때는 미인증으로 두고 내 계정에서 인증한다 */
    email?: string
  }): { account: Account; otp: string } {
    this.assertWritable()
    if (input.role !== 'customer' && input.role !== 'partner') {
      throw new AuthError(`알 수 없는 역할: ${String(input.role)}`)
    }
    const name = input.name.trim()
    if (name === '') throw new AuthError('이름을 입력하세요')
    const phone = normalizePhone(input.phone)
    if (!/^010\d{7,8}$/.test(phone)) throw new AuthError('휴대폰 번호는 010으로 시작하는 10~11자리여야 합니다')
    if (input.password.length < 8) throw new AuthError('비밀번호는 8자 이상이어야 합니다')
    const email = input.email === undefined || input.email.trim() === '' ? undefined : normalizeEmail(input.email)
    if (email !== undefined) this.assertEmailUsable(input.role, email)
    if (input.agreeTerms !== true || input.agreePrivacy !== true) {
      throw new AuthError('필수 약관(이용약관·개인정보 수집·이용)에 동의해 주세요')
    }
    let bizNo: string | undefined
    let partnerType: PartnerType | undefined
    if (input.role === 'partner') {
      if (input.partnerType !== 'business' && input.partnerType !== 'individual') {
        throw new AuthError('파트너 유형(사업자/개인)을 선택하세요')
      }
      partnerType = input.partnerType
      if (partnerType === 'business') {
        bizNo = normalizePhone(input.bizNo ?? '')
        if (!/^\d{10}$/.test(bizNo)) throw new AuthError('사업자등록번호는 숫자 10자리여야 합니다')
        if (!verifyBusiness(bizNo)) {
          throw new AuthError('사업자 정보 조회에 실패했습니다 — 사업자등록번호를 다시 확인해 주세요')
        }
      }
    }
    if (this.accounts.some((a) => a.role === input.role && a.phone === phone && !a.withdrawnAt)) {
      throw new AuthError('이미 가입된 휴대폰 번호입니다 — 로그인해 주세요')
    }
    this.accountSeq += 1
    const now = new Date().toISOString()
    const account: Account = {
      id: `AC-${String(this.accountSeq).padStart(4, '0')}`,
      role: input.role,
      name,
      phone,
      passwordHash: hashPassword(input.password),
      ...(partnerType ? { partnerType } : {}),
      ...(bizNo ? { bizNo, bizVerified: true } : {}),
      ...(input.role === 'partner' ? { approval: 'pending' as const } : {}),
      ...(email !== undefined ? { email } : {}),
      verified: false,
      consent: {
        termsAt: now,
        privacyAt: now,
        marketing: input.marketing === true,
        ...(input.marketing === true ? { marketingAt: now } : {}),
      },
      createdAt: now,
    }
    this.accounts.push(account)
    const otp = newOtp()
    this.otps.set(`${input.role}:${phone}`, { code: otp, issuedAt: Date.now(), attempts: 0 })
    this.save()
    return { account: { ...account }, otp }
  }

  /** 휴대폰 본인인증 — 코드 일치 시 verified. 5분 만료·5회 시도 (28-51-02) */
  verifyOtp(role: SignupRole, phoneRaw: string, code: string, now: number = Date.now()): Account {
    this.assertWritable()
    const phone = normalizePhone(phoneRaw)
    const key = `${role}:${phone}`
    const rec = this.otps.get(key)
    if (!rec) throw new AuthError('발급된 인증번호가 없습니다 — 다시 가입해 주세요')
    if (now - rec.issuedAt > OTP_TTL_MS) {
      this.otps.delete(key)
      this.save()
      throw new AuthError('인증번호가 만료되었습니다 (5분) — 다시 가입해 주세요')
    }
    // 29-21-C: 쉬는 중이면 맞는 번호라도 받지 않는다. 기록은 지우지 않는다 — 남이 내 가입을 끝내지 못한다
    if (rec.lockedUntil !== undefined && now < rec.lockedUntil) {
      throw new AuthError(
        `인증 시도가 많았습니다 — 잠시 뒤(${Math.ceil((rec.lockedUntil - now) / 1000)}초) 다시 시도해 주세요`,
      )
    }
    if (rec.lockedUntil !== undefined) {
      delete rec.lockedUntil
      rec.attempts = 0
    }
    if (rec.code !== code.trim()) {
      rec.attempts += 1
      if (rec.attempts >= OTP_MAX_ATTEMPTS) {
        rec.lockedUntil = now + OTP_LOCK_MS
        this.save()
        this.emit(
          'OTP 시도 초과',
          AuthService.maskKey(key),
          `${OTP_MAX_ATTEMPTS}회 초과 — ${OTP_LOCK_MS / 1000}초 대기`,
        )
        throw new AuthError(`인증 시도 ${OTP_MAX_ATTEMPTS}회를 초과했습니다 — 잠시 뒤 다시 시도해 주세요`)
      }
      this.save()
      throw new AuthError(`인증번호가 일치하지 않습니다 (남은 시도 ${OTP_MAX_ATTEMPTS - rec.attempts}회)`)
    }
    const account = this.accounts.find((a) => a.role === role && a.phone === phone)
    if (!account) throw new AuthError('계정을 찾을 수 없습니다')
    account.verified = true
    this.otps.delete(key)
    this.save()
    return { ...account }
  }

  /**
   * 비밀번호 재설정 요청 (29-12).
   *
   * ## 가입용 인증을 재사용하지 않는다
   *
   * 가입 OTP는 `role:phone`에, 재설정 OTP는 `reset:role:phone`에 둔다. 키가 다르므로 한쪽 코드로
   * 다른 쪽을 통과할 수 없다 — `verifyOtp`는 앞의 키만, `resetPassword`는 뒤의 키만 본다.
   * 목적이 섞이면 "가입 확인"이 곧 "비밀번호 바꾸기"가 된다.
   *
   * ## 계정이 있는지 알려 주지 않는다
   *
   * 없는 번호에도 코드를 **돌려주되 저장하지 않는다**. 응답만 보고 가입 여부를 훑을 수 없다.
   * 저장하지 않으므로 뒤이은 재설정은 "인증번호가 없다"에서 멈춘다.
   */
  /**
   * 29-27: `target` 은 휴대폰 번호이거나 **이메일**이다(`recoveryChannelOf`). 이메일은 **인증된 것만**
   * 계정으로 인정한다 — 미인증 주소는 없는 주소와 같은 답을 받는다(코드는 돌려주되 저장하지 않는다).
   *
   * `to` 는 서버가 실제로 보낼 곳이다 — 계정이 없으면 `null`. 서버는 그때 아무것도 보내지 않는다.
   * 응답 모양은 같으므로 밖에서는 구분할 수 없다.
   */
  requestPasswordReset(
    role: SignupRole,
    target: string,
    now: number = Date.now(),
  ): { otp: string; channel: RecoveryChannel; to: string | null } {
    this.assertWritable()
    if (role !== 'customer' && role !== 'partner') throw new AuthError(`알 수 없는 역할: ${String(role)}`)
    const { channel, value, key } = this.recoveryTarget(role, target)
    const account = this.findRecoverable(role, channel, value)
    if (!account) return { otp: newOtp(), channel, to: null }
    // 자체 감사 02: 방금 낸 코드가 살아 있으면 같은 코드를 돌려주고 **보내지 않는다** — 밖에서는 구분할 수 없다
    const live = this.otps.get(key)
    if (live !== undefined && now - live.issuedAt < OTP_RESEND_COOLDOWN_MS) return { otp: live.code, channel, to: null }
    const otp = newOtp()
    this.otps.set(key, { code: otp, issuedAt: now, attempts: 0 })
    this.save()
    return { otp, channel, to: value }
  }

  /**
   * 메일이 나가지 못했을 때 방금 낸 재설정 코드를 버린다 (29-27 자체 감사 05).
   *
   * 서버는 이때도 **같은 모양으로** 답해야 한다 — 502 를 돌려주면 "이 주소에 계정이 있다"가 새어 나간다.
   * 코드를 버려 두면 다음 요청이 간격 제한에 걸리지 않고 새 코드를 낸다.
   */
  discardPasswordReset(role: SignupRole, target: string): void {
    this.assertWritable()
    const { key } = this.recoveryTarget(role, target)
    if (this.otps.delete(key)) this.save()
  }

  /** 복구 대상을 정규화하고 그 갈래의 코드 키를 만든다 — 모양이 틀리면 여기서 던진다 */
  private recoveryTarget(role: SignupRole, target: string): { channel: RecoveryChannel; value: string; key: string } {
    const channel = recoveryChannelOf(target)
    if (channel === 'email') {
      const email = normalizeEmail(target)
      if (!isEmailAddress(email)) throw new AuthError('이메일 주소 모양이 아닙니다')
      return { channel, value: email, key: RESET_EMAIL_PREFIX + `${role}:${email}` }
    }
    const phone = normalizePhone(target)
    if (!/^010\d{7,8}$/.test(phone)) throw new AuthError('휴대폰 번호는 010으로 시작하는 10~11자리여야 합니다')
    return { channel, value: phone, key: RESET_PREFIX + `${role}:${phone}` }
  }

  /** 복구할 수 있는 계정 — 휴대폰은 그 번호의 활성 계정, 이메일은 **인증된** 주소의 활성 계정 */
  private findRecoverable(role: SignupRole, channel: RecoveryChannel, value: string): Account | undefined {
    return this.accounts.find(
      (a) =>
        a.role === role &&
        !a.withdrawnAt &&
        (channel === 'email' ? a.email === value && a.emailVerifiedAt !== undefined : a.phone === value),
    )
  }

  /**
   * 비밀번호 재설정 (29-12) — 만료·시도 제한은 가입 인증과 같다(5분·5회).
   *
   * 성공하면 **잠금 기록도 지운다.** 비밀번호를 잊어 5회 틀린 사람이 새 비밀번호를 정하고도 15분을
   * 기다려야 한다면, 그건 복구가 아니다. 세션 폐기는 서버가 한다(`handlers/auth.ts`) — 도메인은
   * 어떤 세션이 살아 있는지 모른다.
   */
  resetPassword(role: SignupRole, target: string, code: string, next: string, now: number = Date.now()): Account {
    this.assertWritable()
    if (role !== 'customer' && role !== 'partner') throw new AuthError(`알 수 없는 역할: ${String(role)}`)
    // 29-27: 이메일로 받은 코드는 이메일 키에만 있다 — 휴대폰 키로는 그 코드가 통하지 않고, 반대도 같다
    const { channel, value, key } = this.recoveryTarget(role, target)
    const email = channel === 'email' ? value : ''
    const phone = channel === 'phone' ? value : ''
    const rec = this.otps.get(key)
    if (!rec) throw new AuthError('발급된 인증번호가 없습니다 — 다시 요청해 주세요')
    if (now - rec.issuedAt > OTP_TTL_MS) {
      this.otps.delete(key)
      this.save()
      throw new AuthError('인증번호가 만료되었습니다 (5분) — 다시 요청해 주세요')
    }
    if (rec.code !== code.trim()) {
      rec.attempts += 1
      if (rec.attempts >= OTP_MAX_ATTEMPTS) {
        this.otps.delete(key)
        this.save()
        this.emit(
          '재설정 시도 초과',
          channel === 'email'
            ? `${role === 'partner' ? '파트너' : '고객'} ${maskEmail(email)}`
            : AuthService.maskLabel(role, phone),
          `${OTP_MAX_ATTEMPTS}회 초과`,
        )
        throw new AuthError(`인증 시도 ${OTP_MAX_ATTEMPTS}회를 초과했습니다 — 다시 요청해 주세요`)
      }
      this.save()
      throw new AuthError(`인증번호가 일치하지 않습니다 (남은 시도 ${OTP_MAX_ATTEMPTS - rec.attempts}회)`)
    }
    if (next.length < 8) throw new AuthError('비밀번호는 8자 이상이어야 합니다')
    const account = this.findRecoverable(role, channel, value)
    if (!account) throw new AuthError('계정을 찾을 수 없습니다')
    account.passwordHash = hashPassword(next)
    // 재설정 인증번호를 받았다는 것은 그 번호를 쥐고 있다는 뜻이다 — 휴대폰 인증이 확인하려는 바로 그것.
    // 여기서 세워 주지 않으면 가입을 중간에 그만둔 사람이 재설정에 성공하고도 "인증이 완료되지
    // 않았습니다"에 막혀 들어올 길이 없다. 테스트가 그 막다른 길을 먼저 보여 줬다.
    // 29-27: 이메일로 받은 것은 **이메일**을 쥐고 있다는 뜻이지 휴대폰이 아니다 — 휴대폰 인증은 세워 주지 않는다.
    if (channel === 'phone') account.verified = true
    this.otps.delete(key)
    // 잠금 키는 둘이다 — 계정 단위(`acct|…`)와 (계정, IP) 단위. 앞의 것만 지우면 로그인은 여전히
    // 잠겨 있다. 내가 그렇게 짰고 테스트가 잡았다. 접두 일치로 이 계정의 기록을 모두 지운다.
    // 로그인은 휴대폰 번호로 하므로 잠금 키도 휴대폰 기준이다 — 이메일로 복구해도 지워야 할 키는 같다.
    const base = this.failKey(role, account.phone)
    for (const k of [...this.loginFails.keys()]) {
      if (k === base || k.startsWith(base + ':') || k === `acct|${base}`) this.loginFails.delete(k)
    }
    this.save()
    this.emit(
      '비밀번호 재설정',
      AuthService.maskLabel(role, account.phone),
      channel === 'email' ? `이메일 ${maskEmail(email)}` : '휴대폰',
    )
    return { ...account }
  }

  /**
   * 이메일 등록·변경 (29-27) — 로그인한 고객·파트너. 바꾸면 **인증이 풀리고** 새 인증번호가 나간다.
   *
   * 같은 주소를 다시 넣으면(인증 메일 다시 받기) 주소는 그대로 두고 인증번호만 새로 낸다.
   * 인증된 주소를 그대로 다시 넣는 것은 할 일이 없으므로 거절한다 — 화면이 "이미 인증됨"을 보여 준다.
   *
   * 돌려주는 `otp` 는 서버가 메일로 보낼 값이다. 저장은 계정 단위 키(`emailverify:role:accountId`)에
   * 한다 — 재설정 키와도, 가입 키와도 다르다.
   */
  setEmail(role: SignupRole, emailRaw: string, now: number = Date.now()): { email: string; otp: string } {
    this.assertWritable()
    const session = this.sessions.get(role)
    if (!session) throw new AuthError('로그인 후 변경할 수 있습니다')
    const account = this.accounts.find((a) => a.id === session.accountId && !a.withdrawnAt)
    if (!account) throw new AuthError('계정을 찾을 수 없습니다')
    const email = normalizeEmail(emailRaw)
    if (account.email === email && account.emailVerifiedAt !== undefined) {
      throw new AuthError('이미 인증된 이메일입니다')
    }
    const key = EMAIL_VERIFY_PREFIX + `${role}:${account.id}`
    // 자체 감사 02: 같은 주소로 방금 냈으면 다시 내지 않는다 — 메일 한 통이 곧 비용이다
    const live = this.otps.get(key)
    if (account.email === email && live !== undefined && now - live.issuedAt < OTP_RESEND_COOLDOWN_MS) {
      throw new AuthError(
        `인증 메일을 방금 보냈습니다 — ${Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - live.issuedAt)) / 1000)}초 뒤 다시 받을 수 있습니다`,
      )
    }
    if (account.email !== email) {
      this.assertEmailUsable(role, email, account.id)
      account.email = email
      delete account.emailVerifiedAt
    }
    const otp = newOtp()
    this.otps.set(key, { code: otp, issuedAt: now, attempts: 0 })
    this.save()
    return { email, otp }
  }

  /** 이메일 인증 (29-27) — 만료·시도 제한은 가입 인증과 같다(5분·5회). 맞으면 `emailVerifiedAt` 이 선다 */
  verifyEmail(role: SignupRole, code: string, now: number = Date.now()): AccountView {
    this.assertWritable()
    const session = this.sessions.get(role)
    if (!session) throw new AuthError('로그인 후 인증할 수 있습니다')
    const account = this.accounts.find((a) => a.id === session.accountId && !a.withdrawnAt)
    if (!account) throw new AuthError('계정을 찾을 수 없습니다')
    if (account.email === undefined) throw new AuthError('등록된 이메일이 없습니다 — 먼저 이메일을 등록해 주세요')
    const key = EMAIL_VERIFY_PREFIX + `${role}:${account.id}`
    const rec = this.otps.get(key)
    if (!rec) throw new AuthError('발급된 인증번호가 없습니다 — 인증 메일을 다시 받아 주세요')
    if (now - rec.issuedAt > OTP_TTL_MS) {
      this.otps.delete(key)
      this.save()
      throw new AuthError('인증번호가 만료되었습니다 (5분) — 인증 메일을 다시 받아 주세요')
    }
    if (rec.code !== code.trim()) {
      rec.attempts += 1
      if (rec.attempts >= OTP_MAX_ATTEMPTS) {
        this.otps.delete(key)
        this.save()
        this.emit('이메일 인증 시도 초과', AuthService.maskLabel(role, account.phone), `${OTP_MAX_ATTEMPTS}회 초과`)
        throw new AuthError(`인증 시도 ${OTP_MAX_ATTEMPTS}회를 초과했습니다 — 인증 메일을 다시 받아 주세요`)
      }
      this.save()
      throw new AuthError(`인증번호가 일치하지 않습니다 (남은 시도 ${OTP_MAX_ATTEMPTS - rec.attempts}회)`)
    }
    // 자체 감사 04: 인증이 끝나는 순간 그 주소는 이 계정 것이다 — 다른 계정이 먼저 인증했으면 여기서 멈추고,
    // 인증 없이 걸어만 둔 다른 계정들에서는 주소를 거둔다. 주소는 인증한 사람의 것이지 먼저 적은 사람의 것이 아니다.
    this.assertEmailUsable(role, account.email, account.id)
    for (const other of this.accounts) {
      if (other.id !== account.id && other.role === role && other.email === account.email && !other.withdrawnAt) {
        delete other.email
        delete other.emailVerifiedAt
      }
    }
    account.emailVerifiedAt = new Date(now).toISOString()
    this.otps.delete(key)
    this.save()
    this.emit('이메일 인증', AuthService.maskLabel(role, account.phone), maskEmail(account.email))
    const { passwordHash: _pw, ...view } = account
    return { ...view }
  }

  /**
   * 한 역할 안에서 한 주소는 **인증한** 한 계정이다 (29-27 자체 감사 04).
   *
   * 인증하지 않은 주소까지 막으면, 남의 주소를 적어만 두고 인증하지 않는 것으로 그 사람이 영영 자기
   * 주소를 못 쓰게 만들 수 있다. 그래서 막는 것은 인증된 주소뿐이고, 인증이 끝날 때 미인증 중복은 거둔다.
   */
  private assertEmailUsable(role: SignupRole, email: string, exceptId?: string): void {
    if (!isEmailAddress(email)) throw new AuthError('이메일 주소 모양이 아닙니다')
    if (
      this.accounts.some(
        (a) =>
          a.role === role &&
          a.email === email &&
          a.emailVerifiedAt !== undefined &&
          a.id !== exceptId &&
          !a.withdrawnAt,
      )
    ) {
      throw new AuthError('이미 다른 계정에서 인증한 이메일입니다')
    }
  }

  /** 잠금 상태 (28-51-02): 잠겨 있으면 남은 ms, 아니면 0 */
  lockRemainingMs(role: AuthRole, idOrPhone: string, now: number = Date.now(), lockScope?: string): number {
    const rec = this.loginFails.get(this.failKey(role, idOrPhone, lockScope))
    if (!rec?.lockedUntil) return 0
    return Math.max(0, rec.lockedUntil - now)
  }

  /** 보안 이벤트 통지 — 훅이 없으면 무해, 훅이 던져도 인증 흐름을 막지 않는다 */
  private emit(action: string, target: string, detail?: string): void {
    if (!this.onSecurityEvent) return
    try {
      this.onSecurityEvent({ action, target, ...(detail !== undefined ? { detail } : {}) })
    } catch {
      // 감사 기록 실패가 로그인·탈퇴를 막아서는 안 된다
    }
  }

  /** 실패 키(`role:phone`)를 사람이 읽을 수 있는 마스킹 표기로 */
  /**
   * 28-77-02: 감사 로그에 남길 사람이 읽는 라벨. 키가 가명이 되었으므로 **키에서 뽑을 수 없다** —
   * 부르는 자리가 이미 역할과 번호를 손에 쥐고 있으니 거기서 만든다. 남는 형태는 예전과 같다
   * (`고객 0101***5678`) — 운영 기록의 읽기 경험은 그대로다.
   */
  private static maskLabel(role: AuthRole, idOrPhone: string): string {
    if (role === 'admin') return '관리자'
    return `${role === 'partner' ? '파트너' : '고객'} ${maskPhone(normalizePhone(idOrPhone))}`
  }

  private static maskKey(key: string): string {
    const [role, id] = key.split(':')
    if (role === 'admin') return '관리자'
    return `${role === 'partner' ? '파트너' : '고객'} ${maskPhone(id ?? '')}`
  }

  /**
   * 잠금 키. `scope`(28-71-02: 서버 모드의 요청 IP)가 있으면 키에 붙는다 — 남의 IP에서 낸 실패가 내 로그인을 잠그지 않는다.
   * 로컬 모드는 scope 없이 예전 키 그대로다.
   */
  private failKey(role: AuthRole, idOrPhone: string, scope?: string): string {
    // 28-77-02: 번호도 IP도 가명으로 넣는다. 구조(`role:번호[:IP]`)는 그대로라 접두 일치·마스킹 규칙이 산다
    // 28-89-A: 관리자도 아이디별로 — 한 관리자의 실패가 다른 관리자를 잠그지 않는다
    const base =
      role === 'admin'
        ? `admin:${keyDigest(this.keySalt, idOrPhone.trim().toLowerCase())}`
        : `${role}:${keyDigest(this.keySalt, normalizePhone(idOrPhone))}`
    return scope === undefined || scope === '' ? base : `${base}:${keyDigest(this.keySalt, scope)}`
  }

  /**
   * 28-71-02: 15분 지난 실패 기록은 저장 전에 지운다 — IP별 키가 auth_state에 영원히 쌓이지 않게.
   *
   * 기준은 **마지막 실패 시각**(`lastAt`)이다. 잠긴 기록의 `lockedUntil`은 이미 `lastAt + 15분`이라
   * 그것을 기준으로 삼으면 보관이 15분이 아니라 **30분**이 된다(28-72 리뷰 지적). `lastAt`으로 재면
   * 삭제 시점이 정확히 `lockedUntil` 직후라 잠금을 일찍 풀지도 않는다.
   * `lockedUntil`은 `lastAt`이 없던 28-71 이전 스냅샷을 위한 대비책이다.
   */
  private pruneLoginFails(now: number): void {
    for (const [k, v] of this.loginFails) {
      const ref = v.lastAt !== undefined ? v.lastAt : v.lockedUntil
      if (ref !== undefined && now - ref > LOGIN_LOCK_MS) this.loginFails.delete(k)
    }
  }

  /**
   * 28-74-02: 30일 지난 신뢰 IP·빈 계정 항목을 정리한다 — `pruneLoginFails`와 같은 자리, 같은 이유다.
   *
   * 28-73-03은 TTL을 `rememberTrustedIp` 안에서만 적용했다. 그 계정이 **다시 성공적으로 로그인할 때만**
   * 만료가 도는 셈이라, 탈퇴·파기·휴면 계정의 항목은 영영 남았다. 키에 전화번호가 들어 있으므로
   * (`acct|${role}:${전화번호}`) 그것은 개인정보가 남는다는 뜻이고, 서버 모드에서는 `auth_state` 행에 남는다.
   */
  private pruneTrustedIps(now: number): void {
    // 28-75-03: 게이트 — 간격 안이면 훑지 않는다. 늦게 지워져도 `isTrustedIp`가 TTL을 직접 보므로
    //   면제가 새지 않는다. 시계가 뒤로 간 스냅샷(미래 시각)도 여기서 풀린다.
    if (now - this.trustedSweptAt < TRUSTED_IP_SWEEP_MS && this.trustedSweptAt <= now) return
    this.trustedSweptAt = now
    for (const [account, ips] of this.trustedIps) {
      for (const [ip, at] of ips) if (now - at > TRUSTED_IP_TTL_MS) ips.delete(ip)
      if (ips.size === 0) this.trustedIps.delete(account)
    }
    // 28-77-01: **훑었으면 남긴다.** 호출자(`login`)에는 저장 없이 던지고 끝나는 경로가 있다
    //   (정지된 계정·미인증 계정). 거기서 끝나면 지운 항목이 되살아나고 게이트 시각도 남지 않아
    //   다음 요청이 또 훑는다 — 서버 모드는 요청마다 인스턴스를 새로 만든다. 28-75-03이 세운 계약이
    //   일부 경로에서만 참이었다.
    this.save()
  }

  /**
   * 실패 기록 — `max`회째에 잠금. 반환: 던질 오류 메시지 접미 (잠기지 않았으면 남은 시도 안내).
   *
   * 오래된 기록 청소는 **`login()`이 진입에서 한 번** 한다 — 여기서 또 부르면 실패 한 번에 Map 전체를
   * 세 번 훑는다(이 함수가 (계정,IP)·계정 두 키로 불리므로). 28-73 리뷰 지적.
   */
  private recordFail(key: string, now: number, max: number = LOGIN_MAX_FAILS, label?: string): string {
    const rec = this.loginFails.get(key) ?? { count: 0 }
    rec.count += 1
    rec.lastAt = now
    const minutes = Math.round(LOGIN_LOCK_MS / 60000)
    if (rec.count >= max) {
      rec.lockedUntil = now + LOGIN_LOCK_MS
      rec.count = 0
      this.loginFails.set(key, rec)
      this.save()
      this.emit('로그인 잠금', label ?? AuthService.maskKey(key), `${max}회 실패 · ${minutes}분 잠금`)
      return max === LOGIN_MAX_FAILS
        ? ` — ${max}회 실패로 ${minutes}분간 로그인이 잠겼습니다`
        : ` — 여러 곳에서 ${max}회 실패해 이 계정이 ${minutes}분간 잠겼습니다`
    }
    this.loginFails.set(key, rec)
    this.save()
    // 남은 시도 안내는 (계정, IP) 카운터의 몫이다 — 계정 카운터는 조용히 센다
    if (max !== LOGIN_MAX_FAILS) return ''
    this.emit('로그인 실패', label ?? AuthService.maskKey(key), `남은 시도 ${max - rec.count}회`)
    return ` (남은 시도 ${max - rec.count}회)`
  }

  /**
   * IP와 무관한 계정 단위 실패 키 (28-72-02). `failKey`의 scope 없는 형태 앞에 표식을 붙여
   * (계정, IP) 키와 절대 겹치지 않게 한다.
   */
  private accountFailKey(role: AuthRole, idOrPhone: string): string {
    return `acct|${this.failKey(role, idOrPhone)}`
  }

  /** 28-73-03: 이 IP가 이 계정으로 최근에 성공한 적이 있는가 — 계정 잠금의 면제 대상 */
  private isTrustedIp(accountKey: string, scope: string | undefined, now: number): boolean {
    if (scope === undefined || scope === '') return false // 로컬 모드(범위 없음)는 면제도 기록도 없다
    const at = this.trustedIps.get(accountKey)?.get(keyDigest(this.keySalt, scope)) // 28-77-02
    return at !== undefined && now - at <= TRUSTED_IP_TTL_MS
  }

  /** 로그인 성공 IP를 기억한다 (28-73-03). 오래된 것·상한 초과는 여기서 정리한다 */
  private rememberTrustedIp(accountKey: string, scope: string | undefined, now: number): void {
    if (scope === undefined || scope === '') return
    const ips = this.trustedIps.get(accountKey) ?? new Map<string, number>()
    ips.set(keyDigest(this.keySalt, scope), now) // 28-77-02
    for (const [ip, at] of ips) if (now - at > TRUSTED_IP_TTL_MS) ips.delete(ip)
    if (ips.size > TRUSTED_IP_MAX) {
      // 오래된 것부터 버린다
      const oldestFirst = [...ips.entries()].sort((a, b) => a[1] - b[1])
      for (const [ip] of oldestFirst.slice(0, ips.size - TRUSTED_IP_MAX)) ips.delete(ip)
    }
    this.trustedIps.set(accountKey, ips)
  }

  /**
   * 두 카운터에 한 번의 실패를 기록한다 (28-72-02) — (계정, IP) 5회, 계정 30회.
   * 계정 잠금이 걸리면 그 안내가 이긴다(더 강한 사실이다).
   */
  private recordLoginFailure(scopedKey: string, accountKey: string, now: number, label: string): string {
    const scoped = this.recordFail(scopedKey, now, LOGIN_MAX_FAILS, label)
    const account = this.recordFail(accountKey, now, ACCOUNT_MAX_FAILS, label)
    return account !== '' ? account : scoped
  }

  private assertNotLocked(key: string, now: number): void {
    const rec = this.loginFails.get(key)
    if (rec?.lockedUntil !== undefined) {
      if (rec.lockedUntil > now) {
        const min = Math.max(1, Math.ceil((rec.lockedUntil - now) / 60000))
        throw new AuthError(`로그인이 잠겨 있습니다 — ${min}분 후 다시 시도해 주세요`)
      }
      // 잠금 해제 — 카운트 초기화
      this.loginFails.delete(key)
    }
  }

  private newSession(role: AuthRole, name: string, accountId: string, now: number, grade?: AdminGrade): AuthSession {
    return {
      role,
      name,
      accountId,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS[role]).toISOString(),
      ...(grade !== undefined ? { grade } : {}),
    }
  }

  /** 로그인 — 고객·파트너는 인증(verified) 필수, 관리자는 시드 계정. 5회 실패 → 15분 잠금 (28-51-02) */
  login(
    role: AuthRole,
    idOrPhone: string,
    password: string,
    now: number = Date.now(),
    options: { lockScope?: string } = {},
  ): AuthSession {
    this.assertWritable()
    this.pruneLoginFails(now) // 28-71-02: 성공·실패 어느 쪽이든 오래된 기록은 여기서 정리된다
    this.pruneTrustedIps(now) // 28-74-02: 신뢰 IP도 여기서 만료된다 — 그 계정이 다시 오지 않아도
    const key = this.failKey(role, idOrPhone, options.lockScope)
    // 28-72-02: (계정, IP) 잠금과 **계정 잠금**을 둘 다 본다. 앞의 것만 보면 IP를 바꿔 무제한으로 시도할 수 있다
    const accountKey = this.accountFailKey(role, idOrPhone)
    this.assertNotLocked(key, now)
    // 28-73-03: 계정 잠금은 **처음 보는 IP에만** 건다 — 늘 쓰던 자리의 운영자를 남이 잠글 수 없다
    if (!this.isTrustedIp(accountKey, options.lockScope, now)) this.assertNotLocked(accountKey, now)
    if (role === 'admin') {
      // 28-89-A: 아이디로 관리자 계정을 찾는다 — 계정마다 등급이 다르고 잠금도 따로다
      const admin = this.admins.find((a) => a.id === idOrPhone.trim().toLowerCase())
      if (admin === undefined || !verifyPassword(password, admin.passwordHash)) {
        throw new AuthError(
          `관리자 계정 정보가 일치하지 않습니다${this.recordLoginFailure(key, accountKey, now, AuthService.maskLabel(role, idOrPhone))}`,
        )
      }
      // 29-29: 옛 형식의 해시는 로그인에 성공한 이 순간 새 형식으로 — 비밀번호를 아는 유일한 때다
      if (needsRehash(admin.passwordHash)) admin.passwordHash = hashPassword(password)
      this.loginFails.delete(key)
      this.loginFails.delete(accountKey)
      this.rememberTrustedIp(accountKey, options.lockScope, now)
      const session = this.newSession('admin', admin.name, admin.id, now, admin.grade)
      this.sessions.set('admin', session)
      this.save()
      return { ...session }
    }
    const phone = normalizePhone(idOrPhone)
    const account = this.accounts.find((a) => a.role === role && a.phone === phone)
    if (!account || account.withdrawnAt || !verifyPassword(password, account.passwordHash)) {
      throw new AuthError(
        `휴대폰 번호 또는 비밀번호가 일치하지 않습니다${this.recordLoginFailure(key, accountKey, now, AuthService.maskLabel(role, idOrPhone))}`,
      )
    }
    if (needsRehash(account.passwordHash)) account.passwordHash = hashPassword(password)
    if (account.suspended) {
      throw new AuthError('정지된 계정입니다 — 고객센터로 문의해 주세요')
    }
    if (!account.verified) {
      throw new AuthError('휴대폰 인증이 완료되지 않았습니다 — 인증 후 로그인할 수 있습니다')
    }
    this.loginFails.delete(key)
    this.loginFails.delete(accountKey)
    this.rememberTrustedIp(accountKey, options.lockScope, now)
    const session = this.newSession(role, account.name, account.id, now)
    this.sessions.set(role, session)
    this.save()
    return { ...session }
  }

  /** 역할별 현재 세션 (없거나 만료면 undefined). 만료 세션은 제거하고 게이트 안내를 남긴다 (28-51-03) */
  sessionFor(role: AuthRole, now: number = Date.now()): AuthSession | undefined {
    const s = this.sessions.get(role)
    if (!s) return undefined
    if (Date.parse(s.expiresAt) <= now) {
      this.sessions.delete(role)
      this.notice = '세션이 만료되어 다시 로그인해 주세요'
      this.save()
      return undefined
    }
    return { ...s }
  }

  /** 비밀번호 변경 (28-33-01) — 현재 비밀번호 확인 + 8자 규칙, 관리자는 시드 비밀번호 교체 */
  changePassword(role: AuthRole, current: string, next: string): void {
    this.assertWritable()
    if (next.length < 8) throw new AuthError('새 비밀번호는 8자 이상이어야 합니다')
    if (current === next) throw new AuthError('새 비밀번호가 현재 비밀번호와 같습니다')
    if (role === 'admin') {
      // 28-89-A: 세션의 관리자 본인 것을 바꾼다. 세션이 없으면 소유자 `admin`(서버 부트스트랩·구 호출부)
      const session = this.sessions.get('admin')
      const admin = this.admins.find((a) => a.id === (session?.accountId ?? ADMIN_ID))
      if (admin === undefined) throw new AuthError('관리자 계정을 찾을 수 없습니다')
      if (!verifyPassword(current, admin.passwordHash)) throw new AuthError('현재 비밀번호가 일치하지 않습니다')
      admin.passwordHash = hashPassword(next)
      this.save()
      this.emit('비밀번호 변경', admin.id, '관리자')
      return
    }
    const session = this.sessions.get(role)
    if (!session) throw new AuthError('로그인 후 변경할 수 있습니다')
    const account = this.accounts.find((a) => a.id === session.accountId)
    if (!account) throw new AuthError('계정을 찾을 수 없습니다')
    if (!verifyPassword(current, account.passwordHash)) throw new AuthError('현재 비밀번호가 일치하지 않습니다')
    account.passwordHash = hashPassword(next)
    this.save()
    this.emit('비밀번호 변경', account.id, role === 'partner' ? '파트너' : '고객')
  }

  /** 마케팅 수신 동의·철회 (28-37-01) — 로그인한 고객·파트너가 언제든 변경, 변경 일시 기록 */
  setMarketingOptIn(role: SignupRole, on: boolean): ConsentRecord {
    this.assertWritable()
    const session = this.sessions.get(role)
    if (!session) throw new AuthError('로그인 후 변경할 수 있습니다')
    const account = this.accounts.find((a) => a.id === session.accountId)
    if (!account) throw new AuthError('계정을 찾을 수 없습니다')
    if (account.consent.marketing !== on) {
      account.consent = { ...account.consent, marketing: on, marketingAt: new Date().toISOString() }
      this.save()
    }
    return { ...account.consent }
  }

  /** 정산 계좌 등록·수정 (28-38-01) — 로그인한 파트너만. 은행·예금주 필수, 계좌번호 숫자 10~14자리 */
  setPayoutAccount(input: { bank: string; number: string; holder: string }): PayoutAccount {
    this.assertWritable()
    const session = this.sessions.get('partner')
    if (!session) throw new AuthError('파트너 로그인 후 등록할 수 있습니다')
    const account = this.accounts.find((a) => a.id === session.accountId)
    if (!account || account.role !== 'partner') throw new AuthError('파트너 계정만 정산 계좌를 등록할 수 있습니다')
    const bank = input.bank.trim()
    const holder = input.holder.trim()
    const number = input.number.replace(/[^0-9]/g, '')
    if (bank === '') throw new AuthError('은행을 입력하세요')
    if (!/^\d{10,14}$/.test(number)) throw new AuthError('계좌번호는 숫자 10~14자리여야 합니다')
    if (holder === '') throw new AuthError('예금주를 입력하세요')
    // 28-90: 예금주는 가입한 이름과 같아야 한다 — 남의 계좌로 정산받는 길을 코드에서 막는다.
    //   실제로 그 사람의 계좌인지는 관리자가 확인하고 `verifyPayoutAccount`로 기록한다.
    if (normalizeHolder(holder) !== normalizeHolder(account.name)) {
      throw new AuthError(`예금주는 가입한 이름과 같아야 합니다: ${account.name}`)
    }
    // 계좌를 바꾸면 이전 인증은 무효다 — verifiedAt 을 싣지 않는다
    account.payoutAccount = { bank, number, holder, updatedAt: new Date().toISOString() }
    this.save()
    return { ...account.payoutAccount }
  }

  /**
   * 정산 계좌 인증 기록 (28-90) — 관리자가 예금주·계좌를 외부(이체 확인·증빙)로 확인한 뒤 남긴다.
   * 은행 API 조회가 아니다. 인증된 계좌만 지급 대상이다(`markPayout`).
   */
  verifyPayoutAccount(accountId: string, adminId: string): PayoutAccount {
    this.assertWritable()
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) throw new AuthError(`계정을 찾을 수 없습니다: ${accountId}`)
    if (account.role !== 'partner') throw new AuthError('파트너 계정만 정산 계좌를 인증할 수 있습니다')
    if (!account.payoutAccount) throw new AuthError('등록된 정산 계좌가 없습니다')
    account.payoutAccount = { ...account.payoutAccount, verifiedAt: new Date().toISOString(), verifiedBy: adminId }
    this.save()
    this.emit('정산 계좌 인증', accountId, `by ${adminId}`)
    return { ...account.payoutAccount }
  }

  /** 관리자용 계정 목록 (28-33-01) — 비밀번호 제외, 가입순 */
  // ── 관리자 계정·등급 (28-89-A) ──

  private static seedOwner(): AdminAccount {
    return {
      id: ADMIN_ID,
      name: '관리자',
      grade: 'owner',
      passwordHash: hashPassword(ADMIN_INITIAL_PASSWORD),
      createdAt: new Date(0).toISOString(),
      createdBy: 'seed',
    }
  }

  private static isAdminAccount(a: unknown): a is AdminAccount {
    if (typeof a !== 'object' || a === null) return false
    const x = a as Record<string, unknown>
    return (
      typeof x['id'] === 'string' &&
      ADMIN_ID_RE.test(x['id']) &&
      typeof x['name'] === 'string' &&
      (x['name'] as string).trim() !== '' &&
      isAdminGrade(x['grade']) &&
      typeof x['passwordHash'] === 'string' &&
      (x['passwordHash'] === '' || isPasswordHash(x['passwordHash'] as string)) &&
      typeof x['createdAt'] === 'string' &&
      typeof x['createdBy'] === 'string'
    )
  }

  /**
   * 서버 부트스트랩 전용 — 행이 처음 만들어질 때 소유자 `admin`의 비밀번호를 `ADMIN_PASSWORD`로 둔다.
   * 세션 없이 도는 유일한 관리자 비밀번호 변경이라 따로 둔다(`changePassword`는 세션의 본인 것을 바꾼다).
   */
  bootstrapOwnerPassword(password: string): void {
    this.assertWritable()
    if (password.length < 8) throw new AuthError('관리자 비밀번호는 8자 이상이어야 합니다')
    const owner = this.admins.find((a) => a.id === ADMIN_ID)
    if (owner === undefined) throw new AuthError('소유자 계정이 없습니다')
    owner.passwordHash = hashPassword(password)
    this.save()
  }

  listAdmins(): AdminAccountView[] {
    return this.admins.map(({ passwordHash: _pw, ...view }) => ({ ...view }))
  }

  adminGradeOf(id: string): AdminGrade | undefined {
    return this.admins.find((a) => a.id === id)?.grade
  }

  /** 행위자가 소유자인지 — 관리자 계정 관리는 전부 여기를 지난다 */
  private assertOwner(actorId: string): AdminAccount {
    const actor = this.admins.find((a) => a.id === actorId)
    if (actor === undefined || !canAdmin(actor.grade, 'manageAdmins')) {
      throw new AuthError('관리자 계정 관리는 소유자만 할 수 있습니다')
    }
    return actor
  }

  addAdmin(
    actorId: string,
    input: { id: string; name: string; grade: AdminGrade; password: string },
    now: number = Date.now(),
  ): AdminAccountView {
    this.assertWritable()
    this.assertOwner(actorId)
    const id = input.id.trim().toLowerCase()
    if (!ADMIN_ID_RE.test(id)) throw new AuthError('관리자 아이디는 영문 소문자·숫자·-·_ 로 3~20자입니다')
    if (this.admins.some((a) => a.id === id)) throw new AuthError(`이미 있는 관리자 아이디입니다: ${id}`)
    const name = input.name.trim()
    if (name === '') throw new AuthError('이름을 입력하세요')
    if (!isAdminGrade(input.grade)) throw new AuthError('등급이 올바르지 않습니다')
    if (input.password.length < 8) throw new AuthError('비밀번호는 8자 이상이어야 합니다')
    const account: AdminAccount = {
      id,
      name,
      grade: input.grade,
      passwordHash: hashPassword(input.password),
      createdAt: new Date(now).toISOString(),
      createdBy: actorId,
    }
    this.admins.push(account)
    this.save()
    this.emit('관리자 추가', id, `${input.grade} · by ${actorId}`)
    const { passwordHash: _pw, ...view } = account
    return { ...view }
  }

  setAdminGrade(actorId: string, id: string, grade: AdminGrade): AdminAccountView {
    this.assertWritable()
    this.assertOwner(actorId)
    if (!isAdminGrade(grade)) throw new AuthError('등급이 올바르지 않습니다')
    const target = this.admins.find((a) => a.id === id)
    if (target === undefined) throw new AuthError('관리자 계정을 찾을 수 없습니다')
    // 마지막 소유자를 내리면 아무도 관리자 계정을 못 만진다 — 소유자 수가 0이 되는 변경은 막는다
    if (target.grade === 'owner' && grade !== 'owner' && this.admins.filter((a) => a.grade === 'owner').length <= 1) {
      throw new AuthError('마지막 소유자의 등급은 내릴 수 없습니다 — 먼저 다른 소유자를 두세요')
    }
    const before = target.grade
    target.grade = grade
    // 등급이 바뀐 관리자가 지금 로그인 중이면 세션도 따라간다(로컬 모드). 서버는 세션을 폐기한다
    const s = this.sessions.get('admin')
    if (s !== undefined && s.accountId === id) this.sessions.set('admin', { ...s, grade })
    this.save()
    this.emit('관리자 등급 변경', id, `${before} → ${grade} · by ${actorId}`)
    const { passwordHash: _pw, ...view } = target
    return { ...view }
  }

  removeAdmin(actorId: string, id: string): void {
    this.assertWritable()
    this.assertOwner(actorId)
    if (id === actorId) throw new AuthError('자기 자신은 제거할 수 없습니다')
    const target = this.admins.find((a) => a.id === id)
    if (target === undefined) throw new AuthError('관리자 계정을 찾을 수 없습니다')
    if (target.grade === 'owner' && this.admins.filter((a) => a.grade === 'owner').length <= 1) {
      throw new AuthError('마지막 소유자는 제거할 수 없습니다')
    }
    this.admins = this.admins.filter((a) => a.id !== id)
    const s = this.sessions.get('admin')
    if (s !== undefined && s.accountId === id) this.sessions.delete('admin')
    this.save()
    this.emit('관리자 제거', id, `by ${actorId}`)
  }

  resetAdminPassword(actorId: string, id: string, next: string): void {
    this.assertWritable()
    this.assertOwner(actorId)
    if (next.length < 8) throw new AuthError('비밀번호는 8자 이상이어야 합니다')
    const target = this.admins.find((a) => a.id === id)
    if (target === undefined) throw new AuthError('관리자 계정을 찾을 수 없습니다')
    target.passwordHash = hashPassword(next)
    this.save()
    this.emit('관리자 비밀번호 초기화', id, `by ${actorId}`)
  }

  listAccounts(): AccountView[] {
    return this.accounts.map(({ passwordHash: _pw, ...view }) => ({ ...view }))
  }

  /** 계정 정지/해제 (28-33-01) — 정지 시 해당 역할의 활성 세션 즉시 종료 */
  setSuspended(accountId: string, suspended: boolean): AccountView {
    this.assertWritable()
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) throw new AuthError(`계정을 찾을 수 없습니다: ${accountId}`)
    account.suspended = suspended
    if (suspended && this.sessions.get(account.role)?.accountId === accountId) {
      this.sessions.delete(account.role)
    }
    this.save()
    const { passwordHash: _pw, ...view } = account
    return { ...view }
  }

  /** 파트너 승인 (28-34-01) — 관리자 액션 */
  approvePartner(accountId: string): AccountView {
    this.assertWritable()
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) throw new AuthError(`계정을 찾을 수 없습니다: ${accountId}`)
    if (account.role !== 'partner') throw new AuthError('파트너 계정만 승인할 수 있습니다')
    account.approval = 'approved'
    delete account.rejectReason
    this.save()
    const { passwordHash: _pw, ...view } = account
    return { ...view }
  }

  /** 파트너 거절 (28-34-01) — 사유 필수, 로그인은 가능하되 입찰 불가 */
  rejectPartner(accountId: string, reason: string): AccountView {
    this.assertWritable()
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) throw new AuthError(`계정을 찾을 수 없습니다: ${accountId}`)
    if (account.role !== 'partner') throw new AuthError('파트너 계정만 거절할 수 있습니다')
    const trimmed = reason.trim()
    if (trimmed === '') throw new AuthError('거절 사유를 입력하세요')
    account.approval = 'rejected'
    account.rejectReason = trimmed
    this.save()
    const { passwordHash: _pw, ...view } = account
    return { ...view }
  }

  /** 현재 파트너 세션의 승인 상태 (세션 없으면 undefined) */
  partnerApproval(): { approval: PartnerApproval; rejectReason?: string } | undefined {
    const session = this.sessions.get('partner')
    if (!session) return undefined
    const account = this.accounts.find((a) => a.id === session.accountId)
    if (!account) return undefined
    return {
      approval: account.approval ?? 'pending',
      ...(account.rejectReason ? { rejectReason: account.rejectReason } : {}),
    }
  }

  /** 현재 세션의 계정 정보 (마이페이지용, 비밀번호 제외) */
  accountFor(role: AuthRole): AccountView | undefined {
    const session = this.sessions.get(role)
    if (!session) return undefined
    const account = this.accounts.find((a) => a.id === session.accountId)
    if (!account) return undefined
    const { passwordHash: _pw, ...view } = account
    return { ...view }
  }

  /** 탈퇴 직후 게이트에 1회 표시할 안내 (비영속) */
  private notice = ''

  /** 게이트가 1회 소비하는 안내문 (28-39-02) */
  consumeNotice(): string {
    const n = this.notice
    this.notice = ''
    return n
  }

  /** 회원 탈퇴 (28-39-01) — 로그인·비밀번호 확인, 식별 정보 즉시 파기, 세션 종료. 거래 기록은 보존(비식별). */
  withdraw(role: SignupRole, password: string): AccountView {
    this.assertWritable()
    const session = this.sessions.get(role)
    if (!session) throw new AuthError('로그인 후 탈퇴할 수 있습니다')
    const account = this.accounts.find((a) => a.id === session.accountId)
    if (!account) throw new AuthError('계정을 찾을 수 없습니다')
    if (!verifyPassword(password, account.passwordHash)) throw new AuthError('비밀번호가 일치하지 않습니다')
    // 28-74-02: 아래 안내가 "식별 정보는 즉시 파기되었고"라고 말한다. 계정 행만 비우면 그 말이 거짓이 된다 —
    //   `trustedIps`·`loginFails`의 키에 전화번호가 들어 있다. **번호를 아직 아는 지금** 버린다.
    this.forgetAccountKeys(account.role, account.phone)
    account.name = '탈퇴 회원'
    account.phone = ''
    account.passwordHash = ''
    delete account.bizNo
    delete account.bizVerified
    delete account.payoutAccount
    delete account.rejectReason
    // 29-27 자체 감사 01: 이메일도 식별 정보다 — "즉시 파기" 라는 말이 거짓이 되지 않게 함께 버린다
    delete account.email
    delete account.emailVerifiedAt
    this.otps.delete(EMAIL_VERIFY_PREFIX + `${role}:${account.id}`)
    account.withdrawnAt = new Date().toISOString()
    this.sessions.delete(role)
    this.notice = '탈퇴가 완료되었습니다. 식별 정보는 즉시 파기되었고, 거래·결제 기록은 법정 보관 기간 후 파기됩니다.'
    this.save()
    this.emit('회원 탈퇴', account.id, role === 'partner' ? '파트너' : '고객')
    const { passwordHash: _pw, ...view } = account
    return { ...view }
  }

  /**
   * 28-74-02: 이 계정의 전화번호가 들어간 키를 전부 버린다 — 신뢰 IP와 실패 기록 양쪽.
   * `failKey`는 스코프(IP)를 접미로 붙이므로 접두 일치로 지운다.
   */
  private forgetAccountKeys(role: SignupRole, phone: string): void {
    if (phone === '') return // 탈퇴로 이미 비워진 번호 — 지울 키가 없다
    const base = this.failKey(role, phone)
    this.trustedIps.delete(this.accountFailKey(role, phone))
    for (const k of [...this.loginFails.keys()]) {
      if (k === base || k.startsWith(`${base}:`) || k === `acct|${base}`) this.loginFails.delete(k)
    }
  }

  /** 기록 파기 (28-39-01) — 관리자, 탈퇴 계정만. 법정 보관 기간 경과 후 실행 */
  purgeAccount(accountId: string): void {
    this.assertWritable()
    const idx = this.accounts.findIndex((a) => a.id === accountId)
    if (idx < 0) throw new AuthError(`계정을 찾을 수 없습니다: ${accountId}`)
    if (!this.accounts[idx]!.withdrawnAt) throw new AuthError('탈퇴한 계정만 파기할 수 있습니다')
    this.accounts.splice(idx, 1)
    // 28-74-02: 여기서는 지울 키를 알 수 없다 — 탈퇴가 이미 `phone`을 비웠기 때문이다.
    //   그래서 키를 버리는 일은 **탈퇴** 시점이 맡고(`withdraw`), 그 전에 탈퇴한 계정은
    //   `pruneTrustedIps`가 30일 뒤 쓸어낸다.
    this.save()
  }

  logout(role: AuthRole): void {
    if (!this.sessions.has(role)) return
    this.sessions.delete(role)
    this.save()
  }
}
