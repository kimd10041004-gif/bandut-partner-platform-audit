import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { PlatformService } from '../domain/platform'
import type { AuthService } from '../../server/domain/auth'
import { initPlatform, initAuth, initReplicator, initTokens, initAuthActions, AUTH_MODE } from './bootstrap'
import type { AuthActions } from './authActions'
import {
  canAdmin,
  ADMIN_GRADE_LABEL,
  ADMIN_MIN_GRADE,
  type AdminAction,
  type AdminGrade,
} from '../../server/domain/adminGrade'
import type { Replicator, ReplicationStatus } from '../domain/replicator'

/** 플랫폼 상태 공급 (28-10-02): 프롭 드릴링 대신 컨텍스트 훅 */
interface PlatformContextValue {
  platform: PlatformService
  /** 인증 (28-30-01) — 역할별 세션. 28-70: 서버 모드에서는 **거울**(읽기 전용) — 변경은 authActions로 */
  auth: AuthService
  /** 계정·세션 변경의 단일 진입 (28-70) — 로컬 모드면 auth를, 서버 모드면 /api/auth를 부른다 */
  authActions: AuthActions
  /** 인증 모드 (28-70) — 화면 표기·e2e 확인용 */
  authMode: 'local' | 'server'
  /** 플랫폼 상태 변경 후 화면 갱신 */
  refresh: () => void
  /** 마지막 저장 실패 메시지 (28-49-01) — 다음 저장 성공 시 null */
  saveError: string | null
  /** 다른 탭 동기화·충돌 1회성 안내 (28-55) */
  syncNotice: string | null
  /** 원격 복제기 (28-67) — 로컬이 진실이고 이건 뒤에서 도는 복제다 */
  replication: Replicator
  /** 원격 복제 상태 (28-67-03) — onStatus로 올라온다 */
  replicationStatus: { status: ReplicationStatus; detail: string | undefined }
  /**
   * 마지막으로 남은 문제 (28-68-04a) — `offline`·`rejected`는 여기 남고 **`synced`에서만** 내려간다.
   * 28-68은 배너가 `status === 'offline'`만 봐서, 저장 한 번(`pending`)에 배너가 사라졌다 —
   * 아무것도 보내지 않았는데 "해결됐다"고 알렸다.
   */
  lastProblem: { status: 'offline' | 'rejected'; detail: string | undefined } | null
}

/** 28-82-02: 테스트가 화면을 **실제로 렌더**할 수 있도록 컨텍스트를 내보낸다. 앱 코드는 `PlatformProvider`를 쓴다. */
export const PlatformContext = createContext<PlatformContextValue | null>(null)

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [{ platform, fresh, trimmedStash }] = useState(initPlatform)
  const [auth] = useState(initAuth)
  const [tokens] = useState(initTokens)
  const [replicationStatus, setReplicationStatus] = useState<{ status: ReplicationStatus; detail: string | undefined }>(
    { status: 'synced', detail: undefined },
  )
  const [lastProblem, setLastProblem] = useState<{ status: 'offline' | 'rejected'; detail: string | undefined } | null>(
    null,
  )
  // 28-55: 다른 탭 동기화·충돌 1회성 안내 (복제기의 conflict도 여기로 — 28-68-04a)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  // 28-67-03: onStatus를 실제로 넘긴다. 28-68-04a: 문제 상태는 lastProblem에 남기고, conflict는 안내한다.
  const [replication] = useState(() =>
    initReplicator(platform, tokens, fresh, (status, detail) => {
      setReplicationStatus({ status, detail })
      // 28-70: 로그아웃 상태의 401은 문제가 아니다 — 방문자는 이 기기에서만 쓴다
      const loggedOut = status === 'rejected' && tokens.any() === null
      if ((status === 'offline' || status === 'rejected') && !loggedOut) setLastProblem({ status, detail })
      else if (status === 'synced' || loggedOut) setLastProblem(null)
      if (status === 'conflict') {
        // 복제기가 로컬 상태를 통째로 갈아치우는 유일한 상태 — 28-68은 이것을 어디에도 표시하지 않았다.
        // 28-70: 문구는 복제기가 정한다 — 덮인 로컬 변경이 있었을 때만 "덮였습니다"라고 말한다
        setSyncNotice(detail ?? '다른 기기의 변경을 받아들였습니다')
      }
    }),
  )
  const [, setVersion] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  // 28-70: 세션이 생기거나 복원되면 복제기가 원격을 다시 본다(로그아웃 중의 401 뒤 needsRead가 서 있다)
  // 28-71-01: Promise를 돌려준다 — login()이 첫 접촉(accept)이 끝날 때까지 기다린다
  const [authActions] = useState(() => initAuthActions(auth, tokens, () => replication.sync({ checkRemote: true })))
  // 28-49-01: 저장 실패는 즉시 통지받고, 갱신 때마다 최신 상태를 반영(성공하면 배너 해제)
  useEffect(() => {
    // 28-68-02d: StrictMode 재마운트처럼 같은 인스턴스를 다시 쓸 때 stop()을 되돌린다
    replication.start()
    // 28-70: 서버 모드 — 저장된 토큰으로 세션·거울을 복원한다(만료·폐기된 토큰은 여기서 정리된다)
    if (AUTH_MODE === 'server') void authActions.restore().then(() => setVersion((v) => v + 1))
    platform.onSaveError = (message) => setSaveError(message)
    // 28-67-03: 저장이 성공할 때마다 복제기에 알린다 — markChanged()를 부르는 유일한 프로덕션 경로다.
    //   28-67은 아무도 부르지 않아 'pending' 상태에 도달하는 길이 없었고,
    //   복제는 사용자가 탭을 포커스할 때만 돌았다.
    platform.onSaved = () => replication.markChanged()
    return () => {
      platform.onSaveError = undefined
      platform.onSaved = undefined
      // 28-67-03/28-68-02d: 예약을 거두고 이후 예약을 막는다 — 진행 중이던 sync가 끝나도 되살아나지 않는다
      replication.stop()
    }
  }, [platform, replication, authActions])
  // 28-60-02: 감사 기록의 행위자 — 로그인한 관리자 계정 ID를 도메인에 알린다
  // 28-63-02: 가명 처리 자체 검사가 볼 이름 출처도 함께 넓힌다(계정 서비스가 아는 이름)
  // 28-70-04c: 서버 모드에서 비관리자의 거울은 자기 계정 하나라 여기서 아는 이름이 로컬 모드보다 적다 —
  //   검사는 요청의 customerName·파트너 프로필도 보므로 무력화는 아니지만, 계정 서비스 출처는 관리자 세션에서만 전체다
  // 28-64-02: effect가 아니라 렌더 중에 대입한다. effect는 커밋 뒤에 돌아서,
  //   (a) initPlatform이 첫 렌더 중 실행하는 sweep/prune들이 record()를 호출할 때,
  //   (b) 자식 화면이 mount effect에서 sweep을 돌릴 때(부모 effect는 자식보다 나중이다)
  //   식별자가 비어 있었다. 검사가 "아는 것이 적어" 조용히 느슨해지는 상태를 없앤다.
  //   연락처·사업자번호까지 넘겨 값 대조가 이름 밖 식별자도 보게 한다.
  platform.actorId = auth.sessionFor('admin')?.accountId
  platform.extraNames = auth
    .listAccounts()
    .flatMap((a) => [a.name, a.phone, a.bizNo])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  // 28-58-03: 인증 보안 이벤트(로그인 실패·잠금·비밀번호 변경·탈퇴)를 감사 로그로 잇는다
  useEffect(() => {
    auth.onSecurityEvent = (e) => platform.audit('system', e.action, e.target, e.detail)
    return () => {
      auth.onSecurityEvent = undefined
    }
    // 28-67-03: replication을 쓰지 않는 effect다. 28-67은 이 배열과 아래 sync effect의 배열을
    //   정확히 뒤바꿔 놓았다 — replication을 쓰는 쪽에는 없고, 안 쓰는 쪽에 있었다.
  }, [platform, auth])
  const refresh = () => {
    setSaveError(platform.lastSaveError)
    setVersion((v) => v + 1)
  }
  // 28-55: 다른 탭의 저장(storage 이벤트)·탭 복귀(focus/visibility) 시 저장소와 동기화, 충돌은 배너로
  useEffect(() => {
    const sync = (fromOtherTab: boolean, refreshSession = true) => {
      const p = platform.syncFromStorage()
      const a = auth.syncFromStorage()
      if (p || a) {
        setSyncNotice(p ? '다른 탭의 변경을 반영했습니다' : '다른 탭의 로그인 상태를 반영했습니다')
        setVersion((v) => v + 1)
      }
      // 28-67: 원격 복제는 여기 얹는다 — 탭 복귀·다른 탭 저장 때.
      // 28-69-01: 로컬 변경이 없어도 원격 rev를 확인한다(head) — 보기만 하는 기기도 남의 변경을 본다.
      // 28-69-02: 다른 탭의 저장은 받기만 한다 — 보내는 것은 그 탭의 디바운스 몫이다(두 탭이 경쟁하지 않는다).
      void replication.sync({ checkRemote: true, pushLocal: !fromOtherTab })
      // 28-70: 서버 모드 — 세션·거울도 새로 본다(관리자 회원 목록·승인 상태)
      if (AUTH_MODE === 'server' && refreshSession) void authActions.restore().then(() => setVersion((v) => v + 1))
    }
    // 28-67-03: focus와 visibilitychange는 탭 전환 한 번에 **둘 다** 뜬다.
    //   28-67은 둘을 그대로 두어 같은 일이 두 번 돌았다(그때는 매번 전체 스냅샷을 직렬화했다).
    //   복제기 쪽 조기 반환과 별개로, syncFromStorage도 두 번 돌 이유가 없다.
    let lastSyncAt = 0
    const syncOnce = () => {
      const now = Date.now()
      if (now - lastSyncAt < 100) return
      lastSyncAt = now
      sync(false)
    }
    const onStorage = (e: StorageEvent) => {
      // 28-70: 스냅샷·커서 키의 이벤트는 세션과 무관하다 — 계정 키가 바뀌었을 때만 서버 세션(me)을 다시 본다
      if (e.key === null || e.key.startsWith('banded-'))
        sync(true, e.key === null || !e.key.startsWith('banded-platform'))
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncOnce()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', syncOnce)
    document.addEventListener('visibilitychange', onVisible)
    platform.onConflict = () => setSyncNotice('다른 탭의 변경과 겹쳤습니다 — 그 탭이 최신 상태로 갱신됩니다')
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', syncOnce)
      document.removeEventListener('visibilitychange', onVisible)
      platform.onConflict = undefined
    }
  }, [platform, auth, replication, authActions])
  // 28-77-03: 부팅 정리는 조용하지 않다 — 버린 것이 있으면 한 번 말한다(보관함은 "잃지 않기"의 장치다)
  useEffect(() => {
    if (trimmedStash > 0) {
      setSyncNotice(`저장 공간을 확보하려고 덮인 변경 보관함 ${trimmedStash}건을 정리했습니다`)
    }
  }, [trimmedStash])
  useEffect(() => {
    if (!syncNotice) return
    const t = setTimeout(() => setSyncNotice(null), 4000)
    return () => clearTimeout(t)
  }, [syncNotice])
  return (
    <PlatformContext.Provider
      value={{
        platform,
        auth,
        authActions,
        authMode: AUTH_MODE,
        refresh,
        saveError,
        syncNotice,
        replication,
        replicationStatus,
        lastProblem,
      }}
    >
      {children}
    </PlatformContext.Provider>
  )
}

/**
 * 동기화·충돌 안내 (28-55): 1회성 안내는 4초 뒤 사라진다.
 * 28-68-04a: 원격 복제의 **남은 문제**(`offline`·`rejected`)는 `lastProblem`으로 표시하고
 * `synced`가 될 때까지 내려가지 않는다 — 저장 한 번에 사라지지 않는다.
 * 로컬이 진실이므로 이것은 경고가 아니라 상태 안내다.
 */
export function SyncNoticeBanner() {
  const { syncNotice, lastProblem } = usePlatform()
  const problemText =
    lastProblem === null
      ? null
      : lastProblem.status === 'offline'
        ? '변경은 이 기기에 저장됐습니다 — 원격 반영은 연결되면 다시 시도합니다'
        : `원격 반영이 거부됐습니다 — ${lastProblem.detail ?? '원인 미상'}`
  const text = syncNotice ?? problemText
  if (!text) return null
  return (
    <div
      className="save-banner sync"
      role="status"
      data-sync-notice
      data-replication={lastProblem?.status ?? (syncNotice ? 'notice' : 'synced')}
    >
      {text}
    </div>
  )
}

/** 저장 실패 배너 (28-49-01): 앱 셸 헤더 아래. 다음 저장 성공 시 사라진다 */
export function SaveErrorBanner() {
  const { saveError } = usePlatform()
  if (!saveError) return null
  return (
    <div className="save-banner" role="alert" data-save-error>
      {saveError}
    </div>
  )
}

/** 로그인한 파트너의 id (28-41-01) — 견적·작업·정산의 partnerId. 세션이 없으면 구 스냅샷의 단일 프로필 id */
export function usePartnerId(): string {
  const { auth } = usePlatform()
  return auth.sessionFor('partner')?.accountId ?? PlatformService.LEGACY_PARTNER_ID
}

/**
 * 로그인한 관리자의 등급 (28-89-A). 관리자 세션이 없거나 28-89 이전 세션(등급 없음)이면 `undefined` —
 * 그러면 `useAdminCan`은 전부 `false`다. 옛 세션은 다시 로그인하면 등급이 실린다.
 */
export function useAdminGrade(): AdminGrade | undefined {
  const { auth } = usePlatform()
  return auth.sessionFor('admin')?.grade
}

/** 이 관리자가 이 행위를 할 수 있는가 — 버튼의 `disabled`와 안내 문구가 이것을 묻는다 */
export function useAdminCan(): (action: AdminAction) => boolean {
  const grade = useAdminGrade()
  return (action) => canAdmin(grade, action)
}

/** 버튼에 붙이는 안내 — 등급이 모자라면 왜 못 하는지 말한다 */
export function gradeHint(action: AdminAction): string {
  return `${ADMIN_GRADE_LABEL[ADMIN_MIN_GRADE[action]]} 이상만 할 수 있습니다`
}

export function usePlatform(): PlatformContextValue {
  const ctx = useContext(PlatformContext)
  if (!ctx) throw new Error('usePlatform은 PlatformProvider 안에서만 사용할 수 있습니다')
  return ctx
}
