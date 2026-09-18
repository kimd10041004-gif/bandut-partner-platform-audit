import { afterEach, describe, expect, it } from 'vitest'
import { closePool, getPool, poolOptions, QUERY_TIMEOUT_MS } from './db'

/**
 * 풀이 **주소별로** 따로여야 한다 (29-16-3).
 *
 * ## 왜 이 검사가 생겼나
 *
 * 프리뷰 DB 분리는 `resolveDatabaseUrl` 이 프리뷰에서 `DATABASE_URL_PREVIEW` 를 고르는 것으로
 * 끝나지 않는다. 고른 주소가 **실제로 연결에 쓰여야** 한다.
 *
 * 그런데 `getPool` 은 첫 호출에서 만든 풀 하나를 들고 있다가 이후 호출에는 **주소를 보지 않고**
 * 그것을 돌려줬다. 한 프로세스 안에서 `process.env` 가 바뀌지 않으니 지금 운영에서 잘못된 DB에
 * 붙는 일은 없다 — 하지만 그것은 코드가 지키는 보장이 아니라 환경이 안 바뀐다는 가정이다.
 * 분리를 가정 위에 올려 두지 않는다.
 *
 * 여기서는 `pg` 를 흉내 내지 않는다. `new Pool` 은 만들 때 접속하지 않으므로 가짜 주소로도
 * 진짜 풀을 만들 수 있고, 검사 끝에 전부 닫는다.
 */
const A = 'postgres://u:p@host-a.example/db1'
const B = 'postgres://u:p@host-b.example/db2'

describe('getPool', () => {
  afterEach(async () => {
    await closePool()
  })

  it('같은 주소는 같은 풀을 돌려준다 — 호출마다 새로 열지 않는다', () => {
    expect(getPool(A)).toBe(getPool(A))
  })

  it('다른 주소는 다른 풀이다 — 첫 주소가 이후를 덮어쓰지 않는다', () => {
    expect(getPool(A)).not.toBe(getPool(B))
  })

  it('두 번째 주소의 풀이 그 주소로 만들어진다 — 첫 주소로 붙지 않는다', () => {
    getPool(A)
    const second = getPool(B) as unknown as { options: { connectionString?: string } }
    expect(second.options.connectionString).toBe(B)
  })

  it('정리하면 다음 호출이 새 풀을 만든다', async () => {
    const first = getPool(A)
    await closePool()
    expect(getPool(A)).not.toBe(first)
  })

  it('옵션은 상한과 시간 제한을 함께 건다', () => {
    expect(poolOptions(A)).toEqual({
      connectionString: A,
      max: 3,
      query_timeout: QUERY_TIMEOUT_MS,
      statement_timeout: QUERY_TIMEOUT_MS,
    })
  })
})
