import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'
import { pgDatabase } from '../../server/pgPort'
import type { Database, Statement } from '../../lib/model'

/**
 * 통합 스위트가 **두 방언에서 같은 코드로** 돌게 하는 하네스 (29-26).
 *
 * ## 왜
 *
 * `tests/*.integration.test.ts` 는 도메인 규칙을 Node 내장 SQLite 로 증명한다. 운영은 Postgres 다.
 * 29-25 에서 넷이 드러났다 — 넷 다 단위 테스트는 초록이었고 운영에서만 죽어 있었다. 방언이
 * 갈리는 자리를 하나씩 찾아 고치는 것으로는 끝이 없다. **같은 스위트를 Postgres 로도 돌린다.**
 *
 * ## 어떻게
 *
 * 각 파일은 `openTestDatabase('이름')` 을 `beforeAll` 에서 열고, `reset()` 을 `beforeEach` 에서 불러
 * 빈 저장소를 받는다. `TEST_DIALECT=postgres` 와 `DATABASE_URL` 이 있으면 Postgres 에 **파일마다
 * 제 스키마**(`it_<이름>`)를 세우고 테스트 사이에는 표만 비운다. 아니면 지금까지처럼 메모리 SQLite 다.
 *
 * 표를 직접 만지는 준비·검증(`run`·`get`·`all`)도 같은 포트를 지나가므로 두 방언에서 같은 문장이다.
 * SQLite 가 동기라 예외를 바로 던지던 자리는 이제 `await expect(t.run(…)).rejects` 로 본다.
 */
export type Dialect = 'sqlite' | 'postgres'

export interface TestDatabase {
  readonly dialect: Dialect
  /** 빈 저장소 — 파일의 beforeEach 가 부른다. 이전 것은 버린다 */
  reset(): Promise<Database>
  /** 도메인을 거치지 않고 표를 직접 만진다 (준비·검증). 실패하면 던진다 */
  run(sql: string, ...args: unknown[]): Promise<void>
  get<T>(sql: string, ...args: unknown[]): Promise<T | null>
  all<T>(sql: string, ...args: unknown[]): Promise<T[]>
  close(): Promise<void>
}

/** 이 실행이 어느 방언으로 도는가 — `TEST_DIALECT=postgres` 는 `DATABASE_URL` 이 있어야 뜻이 있다 */
export function testDialect(env: NodeJS.ProcessEnv = process.env): Dialect {
  return env['TEST_DIALECT'] === 'postgres' && (env['DATABASE_URL'] ?? '') !== '' ? 'postgres' : 'sqlite'
}

export async function openTestDatabase(name: string): Promise<TestDatabase> {
  return testDialect() === 'postgres' ? openPostgres(name) : openSqlite()
}

/** drizzle 저널 순서대로 SQLite 스키마를 세운다 — 통합 스위트가 늘 하던 그대로 */
function sqliteSchema(sqlite: DatabaseSync): void {
  sqlite.exec('PRAGMA foreign_keys=ON')
  const journal = JSON.parse(readFileSync('db/sqlite/_journal.json', 'utf8')) as { entries: { tag: string }[] }
  for (const entry of journal.entries) sqlite.exec(readFileSync('db/sqlite/' + entry.tag + '.sql', 'utf8'))
}

function sqliteDatabase(sqlite: DatabaseSync): Database {
  return {
    prepare(sql) {
      let args: unknown[] = []
      const s: Statement = {
        bind(...a) {
          args = a
          return s
        },
        async first<T>() {
          return (sqlite.prepare(sql).get(...(args as never[])) ?? null) as T | null
        },
        async all<T>() {
          return { results: sqlite.prepare(sql).all(...(args as never[])) as T[] }
        },
        async run() {
          return { meta: { changes: Number(sqlite.prepare(sql).run(...(args as never[])).changes) } }
        },
      }
      return s
    },
    async batch(stmts) {
      sqlite.exec('BEGIN')
      try {
        const out: unknown[] = []
        for (const s of stmts) out.push(await s.run())
        sqlite.exec('COMMIT')
        return out
      } catch (e) {
        sqlite.exec('ROLLBACK')
        throw e
      }
    },
  }
}

function openSqlite(): TestDatabase {
  let sqlite: DatabaseSync | null = null
  let db: Database | null = null
  const current = () => {
    if (!db) throw new Error('reset() 을 먼저 부르세요')
    return db
  }
  return {
    dialect: 'sqlite',
    async reset() {
      sqlite?.close()
      sqlite = new DatabaseSync(':memory:')
      sqliteSchema(sqlite)
      db = sqliteDatabase(sqlite)
      return db
    },
    async run(sql, ...args) {
      await current().prepare(sql).bind(...args).run()
    },
    get(sql, ...args) {
      return current().prepare(sql).bind(...args).first()
    },
    async all(sql, ...args) {
      return (await current().prepare(sql).bind(...args).all()).results
    },
    async close() {
      sqlite?.close()
      sqlite = null
      db = null
    },
  }
}

/**
 * Postgres — 파일마다 제 스키마. `public`(계정·세션·스냅샷)은 건드리지 않는다: 같은 DB 를 다른
 * 파일들이 함께 쓴다 (29-1 첫 CI 가 `public` 을 지워 남의 표까지 없앤 적이 있다).
 */
async function openPostgres(name: string): Promise<TestDatabase> {
  const url = process.env['DATABASE_URL']!
  const schema = 'it_' + name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()
  const admin = async (fn: (c: pg.Client) => Promise<void>) => {
    const c = new pg.Client({ connectionString: url })
    await c.connect()
    try {
      await fn(c)
    } finally {
      await c.end()
    }
  }
  await admin(async (c) => {
    await c.query(`drop schema if exists ${schema} cascade`)
    await c.query(`create schema ${schema}`)
    await c.query(`set search_path to ${schema}`)
    await c.query(readFileSync('db/marketplace.pg.sql', 'utf8'))
  })
  const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` })
  const db = pgDatabase(pool)
  const tables = (
    await pool.query<{ tablename: string }>('select tablename from pg_tables where schemaname=$1', [schema])
  ).rows.map((r) => r.tablename)
  return {
    dialect: 'postgres',
    async reset() {
      await pool.query(`truncate ${tables.join(',')} restart identity cascade`)
      return db
    },
    async run(sql, ...args) {
      await db.prepare(sql).bind(...args).run()
    },
    get(sql, ...args) {
      return db.prepare(sql).bind(...args).first()
    },
    async all(sql, ...args) {
      return (await db.prepare(sql).bind(...args).all()).results
    },
    async close() {
      await pool.end()
      await admin((c) => c.query(`drop schema if exists ${schema} cascade`).then(() => undefined))
    },
  }
}
