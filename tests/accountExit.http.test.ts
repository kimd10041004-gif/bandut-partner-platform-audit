/**
 * 진행 중인 거래를 두고 탈퇴할 수 없다 (29-24).
 *
 * ## 왜 이 여정을 따로 재는가
 *
 * `withdraw` 는 28-39 부터 있었고 도메인 테스트도 있었다. 그 테스트가 보는 것은 "비밀번호가 맞으면
 * 식별 정보가 지워진다"까지다 — 계정 도메인은 주문을 모르니 그 이상을 볼 수 없다.
 *
 * 그런데 실제로 나쁜 일은 **두 저장소 사이**에서 일어난다. 계약금을 낸 고객이 탈퇴하면 계정 쪽에서는
 * 이름과 번호가 지워지고, 거래 쪽에서는 주문이 그대로 남는다. 파트너는 방문 일정이 잡힌 일감을 쥔 채
 * 연락할 사람을 잃는다. **어느 한쪽의 테스트로도 보이지 않는 자리**라서 HTTP 여정으로 잰다.
 *
 * ## 계정과 거래를 **같은 스키마**에 두는 이유
 *
 * `handleAuth` 는 자기 풀을 열고, 우리는 그 풀에 스키마를 지정할 자리가 없다. 그래서 연결 문자열의
 * `options` 로 `search_path` 를 준다 — 운영과 같은 배치(계정과 거래가 한 스키마)를 전용 스키마 안에
 * 재현하는 것이다. 거래 표를 다른 곳에 숨기면 게이트가 볼 것이 없어 시험 자체가 무의미해지고,
 * `public` 에 세우면 다른 테스트의 스키마가 빠졌을 때 조용히 이쪽으로 흘러내린다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { handleAuth } from '../server/handlers/auth'

const DB_URL = process.env['DATABASE_URL']
const SCHEMA = 'account_exit_test'
/** `handleAuth` 가 여는 풀도 이 스키마를 보게 한다 — 연결 문자열이 유일한 통로다 */
const SCOPED_URL =
  DB_URL === undefined ? undefined : `${DB_URL}${DB_URL.includes('?') ? '&' : '?'}options=-c%20search_path%3D${SCHEMA}`
/** 실행마다 다른 번호 — 계정 표는 지난 실행의 행을 그대로 들고 있다 */
const PHONE = '010' + String(Date.now()).slice(-8)
const PASSWORD = 'password1'

pg.types.setTypeParser(20, Number)

let pool: pg.Pool
/** 이 실행이 만든 주문. 스키마째 지우므로 이름은 알아보기 위한 것이다 */
const ORDER_ID = 'exit-test-' + PHONE

const authEnv = (): NodeJS.ProcessEnv =>
  ({ DATABASE_URL: SCOPED_URL, ADMIN_PASSWORD: 'ci-admin-pass-1' }) as NodeJS.ProcessEnv

const auth = (op: string, args: unknown[], token?: string) =>
  handleAuth(
    {
      method: 'POST',
      headers: {
        'x-forwarded-for': '203.0.113.91',
        ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      },
      query: {},
      body: { op, args },
    },
    authEnv(),
  )

const resultOf = (r: { body: unknown }): Record<string, unknown> =>
  (r.body as { result?: Record<string, unknown> }).result ?? {}
const errorOf = (r: { body: unknown }): string => String((r.body as { error?: unknown }).error ?? '')

describe.skipIf(!DB_URL)('29-24: 진행 중인 거래를 두고 탈퇴할 수 없다', () => {
  let token = ''
  let accountId = ''

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(`drop schema if exists ${SCHEMA} cascade`)
    await admin.query(`create schema ${SCHEMA}`)
    // 전용 스키마 안이라 남과 부딪히지 않는다 — 잠금이 필요한 것은 `public` 쪽뿐이다
    await admin.query(`set search_path = ${SCHEMA}`)
    await admin.query(readFileSync('db/schema.sql', 'utf8'))
    await admin.query(readFileSync('db/marketplace.pg.sql', 'utf8'))
    await admin.end()
    pool = new pg.Pool({ connectionString: SCOPED_URL })

    const reg = await auth('register', [
      {
        role: 'customer',
        name: '나가려는 고객',
        phone: PHONE,
        password: PASSWORD,
        agreeTerms: true,
        agreePrivacy: true,
        marketing: false,
      },
    ])
    expect(reg.status, JSON.stringify(reg.body)).toBe(200)
    await auth('verifyOtp', ['customer', PHONE, String(resultOf(reg)['otp'])])
    const login = await auth('login', ['customer', PHONE, PASSWORD])
    expect(login.status, JSON.stringify(login.body)).toBe(200)
    token = String((login.body as { token?: unknown }).token)
    accountId = String(resultOf(login)['accountId'])

    // 거래 표 쪽의 이 사람. 평소에는 `identityOf` 가 첫 요청에서 만들어 준다
    await pool.query(
      `insert into users (id,email,name,role,created_at) values ($1,$2,'나가려는 고객','CUSTOMER',$3)
       on conflict (id) do nothing`,
      [accountId, `${accountId}@accounts.local`, new Date().toISOString()],
    )
  })

  afterAll(async () => {
    await pool?.end()
    const admin = new pg.Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(`drop schema if exists ${SCHEMA} cascade`)
    await admin.end()
  })

  /** 이 고객 이름으로 주문 한 줄. 도메인을 거치지 않는다 — 재는 것은 게이트이지 접수가 아니다 */
  const placeOrder = (status: string) =>
    pool.query(
      `insert into orders (id,customer_id,title,work_items,description,region,address,phone,desired_date,budget,
         deadline,answers,review_status,review_completed_at,routing_status,routing_decision,status,selected_bid_id,
         created_at,updated_at,revision)
       values ($1,$2,'탈퇴 시험 주문','["CURTAIN"]','커튼 설치','서울','시험로 1','01000000000',null,null,
         $3,'{}','AUTO_OK',null,'PENDING',null,$4,null,$3,$3,0)
       on conflict (id) do update set status = excluded.status`,
      [ORDER_ID, accountId, new Date().toISOString(), status],
    )

  it('주문이 하나도 없으면 탈퇴할 수 있다고 답한다', async () => {
    const r = await auth('withdrawCheck', [], token)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(resultOf(r)['blocks']).toEqual([])
  })

  it('진행 중인 주문이 있으면 이유와 함께 막는다', async () => {
    await placeOrder('BIDDING')

    const check = await auth('withdrawCheck', [], token)
    const blocks = resultOf(check)['blocks'] as { kind: string; count: number; message: string }[]
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe('ORDER')
    expect(blocks[0]?.count).toBe(1)

    // 눌러도 막힌다 — 화면의 판단은 근거가 아니다
    const done = await auth('withdraw', [PASSWORD], token)
    expect(done.status, JSON.stringify(done.body)).toBe(400)
    expect(errorOf(done)).toContain('진행 중인 작업 요청')

    // 그리고 계정이 살아 있다 — 거절이 절반만 되지 않았는지 본다
    const me = await auth('me', [], token)
    expect(me.status, JSON.stringify(me.body)).toBe(200)
  })

  it('비밀번호가 틀려도 거절 이유는 거래다 — 맞았는지를 알려 주지 않는다', async () => {
    const r = await auth('withdraw', ['completely-wrong'], token)
    expect(r.status).toBe(400)
    expect(errorOf(r)).toContain('진행 중인 작업 요청')
    expect(errorOf(r)).not.toContain('비밀번호')
  })

  it('주문이 끝나면 탈퇴가 열리고, 실제로 탈퇴된다', async () => {
    await placeOrder('CANCELLED')

    const check = await auth('withdrawCheck', [], token)
    expect(resultOf(check)['blocks']).toEqual([])

    const done = await auth('withdraw', [PASSWORD], token)
    expect(done.status, JSON.stringify(done.body)).toBe(200)

    // 세션이 함께 끊긴다 — 탈퇴한 토큰으로 계속 돌아다닐 수 없다
    const me = await auth('me', [], token)
    expect(me.status).toBe(401)
  })
})
