/**
 * 두 사람이 **같은 순간에** 가입해도 한 사람이 떨어지지 않는가 (29-22).
 *
 * ## 봇이 먼저 찾았다
 *
 * 29-22 의 세 역할 동시 감사 봇이 첫 실행에서 여기 걸렸다. 고객과 파트너를 `Promise.all` 로
 * 같이 가입시켰더니 한쪽이 죽었다.
 *
 * ```
 * [e2e:roles] customer 가입이 거절됐습니다: 서버 저장소 오류 — 잠시 후 다시 시도해 주세요
 * [api/auth] duplicate key value violates unique constraint "auth_state_pkey"
 * ```
 *
 * ## 왜 나는가
 *
 * `loadAuth` 는 행을 `select ... for update` 로 잠근다. 그런데 **행이 없으면 잠글 것이 없다.**
 * 빈 저장소에서 두 요청이 동시에 오면 둘 다 "행이 없다"를 보고 둘 다 `insert` 한다. 늦은 쪽이
 * 기본키에서 터지고, 그 사람에게는 "서버 저장소 오류" 가 나간다.
 *
 * 차례로 도는 검사는 이것을 구조적으로 못 본다 — 첫 요청이 끝난 뒤에는 행이 있으니까.
 *
 * ## 무엇을 지키나
 *
 * 터지는 것보다 **조용히 덮는 것이 더 나쁘다.** `auth_state` 는 계정 전부를 담은 한 행이라,
 * 늦은 쪽이 자기 상태로 덮어썼다면 먼저 가입한 사람의 계정이 사라진다. 그래서 이 검사는
 * "둘 다 성공한다" 와 "둘 다 남아 있다" 를 함께 본다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { handleAuth } from '../server/handlers/auth'

const DB_URL = process.env['DATABASE_URL']
let pool: pg.Pool

const env = (): NodeJS.ProcessEnv =>
  ({ DATABASE_URL: DB_URL, ADMIN_PASSWORD: 'ci-admin-pass-1' }) as NodeJS.ProcessEnv

/** 실행마다 다른 번호 — 계정 표는 `public` 이라 지난 실행의 행이 남아 있다 */
const STAMP = Date.now().toString().slice(-7)
const phoneOf = (n: number) => `010${STAMP}${n}`.slice(0, 11)

const register = (role: 'customer' | 'partner', phone: string, name: string) =>
  handleAuth(
    {
      method: 'POST',
      headers: { 'x-forwarded-for': `203.0.113.${role === 'customer' ? 21 : 22}` },
      query: {},
      body: {
        op: 'register',
        args: [
          {
            role,
            name,
            phone,
            password: 'concurrent-pass-1',
            agreeTerms: true,
            agreePrivacy: true,
            marketing: false,
            ...(role === 'partner' ? { partnerType: 'individual' } : {}),
          },
        ],
      },
    },
    env(),
  )

describe.skipIf(!DB_URL)('동시 가입 (29-22)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL })
    // 빈 저장소에서 시작해야 이 경쟁이 재현된다 — 행이 있으면 `for update` 가 제 일을 한다
    await pool.query('delete from sessions')
    await pool.query('delete from auth_state')
  })
  afterAll(async () => {
    await pool.end()
  })

  it('빈 저장소에 두 사람이 동시에 가입해도 둘 다 들어간다', async () => {
    const a = phoneOf(3)
    const b = phoneOf(4)
    // 수정 전: 늦은 쪽이 503 — duplicate key value violates unique constraint "auth_state_pkey"
    const [ra, rb] = await Promise.all([register('customer', a, '동시고객'), register('partner', b, '동시파트너')])

    expect([ra.status, rb.status]).toEqual([200, 200])

    // 그리고 둘 다 **남아 있어야** 한다 — 늦은 쪽이 덮었다면 먼저 온 사람이 사라진다
    const { rows } = await pool.query<{ body: string }>('select body from auth_state')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.body).toContain(a)
    expect(rows[0]?.body).toContain(b)
  })

  it('행이 선 뒤에도 동시 가입이 서로를 덮지 않는다', async () => {
    const c = phoneOf(5)
    const d = phoneOf(6)
    const [rc, rd] = await Promise.all([register('customer', c, '동시고객2'), register('partner', d, '동시파트너2')])
    expect([rc.status, rd.status]).toEqual([200, 200])

    const { rows } = await pool.query<{ body: string }>('select body from auth_state')
    for (const phone of [c, d]) expect(rows[0]?.body).toContain(phone)
  })
})
