/**
 * Next.js `Request` ↔ 우리 핸들러의 `{method, headers, query, body}` (29-3).
 *
 * 28-68 이후 핸들러를 **순수 함수**로 유지해 온 값이 여기서 나온다: 프레임워크가 바뀌어도 고칠 것은 이 어댑터
 * 하나였다. 핸들러 본체는 한 줄도 안 바뀐다.
 */
export interface HandlerRequest {
  method: string
  headers: Record<string, string | undefined>
  query: Record<string, string | undefined>
  body: unknown
}

export interface HandlerResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

/** 본문 상한 — 옛 api-server의 `MAX_BODY_BYTES`와 같은 이유로, 인증·파싱 **전에** 건다 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

export async function toApiRequest(req: Request): Promise<HandlerRequest> {
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
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE')
    if (raw !== '') {
      try {
        body = JSON.parse(raw)
      } catch {
        body = undefined // 핸들러가 자기 규칙으로 거절하게 둔다
      }
    }
  }
  return { method: req.method, headers, query, body }
}

export function toResponse(out: HandlerResponse): Response {
  return Response.json(out.body, {
    status: out.status,
    headers: { 'cache-control': 'no-store', ...(out.headers ?? {}) },
  })
}
