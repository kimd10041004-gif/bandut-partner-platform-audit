import { isAdminGrade } from '../../../server/domain/adminGrade'
import type { AccountView, AuthSession, AdminAccountView } from '../../../server/domain/auth'

/**
 * 계정·세션 API 클라이언트 (28-70) — `api/auth.ts`에 붙는다.
 *
 * `HttpSnapshotPort`와 같은 규약: **던지지 않는다.** 네트워크 오류·타임아웃·JSON 파싱 실패·비정상 모양을
 * 전부 결과값으로 옮긴다. 도메인 규칙 위반(422)은 `error`에 서버가 준 문구가 그대로 온다 — 그 문구는
 * 클라이언트의 `AuthService`가 냈을 것과 같은 문구다(같은 클래스가 돌기 때문).
 */
export type AuthCallResult =
  | {
      ok: true
      result: unknown
      token?: string
      session?: AuthSession
      mirror?: { accounts: AccountView[]; complete: boolean; admins?: AdminAccountView[] }
    }
  | { ok: false; status: number; error: string }

export class HttpAuthClient {
  constructor(
    private readonly baseUrl: string = '/api/auth',
    private readonly timeoutMs: number = 15_000,
  ) {}

  async call(op: string, args: unknown[], token: string | null): Promise<AuthCallResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token !== null && token !== '') headers['authorization'] = `Bearer ${token}`
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ op, args }),
        signal: controller.signal,
      })
      const text = await res.text()
      let json: unknown = null
      try {
        json = text === '' ? null : JSON.parse(text)
      } catch {
        json = null
      }
      const obj = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null
      if (res.status !== 200 || obj === null || obj['ok'] !== true) {
        const msg =
          obj !== null && typeof obj['error'] === 'string' && obj['error'] !== ''
            ? obj['error']
            : `서버 오류 (HTTP ${res.status})`
        return { ok: false, status: res.status, error: msg }
      }
      const out: AuthCallResult = { ok: true, result: obj['result'] }
      if (typeof obj['token'] === 'string') out.token = obj['token']
      const session = sessionOf(obj['session'])
      if (session !== null) out.session = session
      const mirror = mirrorOf(obj['mirror'])
      if (mirror !== null) out.mirror = mirror
      return out
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : String(err)
      return { ok: false, status: 0, error: `서버에 닿을 수 없습니다 — ${detail}` }
    } finally {
      clearTimeout(timer)
    }
  }
}

function sessionOf(v: unknown): AuthSession | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const role = o['role']
  if (role !== 'customer' && role !== 'partner' && role !== 'admin') return null
  if (
    typeof o['name'] !== 'string' ||
    typeof o['accountId'] !== 'string' ||
    typeof o['issuedAt'] !== 'string' ||
    typeof o['expiresAt'] !== 'string'
  )
    return null
  // 28-89-A: 관리자 세션의 등급 — 서버가 준 값만 믿는다(모양만 본다)
  const grade = o['grade']
  return {
    role,
    name: o['name'],
    accountId: o['accountId'],
    issuedAt: o['issuedAt'],
    expiresAt: o['expiresAt'],
    ...(isAdminGrade(grade) ? { grade } : {}),
  }
}

function mirrorOf(v: unknown): { accounts: AccountView[]; complete: boolean; admins?: AdminAccountView[] } | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o['accounts'])) return null
  // 계정 뷰의 상세 검증은 거울(AuthService.load)이 다음 로드 때 한다 — 여기서는 모양만 본다
  const accounts = (o['accounts'] as unknown[]).filter(
    (a): a is AccountView => typeof a === 'object' && a !== null && typeof (a as AccountView).id === 'string',
  )
  // 28-89-A: 관리자 목록(해시 없음). 없으면 거울을 건드리지 않는다
  const admins = Array.isArray(o['admins'])
    ? (o['admins'] as unknown[]).filter(
        (a): a is AdminAccountView =>
          typeof a === 'object' &&
          a !== null &&
          typeof (a as AdminAccountView).id === 'string' &&
          isAdminGrade((a as AdminAccountView).grade),
      )
    : undefined
  return { accounts, complete: o['complete'] === true, ...(admins !== undefined ? { admins } : {}) }
}
