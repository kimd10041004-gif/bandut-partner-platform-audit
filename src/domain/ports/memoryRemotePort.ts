import type { HeadResult, ReadResult, SnapshotPort, SnapshotRecord, WriteResult } from '../ports'

export interface MemoryRemoteOptions {
  /** 호출당 지연(ms) — 0이면 즉시 */
  latencyMs?: number
  /** 다음 N회 호출을 unavailable로 만든다 (오프라인·서버 오류 재현) */
  failNext?: number
  /** 초기 내용 */
  initial?: SnapshotRecord
}

/**
 * 가짜 원격 저장소 (28-67).
 *
 * 서버가 아직 없으므로, 경계가 **실제로 동작하는지** 증명할 수단이 필요하다.
 * 이 어댑터는 지연·실패·충돌을 주입할 수 있어서 복제기의 재시도·충돌 경로를 테스트가 직접 태울 수 있다.
 * 28-68에서 HTTP 어댑터로 갈아 끼울 자리이며, 계약 테스트(`ports.contract.test.ts`)는
 * 그 구현에도 **그대로** 적용된다.
 */
export class MemoryRemotePort implements SnapshotPort {
  readonly name = 'memory-remote'
  private record: SnapshotRecord | null
  private latencyMs: number
  private failNext: number
  /** 진단용 — 계약 테스트가 호출 횟수를 확인한다 */
  reads = 0
  writes = 0
  /** 28-69-01: rev만 확인한 횟수 — 본문 read와 구분한다 */
  heads = 0

  constructor(options: MemoryRemoteOptions = {}) {
    this.record = options.initial ?? null
    this.latencyMs = options.latencyMs ?? 0
    this.failNext = options.failNext ?? 0
  }

  /** 다음 N회 호출을 unavailable로 만든다 */
  failFor(n: number): void {
    this.failNext = n
  }

  /** 다른 기기가 먼저 쓴 상황을 만든다 */
  seed(rec: SnapshotRecord): void {
    this.record = rec
  }

  /** 원격이 사라진 상황을 만든다 (초기화·삭제) — 28-67-02c의 센티널 루프를 재현한다 */
  clear(): void {
    this.record = null
  }

  private async tick(): Promise<boolean> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs))
    if (this.failNext > 0) {
      this.failNext -= 1
      return false
    }
    return true
  }

  /** 28-69-01: rev만 */
  async head(): Promise<HeadResult> {
    this.heads += 1
    if (!(await this.tick())) return { ok: false, reason: 'unavailable', detail: '원격 저장소에 닿을 수 없습니다' }
    return { ok: true, rev: this.record === null ? null : this.record.rev }
  }

  /** 28-67-04: 던지지 않는다 — 실패도 결과값이다. 28-67에서는 여기만 맨 `Error`를 던져 계약이 갈렸다 */
  async read(): Promise<ReadResult> {
    this.reads += 1
    if (!(await this.tick())) return { ok: false, reason: 'unavailable', detail: '원격 저장소에 닿을 수 없습니다' }
    return { ok: true, record: this.record === null ? null : { ...this.record } }
  }

  async write(body: string, expectedRev: number | null): Promise<WriteResult> {
    this.writes += 1
    if (!(await this.tick())) return { ok: false, reason: 'unavailable', detail: '원격 저장소에 닿을 수 없습니다' }
    const currentRev = this.record === null ? null : this.record.rev
    if (currentRev !== expectedRev) {
      // 28-67-02c: 비었으면 센티널이 아니라 null
      return { ok: false, reason: 'conflict', remote: this.record === null ? null : { ...this.record } }
    }
    // 28-68-01: rev는 저장소가 발급한다
    const rev = (currentRev ?? 0) + 1
    this.record = { rev, body }
    return { ok: true, rev }
  }
}
