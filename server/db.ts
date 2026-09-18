/**
 * 연결 풀·트랜잭션 (28-70) — `server/handlers/snapshot.ts`·`server/handlers/auth.ts`가 쓴다.
 *
 * 이 파일이 핸들러 옆이 아니라 한 겹 위에 있는 이유: Vercel은 **저장소 루트의 `api/` 안 파일을
 * 전부 함수 진입점으로 본다**. 옛 핸들러가 거기 있는 동안에는 공용 코드를 그 폴더에 두면 그것까지
 * 함수가 됐다. 29-5에서 핸들러 자체를 `server/handlers/`로 옮겼다 — `framework: "nextjs"`로
 * 바꾸면 그 자동 함수들이 App Router의 `/api/auth`·`/api/payments`와 같은 경로를 다투기 때문이다.
 */
import { Pool, type PoolClient, type PoolConfig } from 'pg'

/**
 * 이 모듈은 함수마다 따로 적재되므로 **인스턴스마다 따로다** — 자세한 것은 아래 `getPool` (28-88-05).
 *
 * 29-16-3: 하나가 아니라 **주소별로** 둔다. 이유는 아래 `getPool`.
 */
const pools = new Map<string, Pool>()

/**
 * 서버리스에서 호출 간에 재사용된다(콜드 스타트마다 새로 만들지 않는다). 프로덕션은 `-pooler` 엔드포인트.
 *
 * **인스턴스마다 따로다** (28-88-05). 라우트마다 별도 함수로 묶이므로 이 모듈도 함수마다
 * 따로 적재된다 — `/api/auth`와 `/api/payments`는 **서로 다른 `pool`을
 * 쓴다.** 28-87이 "셋이 `max: 3`을 나눠 쓴다"고 적었다가 감사 01에서 틀린 것이 드러났다.
 *
 * 그래서 `max: 3`이 보장하는 것은 **한 인스턴스가 동시에 여는 연결 수**이지 서비스 전체가 아니다.
 * 인스턴스가 늘면 DB가 보는 연결 수는 그만큼 곱해진다 — 전체를 묶는 것은 pooler 한도와
 * 함수 동시성 설정의 일이다. 두 라우트가 실제로 한 풀을 나눠 쓰는 곳은 `scripts/api-server.mjs`
 * (개발·CI 서버) 하나다.
 *
 * ## 주소별로 두는 이유 (29-16-3)
 *
 * 전에는 풀 하나를 들고 있다가 이후 호출에는 **주소를 보지 않고** 그것을 돌려줬다. 한 프로세스의
 * `process.env`는 바뀌지 않으니 잘못된 DB에 붙는 일은 없었지만, 그것은 코드가 지키는 보장이 아니라
 * 환경이 안 바뀐다는 가정이었다. 프리뷰 DB 분리(`resolveDatabaseUrl`)가 그 가정 위에 서게 된다.
 * 주소를 열쇠로 두면 고른 주소가 반드시 연결에 쓰인다.
 */
export function getPool(databaseUrl: string): Pool {
  const existing = pools.get(databaseUrl)
  if (existing !== undefined) return existing
  const created = new Pool(poolOptions(databaseUrl))
  pools.set(databaseUrl, created)
  return created
}

/**
 * 쿼리 하나가 기다릴 수 있는 시간의 상한 (28-89, 28-88 감사 02). `pg`의 기본값은 **무한**이라
 * DB가 응답을 멈추면(네트워크 단절·잠금 대기) 커넥션과 그것을 기다리는 요청이 영원히 잡혔다.
 * `query_timeout`은 클라이언트가 끊고, `statement_timeout`은 서버가 끊는다 — 둘 다 둔다.
 */
export const QUERY_TIMEOUT_MS = 8_000

/** `getPool`이 쓰는 옵션 — 따로 둔 것은 테스트가 `pg`를 흉내 내지 않고 내용을 확인하기 위해서다 */
export function poolOptions(databaseUrl: string): PoolConfig {
  return { connectionString: databaseUrl, max: 3, query_timeout: QUERY_TIMEOUT_MS, statement_timeout: QUERY_TIMEOUT_MS }
}

/** 테스트·CI 서버가 종료 시 정리한다 */
export async function closePool(): Promise<void> {
  const all = [...pools.values()]
  pools.clear()
  await Promise.all(all.map((p) => p.end()))
}

/** 트랜잭션 한 번 — 실패하면 rollback, 커넥션은 반드시 돌려준다 */
export async function withTx<T>(db: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect()
  try {
    await c.query('begin')
    const out = await fn(c)
    await c.query('commit')
    return out
  } catch (err) {
    try {
      await c.query('rollback')
    } catch {
      // 롤백 실패는 원래 오류를 가리지 않는다
    }
    throw err
  } finally {
    c.release()
  }
}

/** 쿼리를 받을 수 있는 것 — Pool과 PoolClient 둘 다 */
export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>
}
