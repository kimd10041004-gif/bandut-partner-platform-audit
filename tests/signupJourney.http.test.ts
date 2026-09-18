/**
 * 가입 → 재로그인 → 업체 제출 → 관리자 승인 → 권한 반영 (29-16-2).
 *
 * ## 왜 이 파일이 따로 필요한가
 *
 * 지금까지 이 여정은 **두 동강 나 있었다.**
 *
 *   `passwordReset.http.test`  가입·로그인까지 — 세션이 생기는 것까지만 본다
 *   `marketplace.http.test`    세션이 있다고 **가정하고** 시작한다(`issueSession` 으로 토큰을 만든다)
 *
 * 그래서 둘 사이의 이음매 — 진짜 가입으로 받은 토큰이 v17 `users` 행이 되고, 그 행의 역할이
 * 업체 신청으로 올라가고, 관리자 승인이 그 계정의 권한을 실제로 열어 주는지 — 를 아무도 재지
 * 않았다. 사장님이 프리뷰에서 눈으로 확인하실 항목이 정확히 이 여정이다. 눈으로 보기 전에
 * 여기서 먼저 재 둔다.
 *
 * ## 이 여정이 잡는 것
 *
 * 특히 **역할이 되돌아가지 않는지**를 본다. `identityOf` 는 요청마다 v17 `users` 행을 맞추는데,
 * 우리 세션은 여전히 'partner' 가 아니라 가입 당시의 역할을 들고 있다. 그 자리에서 행을
 * 덮어썼다면 업체 신청으로 올라간 PARTNER 가 다음 요청에 CUSTOMER 로 되돌아간다.
 * 승인 전후로 `me` 를 두 번 읽는 이유가 그것이다.
 *
 * `handleAuth` 는 자기 풀을 열어 `public` 을 본다. 그래서 계정·세션은 `public`, 마켓플레이스
 * 표는 전용 스키마에 두고, 마켓플레이스 풀만 `search_path=<스키마>,public` 으로 준다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { handleMarketplace, type ApiRequest } from '../server/marketplaceApi'
import { handleAuth, DEFAULT_WORKSPACE } from '../server/handlers/auth'
import { issueSession } from '../server/session'

const DB_URL = process.env['DATABASE_URL']
const SCHEMA = 'signup_journey_test'
/** 실행마다 다른 번호 — 계정 표는 `public` 이라 지난 실행의 행이 남아 있다 */
const PHONE = '010' + String(Date.now()).slice(-8)
const HOST = 'app.test'

pg.types.setTypeParser(20, Number)

let pool: pg.Pool

const authEnv = (): NodeJS.ProcessEnv =>
  ({ DATABASE_URL: DB_URL, ADMIN_PASSWORD: 'ci-admin-pass-1' }) as NodeJS.ProcessEnv

const auth = (op: string, args: unknown[]) =>
  handleAuth(
    { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.77' }, query: {}, body: { op, args } },
    authEnv(),
  )

const resultOf = (r: { body: unknown }): Record<string, unknown> =>
  (r.body as { result?: Record<string, unknown> }).result ?? {}

function request(method: string, path: string[], opts: Partial<ApiRequest> & { token?: string } = {}): ApiRequest {
  const { token, ...rest } = opts
  return {
    method,
    path,
    headers: {
      host: HOST,
      ...(method === 'POST' ? { origin: `https://${HOST}` } : {}),
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
    query: rest.query ?? {},
    body: rest.body ?? null,
  }
}

const roleOfMe = async (token: string): Promise<string> => {
  const r = await handleMarketplace(request('GET', ['me'], { token }), pool)
  expect(r.status).toBe(200)
  return (r.body as { user: { role: string } }).user.role
}

describe.skipIf(!DB_URL)('29-16-2: 가입부터 승인까지 한 줄로', () => {
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(readFileSync('db/schema.sql', 'utf8')) // 계정·세션 — public, 멱등하다
    await admin.query(`drop schema if exists ${SCHEMA} cascade`)
    await admin.query(`create schema ${SCHEMA}`)
    await admin.query(`set search_path = ${SCHEMA}`)
    await admin.query(readFileSync('db/marketplace.pg.sql', 'utf8'))
    await admin.end()
    pool = new pg.Pool({ connectionString: DB_URL, options: `-c search_path=${SCHEMA},public` })
  })

  afterAll(async () => {
    await pool?.end()
    const admin = new pg.Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(`drop schema if exists ${SCHEMA} cascade`)
    await admin.end()
  })

  it('가입 → 재로그인 → 업체 제출 → 승인 → 권한이 실제로 열린다', async () => {
    // 1. 가입. 인증번호를 받고 확인까지 마쳐야 로그인이 열린다.
    const reg = await auth('register', [
      {
        role: 'partner',
        partnerType: 'individual',
        name: '최사장',
        phone: PHONE,
        password: 'password1',
        agreeTerms: true,
        agreePrivacy: true,
      },
    ])
    expect(reg.status).toBe(200)
    const otp = String(resultOf(reg)['otp'])
    expect(otp).not.toBe('undefined')
    expect((await auth('verifyOtp', ['partner', PHONE, otp])).status).toBe(200)

    // 2. 재로그인 — 가입 응답의 토큰이 아니라 **다시 로그인해서** 받은 토큰으로 계속한다.
    const login = await auth('login', ['partner', PHONE, 'password1'])
    expect(login.status).toBe(200)
    const token = (login.body as { token?: string }).token as string
    expect(typeof token).toBe('string')

    // 3. 그 토큰이 v17 users 행이 된다. 아직 업체를 내지 않았으니 CUSTOMER 다.
    expect(await roleOfMe(token)).toBe('CUSTOMER')

    // 4. 아직은 평범한 고객이다. 같은 주소가 403 이 아니라 200 인 것이 맞다 — 자기 주문 목록을
    //    돌려준다. 승인 게이트는 역할이 PARTNER 가 된 뒤에야 선다(6번).
    const beforeJobs = await handleMarketplace(request('GET', ['orders'], { token, query: { scope: 'jobs' } }), pool)
    expect(beforeJobs.status).toBe(200)
    expect(beforeJobs.body).toEqual([])

    // 5. 업체 제출.
    const submit = await handleMarketplace(
      request('POST', ['partners'], {
        token,
        body: {
          company: '최사장설비',
          representative: '최사장',
          phone: PHONE,
          workItems: ['ELECTRIC'],
          regions: '서울 마포구',
          partnerType: 'individual',
        },
      }),
      pool,
    )
    expect(submit.status).toBe(200)

    // 6. 신청만으로 역할은 올라가지만 권한은 아직이다 — 승인이 남았다.
    expect(await roleOfMe(token)).toBe('PARTNER')
    expect(
      (await handleMarketplace(request('GET', ['orders'], { token, query: { scope: 'jobs' } }), pool)).status,
    ).toBe(403)

    // 7. 손님에게도 아직 보이지 않는다. 미승인 업체가 목록에 서면 안 된다.
    const hidden = await handleMarketplace(request('GET', ['companies']), pool)
    expect(hidden.status).toBe(200)
    const hiddenNames = (hidden.body as { companies: { company: string }[] }).companies.map((c) => c.company)
    expect(hiddenNames).not.toContain('최사장설비')

    // 8. 관리자 승인.
    const accountId = (login.body as { session: { accountId: string } }).session.accountId
    const now = Date.now()
    const adminToken = await issueSession(pool, DEFAULT_WORKSPACE, {
      role: 'admin',
      name: '운영자',
      accountId: 'journey-admin',
      grade: 'owner',
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 3_600_000).toISOString(),
    })
    const approve = await handleMarketplace(
      request('POST', ['partners', accountId, 'approve'], {
        token: adminToken,
        body: { reason: '서류와 연락처를 확인했습니다.', verified: true },
      }),
      pool,
    )
    expect(approve.status).toBe(200)

    // 9. 권한이 열린다 — 같은 요청이 이제 통과한다.
    expect(
      (await handleMarketplace(request('GET', ['orders'], { token, query: { scope: 'jobs' } }), pool)).status,
    ).toBe(200)

    // 10. 손님 목록에도 선다. 로그인 없이 본다.
    const shown = await handleMarketplace(request('GET', ['companies']), pool)
    const shownNames = (shown.body as { companies: { company: string }[] }).companies.map((c) => c.company)
    expect(shownNames).toContain('최사장설비')

    // 11. 다시 로그인해도 역할이 되돌아가지 않는다. 새 세션은 여전히 가입 당시의 'partner' 를
    //     들고 오지만, v17 행의 PARTNER 를 덮어써서는 안 된다.
    const again = await auth('login', ['partner', PHONE, 'password1'])
    expect(again.status).toBe(200)
    expect(await roleOfMe((again.body as { token: string }).token)).toBe('PARTNER')
  })
})
