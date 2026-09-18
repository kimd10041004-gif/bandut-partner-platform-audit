/**
 * v17 도메인이 **우리 세션으로** 우리 서버에서 도는가 (29-2).
 *
 * 29-1은 도메인이 Postgres에서 도는 것까지 증명했다. 이번에는 그 위에 우리 인증을 얹는다:
 * 진짜 `sessions` 행에서 나온 토큰이 v17 `User`가 되고, v17의 `role()` 게이트가 그 사용자로 판단한다.
 *
 * 화면은 이 라운드에서 바뀌지 않는다 — 그래서 이 파일이 이번 라운드의 유일한 새 검증이다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { handleMarketplace, type ApiRequest } from '../server/marketplaceApi'
import { issueSession } from '../server/session'
import { DEFAULT_WORKSPACE } from '../server/handlers/auth'
import type { AuthSession } from '../server/domain/auth'

const DB_URL = process.env['DATABASE_URL']
const SCHEMA = 'marketplace_http_test'

// COUNT(*)는 bigint(oid 20)라 pg가 문자열로 준다 — 도메인은 숫자로 센다
pg.types.setTypeParser(20, Number)

let pool: pg.Pool

const HOST = 'app.test'
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

describe.skipIf(!DB_URL)('29-2: v17 도메인이 우리 세션으로 돈다', () => {
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(`drop schema if exists ${SCHEMA} cascade`)
    await admin.query(`create schema ${SCHEMA}`)
    // 마켓플레이스 표는 이 테스트 스키마에, 세션·계정 표는 public 그대로 — public은 건드리지 않는다 (29-1 §3-1)
    await admin.query(`set search_path = ${SCHEMA}`)
    await admin.query(readFileSync('db/marketplace.pg.sql', 'utf8'))
    await admin.end()
    pool = new pg.Pool({ connectionString: DB_URL, options: `-c search_path=${SCHEMA},public` })
  })

  afterAll(async () => {
    await pool?.end()
    const admin = new pg.Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(`drop schema if exists ${SCHEMA} cascade`)
    await admin.end()
  })

  it('로그인 없이는 아무것도 못 한다 — 401', async () => {
    const r = await handleMarketplace(request('GET', ['me']), pool)
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: '로그인이 필요합니다.' })
  })

  it('죽은 토큰도 401 (형식만 맞다고 통과하지 않는다)', async () => {
    const r = await handleMarketplace(request('GET', ['me'], { token: 'not-a-real-token' }), pool)
    expect(r.status).toBe(401)
  })

  it('우리 세션이 v17 users 행이 된다 — 처음 보는 계정은 CUSTOMER', async () => {
    const token = await tokenFor('c1', 'customer', '김고객')
    const r = await handleMarketplace(request('GET', ['me'], { token }), pool)
    expect(r.status).toBe(200)
    const me = r.body as { user: { id: string; name: string; role: string } }
    expect(me.user.id).toBe('c1')
    expect(me.user.name).toBe('김고객')
    expect(me.user.role).toBe('CUSTOMER')
  })

  it('관리자 세션은 ADMIN이 된다 — 우리 로그인이 이미 등급을 확인했다', async () => {
    const token = await tokenFor('admin-1', 'admin', '운영자')
    const r = await handleMarketplace(request('GET', ['me'], { token }), pool)
    expect((r.body as { user: { role: string } }).user.role).toBe('ADMIN')
  })

  it('관리자만 보는 목록은 고객에게 403 — 인가는 도메인이 한다', async () => {
    const token = await tokenFor('c1', 'customer', '김고객')
    const r = await handleMarketplace(request('GET', ['audit-logs'], { token }), pool)
    expect(r.status).toBe(403)
  })

  it('같은 출처가 아닌 POST는 403 (v17의 CSRF 방어를 그대로 옮겼다)', async () => {
    const token = await tokenFor('c1', 'customer', '김고객')
    const r = await handleMarketplace(
      {
        ...request('POST', ['orders'], { token, body: {} }),
        headers: { host: HOST, origin: 'https://evil.test', authorization: `Bearer ${token}` },
      },
      pool,
    )
    expect(r.status).toBe(403)
  })

  it('잘못된 입력은 400이고 이유가 함께 온다 — 503으로 뭉개지 않는다', async () => {
    const token = await tokenFor('c1', 'customer', '김고객')
    const r = await handleMarketplace(
      request('POST', ['orders'], { token, body: { workItems: ['NOT_A_CODE'], description: '짧음' } }),
      pool,
    )
    expect(r.status).toBe(400)
    expect((r.body as { error: string }).error).toBeTruthy()
  })

  it('사진 경로는 저장소가 없으면 503, 있으면 실제 라우트다 — 없는 사진은 404 (29-5 → 29-30)', async () => {
    const token = await tokenFor('c1', 'customer', '김고객')
    // 환경을 명시한다 — 러너·로컬 스위트가 LOCAL_STORAGE_DIR 을 주면 process.env 기본값으로는 답이 달라진다
    const none = await handleMarketplace(request('GET', ['photos', 'p1'], { token }), pool, {} as NodeJS.ProcessEnv)
    expect(none.status).toBe(503)
    const withStore = await handleMarketplace(
      request('GET', ['photos', 'p1'], { token }),
      pool,
      { LOCAL_STORAGE_DIR: '/tmp/bandut-mp-http-test' } as NodeJS.ProcessEnv,
    )
    expect(withStore.status).toBe(404)
  })

  it('주문 한 바퀴: 접수 → 검토 → 중개 → 입찰 → 낙찰', async () => {
    const customer = await tokenFor('c2', 'customer', '이고객')
    const admin = await tokenFor('admin-2', 'admin', '운영자')
    const partner = await tokenFor('p1', 'partner', '박파트너')

    const tomorrow = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    const created = await handleMarketplace(
      request('POST', ['orders'], {
        token: customer,
        body: {
          workItems: ['FLOOR'],
          description: '욕실 타일이 깨져서 교체가 필요합니다. 면적은 두 평 정도입니다.',
          region: '서울 강남구',
          address: '테헤란로 1길 1',
          phone: '01012345678',
          desiredDate: tomorrow,
          budget: 500000,
          answers: { isLocked: null, urgent: false, ack: false },
          consent: true,
        },
      }),
      pool,
    )
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const orderId = (created.body as { id: string }).id

    // 파트너 등록·승인 — v17이 PARTNER 승격을 맡는다(어댑터는 올리지 않는다)
    const reg = await handleMarketplace(
      request('POST', ['partners'], {
        token: partner,
        body: {
          company: '반듯타일',
          representative: '박파트너',
          phone: '01098765432',
          workItems: ['FLOOR'],
          regions: '서울 강남구',
          partnerType: 'individual',
        },
      }),
      pool,
    )
    expect(reg.status, JSON.stringify(reg.body)).toBe(200)
    const approved = await handleMarketplace(
      request('POST', ['partners', 'p1', 'approve'], {
        token: admin,
        body: { reason: '사업자와 시공 이력을 확인했습니다.', verified: true },
      }),
      pool,
    )
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)

    // 안전 검토 → 중개로 라우팅
    const reviewed = await handleMarketplace(
      request('POST', ['orders', orderId, 'review'], {
        token: admin,
        body: {
          reason: '연락처와 작업 범위를 확인했습니다.',
          contactChecked: true,
          safetyDelivered: true,
          identityChecked: false,
          // FLOOR는 작업 범위 검토가 필요한 공종이다 — 이 확인이 없으면 도메인이 400으로 막는다
          scopeChecked: true,
        },
      }),
      pool,
    )
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200)
    const routed = await handleMarketplace(
      request('POST', ['orders', orderId, 'route'], {
        token: admin,
        body: { decision: 'MARKETPLACE', reason: '중개로 진행합니다.' },
      }),
      pool,
    )
    expect(routed.status, JSON.stringify(routed.body)).toBe(200)

    // 낙찰 전에는 파트너에게 주소·연락처가 보이지 않는다 (28-94와 같은 규칙이 v17에도 있다)
    const seen = await handleMarketplace(request('GET', ['orders', orderId], { token: partner }), pool)
    expect(seen.status).toBe(200)
    expect((seen.body as { address?: string }).address).toBeUndefined()

    const bid = await handleMarketplace(
      request('POST', ['orders', orderId, 'bids'], {
        token: partner,
        body: {
          laborCost: 300000,
          materialCost: 150000,
          transportCost: 30000,
          discount: 0,
          included: '타일 교체와 줄눈 시공',
          excluded: '방수 공사는 제외입니다',
          message: '오전에 방문하여 두 시간 정도 작업합니다.',
          availableDate: tomorrow,
          startHour: 10,
          endHour: 12,
        },
      }),
      pool,
    )
    expect(bid.status, JSON.stringify(bid.body)).toBe(200)

    const list = await handleMarketplace(request('GET', ['orders', orderId], { token: customer }), pool)
    const bids = (list.body as { bids?: { id: string; total: number }[] }).bids ?? []
    expect(bids).toHaveLength(1)
    // 공급가 480,000 + VAT 10% = 528,000 — 금액은 도메인이 계산한다
    expect(bids[0]?.total).toBe(528000)
  })

  it('업체 찾기는 로그인 없이 열리고 승인된 업체만 나온다 (29-13)', async () => {
    const admin = await tokenFor('admin-3', 'admin', '운영자')
    const pending = await tokenFor('p9', 'partner', '미승인파트너')
    const shown = await tokenFor('p8', 'partner', '승인파트너')

    for (const [token, company] of [
      [pending, '아직미승인'],
      [shown, '반듯전기'],
    ] as const) {
      const r = await handleMarketplace(
        request('POST', ['partners'], {
          token,
          body: {
            company,
            representative: '대표',
            phone: '01011112222',
            workItems: ['ELECTRIC'],
            regions: '서울 강남구',
            partnerType: 'individual',
          },
        }),
        pool,
      )
      expect(r.status, JSON.stringify(r.body)).toBe(200)
    }
    await handleMarketplace(
      request('POST', ['partners', 'p8', 'approve'], {
        token: admin,
        body: { reason: '사업자와 시공 이력을 확인했습니다.', verified: true },
      }),
      pool,
    )

    // 토큰 없이 — 이 줄이 이 검사의 이유다
    const list = await handleMarketplace(request('GET', ['companies']), pool)
    expect(list.status, JSON.stringify(list.body)).toBe(200)
    const names = (list.body as { companies: { company: string; rating: number | null; review_count: number }[] })
      .companies
    expect(names.map((c) => c.company)).toContain('반듯전기')
    expect(names.map((c) => c.company)).not.toContain('아직미승인')

    // 후기가 없으면 별점을 만들지 않는다 (명세 4절)
    const electric = names.find((c) => c.company === '반듯전기')
    expect(electric?.review_count).toBe(0)
    expect(electric?.rating).toBeNull()

    // 필터가 실제로 좁힌다
    const other = await handleMarketplace(request('GET', ['companies'], { query: { work: 'PLUMBING' } }), pool)
    expect((other.body as { companies: unknown[] }).companies).toHaveLength(0)

    // 상세도 로그인 없이 열린다
    const detail = await handleMarketplace(request('GET', ['company', 'p8']), pool)
    expect(detail.status, JSON.stringify(detail.body)).toBe(200)
    // 미승인 업체는 주소를 알아도 열리지 않는다
    expect((await handleMarketplace(request('GET', ['company', 'p9']), pool)).status).toBe(404)
  })

  it('공개 Q&A: 고객이 묻고 그 업체만 답한다 (29-14)', async () => {
    const admin = await tokenFor('admin-4', 'admin', '운영자')
    const shop = await tokenFor('p7', 'partner', '김파트너')
    const other = await tokenFor('p6', 'partner', '남의업체')
    const asker = await tokenFor('c7', 'customer', '김고객')

    for (const [token, company] of [
      [shop, '반듯도배'],
      [other, '남의도배'],
    ] as const) {
      await handleMarketplace(
        request('POST', ['partners'], {
          token,
          body: {
            company,
            representative: '대표',
            phone: '01033334444',
            workItems: ['WALL_FINISH'],
            regions: '서울 강남구',
            partnerType: 'individual',
          },
        }),
        pool,
      )
    }
    for (const id of ['p7', 'p6']) {
      await handleMarketplace(
        request('POST', ['partners', id, 'approve'], {
          token: admin,
          body: { reason: '사업자와 시공 이력을 확인했습니다.', verified: true },
        }),
        pool,
      )
    }

    const asked = await handleMarketplace(
      request('POST', ['company', 'p7', 'questions'], {
        token: asker,
        body: { body: '20평 아파트 도배는 보통 며칠 걸리나요?', caseId: null },
      }),
      pool,
    )
    expect(asked.status, JSON.stringify(asked.body)).toBe(201)
    const qid = (asked.body as { id: string }).id

    // 로그인 없이 읽힌다 — 다음 손님이 같은 것을 묻지 않게 하려는 것이다
    const publicList = await handleMarketplace(request('GET', ['company', 'p7', 'questions']), pool)
    expect(publicList.status).toBe(200)
    const rows = publicList.body as { id: string; asker: string; answer: string | null }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.answer).toBeNull()
    // 실명이 공개 게시판에 남지 않는다
    expect(rows[0]?.asker).toBe('김OO')
    expect(JSON.stringify(rows)).not.toContain('김고객')

    // 남의 업체는 답할 수 없다 — 이 줄이 이 검사의 이유다
    const stolen = await handleMarketplace(
      request('POST', ['questions', qid, 'answer'], { token: other, body: { answer: '제가 답하겠습니다.' } }),
      pool,
    )
    expect(stolen.status).toBe(403)

    const answered = await handleMarketplace(
      request('POST', ['questions', qid, 'answer'], {
        token: shop,
        body: { answer: '보통 이틀이면 끝납니다. 가구 이동이 많으면 하루 더 봅니다.' },
      }),
      pool,
    )
    expect(answered.status, JSON.stringify(answered.body)).toBe(200)
    const afterAnswer = (await handleMarketplace(request('GET', ['company', 'p7', 'questions']), pool)).body as {
      answer: string | null
    }[]
    expect(afterAnswer[0]?.answer).toContain('이틀')

    // 관리자가 숨기면 공개 목록에서 사라진다
    await handleMarketplace(
      request('POST', ['admin', 'questions'], { token: admin, body: { id: qid, hidden: true } }),
      pool,
    )
    expect((await handleMarketplace(request('GET', ['company', 'p7', 'questions']), pool)).body).toHaveLength(0)
    // 그래도 업체의 받은 질문함에는 남는다 — 답변 대상이다
    const inbox = (await handleMarketplace(request('GET', ['questions'], { token: shop }), pool)).body as unknown[]
    expect(inbox).toHaveLength(1)
  })

  it('업체 페이지: 저장은 공개를 바꾸지 않고, 공개 실패는 기존 공개본을 지킨다 (29-15)', async () => {
    const admin = await tokenFor('admin-5', 'admin', '운영자')
    const shop = await tokenFor('p5', 'partner', '이파트너')
    await handleMarketplace(
      request('POST', ['partners'], {
        token: shop,
        body: {
          company: '반듯창호',
          representative: '대표',
          phone: '01055556666',
          workItems: ['WINDOW'],
          regions: '서울 강남구',
          partnerType: 'individual',
        },
      }),
      pool,
    )
    await handleMarketplace(
      request('POST', ['partners', 'p5', 'approve'], {
        token: admin,
        body: { reason: '사업자와 시공 이력을 확인했습니다.', verified: true },
      }),
      pool,
    )

    const draft0 = await handleMarketplace(request('GET', ['page'], { token: shop }), pool)
    expect(draft0.status, JSON.stringify(draft0.body)).toBe(200)
    const start = draft0.body as { config: Record<string, unknown>; revision: number; published: boolean }
    expect(start.revision).toBe(0)
    expect(start.published).toBe(false)

    const config = { ...start.config, introText: '창호 교체만 20년 했습니다.' }
    const saved = await handleMarketplace(
      request('POST', ['page'], { token: shop, body: { config, revision: 0 } }),
      pool,
    )
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect((saved.body as { revision: number }).revision).toBe(1)

    // 저장만으로는 손님에게 보이지 않는다
    const beforePublish = await handleMarketplace(request('GET', ['company', 'p5', 'page']), pool)
    expect((beforePublish.body as { published: boolean }).published).toBe(false)

    // 낡은 리비전으로 저장하면 앞선 변경을 덮지 않고 409
    const stale = await handleMarketplace(
      request('POST', ['page'], { token: shop, body: { config, revision: 0 } }),
      pool,
    )
    expect(stale.status).toBe(409)

    const published = await handleMarketplace(
      request('POST', ['page', 'publish'], { token: shop, body: { revision: 1 } }),
      pool,
    )
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    const live = await handleMarketplace(request('GET', ['company', 'p5', 'page']), pool)
    expect((live.body as { published: boolean }).published).toBe(true)
    expect((live.body as { config: { introText: string } }).config.introText).toContain('20년')

    // 남의 사례를 대표로 걸고 공개하려 하면 막히고, **기존 공개본은 그대로** 남는다
    const stolen = { ...config, featuredPortfolioIds: ['00000000-0000-4000-8000-000000000001'] }
    const savedBad = await handleMarketplace(
      request('POST', ['page'], { token: shop, body: { config: stolen, revision: 1 } }),
      pool,
    )
    expect(savedBad.status).toBe(200)
    const rejected = await handleMarketplace(
      request('POST', ['page', 'publish'], { token: shop, body: { revision: 2 } }),
      pool,
    )
    expect(rejected.status).toBe(403)
    const stillLive = await handleMarketplace(request('GET', ['company', 'p5', 'page']), pool)
    expect((stillLive.body as { config: { introText: string } }).config.introText).toContain('20년')
    expect((stillLive.body as { config: { featuredPortfolioIds: string[] } }).config.featuredPortfolioIds).toHaveLength(
      0,
    )
  })

  it('거래 전 상담: 방은 하나뿐이고 남은 못 들어오며 같은 메시지는 한 번만 남는다 (29-16)', async () => {
    const admin = await tokenFor('admin-6', 'admin', '운영자')
    const shop = await tokenFor('p4', 'partner', '최파트너')
    const nosy = await tokenFor('c5', 'customer', '남의고객')
    const asker = await tokenFor('c4', 'customer', '정고객')

    await handleMarketplace(
      request('POST', ['partners'], {
        token: shop,
        body: {
          company: '반듯전기2',
          representative: '대표',
          phone: '01077778888',
          workItems: ['ELECTRIC'],
          regions: '서울 강남구',
          partnerType: 'individual',
        },
      }),
      pool,
    )
    await handleMarketplace(
      request('POST', ['partners', 'p4', 'approve'], {
        token: admin,
        body: { reason: '사업자와 시공 이력을 확인했습니다.', verified: true },
      }),
      pool,
    )

    const opened = await handleMarketplace(
      request('POST', ['company', 'p4', 'consult'], { token: asker, body: { caseId: null } }),
      pool,
    )
    expect(opened.status, JSON.stringify(opened.body)).toBe(200)
    const room = opened.body as { id: string; created: boolean }
    expect(room.created).toBe(true)

    // 같은 조합으로 다시 열어도 새 방이 생기지 않는다
    const again = await handleMarketplace(
      request('POST', ['company', 'p4', 'consult'], { token: asker, body: { caseId: null } }),
      pool,
    )
    expect((again.body as { id: string; created: boolean }).id).toBe(room.id)
    expect((again.body as { created: boolean }).created).toBe(false)

    // 주문이 없어도 대화가 된다
    const msgId = '11111111-1111-4111-8111-111111111111'
    const sent = await handleMarketplace(
      request('POST', ['consultations', room.id, 'messages'], {
        token: asker,
        body: { id: msgId, body: '누전 차단기가 자꾸 내려갑니다. 방문 가능하실까요?' },
      }),
      pool,
    )
    expect(sent.status, JSON.stringify(sent.body)).toBe(200)

    // 같은 ID 로 또 보내도 한 번만 남는다 — 다시 누르는 일은 흔하다
    const retry = await handleMarketplace(
      request('POST', ['consultations', room.id, 'messages'], {
        token: asker,
        body: { id: msgId, body: '누전 차단기가 자꾸 내려갑니다. 방문 가능하실까요?' },
      }),
      pool,
    )
    expect((retry.body as { duplicate: boolean }).duplicate).toBe(true)

    // 업체가 답한다
    await handleMarketplace(
      request('POST', ['consultations', room.id, 'messages'], {
        token: shop,
        body: { id: '22222222-2222-4222-8222-222222222222', body: '내일 오전에 가능합니다.' },
      }),
      pool,
    )
    const read = await handleMarketplace(request('GET', ['consultations', room.id], { token: asker }), pool)
    expect((read.body as { messages: unknown[] }).messages).toHaveLength(2)

    // 남의 고객은 들어올 수 없다 — 이 줄이 이 검사의 이유다
    const peek = await handleMarketplace(request('GET', ['consultations', room.id], { token: nosy }), pool)
    expect(peek.status).toBe(403)

    // 안 읽은 수: 고객은 방금 읽었으니 0, 업체는 고객 글 하나가 남아 있다
    const mine = (await handleMarketplace(request('GET', ['consultations'], { token: asker }), pool)).body as {
      unread: number
    }[]
    expect(mine[0]?.unread).toBe(0)
    const theirs = (await handleMarketplace(request('GET', ['consultations'], { token: shop }), pool)).body as {
      unread: number
    }[]
    expect(theirs[0]?.unread).toBe(1)
  })
})
