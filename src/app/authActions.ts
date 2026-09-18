import type { AdminGrade } from '../../server/domain/adminGrade'
import {
  AuthError,
  type AuthRole,
  type AuthSession,
  type AccountView,
  type SignupRole,
  type ConsentRecord,
  type PayoutAccount,
  type AuthService,
  type PartnerType,
  type AdminAccountView,
} from '../../server/domain/auth'
import type { HttpAuthClient, AuthCallResult } from '../domain/ports/httpAuth'
import type { TokenStore } from './session'

export interface RegisterInput {
  role: SignupRole
  name: string
  phone: string
  password: string
  partnerType?: PartnerType
  bizNo?: string
  agreeTerms: boolean
  agreePrivacy: boolean
  marketing?: boolean
}

/**
 * 계정·세션 변경의 단일 진입 (28-70). 화면은 이것만 부른다 — `auth.login()` 같은 직접 호출은 서버 모드에서 던진다.
 *
 * - 로컬 모드(`AUTH_MODE === 'local'`, 기본): 지금까지처럼 `AuthService`를 바로 부른다. 동작 무변화.
 * - 서버 모드: `HttpAuthClient`로 `api/auth.ts`를 부르고, 응답의 세션·토큰·계정 뷰를 **거울**에 넣는다.
 *   실패는 `AuthError`로 던진다 — 화면의 `isKnownError` 경로가 그대로 문구를 보여준다.
 */
export interface AuthActions {
  readonly mode: 'local' | 'server'
  login(role: AuthRole, idOrPhone: string, password: string): Promise<AuthSession>
  register(input: RegisterInput): Promise<{ account: AccountView; otp: string }>
  verifyOtp(role: SignupRole, phone: string, code: string): Promise<void>
  logout(role: AuthRole): Promise<void>
  /** 서버 모드: 저장된 토큰으로 세션·거울을 복원한다(앱 시작·탭 복귀). 로컬 모드: 아무 일도 안 한다 */
  restore(): Promise<void>
  changePassword(role: AuthRole, current: string, next: string): Promise<void>
  setMarketingOptIn(role: SignupRole, on: boolean): Promise<ConsentRecord>
  setPayoutAccount(input: { bank: string; number: string; holder: string }): Promise<PayoutAccount>
  withdraw(role: SignupRole, password: string): Promise<AccountView>
  approvePartner(id: string): Promise<AccountView>
  rejectPartner(id: string, reason: string): Promise<AccountView>
  setSuspended(id: string, suspended: boolean): Promise<AccountView>
  /** 28-90: 관리자가 파트너 정산 계좌의 예금주·계좌를 확인했다고 기록한다 — 인증 전에는 지급되지 않는다 */
  verifyPayoutAccount(id: string): Promise<PayoutAccount>
  purgeAccount(id: string): Promise<void>
  // ── 관리자 계정·등급 (28-89-A) — 소유자만 ──
  listAdmins(): Promise<AdminAccountView[]>
  addAdmin(input: { id: string; name: string; grade: AdminGrade; password: string }): Promise<AdminAccountView>
  setAdminGrade(id: string, grade: AdminGrade): Promise<AdminAccountView>
  removeAdmin(id: string): Promise<void>
  resetAdminPassword(id: string, next: string): Promise<void>
}

export function createAuthActions(
  auth: AuthService,
  http: HttpAuthClient | null,
  tokens: TokenStore,
  /**
   * 세션이 생기거나 복원됐을 때 — 복제기가 원격을 다시 본다. **끝날 때까지 기다린다** (28-71-01):
   * 첫 접촉의 accept(원격 통째 교체)가 끝나기 전에 로그인이 "끝나면" 그 직후의 로컬 저장(파트너 프로필 시드)이 덮인다.
   */
  onSession?: () => Promise<void> | void,
): AuthActions {
  if (http === null) return localActions(auth)

  const call = async (op: string, args: unknown[], role: AuthRole | null): Promise<AuthCallResult & { ok: true }> => {
    const res = await http.call(op, args, role === null ? null : tokens.for(role))
    if (!res.ok) {
      // 서버가 이 토큰을 모른다(만료·폐기) — 거울도 그 사실을 알아야 게이트가 다시 로그인을 받는다
      if (res.status === 401 && role !== null) {
        tokens.clear(role)
        auth.logout(role)
      }
      throw new AuthError(res.error)
    }
    if (res.mirror) auth.applyMirror(res.mirror.accounts, res.mirror.complete, res.mirror.admins)
    if (res.session) auth.adoptSession(res.session)
    return res
  }

  return {
    mode: 'server',
    async login(role, idOrPhone, password) {
      const res = await call('login', [role, idOrPhone, password], null)
      if (typeof res.token !== 'string' || !res.session) throw new AuthError('서버가 세션을 돌려주지 않았습니다')
      tokens.set(role, res.token)
      await settleSession(onSession)
      return res.session
    },
    async register(input) {
      const res = await call('register', [input], null)
      const r = res.result as { account?: AccountView; otp?: string } | null
      if (!r || !r.account || typeof r.otp !== 'string') throw new AuthError('서버 응답의 모양이 올바르지 않습니다')
      return { account: r.account, otp: r.otp }
    },
    async verifyOtp(role, phone, code) {
      await call('verifyOtp', [role, phone, code], null)
    },
    async logout(role) {
      const token = tokens.for(role)
      // 로컬은 먼저 지운다 — 서버가 안 닿아도 이 기기에서는 로그아웃이다
      tokens.clear(role)
      auth.logout(role)
      if (token !== null) await http.call('logout', [], token)
    },
    async restore() {
      for (const role of tokens.roles()) {
        try {
          await call('me', [], role)
        } catch (err) {
          if (!(err instanceof AuthError)) throw err
          // 401은 call()이 이미 정리했다. 그 밖(닿을 수 없음)은 다음 기회에 — 로컬 세션은 그대로 둔다
        }
      }
      if (tokens.roles().length > 0) await settleSession(onSession)
    },
    async changePassword(role, current, next) {
      await call('changePassword', [current, next], role)
    },
    async setMarketingOptIn(role, on) {
      return (await call('setMarketingOptIn', [on], role)).result as ConsentRecord
    },
    async setPayoutAccount(input) {
      return (await call('setPayoutAccount', [input], 'partner')).result as PayoutAccount
    },
    async withdraw(role, password) {
      const res = await call('withdraw', [password], role)
      tokens.clear(role)
      auth.logout(role)
      return res.result as AccountView
    },
    async approvePartner(id) {
      return (await call('approvePartner', [id], 'admin')).result as AccountView
    },
    async rejectPartner(id, reason) {
      return (await call('rejectPartner', [id, reason], 'admin')).result as AccountView
    },
    async setSuspended(id, suspended) {
      return (await call('setSuspended', [id, suspended], 'admin')).result as AccountView
    },
    async verifyPayoutAccount(id) {
      return (await call('verifyPayoutAccount', [id], 'admin')).result as PayoutAccount
    },
    async purgeAccount(id) {
      await call('purgeAccount', [id], 'admin')
    },
    async listAdmins() {
      return (await call('listAdmins', [], 'admin')).result as AdminAccountView[]
    },
    async addAdmin(input) {
      return (await call('addAdmin', [input.id, input.name, input.grade, input.password], 'admin'))
        .result as AdminAccountView
    },
    async setAdminGrade(id, grade) {
      return (await call('setAdminGrade', [id, grade], 'admin')).result as AdminAccountView
    },
    async removeAdmin(id) {
      await call('removeAdmin', [id], 'admin')
    },
    async resetAdminPassword(id, next) {
      await call('resetAdminPassword', [id, next], 'admin')
    },
  }
}

/** 복제 실패는 로그인 실패가 아니다 — 기다리되 던지지 않는다 */
async function settleSession(onSession: (() => Promise<void> | void) | undefined): Promise<void> {
  if (!onSession) return
  try {
    await onSession()
  } catch (err) {
    console.error('[authActions] onSession', err instanceof Error ? err.message : String(err))
  }
}

function localActions(auth: AuthService): AuthActions {
  return {
    mode: 'local',
    async login(role, idOrPhone, password) {
      return auth.login(role, idOrPhone, password)
    },
    async register(input) {
      const { account, otp } = auth.register(input)
      const { passwordHash: _pw, ...view } = account
      return { account: view, otp }
    },
    async verifyOtp(role, phone, code) {
      auth.verifyOtp(role, phone, code)
    },
    async logout(role) {
      auth.logout(role)
    },
    async restore() {
      /* 로컬 모드: 세션은 이미 storage에서 로드됐다 */
    },
    async changePassword(role, current, next) {
      auth.changePassword(role, current, next)
    },
    async setMarketingOptIn(role, on) {
      return auth.setMarketingOptIn(role, on)
    },
    async setPayoutAccount(input) {
      return auth.setPayoutAccount(input)
    },
    async withdraw(role, password) {
      return auth.withdraw(role, password)
    },
    async approvePartner(id) {
      return auth.approvePartner(id)
    },
    async rejectPartner(id, reason) {
      return auth.rejectPartner(id, reason)
    },
    async setSuspended(id, suspended) {
      return auth.setSuspended(id, suspended)
    },
    async verifyPayoutAccount(id) {
      return auth.verifyPayoutAccount(id, actorId(auth))
    },
    async purgeAccount(id) {
      auth.purgeAccount(id)
    },
    // 28-89-A: 로컬 모드의 행위자는 지금 로그인한 관리자다 — 도메인이 소유자인지 확인한다
    async listAdmins() {
      return auth.listAdmins()
    },
    async addAdmin(input) {
      return auth.addAdmin(actorId(auth), input)
    },
    async setAdminGrade(id, grade) {
      return auth.setAdminGrade(actorId(auth), id, grade)
    },
    async removeAdmin(id) {
      auth.removeAdmin(actorId(auth), id)
    },
    async resetAdminPassword(id, next) {
      auth.resetAdminPassword(actorId(auth), id, next)
    },
  }
}

/** 로컬 모드 — 관리자 세션이 없으면 관리자 계정 관리도 없다 */
function actorId(auth: AuthService): string {
  const s = auth.sessionFor('admin')
  if (s === undefined) throw new AuthError('관리자 로그인이 필요합니다')
  return s.accountId
}
