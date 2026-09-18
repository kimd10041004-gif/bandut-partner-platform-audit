import { PlatformService, STORAGE_SOFT_LIMIT, type StorageLike } from '../domain/platform'
import { AuthService } from '../../server/domain/auth'
import { Replicator, type ReplicationStatus, type CursorStore } from '../domain/replicator'
import { MemoryRemotePort } from '../domain/ports/memoryRemotePort'
import { HttpSnapshotPort } from '../domain/ports/httpPort'
import { HttpAuthClient } from '../domain/ports/httpAuth'
import { TokenStore } from './session'
import { createAuthActions, type AuthActions } from './authActions'

/**
 * 인증 모드 (28-70) — 빌드 시 결정된다.
 *  - `local`(기본): 계정·세션·스냅샷이 이 브라우저에만 있다. 프리뷰·로컬 e2e·**지금의 프로덕션**.
 *  - `server`: `VITE_AUTH_MODE=server`로 빌드. 계정·세션은 `/api/auth`, 스냅샷은 `/api/snapshot`(세션 토큰).
 *    CI `server` job이 이 모드로 빌드해 서버 모드 e2e를 돌린다. 프로덕션에서 켜는 절차는 `docs/rounds/28-68/서버_연결.md`.
 */
declare const __AUTH_MODE__: 'local' | 'server'
export const AUTH_MODE: 'local' | 'server' = __AUTH_MODE__

/**
 * 배포 확인이 **서빙 번들에서 직접 읽는 표식** (28-87-05).
 *
 * `AUTH_MODE`가 빌드 시점 리터럴이므로 이 삼항은 접혀서 **두 문자열 중 하나만** 번들에 남는다.
 * `deploy-check`가 그 하나를 읽어 "프로덕션은 지금 어느 모드인가"를 매 배포마다 보고한다.
 * 이것이 없어서, 28-68 이후 스무 라운드의 서버 작업이 로컬 모드 배포라 아무에게도 닿지 않는다는
 * 사실을 사람이 알아차릴 때까지 아무 기계도 말해 주지 않았다.
 */
export const AUTH_MODE_MARK = AUTH_MODE === 'server' ? 'bandut-auth-mode:server' : 'bandut-auth-mode:local'
/** 프로덕션 스냅샷 워크스페이스 — 스냅샷은 마켓플레이스 전체라 하나다 */
export const MAIN_WORKSPACE = 'main'

/** localStorage가 실제로 동작하는 환경에서만 반환 (프라이빗 모드 등 대비) */
export function browserStorage(): StorageLike | undefined {
  try {
    const s = window.localStorage
    const probe = '__banded_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return undefined
  }
}

/** 복제 커서 키 — 도메인 키 옆 (28-69-02) */
export const CURSOR_KEY = 'banded-platform-v1:remote'

/** 덮인 로컬 본문 보관함 키 (28-72-03) */
export const OVERWRITTEN_KEY = 'banded-platform-v1:overwritten'
/** 보관 개수 상한 — 통째 스냅샷이라 하나가 크다. 저장 용량과 싸우지 않게 최근 것만 */
export const OVERWRITTEN_MAX = 3
/**
 * 보관함 예산 (28-73-01). 개수 상한만으로는 부족하다 — 스냅샷 상한이 4MB이므로 3개는 **12MB**이고,
 * 그것은 브라우저 오리진 할당량(대개 5~10MB급)을 혼자 넘긴다. 그러면 정작 이 기기의 정상 저장이 실패한다.
 * 잃지 않으려고 만든 장치가 잃게 만드는 셈이라, 한도의 1/4 안에서만 보관하고 넘치면 오래된 것부터 버린다.
 *
 * 28-74-01: 1/4은 **상한**일 뿐이다. 28-74는 이것을 고정으로 써서, 스냅샷이 이미 76%를 쓰고 있어도
 * 그만큼을 더 보관했다 — 그러면 합계가 한도를 넘어 `assertRoom`이 그 기기의 저장을 막는다. 그리고 보관함을
 * 비우는 화면은 관리자에게만 있어 파트너 기기는 풀 방법이 없다. 실제 예산은 `stashBudget()`이
 * **남은 자리**와 함께 정한다.
 */
export const OVERWRITTEN_BUDGET = Math.floor(STORAGE_SOFT_LIMIT / 4)

export interface OverwrittenEntry {
  at: string
  body: string
}

/** 보관함 읽기 — 손상됐으면 빈 목록이다(보관함 때문에 앱이 깨지지 않는다) */
export function readOverwritten(storage: StorageLike | undefined = browserStorage()): OverwrittenEntry[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(OVERWRITTEN_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is OverwrittenEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as OverwrittenEntry).at === 'string' &&
        typeof (e as OverwrittenEntry).body === 'string',
    )
  } catch {
    return []
  }
}

/**
 * 덮이는 본문을 보관한다 (28-72-03). 통째 스냅샷은 병합할 수 없지만 **잃지 않는 것**은 할 수 있다.
 * 최근 `OVERWRITTEN_MAX`개만 남기고, 저장에 실패해도(용량 초과) 조용히 넘어간다 — 동기화를 막지 않는다.
 */
export function stashOverwritten(
  storage: StorageLike | undefined,
  body: string,
  at: string,
  budget: number = OVERWRITTEN_BUDGET,
): boolean {
  if (!storage) return false
  const cap = Math.max(0, Math.min(OVERWRITTEN_BUDGET, budget))
  const next = [{ at, body }, ...readOverwritten(storage)].slice(0, OVERWRITTEN_MAX)
  // 28-73-01: 예산 안에 들어올 때까지 **오래된 것부터** 버린다
  while (next.length > 0 && JSON.stringify(next).length > cap) next.pop()
  // 방금 덮인 본문 하나도 예산에 안 들어가면 보관하지 않는다 — 저장을 막느니 보관을 포기한다
  if (next.length === 0) return false
  try {
    storage.setItem(OVERWRITTEN_KEY, JSON.stringify(next))
    return true
  } catch {
    // 용량 초과 등 — 보관은 최선 노력이다. 28-74-04: 실패는 실패라고 돌려준다(문구가 그것을 말한다)
    return false
  }
}

/** 보관함이 쓰는 문자 수 (28-73-01) — 용량 회계용이라 **파싱하지 않는다** */
export function overwrittenChars(storage: StorageLike | undefined = browserStorage()): number {
  if (!storage) return 0
  try {
    return storage.getItem(OVERWRITTEN_KEY)?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * 이번 보관에 쓸 수 있는 자리 (28-74-01).
 *
 * 상한(`OVERWRITTEN_BUDGET`)과 **남은 자리** 중 작은 쪽이다. 남은 자리는 한도에서 스냅샷이 쓰는 만큼을 뺀 것 —
 * 지금 있는 보관함은 어차피 이번 쓰기로 덮이므로 빼지 않는다. 이렇게 하면 보관 뒤의 합계가 한도를 넘지 않아,
 * **보관이 이 기기의 저장을 막는 일이 없다.** 28-74는 상한만 봐서, 스냅샷이 이미 76%를 쓰고 있어도
 * 1MB를 더 보관하고 그 뒤 모든 저장을 실패시켰다(그리고 파트너 기기에는 비울 화면이 없다).
 */
export function stashBudget(platform: PlatformService, incomingChars = 0): number {
  const u = platform.storageUsage()
  // 28-75-01: 보관 직후 로컬은 **원격 본문**으로 갈린다. 둘 중 큰 쪽으로 재야 보관 뒤의 합계가 한도를 넘지 않는다.
  //   28-75는 지금 로컬(`u.chars`)만 봐서, 원격이 더 크면 accept 뒤에 합계가 넘고 그 기기의 저장이 다시 막혔다.
  const after = Math.max(u.chars, Math.max(0, incomingChars))
  return Math.max(0, Math.min(OVERWRITTEN_BUDGET, u.limit - after))
}

/**
 * 보관함을 예산에 맞춘다 (28-75-02) — **부팅 때 한 번**. 지운 항목 수를 돌려준다.
 *
 * 28-74가 고정 예산으로 남긴 초과분은 실제 기기에 있다(그 판은 배포됐다). `stashOverwritten`은 예산에
 * 안 들어가면 아무것도 쓰지 않고 돌아가므로, 이미 쓰인 것은 **다음 conflict에서 새 본문이 들어갈 때만**
 * 줄어든다 — 그런데 저장이 막힌 기기는 바로 그 조건이 안 맞는 기기다. 부팅 때 맞춰 보면 즉시 풀린다.
 *
 * 하나도 안 들어가면 **비운다**. 꺼낼 수 없는 1MB보다 쓸 수 있는 1MB가 낫다 — 그 판단의 근거는
 * 보관함이 "잃지 않기"를 위한 것인데, 저장이 막히면 그때부터는 보관함이 잃게 만들기 때문이다.
 */
export function trimOverwritten(storage: StorageLike | undefined, budget: number): number {
  if (!storage) return 0
  const current = readOverwritten(storage)
  if (current.length === 0) return 0
  const cap = Math.max(0, Math.min(OVERWRITTEN_BUDGET, budget))
  const next = [...current]
  while (next.length > 0 && JSON.stringify(next).length > cap) next.pop()
  if (next.length === current.length) return 0
  try {
    if (next.length === 0) storage.removeItem(OVERWRITTEN_KEY)
    else storage.setItem(OVERWRITTEN_KEY, JSON.stringify(next))
  } catch {
    return 0 // 쓰지도 지우지도 못했다 — 없던 일로 보고한다
  }
  return current.length - next.length
}

/** 보관함 비우기 (28-73-04) — 키를 아는 곳은 여기 하나다 */
export function clearOverwritten(storage: StorageLike | undefined = browserStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(OVERWRITTEN_KEY)
  } catch {
    // 지우지 못해도 앱은 계속 돈다
  }
}

/**
 * 28-70-02: 리셋된 브라우저는 새 기기다. `PlatformService.load()`가 손상으로 스냅샷을 버리고 새 인스턴스를 돌려줄 때
 * `<key>:rev`와 커서는 남는다 — 그 커서를 복제기가 채택하면 빈 로컬을 "내 변경"으로 밀어 올려 서버를 덮는다.
 * 그래서 복원되지 않은(fresh) 플랫폼이면 커서를 지운다(규칙 2: 원격을 받아들인다).
 */
export function clearStaleCursor(storage: StorageLike | undefined, fresh: boolean): void {
  if (!storage || !fresh) return
  try {
    storage.removeItem(CURSOR_KEY)
  } catch {
    // 저장소 접근 불가 — 복제기의 자체 방어(커서 > revision이면 버림)가 남는다
  }
}

export interface InitializedPlatform {
  platform: PlatformService
  /** 저장소에서 복원되지 않았다(처음이거나 손상 리셋) — initReplicator가 커서를 지운다 */
  fresh: boolean
  /**
   * 28-77-03: 부팅 정리로 **버린 보관 항목 수**. 28-75-02는 이 정리를 조용히 했다 —
   * 보관함은 "잃지 않으려고" 만든 것인데 말 없이 잃으면 그 약속이 깨진다. 화면이 한 번 알린다.
   */
  trimmedStash: number
}

export function initPlatform(): InitializedPlatform {
  const storage = browserStorage()
  // 28-73-01: 보관함이 쓰는 만큼도 용량 회계에 넣는다 — 한도는 브라우저 하나가 공유한다
  // 28-79-02: 런타임 정리도 **부팅과 같은 기준**(`stashBudget`)으로 판단한다. 28-78은 부팅은 예산
  //   (한도−스냅샷), 런타임은 "모자란 만큼만"이라 서로 달랐다 — 간신히 통과한 기기가 다음 저장에서
  //   또 걸리고, 그때마다 조금씩 지워졌다. 28-80-04에서 예외 분기를 지워 기준이 정말 하나가 됐다.
  let svc: PlatformService | undefined
  const { service, restored } = PlatformService.load(
    storage
      ? {
          storage,
          externalChars: () => overwrittenChars(storage),
          // 28-78-01: 용량이 모자라 저장이 막힐 때 **보관함이 양보한다.** 부팅에만 정리하던 것을
          //   쓰는 중에도 열어 준다 — 예산을 넘기는 사건은 부팅이 아니라 쓰는 중에 일어난다.
          trimExternal: (need: number) => {
            // 28-80-04: `svc`는 여기서 반드시 채워져 있다 — `assertRoom`은 사진 경로에서만 불리고,
            //   그 경로는 `load()`가 끝난 뒤에야 열린다. 28-79는 도달할 수 없는 분기에 "틀렸다"고
            //   선언한 옛 정책(모자란 만큼만)을 남겨 두어, 한 곳에 두겠다던 정책이 두 곳에 있었다.
            if (svc === undefined) return 0
            const before = overwrittenChars(storage)
            // 28-80-02: `trimOverwritten`은 **지운 건수**를 돌려준다. 28-79는 그 값을 버리고 늘 1을
            //   기록해서, 3건이 한꺼번에 지워져도 운영 기록·CSV에는 "보관함 정리 · 1"로 남았다.
            //   없는 기록보다 틀린 기록이 나쁘다 — 없으면 모른다는 것을 알지만 틀리면 안다고 착각한다.
            const removed = trimOverwritten(storage, Math.min(stashBudget(svc), Math.max(0, before - need)))
            if (removed > 0) svc.recordStashTrim(removed)
            return before - overwrittenChars(storage)
          },
        }
      : {},
  )
  svc = service
  service.sweepDeadlines() // 28-43-01: 마감 지난 요청 정리(멱등)
  service.sweepPaymentReminders() // 28-44-01: 결제 지연 리마인더(멱등)
  service.sweepVisitReminders() // 28-56-03: 방문 전날 리마인더(멱등)
  service.pruneNotifications() // 28-54-01: 알림 보관 정책(멱등)
  service.pruneChats() // 28-54-02: 채팅 보관 정책(멱등)
  service.prunePhotos() // 28-49-02: 사진 보관 정책(멱등)
  service.pruneAuditLog() // 28-57-01: 감사 로그 보관 정책(멱등)
  // 28-75-02: 28-74가 고정 예산으로 남긴 초과 보관함을 여기서 한 번 맞춘다 — 그것이 저장을 막고 있는
  //   기기를 실제로 푸는 유일한 조치다(다음 conflict를 기다리면 그 기기는 영영 막혀 있다).
  const trimmedStash = trimOverwritten(storage, stashBudget(service))
  // 28-78-02: 알림·채팅·사진 정리와 같은 자리에 남긴다 — 안내는 4초지만 기록은 남는다
  service.recordStashTrim(trimmedStash)
  return { platform: service, fresh: !restored, trimmedStash }
}

/** 인증 서비스 초기화 (28-30-01) — 플랫폼과 저장 키 분리 */
export function initAuth(): AuthService {
  // 28-70: 서버 모드의 AuthService는 거울이다 — 변경 메서드를 직접 부르면 던진다
  return new AuthService(browserStorage(), { mirror: AUTH_MODE === 'server' })
}

/** 세션 토큰 보관 (28-70) */
export function initTokens(): TokenStore {
  return new TokenStore(browserStorage())
}

/** 계정·세션 변경의 단일 진입 (28-70) — 화면은 이것만 부른다 */
export function initAuthActions(
  auth: AuthService,
  tokens: TokenStore,
  onSession?: () => Promise<void> | void,
): AuthActions {
  return createAuthActions(auth, AUTH_MODE === 'server' ? new HttpAuthClient('/api/auth') : null, tokens, onSession)
}

/**
 * 원격 복제기 (28-67 → 28-70).
 *
 * 로컬 모드의 원격은 **메모리 가짜**다 — 로컬이 진실이고 복제는 그림자. 배포 동작은 로컬 전용 그대로다.
 * 서버 모드는 `HttpSnapshotPort('/api/snapshot', 세션 토큰, 'main')` — 토큰은 `TokenStore`에서 매 요청 때 읽는다
 * (로그인·로그아웃으로 바뀌므로 포트를 다시 만들지 않는다). 커서(`<도메인 키>:remote`)는 탭 사이에 공유된다(28-69-02).
 *
 * 도메인은 한 줄도 고치지 않는다. 필요한 것만 좁게 뽑아 넘긴다.
 */
export function initReplicator(
  platform: PlatformService,
  tokens: TokenStore,
  /** initPlatform()의 fresh — 리셋된 브라우저는 커서를 버린다 (28-70-02) */
  fresh: boolean,
  onStatus?: (status: ReplicationStatus, detail?: string) => void,
): Replicator {
  const storage = browserStorage()
  clearStaleCursor(storage, fresh)
  const cursor: CursorStore | undefined = storage
    ? { get: () => storage.getItem(CURSOR_KEY), set: (v) => storage.setItem(CURSOR_KEY, v) }
    : undefined
  return new Replicator(
    {
      name: 'platform',
      revision: () => platform.revision,
      body: () => platform.exportData(),
      accept: (body) => platform.importSnapshot(body),
    },
    AUTH_MODE === 'server'
      ? new HttpSnapshotPort('/api/snapshot', () => tokens.any(), MAIN_WORKSPACE)
      : new MemoryRemotePort(),
    // 28-67-03: 옵션을 실제로 넘긴다. 28-67은 넘기지 않아 onStatus가 항상 no-op였고,
    //   그래서 복제 상태가 화면에 도달할 길이 없었다.
    // 28-72-03: stash — conflict로 덮이는 로컬 본문을 보관함에 넣는다
    {
      ...(onStatus ? { onStatus } : {}),
      ...(cursor ? { cursor } : {}),
      // 28-74-01: 예산은 **남은 자리**와 함께 정한다. 28-74-04: 보관 여부를 돌려줘 문구가 사실을 말하게 한다
      ...(storage
        ? {
            stash: (body: string, at: string, incomingChars: number) =>
              stashOverwritten(storage, body, at, stashBudget(platform, incomingChars)),
          }
        : {}),
    },
  )
}
