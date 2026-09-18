/**
 * v17 마켓플레이스 API를 우리 서버에 올린다 (29-2).
 *
 * 원본은 `app/api/[...path]/route.ts` 하나에 전체 API가 들어 있다. 그 **경로 표(무엇이 어떤 서비스를 부르는가)**를
 * 그대로 옮기고, 바깥 결합만 바꿨다:
 *
 * | v17 | 여기 |
 * |---|---|
 * | `getChatGPTUser()` + `oai-authenticated-user-id` | 우리 세션 (`sessionOf` → `identityOf`) |
 * | `env.DB` (Cloudflare D1) | `pgDatabase(pool)` (29-1) |
 * | `env.BUCKET` (Cloudflare R2) | 파일 저장소 포트 `storageFor(env)` (29-23) — 사진은 `lib/media.ts` 가 그 위에서 다룬다 (29-30) |
 * | `env as PaymentConfig` | 우리 환경변수 |
 *
 * 도메인(`lib/`)은 한 줄도 고치지 않았다. 서비스가 전부 `User`를 첫 인자로 받고 그 안에서 `role()`로 막기 때문에,
 * 인가는 여기가 아니라 도메인에 있다 — 이 파일은 **누구인지만** 정한다.
 */
import type { Pool } from 'pg'
import { SEQ_MAX } from '../lib/chat-model'
import { community } from '../lib/community'
import type { Database } from '../lib/model'
import type { PaymentConfig } from '../lib/payments'
import { presentationService } from '../lib/presentation-service'
import { marketplace, ServiceError } from '../lib/service'
import { trade } from '../lib/trade'
import { workspaceService } from '../lib/workspace-service'
import { DEFAULT_WORKSPACE } from './handlers/auth'
import { pgDatabase } from './pgPort'
import { identityOf } from './identity'
import { sessionOf, tokenOf } from './session'
import { partnerDocuments } from '../lib/partner-documents'
import { media, PUBLICATION_CONSENT_HEADER, type OpenedPhoto } from '../lib/media'
import { chatStream } from '../lib/chat-stream'
import { storageFor } from './storage'

export interface ApiRequest {
  method: string
  /** `/api/mp` 뒤의 경로 조각들 — 예: `['orders','o1','trade','start']` */
  path: string[]
  headers: Record<string, string | undefined>
  query: Record<string, string | undefined>
  body: unknown
  /** JSON 이 아닌 본문(사진 바이트). 라우트가 `content-type` 을 보고 여기에 담는다 (29-30) */
  bytes?: Uint8Array
  /** 요청이 끊기면 스트림(SSE)을 닫기 위한 신호 (29-30) */
  signal?: AbortSignal
}

export interface ApiResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
  /**
   * JSON 모양에 담기지 않는 응답 — 사진 바이트와 SSE 스트림 (29-30).
   * 있으면 라우트는 `body` 대신 이것을 그대로 내보낸다.
   */
  raw?: Response
}

const json = (body: unknown, status = 200): ApiResponse => ({
  status,
  body,
  headers: { 'cache-control': 'no-store' },
})

/** 파일 저장소가 연결되지 않았을 때 파일을 다루는 경로는 **조용히 비지 않고** 이렇게 말한다 (29-5부터) */
const NO_BUCKET = 503
const noBucket = (): ApiResponse => json({ error: '사진 저장소가 아직 연결되지 않았습니다.' }, NO_BUCKET)

/**
 * 사진 바이트를 응답으로 (29-30).
 *
 * 저장소 주소를 브라우저에 주지 않는다 — 바이트가 우리 서버를 거쳐 나가고, 누가 볼 수 있는지는 도메인이 정한다.
 * 개인 사진(주문 사진)은 `private` 로만 캐시된다: 공유 캐시가 남의 집 사진을 다음 사람에게 주면 안 된다.
 * 게시된 작업사례 사진만 `public` 이다.
 */
function fileResponse(f: OpenedPhoto): ApiResponse {
  return {
    status: 200,
    body: null,
    raw: new Response(Buffer.from(f.bytes), {
      status: 200,
      headers: {
        'content-type': f.mime,
        'content-length': String(f.bytes.byteLength),
        'cache-control': f.isPublic ? 'public, max-age=3600' : 'private, max-age=600',
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
      },
    }),
  }
}

/** 사진 올리기 경로가 받은 바이트. 라우트가 JSON 이 아닌 본문만 여기에 담으므로, 없으면 사진이 아니다 */
function bytesOf(req: ApiRequest): Uint8Array {
  if (req.bytes === undefined || req.bytes.byteLength === 0) {
    throw new ServiceError(400, '사진 파일을 선택해 주세요. JPEG·PNG 만 올릴 수 있습니다.')
  }
  return req.bytes
}

/** v17이 던지는 오류를 원본과 같은 상태 코드로 옮긴다 (route.ts의 catch 그대로) */
export function errorResponse(e: unknown): ApiResponse {
  if (e instanceof ServiceError) return json({ error: e.message }, e.status)
  const msg = e instanceof Error ? e.message : ''
  if (msg.includes('INTAKE_PAUSED')) {
    return json({ error: '현재 신규 접수가 중단되어 있습니다. 운영 안내를 확인해 주세요.' }, 409)
  }
  if (/INCOMPLETE|RECHECK|질문|안내|일정|손상|이미지|사진|JPEG|PNG|파일 내용/.test(msg)) {
    return json({ error: msg }, 400)
  }
  if (/SQLITE_CONSTRAINT|STALE_OPERATION|SCHEDULE_CONFLICT|integer overflow|violates|duplicate key/.test(msg)) {
    return json({ error: '다른 변경 사항이나 일정 충돌이 있습니다. 새로고침 후 확인해 주세요.' }, 409)
  }
  // zod 는 issues 를 들고 온다 — 첫 항목이 사용자에게 보여 줄 말이다
  const issues = (e as { issues?: { message?: string }[] }).issues
  if (Array.isArray(issues)) return json({ error: issues[0]?.message ?? '입력값을 확인해 주세요.' }, 400)
  // v17 route.ts와 같이, 어디에도 안 걸린 오류는 **서버 로그에 남긴다**.
  // 남기지 않으면 503만 보이고 원인은 사라진다 — 이 줄이 없어서 29-2 개발 중에 한 번 헤맸다.
  console.error('marketplace request failed', e)
  return json({ error: '처리하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.' }, 503)
}

export async function handleMarketplace(
  req: ApiRequest,
  pool: Pool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ApiResponse> {
  const db = pgDatabase(pool) as Database
  const p = req.path
  try {
    // v17과 같이, 로그인 없이 열리는 읽기 경로가 먼저다 (랜딩·서비스 소개가 이걸 읽는다)
    if (req.method === 'GET' && ['content', 'operation', 'presentation'].includes(p[0] ?? '') && p.length === 1) {
      if (p[0] === 'presentation') return json(await presentationService(db).read())
      const c = community(db)
      return json(p[0] === 'content' ? await c.posts() : await c.settings())
    }

    /**
     * 29-13: 업체 찾기와 업체 상세는 **로그인 없이** 연다 (명세 4절).
     *
     * 질문 작성·상담 시작·작업 요청에서 로그인을 묻는다. 둘러보는 사람에게 먼저 로그인을 요구하면
     * 아무도 업체를 볼 수 없고, 업체 페이지는 원래 공개하려고 만드는 것이다.
     *
     * 여기서 나가는 것은 승인된 업체와 공개된 사례뿐이다 — 그 판단은 `community`가 한다.
     */
    if (req.method === 'GET' && p[0] === 'companies' && p.length === 1) {
      const c = community(db)
      return json(
        await c.companies({
          region: req.query['region'] ?? '',
          workItem: req.query['work'] ?? '',
          q: req.query['q'] ?? '',
          offset: Number(req.query['offset'] ?? 0),
        }),
      )
    }
    // 화면이 부르는 주소 그대로다(`company/<id>`) — v17 화면을 고치지 않는 것이 29-1부터의 규칙이다.
    // 로그인한 사람도 이 가지로 온다. 같은 자료이고, 공개 페이지에 정지 여부를 물을 일이 없다.
    if (req.method === 'GET' && p[0] === 'company' && p[1] !== undefined && p.length === 2) {
      return json(await community(db).company(null, p[1]))
    }
    // 29-14: 업체의 공개 질문. 다음 손님이 같은 것을 묻지 않게 하려고 공개하는 것이라 로그인이 없다.
    if (req.method === 'GET' && p[0] === 'company' && p[1] !== undefined && p[2] === 'questions') {
      return json(await community(db).questions(p[1]))
    }
    // 29-15: 업체가 꾸민 공개본. 손님이 보는 것이므로 로그인이 없다.
    if (req.method === 'GET' && p[0] === 'company' && p[1] !== undefined && p[2] === 'page') {
      return json(await community(db).publishedPage(p[1]))
    }

    // 29-30: 작업사례 사진. 업체 상세가 로그인 없이 열리므로(29-13) 게시된 사례의 사진도 로그인 없이 연다.
    // 로그인이 있으면 본인·관리자 규칙이 더해진다 — 누구인지는 있으면 쓰고, 없어도 거절하지 않는다.
    if (req.method === 'GET' && p[0] === 'portfolio-photo' && p[1] !== undefined && p.length === 2) {
      const store = storageFor(env)
      if (store === null) return noBucket()
      const viewer = await sessionOf(pool, DEFAULT_WORKSPACE, tokenOf(req.headers, req.method))
      const u = viewer === null ? null : await identityOf(marketplace(db), db, viewer)
      return fileResponse(await media(db, store).openPortfolioPhoto(u, p[1]))
    }

    // 결제사 → 서버 웹훅. 브라우저 신원도 Origin도 쓰지 않는다(원본 주석 그대로: 공급자 재조회로 검증한다)
    if (req.method === 'POST' && p[0] === 'payment-webhook' && p.length === 1) {
      return json(await trade(db, env as unknown as PaymentConfig).paymentWebhook(req.body))
    }

    const session = await sessionOf(pool, DEFAULT_WORKSPACE, tokenOf(req.headers, req.method))
    if (session === null) return json({ error: '로그인이 필요합니다.' }, 401)

    const svc = marketplace(db)
    const txn = trade(db, env as unknown as PaymentConfig)
    const social = community(db)
    const space = workspaceService(db)
    // 29-23: 서류는 파일 저장소가 있어야 다룬다. 없으면 조용히 비우지 않고 아래에서 말한다.
    const store = storageFor(env)
    const docs = store === null ? null : partnerDocuments(db, store)
    // 29-30: 사진도 같은 저장소 위에서 다룬다. 없으면 같은 503 이다 — 29-5 부터 화면이 아는 말이다.
    const photos = store === null ? null : media(db, store)
    const u = await identityOf(svc, db, session)
    const q = (k: string): string => req.query[k] ?? ''

    if (req.method === 'GET') {
      // 29-30: 주문 사진. 화면의 <img src="/api/photos/:id"> 가 쿠키(29-29)로 여기 온다.
      if (p[0] === 'photos' && p[1] !== undefined && p.length === 2) {
        if (photos === null) return noBucket()
        return fileResponse(await photos.openOrderPhoto(u, p[1]))
      }
      // 29-30: 상담 실시간 스트림(SSE). v17 의 `chatStream` 그대로 — 2초마다 다시 읽고 28초에 닫아 브라우저가 다시 잇게 한다.
      if (p[0] === 'orders' && p[1] !== undefined && p[2] === 'chat-stream') {
        const signal = req.signal ?? new AbortController().signal
        return { status: 200, body: null, raw: await chatStream(db, u, p[1], q('partnerId'), signal) }
      }
      if (p[0] === 'inbox') return json(await space.threads(u, q('q')))
      if (p[0] === 'search') return json(await space.search(u, q('q'), q('kind') || 'all', Number(q('offset') || 0)))
      if (p[0] === 'calendar') return json(await space.calendar(u, q('from'), q('to')))
      if (p[0] === 'company' && p[1] !== undefined) return json(await social.company(u, p[1]))
      if (p[0] === 'portfolio' && p[1] === undefined) return json(await social.mine(u))
      if (p[0] === 'questions' && p[1] === undefined) return json(await social.inbox(u))
      if (p[0] === 'page' && p[1] === undefined) return json(await social.pageDraft(u))
      // 29-16: 거래 전 상담. 주문이 없어도 대화한다 — 거래 메시지(`orders/:id/chat`)는 그대로다.
      if (p[0] === 'consultations' && p[1] === undefined) return json(await social.consultations(u))
      if (p[0] === 'consultations' && p[1] !== undefined) return json(await social.consultMessages(u, p[1]))
      if (p[0] === 'review' && p[1] !== undefined) return json(await social.review(u, p[1]))
      if (p[0] === 'admin' && p[1] === 'metrics') return json(await social.metrics(u))
      if (p[0] === 'admin' && p[1] === 'content') return json(await social.posts(u))
      if (p[0] === 'admin' && p[1] === 'reviews') return json(await social.reviewList(u))
      if (p[0] === 'me') return json(await svc.me(u))
      if (p[0] === 'draft') return json(await svc.draft(u))
      if (p[0] === 'notifications') return json(await txn.notifications(u))
      if (p[0] === 'settlements' || p[0] === 'disputes') return json(await txn.ledger(u, p[0]))
      if (p[0] === 'orders' && p[1] !== undefined && p[2] === 'trade') return json(await txn.detail(u, p[1]))
      if (p[0] === 'orders' && p[1] !== undefined && p[2] === 'chat') {
        const before = Number(q('before') || SEQ_MAX)
        return json(await txn.chat(u, p[1], q('partnerId'), before))
      }
      if (p[0] === 'orders') {
        // 관리자가 주문 목록을 볼 때 보관 기간이 지난 사진을 함께 지운다 — 서류(29-23)와 같은 자리, 같은 이유
        if (p[1] === undefined && u.role === 'ADMIN' && photos !== null) await photos.purgeExpired()
        return json(p[1] !== undefined ? await svc.detail(u, p[1]) : await svc.orders(u, q('scope') || 'customer'))
      }
      if (p[0] === 'partners') return json(await svc.partners(u))
      // 29-23: 사업자 확인 서류. 목록은 어디에 있는지도 주지 않는다 — 종류·크기·시각뿐이다.
      if (p[0] === 'partner-documents') {
        if (docs === null) return noBucket()
        // 관리자가 목록을 볼 때 보관 기간이 지난 것을 함께 지운다 — 파기를 사람 기억에 맡기지 않는다
        if (u.role === 'ADMIN') await docs.purgeExpired()
        return json(await docs.list(u, p[1] ?? u.id))
      }
      if (p[0] === 'partner-document' && p[1] !== undefined) {
        if (docs === null) return noBucket()
        const f = await docs.open(u, p[1])
        // 저장소 주소를 브라우저에 주지 않는다. 바이트가 우리 서버를 거쳐 나간다.
        return json({ mime: f.mime, label: f.label, base64: Buffer.from(f.bytes).toString('base64') })
      }
      if (p[0] === 'audit-logs') return json(await svc.logs(u))
    } else if (req.method === 'POST') {
      // v17과 같은 CSRF 방어: 같은 출처에서 온 요청만 쓴다
      const origin = req.headers['origin']
      const host = req.headers['host']
      if (origin === undefined || host === undefined || new URL(origin).host !== host) {
        return json({ error: '요청 출처를 확인할 수 없습니다.' }, 403)
      }
      await svc.rate(u)
      const d = req.body

      if (p[0] === 'inbox' && p[1] === 'read') return json(await space.read(u, d))
      if (p[0] === 'calendar')
        return json(p[1] === 'delete' ? await space.deleteEvent(u, d) : await space.saveEvent(u, d))
      if (p[0] === 'portfolio') return json(p[1] === 'about' ? await social.about(u, d) : await social.saveCase(u, d))
      if (p[0] === 'review' && p[1] !== undefined) {
        return json(p[2] === 'reply' ? await social.reply(u, p[1], d) : await social.writeReview(u, p[1], d))
      }
      if (p[0] === 'company' && p[1] !== undefined && p[2] === 'questions') {
        return json(await social.ask(u, p[1], d), 201)
      }
      if (p[0] === 'questions' && p[1] !== undefined && p[2] === 'answer') {
        return json(await social.answer(u, p[1], d))
      }
      if (p[0] === 'admin' && p[1] === 'questions') return json(await social.hideQuestion(u, d))
      if (p[0] === 'page' && p[1] === 'publish') return json(await social.publishPage(u, d))
      if (p[0] === 'page' && p[1] === undefined) return json(await social.savePage(u, d))
      if (p[0] === 'company' && p[1] !== undefined && p[2] === 'consult') {
        return json(await social.openConsultation(u, p[1], d))
      }
      if (p[0] === 'consultations' && p[1] !== undefined && p[2] === 'messages') {
        return json(await social.sendConsult(u, p[1], d))
      }
      if (p[0] === 'admin' && p[1] === 'content') return json(await social.savePost(u, d))
      if (p[0] === 'admin' && p[1] === 'reviews') return json(await social.moderate(u, d))
      if (p[0] === 'admin' && p[1] === 'presentation') return json(await presentationService(db).save(u, d))
      if (p[0] === 'admin' && p[1] === 'settings') return json(await social.saveSettings(u, d))
      if (p[0] === 'draft') return json(p[1] === 'discard' ? await svc.discardDraft(u, d) : await svc.saveDraft(u, d))
      if (p[0] === 'notifications') return json(await txn.readNotification(u, d))
      // 29-30: 사진 올리기. `?purpose=evidence` 는 거래 증빙(고객·선택된 파트너), 없으면 접수 사진(고객)
      if (p[0] === 'orders' && p[1] !== undefined && p[2] === 'photos' && p.length === 3) {
        if (photos === null) return noBucket()
        const purpose = q('purpose') === 'evidence' ? 'evidence' : 'intake'
        return json(await photos.uploadOrderPhoto(u, p[1], purpose, bytesOf(req)), 201)
      }
      if (p[0] === 'portfolio-photo' && p.length === 1) {
        if (photos === null) return noBucket()
        return json(await photos.uploadPortfolioPhoto(u, bytesOf(req), req.headers[PUBLICATION_CONSENT_HEADER]), 201)
      }
      if (p[0] === 'orders' && p[1] !== undefined && p[2] === 'trade' && p[3] !== undefined) {
        const action = TRADE_ACTIONS[p[3]]
        if (action !== undefined) return json(await action(txn)(u, p[1], d))
      }
      if (p[0] === 'orders' && p[1] !== undefined && p[2] === 'chat') return json(await txn.send(u, p[1], d))
      if (p[0] === 'partners' && p[1] === undefined) return json(await svc.registerPartner(u, d))
      if (p[0] === 'partner-documents' && p[1] === undefined) {
        if (docs === null) return noBucket()
        return json(await docs.submit(u, d))
      }
      if (p[0] === 'partners' && p[1] !== undefined && p[2] === 'approve') return json(await svc.approve(u, p[1], d))
      if (p[0] === 'orders' && p[1] === undefined) {
        return json(await svc.createOrder(u, d, req.headers['idempotency-key']), 201)
      }
      if (p[0] === 'orders' && p[1] !== undefined) {
        if (p[2] === 'bids') return json(await svc.bid(u, p[1], d))
        if (p[2] === 'review') return json(await svc.review(u, p[1], d))
        if (p[2] === 'route') return json(await svc.route(u, p[1], d))
        if (p[2] === 'select') return json(await svc.select(u, p[1], d))
        if (p[2] === 'cancel') return json(await svc.cancel(u, p[1], d))
      }
    }
    return json({ error: '지원하지 않는 요청입니다.' }, 404)
  } catch (e) {
    return errorResponse(e)
  }
}

/**
 * 거래 동작 표 — v17 route.ts의 `actions` 그대로다. 이름을 여기 한 번만 적어 두면
 * 화면이 부르는 이름과 도메인 메서드가 어긋났을 때 이 표만 보면 된다.
 */
type Txn = ReturnType<typeof trade>
type TradeAction = (u: Parameters<Txn['start']>[0], id: string, d: unknown) => Promise<unknown>
const TRADE_ACTIONS: Record<string, (t: Txn) => TradeAction> = {
  terms: (t) => t.terms.bind(t),
  contract: (t) => t.proposeContract.bind(t),
  'contract-decision': (t) => t.decideContract.bind(t),
  schedule: (t) => t.proposeSchedule.bind(t),
  'schedule-decision': (t) => t.decideSchedule.bind(t),
  extra: (t) => t.extra.bind(t),
  'extra-decision': (t) => t.decideExtra.bind(t),
  start: (t) => t.start.bind(t),
  complete: (t) => t.complete.bind(t),
  'completion-decision': (t) => t.confirmCompletion.bind(t),
  payment: (t) => t.preparePayment.bind(t),
  'payment-confirm': (t) => t.confirmPayment.bind(t),
  'payment-sync': (t) => t.reconcile.bind(t),
  dispute: (t) => t.openDispute.bind(t),
  resolve: (t) => t.resolve.bind(t),
  refund: (t) => t.refund.bind(t),
  settlement: (t) => t.settlement.bind(t),
  cancel: (t) => t.cancel.bind(t),
}
