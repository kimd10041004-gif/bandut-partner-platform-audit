/**
 * v17 도메인이 쓰는 `Database` 포트의 **Postgres 구현** (29-1).
 *
 * ## 왜 포트인가
 *
 * v17의 서비스(`lib/service.ts`·`lib/trade.ts` …)는 D1(SQLite)이 아니라 `lib/model.ts`의 작은 포트
 * (`prepare(sql).bind(...).first/all/run` + `batch`)에만 기댄다. 그래서 저장소를 바꾸는 일은 **이 파일 하나**를
 * 쓰는 일이고, 도메인 코드는 한 줄도 고치지 않는다. 테스트는 같은 포트를 Node 내장 SQLite로 구현해 돈다.
 *
 * ## 두 방언에서 같은 문장이 돌아야 한다
 *
 * 앱이 만드는 SQL은 한 벌뿐이므로 두 방언이 모두 이해하는 것만 쓴다(`ON CONFLICT … DO UPDATE`, `COALESCE`,
 * `LIKE`, `substr`). 방언이 갈리는 자리는 앱 SQL이 아니라 **스키마**에서 흡수한다(`scripts/pg-schema.mjs`).
 * 여기서 흡수하는 것은 둘이다: 자리표시자(SQLite는 `?`, Postgres는 `$1…$n`)와, 집계값의 타입(아래
 * `numericTypes`, 29-26).
 *
 * ## batch
 *
 * D1의 `batch`는 원자적이다. 여기서는 **한 연결에서 트랜잭션**으로 돌린다 — 하나가 실패하면 전부 되돌린다.
 * 낙찰 시 슬롯 확보처럼 "겹치면 전체 취소"가 규칙인 자리가 이것에 기대고 있다.
 */
import pg, { type Pool, type PoolClient } from 'pg'
import type { Database, Statement } from '../lib/model'

/**
 * 집계값을 **숫자로** 받는다 (29-26).
 *
 * `pg` 는 `COUNT`·`SUM` 이 돌려주는 `bigint`(int8)와 `AVG` 의 `numeric` 을 기본으로 **문자열**로 준다 —
 * 자바스크립트 숫자로는 정밀도를 잃을 수 있어서다. 그러나 이 도메인은 SQLite 에서 자랐고, SQLite 는 그것들을
 * 숫자로 준다. 그 차이가 운영에서만 드러났다: `c.total + ex.total` 이 `"1980000"`(이어붙이기)이 되어 정산
 * 승인이 `gross !== expected` 에서 **항상** 거절됐고, `rating.toFixed(1)` 은 던졌고, `unread > 0` 은 우연히만
 * 맞았다. 통합 스위트를 Postgres 로 돌려 찾았다(`npm run test:pg:suite`, 고치기 전 15 실패).
 *
 * 포트가 흡수한다 — 도메인이 보는 값은 두 방언에서 같아야 한다. 이 플랫폼의 정수는 원 단위 금액과
 * 일련번호라 2^53 안에 있다. 그 밖의 타입은 `pg` 기본 그대로다. 풀 설정이 아니라 **문장마다** 붙이므로
 * 어떤 풀을 받아도 같다(운영·CI·테스트가 풀을 제각기 만든다).
 */
const INT8 = 20
const NUMERIC = 1700
export const numericTypes: pg.CustomTypesConfig = {
  getTypeParser(oid, format) {
    if (format !== 'binary' && (oid === INT8 || oid === NUMERIC)) return Number
    return pg.types.getTypeParser(oid, format)
  },
}

/**
 * `?` → `$1…$n`. 작은따옴표 문자열 안의 `?`는 건드리지 않는다(문구에 물음표가 들어갈 수 있다).
 * `''`로 escape된 따옴표도 문자열 안으로 센다.
 */
export function toPositional(sql: string): string {
  let out = ''
  let n = 0
  let inText = false
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i]!
    if (c === "'") {
      inText = !inText
      out += c
      continue
    }
    if (c === '?' && !inText) {
      n += 1
      out += `$${n}`
      continue
    }
    out += c
  }
  return out
}

/** 한 문장 — 본문·값·그리고 집계값을 숫자로 읽는 파서(`numericTypes`) */
type Query = { text: string; values: unknown[]; types: pg.CustomTypesConfig }
/** 실행기 — 풀에서 바로 쓰거나(단건), batch에서는 한 연결을 잡아 쓴다 */
type Runner = { query(q: Query): Promise<{ rows: unknown[]; rowCount: number | null }> }

class PgStatement implements Statement {
  args: unknown[] = []
  constructor(
    readonly text: string,
    private readonly runner: () => Runner,
  ) {}
  bind(...values: unknown[]): Statement {
    this.args = values
    return this
  }
  private get query(): Query {
    return { text: this.text, values: this.args, types: numericTypes }
  }
  async first<T>(): Promise<T | null> {
    const r = await this.runner().query(this.query)
    return (r.rows[0] as T | undefined) ?? null
  }
  async all<T>(): Promise<{ results: T[] }> {
    const r = await this.runner().query(this.query)
    return { results: r.rows as T[] }
  }
  async run(): Promise<{ meta: { changes: number } }> {
    const r = await this.runner().query(this.query)
    return { meta: { changes: r.rowCount ?? 0 } }
  }
  /** batch가 같은 연결에서 다시 돌리기 위해 쓴다 */
  async runOn(client: PoolClient): Promise<{ meta: { changes: number } }> {
    const r = await client.query(this.query)
    return { meta: { changes: r.rowCount ?? 0 } }
  }
}

export function pgDatabase(pool: Pool): Database {
  const runner = (): Runner => pool
  return {
    prepare(sql: string): Statement {
      return new PgStatement(toPositional(sql), runner)
    },
    async batch(statements: Statement[]): Promise<unknown[]> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out: unknown[] = []
        for (const s of statements) {
          if (!(s instanceof PgStatement)) throw new Error('이 포트가 만들지 않은 문장은 batch에 넣을 수 없습니다')
          out.push(await s.runOn(client))
        }
        await client.query('COMMIT')
        return out
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw err
      } finally {
        client.release()
      }
    },
  }
}
