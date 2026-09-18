import type { HeadResult, ReadResult, SnapshotPort, SnapshotRecord, WriteResult } from '../ports'

/**
 * HTTP 어댑터 (28-68) — `api/snapshot.ts`에 붙는다.
 *
 * 28-67이 놓은 경계의 반대편을 실제로 채우는 구현이다. 계약 테스트
 * (`ports.contract.test.ts`)의 배열에 **한 줄 추가**로 들어가고,
 * 로컬 어댑터와 같은 스위트를 통과한다 — "로컬에서는 되는데 서버에서는 다르다"를 거기서 잡는다.
 *
 * **던지지 않는다.** `fetch`의 네트워크 오류·타임아웃·JSON 파싱 실패를 전부 결과값으로 옮긴다
 * (28-67-04의 계약). 복제기가 try/catch가 아니라 분기로 다룰 수 있어야 한다.
 *
 * **재시도 여부를 상태 코드로 가른다 (28-68-03).** 28-68은 non-200을 전부 `unavailable`로 접어서
 * 401(토큰이 낡음)·413(본문이 너무 큼)이 "오프라인"으로 보였고 30초마다 영원히 다시 보냈다.
 * 4xx는 저장소가 **거부**한 것이라 같은 요청을 다시 보내도 결과가 같다 → `rejected`.
 * 408·429·5xx·네트워크 오류는 시간이 해결할 수 있다 → `unavailable`.
 *
 * **토큰은 함수로도 받는다 (28-70).** 세션 토큰은 로그인·로그아웃으로 바뀌므로 포트를 다시 만들지 않고
 * 매 요청 때 읽는다. 토큰이 없으면(로그아웃) 요청을 보내지 않고 `rejected 401`을 돌려준다 —
 * 서버에 갔다 와도 결과는 같다.
 */
export class HttpSnapshotPort implements SnapshotPort {
  readonly name: string

  constructor(
    /** API 주소 (예: `/api/snapshot` 또는 `http://127.0.0.1:3001/api/snapshot`) */
    private readonly baseUrl: string,
    /** `Authorization: Bearer <token>` — 문자열이거나, 매 요청 때 읽는 함수(null이면 로그아웃 상태) */
    private readonly token: string | (() => string | null),
    private readonly workspaceId: string,
    /** 요청 상한(ms) — 응답이 없는 서버에 매달리지 않는다 */
    private readonly timeoutMs: number = 15_000,
  ) {
    this.name = `http:${workspaceId}`
  }

  /** 28-68 기록: baseUrl에 이미 `?`가 있어도 깨지지 않게 URL 객체로 조립한다 */
  private url(): string {
    const relative = !/^[a-z]+:\/\//i.test(this.baseUrl)
    const u = new URL(this.baseUrl, relative ? 'http://relative.invalid' : undefined)
    u.searchParams.set('workspace', this.workspaceId)
    return relative ? `${u.pathname}${u.search}` : u.toString()
  }

  private currentToken(): string | null {
    return typeof this.token === 'function' ? this.token() : this.token
  }

  private headers(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  }

  /** fetch 한 번 — 네트워크 오류·타임아웃을 결과값으로 정규화한다 */
  private async send(
    init: RequestInit,
    extraQuery?: Record<string, string>,
  ): Promise<{ ok: true; status: number; json: unknown } | { ok: false; detail: string }> {
    const token = this.currentToken()
    // 토큰이 없으면 서버가 401을 줄 것이 확실하다 — 왕복 없이 같은 답을 낸다 (28-70)
    if (token === null || token === '') return { ok: true, status: 401, json: { error: '로그인이 필요합니다' } }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let url = this.url()
      for (const [k, v] of Object.entries(extraQuery ?? {})) url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`
      const res = await fetch(url, { ...init, headers: this.headers(token), signal: controller.signal })
      const text = await res.text()
      let json: unknown = null
      if (text !== '') {
        try {
          json = JSON.parse(text)
        } catch {
          // 본문이 JSON이 아니다 — 플랫폼(프록시·Vercel)이 대신 답한 것. 상태 코드로 판정한다
          json = null
        }
      }
      return { ok: true, status: res.status, json }
    } catch (err) {
      // AbortError·네트워크 오류 — 둘 다 "지금은 닿을 수 없다"다
      const detail = err instanceof Error && err.message ? err.message : String(err)
      return { ok: false, detail }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 28-69-01: `GET …&head=1` — 서버가 rev만 돌려준다 */
  async head(): Promise<HeadResult> {
    const res = await this.send({ method: 'GET' }, { head: '1' })
    if (!res.ok) return { ok: false, reason: 'unavailable', detail: res.detail }
    if (res.status !== 200) return failureOf(res.status, res.json)
    const obj = asObject(res.json)
    if (obj === null || !('rev' in obj))
      return { ok: false, reason: 'unavailable', detail: '서버 응답에 rev가 없습니다' }
    const rev = obj['rev']
    if (rev === null) return { ok: true, rev: null }
    if (typeof rev !== 'number')
      return { ok: false, reason: 'unavailable', detail: '서버 응답의 rev 모양이 올바르지 않습니다' }
    return { ok: true, rev }
  }

  async read(): Promise<ReadResult> {
    const res = await this.send({ method: 'GET' })
    if (!res.ok) return { ok: false, reason: 'unavailable', detail: res.detail }
    if (res.status !== 200) return failureOf(res.status, res.json)
    const obj = asObject(res.json)
    const raw = obj?.['record']
    if (raw === null) return { ok: true, record: null }
    const record = recordOf(raw)
    // 모양이 어긋난 응답을 "비어 있다"로 삼지 않는다
    if (record === null)
      return { ok: false, reason: 'unavailable', detail: '서버 응답의 스냅샷 모양이 올바르지 않습니다' }
    return { ok: true, record }
  }

  async write(body: string, expectedRev: number | null): Promise<WriteResult> {
    const res = await this.send({ method: 'PUT', body: JSON.stringify({ body, expectedRev }) })
    if (!res.ok) return { ok: false, reason: 'unavailable', detail: res.detail }
    const obj = asObject(res.json)
    if (res.status === 200) {
      const rev = obj?.['rev']
      if (typeof rev !== 'number')
        return { ok: false, reason: 'unavailable', detail: '서버가 rev를 돌려주지 않았습니다' }
      return { ok: true, rev }
    }
    if (res.status === 409) {
      // 28-67-02c: 원격이 비어 있으면 센티널이 아니라 null이다
      return { ok: false, reason: 'conflict', remote: recordOf(obj?.['remote']) }
    }
    return failureOf(res.status, res.json)
  }
}

/** 재시도해도 소용없는 상태 코드 — 저장소가 거부한 것이다 */
const REJECTED_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422])

function failureOf(
  status: number,
  json: unknown,
):
  | { ok: false; reason: 'rejected'; status: number; detail: string }
  | { ok: false; reason: 'unavailable'; detail: string } {
  const detail = errorDetail(json, status)
  if (REJECTED_STATUSES.has(status)) return { ok: false, reason: 'rejected', status, detail }
  return { ok: false, reason: 'unavailable', detail }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
}

/** 서버가 준 값이 SnapshotRecord 모양일 때만 그것을 준다 — 아니면 null */
function recordOf(v: unknown): SnapshotRecord | null {
  const o = asObject(v)
  if (o === null) return null
  const rev = o['rev']
  const body = o['body']
  if (typeof rev !== 'number' || typeof body !== 'string') return null
  return { rev, body }
}

function errorDetail(json: unknown, status: number): string {
  const msg = asObject(json)?.['error']
  return typeof msg === 'string' && msg !== '' ? msg : `서버 오류 (HTTP ${status})`
}
