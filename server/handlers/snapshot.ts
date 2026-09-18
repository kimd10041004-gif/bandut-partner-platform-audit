/**
 * 스냅샷 API (28-68) — `SnapshotPort` 계약의 서버 쪽.
 *
 * ## 왜 이 모양인가
 *
 * 클라이언트는 `HttpSnapshotPort`(src/domain/ports/httpPort.ts)로 이곳을 부르고,
 * 그 포트는 로컬 어댑터와 **같은 계약 테스트**를 통과한다. 즉 이 파일의 응답 모양이
 * `ports.ts`의 `ReadResult`·`WriteResult`와 어긋나면 계약 테스트가 먼저 깨진다.
 *
 * ## 워크스페이스 (28-68 감사 정정)
 *
 * 스냅샷은 **마켓플레이스 전체**(모든 고객의 요청·모든 파트너의 입찰)라 워크스페이스는 실제로 **하나**여야 한다.
 * `workspace` 파라미터는 CI 계약 테스트가 격리된 행을 쓰기 위한 것이고, 프로덕션에서는 상수 하나다.
 * "사용자별 워크스페이스"는 마켓플레이스를 사용자 수만큼 쪼개는 것이라 성립하지 않는다.
 *
 * ## 인증 — 세션 토큰 (28-70)
 *
 * `Authorization: Bearer <세션 토큰>`. 토큰은 `/api/auth`의 `login`이 발급하고 `sessions` 테이블에서
 * 확인한다(`server/session.ts`). 28-68의 공유 시크릿(`WORKSPACE_SECRET`)은 없앴다 — 두 인증 경로가 있으면
 * 하나는 반드시 낡는다(28-69 감사). 로그인한 계정은 **누구나 전체 스냅샷을 읽고 쓴다** — 스냅샷이 마켓플레이스
 * 전체라 인가는 이 모델에서 불가능하고(28-68 감사 정정), 대신 `updated_by`로 누가 썼는지를 남긴다.
 *
 * ## `head=1` (28-69-01)
 *
 * `GET …&head=1`은 rev만 돌려준다 — 탭 복귀 때 본문(최대 4MB)을 받지 않고 "남이 썼는가"만 안다.
 *
 * ## `pg`를 쓰는 이유
 *
 * `@neondatabase/serverless`가 아니라 평범한 `pg`다 — CI의 `postgres:16` 컨테이너에 붙어야 하고,
 * 그래야 **프로덕션과 CI가 같은 코드 경로**를 탄다. 검증되지 않는 서버 코드를 만들지 않는다.
 */
import type { Pool } from 'pg'
import { getPool } from '../db'
import { resolveDatabaseUrl } from '../databaseUrl'
import { sessionOf, tokenOf } from '../session'
import { DEFAULT_WORKSPACE } from './auth'

/** 저장 단위 — `src/domain/ports.ts`의 `SnapshotRecord`와 같은 모양 */
export interface SnapshotRecord {
  rev: number
  body: string
}

export interface ApiRequest {
  method: string
  /** 헤더 이름은 소문자로 정규화해서 넘긴다 */
  headers: Record<string, string | undefined>
  /** 쿼리 문자열 파라미터 */
  query: Record<string, string | undefined>
  /** 요청 본문 (PUT일 때만) */
  body: unknown
}

export interface ApiResponse {
  status: number
  body: unknown
  /** 응답 헤더 (28-68 기록: 인증된 GET에 no-store) */
  headers?: Record<string, string>
}

/**
 * 본문 상한 (28-68-03 정정).
 * 28-68은 8MB였는데 Vercel Functions의 요청 본문 상한(4.5MB급)이 그보다 작아 프로덕션에서는
 * 이 검사에 닿기도 전에 플랫폼이 413을 냈다. 도메인의 STORAGE_SOFT_LIMIT(4MB)과 같은 급으로 내린다.
 */
export const MAX_BODY_CHARS = 4 * 1024 * 1024
/** 바이트 상한 — 인증·파싱 **전에** 검사한다(한글 3바이트 + JSON 감싸기 여유) */
export const MAX_BODY_BYTES = MAX_BODY_CHARS * 3 + 4096

/** CI 서버가 종료 시 정리한다 — 풀은 server/db.ts가 가진다 */
export { closePool } from '../db'

function unauthorized(): ApiResponse {
  return { status: 401, body: { error: '인증이 필요합니다' } }
}

/**
 * 핸들러 본체 — HTTP 프레임워크에 의존하지 않는다.
 * Vercel 진입점(아래 `default`)과 CI의 최소 서버(`scripts/api-server.mjs`)가 **같은 이것**을 부른다.
 */
export async function handleSnapshot(req: ApiRequest, env: NodeJS.ProcessEnv): Promise<ApiResponse> {
  const databaseUrl = resolveDatabaseUrl(env)
  if (!databaseUrl) {
    // 환경변수가 없으면 **조용히 열리지 않는다** — 인증 없는 저장소가 되는 것보다 503이 낫다
    return { status: 503, body: { error: '서버 저장소가 아직 연결되지 않았습니다' } }
  }
  const workspaceId = (req.query['workspace'] ?? '').trim()
  // 28-85 리뷰: 비어 있음과 길이 초과를 구분한다 — 한 메시지로 묶으면 원인을 오해한다(#232 리뷰).
  if (workspaceId === '') {
    return { status: 400, body: { error: 'workspace 파라미터가 필요합니다' } }
  }
  if (workspaceId.length > 128) {
    return { status: 400, body: { error: 'workspace 파라미터가 너무 깁니다 (최대 128자)' } }
  }

  const db = getPool(databaseUrl)
  try {
    // 28-70: 세션 토큰 — 계정 상태의 워크스페이스는 하나(main)다. 스냅샷 워크스페이스는 CI 격리용으로 여럿일 수 있다
    const session = await sessionOf(db, DEFAULT_WORKSPACE, tokenOf(req.headers, req.method))
    if (session === null) return unauthorized()

    if (req.method === 'GET') {
      const headers = { 'cache-control': 'no-store' }
      if (req.query['head'] === '1') {
        // 28-69-01: rev만
        const r = await db.query<{ rev: string }>('select rev from snapshots where workspace_id = $1', [workspaceId])
        const row = r.rows[0]
        return { status: 200, body: { rev: row === undefined ? null : Number(row.rev) }, headers }
      }
      const r = await db.query<{ rev: string; body: string }>(
        'select rev, body from snapshots where workspace_id = $1',
        [workspaceId],
      )
      const row = r.rows[0]
      if (row === undefined) return { status: 200, body: { record: null }, headers }
      return { status: 200, body: { record: { rev: Number(row.rev), body: row.body } }, headers }
    }

    if (req.method === 'PUT') {
      // 28-89-A: 열람 등급 관리자는 스냅샷을 쓰지 못한다. 통째 쓰기라 매니저/소유자는 서버가 구별하지
      //   못한다(adminGrade.ts "막지 못하는 것") — 여기서 막는 것은 **열람이 쓰기가 되는 것** 하나다.
      if (session.role === 'admin' && session.grade !== 'owner' && session.grade !== 'manager') {
        return { status: 403, body: { error: '열람 등급은 저장할 수 없습니다 — 매니저 이상만 저장합니다' } }
      }
      const parsed = parseWriteBody(req.body)
      if (parsed === null) return { status: 400, body: { error: '요청 본문이 올바르지 않습니다' } }
      const { body, expectedRev } = parsed
      if (body.length > MAX_BODY_CHARS) {
        return { status: 413, body: { error: '스냅샷이 너무 큽니다' } }
      }

      // 28-68-01: rev는 **서버가 발급한다.** 클라이언트가 보낸 숫자를 저장하지 않는다.
      // 28-68은 기기별 카운터를 그대로 넣어서 두 기기가 같은 rev를 들고 오면 conflict 없이 덮어썼다.
      if (expectedRev === null) {
        // "아직 아무것도 없다"는 기대 — 이미 있으면 0행이 돌아오고 그것이 conflict다
        const r = await db.query<{ rev: string }>(
          `insert into snapshots (workspace_id, rev, body, updated_by)
           values ($1, 1, $2, $3)
           on conflict (workspace_id) do nothing
           returning rev`,
          [workspaceId, body, session.accountId],
        )
        if (r.rows[0] !== undefined) return { status: 200, body: { rev: 1 } }
        return conflictResponse(db, workspaceId)
      }

      // 낙관적 동시성이 SQL 한 줄이 된다 — 기대값이 where가 되고, 새 rev는 +1로 발급된다
      const r = await db.query<{ rev: string }>(
        `update snapshots set rev = rev + 1, body = $2, updated_at = now(), updated_by = $4
         where workspace_id = $1 and rev = $3
         returning rev`,
        [workspaceId, body, expectedRev, session.accountId],
      )
      if (r.rows[0] !== undefined) return { status: 200, body: { rev: Number(r.rows[0].rev) } }
      return conflictResponse(db, workspaceId)
    }

    return { status: 405, body: { error: '지원하지 않는 메서드입니다' } }
  } catch (err) {
    // 닿을 수 없는 것은 예외가 아니라 결과값이다 — 포트가 이것을 unavailable로 옮긴다
    // 28-70-03d: DB 오류 원문은 서버 로그로, 클라이언트에는 일반 문구
    console.error('[api/snapshot]', err instanceof Error ? err.message : String(err))
    return { status: 503, body: { error: '서버 저장소 오류 — 잠시 후 다시 시도해 주세요' } }
  }
}

/** conflict 응답 — **원격이 비어 있으면 remote는 null**이다 (28-67-02c의 센티널 금지) */
async function conflictResponse(db: Pool, workspaceId: string): Promise<ApiResponse> {
  const r = await db.query<{ rev: string; body: string }>('select rev, body from snapshots where workspace_id = $1', [
    workspaceId,
  ])
  const row = r.rows[0]
  return {
    status: 409,
    body: { reason: 'conflict', remote: row === undefined ? null : { rev: Number(row.rev), body: row.body } },
  }
}

/** PUT 본문 검사 — 통과하지 못하면 null (호출자가 400으로 옮긴다) */
function parseWriteBody(raw: unknown): { body: string; expectedRev: number | null } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  // 28-68-01: 옛 클라이언트가 rev를 보내면 조용히 무시하지 않고 거부한다 — 계약이 바뀌었다
  if ('rev' in o) return null
  const body = o['body']
  const expected = o['expectedRev']
  if (typeof body !== 'string') return null
  if (expected !== null && (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0)) return null
  return { body, expectedRev: expected as number | null }
}

/** Vercel Serverless Function 진입점 — 프레임워크 어댑터 한 겹뿐이다 */
export default async function handler(
  req: {
    method?: string
    headers: Record<string, string | string[] | undefined>
    query: Record<string, string | string[] | undefined>
    body?: unknown
  },
  res: { setHeader: (k: string, v: string) => void; status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const headers: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v
  const query: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(req.query)) query[k] = Array.isArray(v) ? v[0] : v
  const out = await handleSnapshot({ method: req.method ?? 'GET', headers, query, body: req.body }, process.env)
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v)
  res.status(out.status).json(out.body)
}
