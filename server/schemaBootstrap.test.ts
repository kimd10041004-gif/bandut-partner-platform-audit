import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { ensureSchema, resetSchemaMemo } from './schemaBootstrap'
import { BASE_SQL, MARKETPLACE_SQL } from '../db/schema.generated'

describe('생성된 스키마 모듈은 파일과 같다 (29-5)', () => {
  it('db/schema.sql 과 어긋나지 않는다', () => {
    expect(BASE_SQL).toBe(readFileSync('db/schema.sql', 'utf8'))
  })

  it('db/marketplace.pg.sql 과 어긋나지 않는다', () => {
    expect(MARKETPLACE_SQL).toBe(readFileSync('db/marketplace.pg.sql', 'utf8'))
  })

  it('표는 다시 만들어도 되는 형태다 — 두 번째 적용이 곧 오류이던 것을 고쳤다', () => {
    const bare = MARKETPLACE_SQL.split('\n').filter(
      (l) => /^CREATE (UNIQUE )?(TABLE|INDEX)/i.test(l) && !/IF NOT EXISTS/i.test(l),
    )
    expect(bare).toEqual([])
  })

  it('외래키도 다시 걸어도 되게 감쌌다', () => {
    const adds = (MARKETPLACE_SQL.match(/ADD CONSTRAINT/g) ?? []).length
    const guards = (MARKETPLACE_SQL.match(/duplicate_object/g) ?? []).length
    expect(adds).toBeGreaterThan(0)
    expect(guards).toBe(adds)
  })
})

const url = process.env['DATABASE_URL']
const dbIt = url === undefined || url === '' ? it.skip : it

describe('빈 DB에 서버가 스스로 스키마를 넣는다 (29-5)', () => {
  let pool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: url ?? '', max: 2 })
  })

  afterAll(async () => {
    await pool.end()
  })

  dbIt(
    '아무것도 없는 스키마에서 시작해 표가 생긴다',
    async () => {
      await pool.query('drop schema if exists boot_test cascade')
      await pool.query('create schema boot_test')
      const scoped = new Pool({ connectionString: url ?? '', max: 2, options: '-c search_path=boot_test' })
      try {
        const before = await scoped.query<{ n: string }>(
          "select count(*)::text as n from information_schema.tables where table_schema='boot_test'",
        )
        expect(before.rows[0]?.n).toBe('0')

        resetSchemaMemo()
        await ensureSchema(scoped)

        const after = await scoped.query<{ n: string }>(
          "select count(*)::text as n from information_schema.tables where table_schema='boot_test' and table_type='BASE TABLE'",
        )
        expect(Number(after.rows[0]?.n)).toBeGreaterThan(30)

        // 두 번째 호출이 터지지 않는다 — 이미 찬 DB로 배포되는 평소 상황이다
        resetSchemaMemo()
        await expect(ensureSchema(scoped)).resolves.toBeUndefined()
      } finally {
        await scoped.end()
        await pool.query('drop schema if exists boot_test cascade')
      }
    },
    60_000,
  )

  dbIt(
    '한 프로세스에서 동시에 불러도 한 번만 돈다',
    async () => {
      resetSchemaMemo()
      const results = await Promise.all([ensureSchema(pool), ensureSchema(pool), ensureSchema(pool)])
      expect(results).toEqual([undefined, undefined, undefined])
    },
    60_000,
  )
})
