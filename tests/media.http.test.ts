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
import { SUPPORT_THREAD } from '../lib/chat-model'

/**
 * 29-30: 사진·상담 스트림이 Next 어댑터를 **실제로** 지나가는가.
 *
 * 29-29 까지 `needsBucket()` 이 이 경로들을 저장소와 무관하게 503 으로 막고 있었다. 이 파일이 그 벽을
 * 재는 자리다 — 저장소(로컬 백엔드)를 주고 올리기·내려받기·권한·스트림을 HTTP 핸들러 높이에서 잰다.
 * 저장소가 **없을 때** 503 으로 말하는 것도 같이 잰다: 없는 것을 조용히 비우지 않는 것이 29-5 부터의 규칙이다.
 */
const DB_URL = process.env['DATABASE_URL']
const SCHEMA = 'media_http_test'
const HOST = 'app.test'

// COUNT(*)는 bigint(oid 20)라 pg가 문자열로 준다 — 도메인은 숫자로 센다
pg.types.setTypeParser(20, Number)

/** 1×1 PNG — IHDR·IDAT·IEND 뿐이라 `cleanImage` 가 바이트를 그대로 남긴다 */
const PNG = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
)

let pool: pg.Pool
let dir = ''
const withStore = (): NodeJS.ProcessEnv => ({ LOCAL_STORAGE_DIR: dir }) as NodeJS.ProcessEnv
const NO_STORE = {} as NodeJS.ProcessEnv

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
    ...(rest.signal !== undefined ? { signal: rest.signal } : {}),
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

const upload = (path: string[], token: string, bytes: Uint8Array, mime = 'image/png', extra: Record<string, string> = {}, query: Record<string, string> = {}) =>
  handleMarketplace(request('POST', path, { token, bytes, headers: { 'content-type': mime, ...extra }, query }), pool, withStore())

describe.skipIf(!DB_URL)('29-30: 사진과 상담 스트림이 어댑터를 지나간다', () => {
  let customer = ''
  let partner = ''
  let admin = ''
  let orderId = ''
  let photoId = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bandut-media-'))
    const client = new pg.Client({ connectionString: DB_URL })
    await client.connect()
    await client.query(`drop schema if exists ${SCHEMA} cascade`)
    await client.query(`create schema ${SCHEMA}`)
    await client.query(`set search_path = ${SCHEMA}`)
    await client.query(readFileSync('db/marketplace.pg.sql', 'utf8'))
    await client.end()
    pool = new pg.Pool({ connectionString: DB_URL, options: `-c search_path=${SCHEMA},public` })
    customer = await tokenFor('c-media', 'customer', '사진고객')
    partner = await tokenFor('p-media', 'partner', '사진파트너')
    admin = await tokenFor('admin-media', 'admin', '운영자')

    const created = await handleMarketplace(
      request('POST', ['orders'], {
        token: customer,
        body: {
          workItems: ['FLOOR'],
          description: '욕실 타일이 깨져서 교체가 필요합니다. 면적은 두 평 정도입니다.',
          region: '서울 강남구',
          address: '테헤란로 1길 1',
          phone: '01012345678',
          desiredDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
          budget: 500000,
          answers: { isLocked: null, urgent: false, ack: false },
          consent: true,
        },
      }),
      pool,
    )
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    orderId = (created.body as { id: string }).id

    const reg = await handleMarketplace(
      request('POST', ['partners'], {
        token: partner,
        body: { company: '사진타일', representative: '사진파트너', phone: '01098765432', workItems: ['FLOOR'], regions: '서울 강남구', partnerType: 'individual' },
      }),
      pool,
    )
    expect(reg.status, JSON.stringify(reg.body)).toBe(200)
    const approved = await handleMarketplace(
      request('POST', ['partners', 'p-media', 'approve'], { token: admin, body: { reason: '사업자와 시공 이력을 확인했습니다.', verified: true } }),
      pool,
    )
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
  })

  afterAll(async () => {
    await pool?.end()
    await rm(dir, { recursive: true, force: true })
    const client = new pg.Client({ connectionString: DB_URL })
    await client.connect()
    await client.query(`drop schema if exists ${SCHEMA} cascade`)
    await client.end()
  })

  it('저장소가 없으면 올리기도 보기도 503 으로 말한다 — 조용히 비우지 않는다', async () => {
    const up = await handleMarketplace(request('POST', ['orders', orderId, 'photos'], { token: customer, bytes: PNG, headers: { 'content-type': 'image/png' } }), pool, NO_STORE)
    expect(up.status, JSON.stringify(up.body)).toBe(503)
    expect(JSON.stringify(up.body)).toContain('사진 저장소')
    const down = await handleMarketplace(request('GET', ['photos', 'x'], { token: customer }), pool, NO_STORE)
    expect(down.status).toBe(503)
  })

  it('고객이 접수 사진을 올리면 표와 저장소에 남고, 같은 바이트가 이미지로 내려온다', async () => {
    const up = await upload(['orders', orderId, 'photos'], customer, PNG)
    expect(up.status, JSON.stringify(up.body)).toBe(201)
    photoId = (up.body as { id: string }).id
    expect((up.body as { mime: string }).mime).toBe('image/png')
    const row = await pool.query('select order_id, owner_id, object_key, mime from photos where id=$1', [photoId])
    expect(row.rows[0]).toMatchObject({ order_id: orderId, owner_id: 'c-media', mime: 'image/png' })
    expect(String(row.rows[0].object_key)).toContain(orderId)

    const down = await handleMarketplace(request('GET', ['photos', photoId], { token: customer }), pool, withStore())
    expect(down.status, JSON.stringify(down.body)).toBe(200)
    expect(down.raw).toBeInstanceOf(Response)
    expect(down.raw?.headers.get('content-type')).toBe('image/png')
    expect(down.raw?.headers.get('cache-control')).toContain('private')
    expect(Array.from(new Uint8Array(await down.raw!.arrayBuffer()))).toEqual(Array.from(PNG))
    // 주문 상세가 이 사진을 목록에 넣는다 — 화면의 <img src="/api/photos/:id"> 가 이 줄에서 나온다
    const detail = await handleMarketplace(request('GET', ['orders', orderId], { token: customer }), pool)
    expect((detail.body as { photos: { id: string }[] }).photos.map((p) => p.id)).toContain(photoId)
  })

  it('사진이 아닌 바이트는 400 으로 거절하고 아무것도 남기지 않는다', async () => {
    const before = await pool.query('select count(*) n from photos where order_id=$1', [orderId])
    const up = await upload(['orders', orderId, 'photos'], customer, new TextEncoder().encode('<svg onload=alert(1)></svg>'), 'image/svg+xml')
    expect(up.status, JSON.stringify(up.body)).toBe(400)
    const after = await pool.query('select count(*) n from photos where order_id=$1', [orderId])
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('선택되지 않은 파트너는 사진을 못 보고(403), 남의 주문에 증빙도 못 올린다(403); 관리자는 본다', async () => {
    const peek = await handleMarketplace(request('GET', ['photos', photoId], { token: partner }), pool, withStore())
    expect(peek.status, JSON.stringify(peek.body)).toBe(403)
    const evidence = await upload(['orders', orderId, 'photos'], partner, PNG, 'image/png', {}, { purpose: 'evidence' })
    expect(evidence.status, JSON.stringify(evidence.body)).toBe(403)
    const seen = await handleMarketplace(request('GET', ['photos', photoId], { token: admin }), pool, withStore())
    expect(seen.status, JSON.stringify(seen.body)).toBe(200)
    const nobody = await handleMarketplace(request('GET', ['photos', photoId]), pool, withStore())
    expect(nobody.status).toBe(401)
  })

  it('상담 스트림이 SSE 로 열리고 첫 스냅샷을 바로 준다', async () => {
    const ctrl = new AbortController()
    const out = await handleMarketplace(
      request('GET', ['orders', orderId, 'chat-stream'], { token: customer, query: { partnerId: SUPPORT_THREAD }, signal: ctrl.signal }),
      pool,
      withStore(),
    )
    expect(out.status, JSON.stringify(out.body)).toBe(200)
    expect(out.raw?.headers.get('content-type')).toContain('text/event-stream')
    const reader = out.raw!.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('event: snapshot')
    expect(first).toContain('"messages"')
    ctrl.abort()
    await reader.cancel()
  })

  it('상담 스트림도 참여자만 — 남의 주문은 열리지 않는다 (403, 스트림 없음)', async () => {
    // `chatStream` 은 첫 스냅샷을 스트림을 만들기 **전에** 읽는다. 그래서 참여자가 아니면 SSE 가 아니라
    // 보통의 403 JSON 이 나간다 — 브라우저는 폴링으로 내려가 같은 403 을 화면에 적는다. v17 과 같다.
    const out = await handleMarketplace(
      request('GET', ['orders', orderId, 'chat-stream'], { token: partner, query: { partnerId: 'p-media' } }),
      pool,
      withStore(),
    )
    expect(out.status, JSON.stringify(out.body)).toBe(403)
    expect(out.raw).toBeUndefined()
  })

  it('작업사례 사진: 파트너가 동의 헤더와 함께 올리고, 게시 전에는 남이 못 보고, 게시 뒤에는 로그인 없이도 본다', async () => {
    const noConsent = await upload(['portfolio-photo'], partner, PNG)
    expect(noConsent.status, JSON.stringify(noConsent.body)).toBe(400)
    const up = await upload(['portfolio-photo'], partner, PNG, 'image/png', { 'x-publication-consent': 'confirmed' })
    expect(up.status, JSON.stringify(up.body)).toBe(201)
    const assetId = (up.body as { id: string }).id

    const anonymousBefore = await handleMarketplace(request('GET', ['portfolio-photo', assetId]), pool, withStore())
    expect(anonymousBefore.status, JSON.stringify(anonymousBefore.body)).toBe(403)
    const customerBefore = await handleMarketplace(request('GET', ['portfolio-photo', assetId], { token: customer }), pool, withStore())
    expect(customerBefore.status).toBe(403)
    const owner = await handleMarketplace(request('GET', ['portfolio-photo', assetId], { token: partner }), pool, withStore())
    expect(owner.status, JSON.stringify(owner.body)).toBe(200)
    expect(owner.raw?.headers.get('content-type')).toBe('image/png')

    const published = await handleMarketplace(
      request('POST', ['portfolio'], {
        token: partner,
        body: { id: crypto.randomUUID(), title: '욕실 타일 교체', body: '깨진 타일을 걷어내고 새로 붙였습니다.', region: '서울 강남구', assetId, published: true, rightsConfirmed: true },
      }),
      pool,
    )
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    const anonymousAfter = await handleMarketplace(request('GET', ['portfolio-photo', assetId]), pool, withStore())
    expect(anonymousAfter.status, JSON.stringify(anonymousAfter.body)).toBe(200)
    expect(anonymousAfter.raw?.headers.get('cache-control')).toContain('public')
  })
})
