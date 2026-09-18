import type { StorageLike } from '../platform'
import type { HeadResult, ReadResult, SnapshotPort, WriteResult } from '../ports'

/**
 * localStorage 어댑터 (28-67).
 *
 * 키 레이아웃은 지금 쓰는 것과 **그대로** 유지한다 — 본문 `<key>`, 리비전 `<key>:rev`.
 * 기존 테스트가 이 키 이름과 본문 JSON 구조를 직접 단언하고 있고(`platform.test.ts`의 다중 탭 동기화,
 * `auth.test.ts`), 무엇보다 이미 저장된 사용자 데이터를 읽어야 한다.
 *
 * 이 어댑터는 도메인의 `save()`를 대체하지 않는다. 도메인은 지금처럼 로컬에 직접 쓴다.
 *
 * **어디에 쓰이는가 (28-67-03 정정):** 28-67의 독스트링은 *"복제기가 로컬을 읽는 데 쓴다"*고 적었지만
 * `initReplicator()`는 이 포트를 거치지 않고 `platform.exportData()`를 직접 읽는다 — 사실이 아니었다.
 * 지금 이 어댑터의 쓰임은 **계약 테스트의 대조 구현**이다. 서버 어댑터가 로컬 어댑터와
 * 같은 스위트를 통과하는지가 계약이 실제로 계약인지를 정하고, 그 대조 상대가 이것이다.
 *
 * **rev (28-68-01):** 이 어댑터가 `<key>:rev`에 쓰는 값은 **저장소 측 발급 rev**(쓰기마다 +1)이지
 * 도메인의 `revision`이 아니다. 둘은 같은 키 이름을 쓰지만 같은 키를 쓰지는 않는다
 * (프로덕션에서 이 어댑터는 도메인 키에 붙지 않는다).
 */
export class LocalSnapshotPort implements SnapshotPort {
  readonly name: string

  constructor(
    private readonly storage: StorageLike,
    private readonly key: string,
  ) {
    this.name = `local:${key}`
  }

  private get revKey(): string {
    return `${this.key}:rev`
  }

  /**
   * 동기 읽기. `read()`가 아니라 이것을 `write()` 안에서 쓴다 —
   * **await를 하나라도 끼우면 비교와 쓰기 사이에 다른 writer가 끼어든다.**
   * 계약 테스트의 "동시 writer 둘 중 하나만 성공"이 실제로 이걸 잡아냈다(둘 다 성공했다).
   * localStorage에는 compare-and-swap 원시 연산이 없으므로, 한 런타임 안에서 비교-쓰기 사이에
   * 양보하지 않는 것이 줄 수 있는 가장 강한 보장이다. 탭 사이는 rev 비교와 storage 이벤트가 맡는다.
   */
  private readSync(): ReadResult {
    let body: string | null
    let revRaw: string | null
    try {
      body = this.storage.getItem(this.key)
      revRaw = this.storage.getItem(this.revKey)
    } catch (err) {
      // 28-67-04: 접근 자체가 막힌 것(사생활 보호 모드·용량)을 "비어 있다"로 바꾸지 않는다.
      // 28-67은 여기서 null을 돌려줘서, 복제기가 "원격이 비었다"로 오해할 수 있었다.
      return {
        ok: false,
        reason: 'unavailable',
        detail: err instanceof Error && err.message ? err.message : String(err),
      }
    }
    if (body === null) return { ok: true, record: null }
    const rev = Number(revRaw)
    return { ok: true, record: { rev: Number.isFinite(rev) && rev >= 0 ? rev : 0, body } }
  }

  /** 28-67-04: 던지지 않는다 — 실패도 결과값이다 */
  async read(): Promise<ReadResult> {
    return this.readSync()
  }

  /** 28-69-01: rev만 — 본문을 읽지 않는다 */
  async head(): Promise<HeadResult> {
    const r = this.readSync()
    if (!r.ok) return r
    return { ok: true, rev: r.record === null ? null : r.record.rev }
  }

  async write(body: string, expectedRev: number | null): Promise<WriteResult> {
    // 여기부터 setItem까지 await가 없다 — 위 readSync 주석 참고
    const read = this.readSync()
    if (!read.ok) return { ok: false, reason: 'unavailable', detail: read.detail }
    const current = read.record
    const currentRev = current === null ? null : current.rev
    if (currentRev !== expectedRev) {
      // 다른 탭이 먼저 썼다(또는 지웠다). 마지막 쓰기 우선으로 덮지 않고 호출자에게 넘긴다.
      // 28-67-02c: 비었으면 센티널이 아니라 null이다.
      return { ok: false, reason: 'conflict', remote: current }
    }
    // 28-68-01: rev는 저장소가 발급한다
    const rev = (currentRev ?? 0) + 1
    try {
      this.storage.setItem(this.key, body)
      this.storage.setItem(this.revKey, String(rev))
      return { ok: true, rev }
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : String(err)
      return { ok: false, reason: 'unavailable', detail }
    }
  }
}
