import type { SnapshotPort, SnapshotRecord, WriteResult, ReadResult, HeadResult } from './ports'

/**
 * 복제 대상 (28-67) — 도메인 서비스를 그대로 받지 않고 이만큼만 요구한다.
 * `PlatformService`·`AuthService`를 **수정하지 않고** 바깥에서 감싸기 위한 좁은 인터페이스다.
 */
export interface ReplicationSource {
  readonly name: string
  /** 현재 리비전 (도메인의 `revision` 게터) — **이 브라우저 안에서만** 의미 있는 카운터다 (탭 사이는 storage로 단조) */
  revision(): number
  /** 지금 상태의 직렬화 본문 */
  body(): string
  /** 원격이 앞서 있을 때 받아들인다. 실패하면 던진다(손상된 본문은 적용하지 않는다) */
  accept(body: string): void
}

export type ReplicationStatus =
  /** 원격과 같다 */
  | 'synced'
  /** 보낼 변경이 있다 (조용해지면 보낸다) */
  | 'pending'
  /** 보내는 중 */
  | 'syncing'
  /** 닿을 수 없다 — 로컬은 정상, 백오프 뒤 다시 보낸다 */
  | 'offline'
  /** 원격이 앞서 있어 받아들였다 — 마지막 반영 이후의 로컬 변경은 덮였다 */
  | 'conflict'
  /** 원격이 거부했다(인증·용량·형식) — **재시도하지 않는다.** 사람이 고쳐야 한다 (28-68-03) */
  | 'rejected'

/** 예약 함수 — 취소 함수를 돌려준다. 테스트가 가짜를 넣는다 */
export type Scheduler = (fn: () => void, ms: number) => () => void

/**
 * 커서 저장소 (28-69-02). 복제기가 마지막으로 본 저장소 rev와 마지막으로 밀어 올린 로컬 revision을
 * **탭 사이에 공유**한다. 프로덕션은 localStorage(`<도메인 키>:remote`), 테스트는 Map.
 */
export interface CursorStore {
  get(): string | null
  set(value: string): void
}

export interface ReplicatorOptions {
  /** 재시도 간격 상한(ms). 기본 30_000 */
  maxBackoffMs?: number
  /** 변경 뒤 이만큼 조용하면 보낸다(ms). 기본 1_500 */
  pushDelayMs?: number
  /** 계속 편집해도 이 안에 한 번은 보낸다(ms). 기본 10_000 */
  maxPushWaitMs?: number
  /** 상태가 바뀔 때마다 호출 */
  onStatus?: (status: ReplicationStatus, detail?: string) => void
  /**
   * 예약 (28-68-02). 기본은 `setTimeout`. `null`이면 타이머를 아예 두지 않는다(수동 `sync()`만).
   * 테스트는 가짜 스케줄러를 넣어 **예약을 실제로 발화**시킨다.
   */
  schedule?: Scheduler | null
  /** 시계 (28-69-03b). 기본 `Date.now`. 테스트가 진행시킨다 */
  now?: () => number
  /** 탭 사이에 공유되는 커서 (28-69-02). 없으면 이 인스턴스 안에서만 기억한다 */
  cursor?: CursorStore
  /**
   * 덮이는 로컬 본문을 보관한다 (28-72-03). 통째 스냅샷은 병합할 수 없지만 — 그건 엔티티 단위 API의 일이다 —
   * **잃지 않는 것**은 지금도 할 수 있다. conflict로 원격을 받아들이기 **직전**, 아직 못 올린 로컬 변경이
   * 있을 때만 불린다. 던져도 동기화는 계속된다.
   */
  /**
   * 28-74-04: **보관했는지**를 돌려준다. 보관은 최선 노력이라(예산·할당량) 실패할 수 있는데,
   * 28-72~74의 문구는 언제나 "보관했습니다"라고 말했다 — 잃었을 때 잃지 않았다고 알린 셈이다.
   *
   * 28-75-01: `incomingChars` — **이번에 받아들일 원격 본문의 크기**다. 보관 직후 로컬은 그 본문으로
   * 갈리므로, 남은 자리를 지금 로컬로 재면 원격이 더 클 때 합계가 한도를 넘는다. 복제기는 그 크기를
   * 이미 손에 쥐고 있으니 함께 넘긴다 — 도메인은 여전히 저장소를 모른다(숫자 하나다).
   */
  stash?: (body: string, at: string, incomingChars: number) => boolean
}

const defaultSchedule: Scheduler = (fn, ms) => {
  const t = setTimeout(fn, ms)
  return () => clearTimeout(t)
}

interface Cursor {
  remoteRev: number | null
  localRev: number
}

/**
 * write-behind 복제기 (28-67 → 28-69 재설계 → 28-70 정정).
 *
 * 도메인은 지금처럼 **로컬에 동기로 즉시** 쓴다. 이 복제기가 뒤에서 원격으로 밀어 올린다.
 *
 * ## 두 종류의 숫자를 섞지 않는다 (28-68-01)
 *
 * - `source.revision()` — 도메인의 저장 카운터. 이 브라우저 안에서만 의미가 있다.
 * - `remoteRev` — **저장소가 발급한** rev. "그 저장소에 몇 번째로 쓰였는가". 기기와 무관하다.
 *
 * ## 커서는 브라우저 것이다 (28-69-02)
 *
 * 복제기 인스턴스는 탭마다 하나인데 로컬 진실(스냅샷·revision)은 브라우저 하나에 있다. 28-69는
 * `remoteRev`·`pushedLocalRev`를 인스턴스에만 두어, 탭1이 밀어 올린 것을 탭2가 자기 변경으로 오해해
 * 다시 쓰고(409) 같은 본문을 "받아들이며" 거짓 conflict 배너를 띄웠다 — 그리고 그 뒤 탭2의 진짜 변경이
 * 되돌려졌다. 지금은 `{remoteRev, localRev}`를 `CursorStore`에 저장하고 매 실행 앞에 읽는다.
 * 안전망으로, conflict의 원격 본문이 방금 보내려던 본문과 같으면 accept 없이 rev만 채택한다.
 *
 * ## 누가 이기는가 — 규칙 하나 (첫 접촉 정책)
 *
 * 1. 원격이 비었으면 밀어 올린다.
 * 2. 원격이 있고 **이 브라우저가 한 번도 밀어 올린 적 없으면**(커서 없음) 받아들인다(새 기기 합류).
 * 3. 그 뒤로는 "원격 rev가 내가 마지막으로 본 값과 다르다 ⇒ 남이 썼다 ⇒ 받아들인다".
 *    read 경로와 conflict 경로가 같은 규칙을 쓴다.
 *
 * 3번에서 **마지막 반영 이후의 로컬 변경은 덮인다.** 통째 스냅샷 모델은 병합할 수 없다 —
 * 그 사실을 숨기지 않고 `'conflict'` 상태로 올려 화면이 알린다. 병합은 엔티티 단위 API의 일이다.
 *
 * ## 규칙 3은 읽어야 성립한다 (28-69-01)
 *
 * 28-69는 첫 read 뒤 `needsRead`를 실패 때만 되돌려, 보기만 하는 기기가 남의 변경을 **쓰기 직전**에만
 * 알았다(탭 복귀 sync는 GET조차 없었다). 지금은 `sync({ checkRemote: true })`가 `head()`로 **rev만** 확인해
 * 다르면 read 경로를 태운다. 본문(최대 4MB)은 rev가 다를 때만 받는다. 직렬화는 여전히 로컬 변경이 있을 때만.
 *
 * ## 타이머 둘 (28-68-02)
 *
 * - `pushTimer` — 변경 뒤 조용해지면 보낸다(디바운스 + 최대 대기).
 * - `retryTimer` — 실패 뒤 지수 백오프. 이미 예약이 있으면 건드리지 않는다. `stop()`이 거둔 예약은
 *   `start()`가 다시 건다(28-69-03a — 그 사이 "offline ⇒ 재시도 예약 있음" 불변식이 깨져 있었다).
 */
export class Replicator {
  private status: ReplicationStatus = 'synced'
  private statusDetail: string | undefined
  /** 마지막으로 확인한 저장소 rev. null = 비었다. undefined = 아직 모른다 */
  private remoteRev: number | null | undefined
  /** 첫 동기화·재접속·거부 뒤 — write 전에 read부터 */
  private needsRead = true
  /** 마지막으로 밀어 올린(또는 받아들인) 도메인 revision. undefined = 아직 한 번도 */
  private pushedLocalRev: number | undefined
  private inFlight: Promise<void> | null = null
  /**
   * 보내는 도중에 또 요청이 왔다 — 끝나면 한 번 더. 요청들의 **합집합**을 기억한다: 다른 탭의 storage 이벤트
   * (`pushLocal:false`)만 쌓였는데 기본 옵션(push)으로 다시 돌면 그 탭이 밀어 올려 원래 탭과 409를 낸다
   * (28-70 서버 모드 e2e에서 실제로 났다 — 28-69-02의 마지막 조각)
   */
  private again: { checkRemote: boolean; pushLocal: boolean; waiters: Array<() => void> } | null = null
  private failures = 0
  private stopped = false
  /** stopped 중에 도착한 상태 — start()가 흘려보낸다 (28-69-03a) */
  private deferred: { status: ReplicationStatus; detail: string | undefined } | null = null
  private cancelPush: (() => void) | null = null
  private cancelRetry: (() => void) | null = null
  private firstChangeAt: number | undefined
  private readonly maxBackoffMs: number
  private readonly pushDelayMs: number
  private readonly maxPushWaitMs: number
  private readonly onStatus: ((s: ReplicationStatus, detail?: string) => void) | undefined
  private readonly schedule: Scheduler | null
  private readonly now: () => number
  private readonly cursor: CursorStore | undefined
  private readonly stash: ((body: string, at: string, incomingChars: number) => boolean) | undefined

  constructor(
    private readonly source: ReplicationSource,
    private readonly remote: SnapshotPort,
    options: ReplicatorOptions = {},
  ) {
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000
    this.pushDelayMs = options.pushDelayMs ?? 1_500
    this.maxPushWaitMs = options.maxPushWaitMs ?? 10_000
    this.onStatus = options.onStatus
    this.schedule = options.schedule === undefined ? defaultSchedule : options.schedule
    this.now = options.now ?? (() => Date.now())
    this.cursor = options.cursor
    this.stash = options.stash
  }

  currentStatus(): { status: ReplicationStatus; detail: string | undefined } {
    return { status: this.status, detail: this.statusDetail }
  }

  /** 다음 재시도까지 기다릴 시간(ms) — 지수 백오프, 상한 있음 */
  backoffMs(): number {
    if (this.failures === 0) return 0
    return Math.min(this.maxBackoffMs, 1000 * 2 ** (this.failures - 1))
  }

  /** 진행 중인 동기화(그리고 그 뒤에 이어지는 again 재실행)가 끝날 때까지 — 테스트가 기다린다 */
  async idle(): Promise<void> {
    while (this.inFlight !== null) {
      await this.inFlight
      await Promise.resolve()
    }
  }

  /** 예약을 모두 거두고 이후 예약을 막는다 (28-68-02d: 끈적인다 — 진행 중이던 sync가 끝나도 되살아나지 않는다) */
  stop(): void {
    this.stopped = true
    this.cancelPush?.()
    this.cancelRetry?.()
    this.cancelPush = null
    this.cancelRetry = null
    // 28-72-01: 큐에서 기다리던 호출자(예: 로그인)를 매달아 두지 않는다 — 이 예약은 이제 돌지 않는다
    const pending = this.again
    this.again = null
    if (pending !== null) for (const w of pending.waiters) w()
  }

  /**
   * `stop()`을 되돌린다 — React StrictMode 재마운트처럼 같은 인스턴스를 다시 쓰는 경우.
   * 28-69-03a: stop이 거둔 재시도 예약을 다시 걸고, stopped 중에 도착한 상태를 흘려보낸다.
   */
  start(): void {
    this.stopped = false
    const d = this.deferred
    this.deferred = null
    if (d !== null) this.setStatus(d.status, d.detail)
    else if (this.status === 'offline') this.armRetry()
  }

  private setStatus(status: ReplicationStatus, detail?: string): void {
    if (this.stopped) {
      this.deferred = { status, detail }
      return
    }
    // 결론이 난 상태는 낡은 재시도 예약을 버린다
    if (status === 'synced' || status === 'conflict' || status === 'rejected') {
      this.cancelRetry?.()
      this.cancelRetry = null
    }
    if (this.status !== status || this.statusDetail !== detail) {
      this.status = status
      this.statusDetail = detail
      this.onStatus?.(status, detail)
    }
    // offline만 재시도를 건다. pending은 pushTimer의 일이다 (28-68-02c: 0ms 스핀 금지)
    if (status === 'offline') this.armRetry()
  }

  private armRetry(): void {
    if (this.schedule === null || this.stopped) return
    if (this.cancelRetry !== null) return // 28-68-02b: 이미 예약이 있으면 건드리지 않는다
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = null
      void this.sync()
    }, this.backoffMs())
  }

  private armPush(): void {
    if (this.schedule === null || this.stopped) return
    const now = this.now()
    this.firstChangeAt ??= now
    this.cancelPush?.()
    // 디바운스하되, 첫 변경으로부터 maxPushWaitMs 안에는 반드시 한 번 보낸다
    const wait = Math.max(0, Math.min(this.pushDelayMs, this.firstChangeAt + this.maxPushWaitMs - now))
    this.cancelPush = this.schedule(() => {
      this.cancelPush = null
      this.firstChangeAt = undefined
      void this.sync()
    }, wait)
  }

  /** 도메인이 뭔가 저장했다 — 보낼 것이 생겼다 */
  markChanged(): void {
    if (this.stopped) return
    if (this.inFlight) {
      this.queueAgain({ checkRemote: false, pushLocal: true })
      return
    }
    // 28-68-02b: 오프라인이면 예약된 재시도가 최신 상태를 보낸다. 예약이 없으면(28-69-03a) 지금 건다
    if (this.status === 'offline') {
      this.armRetry()
      return
    }
    // rejected는 사람이 고쳐야 하는 상태지만, 다음 변경에서 한 번은 다시 시도한다(토큰이 갱신됐을 수 있다)
    this.setStatus('pending')
    this.armPush()
  }

  /**
   * 지금 한 번 맞춘다. 보내는 중이면 그 작업이 끝난 뒤 한 번 더 돈다(합쳐진다).
   * - `checkRemote`(탭 복귀·다른 탭 저장): 로컬 변경이 없어도 원격 rev를 확인한다 (28-69-01).
   * - `pushLocal: false`(다른 탭의 storage 이벤트): 받기만 하고 보내지 않는다 — 변경을 만든 탭이 디바운스 뒤에
   *   보낸다. 이 탭까지 보내면 저장마다 두 탭이 경쟁해 디바운스(28-68-02a)가 무의미해진다 (28-69-02).
   * **던지지 않는다.**
   */
  async sync(options: { checkRemote?: boolean; pushLocal?: boolean } = {}): Promise<void> {
    if (this.stopped) return
    if (this.inFlight) {
      // 28-72-01: 진행 중인 것은 **남의 sync**다. 그것을 돌려주면 호출자는 자기 일이 시작도 하기 전에 반환받는다
      // (로그인이 첫 접촉을 기다리려고 await하면 28-71-01의 증상이 그대로 재발한다). 내 요청은 again에 합치고,
      // 그 큐가 소화될 때 푼다.
      return new Promise<void>((resolve) => {
        this.queueAgain({ checkRemote: options.checkRemote === true, pushLocal: options.pushLocal !== false, resolve })
      })
    }
    this.cancelPush?.()
    this.cancelPush = null
    this.firstChangeAt = undefined
    this.inFlight = this.run(options.checkRemote === true, options.pushLocal !== false).finally(() => {
      this.inFlight = null
    })
    try {
      await this.inFlight
    } catch (err) {
      // 28-67-02a: run()은 던지지 않는 것이 계약이지만, 던지더라도 again이 고착되면 안 된다
      this.needsRead = true
      this.failures += 1
      this.setStatus('offline', err instanceof Error ? err.message : String(err))
    }
    const next = this.again
    if (next !== null) {
      this.again = null
      // 대기자는 이 재실행이 **끝난 뒤** 푼다. 던지더라도(계약상 없지만) 매달아 두지 않는다
      try {
        await this.sync(next)
      } finally {
        for (const w of next.waiters) w()
      }
    }
  }

  /** 합쳐진 요청들은 **하나의 재실행**을 공유한다 — 옵션은 합집합, 대기자는 이어 붙인다 (28-72-01) */
  private queueAgain(o: { checkRemote: boolean; pushLocal: boolean; resolve?: () => void }): void {
    const waiters = this.again === null ? [] : this.again.waiters
    if (o.resolve !== undefined) waiters.push(o.resolve)
    this.again =
      this.again === null
        ? { checkRemote: o.checkRemote, pushLocal: o.pushLocal, waiters }
        : {
            checkRemote: this.again.checkRemote || o.checkRemote,
            pushLocal: this.again.pushLocal || o.pushLocal,
            waiters,
          }
  }

  /** 커서 읽기 (28-69-02) — 다른 탭이 앞서 있으면 그쪽 값을 받는다 */
  private loadCursor(): void {
    if (!this.cursor) return
    let raw: string | null
    try {
      raw = this.cursor.get()
    } catch {
      return
    }
    if (raw === null) return
    let c: Cursor
    try {
      const o = JSON.parse(raw) as Partial<Cursor>
      if ((o.remoteRev !== null && typeof o.remoteRev !== 'number') || typeof o.localRev !== 'number') return
      c = { remoteRev: o.remoteRev, localRev: o.localRev }
    } catch {
      return
    }
    // 28-70-02: 커서가 로컬보다 앞설 수는 없다 — 그렇다면 로컬이 리셋된 것(손상 복구)이고 커서는 낡았다.
    // 낡은 커서를 채택하면 빈 로컬을 "내 변경"으로 밀어 올려 서버를 덮는다. 버리고 새 기기로 취급한다(규칙 2).
    if (c.localRev > this.source.revision()) return
    if (this.pushedLocalRev === undefined || c.localRev > this.pushedLocalRev) {
      this.remoteRev = c.remoteRev
      this.pushedLocalRev = c.localRev
    }
  }

  private saveCursor(): void {
    if (!this.cursor || this.remoteRev === undefined || this.pushedLocalRev === undefined) return
    const c: Cursor = { remoteRev: this.remoteRev, localRev: this.pushedLocalRev }
    try {
      this.cursor.set(JSON.stringify(c))
    } catch {
      // 저장 불가 — 이 인스턴스 안에서는 여전히 안다
    }
  }

  private async run(checkRemote: boolean, pushLocal: boolean): Promise<void> {
    if (this.stopped) return
    this.loadCursor()
    const localRev = this.source.revision()

    // 28-69-01: 탭 복귀 — 로컬 변경이 없어도 원격 rev를 확인한다(본문은 받지 않는다)
    if (checkRemote && !this.needsRead) {
      const h = await this.remote.head()
      if (!h.ok) return this.fail(h)
      if (h.rev !== (this.remoteRev ?? null)) this.needsRead = true
    }

    // 로컬이 안 바뀌었고 원격도 다시 볼 이유가 없으면 아무것도 하지 않는다 — 직렬화도 없다
    if (!this.needsRead && this.pushedLocalRev === localRev) {
      this.setStatus('synced')
      return
    }

    if (this.needsRead) {
      this.setStatus('syncing')
      const read = await this.remote.read()
      if (!read.ok) return this.fail(read)
      this.needsRead = false
      const remote = read.record
      const lastSeen = this.remoteRev ?? null
      const othersWrote = remote !== null && remote.rev !== lastSeen
      if (remote !== null && (this.pushedLocalRev === undefined || othersWrote)) {
        // 새 기기 합류, 또는 내가 못 본 사이 남이 썼다 → 원격을 받아들인다
        return this.acceptRemote(remote, localRev)
      }
      this.remoteRev = remote === null ? null : remote.rev
    }
    if (this.pushedLocalRev === localRev) {
      this.setStatus('synced')
      return
    }
    if (!pushLocal) {
      // 28-69-02: 보낼 것은 있지만 이 탭의 몫이 아니다 — 변경을 만든 탭이 보낸다. 커서로 그 결과를 알게 된다
      if (this.status === 'syncing') this.setStatus('pending')
      return
    }
    this.setStatus('syncing')

    const body = this.source.body()
    let res: WriteResult
    try {
      res = await this.remote.write(body, this.remoteRev ?? null)
    } catch (err) {
      // 28-67-02a: 계약을 어기고 던지는 어댑터도 결과값으로 정규화한다
      res = { ok: false, reason: 'unavailable', detail: err instanceof Error ? err.message : String(err) }
    }
    if (res.ok) {
      this.remoteRev = res.rev
      this.pushedLocalRev = localRev
      this.failures = 0
      this.saveCursor()
      this.setStatus('synced')
      return
    }
    if (res.reason === 'conflict') {
      // 28-68-02c: 원격이 비어 있어도 실패로 센다 — 백오프가 붙어 스핀하지 않는다
      this.failures += 1
      if (res.remote === null) {
        this.needsRead = true
        this.setStatus('offline', '원격 저장소가 비어 있어 다시 확인합니다')
        return
      }
      // 남이 썼다 → 받아들인다 (마지막 반영 이후의 로컬 변경은 덮인다)
      return this.acceptRemote(res.remote, localRev, body)
    }
    return this.fail(res)
  }

  /**
   * 원격 본문을 받아들인다. `accept()`가 던지면(손상 본문) 아무것도 갱신하지 않고 다음에 read부터 다시 한다
   * (28-67-02b). 성공하면 accept가 낸 save 뒤의 revision을 "이미 반영된 것"으로 기록해 되쓰기 루프를 막는다.
   * 28-69-02 안전망: 원격 본문이 내 본문과 같으면 받아들일 것이 없다 — rev만 채택하고 conflict를 내지 않는다.
   */
  private acceptRemote(remote: SnapshotRecord, localRev: number, localBody?: string): void {
    const mine = localBody ?? this.source.body()
    if (remote.body === mine) {
      this.remoteRev = remote.rev
      this.pushedLocalRev = localRev
      this.failures = 0
      this.saveCursor()
      this.setStatus('synced')
      return
    }
    // 28-72-03: 덮일 것이 있으면 **덮기 전에** 보관한다. 화면은 "덮였습니다"라고 알리지만
    // 28-72까지는 덮인 내용이 어디에도 남지 않았다 (accept 뒤 커서가 맞춰져 재푸시 경로도 사라진다)
    let stashed = false
    if (this.pushedLocalRev !== undefined && this.pushedLocalRev !== localRev) {
      try {
        // 28-75-01: 곧 로컬이 될 원격 본문의 크기를 함께 넘긴다
        stashed = this.stash?.(mine, new Date(this.now()).toISOString(), remote.body.length) === true
      } catch {
        // 보관 실패(용량 등)가 동기화를 막지는 않는다 — 다만 문구가 그것을 숨기지도 않는다
      }
    }
    try {
      if (remote.body !== '') this.source.accept(remote.body)
    } catch (err) {
      this.needsRead = true
      this.failures += 1
      this.setStatus('offline', err instanceof Error ? err.message : String(err))
      return
    }
    // 이 기기에 밀어 올리지 않은 변경이 있었는가 — 있었으면 그것이 덮였다. 없었으면 그냥 최신을 받은 것이다
    const overwroteLocal = this.pushedLocalRev !== undefined && this.pushedLocalRev !== localRev
    this.remoteRev = remote.rev
    this.pushedLocalRev = this.source.revision()
    this.failures = 0
    this.saveCursor()
    // 28-74-04: 보관했을 때만 보관했다고 말한다. 못 했으면 그렇게 말한다 — 사용자가 되살리기를 시도할지 정할 수 있게.
    //   28-75 리뷰(Copilot): 실패 **원인**은 단정하지 않는다. `stashed === false`는 예산 초과·할당량 초과만이
    //   아니라 저장소가 아예 없는 경우(비공개 모드 등)나 `stash`를 넘기지 않은 경우에도 나온다.
    //   원인을 찍어 말하면 이 항목이 없애려던 "말과 사실의 어긋남"을 다시 만드는 셈이다.
    //   28-75-04: **보관 기능이 없는 앱**(저장소 없음 → `stash`를 넘기지 않는다)에는 보관 이야기를 꺼내지
    //   않는다. 없는 것을 "못 했다"고 말하면 사용자는 없는 것을 찾으러 나선다.
    this.setStatus(
      'conflict',
      !overwroteLocal
        ? '다른 기기의 변경을 받아들였습니다'
        : this.stash === undefined
          ? '다른 기기의 변경을 받아들였습니다 — 이 기기에서 반영되지 않은 변경은 덮였습니다'
          : stashed
            ? '다른 기기의 변경을 받아들였습니다 — 이 기기에서 반영되지 않은 변경은 덮였습니다(덮인 내용은 보관했습니다)'
            : '다른 기기의 변경을 받아들였습니다 — 이 기기에서 반영되지 않은 변경은 덮였습니다(보관하지 못했습니다)',
    )
  }

  private fail(
    res:
      | Exclude<HeadResult, { ok: true }>
      | Exclude<ReadResult, { ok: true }>
      | Exclude<WriteResult, { ok: true } | { reason: 'conflict' }>,
  ): void {
    if (res.reason === 'rejected') {
      // 28-68-03: 재시도해도 소용없다 — 예약하지 않는다. 다음 markChanged/focus 때 한 번 더 본다.
      // 28-69-04b: 인증 문제(401·403)만 원격을 다시 읽을 이유가 된다. 413·400·422는 원격이 바뀌었다는 뜻이 아니다
      if (res.status === 401 || res.status === 403) this.needsRead = true
      this.setStatus('rejected', `${res.detail} (HTTP ${res.status})`)
      return
    }
    this.needsRead = true
    this.failures += 1
    this.setStatus('offline', res.detail)
  }
}
