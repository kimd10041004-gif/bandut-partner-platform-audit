import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { handleMarketplace, type ApiRequest } from '../server/marketplaceApi'
import { issueSession } from '../server/session'
import { DEFAULT_WORKSPACE } from '../server/handlers/auth'
import type { AuthSession } from '../server/domain/auth'
import { defaultPageConfig, type PageConfig } from '../lib/company-page'

/**
 * 29-31: 업체가 꾸민 것이 **밖으로 나가는가**.
 *
 * 편집기는 29-15 부터 커버·로고·강조색·영역 순서를 저장해 왔지만, 고를 사진 목록이 없었고(29-30 이전엔
 * 사진 자체가 503 이었다) 공개본을 읽는 화면도 없었다. 이 파일은 그 왕복을 HTTP 높이에서 잰다:
 * 내 사진 목록 → 커버·로고로 고름 → 공개 → **로그인 없이** 읽힌다. 그리고 남의 사진은 못 건다.
 */
const DB_URL = process.env['DATABASE_URL']
const SCHEMA = 'company_page_http_test'
const HOST = 'app.test'

pg.types.setTypeParser(20, Number)

/** 1×1 PNG — `cleanImage` 가 바이트를 그대로 남기는 가장 작은 진짜 PNG */
const PNG = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
)

let pool: pg.Pool
let dir = ''
const withStore = (): NodeJS.ProcessEnv => ({ LOCAL_STORAGE_DIR: dir }) as NodeJS.ProcessEnv

function request(method: string, path: string[], opts: Partial<ApiRequest> & { token?: string } = {}): ApiRequest {
  const { token, ...rest } = opts
  return {
    method,
    path,
    headers: {
      host: HOST,
      ...(method === 'POST' ? { origin: `https://${HOST}` } : {}),
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
    query: rest.query ?? {},
    body: rest.body ?? null,
    ...(rest.bytes !== undefined ? { bytes: rest.bytes } : {}),
  }
}

async function tokenFor(accountId: string, role: AuthSession['role'], name: string): Promise<string> {
  const now = Date.now()
  return issueSession(pool, DEFAULT_WORKSPACE, {
    role,
    name,
    accountId,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    ...(role === 'admin' ? { grade: 'owner' as const } : {}),
  })
}

/** 파트너 하나를 만들고 승인까지 — 사진을 올리려면 승인된 파트너여야 한다 */
async function approvedPartner(id: string, company: string, admin: string): Promise<string> {
  const token = await tokenFor(id, 'partner', company)
  const reg = await handleMarketplace(
    request('POST', ['partners'], {
      token,
      body: { company, representative: company, phone: '01098765432', workItems: ['FLOOR'], regions: '서울 강남구', partnerType: 'individual' },
    }),
    pool,
  )
  expect(reg.status, JSON.stringify(reg.body)).toBe(200)
  const ok = await handleMarketplace(
    request('POST', ['partners', id, 'approve'], { token: admin, body: { reason: '사업자와 시공 이력을 확인했습니다.', verified: true } }),
    pool,
  )
  expect(ok.status, JSON.stringify(ok.body)).toBe(200)
  return token
}

/** 작업사례 사진 한 장을 올리고 그 id 를 준다 */
async function uploadAsset(token: string): Promise<string> {
  const up = await handleMarketplace(
    request('POST', ['portfolio-photo'], { token, bytes: PNG, headers: { 'content-type': 'image/png', 'x-publication-consent': 'confirmed' } }),
    pool,
    withStore(),
  )
  expect(up.status, JSON.stringify(up.body)).toBe(201)
  return (up.body as { id: string }).id
}

/** 편집본을 저장하고 공개한다 — 저장의 리비전을 그대로 공개에 쓴다 */
async function saveAndPublish(token: string, config: PageConfig, revision: number) {
  const saved = await handleMarketplace(request('POST', ['page'], { token, body: { config, revision } }), pool)
  if (saved.status !== 200) return { saved, published: null }
  const published = await handleMarketplace(
    request('POST', ['page', 'publish'], { token, body: { revision: (saved.body as { revision: number }).revision } }),
    pool,
  )
  return { saved, published }
}

describe.skipIf(!DB_URL)('29-31: 꾸민 업체 페이지가 밖으로 나간다', () => {
  let partner = ''
  let other = ''
  let admin = ''
  let assetId = ''
  let otherAssetId = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bandut-page-'))
    const client = new pg.Client({ connectionString: DB_URL })
    await client.connect()
    await client.query(`drop schema if exists ${SCHEMA} cascade`)
    await client.query(`create schema ${SCHEMA}`)
    await client.query(`set search_path = ${SCHEMA}`)
    await client.query(readFileSync('db/marketplace.pg.sql', 'utf8'))
    await client.end()
    pool = new pg.Pool({ connectionString: DB_URL, options: `-c search_path=${SCHEMA},public` })

    admin = await tokenFor('admin-page', 'admin', '운영자')
    partner = await approvedPartner('p-page', '반듯꾸밈', admin)
    other = await approvedPartner('p-other-page', '남의업체', admin)
    assetId = await uploadAsset(partner)
    otherAssetId = await uploadAsset(other)
  })

  afterAll(async () => {
    await pool?.end()
    await rm(dir, { recursive: true, force: true })
    const client = new pg.Client({ connectionString: DB_URL })
    await client.connect()
    await client.query(`drop schema if exists ${SCHEMA} cascade`)
    await client.end()
  })

  it('내가 올린 사진 목록이 온다 — 이것이 없으면 커버·로고를 고를 수가 없다', async () => {
    const mine = await handleMarketplace(request('GET', ['portfolio'], { token: partner }), pool, withStore())
    expect(mine.status, JSON.stringify(mine.body)).toBe(200)
    const assets = (mine.body as { assets?: { id: string }[] }).assets
    expect(assets, '내 사진 목록이 오지 않는다').toBeDefined()
    expect(assets!.map((a) => a.id)).toContain(assetId)
    // 남의 사진은 섞이지 않는다
    expect(assets!.map((a) => a.id)).not.toContain(otherAssetId)
  })

  it('커버·로고를 고른 공개본을 로그인 없이 읽는다 — 손님 화면이 그리는 길', async () => {
    const config: PageConfig = {
      ...defaultPageConfig(),
      themeKey: 'ocean',
      coverAssetId: assetId,
      logoAssetId: assetId,
      introText: '커튼과 블라인드만 12년 했습니다.',
      sections: [
        { kind: 'qna', layout: 'card' },
        { kind: 'portfolio', layout: 'compare' },
        { kind: 'intro', layout: 'card' },
      ],
    }
    const r = await saveAndPublish(partner, config, 0)
    expect(r.saved.status, JSON.stringify(r.saved.body)).toBe(200)
    expect(r.published?.status, JSON.stringify(r.published?.body)).toBe(200)

    const seen = await handleMarketplace(request('GET', ['company', 'p-page', 'page']), pool)
    expect(seen.status, JSON.stringify(seen.body)).toBe(200)
    const body = seen.body as { published: boolean; config: PageConfig }
    expect(body.published).toBe(true)
    expect(body.config.coverAssetId).toBe(assetId)
    expect(body.config.logoAssetId).toBe(assetId)
    expect(body.config.themeKey).toBe('ocean')
    // 영역 순서와 배치가 그대로 — 손님 화면은 이 순서로 그린다
    expect(body.config.sections.map((s) => s.kind)).toEqual(['qna', 'portfolio', 'intro'])
    expect(body.config.sections[1]?.layout).toBe('compare')
  })

  it('공개본에 걸린 커버 사진이 손님에게 실제로 내려온다 (29-32 확인)', async () => {
    const draft = await handleMarketplace(request('GET', ['page'], { token: partner }), pool)
    const rev = (draft.body as { revision: number }).revision
    const config: PageConfig = { ...defaultPageConfig(), coverAssetId: assetId, logoAssetId: assetId }
    const r = await saveAndPublish(partner, config, rev)
    expect(r.published?.status, JSON.stringify(r.published?.body)).toBe(200)

    // 공개본 JSON 은 로그인 없이 온다 (이건 이미 통과하던 것)
    const page = await handleMarketplace(request('GET', ['company', 'p-page', 'page']), pool)
    expect((page.body as { config: PageConfig }).config.coverAssetId).toBe(assetId)

    // 그런데 그 사진 자체는? 손님 화면의 <img> 가 실제로 부르는 주소다.
    const anon = await handleMarketplace(request('GET', ['portfolio-photo', assetId]), pool, withStore())
    expect(anon.status, `비로그인 손님이 커버를 못 본다: ${JSON.stringify(anon.body)}`).toBe(200)

    const customer = await tokenFor('c-page', 'customer', '손님')
    const asCustomer = await handleMarketplace(request('GET', ['portfolio-photo', assetId], { token: customer }), pool, withStore())
    expect(asCustomer.status, `로그인한 손님도 커버를 못 본다: ${JSON.stringify(asCustomer.body)}`).toBe(200)
  })

  it('남의 사진은 커버로 걸 수 없고, 막힐 때 이미 공개된 화면은 그대로다', async () => {
    const before = await handleMarketplace(request('GET', ['company', 'p-page', 'page']), pool)
    const kept = (before.body as { config: PageConfig }).config.coverAssetId

    const draft = await handleMarketplace(request('GET', ['page'], { token: partner }), pool)
    const revision = (draft.body as { revision: number }).revision
    const r = await saveAndPublish(partner, { ...defaultPageConfig(), coverAssetId: otherAssetId }, revision)
    expect(r.saved.status, JSON.stringify(r.saved.body)).toBe(200)
    expect(r.published?.status, JSON.stringify(r.published?.body)).toBe(403)

    const after = await handleMarketplace(request('GET', ['company', 'p-page', 'page']), pool)
    expect((after.body as { config: PageConfig }).config.coverAssetId).toBe(kept)
  })
})
