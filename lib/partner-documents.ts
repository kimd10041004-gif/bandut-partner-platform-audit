import { z } from 'zod'
import type { Database, User } from './model'
import { fail } from './errors'

/**
 * 사업자 파트너의 확인 서류 (29-23).
 *
 * ## 왜 서류인가
 *
 * 29-21 에서 가입 코드를 없앴다. 남은 자물쇠는 **운영자 승인** 하나다. 그런데 승인하는 사람이
 * 볼 것이 지금까지 업체명과 사업자등록번호뿐이었다 — 번호는 체크섬만 맞으면 통과한다.
 *
 * 사업자 파트너는 서류 둘을 낸다.
 *
 * | 종류 | 무엇을 확인하나 |
 * |---|---|
 * | `BUSINESS_LICENSE` 사업자등록증 | 그 번호가 이 사람의 사업자인가 |
 * | `TRAVEL_RECORD` 출입국사실증명서 | 지금 이 나라에서 일할 수 있는 사람인가 |
 *
 * 개인 파트너는 내지 않는다 — 고객과 같은 휴대폰 인증 + 승인이다(사용자 결정).
 *
 * ## 남기는 것과 남기지 않는 것
 *
 * 표에는 **어디에 있는지만** 남는다(`object_key`). 바이트는 파일 저장소에 있고 DB 에 오지
 * 않는다. 백업과 스냅샷에 신분 서류가 섞여 들어가지 않게 하기 위해서다.
 *
 * ## 파기
 *
 * 신분 서류를 영원히 갖고 있을 이유가 없다. 낼 때 파기 예정일을 함께 적고(`expires_at`),
 * 지난 것은 `purgeExpired` 가 저장소와 표에서 **둘 다** 지운다. 한쪽만 지우면 남은 쪽이
 * 거짓말을 한다 — 표에만 남으면 못 여는 줄이 되고, 저장소에만 남으면 아무도 모르는 파일이 된다.
 */

export const DOCUMENT_KINDS = ['BUSINESS_LICENSE', 'TRAVEL_RECORD'] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  BUSINESS_LICENSE: '사업자등록증',
  TRAVEL_RECORD: '출입국사실증명서',
}

/** 보관 기간. 승인 판단에 쓴 뒤에도 분쟁 확인에 필요할 수 있어 반년으로 둔다 */
export const DOCUMENT_TTL_DAYS = 180
/** 한 장 상한. 서류는 스캔본이라 이보다 클 이유가 없다 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
/** 받는 형식. 실행되는 것을 받지 않는다 */
export const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const

export interface PartnerDocument {
  id: string
  partner_id: string
  kind: DocumentKind
  object_key: string
  mime: string
  size: number
  created_at: string
  expires_at: string
}

/** 화면에 나가는 모양 — 저장소 자리(`object_key`)는 빼고 준다 */
export interface DocumentView {
  id: string
  kind: DocumentKind
  label: string
  mime: string
  size: number
  created_at: string
  expires_at: string
}

const view = (d: PartnerDocument): DocumentView => ({
  id: d.id,
  kind: d.kind,
  label: DOCUMENT_LABELS[d.kind] ?? d.kind,
  mime: d.mime,
  size: d.size,
  created_at: d.created_at,
  expires_at: d.expires_at,
})

const submitInput = z
  .object({
    kind: z.enum(DOCUMENT_KINDS),
    mime: z.enum(ALLOWED_MIME),
    /** base64. 우리 API 는 JSON 한 벌이라 바이트를 이렇게 싣는다 */
    base64: z.string().min(4).max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 1024),
  })
  .strict()

export type SubmitInput = z.infer<typeof submitInput>

/** 저장소 안의 자리. 파트너와 종류가 들어가므로 남의 것을 덮을 수 없다 */
export const documentKey = (partnerId: string, kind: DocumentKind): string =>
  `partner-docs/${partnerId.replace(/[^A-Za-z0-9_-]/g, '')}/${kind}`

/** 이 저장소 포트만 있으면 된다 — 여기서 Vercel 을 알지 않는다 */
export interface DocumentStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<unknown>
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>
  remove(key: string): Promise<void>
}

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

function decode(base64: string): Uint8Array {
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
  } catch {
    fail(400, '서류 파일을 읽을 수 없습니다.')
  }
  // Buffer 는 못 읽는 글자를 조용히 버린다 — 빈 결과를 "빈 파일"로 받아들이지 않는다
  if (bytes!.byteLength === 0) fail(400, '서류 파일이 비어 있습니다.')
  if (bytes!.byteLength > MAX_DOCUMENT_BYTES) {
    fail(413, `서류는 ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)}MB 이하만 올릴 수 있습니다.`)
  }
  return bytes!
}

export function partnerDocuments(db: Database, store: DocumentStore) {
  const stmt = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args)
  const rows = async (sql: string, ...args: unknown[]) =>
    (await stmt(sql, ...args).all<PartnerDocument>()).results ?? []

  /** 관리자이거나, 그 파트너 본인이어야 한다 */
  const maySee = (u: User, partnerId: string) => {
    if (u.role === 'ADMIN') return
    if (u.role === 'PARTNER' && u.id === partnerId) return
    fail(403, '이 서류를 볼 권한이 없습니다.')
  }

  return {
    /** 파트너가 자기 서류를 낸다. 같은 종류를 다시 내면 덮는다 */
    async submit(u: User, raw: unknown) {
      if (u.role !== 'PARTNER') fail(403, '파트너만 서류를 제출할 수 있습니다.')
      const i = submitInput.parse(raw)
      const bytes = decode(i.base64)
      const key = documentKey(u.id, i.kind)
      await store.put(key, bytes, i.mime)

      const at = now()
      const expires = new Date(Date.now() + DOCUMENT_TTL_DAYS * 86400000).toISOString()
      // 저장소에 먼저 쓰고 표를 맞춘다. 반대로 하면 표가 없는 파일을 가리킨다
      await stmt('DELETE FROM partner_documents WHERE partner_id=? AND kind=?', u.id, i.kind).run()
      await stmt(
        'INSERT INTO partner_documents (id,partner_id,kind,object_key,mime,size,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',
        uid(),
        u.id,
        i.kind,
        key,
        i.mime,
        bytes.byteLength,
        at,
        expires,
      ).run()
      return { ok: true as const, kind: i.kind, size: bytes.byteLength }
    },

    /** 목록 — 바이트는 주지 않는다 */
    async list(u: User, partnerId: string): Promise<DocumentView[]> {
      maySee(u, partnerId)
      return (await rows('SELECT * FROM partner_documents WHERE partner_id=? ORDER BY kind', partnerId)).map(view)
    },

    /** 한 장을 연다. 바이트는 우리 서버를 거쳐 나간다 — 저장소 주소를 브라우저에 주지 않는다 */
    async open(u: User, id: string) {
      const d = await stmt('SELECT * FROM partner_documents WHERE id=?', id).first<PartnerDocument>()
      if (!d) fail(404, '서류를 찾을 수 없습니다.')
      maySee(u, d!.partner_id)
      const got = await store.get(d!.object_key)
      if (got === null) fail(410, '서류 파일이 저장소에 없습니다. 파트너에게 다시 제출을 요청하세요.')
      return { bytes: got!.bytes, mime: d!.mime, label: DOCUMENT_LABELS[d!.kind] ?? d!.kind }
    },

    /** 사업자 파트너가 아직 안 낸 종류 — 승인 게이트가 이것을 본다 */
    async missing(partnerId: string): Promise<DocumentKind[]> {
      const have = new Set(
        (await rows('SELECT * FROM partner_documents WHERE partner_id=?', partnerId)).map((d) => d.kind),
      )
      return DOCUMENT_KINDS.filter((k) => !have.has(k))
    },

    /**
     * 보관 기간이 지난 것을 저장소와 표에서 둘 다 지운다.
     *
     * 저장소를 먼저 지운다. 표를 먼저 지우면 저장소에 아무도 모르는 파일이 남는다 —
     * 신분 서류에서 그것이 제일 나쁜 결과다.
     */
    async purgeExpired(at: string = now()) {
      const old = await rows('SELECT * FROM partner_documents WHERE expires_at < ?', at)
      for (const d of old) {
        await store.remove(d.object_key)
        await stmt('DELETE FROM partner_documents WHERE id=?', d.id).run()
      }
      return { purged: old.length }
    },
  }
}
