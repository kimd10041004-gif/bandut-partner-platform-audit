import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { ADMIN_FAIL_WEIGHT, DEFAULT_WORKSPACE, handleAuth } from '../server/handlers/auth'
import { handleMarketplace } from '../server/marketplaceApi'
import { SESSION_COOKIE, sessionOf } from '../server/session'
import { MAX_FAILS_PER_WINDOW, resetRateLimit } from '../server/rateLimit'

/**
 * 29-29: 세션 쿠키가 서버를 한 바퀴 도는지 — 발급·읽기·CSRF·로그아웃·비밀번호 변경 뒤 폐기·관리자 실패 가중.
 */
const DB_URL = process.env['DATABASE_URL']
const PHONE = '010' + String(Date.now()).slice(-8)
const HOST = 'app.test'
const SCHEMA = 'session_cookie_http_test'
let pool: pg.Pool
let mpPool: pg.Pool
const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ DATABASE_URL: DB_URL, ADMIN_PASSWORD: 'ci-admin-pass-1', ...extra }) as NodeJS.ProcessEnv
const post = (op: string, args: unknown[], headers: Record<string, string> = {}, ip = '203.0.113.60') =>
  handleAuth({ method: 'POST', headers: { 'x-forwarded-for': ip, host: HOST, ...headers }, query: {}, body: { op, args } }, env())
const cookieHeader = (r: { headers?: Record<string, string> }): string => r.headers?.['set-cookie'] ?? ''
const cookieValue = (r: { headers?: Record<string, string> }): string => /^bandut_session=([^;]*)/.exec(cookieHeader(r))?.[1] ?? ''

describe.skipIf(!DB_URL)('29-29: 세션 쿠키', () => {
  beforeAll(async () => {
    resetRateLimit()
    const admin = new pg.Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(readFileSync('db/schema.sql', 'utf8'))
    // 마켓플레이스 표는 이 테스트의 스키마에 — 세션·계정 표(public)는 건드리지 않는다
    await admin.query(`drop schema if exists ${SCHEMA} cascade`)
    await admin.query(`create schema ${SCHEMA}`)
    await admin.query(`set search_path = ${SCHEMA}`)
    await admin.query(readFileSync('db/marketplace.pg.sql', 'utf8'))
    await admin.end()
    pool = new pg.Pool({ connectionString: DB_URL })
    mpPool = new pg.Pool({ connectionString: DB_URL, options: `-c search_path=${SCHEMA},public` })
    const reg = await post('register', [
      { role: 'customer', name: '쿠키고객', phone: PHONE, password: 'cookie-pw-1', agreeTerms: true, agreePrivacy: true },
    ])
    expect(reg.status, JSON.stringify(reg.body)).toBe(200)
    const otp = String(((reg.body as { result?: { otp?: string } }).result ?? {}).otp)
    expect((await post('verifyOtp', ['customer', PHONE, otp])).status).toBe(200)
  })
  afterAll(async () => {
    await pool?.end()
    await mpPool?.end()
    const admin = new pg.Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(`drop schema if exists ${SCHEMA} cascade`)
    await admin.end()
  })

  it('로그인 응답이 HttpOnly 세션 쿠키를 내리고, 그 값이 살아 있는 세션이다', async () => {
    const r = await post('login', ['customer', PHONE, 'cookie-pw-1'])
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(cookieHeader(r)).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]+; Path=/; HttpOnly; SameSite=Lax; Max-Age=\\d+$`))
    expect(cookieHeader(r)).not.toContain('Secure') // VERCEL_ENV 없음 = 로컬·CI
    expect(cookieValue(r)).toBe((r.body as { token?: string }).token)
    expect(await sessionOf(pool, DEFAULT_WORKSPACE, cookieValue(r))).not.toBeNull()
  })

  it('쿠키만으로 읽기 요청이 로그인된다 — 이미지·SSE 가 이 길이다', async () => {
    const login = await post('login', ['customer', PHONE, 'cookie-pw-1'])
    const me = await handleMarketplace(
      { method: 'GET', path: ['me'], headers: { host: HOST, cookie: `${SESSION_COOKIE}=${cookieValue(login)}` }, query: {}, body: null },
      mpPool,
    )
    expect(me.status, JSON.stringify(me.body)).toBe(200)
    expect(JSON.stringify(me.body)).toContain('쿠키고객')
  })

  it('쿠키만 실린 쓰기 요청은 같은 출처의 증거가 없으면 로그인되지 않는다 (CSRF), 있으면 된다', async () => {
    const login = await post('login', ['customer', PHONE, 'cookie-pw-1'])
    const cookie = `${SESSION_COOKIE}=${cookieValue(login)}`
    const blind = await post('me', [], { cookie })
    expect(blind.status).toBe(401)
    const foreign = await post('me', [], { cookie, origin: 'https://evil.example' })
    expect(foreign.status).toBe(401)
    const same = await post('me', [], { cookie, origin: `https://${HOST}` })
    expect(same.status, JSON.stringify(same.body)).toBe(200)
    const fetchMeta = await post('me', [], { cookie, 'sec-fetch-site': 'same-origin' })
    expect(fetchMeta.status).toBe(200)
  })

  it('로그아웃은 세션을 폐기하고 쿠키를 지운다', async () => {
    const login = await post('login', ['customer', PHONE, 'cookie-pw-1'])
    const token = cookieValue(login)
    const out = await post('logout', [], { cookie: `${SESSION_COOKIE}=${token}`, origin: `https://${HOST}` })
    expect(out.status).toBe(200)
    expect(cookieHeader(out)).toMatch(new RegExp(`^${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0$`))
    expect(await sessionOf(pool, DEFAULT_WORKSPACE, token)).toBeNull()
  })

  it('비밀번호를 바꾸면 다른 기기의 세션은 끝나고 이 기기는 남는다 (자체 감사 12)', async () => {
    const here = cookieValue(await post('login', ['customer', PHONE, 'cookie-pw-1']))
    const there = cookieValue(await post('login', ['customer', PHONE, 'cookie-pw-1']))
    expect(await sessionOf(pool, DEFAULT_WORKSPACE, there)).not.toBeNull()
    const changed = await post('changePassword', ['cookie-pw-1', 'cookie-pw-2'], { authorization: `Bearer ${here}` })
    expect(changed.status, JSON.stringify(changed.body)).toBe(200)
    expect(await sessionOf(pool, DEFAULT_WORKSPACE, here)).not.toBeNull()
    expect(await sessionOf(pool, DEFAULT_WORKSPACE, there)).toBeNull()
    // 원래대로 (다음 테스트를 위해)
    expect((await post('changePassword', ['cookie-pw-2', 'cookie-pw-1'], { authorization: `Bearer ${here}` })).status).toBe(200)
  })

  it('관리자 로그인 실패는 IP 실패 표에 여러 회분으로 센다 — 5번이면 429 (자체 감사 04)', async () => {
    const ip = '203.0.113.61'
    const tries = Math.ceil(MAX_FAILS_PER_WINDOW / ADMIN_FAIL_WEIGHT)
    for (let i = 0; i < tries; i += 1) {
      const r = await post('login', ['admin', 'admin', 'definitely-wrong-' + i], {}, ip)
      expect(r.status, `${i}: ${JSON.stringify(r.body)}`).toBe(422)
    }
    expect((await post('login', ['admin', 'admin', 'ci-admin-pass-1'], {}, ip)).status).toBe(429)
    // 고객 실패는 1회분 — 같은 횟수로는 막히지 않는다
    const ip2 = '203.0.113.62'
    for (let i = 0; i < tries; i += 1) await post('login', ['customer', PHONE, 'wrong-' + i], {}, ip2)
    expect((await post('login', ['customer', PHONE, 'cookie-pw-1'], {}, ip2)).status).not.toBe(429)
  })
})
