/**
 * 우리 로그인·가입을 부르는 자리 (29-6).
 *
 * 서버는 `/api/auth`에 `{ op, args }` 하나로 받는다(`server/handlers/auth.ts`). 화면이 그 모양을
 * 직접 알 필요는 없으므로 여기서 한 겹 덮는다 — 화면은 `login()`·`register()`·`verifyOtp()`만 부른다.
 *
 * **성공하면 토큰을 여기서 저장한다.** 저장을 화면마다 하면 한 곳을 빠뜨리는 순간 로그인이
 * 조용히 안 되는 화면이 생긴다. 들어오는 문은 하나로 둔다.
 */
import { clearToken } from './session'

export type SignupRole = 'customer' | 'partner'
export type LoginRole = SignupRole | 'admin'

interface AuthOk {
  ok: true
  result: unknown
  token?: string
}

async function call(op: string, args: unknown[]): Promise<AuthOk> {
  // 29-29: 세션은 HttpOnly 쿠키가 나른다 — 같은 출처 fetch 에 브라우저가 알아서 싣는다
  clearToken()
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, args }),
  })
  const body = (await response.json()) as { ok?: boolean; error?: string; result?: unknown; token?: string }
  if (!response.ok || body.ok !== true) throw Error(body.error ?? '요청을 처리하지 못했습니다.')
  return body as AuthOk
}

/** 로그인. 성공하면 서버가 세션 쿠키를 내리고(29-29), 그 뒤의 모든 요청 — fetch·이미지·SSE — 이 로그인된 상태로 나간다 */
export async function login(role: LoginRole, id: string, password: string): Promise<void> {
  await call('login', [role, id, password])
}

export interface RegisterInput {
  role: SignupRole
  name: string
  phone: string
  password: string
  partnerType?: 'business' | 'individual'
  bizNo?: string
  agreeTerms: boolean
  agreePrivacy: boolean
  marketing: boolean
  /** 29-27: 선택. 비밀번호 찾기의 두 번째 길 — 내 계정에서 인증해야 쓸 수 있다 */
  email?: string
}

/**
 * 가입 신청. 계정은 아직 **대기 상태**이고 인증번호를 확인해야 쓸 수 있다.
 *
 * 문자 발송사가 아직 없어서 서버가 인증번호를 응답으로 준다(`server/handlers/auth.ts`의 "시연" 주석).
 * 그래서 이 함수도 그것을 돌려준다 — SMS 를 붙이는 라운드에서 서버와 함께 사라질 값이다.
 */
export async function register(input: RegisterInput): Promise<{ otp: string }> {
  const out = await call('register', [input])
  const r = out.result as { otp?: unknown }
  return { otp: typeof r?.otp === 'string' ? r.otp : '' }
}

/** 인증번호 확인 — 여기까지 와야 계정이 살아난다 */
export async function verifyOtp(role: SignupRole, phone: string, code: string): Promise<void> {
  await call('verifyOtp', [role, phone, code])
}

/** 로그아웃 — 서버 세션을 폐기하고 이 브라우저의 토큰도 지운다. 서버가 실패해도 토큰은 지운다 */
export async function logout(): Promise<void> {
  try {
    await call('logout', [])
  } finally {
    clearToken()
  }
}

/** 표식 하나 (29-17) — 이 배포가 보는 DB에 실제로 있는 행이다 */
export interface DbProbe {
  id: string
  deployEnv: string
  createdAt: string
}

/**
 * 이 배포가 어느 DB를 보는지 (29-11, 29-17). 관리자만 받는다 — 서버가 등급까지 본다.
 *
 * **이 값들로 운영과 비교할 수는 없다** (29-17-2). 배포는 자기 환경의 변수만 받으므로, 프리뷰
 * 배포가 보는 `DATABASE_URL` 은 Preview 환경의 값이지 운영의 값이 아니다. 그래서 비교는
 * `differentFromFallback` — **이 배포의 기본값과 다른 곳인가**까지다.
 *
 * 데이터가 갈라졌는지는 표식으로 확인한다 — 프리뷰에서 남기고, 운영 쪽에서 그 표식이 없는 것을
 * 사람이 본다.
 */
export interface DbInfo {
  deployEnv: string
  host: string
  database: string
  usingPreviewUrl: boolean
  /** 이 배포의 기본값(`DATABASE_URL`)이 가리키는 곳. 설정돼 있지 않으면 `null` */
  fallback: { host: string; database: string } | null
  /** 지금 붙은 곳이 그 기본값과 다른 곳인가. 비교할 기본값이 없으면 `null`(모름) */
  differentFromFallback: boolean | null
  /** 조회에 성공했을 때의 목록. **조회 실패는 `null`** 이고 빈 배열이 아니다 (29-17-1) */
  probes: DbProbe[] | null
  /** 조회하지 못했을 때의 짧은 이유 */
  error: string | null
}

export async function dbInfo(): Promise<DbInfo> {
  const out = await call('dbInfo', [])
  return out.result as DbInfo
}

/** 표식을 하나 남긴다. 운영에서는 서버가 거부한다 */
export async function dbProbe(): Promise<DbProbe> {
  const out = await call('dbProbe', [])
  return out.result as DbProbe
}

/**
 * 비밀번호 재설정 (29-12) — 두 걸음이다.
 *
 * 서버는 계정이 없어도 같은 모양으로 답한다. 응답만 보고 가입 여부를 훑을 수 없게 하려는 것이라,
 * 화면도 "보냈다"까지만 말하고 있는지 없는지는 말하지 않는다.
 */
export type RecoveryChannel = 'phone' | 'email'

/**
 * `target` 은 휴대폰 번호이거나 이메일이다 (29-27). 서버가 `@` 로 가른다.
 * `otp` 는 개발용 인증번호를 보여도 되는 자리(로컬·CI·켜 둔 프리뷰)에서만 온다.
 */
export async function requestPasswordReset(
  role: SignupRole,
  target: string,
): Promise<{ otp: string; channel: RecoveryChannel }> {
  const out = await call('requestPasswordReset', [role, target])
  const r = out.result as { otp?: unknown; channel?: unknown } | null
  return {
    otp: typeof r?.otp === 'string' ? r.otp : '',
    channel: r?.channel === 'email' ? 'email' : 'phone',
  }
}

/** 새 비밀번호 확정 — 성공하면 서버가 이 계정의 기존 세션을 모두 폐기한다 */
export async function resetPassword(
  role: SignupRole,
  target: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await call('resetPassword', [role, target, code, newPassword])
  clearToken()
}

/** 내 계정 (29-27) — `me` 의 거울에서 자기 계정 하나. 관리자는 계정이 아니라 `null` */
export interface MyAccount {
  id: string
  role: SignupRole
  name: string
  phone: string
  email?: string
  emailVerifiedAt?: string
  verified: boolean
}

export async function myAccount(): Promise<MyAccount | null> {
  const out = await call('me', [])
  const mirror = (out as { mirror?: { accounts?: MyAccount[]; complete?: boolean } }).mirror
  if (mirror === undefined || mirror.complete === true) return null
  return mirror.accounts?.[0] ?? null
}

/**
 * 이메일 등록·변경 (29-27). 서버가 인증 메일을 보낸다 — 메일이 연결되지 않은 자리(로컬·CI)에서는
 * 인증번호를 응답으로 준다. 같은 주소를 다시 넣으면 인증 메일을 다시 보낸다.
 */
export async function setEmail(email: string): Promise<{ email: string; otp: string }> {
  const out = await call('setEmail', [email])
  const r = out.result as { email?: unknown; otp?: unknown } | null
  return { email: typeof r?.email === 'string' ? r.email : email, otp: typeof r?.otp === 'string' ? r.otp : '' }
}

/** 이메일 인증 — 맞으면 이 주소로 비밀번호를 찾을 수 있다 */
export async function verifyEmail(code: string): Promise<void> {
  await call('verifyEmail', [code])
}

/** 비밀번호 변경 (로그인 상태) — 서버는 28-33 부터 있었고 화면이 없었다 (29-27) */
export async function changePassword(current: string, next: string): Promise<void> {
  await call('changePassword', [current, next])
}

/**
 * 회원 탈퇴 (29-24).
 *
 * ## 왜 두 함수인가
 *
 * `withdrawCheck`는 아무것도 바꾸지 않는다. 화면이 **버튼을 내걸기 전에** 물어서, 눌러 보고 거절당하는
 * 대신 왜 안 되는지를 먼저 읽게 한다. 그래도 `withdraw` 쪽에서 다시 본다 — 화면의 판단은 근거가 아니다.
 */
export interface ExitBlock {
  kind: 'ORDER' | 'PAYMENT' | 'REFUND' | 'SETTLEMENT'
  count: number
  message: string
}

/** 지금 탈퇴할 수 있는가. 빈 배열이면 할 수 있다 */
export async function withdrawCheck(): Promise<ExitBlock[]> {
  const out = await call('withdrawCheck', [])
  const r = out.result as { blocks?: unknown } | null
  return Array.isArray(r?.blocks) ? (r.blocks as ExitBlock[]) : []
}

/** 탈퇴한다. 되돌릴 수 없다 — 성공하면 이 기기의 토큰도 버린다 */
export async function withdraw(password: string): Promise<void> {
  await call('withdraw', [password])
  clearToken()
}
