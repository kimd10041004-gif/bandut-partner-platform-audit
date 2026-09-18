/**
 * 세션 토큰 (28-70).
 *
 * 토큰은 서버가 발급하는 불투명한 32바이트 난수다. 저장소에는 **sha256(토큰)**만 있다 —
 * DB가 유출돼도 토큰은 나오지 않는다. 만료는 도메인의 `SESSION_TTL_MS`(역할별), 폐기는 `revoked_at`.
 * `Authorization: Bearer <토큰>`이 `/api/snapshot`·`/api/auth`의 유일한 인증이다 (28-68의 공유 시크릿은 없앴다).
 */
import { createHash, randomBytes } from 'node:crypto'
import type { AuthSession } from './domain/auth'
import type { Queryable } from './db'

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** `Authorization` 헤더에서 Bearer 토큰만 — 없으면 null */
export function bearerOf(headers: Record<string, string | undefined>): string | null {
  const h = headers['authorization']
  if (typeof h !== 'string') return null
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim())
  return m?.[1] ?? null
}

/**
 * 29-29: 세션 쿠키.
 *
 * 29-6 부터 브라우저는 토큰을 localStorage 에 두고 `Authorization` 헤더로 보냈다. 그 방식은 두 가지를 못 한다 —
 * `<img src>` 와 `EventSource` 는 헤더를 못 싣는다(사진이 깨지고 상담 실시간 연결이 401 이 났다). 그리고 XSS 한 건이면
 * 토큰이 통째로 나간다. 그래서 토큰을 **HttpOnly 쿠키**로 내린다. 스크립트는 읽을 수 없고, 같은 출처의 이미지·SSE 는
 * 브라우저가 알아서 싣는다.
 *
 * Bearer 는 그대로 받는다 — 옛 SPA(서버 모드)·테스트·봇이 쓴다. 쿠키는 **쓰기 요청에서는 같은 출처의 증거가 있을 때만**
 * 믿는다(`cookieTrusted`) — 쿠키는 남의 사이트에서 낸 요청에도 실리기 때문이다(CSRF).
 */
export const SESSION_COOKIE = 'bandut_session'

export function cookieOf(headers: Record<string, string | undefined>, name: string = SESSION_COOKIE): string | null {
  const raw = headers['cookie']
  if (typeof raw !== 'string') return null
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() !== name) continue
    const v = part.slice(i + 1).trim()
    return v === '' ? null : v
  }
  return null
}

/**
 * 쿠키로 온 세션을 믿어도 되는 요청인가.
 *
 * 읽기(GET·HEAD)는 언제나 — 이미지·SSE 가 그 길로 온다. 쓰기는 `Origin` 이 우리 호스트와 같거나, 브라우저가
 * `Sec-Fetch-Site: same-origin` 을 붙였을 때만. 둘 다 없는 요청(curl 등)은 쿠키를 무시하고 Bearer 만 본다.
 */
export function cookieTrusted(headers: Record<string, string | undefined>, method: string): boolean {
  if (method === 'GET' || method === 'HEAD') return true
  const host = headers['host'] ?? headers['x-forwarded-host']
  const origin = headers['origin']
  if (typeof origin === 'string') {
    if (typeof host !== 'string') return false
    try {
      return new URL(origin).host === host.split(',')[0]!.trim()
    } catch {
      return false
    }
  }
  return headers['sec-fetch-site'] === 'same-origin'
}

/** 요청의 세션 토큰 — Bearer 가 있으면 그것, 없으면 (믿어도 되는 요청일 때) 쿠키 */
export function tokenOf(headers: Record<string, string | undefined>, method: string = 'GET'): string | null {
  const bearer = bearerOf(headers)
  if (bearer !== null) return bearer
  return cookieTrusted(headers, method) ? cookieOf(headers) : null
}

/** Vercel(프리뷰·운영)은 늘 https 다. 로컬·CI 는 http 라 `Secure` 를 붙이면 브라우저가 쿠키를 버린다 */
export function cookieSecure(env: NodeJS.ProcessEnv): boolean {
  return env['VERCEL_ENV'] !== undefined
}

export function sessionCookie(token: string, expiresAt: string, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

/** 세션 발급 — 토큰 원문을 돌려준다(이 한 번뿐이다) */
export async function issueSession(db: Queryable, workspaceId: string, session: AuthSession): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.query(
    `insert into sessions (token_hash, workspace_id, account_id, role, name, issued_at, expires_at, grade)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      hashToken(token),
      workspaceId,
      session.accountId,
      session.role,
      session.name,
      session.issuedAt,
      session.expiresAt,
      session.grade ?? null,
    ],
  )
  return token
}

/** 살아 있는 세션 — 없거나 만료·폐기됐으면 null */
export async function sessionOf(db: Queryable, workspaceId: string, token: string | null): Promise<AuthSession | null> {
  if (token === null || token === '') return null
  const r = await db.query<{
    account_id: string
    role: AuthSession['role']
    name: string
    issued_at: Date
    expires_at: Date
    grade: AuthSession['grade'] | null
  }>(
    `select account_id, role, name, issued_at, expires_at, grade from sessions
     where token_hash = $1 and workspace_id = $2 and revoked_at is null and expires_at > now()`,
    [hashToken(token), workspaceId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  return {
    role: row.role,
    name: row.name,
    accountId: row.account_id,
    issuedAt: new Date(row.issued_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    // 28-89-A: 관리자 등급. 28-89 이전에 발급된 관리자 세션은 null → 등급 없음 → 아무것도 못 한다(다시 로그인)
    ...(row.grade !== null && row.grade !== undefined ? { grade: row.grade } : {}),
  }
}

export async function revokeToken(db: Queryable, token: string): Promise<void> {
  await db.query('update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [
    hashToken(token),
  ])
}

/** 이 토큰만 남기고 계정의 다른 세션을 폐기 — 비밀번호 변경 때 (29-29 자체 감사 12) */
export async function revokeOthers(
  db: Queryable,
  workspaceId: string,
  accountId: string,
  keepToken: string | null,
): Promise<void> {
  await db.query(
    `update sessions set revoked_at = now()
     where workspace_id = $1 and account_id = $2 and revoked_at is null and token_hash <> $3`,
    [workspaceId, accountId, keepToken === null ? '' : hashToken(keepToken)],
  )
}

/** 계정의 모든 세션 폐기 — 정지·탈퇴·파기 때 */
export async function revokeAccount(db: Queryable, workspaceId: string, accountId: string): Promise<void> {
  await db.query(
    'update sessions set revoked_at = now() where workspace_id = $1 and account_id = $2 and revoked_at is null',
    [workspaceId, accountId],
  )
}

/**
 * 세션 정리 (28-70-03b) — 만료·폐기 뒤 30일 지난 행을 지운다. 로그인 성공 때 한 번씩 돈다(별도 cron 없이 유계).
 * 30일을 남기는 이유: "언제 폐기됐는가"를 잠시 추적할 수 있게.
 */
export async function pruneSessions(db: Queryable, workspaceId: string): Promise<number> {
  const r = await db.query<{ n: string }>(
    `with gone as (
       delete from sessions
       where workspace_id = $1
         and ((revoked_at is not null and revoked_at < now() - interval '30 days') or expires_at < now() - interval '30 days')
       returning 1)
     select count(*)::text as n from gone`,
    [workspaceId],
  )
  return Number(r.rows[0]?.n ?? 0)
}
