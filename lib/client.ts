import { authHeader } from './session'

/**
 * 마켓플레이스 API 호출 (v17 원본). 29-6에서 **인증 헤더만** 더했다 — 우리 서버는 `Authorization:
 * Bearer <토큰>`으로 세션을 읽는데(`server/session.ts`), v17은 ChatGPT 헤더로 로그인해서 이 자리가
 * 비어 있었다. 그래서 새 셸의 모든 요청이 로그인되지 않은 채 나갔다. 자세한 경위는 `lib/session.ts`.
 */
export async function api<T>(path: string, data?: unknown, idempotencyKey?: string): Promise<T> {
  const response = await fetch(
    '/api/' + path,
    data === undefined
      ? { cache: 'no-store', headers: { ...authHeader() } }
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeader(),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: JSON.stringify(data),
        },
  )
  const result = await response.json()
  if (!response.ok) throw Error((result as { error?: string }).error ?? '요청을 처리하지 못했습니다.')
  return result as T
}

/**
 * 파일 바이트를 그대로 올린다 (29-25).
 *
 * `api()`는 JSON만 보낸다. 사진은 바이트로 가야 해서 화면마다 `fetch`를 직접 부르고 있었는데,
 * **세 자리 모두 인증 헤더를 빠뜨렸다.** 29-6이 `api()`에 헤더를 더할 때 이 세 자리는 `api()`를
 * 쓰지 않아 함께 고쳐지지 않았고, 그 뒤로 사진 업로드는 전부 로그인되지 않은 채 나갔다.
 *
 * 바이트를 올리는 자리를 하나로 모은다 — 다음에 헤더가 하나 더 필요해져도 한 곳만 고치면 된다.
 */
export async function upload<T>(path: string, file: File, extra: Record<string, string> = {}): Promise<T> {
  const response = await fetch('/api/' + path, {
    method: 'POST',
    headers: { 'Content-Type': file.type, ...authHeader(), ...extra },
    body: file,
  })
  const result = await response.json()
  if (!response.ok) throw Error((result as { error?: string }).error ?? '사진을 저장하지 못했습니다.')
  return result as T
}

export const won = (v: number) => new Intl.NumberFormat('ko-KR').format(v) + '원'
export const formatDate = (v: string) =>
  new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(v))
