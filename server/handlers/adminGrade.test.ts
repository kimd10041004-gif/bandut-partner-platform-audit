import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleAuth } from './auth'
import { handleSnapshot } from './snapshot'
import { AuthService, ADMIN_INITIAL_PASSWORD, type AuthSession } from '../domain/auth'
import { AUTH_STORAGE_KEY } from '../domain/auth'

/**
 * 서버가 등급을 **실제로** 막는가 (28-89-A). DB 는 흉내 내고, 세션은 우리가 정한다.
 *
 * - `sessionOf` 가 돌려주는 세션의 `grade` 가 곧 서버의 판단 근거다(토큰에 실린 등급).
 * - `loadAuth` 는 진짜 `AuthService` 를 메모리 위에 만든다 — 도메인 규칙(소유자만)도 같이 본다.
 */
const fake = vi.hoisted(() => ({
  session: null as AuthSession | null,
  authBody: '' as string,
  revoked: [] as string[],
  snapshotWrites: 0,
}))

vi.mock('../db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db')>()),
  getPool: () => ({
    query: async (sql: string) => {
      if (sql.includes('update snapshots') || sql.includes('insert into snapshots')) fake.snapshotWrites += 1
      return { rows: [] }
    },
  }),
  withTx: async (_db: unknown, fn: (c: unknown) => Promise<unknown>) => fn({ query: async () => ({ rows: [] }) }),
}))

vi.mock('../session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session')>()),
  sessionOf: async () => fake.session,
  revokeAccount: async (_c: unknown, _ws: string, id: string) => void fake.revoked.push(id),
  revokeToken: async () => {},
  issueSession: async () => 'token',
  pruneSessions: async () => 0,
}))

vi.mock('../authState', async (importOriginal) => {
  const real = await importOriginal<typeof import('../authState')>()
  return {
    ...real,
    loadAuth: async () => {
      const m = new Map<string, string>()
      if (fake.authBody !== '') m.set(AUTH_STORAGE_KEY, fake.authBody)
      const storage = {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      }
      const auth = new AuthService(storage)
      if (fake.authBody === '') auth.bootstrapOwnerPassword('ci-admin-pass-1')
      return { auth, fresh: fake.authBody === '', before: auth.exportState() }
    },
    saveAuth: async (_c: unknown, _ws: string, loaded: { auth: AuthService }) => {
      fake.authBody = loaded.auth.exportState()
      return true
    },
  }
})

const env = { DATABASE_URL: 'postgres://unused', ADMIN_PASSWORD: 'ci-admin-pass-1' }
const post = (op: string, args: unknown[] = []) => ({
  method: 'POST',
  headers: { authorization: 'Bearer t' },
  query: {},
  body: { op, args },
})
const adminSession = (grade: AuthSession['grade'] | undefined, accountId = 'admin'): AuthSession => ({
  role: 'admin',
  accountId,
  name: '관리자',
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  ...(grade !== undefined ? { grade } : {}),
})

/** 소유자가 관리자 둘을 만든 상태의 auth_state 본문 */
function seededAuthBody(): string {
  const m = new Map<string, string>()
  const storage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
  const auth = new AuthService(storage)
  auth.changePassword('admin', ADMIN_INITIAL_PASSWORD, 'ci-admin-pass-1')
  auth.addAdmin('admin', { id: 'mgr', name: '매니저', grade: 'manager', password: 'manager-pass-1' })
  auth.addAdmin('admin', { id: 'vwr', name: '열람', grade: 'viewer', password: 'viewer-pass-1' })
  // 28-90: 정산 계좌를 등록한 파트너 하나 — 계좌 인증 op 의 대상
  const { otp } = auth.register({
    agreeTerms: true,
    agreePrivacy: true,
    role: 'partner',
    name: '반듯설비',
    phone: '01099998888',
    password: 'password1',
    partnerType: 'individual',
  })
  auth.verifyOtp('partner', '01099998888', otp)
  auth.login('partner', '01099998888', 'password1')
  auth.setPayoutAccount({ bank: '국민은행', number: '1234567890', holder: '반듯설비' })
  auth.logout('partner')
  return auth.exportState()
}

describe('api/auth 등급 게이트 (28-89-A)', () => {
  beforeEach(() => {
    fake.session = null
    fake.authBody = seededAuthBody()
    fake.revoked.length = 0
  })

  it('열람 등급은 목록만 본다 — 승인·파기는 403', async () => {
    fake.session = adminSession('viewer', 'vwr')
    expect((await handleAuth(post('listAccounts'), env)).status).toBe(200)
    expect((await handleAuth(post('listAdmins'), env)).status).toBe(200)
    for (const op of [
      'approvePartner',
      'rejectPartner',
      'setSuspended',
      'verifyPayoutAccount',
      'purgeAccount',
      'addAdmin',
      'removeAdmin',
    ]) {
      const r = await handleAuth(post(op, ['AC-0001', true]), env)
      // 수정 전: 관리자 역할이면 전부 통과했다(등급이라는 것이 없었다)
      expect(r.status, op).toBe(403)
      expect((r.body as { error: string }).error).toContain('등급')
    }
  })

  it('매니저는 운영은 하고 파기·관리자 관리는 못 한다', async () => {
    fake.session = adminSession('manager', 'mgr')
    // 운영 op 는 등급 게이트를 지난다(그 뒤 도메인이 계정을 못 찾아 422 — 403 이 아니라는 것이 요점)
    const approve = await handleAuth(post('approvePartner', ['AC-9999']), env)
    expect(approve.status).not.toBe(403)
    // 28-90: 계좌 인증은 매니저의 일이다 — 기록되고 거울에 실린다
    const verify = await handleAuth(post('verifyPayoutAccount', ['AC-0001']), env)
    expect(verify.status).toBe(200)
    expect((verify.body as { result: { verifiedBy: string } }).result.verifiedBy).toBe('mgr')
    expect(fake.revoked).toEqual([])
    for (const op of ['purgeAccount', 'addAdmin', 'setAdminGrade', 'removeAdmin', 'resetAdminPassword']) {
      expect((await handleAuth(post(op, ['vwr', 'viewer']), env)).status, op).toBe(403)
    }
  })

  it('소유자는 관리자를 만들고 등급을 바꾸고 제거한다 — 바뀐 관리자의 세션은 폐기된다', async () => {
    fake.session = adminSession('owner', 'admin')
    const add = await handleAuth(post('addAdmin', ['ops2', '운영2', 'manager', 'ops2-pass-1']), env)
    expect(add.status).toBe(200)
    const body = add.body as { result: { id: string; grade: string }; mirror: { admins: Array<{ id: string }> } }
    expect(body.result).toMatchObject({ id: 'ops2', grade: 'manager' })
    expect(body.mirror.admins.map((a) => a.id)).toEqual(['admin', 'mgr', 'vwr', 'ops2'])
    expect(JSON.stringify(body)).not.toContain('passwordHash')

    expect((await handleAuth(post('setAdminGrade', ['ops2', 'viewer']), env)).status).toBe(200)
    expect((await handleAuth(post('resetAdminPassword', ['ops2', 'new-pass-1234']), env)).status).toBe(200)
    expect((await handleAuth(post('removeAdmin', ['ops2']), env)).status).toBe(200)
    expect(fake.revoked).toEqual(['ops2', 'ops2', 'ops2'])
    // 잘못된 등급·마지막 소유자 강등은 400/422 로 말한다
    expect((await handleAuth(post('addAdmin', ['ops3', '운영3', 'root', 'ops3-pass-1']), env)).status).toBe(400)
    const demote = await handleAuth(post('setAdminGrade', ['admin', 'viewer']), env)
    expect(demote.status).toBe(422)
    expect((demote.body as { error: string }).error).toContain('마지막 소유자')
  })

  it('등급이 없는 옛 관리자 세션은 아무것도 못 한다 — 다시 로그인하라고 말한다', async () => {
    fake.session = adminSession(undefined)
    const r = await handleAuth(post('listAccounts'), env)
    expect(r.status).toBe(403)
    expect((r.body as { error: string }).error).toContain('다시 로그인')
  })

  it('관리자 로그인 응답의 세션에 등급이 실린다 (소유자 admin · 추가한 매니저)', async () => {
    const owner = await handleAuth(
      { method: 'POST', headers: {}, query: {}, body: { op: 'login', args: ['admin', 'admin', 'ci-admin-pass-1'] } },
      env,
    )
    expect(owner.status).toBe(200)
    expect((owner.body as { result: AuthSession }).result.grade).toBe('owner')
    const mgr = await handleAuth(
      { method: 'POST', headers: {}, query: {}, body: { op: 'login', args: ['admin', 'mgr', 'manager-pass-1'] } },
      env,
    )
    expect(mgr.status).toBe(200)
    expect((mgr.body as { result: AuthSession }).result.grade).toBe('manager')
  })
})

describe('api/snapshot 등급 게이트 (28-89-A)', () => {
  beforeEach(() => {
    fake.snapshotWrites = 0
  })
  const put = {
    method: 'PUT',
    headers: { authorization: 'Bearer t' },
    query: { workspace: 'main' },
    body: { body: '{}', expectedRev: null },
  }

  it('열람 등급의 PUT 은 403 — DB 에 닿지 않는다', async () => {
    fake.session = adminSession('viewer', 'vwr')
    const r = await handleSnapshot(put, env)
    // 수정 전: 관리자 세션이면 통째 쓰기가 그대로 들어갔다
    expect(r.status).toBe(403)
    expect((r.body as { error: string }).error).toContain('열람')
    expect(fake.snapshotWrites).toBe(0)
  })

  it('등급 없는 옛 관리자 세션의 PUT 도 403', async () => {
    fake.session = adminSession(undefined)
    expect((await handleSnapshot(put, env)).status).toBe(403)
  })

  it('열람 등급도 GET 은 된다', async () => {
    fake.session = adminSession('viewer', 'vwr')
    const r = await handleSnapshot(
      { method: 'GET', headers: { authorization: 'Bearer t' }, query: { workspace: 'main' }, body: null },
      env,
    )
    expect(r.status).toBe(200)
  })

  it('매니저·소유자의 PUT 은 등급에서 막히지 않는다', async () => {
    for (const g of ['manager', 'owner'] as const) {
      fake.session = adminSession(g)
      expect((await handleSnapshot(put, env)).status, g).not.toBe(403)
    }
  })
})
