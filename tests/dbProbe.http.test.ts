/**
 * 데이터 분리 표식이 **실제 DB 에서** 도는가 (29-17).
 *
 * 주소 비교(`dbFingerprint`)는 접속 대상이 다른지까지만 말한다. 데이터가 갈라졌는지는 표식으로
 * 확인한다 — 프리뷰에 남기고 운영 화면에서 안 보이는 것을 사람이 본다. 여기서 재는 것은 그
 * 표식이 정말 남고 정말 읽히는지, 그리고 **운영에서는 남지 않는지**다.
 *
 * `handleAuth` 는 자기 풀을 열어 `public` 을 보므로 다른 통합 테스트와 같이 `public` 을 쓴다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { handleAuth, DEFAULT_WORKSPACE } from '../server/handlers/auth'
import { issueSession } from '../server/session'
import { recentProbes } from '../server/dbProbe'

const DB_URL = process.env['DATABASE_URL']
let pool: pg.Pool

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({
    DATABASE_URL: DB_URL,
    ADMIN_PASSWORD: 'ci-admin-pass-1',
    ...extra,
  }) as NodeJS.ProcessEnv

const post = (op: string, token: string, extra?: Record<string, string>) =>
  handleAuth(
    {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9', authorization: `Bearer ${token}` },
      query: {},
      body: { op, args: [] },
    },
    env(extra),
  )

async function adminToken(grade: 'owner' | 'viewer'): Promise<string> {
  const now = Date.now()
  return issueSession(pool, DEFAULT_WORKSPACE, {
    role: 'admin',
    name: '운영자',
    accountId: `probe-admin-${grade}`,
    grade,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
  })
}

describe.skipIf(!DB_URL)('29-17: 데이터 분리 표식', () => {
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(readFileSync('db/schema.sql', 'utf8')) // 멱등하다
    await admin.end()
    pool = new pg.Pool({ connectionString: DB_URL })
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('표식을 남기면 그 DB 에서 실제로 읽힌다', async () => {
    const token = await adminToken('owner')
    const before = await recentProbes(pool)

    const r = await post('dbProbe', token, { VERCEL_ENV: 'preview' })
    expect(r.status).toBe(200)
    const probe = (r.body as { result: { id: string; deployEnv: string } }).result
    expect(probe.deployEnv).toBe('preview')

    const after = await recentProbes(pool)
    expect(after.map((p) => p.id)).toContain(probe.id)
    expect(after.length).toBeGreaterThan(before.length === 10 ? 9 : before.length)
  })

  it('dbInfo 가 그 표식을 함께 준다 — 화면이 대조할 목록이다', async () => {
    const token = await adminToken('owner')
    const written = (await post('dbProbe', token, { VERCEL_ENV: 'preview' })).body as { result: { id: string } }

    const info = await handleAuth(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9', authorization: `Bearer ${token}` },
        query: {},
        body: { op: 'dbInfo', args: [] },
      },
      env({ VERCEL_ENV: 'preview' }),
    )
    expect(info.status).toBe(200)
    const result = (info.body as { result: { probes: { id: string }[]; differentFromFallback: boolean | null } }).result
    expect(result.probes.map((p) => p.id)).toContain(written.result.id)
  })

  it('운영에서는 표식을 남기지 않는다 — 이 줄이 이 검사의 이유다', async () => {
    const token = await adminToken('owner')
    const before = await recentProbes(pool)

    const r = await post('dbProbe', token, { VERCEL_ENV: 'production' })
    expect(r.status).toBe(400)
    expect(JSON.stringify(r.body)).toContain('운영에는 표식을 남기지 않습니다')

    const after = await recentProbes(pool)
    expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id))
  })

  it('열람 등급은 표식을 남길 수 없다 — 쓰기다', async () => {
    const r = await post('dbProbe', await adminToken('viewer'), { VERCEL_ENV: 'preview' })
    expect(r.status).toBe(403)
  })
})
