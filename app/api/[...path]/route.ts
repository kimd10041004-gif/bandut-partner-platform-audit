/**
 * 마켓플레이스 API (29-3).
 *
 * v17 화면은 `lib/client.ts`의 `api(path)` 하나로 `/api/<path>`를 부른다. 그래서 여기에 **v17과 같은 자리**로
 * 붙였다 — 화면 코드를 한 줄도 고치지 않아야 원본과 대조할 수 있기 때문이다(29-1부터의 규칙).
 *
 * 우리 것인 `/api/auth`·`/api/payments`는 형제 폴더에 정적 세그먼트로 있고, Next.js는 catch-all보다 그쪽을
 * 먼저 고른다. 29-2의 `/api/mp` 접두사는 옛 SPA의 정확 경로 라우터를 피하려던 것이라 이제 필요 없다.
 */
import { getPool } from '@/server/db'
import { handleMarketplace } from '@/server/marketplaceApi'
import { ensureSchemaFor } from '@/server/schemaBootstrap'
import { resolveDatabaseUrl } from '@/server/databaseUrl'
import { wantsJsonBody } from '@/server/requestBody'
import { MAX_PHOTO_BYTES } from '@/lib/media'

export const dynamic = 'force-dynamic'
/**
 * 29-30: 상담 스트림(SSE)이 한 연결을 최대 28초 연다(`lib/chat-stream.ts`). 기본 상한(10초)이면 그 전에 끊겨
 * 화면이 "다시 연결 중"을 반복한다. 60초는 Hobby 요금제에서도 허용되는 값이다.
 */
export const maxDuration = 60

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  await ensureSchemaFor(resolveDatabaseUrl(process.env))
  const { path } = await ctx.params
  const url = new URL(req.url)
  const headers: Record<string, string | undefined> = {}
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v
  })
  const query: Record<string, string | undefined> = {}
  url.searchParams.forEach((v, k) => {
    query[k] = v
  })
  let body: unknown = null
  let bytes: Uint8Array | undefined
  // 29-25: 사진은 파일 바이트로 온다. 그것까지 JSON으로 읽으면 언제나 실패하고, 사용자는
  // 저장소가 연결되지 않았다는 진짜 이유 대신 "요청 내용을 확인해 주세요"를 받는다.
  if (req.method === 'POST' && wantsJsonBody(headers['content-type'])) {
    const raw = await req.text()
    if (raw !== '') {
      try {
        body = JSON.parse(raw)
      } catch {
        return Response.json({ error: '요청 내용을 확인해 주세요.' }, { status: 400 })
      }
    }
  } else if (req.method === 'POST') {
    // 29-30: JSON 이 아닌 본문은 사진 바이트다. 상한을 **읽기 전에** 헤더로 한 번, 읽은 뒤 길이로 한 번 건다 —
    // 헤더는 거짓말할 수 있고, 다 읽고 나서 재면 이미 메모리에 올라온 뒤다.
    const declared = Number(headers['content-length'] ?? 0)
    if (declared > MAX_PHOTO_BYTES) return tooLarge()
    const buf = new Uint8Array(await req.arrayBuffer())
    if (buf.byteLength > MAX_PHOTO_BYTES) return tooLarge()
    bytes = buf
  }
  const out = await handleMarketplace(
    { method: req.method, path, headers, query, body, ...(bytes === undefined ? {} : { bytes }), signal: req.signal },
    getPool(resolveDatabaseUrl(process.env) ?? ''),
    process.env,
  )
  // 29-30: 사진 바이트와 SSE 는 JSON 이 아니다 — 핸들러가 만든 응답을 그대로 내보낸다
  if (out.raw !== undefined) return out.raw
  return Response.json(out.body, { status: out.status, headers: out.headers ?? { 'cache-control': 'no-store' } })
}

function tooLarge(): Response {
  return Response.json(
    { error: `사진은 ${Math.floor(MAX_PHOTO_BYTES / 1024 / 1024)}MB 이하만 올릴 수 있습니다.` },
    { status: 413 },
  )
}

export const GET = handle
export const POST = handle
