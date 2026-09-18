/**
 * 계정 상태 행 ↔ AuthService (28-70).
 *
 * 서버는 **클라이언트와 같은 `AuthService`**를 돌린다. 행의 body를 Map 기반 `StorageLike`에 넣고
 * 생성자가 `load()`하게 한 뒤, op를 부르고, 바뀌었으면 body를 다시 쓴다. 규칙이 한 코드에 있다.
 *
 * 손상된 body를 클라이언트처럼 "초기화"하지 않는다 — 서버에서 그것은 계정 전부의 조용한 유실이다. 503으로 막는다.
 */
import type { PoolClient } from 'pg'
import type { StorageLike } from '../src/domain/platform'
import { AuthService, AUTH_STORAGE_KEY } from './domain/auth'

export class AuthStateError extends Error {}

function mapStorage(m: Map<string, string>): StorageLike {
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

export interface LoadedAuth {
  auth: AuthService
  /** 행이 없어 새로 만든다 */
  fresh: boolean
  /** 변경 감지용 — op 뒤 `exportState()`와 비교한다 */
  before: string
}

/**
 * 행을 잠그고 AuthService를 만든다. 행이 없으면 `adminPassword`로 초기 상태를 만든다.
 *
 * ## 왜 `for update` 앞에 자문 잠금이 있나 (29-22)
 *
 * `select ... for update` 는 **행이 있을 때만** 잠근다. 빈 저장소에서 두 요청이 동시에 오면
 * 둘 다 "행이 없다"를 보고 둘 다 `insert` 해서, 늦은 쪽이 기본키에서 터졌다. 실제로 그렇게
 * 터졌다 — 29-22 의 동시 감사 봇이 첫 실행에서 잡았다.
 *
 * ```
 * [api/auth] duplicate key value violates unique constraint "auth_state_pkey"
 * ```
 *
 * 없는 행은 잠글 수 없으니 **이름을 잠근다.** 트랜잭션 자문 잠금은 행의 존재와 무관하게
 * 걸리고 커밋·롤백에서 자동으로 풀린다. 늦은 쪽은 기다렸다가 먼저 선 행을 읽고 그 위에
 * 자기 계정을 얹는다.
 *
 * `on conflict do update` 로 막지 않는 이유: 이 행은 **계정 전부**를 담은 한 덩어리라,
 * 늦은 쪽이 자기 상태로 덮으면 먼저 가입한 사람이 조용히 사라진다. 터지는 것보다 나쁘다.
 * 해시 충돌로 다른 워크스페이스와 같은 잠금을 잡을 수는 있지만, 그것은 잠깐 줄을 서는 것일
 * 뿐 틀린 답을 만들지 않는다.
 */
export async function loadAuth(c: PoolClient, workspaceId: string, adminPassword: string): Promise<LoadedAuth> {
  await c.query('select pg_advisory_xact_lock(hashtext($1))', [`auth_state:${workspaceId}`])
  const r = await c.query<{ body: string }>('select body from auth_state where workspace_id = $1 for update', [
    workspaceId,
  ])
  const row = r.rows[0]
  const m = new Map<string, string>()
  if (row !== undefined) m.set(AUTH_STORAGE_KEY, row.body)
  const auth = new AuthService(mapStorage(m))
  if (row !== undefined && !m.has(AUTH_STORAGE_KEY)) {
    // load()가 손상으로 판단해 지웠다 — 서버에서는 초기화가 아니라 중단이다
    throw new AuthStateError('auth_state 본문이 손상되어 읽을 수 없습니다')
  }
  if (row === undefined) {
    // 초기 소유자 비밀번호 — 시연 비밀번호로 열리지 않는다 (handleAuth가 env를 먼저 검사한다)
    // 28-89-A: 세션 없이 도는 유일한 관리자 비밀번호 변경이라 전용 메서드다
    auth.bootstrapOwnerPassword(adminPassword)
  }
  return { auth, fresh: row === undefined, before: row === undefined ? '' : auth.exportState() }
}

/** 바뀐 경우에만 쓴다. rev는 저장소가 발급한다(28-68-01과 같은 규칙) */
export async function saveAuth(c: PoolClient, workspaceId: string, loaded: LoadedAuth): Promise<boolean> {
  const after = loaded.auth.exportState()
  if (loaded.fresh) {
    await c.query('insert into auth_state (workspace_id, rev, body) values ($1, 1, $2)', [workspaceId, after])
    return true
  }
  if (after === loaded.before) return false
  await c.query('update auth_state set rev = rev + 1, body = $2, updated_at = now() where workspace_id = $1', [
    workspaceId,
    after,
  ])
  return true
}
