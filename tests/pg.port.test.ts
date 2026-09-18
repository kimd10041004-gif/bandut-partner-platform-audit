import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { pgDatabase, toPositional } from '../server/pgPort'
import { marketplace } from '../lib/service'
import { community } from '../lib/community'
import { trade } from '../lib/trade'
import type { User } from '../lib/model'

/**
 * 같은 도메인을 **Postgres에서** 돌린다 (29-1).
 *
 * `tests/*.integration.test.ts`는 Node 내장 SQLite로 도메인 규칙을 증명하고, 이 파일은 그 규칙이
 * **우리가 실제로 쓸 저장소**에서도 같은지를 본다 — 스키마 변환(`scripts/pg-schema.mjs`), 자리표시자,
 * batch 트랜잭션, 그리고 SQLite `RAISE(ABORT)`를 옮긴 plpgsql 트리거까지.
 *
 * `DATABASE_URL`이 없으면 건너뛴다(로컬 게이트는 이 파일 없이도 돌아간다). CI의 server job이 준다.
 */
const DB_URL = process.env['DATABASE_URL']
/** 이 테스트만 쓰는 스키마 — `public`(스냅샷·세션)은 건드리지 않는다 */
const SCHEMA = 'marketplace_port_test'
const TABLES = [
  'chat_reads',
  'calendar_events',
  'reviews',
  'portfolio_cases',
  'portfolio_assets',
  'partner_profiles',
  'submission_keys',
  'request_drafts',
  'settlements',
  'disputes',
  'refunds',
  'payments',
  'completions',
  'schedule_changes',
  'extra_works',
  'notifications',
  'messages',
  'contracts',
  'trade_terms',
  'rate_limits',
  'photos',
  'audit_logs',
  'schedule_slots',
  'bids',
  'orders',
  'partners',
  'users',
  'content_posts',
  'operation_settings',
  'site_presentation',
]

describe.skipIf(!DB_URL)('Postgres 포트 (29-1)', () => {
  let pool: pg.Pool
  let svc: ReturnType<typeof marketplace>
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
  const input = () => ({
    workItems: ['CURTAIN', 'FIXTURE'],
    description: '거실 커튼과 욕실 선반 설치가 필요합니다.',
    region: '서울 은평구',
    address: '테스트 도로 123 테스트호',
    phone: '01012345678',
    desiredDate: future,
    budget: 300_000,
    answers: { isLocked: null, urgent: null, ack: false },
    consent: true as const,
  })
  const bid = (overrides = {}) => ({
    laborCost: 150_000,
    materialCost: 10_000,
    transportCost: 20_000,
    discount: 0,
    included: '설치와 뒷정리',
    excluded: '제품 구매',
    message: '방문 전 자재 규격 확인 부탁드립니다.',
    availableDate: future,
    startHour: 9,
    endHour: 11,
    ...overrides,
  })

  beforeAll(async () => {
    /**
     * 29-26: 전에는 여기서 `pg.types.setTypeParser(20, Number)` 를 **전역으로** 걸었다. 그것이 포트의 구멍을
     * 가렸다 — 운영의 풀에는 그런 설정이 없어서 `COUNT`·`SUM` 이 문자열로 왔고, 이 파일만 초록이었다.
     * 이제 숫자로 바꾸는 일은 포트(`server/pgPort.ts`)가 하고, 이 파일은 운영과 같은 풀로 그것을 확인한다.
     */
    /**
     * **자기 스키마 안에서만 논다.** 같은 DB를 스냅샷 API·계약 테스트·서버 e2e가 함께 쓰기 때문에
     * `public`을 지우면 남의 표까지 사라진다(29-1 첫 CI가 이렇게 깨졌다 — `snapshots` 없음).
     * 여기서 만들고 지우는 것은 이 스키마 하나이고, 연결마다 `search_path`를 그쪽으로 돌린다.
     */
    pool = new pg.Pool({
      connectionString: DB_URL,
      max: 4,
      options: `-c search_path=${SCHEMA}`,
    })
    const setup = new pg.Client({ connectionString: DB_URL })
    await setup.connect()
    try {
      await setup.query(`drop schema if exists ${SCHEMA} cascade`)
      await setup.query(`create schema ${SCHEMA}`)
      await setup.query(`set search_path to ${SCHEMA}`)
      await setup.query(readFileSync('db/marketplace.pg.sql', 'utf8'))
    } finally {
      await setup.end()
    }
  })
  afterAll(async () => {
    await pool.end()
    const teardown = new pg.Client({ connectionString: DB_URL })
    await teardown.connect()
    try {
      await teardown.query(`drop schema if exists ${SCHEMA} cascade`)
    } finally {
      await teardown.end()
    }
  })
  beforeEach(async () => {
    await pool.query(`truncate ${TABLES.join(',')} restart identity cascade`)
    svc = marketplace(pgDatabase(pool))
  })

  it('자리표시자만 바꾼다 — 문자열 안의 물음표는 그대로', () => {
    expect(toPositional('select * from t where a=? and b=?')).toBe('select * from t where a=$1 and b=$2')
    expect(toPositional("select ? , '정말?' , ?")).toBe("select $1 , '정말?' , $2")
  })

  it('접수 → 검토 → 견적 → 낙찰이 Postgres에서 같은 결과를 낸다', async () => {
    const admin = await svc.identity('owner', 'owner@example.test', '관리자')
    await pool.query("update users set role='ADMIN' where id=$1", [admin.id])
    admin.role = 'ADMIN'
    const customer = await svc.identity('customer-a', 'ca@example.test', '고객 A')
    let partner: User = await svc.identity('partner-a', 'pa@example.test', '파트너 A')
    await svc.registerPartner(partner, {
      company: '테스트 업체',
      representative: '확인용 기술자',
      phone: '01012345678',
      workItems: ['CURTAIN', 'FIXTURE'],
      regions: '서울·경기',
      partnerType: 'individual',
    })
    await svc.approve(admin, partner.id, { verified: true, reason: '독립 테스트용 신원 확인 완료' })
    partner = await svc.identity(partner.id, partner.email, partner.name)

    const { id } = await svc.createOrder(customer, input())
    await svc.route(admin, id, { decision: 'MARKETPLACE', reason: '작업 내용 확인 후 파트너 견적 모집' })
    await svc.bid(partner, id, bid())
    const seen = await svc.detail(customer, id)
    // 서버가 VAT·총액을 다시 계산한다 (180,000 + 18,000)
    expect(seen.bids[0]!.total).toBe(198_000)
    // 낙찰 전 파트너에게는 주소·연락처가 없다
    expect((await svc.detail(partner, id)).order.address).toBeUndefined()
    const chosen = seen.bids[0]!
    await svc.select(customer, id, {
      bidId: chosen.id,
      expectedTotal: chosen.total,
      expectedUpdatedAt: chosen.updated_at,
    })
    const after = await svc.detail(customer, id)
    expect(after.order.status).toBe('BID_SELECTED')
    expect((await pool.query('select count(*)::int n from schedule_slots')).rows[0].n).toBe(1)
    expect((await svc.detail(partner, id)).order.address).toBe(input().address)
  })

  it('SQLite RAISE를 옮긴 트리거가 Postgres에서도 막는다 — 감사로그 불변·일정 충돌', async () => {
    const admin = await svc.identity('owner', 'owner@example.test', '관리자')
    await pool.query("update users set role='ADMIN' where id=$1", [admin.id])
    await pool.query(
      "insert into audit_logs (id,actor_id,role,order_id,action,reason,created_at) values ('A1',$1,'ADMIN',null,'TEST','기록',$2)",
      [admin.id, new Date().toISOString()],
    )
    await expect(pool.query("update audit_logs set reason='고침' where id='A1'")).rejects.toThrow('AUDIT_IMMUTABLE')
    await expect(pool.query("delete from audit_logs where id='A1'")).rejects.toThrow('AUDIT_IMMUTABLE')
    // 일정 겹침
    const customer = await svc.identity('customer-a', 'ca@example.test', '고객 A')
    const { id } = await svc.createOrder(customer, input())
    await pool.query(
      "insert into schedule_slots (order_id,partner_id,date,start_hour,end_hour) values ($1,'P-1',$2,9,11)",
      [id, future],
    )
    const { id: other } = await svc.createOrder(customer, input())
    await expect(
      pool.query(
        "insert into schedule_slots (order_id,partner_id,date,start_hour,end_hour) values ($1,'P-1',$2,10,12)",
        [other, future],
      ),
    ).rejects.toThrow('SCHEDULE_CONFLICT')
  })

  /**
   * 29-25: 관리자 운영 대시보드의 지표.
   *
   * 이 자리는 **SQLite 에서만 도는 날짜 함수**를 쓰고 있었다(`date(created_at,'+9 hours')`).
   * 단위 테스트는 SQLite 로 돌아 초록이었고, 운영(Postgres)에서만 대시보드가 통째로 비었다.
   * 그 부류가 다시 들어오지 못하게 **진짜 Postgres 로** 부른다.
   */
  it('운영 지표가 Postgres 에서 돌고, 날짜별 접수가 한국 날짜로 묶인다', async () => {
    const admin = await svc.identity('metrics-owner', 'mo@example.test', '관리자')
    await pool.query("update users set role='ADMIN' where id=$1", [admin.id])
    admin.role = 'ADMIN'
    const customer = await svc.identity('metrics-customer', 'mc@example.test', '고객')
    const { id } = await svc.createOrder(customer, input())

    // 30일 창 안이면서, UTC 날짜와 한국 날짜가 **다른** 시각(한국의 자정 직후)을 고른다.
    // 묶는 기준이 UTC 면 하루 어긋난 날짜가 나오므로 이 한 줄이 기준을 가른다.
    const at = new Date(Date.now() - 2 * 86400000)
    at.setUTCHours(16, 30, 0, 0)
    const kstDay = new Date(at.getTime() + 9 * 3600000).toISOString().slice(0, 10)
    expect(kstDay).not.toBe(at.toISOString().slice(0, 10))
    await pool.query('update orders set created_at=$1 where id=$2', [at.toISOString(), id])

    const m = await community(pgDatabase(pool)).metrics(admin)
    expect(m.orders).toBeGreaterThan(0)
    expect(m.daily.map((d) => d.day)).toContain(kstDay)
  })

  /**
   * 29-25: 거래 채팅의 첫 장.
   *
   * 화면이 처음 대화방을 열 때 커서를 안 준다. 그러면 서버가 `Number.MAX_SAFE_INTEGER`(9007조)를
   * 커서로 써서 `seq < ?` 에 넣는데, `messages.seq` 는 Postgres 에서 **`integer`(21억까지)** 다.
   * SQLite 는 아무 숫자나 받아 초록이었고, 운영에서만 대화방이 통째로 안 열렸다.
   *
   * 여기서 커서 없이 부른다 — 화면이 하는 것과 똑같이.
   */
  it('거래 채팅이 커서 없이도 Postgres 에서 열린다', async () => {
    const admin = await svc.identity('chat-owner', 'co@example.test', '관리자')
    await pool.query("update users set role='ADMIN' where id=$1", [admin.id])
    admin.role = 'ADMIN'
    const customer = await svc.identity('chat-customer', 'cc@example.test', '고객')
    let partner: User = await svc.identity('chat-partner', 'cp@example.test', '파트너')
    await svc.registerPartner(partner, {
      company: '대화 시험 업체',
      representative: '확인용 기술자',
      phone: '01012345678',
      workItems: ['CURTAIN'],
      regions: '서울·경기',
      partnerType: 'individual',
    })
    await svc.approve(admin, partner.id, { verified: true, reason: '대화 시험용 신원 확인 완료' })
    partner = await svc.identity(partner.id, partner.email, partner.name)

    const { id } = await svc.createOrder(customer, input())
    await svc.route(admin, id, { decision: 'MARKETPLACE', reason: '작업 내용 확인 후 파트너 견적 모집' })
    await svc.bid(partner, id, bid())

    const ct = trade(pgDatabase(pool))
    await ct.send(customer, id, {
      id: crypto.randomUUID(),
      partnerId: partner.id,
      body: '방문 전에 창 폭을 알려드릴까요?',
      photoIds: [],
    })
    const thread = await ct.chat(customer, id, partner.id)
    expect(thread.messages.map((m) => m.body)).toContain('방문 전에 창 폭을 알려드릴까요?')
  })

  /**
   * 29-26: 집계값이 **문자열**로 오던 자리.
   *
   * `pg` 는 `COUNT`·`SUM` 의 `bigint` 와 `AVG` 의 `numeric` 을 기본으로 문자열로 준다. SQLite 는 숫자로 준다.
   * 도메인은 SQLite 에서 자랐으므로 `c.total + ex.total` 이 운영에서 `"1980000"` 이 되고(이어붙이기),
   * 정산 승인은 `gross !== expected` 에서 **항상** 거절됐다. `rating.toFixed(1)` 은 던졌다.
   *
   * 통합 스위트를 Postgres 로 돌려서 찾았다(`npm run test:pg:suite`, 고치기 전 15 실패). 여기는 포트 한
   * 줄의 계약만 고정한다 — **운영과 같은 풀 설정으로**, 전역 파서 없이.
   */
  it('COUNT·SUM·AVG 가 Postgres 에서도 숫자로 온다', async () => {
    const row = await pgDatabase(pool)
      .prepare('SELECT COUNT(*) n, COALESCE(SUM(v),0) s, AVG(v) a FROM (SELECT 1 v UNION ALL SELECT 2) t')
      .bind()
      .first<{ n: unknown; s: unknown; a: unknown }>()
    expect(row).toEqual({ n: 2, s: 3, a: 1.5 })
  })
})
