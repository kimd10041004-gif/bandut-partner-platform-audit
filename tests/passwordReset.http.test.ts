/**
 * 비밀번호 복구가 **서버에서 실제로** 도는가 (29-12).
 *
 * 도메인 단언(`server/domain/auth.test.ts`)은 목적 분리·만료·시도 제한을 본다. 여기서 보는 것은
 * 도메인이 알 수 없는 절반이다 — **기존 세션이 정말 폐기되는가.** 비밀번호를 도둑맞아 바꾸는
 * 것이라면, 그 도둑의 세션이 살아 있는 채로 끝나는 복구는 복구가 아니다.
 *
 * `sessions` 표가 필요하므로 DB 없이는 건너뛴다(다른 통합 테스트와 같은 규칙).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { DEFAULT_WORKSPACE, handleAuth } from '../server/handlers/auth'
import { sessionOf } from '../server/session'

const DB_URL = process.env['DATABASE_URL']
/**
 * `handleAuth`는 자기 풀을 스스로 연다(`getPool(databaseUrl)`) — 검색 경로를 끼워 넣을 자리가 없다.
 * 그래서 전용 스키마를 만들어 두면 **쓰는 쪽과 읽는 쪽이 다른 곳을 본다**. 처음에 그렇게 짰고
 * "로그인했는데 세션이 없다"로 실패했다. 다른 통합 테스트와 같이 `public`을 쓰되, 번호를 실행마다
 * 다르게 만들어 남은 행과 부딪히지 않게 한다.
 */
const PHONE = '010' + String(Date.now()).slice(-8)

let pool: pg.Pool
const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ DATABASE_URL: DB_URL, ADMIN_PASSWORD: 'ci-admin-pass-1', ...extra }) as NodeJS.ProcessEnv

const post = (op: string, args: unknown[], token?: string, extra?: Record<string, string>) =>
  handleAuth(
    {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.44', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      query: {},
      body: { op, args },
    },
    env(extra),
  )

const resultOf = (r: { body: unknown }): Record<string, unknown> =>
  (r.body as { result?: Record<string, unknown> }).result ?? {}

describe.skipIf(!DB_URL)('29-12: 비밀번호 복구', () => {
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(readFileSync('db/schema.sql', 'utf8')) // 멱등하다 (28-68)
    await admin.end()
    pool = new pg.Pool({ connectionString: DB_URL })
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('복구가 끝나면 그 계정의 기존 세션이 살아 있지 않다', async () => {
    const reg = await post('register', [
      {
        role: 'customer',
        name: '박고객',
        phone: PHONE,
        password: 'password1',
        agreeTerms: true,
        agreePrivacy: true,
      },
    ])
    expect(reg.status, JSON.stringify(reg.body)).toBe(200)
    // 29-24: 확인하지 않고 지나가던 걸음이다. 여기가 실패하면 아래 로그인이 이유 없이 빨개진다
    const verified = await post('verifyOtp', ['customer', PHONE, String(resultOf(reg)['otp'])])
    expect(verified.status, JSON.stringify(verified.body)).toBe(200)

    const loggedIn = await post('login', ['customer', PHONE, 'password1'])
    const token = (loggedIn.body as { token?: string }).token
    expect(typeof token, JSON.stringify(loggedIn.body)).toBe('string')
    expect(await sessionOf(pool, DEFAULT_WORKSPACE, token)).not.toBeNull()

    const ask = await post('requestPasswordReset', ['customer', PHONE])
    expect(ask.status).toBe(200)
    const done = await post('resetPassword', ['customer', PHONE, String(resultOf(ask)['otp']), 'newpass12'])
    expect(done.status).toBe(200)

    // 이 줄이 이 파일의 이유다 — 도메인은 세션을 모른다
    expect(await sessionOf(pool, DEFAULT_WORKSPACE, token)).toBeNull()
    expect((await post('login', ['customer', PHONE, 'password1'])).status).not.toBe(200)
    const back = await post('login', ['customer', PHONE, 'newpass12'])
    // 29-24: 실패가 상태 코드만 말하면 원인을 찾는 데 몇 번을 더 돌려야 한다 — 본문을 함께 싣는다
    expect(back.status, JSON.stringify(back.body)).toBe(200)
  })

  it('복구도 인증번호를 전달할 방법이 없으면 받지 않는다 — 가입과 같은 문', async () => {
    const r = await post('requestPasswordReset', ['customer', PHONE], undefined, { VERCEL_ENV: 'production' })
    expect(r.status).toBe(503)
    expect(JSON.stringify(r.body)).toContain('문자 발송이 아직 연결되지 않아')
  })

  it('개발용 인증번호를 내주지 않는 자리에서는 응답에 코드가 없다', async () => {
    const r = await post('requestPasswordReset', ['customer', PHONE], undefined, {
      VERCEL_ENV: 'preview',
      SMS_PROVIDER: 'x',
      SMS_API_KEY: 'y',
      SMS_SENDER: 'z',
    })
    expect(r.status).toBe(200)
    expect(resultOf(r)['otp']).toBeUndefined()
  })

  /**
   * 29-27: 이메일로도 찾는다. 도메인 단언(`server/domain/authEmail.test.ts`)이 규칙을 보고, 여기는
   * 서버만 아는 둘을 본다 — **메일이 실제로 나가는가**(발송사는 끼워 넣는다), 그리고 **기존 세션이 폐기되는가**.
   */
  describe('이메일로 (29-27)', () => {
    const EMAIL_PHONE = '010' + String(Date.now() + 7).slice(-8)
    const EMAIL = `reset-${Date.now()}@example.test`
    const MAIL = { MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k', MAIL_SENDER: 'no-reply@example.test' }

    async function signedUpWithVerifiedEmail(): Promise<string> {
      const reg = await post('register', [
        {
          role: 'customer',
          name: '이고객',
          phone: EMAIL_PHONE,
          password: 'password1',
          agreeTerms: true,
          agreePrivacy: true,
        },
      ])
      expect(reg.status, JSON.stringify(reg.body)).toBe(200)
      expect((await post('verifyOtp', ['customer', EMAIL_PHONE, String(resultOf(reg)['otp'])])).status).toBe(200)
      const loggedIn = await post('login', ['customer', EMAIL_PHONE, 'password1'])
      const token = (loggedIn.body as { token?: string }).token as string
      // 등록 → 인증. 로컬(DATABASE_URL 만 있는 env)은 응답에 코드를 싣는다
      const set = await post('setEmail', [EMAIL], token)
      expect(set.status, JSON.stringify(set.body)).toBe(200)
      const verified = await post('verifyEmail', [String(resultOf(set)['otp'])], token)
      expect(verified.status, JSON.stringify(verified.body)).toBe(200)
      expect((resultOf(verified) as { emailVerifiedAt?: string }).emailVerifiedAt).toBeDefined()
      return token
    }

    it('인증된 이메일로 복구하면 새 비밀번호로만 들어오고 기존 세션은 죽는다', async () => {
      const token = await signedUpWithVerifiedEmail()
      expect(await sessionOf(pool, DEFAULT_WORKSPACE, token)).not.toBeNull()
      const ask = await post('requestPasswordReset', ['customer', EMAIL])
      expect(ask.status, JSON.stringify(ask.body)).toBe(200)
      expect(resultOf(ask)['channel']).toBe('email')
      const done = await post('resetPassword', ['customer', EMAIL, String(resultOf(ask)['otp']), 'newpass12'])
      expect(done.status, JSON.stringify(done.body)).toBe(200)
      expect(await sessionOf(pool, DEFAULT_WORKSPACE, token)).toBeNull()
      expect((await post('login', ['customer', EMAIL_PHONE, 'password1'])).status).not.toBe(200)
      const back = await post('login', ['customer', EMAIL_PHONE, 'newpass12'])
      expect(back.status, JSON.stringify(back.body)).toBe(200)
    })

    it('메일이 연결된 자리에서는 코드가 응답이 아니라 메일로 간다', async () => {
      const sent: Array<{ to: string; subject: string; text: string }> = []
      const sendMail = async (_env: NodeJS.ProcessEnv, m: { to: string; subject: string; text: string }) => {
        sent.push(m)
      }
      const r = await handleAuth(
        {
          method: 'POST',
          headers: { 'x-forwarded-for': '203.0.113.44' },
          query: {},
          body: { op: 'requestPasswordReset', args: ['customer', EMAIL] },
        },
        env({ VERCEL_ENV: 'preview', ...MAIL }),
        { sendMail },
      )
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(resultOf(r)['otp']).toBeUndefined()
      expect(sent).toHaveLength(1)
      expect(sent[0]!.to).toBe(EMAIL)
      const code = sent[0]!.text.match(/인증번호: (\d{6})/)?.[1]
      expect(code).toBeDefined()
      // 메일에 실린 코드가 진짜 코드다
      const done = await post('resetPassword', ['customer', EMAIL, code!, 'newpass34'])
      expect(done.status, JSON.stringify(done.body)).toBe(200)
    })

    it('모르는 이메일에는 메일을 보내지 않지만 응답은 같다 — 가입 여부를 훑을 수 없다', async () => {
      const sent: unknown[] = []
      const r = await handleAuth(
        {
          method: 'POST',
          headers: { 'x-forwarded-for': '203.0.113.44' },
          query: {},
          body: { op: 'requestPasswordReset', args: ['customer', `nobody-${Date.now()}@example.test`] },
        },
        env({ VERCEL_ENV: 'preview', ...MAIL }),
        { sendMail: async (_e, m) => void sent.push(m) },
      )
      expect(r.status).toBe(200)
      expect(resultOf(r)).toEqual({ channel: 'email' })
      expect(sent).toHaveLength(0)
    })

    it('재설정 메일이 안 나가도 응답은 모르는 주소와 같고, 코드는 남지 않는다 (자체 감사 05)', async () => {
      const { MailError } = await import('../server/mail')
      const call = (sendMail: (e: NodeJS.ProcessEnv, m: { to: string; text: string }) => Promise<void>) =>
        handleAuth(
          {
            method: 'POST',
            headers: { 'x-forwarded-for': '203.0.113.45' },
            query: {},
            body: { op: 'requestPasswordReset', args: ['customer', EMAIL] },
          },
          env({ VERCEL_ENV: 'preview', ...MAIL }),
          { sendMail },
        )
      const r = await call(async () => {
        throw new MailError('메일 발송사가 요청을 거절했습니다 (500)')
      })
      // 502 를 돌려주면 "이 주소에 계정이 있다"가 새어 나간다 — 모르는 주소와 같은 200 이다
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(resultOf(r)).toEqual({ channel: 'email' })
      // 코드는 버려졌다
      const done = await post('resetPassword', ['customer', EMAIL, '000000', 'newpass56'])
      expect(done.status).toBe(422)
      expect(JSON.stringify(done.body)).toContain('발급된 인증번호가 없습니다')
      // 그래서 바로 다시 요청하면 간격 제한 없이 새 코드가 메일로 나간다
      const sent: Array<{ to: string; text: string }> = []
      const again = await call(async (_e, m) => {
        sent.push(m)
      })
      expect(again.status).toBe(200)
      expect(sent).toHaveLength(1)
    })

    it('인증 메일(`setEmail`)이 안 나가면 502 다 — 본인 세션이라 새는 것이 없다', async () => {
      const { MailError } = await import('../server/mail')
      const loggedIn = await post('login', ['customer', EMAIL_PHONE, 'newpass34'])
      const token = (loggedIn.body as { token?: string }).token as string
      const r = await handleAuth(
        {
          method: 'POST',
          headers: { 'x-forwarded-for': '203.0.113.46', authorization: `Bearer ${token}` },
          query: {},
          body: { op: 'setEmail', args: [`other-${Date.now()}@example.test`] },
        },
        env({ VERCEL_ENV: 'preview', ...MAIL }),
        {
          sendMail: async () => {
            throw new MailError('메일 발송사가 요청을 거절했습니다 (500)')
          },
        },
      )
      expect(r.status).toBe(502)
      expect(JSON.stringify(r.body)).toContain('메일을 보내지 못했습니다')
    })
  })
})
