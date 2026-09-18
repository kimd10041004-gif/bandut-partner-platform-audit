import type { Database, User, Photo } from './model'
import { fail } from './errors'
import { cleanImage } from './photos'
import { marketplace } from './service'
import { community } from './community'

/**
 * 사진 — 주문 사진(접수·증빙)과 작업사례 사진 (29-30).
 *
 * ## 왜 이 파일인가
 *
 * v17 의 `route.ts` 는 사진 바이트를 Cloudflare R2(`env.BUCKET`)에 직접 넣고 꺼냈다. 29-2 에서 그 결합을
 * 뜯어낼 때 저장소가 없어 503 으로 막아 두었고(`needsBucket`), 29-23 이 파일 저장소 포트(`server/storage.ts`)를
 * 만들었지만 서류에만 썼다. 이 파일이 그 포트 위에 **사진**을 올린다.
 *
 * 권한은 새로 만들지 않는다. 도메인에 이미 있는 판단을 부른다:
 *
 * | 무엇 | 누가 | 판단하는 곳 |
 * |---|---|---|
 * | 접수 사진 올리기 | 주문 고객, 접수·모집 중일 때 | `marketplace.photoPermission(u, id, true)` |
 * | 증빙 사진 올리기 | 고객 또는 **선택된** 파트너, 거래가 살아 있을 때 | 여기 (`tradeParty`) |
 * | 주문 사진 보기 | 고객·관리자·선택된 파트너 (주소가 보이는 사람) | `marketplace.photoPermission(u, id, false)` |
 * | 작업사례 사진 올리기 | 승인된 파트너, 공개 동의 헤더와 함께 | `community.uploadPermission` |
 * | 작업사례 사진 보기 | 본인·관리자, 또는 **게시된 사례에 쓰였으면 누구나**(로그인 없이) | `community.assetPermission` + 여기 |
 *
 * ## 바이트는 씻어서 넣는다
 *
 * `cleanImage` 가 JPEG·PNG 만 받고 메타데이터(EXIF — 위치·기기)를 벗긴다. 그래서 파트너에게 가는 사진에
 * 고객 집의 좌표가 실려 가지 않는다. SVG 는 받지 않는다 — 스크립트를 품을 수 있다.
 *
 * ## 표에는 자리만 남는다
 *
 * `photos.object_key` 가 저장소 안의 자리다. 바이트는 표에 오지 않는다(서류와 같은 이유). 보관 기간이 지난
 * 사진은 `purgeExpired` 가 저장소와 표에서 **둘 다** 지운다 — 관리자가 주문 목록을 열 때 같이 돈다.
 */

export interface MediaStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<unknown>
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>
  remove(key: string): Promise<void>
}

/** 한 장 상한. 화면도 같은 값으로 먼저 막는다(`request.tsx`·`trade.tsx`·포트폴리오) */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
/** 주문 사진 보관 기간. 분쟁·보증 확인에 쓰이므로 정산 뒤에도 한 해는 남긴다 */
export const PHOTO_TTL_DAYS = 365
/** 한 주문에 남길 수 있는 장수 — 표의 `photo_limit` 트리거와 같은 값. 트리거보다 먼저 사람 말로 거절한다 */
export const MAX_PHOTOS_PER_ORDER = 60
/** 작업사례 사진을 올릴 때 화면이 보내는 동의 표식 — 없으면 받지 않는다 (v17 화면 그대로) */
export const PUBLICATION_CONSENT_HEADER = 'x-publication-consent'

export type PhotoPurpose = 'intake' | 'evidence'

export interface StoredPhoto {
  id: string
  mime: string
}

export interface OpenedPhoto {
  bytes: Uint8Array
  mime: string
  /** 로그인 없이도 볼 수 있는 사진인가 — 캐시 정책이 갈린다 */
  isPublic: boolean
}

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 공개된 업체 페이지 설정에서 이 사진을 **커버나 로고로 쓰고 있는가** (29-32).
 *
 * 저장본이 깨졌거나 우리가 모르는 모양이면 `false` — 못 읽는 설정 때문에 남의 사진이 열리는 일은 없다.
 */
export function shownOnPage(publishedConfig: string, assetId: string): boolean {
  try {
    const c: unknown = JSON.parse(publishedConfig)
    if (typeof c !== 'object' || c === null) return false
    const { coverAssetId, logoAssetId } = c as { coverAssetId?: unknown; logoAssetId?: unknown }
    return coverAssetId === assetId || logoAssetId === assetId
  } catch {
    return false
  }
}

export function media(db: Database, store: MediaStore) {
  const stmt = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args)
  const svc = marketplace(db)
  const social = community(db)

  /** 거래의 당사자인가 — 고객, 또는 선택된 파트너(승인된). 관리자는 증빙을 올리지 않는다 */
  async function tradeParty(u: User, orderId: string) {
    if (u.suspended) fail(403, '사용이 제한된 계정입니다.')
    const o = await stmt('SELECT id,customer_id,selected_bid_id,status FROM orders WHERE id=?', orderId).first<{
      id: string
      customer_id: string
      selected_bid_id: string | null
      status: string
    }>()
    if (!o) fail(404, '주문을 찾을 수 없습니다.')
    const owner = o.customer_id === u.id
    const b = o.selected_bid_id
      ? await stmt('SELECT partner_id FROM bids WHERE id=?', o.selected_bid_id).first<{ partner_id: string }>()
      : null
    const partner = u.role === 'PARTNER' && b?.partner_id === u.id
    if (!owner && !partner) fail(403, '거래 참여자만 증빙 사진을 올릴 수 있습니다.')
    if (partner && !(await stmt("SELECT user_id FROM partners WHERE user_id=? AND status='APPROVED'", u.id).first()))
      fail(403, '파트너 승인이 필요합니다.')
    if (['CANCELLED', 'EXPIRED', 'SETTLED', 'DISPUTED'].includes(o.status))
      fail(409, '끝난 거래에는 증빙 사진을 올릴 수 없습니다.')
    return o
  }

  return {
    /**
     * 주문 사진을 올린다. `intake` 는 접수 사진(고객), `evidence` 는 거래 증빙(고객·선택된 파트너).
     * 저장소에 먼저 넣고 표에 적는다 — 표가 먼저면 저장소가 실패했을 때 못 여는 줄이 남는다.
     */
    async uploadOrderPhoto(u: User, orderId: string, purpose: PhotoPurpose, raw: Uint8Array): Promise<StoredPhoto> {
      if (purpose === 'evidence') await tradeParty(u, orderId)
      else await svc.photoPermission(u, orderId, true)
      const count = await stmt('SELECT COUNT(*) n FROM photos WHERE order_id=?', orderId).first<{ n: number }>()
      if (Number(count?.n ?? 0) >= MAX_PHOTOS_PER_ORDER)
        fail(409, `사진은 주문당 ${MAX_PHOTOS_PER_ORDER}장까지 올릴 수 있습니다.`)
      const { bytes, mime } = cleanImage(raw)
      const id = uid()
      const key = `orders/${orderId}/${id}`
      await store.put(key, bytes, mime)
      try {
        await stmt(
          'INSERT INTO photos (id,order_id,owner_id,object_key,mime,created_at,expires_at) VALUES (?,?,?,?,?,?,?)',
          id,
          orderId,
          u.id,
          key,
          mime,
          now(),
          new Date(Date.now() + PHOTO_TTL_DAYS * 86_400_000).toISOString(),
        ).run()
      } catch (e) {
        await store.remove(key).catch(() => {})
        throw e
      }
      return { id, mime }
    },

    /** 주문 사진을 연다. 누가 볼 수 있는지는 주문 상세와 같은 규칙이다(주소가 보이는 사람) */
    async openOrderPhoto(u: User, photoId: string): Promise<OpenedPhoto> {
      if (!uuid.test(photoId)) fail(404, '사진이 없습니다.')
      const p = await stmt('SELECT * FROM photos WHERE id=? AND expires_at>?', photoId, now()).first<Photo>()
      if (!p) fail(404, '사진이 없습니다.')
      await svc.photoPermission(u, p.order_id, false)
      const got = await store.get(p.object_key)
      if (got === null) fail(404, '사진 파일이 저장소에 없습니다.')
      return { bytes: got.bytes, mime: p.mime, isPublic: false }
    },

    /** 작업사례 사진을 올린다. 공개 동의 표식이 없으면 받지 않는다 */
    async uploadPortfolioPhoto(u: User, raw: Uint8Array, consent: string | undefined): Promise<StoredPhoto> {
      if (consent !== 'confirmed') fail(400, '사진의 공개 권한과 고객 동의를 먼저 확인해 주세요.')
      await social.uploadPermission(u)
      const { bytes, mime } = cleanImage(raw)
      const id = uid()
      const key = `portfolio/${u.id}/${id}`
      await store.put(key, bytes, mime)
      try {
        await stmt(
          'INSERT INTO portfolio_assets (id,partner_id,object_key,mime,created_at) VALUES (?,?,?,?,?)',
          id,
          u.id,
          key,
          mime,
          now(),
        ).run()
      } catch (e) {
        await store.remove(key).catch(() => {})
        throw e
      }
      return { id, mime }
    },

    /**
     * 작업사례 사진을 연다. 업체 상세는 로그인 없이 열리므로(29-13) **게시된 사례에 쓰인 사진은 누구나** 본다.
     * 그 밖에는 본인과 관리자뿐이다 — 판단은 `community.assetPermission` 이 한다.
     */
    async openPortfolioPhoto(u: User | null, assetId: string): Promise<OpenedPhoto> {
      if (!uuid.test(assetId)) fail(404, '사진이 없습니다.')
      const published = await stmt(
        "SELECT a.object_key,a.mime FROM portfolio_assets a WHERE a.id=? AND EXISTS(SELECT 1 FROM portfolio_cases c JOIN partners p ON p.user_id=c.partner_id JOIN users x ON x.id=p.user_id WHERE c.asset_id=a.id AND c.published=1 AND p.status='APPROVED' AND x.suspended=0)",
        assetId,
      ).first<{ object_key: string; mime: string }>()
      let target = published
      let isPublic = published !== null

      // 29-32: 커버·로고는 **작업사례에 붙지 않는다.** 공개본 설정(`company_pages.published_config`)의
      // coverAssetId·logoAssetId 로 걸린다. 29-31 은 이 두 번째 공개 경로를 빼먹어, 업체가 공개한
      // 커버를 손님이 403 으로 못 받았다(본인과 관리자만 보였다). 사례와 같은 조건 — 승인된, 정지되지
      // 않은 업체의 **공개된** 설정에 걸린 사진만 — 으로 연다.
      //
      // `published_config` 는 text 라 JSON SQL 함수를 쓰지 않는다. 포트가 Postgres 와 SQLite 양쪽이라
      // 한쪽에만 있는 함수를 쓰면 다른 쪽에서 죽는다. 그래서 **코드에서 파싱**한다.
      if (target === null) {
        const onPage = await stmt(
          "SELECT a.object_key,a.mime,g.published_config FROM portfolio_assets a JOIN partners p ON p.user_id=a.partner_id JOIN users x ON x.id=p.user_id JOIN company_pages g ON g.partner_id=a.partner_id WHERE a.id=? AND g.published_config IS NOT NULL AND p.status='APPROVED' AND x.suspended=0",
          assetId,
        ).first<{ object_key: string; mime: string; published_config: string }>()
        if (onPage !== null && shownOnPage(onPage.published_config, assetId)) {
          target = { object_key: onPage.object_key, mime: onPage.mime }
          isPublic = true
        }
      }

      if (target === null) {
        if (u === null) fail(403, '이 사진을 볼 수 없습니다.')
        const a = await social.assetPermission(u, assetId)
        target = { object_key: a.object_key, mime: a.mime }
        isPublic = false
      }
      const got = await store.get(target.object_key)
      if (got === null) fail(404, '사진 파일이 저장소에 없습니다.')
      return { bytes: got.bytes, mime: target.mime, isPublic }
    },

    /** 보관 기간이 지난 주문 사진을 저장소와 표에서 둘 다 지운다. 저장소를 먼저 — 아무도 모르는 파일을 남기지 않는다 */
    async purgeExpired(at: string = now()) {
      const old =
        (
          await stmt('SELECT id,object_key FROM photos WHERE expires_at<? LIMIT 200', at).all<
            Pick<Photo, 'id' | 'object_key'>
          >()
        ).results ?? []
      for (const p of old) {
        await store.remove(p.object_key)
        await stmt('DELETE FROM photos WHERE id=?', p.id).run()
      }
      return { purged: old.length }
    },
  }
}
