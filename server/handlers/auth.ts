/**
 * 계정·세션 API (28-70) — `POST /api/auth` `{ op, args }`.
 *
 * ## 규칙은 한 코드다
 *
 * 이 핸들러는 **클라이언트와 같은 `AuthService`**(src/domain/auth.ts)를 Postgres 행(`auth_state`) 위에서 돌린다.
 * 가입 검증·비밀번호 해시·로그인 잠금·OTP 만료·파트너 승인·탈퇴 규칙을 서버용으로 다시 쓰지 않는다 —
 * 그 규칙의 테스트(`auth.test.ts`)가 곧 서버 규칙의 테스트다. 행은 트랜잭션 + `for update`로 op마다 직렬화된다.
 *
 * ## 세션
 *
 * `login`이 불투명 토큰을 발급하고(`server/session.ts`, 저장은 sha256만) `Bearer <토큰>`이 이후 모든 호출과
 * `/api/snapshot`의 인증이다. 브라우저의 역할별 세션 모델(고객·파트너·관리자 동시 로그인)은 그대로다 —
 * 토큰도 역할별로 하나씩이다.
 *
 * ## 권한
 *
 * | op | 누가 |
 * |---|---|
 * | register · verifyOtp · login | 누구나 |
 * | logout · me | 세션 |
 * | changePassword · setMarketingOptIn · setPayoutAccount · withdraw | 세션 본인 (역할은 세션의 것) |
 * | listAccounts · approvePartner · rejectPartner · setSuspended · purgeAccount | admin 세션 |
 *
 * ## 인가는 여기까지다
 *
 * 스냅샷은 마켓플레이스 전체라 로그인한 계정은 누구나 `/api/snapshot`을 통째로 읽고 쓴다(28-68 감사 정정).
 * 이 파일이 주는 것은 "서버가 확인한 계정만, 계정별 토큰으로, 만료·폐기 가능하게" — 그리고 `snapshots.updated_by`의 귀속이다.
 *
 * ## 관리자 초기 비밀번호
 *
 * `ADMIN_PASSWORD` 환경변수. 없거나 8자 미만이거나 시연 비밀번호와 같으면 **503** — 시연값으로 조용히 열리지 않는다.
 * 행이 처음 만들어질 때 한 번 적용되고, 그 뒤는 관리자 화면의 비밀번호 변경이 진실이다.
 *
 * ## OTP — 가입 코드는 없앴다 (29-21)
 *
 * `register`가 OTP를 **응답에 돌려준다** — 시연이다. 그래서 `verified`는 아직 휴대폰 소유를 뜻하지 않는다.
 * 그 자리를 `authSafety.ts`가 막는다: 인증번호를 전달할 방법이 없는 서버는 가입을 받지 않고, 운영은 어떤
 * 플래그로도 개발용 인증번호를 내주지 않는다. SMS 연동 지점은 `register` 한 곳이다(응답에서 OTP를 빼고 발송으로 바꾼다).
 *
 * 28-70-01의 **가입 코드** 환경변수는 29-21에서 없앴다. 그것이 지키던 것은 "가입 = 마켓플레이스 전체
 * 스냅샷의 읽기·쓰기"라는 당시의 전제였는데, 29-1이 v17 마켓플레이스를 Postgres로 옮기면서 권한이 역할로
 * 갈렸다(`lib/service.ts`의 `approved()`·`view()`). 이미 잠긴 문에 덧댄 자물쇠였고, 값이 어긋나면 아무도
 * 못 들어오는 고장점이었다(29-20-3). 남은 자물쇠는 운영자 승인이고 그것은 서버가 건다.
 *
 * ## 워크스페이스
 *
 * 계정 상태는 `main` 하나다(28-70-04b: `?workspace`를 받던 것을 없앴다 — `/api/snapshot`은 세션을 항상 `main`에서 찾았다).
 */
import {
  AuthService,
  ADMIN_INITIAL_PASSWORD,
  type AuthRole,
  type AuthSession,
  type AccountView,
  type SignupRole,
  type AdminAccountView,
} from '../domain/auth'
import { DomainError } from '../domain/errors'
import { getPool, withTx } from '../db'
import { resolveDatabaseUrl } from '../databaseUrl'
import {
  devOtpAllowed,
  emailDeliverable,
  mailConfigured,
  otpDeliverable,
  MAIL_UNDELIVERABLE,
  OTP_UNDELIVERABLE,
} from '../authSafety'
import {
  emailVerificationMail,
  MailError,
  MAIL_SEND_FAILED,
  passwordResetMail,
  sendMail,
  type MailSender,
} from '../mail'
import { dbFingerprint } from '../dbFingerprint'
import { readProbes, writeProbe } from '../dbProbe'
import { AuthStateError, loadAuth, saveAuth } from '../authState'
import {
  clearedSessionCookie,
  cookieSecure,
  issueSession,
  pruneSessions,
  revokeAccount,
  revokeOthers,
  revokeToken,
  sessionCookie,
  sessionOf,
  tokenOf,
} from '../session'
import { installScryptHasher } from '../passwordHasher'

// 29-29: 서버에서는 비밀번호를 scrypt 로 해시한다. 도메인은 해시 구현을 모른다 — 여기서 끼운다.
installScryptHasher()

/** 관리자 로그인 실패는 IP 실패 표에 여러 회분으로 센다 — 아이디가 고정이라 무차별 대입의 표적이다 (29-29) */
export const ADMIN_FAIL_WEIGHT = 4
import { withdrawBlocks } from '../accountExit'
import { clientIpOf, isThrottled, mailThrottled, recordFailure, recordMailRequest } from '../rateLimit'
import { canAdmin, isAdminGrade, type AdminAction } from '../domain/adminGrade'
import { randomBytes } from 'node:crypto'
import type { ApiRequest, ApiResponse } from './snapshot'

export const DEFAULT_WORKSPACE = 'main'
/**
 * 요청 IP를 신뢰할 수 없으면 **프로세스당 한 번** 남긴다 (28-72-04c). 잠금 범위·IP 제한이 조용히
 * 전원 공유로 무너지는 상태이므로, 켜기 전에 사람이 알아야 한다. 동작 자체는 바꾸지 않는다.
 */
/**
 * 경고를 한 번만 찍기 위한 표식 — **인스턴스마다 따로다**(28-88-05).
 * 그래서 인스턴스가 여러 개면 경고가 여러 번 나온다. 로그가 조금 시끄러워질 뿐 판단에는 쓰지 않으므로
 * 그대로 둔다. (판단에 쓰는 상태였다면 인스턴스 경계가 곧 버그였을 것이다.)
 */
let warnedUntrustedIp = false
function warnUntrustedIpOnce(trusted: boolean): void {
  if (trusted || warnedUntrustedIp) return
  warnedUntrustedIp = true
  console.warn(
    '[auth] 요청 IP를 신뢰할 수 없습니다(x-forwarded-for·x-real-ip 없음) — 잠금 범위와 IP 실패 제한이 모든 사용자 공유로 무너집니다',
  )
}

const PUBLIC_OPS = new Set(['register', 'verifyOtp', 'login', 'requestPasswordReset', 'resetPassword'])
const SESSION_OPS = new Set([
  'logout',
  'me',
  'changePassword',
  'setMarketingOptIn',
  'setPayoutAccount',
  'withdraw',
  // 29-24: 탈퇴할 수 있는 상태인지 미리 본다. 읽기만 한다 — 화면이 버튼을 내걸기 전에 묻는다
  'withdrawCheck',
  // 29-27: 이메일 등록(인증 메일 발송)과 인증 — 비밀번호 찾기의 두 번째 길을 여는 자리
  'setEmail',
  'verifyEmail',
])
/**
 * 관리자 op 와 그것에 필요한 행위 (28-89-A). 등급은 세션에 있고(`sessions.grade`), 판단은 `canAdmin`이 한다.
 * 28-88까지는 "관리자인가"만 봤다 — 열람 계정이 파기를 부를 수 있었다.
 */
const ADMIN_OP_ACTION: Record<string, AdminAction> = {
  // 29-11: 이 배포가 어느 DB를 보는지. 공개 주소에 진단을 걸지 않으려고 관리자 op로 둔다
  dbInfo: 'view',
  // 29-17: 데이터 분리 확인용 표식 남기기. 쓰기이므로 열람 등급으로는 못 한다
  dbProbe: 'operate',
  listAccounts: 'view',
  approvePartner: 'operate',
  rejectPartner: 'operate',
  setSuspended: 'operate',
  verifyPayoutAccount: 'operate',
  purgeAccount: 'destructive',
  listAdmins: 'view',
  addAdmin: 'manageAdmins',
  setAdminGrade: 'manageAdmins',
  removeAdmin: 'manageAdmins',
  resetAdminPassword: 'manageAdmins',
}
const ADMIN_OPS = new Set(Object.keys(ADMIN_OP_ACTION))

/** 성공 응답 — 클라이언트 거울이 그대로 받아들인다 */
export interface AuthOkBody {
  ok: true
  result: unknown
  token?: string
  session?: AuthSession
  mirror?: { accounts: AccountView[]; complete: boolean; admins?: AdminAccountView[] }
}

function err(status: number, error: string): ApiResponse {
  return { status, body: { ok: false, error } }
}

function isRole(v: unknown): v is AuthRole {
  return v === 'customer' || v === 'partner' || v === 'admin'
}
function isSignupRole(v: unknown): v is SignupRole {
  return v === 'customer' || v === 'partner'
}
function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new BadArgs(`${what}가 문자열이 아닙니다`)
  return v
}
class BadArgs extends Error {}

/** 파싱된 요청 본문 — `{ op, args }` */
function parseOp(raw: unknown): { op: string; args: unknown[] } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o['op'] !== 'string') return null
  const args = o['args']
  if (args !== undefined && !Array.isArray(args)) return null
  return { op: o['op'], args: (args as unknown[] | undefined) ?? [] }
}

/**
 * 바깥 세상으로 나가는 것들 (29-27). 테스트가 진짜 발송사 대신 끼운다 — 운영은 기본값 그대로.
 */
export interface AuthDeps {
  sendMail?: MailSender
}

export async function handleAuth(req: ApiRequest, env: NodeJS.ProcessEnv, deps: AuthDeps = {}): Promise<ApiResponse> {
  const mail: MailSender = deps.sendMail ?? ((e, m) => sendMail(e, m))
  const databaseUrl = resolveDatabaseUrl(env)
  const adminPassword = env.ADMIN_PASSWORD
  if (!databaseUrl) return err(503, '서버 저장소가 아직 연결되지 않았습니다')
  if (!adminPassword || adminPassword.length < 8 || adminPassword === ADMIN_INITIAL_PASSWORD) {
    // 시연 비밀번호로 열리지 않는다 — 환경변수가 없는 것보다 503이 낫다
    return err(503, 'ADMIN_PASSWORD가 없거나 시연값입니다 — 8자 이상의 다른 값을 설정하세요')
  }
  if (req.method !== 'POST') return err(405, '지원하지 않는 메서드입니다')
  const workspaceId = DEFAULT_WORKSPACE
  const parsed = parseOp(req.body)
  if (parsed === null) return err(400, '요청 본문이 올바르지 않습니다 ({ op, args })')
  const { op, args } = parsed
  if (!PUBLIC_OPS.has(op) && !SESSION_OPS.has(op) && !ADMIN_OPS.has(op)) return err(400, `알 수 없는 op: ${op}`)
  const token = tokenOf(req.headers, req.method)
  // 29-11: 인증번호를 전달할 방법이 없으면 가입을 받지 않는다. 받아 봐야 사용자는 번호를 얻지 못하고
  // 미인증 계정만 쌓인다. 운영에서 개발용 번호로 대신하지 않는다 — 그것이 휴대폰 인증을 무의미하게 만든다.
  // 29-27: 복구 대상이 이메일이면 메일 쪽 문을 본다. 문자가 없어도 메일이 있으면 이메일 복구는 열린다.
  const resetByEmail = op === 'requestPasswordReset' && typeof args[1] === 'string' && args[1].includes('@')
  if (op === 'register' && !otpDeliverable(env)) return err(503, OTP_UNDELIVERABLE)
  if (op === 'requestPasswordReset' && !resetByEmail && !otpDeliverable(env)) return err(503, OTP_UNDELIVERABLE)
  if ((resetByEmail || op === 'setEmail') && !emailDeliverable(env)) return err(503, MAIL_UNDELIVERABLE)
  // 28-70-03c: 한 IP의 반복 실패 — 도메인 잠금(전화번호 기준)이 남을 잠그는 도구가 되지 않게 IP 쪽에서도 끊는다
  const { ip, trusted: ipTrusted } = clientIpOf(req.headers)
  warnUntrustedIpOnce(ipTrusted)
  /**
   * 28-74-03: 잠금 **범위**로는 믿을 수 있을 때만 쓴다.
   *
   * 헤더가 없으면 `ip`는 모두가 공유하는 `'unknown'`이다. 28-73-03은 그 값으로도 "최근 성공 IP"를 기록했고,
   * 그 뒤에는 **누구나** 그 계정의 계정 잠금(30회)에서 면제됐다 — 코드가 방금 로그로 "이 값은 믿을 수 없다"고
   * 외친 값을 가지고 잠금을 면제할지 정한 셈이다. 믿을 수 없으면 범위 없이 간다(28-71-02 이전과 같은,
   * 정직한 동작). `isTrustedIp`/`rememberTrustedIp`는 범위가 없으면 면제도 기록도 하지 않는다.
   */
  const lockScope = ipTrusted ? ip : undefined
  if (['login', 'register', 'verifyOtp', 'requestPasswordReset', 'resetPassword'].includes(op) && isThrottled(ip)) {
    return err(429, '잠시 후 다시 시도해 주세요')
  }
  // 29-27 자체 감사 02: 메일이 나갈 수 있는 요청은 결과와 무관하게 IP 당 횟수를 센다 — 성공이 곧 메일 한 통이다
  if (resetByEmail || op === 'setEmail') {
    if (mailThrottled(ip)) return err(429, '인증 메일 요청이 많습니다 — 잠시 후 다시 시도해 주세요')
    recordMailRequest(ip)
  }

  const db = getPool(databaseUrl)
  // 29-29: 로그인·로그아웃이 브라우저 쿠키를 함께 갱신한다 (server/session.ts)
  let setCookie: string | undefined
  try {
    return await withTx(db, async (c): Promise<ApiResponse> => {
      const session = await sessionOf(c, workspaceId, token)
      if (!PUBLIC_OPS.has(op) && session === null) return err(401, '로그인이 필요합니다')
      if (ADMIN_OPS.has(op) && session?.role !== 'admin') return err(403, '관리자만 할 수 있습니다')
      // 28-89-A: 등급. 28-89 이전 세션(grade 없음)은 아무것도 못 한다 — 다시 로그인하면 등급이 실린다
      if (ADMIN_OPS.has(op) && session !== null && !canAdmin(session.grade, ADMIN_OP_ACTION[op] as AdminAction)) {
        return err(
          403,
          session.grade === undefined
            ? '관리자 등급이 없는 세션입니다 — 다시 로그인하세요'
            : '이 작업을 할 등급이 아닙니다',
        )
      }

      const loaded = await loadAuth(c, workspaceId, adminPassword)
      const auth = loaded.auth
      if (session !== null) auth.adoptSession(session)

      const out: AuthOkBody = { ok: true, result: null }
      try {
        switch (op) {
          case 'register': {
            const input = args[0]
            if (typeof input !== 'object' || input === null) throw new BadArgs('가입 정보가 없습니다')
            const i = input as Record<string, unknown>
            if (!isSignupRole(i['role'])) throw new BadArgs('역할이 올바르지 않습니다')
            const r = auth.register({
              role: i['role'],
              name: str(i['name'], '이름'),
              phone: str(i['phone'], '휴대폰 번호'),
              password: str(i['password'], '비밀번호'),
              ...(i['partnerType'] === 'business' || i['partnerType'] === 'individual'
                ? { partnerType: i['partnerType'] }
                : {}),
              ...(typeof i['bizNo'] === 'string' ? { bizNo: i['bizNo'] } : {}),
              agreeTerms: i['agreeTerms'] === true,
              agreePrivacy: i['agreePrivacy'] === true,
              marketing: i['marketing'] === true,
              // 29-27: 선택. 가입 때는 미인증으로 두고 내 계정에서 인증한다
              ...(typeof i['email'] === 'string' ? { email: i['email'] } : {}),
            })
            const { passwordHash: _pw, ...view } = r.account
            // 29-11: 인증번호는 **보여도 되는 자리에서만** 나간다(`server/authSafety.ts`).
            // 28-31부터 조건 없이 실어 보내고 있었다 — 남의 번호를 적어도 서버가 번호를 돌려주므로
            // 휴대폰 인증이 "그 번호를 쥔 사람인가"를 확인하지 못했다.
            out.result = devOtpAllowed(env) ? { account: view, otp: r.otp } : { account: view }
            break
          }
          case 'requestPasswordReset': {
            if (!isSignupRole(args[0])) throw new BadArgs('역할이 올바르지 않습니다')
            // 29-12: 이미 가입한 사람이 자기 번호로 받는다. 당시 가입에 있던 코드를 여기서도 요구하면
            // 코드가 바뀐 뒤 기존 회원이 복구할 수 없게 되므로 묻지 않았다(29-21에서 코드 자체가 없어졌다).
            // 29-27: 두 번째 인자는 휴대폰 번호이거나 이메일이다. 이메일이면 메일로 보낸다 — 계정이 있을 때만
            // (`to` 가 null 이면 보낼 곳이 없다). 응답 모양은 같아서 밖에서는 가입 여부를 훑을 수 없다.
            const target = str(args[1], '휴대폰 번호 또는 이메일')
            const r = auth.requestPasswordReset(args[0], target)
            if (r.channel === 'email' && r.to !== null && mailConfigured(env)) {
              try {
                await mail(env, passwordResetMail(r.to, r.otp))
              } catch (e) {
                if (!(e instanceof MailError)) throw e
                // 자체 감사 05: 여기서 502 를 돌려주면 "이 주소에 계정이 있다"가 새어 나간다 — 모르는 주소는
                // 보낼 것이 없어 언제나 200 이기 때문이다. 로그에만 남기고 방금 낸 코드를 버린다. 응답은 같다.
                // 코드를 버리므로 다음 요청은 간격 제한에 걸리지 않고 새 코드를 낸다.
                console.error('[api/auth] 재설정 메일 발송 실패:', e.message)
                auth.discardPasswordReset(args[0], target)
              }
            }
            out.result = devOtpAllowed(env) ? { otp: r.otp, channel: r.channel } : { channel: r.channel }
            break
          }
          case 'resetPassword': {
            if (!isSignupRole(args[0])) throw new BadArgs('역할이 올바르지 않습니다')
            const a = auth.resetPassword(
              args[0],
              str(args[1], '휴대폰 번호 또는 이메일'),
              str(args[2], '인증번호'),
              str(args[3], '새 비밀번호'),
            )
            // 명세 3절: 재설정 뒤에는 기존 세션을 무효화한다. 비밀번호를 도둑맞아 바꾸는 것이라면,
            // 그 도둑의 세션이 살아 있는 채로 끝나는 복구는 복구가 아니다.
            await revokeAccount(c, workspaceId, a.id)
            const { passwordHash: _rp, ...rview } = a
            out.result = rview
            break
          }
          case 'verifyOtp': {
            if (!isSignupRole(args[0])) throw new BadArgs('역할이 올바르지 않습니다')
            // 28-71-03b가 여기서 가입 코드를 물었던 이유는 "남이 5번 틀려 대기 중 가입을 지우는 것"을
            // 막기 위해서였다. 29-21-C가 그것을 도메인에서 막는다 — 지우지 않고 잠시 쉰다(OTP_LOCK_MS).
            const a = auth.verifyOtp(args[0], str(args[1], '휴대폰 번호'), str(args[2], '인증번호'))
            const { passwordHash: _pw, ...view } = a
            out.result = view
            break
          }
          case 'login': {
            if (!isRole(args[0])) throw new BadArgs('역할이 올바르지 않습니다')
            // 28-71-02: 잠금 키에 요청 IP — 남의 IP에서 낸 실패가 관리자·회원의 로그인을 잠그지 않는다
            const s = auth.login(args[0], str(args[1], '아이디'), str(args[2], '비밀번호'), Date.now(), {
              ...(lockScope !== undefined ? { lockScope } : {}),
            })
            out.token = await issueSession(c, workspaceId, s)
            setCookie = sessionCookie(out.token, s.expiresAt, cookieSecure(env))
            out.session = s
            out.result = s
            out.mirror = mirrorFor(auth, s)
            // 28-70-03b: 로그인 성공 때 오래된 세션을 지운다 — 표가 영원히 자라지 않는다
            const pruned = await pruneSessions(c, workspaceId)
            if (pruned > 0) console.log(`[api/auth] 오래된 세션 ${pruned}행 정리`)
            break
          }
          case 'logout': {
            if (token !== null) await revokeToken(c, token)
            setCookie = clearedSessionCookie(cookieSecure(env))
            break
          }
          case 'me': {
            if (session === null) throw new BadArgs('unreachable')
            out.session = session
            out.result = session
            out.mirror = mirrorFor(auth, session)
            break
          }
          case 'changePassword': {
            if (session === null) throw new BadArgs('unreachable')
            auth.changePassword(session.role, str(args[0], '현재 비밀번호'), str(args[1], '새 비밀번호'))
            // 29-29 자체 감사 12: 비밀번호를 바꾸면 다른 기기의 세션은 끝난다 — 이 기기만 남긴다
            await revokeOthers(c, workspaceId, session.accountId, token)
            break
          }
          case 'setEmail': {
            if (session === null || !isSignupRole(session.role)) throw new BadArgs('고객·파트너 세션이 필요합니다')
            // 29-27: 주소를 저장하고 인증번호를 낸다. 메일이 연결돼 있으면 보내고, 아니면(로컬·CI) 응답에 싣는다
            const r = auth.setEmail(session.role, str(args[0], '이메일'))
            if (mailConfigured(env)) await mail(env, emailVerificationMail(r.email, r.otp))
            out.result = devOtpAllowed(env) ? { email: r.email, otp: r.otp } : { email: r.email }
            out.mirror = mirrorFor(auth, session)
            break
          }
          case 'verifyEmail': {
            if (session === null || !isSignupRole(session.role)) throw new BadArgs('고객·파트너 세션이 필요합니다')
            out.result = auth.verifyEmail(session.role, str(args[0], '인증번호'))
            out.mirror = mirrorFor(auth, session)
            break
          }
          case 'setMarketingOptIn': {
            if (session === null || !isSignupRole(session.role)) throw new BadArgs('고객·파트너 세션이 필요합니다')
            out.result = auth.setMarketingOptIn(session.role, args[0] === true)
            out.mirror = mirrorFor(auth, session)
            break
          }
          case 'verifyPayoutAccount': {
            if (session === null) throw new BadArgs('unreachable')
            out.result = auth.verifyPayoutAccount(str(args[0], '계정'), session.accountId)
            out.mirror = mirrorFor(auth, session)
            break
          }
          case 'setPayoutAccount': {
            if (session === null || session.role !== 'partner') throw new BadArgs('파트너 세션이 필요합니다')
            const input = args[0]
            if (typeof input !== 'object' || input === null) throw new BadArgs('계좌 정보가 없습니다')
            const i = input as Record<string, unknown>
            out.result = auth.setPayoutAccount({
              bank: str(i['bank'], '은행'),
              number: str(i['number'], '계좌번호'),
              holder: str(i['holder'], '예금주'),
            })
            out.mirror = mirrorFor(auth, session)
            break
          }
          case 'withdrawCheck': {
            if (session === null || !isSignupRole(session.role)) throw new BadArgs('고객·파트너 세션이 필요합니다')
            out.result = { blocks: await withdrawBlocks(c, session.role, session.accountId) }
            break
          }
          case 'withdraw': {
            if (session === null || !isSignupRole(session.role)) throw new BadArgs('고객·파트너 세션이 필요합니다')
            // 29-24: 상대가 기다리고 있는 거래를 두고 사라지지 못한다. 비밀번호 확인보다 **먼저** 본다 —
            //   맞는 비밀번호를 확인한 뒤 거절하면, 거절당한 사람에게 비밀번호가 맞았다는 사실만 알려 준다.
            const blocks = await withdrawBlocks(c, session.role, session.accountId)
            if (blocks.length > 0) throw new BadArgs(blocks.map((b) => b.message).join(' '))
            out.result = auth.withdraw(session.role, str(args[0], '비밀번호'))
            await revokeAccount(c, workspaceId, session.accountId)
            break
          }
          case 'dbInfo': {
            // 비밀은 담기지 않는다 — 호스트와 DB 이름만 (server/dbFingerprint.ts).
            // 표식은 **이 배포가 보는 DB에 실제로 있는 것**이다. 두 화면을 눈으로 대조한다.
            // 조회 실패는 빈 목록이 아니다 — probes 가 null 로 오고 화면이 판정을 멈춘다
            out.result = { ...dbFingerprint(env, databaseUrl), ...(await readProbes(c)) }
            break
          }
          case 'dbProbe': {
            // 운영 DB에는 표식을 남기지 않는다. 확인은 "프리뷰에 남기고 운영에서 안 보이는지"로 한다.
            if (env['VERCEL_ENV'] === 'production') {
              throw new BadArgs('운영에는 표식을 남기지 않습니다. 프리뷰에서 남기고 이 화면에서 없는 것을 확인하세요')
            }
            const id = `probe-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
            out.result = await writeProbe(c, id, env['VERCEL_ENV'] ?? '(로컬·CI)')
            break
          }
          case 'listAccounts': {
            out.result = auth.listAccounts()
            out.mirror = { accounts: auth.listAccounts(), complete: true }
            break
          }
          case 'approvePartner': {
            out.result = auth.approvePartner(str(args[0], '계정 ID'))
            out.mirror = { accounts: auth.listAccounts(), complete: true }
            break
          }
          case 'rejectPartner': {
            out.result = auth.rejectPartner(str(args[0], '계정 ID'), str(args[1], '거절 사유'))
            out.mirror = { accounts: auth.listAccounts(), complete: true }
            break
          }
          case 'setSuspended': {
            const id = str(args[0], '계정 ID')
            out.result = auth.setSuspended(id, args[1] === true)
            if (args[1] === true) await revokeAccount(c, workspaceId, id)
            out.mirror = { accounts: auth.listAccounts(), complete: true }
            break
          }
          case 'purgeAccount': {
            const id = str(args[0], '계정 ID')
            auth.purgeAccount(id)
            await revokeAccount(c, workspaceId, id)
            out.mirror = { accounts: auth.listAccounts(), complete: true }
            break
          }
          // ── 관리자 계정·등급 (28-89-A) — 소유자만. 도메인이 한 번 더 확인한다(assertOwner) ──
          case 'listAdmins': {
            out.result = auth.listAdmins()
            out.mirror = mirrorFor(auth, session as AuthSession)
            break
          }
          case 'addAdmin': {
            if (session === null) throw new BadArgs('unreachable')
            const g = args[2]
            if (!isAdminGrade(g)) throw new BadArgs('등급이 올바르지 않습니다')
            out.result = auth.addAdmin(session.accountId, {
              id: str(args[0], '아이디'),
              name: str(args[1], '이름'),
              grade: g,
              password: str(args[3], '비밀번호'),
            })
            out.mirror = mirrorFor(auth, session)
            break
          }
          case 'setAdminGrade': {
            if (session === null) throw new BadArgs('unreachable')
            const g = args[1]
            if (!isAdminGrade(g)) throw new BadArgs('등급이 올바르지 않습니다')
            const id = str(args[0], '아이디')
            out.result = auth.setAdminGrade(session.accountId, id, g)
            // 등급이 바뀐 관리자의 세션은 폐기한다 — 옛 등급이 토큰에 남아 있으면 안 된다
            await revokeAccount(c, workspaceId, id)
            out.mirror = mirrorFor(auth, session)
            break
          }
          case 'removeAdmin': {
            if (session === null) throw new BadArgs('unreachable')
            const id = str(args[0], '아이디')
            auth.removeAdmin(session.accountId, id)
            await revokeAccount(c, workspaceId, id)
            out.mirror = mirrorFor(auth, session)
            break
          }
          case 'resetAdminPassword': {
            if (session === null) throw new BadArgs('unreachable')
            const id = str(args[0], '아이디')
            auth.resetAdminPassword(session.accountId, id, str(args[1], '새 비밀번호'))
            await revokeAccount(c, workspaceId, id)
            out.mirror = mirrorFor(auth, session)
            break
          }
          default:
            return err(400, `알 수 없는 op: ${op}`)
        }
      } catch (e) {
        if (e instanceof BadArgs) return err(400, e.message)
        // 도메인 규칙 위반(비밀번호 불일치·잠금·중복 가입…) — 메시지가 곧 화면 문구다. 실패 기록(잠금 카운트)은 저장한다
        if (e instanceof DomainError) {
          if (op === 'login' || op === 'verifyOtp')
            recordFailure(ip, op === 'login' && args[0] === 'admin' ? ADMIN_FAIL_WEIGHT : 1)
          await saveAuth(c, workspaceId, loaded)
          return err(422, e.message)
        }
        throw e
      }
      await saveAuth(c, workspaceId, loaded)
      return {
        status: 200,
        body: out,
        headers: { 'cache-control': 'no-store', ...(setCookie === undefined ? {} : { 'set-cookie': setCookie }) },
      }
    })
  } catch (e) {
    if (e instanceof AuthStateError) return err(503, e.message)
    // 29-27: 인증 메일(`setEmail`)이 안 나갔으면 트랜잭션째 되돌아왔다 — 인증번호도 저장되지 않았다. 다시 요청하면
    // 새 코드다. 본인 세션이라 502 로 말해도 새는 것이 없다(재설정 쪽은 위에서 같은 모양으로 답한다).
    // 발송사의 답은 서버 로그에만 남긴다(상태 코드까지만 — `server/mail.ts`).
    if (e instanceof MailError) {
      console.error('[api/auth] 메일 발송 실패:', e.message)
      return err(502, MAIL_SEND_FAILED)
    }
    // 28-70-03d: DB 오류 원문은 서버 로그로, 클라이언트에는 일반 문구
    console.error('[api/auth]', e instanceof Error ? e.message : String(e))
    return err(503, '서버 저장소 오류 — 잠시 후 다시 시도해 주세요')
  }
}

/** 거울 — 관리자는 전체, 그 외는 자기 계정 하나 */
function mirrorFor(
  auth: AuthService,
  session: AuthSession,
): { accounts: AccountView[]; complete: boolean; admins?: AdminAccountView[] } {
  // 28-89-A: 관리자에게는 관리자 목록도 준다(해시 없는 뷰). 소유자 화면이 그것으로 계정을 관리한다
  if (session.role === 'admin') return { accounts: auth.listAccounts(), complete: true, admins: auth.listAdmins() }
  const own = auth.accountFor(session.role)
  return { accounts: own ? [own] : [], complete: false }
}

/** Vercel Serverless Function 진입점 — `api/snapshot.ts`와 같은 한 겹 */
export default async function handler(
  req: {
    method?: string
    headers: Record<string, string | string[] | undefined>
    query: Record<string, string | string[] | undefined>
    body?: unknown
  },
  res: { setHeader: (k: string, v: string) => void; status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const headers: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v
  const query: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(req.query)) query[k] = Array.isArray(v) ? v[0] : v
  const out = await handleAuth({ method: req.method ?? 'GET', headers, query, body: req.body }, process.env)
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v)
  res.status(out.status).json(out.body)
}
