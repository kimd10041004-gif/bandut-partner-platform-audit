/**
 * 영속화 포트 (28-67) — 서버로 가는 경계.
 *
 * ## 왜 도메인을 비동기로 바꾸지 않는가
 *
 * 조사해 보니 이 앱은 UI가 도메인을 **동기로 부르고 반환값을 즉시 쓰는 곳이 245곳**이다
 * (`Jobs.tsx`가 `submitEstimate()`의 반환값으로 안내 문구를 조립하는 식). `this.save()` 호출은
 * **57개 메서드에 하나씩** 흩어져 있고, `AuthService`는 생성자에서 바로 `load()`를 부르며
 * (생성자는 await할 수 없다), `auth.sessionFor()`는 읽기처럼 보이지만 만료 시 쓰기를 하고
 * 그것이 **렌더 중에** 호출된다. 도메인 메서드를 Promise로 바꾸면 이 전부를 동시에 풀어야 한다.
 *
 * 그래서 경계를 다른 곳에 둔다. **도메인은 동기로 두고 로컬에 즉시 쓴다**(화면은 지금처럼 빠르고
 * 오프라인에서도 동작한다). 원격 반영은 뒤에서 도는 복제기(`replicator.ts`)가 맡는다.
 * 서버가 생기는 날 갈아 끼우는 것은 이 포트의 구현 하나뿐이다.
 *
 * ## 계약이 고치는 것
 *
 * 현재 `PlatformService.save()`는 "rev 읽기 → 본문 쓰기 → rev 쓰기"로 **2키 비원자 쓰기**를 한다.
 * 본문이 저장되고 rev 저장이 실패하는 창이 있다. 포트는 그 둘을 **한 번의 write**로 묶고,
 * `expectedRev`로 낙관적 동시성을 계약 수준에서 요구한다.
 */

/**
 * 저장 단위 (28-68-01 정정).
 *
 * `rev`는 **저장소가 발급한** 버전이다 — 도메인의 `revision`(기기별로 독립 증가하는 카운터)과는
 * **다른 숫자**다. 28-68은 도메인 rev를 그대로 저장소에 넣었는데, 두 기기가 각각 5번 저장하면
 * 둘 다 rev 5가 되어 `where rev = 5`가 양쪽 다 맞았다 — conflict가 한 번도 나지 않고 덮어썼다.
 * 저장소가 발급하면 rev는 "그 저장소에 몇 번째로 쓰였는가"라 기기와 무관하게 비교할 수 있다.
 */
export interface SnapshotRecord {
  /** 저장소가 발급한 버전. 쓰기마다 1씩 증가 */
  rev: number
  /** 직렬화된 스냅샷 본문 */
  body: string
}

/**
 * 읽기 결과 (28-67-04) — **`read()`는 던지지 않는다.**
 * 실패도 결과값이다. 28-68-03: 재시도해도 소용없는 실패(`rejected`)를 따로 둔다.
 */
export type ReadResult =
  | { ok: true; record: SnapshotRecord | null }
  /** 지금은 닿을 수 없다(오프라인·서버 오류) — 재시도 대상 */
  | { ok: false; reason: 'unavailable'; detail: string }
  /** 저장소가 거부했다(인증·형식·용량) — **재시도해도 소용없다.** 사람이 고쳐야 한다 */
  | { ok: false; reason: 'rejected'; status: number; detail: string }

export type WriteResult =
  /** 저장소가 발급한 새 rev */
  | { ok: true; rev: number }
  /**
   * 다른 쓰기가 먼저 들어왔다. `remote`에 그쪽 최신본이 담기고, **원격이 비어 있으면 `null`**이다 (28-67-02c).
   */
  | { ok: false; reason: 'conflict'; remote: SnapshotRecord | null }
  /** 지금은 닿을 수 없다 — 재시도 대상 */
  | { ok: false; reason: 'unavailable'; detail: string }
  /**
   * 저장소가 거부했다 — **재시도해도 소용없다** (28-68-03).
   * 28-68은 401·413·400을 전부 `unavailable`로 접어서, 토큰이 낡았거나 본문이 너무 큰 상황을
   * "오프라인"으로 보이게 하고 30초마다 영원히 다시 보냈다.
   */
  | { ok: false; reason: 'rejected'; status: number; detail: string }

/**
 * rev만 확인한 결과 (28-69-01). 탭 복귀처럼 "남이 썼는가"만 알면 되는 때 본문(최대 4MB)을 받지 않기 위한 것.
 * `rev`가 null이면 비어 있다.
 */
export type HeadResult =
  | { ok: true; rev: number | null }
  | { ok: false; reason: 'unavailable'; detail: string }
  | { ok: false; reason: 'rejected'; status: number; detail: string }

export interface SnapshotPort {
  /** 진단·로그에 쓰는 이름 */
  readonly name: string
  /** 현재 rev만 확인한다. **던지지 않는다.** 복제기의 focus 경로가 read 대신 이것을 부른다 (28-69-01) */
  head(): Promise<HeadResult>
  /** 읽는다. **던지지 않는다** — 실패는 결과값이다 */
  read(): Promise<ReadResult>
  /**
   * 낙관적 동시성 쓰기. **던지지 않는다.** 본문만 주고 rev는 돌려받는다.
   * `expectedRev`는 이 호출자가 마지막으로 본 저장소 rev(아직 아무것도 못 봤으면 null).
   * 저장소의 현재 rev와 다르면 conflict — 그 사이 남이 썼다는 뜻이다.
   */
  write(body: string, expectedRev: number | null): Promise<WriteResult>
}
