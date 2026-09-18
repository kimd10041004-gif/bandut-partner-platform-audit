import { describe, it, expect } from 'vitest'
import {
  Replicator,
  type ReplicationSource,
  type ReplicationStatus,
  type ReplicatorOptions,
  type Scheduler,
} from './replicator'
import { MemoryRemotePort } from './ports/memoryRemotePort'
import type { SnapshotPort } from './ports'
import { PlatformService } from './platform'

/** ReadResult에서 record만 꺼낸다 — 실패면 테스트가 여기서 깨진다 */
async function recordOf(port: SnapshotPort) {
  const r = await port.read()
  if (!r.ok) throw new Error(`read 실패: ${r.detail}`)
  return r.record
}

/** 도메인을 수정하지 않고 감싸는 어댑터 — 실제 배선(PlatformContext)과 같은 모양 */
function platformSource(p: PlatformService): ReplicationSource {
  return {
    name: 'platform',
    revision: () => p.revision,
    body: () => p.exportData(),
    accept: (body) => p.importSnapshot(body),
  }
}

function fakeSource(): ReplicationSource & { rev: number; text: string; accepted: string[]; bodyCalls: number } {
  return {
    name: 'fake',
    rev: 0,
    text: '{}',
    accepted: [],
    bodyCalls: 0,
    revision() {
      return this.rev
    },
    body() {
      this.bodyCalls += 1
      return this.text
    },
    // 실제 importSnapshot처럼 accept는 save()를 내어 revision을 올린다
    accept(body: string) {
      this.accepted.push(body)
      this.text = body
      this.rev += 1
    },
  }
}

/**
 * 가짜 스케줄러 (28-68-02e) — 예약을 목록에 쌓고 테스트가 **직접 발화**시킨다.
 * 28-68의 테스트는 `scheduleRetry: null`로 타이머를 꺼 놓아, 프로덕션에서 유일한 트리거인
 * `markChanged → 타이머 → sync`를 한 번도 태우지 않았다. 이제 그 경로가 테스트의 대상이다.
 */
function fakeScheduler() {
  const queue: Array<{ fn: () => void; ms: number; id: number }> = []
  let seq = 0
  const schedule: Scheduler = (fn, ms) => {
    const id = (seq += 1)
    queue.push({ fn, ms, id })
    return () => {
      const i = queue.findIndex((q) => q.id === id)
      if (i >= 0) queue.splice(i, 1)
    }
  }
  return {
    schedule,
    queue,
    delays: () => queue.map((q) => q.ms),
    /** n번째 예약을 발화시키고 그 sync가 끝날 때까지 기다린다 (28-69-03c: 실제 시간이 아니라 inFlight를 기다린다) */
    async fire(n = 0, rep?: Replicator) {
      const q = queue.splice(n, 1)[0]
      if (!q) throw new Error('예약이 없다')
      q.fn()
      if (rep) await rep.idle()
      else await new Promise((r) => setTimeout(r, 5))
    },
  }
}

/** 타이머 없는 복제기 — 수동 sync()만으로 결정적 경로를 볼 때 */
function manual(src: ReplicationSource, remote: SnapshotPort, options: ReplicatorOptions = {}): Replicator {
  return new Replicator(src, remote, { schedule: null, ...options })
}

describe('복제기 (28-67)', () => {
  it('로컬 변경을 원격으로 밀어 올린다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const rep = manual(src, remote)
    src.rev = 1
    src.text = '{"a":1}'
    rep.markChanged()
    expect(rep.currentStatus().status).toBe('pending')
    await rep.sync()
    expect(rep.currentStatus().status).toBe('synced')
    expect(await remote.read()).toEqual({ ok: true, record: { rev: 1, body: '{"a":1}' } })
  })

  it('보내는 도중의 변경을 합쳐서 마지막 상태만 보낸다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort({ latencyMs: 10 })
    const rep = manual(src, remote)
    src.rev = 1
    src.text = '{"n":1}'
    const first = rep.sync()
    src.rev = 2
    src.text = '{"n":2}'
    rep.markChanged()
    src.rev = 3
    src.text = '{"n":3}'
    rep.markChanged()
    await first
    expect(await remote.read()).toEqual({ ok: true, record: { rev: 2, body: '{"n":3}' } })
    expect(remote.writes).toBe(2)
  })

  it('원격에 닿을 수 없으면 offline이 되고 백오프가 자란다 — 로컬은 그대로다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const seen: ReplicationStatus[] = []
    const rep = manual(src, remote, { onStatus: (s) => seen.push(s) })
    src.rev = 1
    src.text = '{"a":1}'
    remote.failFor(3)
    await rep.sync()
    expect(rep.currentStatus().status).toBe('offline')
    expect(rep.backoffMs()).toBe(1000)
    await rep.sync()
    expect(rep.backoffMs()).toBe(2000)
    await rep.sync()
    expect(rep.backoffMs()).toBe(4000)
    // 시도마다 syncing → offline을 거친다 — 화면은 lastProblem으로 안정화한다(28-68-04a)
    expect(seen).toEqual(['syncing', 'offline', 'syncing', 'offline', 'syncing', 'offline'])
    expect(src.text).toBe('{"a":1}')
  })

  it('닿게 되면 다시 성공하고 백오프가 0으로 돌아간다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const rep = manual(src, remote, { maxBackoffMs: 4000 })
    src.rev = 1
    src.text = '{"a":1}'
    remote.failFor(5)
    for (let i = 0; i < 5; i += 1) await rep.sync()
    expect(rep.backoffMs()).toBe(4000)
    await rep.sync()
    expect(rep.currentStatus().status).toBe('synced')
    expect(rep.backoffMs()).toBe(0)
    expect(await remote.read()).toEqual({ ok: true, record: { rev: 1, body: '{"a":1}' } })
  })

  it('새 기기가 합류하면 원격을 받아들인다 — 남의 변경을 덮지 않는다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    remote.seed({ rev: 9, body: '{"다른기기":true}' })
    const rep = manual(src, remote)
    src.rev = 3
    src.text = '{"내것":true}'
    await rep.sync()
    expect(rep.currentStatus().status).toBe('conflict')
    expect(src.accepted).toEqual(['{"다른기기":true}'])
    expect(await remote.read()).toEqual({ ok: true, record: { rev: 9, body: '{"다른기기":true}' } })
  })

  it('실제 PlatformService를 감싸도 왕복한다', async () => {
    const a = new PlatformService()
    a.addRequest({
      customerName: '김반듯',
      customerId: 'AC-0001',
      region: '서울 강서구',
      category: '주방·욕실 공사',
      description: '실리콘 재시공',
      desiredDate: '2026-09-10',
      desiredTime: '오전',
    })
    const remote = new MemoryRemotePort()
    const rep = manual(platformSource(a), remote)
    await rep.sync()
    expect(rep.currentStatus().status).toBe('synced')
    const b = new PlatformService()
    const pushed = await remote.read()
    if (!pushed.ok || pushed.record === null) throw new Error('원격이 비어 있다')
    b.importSnapshot(pushed.record.body)
    expect(b.store.list()).toHaveLength(1)
    expect(b.store.list()[0]!.description).toBe('실리콘 재시공')
  })
})

/**
 * 28-68-01 회귀. rev를 기기별 카운터로 쓰던 28-68에서는, 로컬 revision이 같은 두 기기 중
 * 두 번째가 **conflict 없이** 첫 번째를 덮었다(감사의 5단계 시나리오 그대로).
 * 저장소가 rev를 발급하면 두 번째는 원격이 있음을 보고 받아들인다.
 */
describe('저장소 발급 rev (28-68-01)', () => {
  it('로컬 revision이 같은 두 기기 — 두 번째가 conflict 없이 덮지 않는다', async () => {
    const remote = new MemoryRemotePort()
    const a = fakeSource()
    a.rev = 5
    a.text = '{"A":1}'
    const b = fakeSource()
    b.rev = 5
    b.text = '{"B":1}'
    const ra = manual(a, remote)
    const rb = manual(b, remote)
    await ra.sync()
    await rb.sync()
    expect(b.accepted).toEqual(['{"A":1}']) // 수정 전: []
    expect(await remote.read()).toEqual({ ok: true, record: { rev: 1, body: '{"A":1}' } }) // 수정 전: '{"B":1}'
    expect(rb.currentStatus().status).toBe('conflict')
  })

  it('한 기기가 밀어 올린 뒤 다른 기기가 쓰면, 첫 기기는 다음 sync에서 그것을 받아들인다', async () => {
    const remote = new MemoryRemotePort()
    const a = fakeSource()
    a.rev = 1
    a.text = '{"A":1}'
    const b = fakeSource()
    b.rev = 1
    b.text = '{"B":1}'
    const ra = manual(a, remote)
    const rb = manual(b, remote)
    await ra.sync() // A → rev 1
    await rb.sync() // B는 새 기기 → A를 받아들인다
    b.rev += 1
    b.text = '{"B":2}'
    await rb.sync() // B → rev 2 (기대값 1)
    expect((await recordOf(remote))?.rev).toBe(2)
    a.rev += 1
    a.text = '{"A":2}'
    await ra.sync() // A: 기대값 1 → conflict → 받아들인다 (A의 변경은 덮인다)
    expect(a.accepted).toEqual(['{"B":2}'])
    expect(ra.currentStatus().status).toBe('conflict')
    expect((await recordOf(remote))?.body).toBe('{"B":2}')
  })

  it('원격 rev와 로컬 revision은 다른 숫자다 — 로컬 revision이 아무리 커도 원격을 되감지 않는다', async () => {
    const remote = new MemoryRemotePort()
    const src = fakeSource()
    src.rev = 500
    src.text = '{"n":500}'
    await manual(src, remote).sync()
    expect((await recordOf(remote))?.rev).toBe(1)
  })
})

/** 28-67-02 회귀 — 실제 원격이 붙는 날 발현하는 결함들 */
describe('복제기 결함 회귀 (28-67-02)', () => {
  function throwingWritePort(): SnapshotPort {
    return {
      name: 'throwing-write',
      async head() {
        return { ok: true, rev: null }
      },
      async read() {
        return { ok: true, record: null }
      },
      async write() {
        throw new TypeError('Failed to fetch')
      },
    }
  }

  it('(a) write가 던져도 offline으로 내려가고 again이 고착되지 않는다', async () => {
    const src = fakeSource()
    const rep = manual(src, throwingWritePort())
    src.rev = 1
    src.text = '{"a":1}'
    await expect(rep.sync()).resolves.toBeUndefined()
    expect(rep.currentStatus().status).toBe('offline')
    expect(rep.backoffMs()).toBeGreaterThan(0)
    src.rev = 2
    await expect(rep.sync()).resolves.toBeUndefined()
    expect(rep.currentStatus().status).toBe('offline')
  })

  it('(b) accept가 던지면 원격을 덮지 않고 다음 sync가 다시 read부터 한다', async () => {
    const src = fakeSource()
    let reads = 0
    const remote: SnapshotPort = {
      name: 'corrupt-remote',
      async head() {
        return { ok: true, rev: 9 }
      },
      async read() {
        reads += 1
        return { ok: true, record: { rev: 9, body: '손상된 본문' } }
      },
      async write() {
        throw new Error('여기까지 오면 안 된다 — 남의 변경을 덮는 것이다')
      },
    }
    src.rev = 1
    src.accept = () => {
      throw new Error('스냅샷 형식이 올바르지 않습니다')
    }
    const rep = manual(src, remote)
    await rep.sync()
    expect(rep.currentStatus().status).toBe('offline')
    expect(reads).toBe(1)
    await rep.sync()
    expect(reads).toBe(2)
  })

  it('(c) 원격이 사라져도 무한 conflict가 아니라 다시 읽고 새로 쓴다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const rep = manual(src, remote)
    src.rev = 5
    src.text = '{"n":5}'
    await rep.sync()
    remote.clear()
    src.rev = 6
    src.text = '{"n":6}'
    await rep.sync() // conflict(remote: null) → offline, 다음에 read부터
    await rep.sync() // read → 비었음 → 새로 쓴다
    expect(rep.currentStatus().status).toBe('synced')
    expect(await remote.read()).toEqual({ ok: true, record: { rev: 1, body: '{"n":6}' } })
  })

  it('(d) 오프라인이었다가 돌아오면 stale한 rev로 쓰지 않고 read부터 다시 한다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const rep = manual(src, remote)
    src.rev = 1
    src.text = '{"n":1}'
    await rep.sync()
    remote.failFor(1)
    src.rev = 2
    src.text = '{"n":2}'
    await rep.sync()
    expect(rep.currentStatus().status).toBe('offline')
    remote.seed({ rev: 9, body: '{"다른기기":true}' })
    const readsBefore = remote.reads
    await rep.sync()
    expect(remote.reads).toBe(readsBefore + 1)
    expect(src.accepted).toEqual(['{"다른기기":true}'])
    expect(rep.currentStatus().status).toBe('conflict')
  })
})

/**
 * 28-68-02 회귀 — 28-68이 배선을 살리면서 만든 결함 넷. 전부 **타이머가 켜진 채로** 확인한다.
 */
describe('배선 결함 회귀 (28-68-02)', () => {
  it('(a) 저장 5회 연속 → 직렬화 1회 (디바운스)', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const sch = fakeScheduler()
    const rep = new Replicator(src, remote, { schedule: sch.schedule })
    for (let i = 1; i <= 5; i += 1) {
      src.rev = i
      src.text = `{"n":${i}}`
      rep.markChanged()
    }
    expect(sch.queue).toHaveLength(1) // 예약은 하나로 합쳐진다
    await sch.fire(0, rep)
    expect(src.bodyCalls).toBe(1) // 수정 전: 5 (저장마다 0ms 뒤 전체 직렬화)
    expect(await remote.read()).toEqual({ ok: true, record: { rev: 1, body: '{"n":5}' } })
    expect(rep.currentStatus().status).toBe('synced')
  })

  it('(a-2) 계속 편집해도 maxPushWaitMs 안에 한 번은 보낸다 — 가짜 시계 (28-69-03b)', () => {
    // 28-69 감사: 이전 판은 `≤ 1500`·`≥ 0`만 단언해 어떤 구현도 통과했다. 시계를 주입해 실제로 진행시킨다.
    const src = fakeSource()
    const sch = fakeScheduler()
    let t = 1_000_000
    const rep = new Replicator(src, new MemoryRemotePort(), {
      schedule: sch.schedule,
      pushDelayMs: 1500,
      maxPushWaitMs: 3000,
      now: () => t,
    })
    src.rev = 1
    rep.markChanged()
    expect(sch.delays()).toEqual([1500])
    t += 2000
    src.rev = 2
    rep.markChanged()
    expect(sch.delays()).toEqual([1000]) // 수정 전: [1500] (now 주입이 없어 진행시킬 수 없었다)
    t += 1500
    src.rev = 3
    rep.markChanged()
    expect(sch.delays()).toEqual([0]) // 첫 변경으로부터 3000ms — 지금 보낸다
  })

  it('(b) offline 중 저장을 반복해도 재시도 예약은 취소·재예약되지 않는다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const sch = fakeScheduler()
    const rep = new Replicator(src, remote, { schedule: sch.schedule })
    src.rev = 1
    src.text = '{"n":1}'
    remote.failFor(99)
    await rep.sync()
    expect(rep.currentStatus().status).toBe('offline')
    const retry = sch.queue[0]
    expect(retry).toBeDefined()
    for (let i = 2; i <= 20; i += 1) {
      src.rev = i
      rep.markChanged()
    }
    expect(sch.queue).toHaveLength(1)
    expect(sch.queue[0]?.id).toBe(retry?.id) // 수정 전: 매번 취소·재예약되어 id가 바뀌었다
  })

  it('(c) 원격이 계속 비어 있어도 0ms 스핀이 아니라 백오프가 붙는다', async () => {
    const src = fakeSource()
    const remote: SnapshotPort = {
      name: 'always-empty-conflict',
      async head() {
        return { ok: true, rev: null }
      },
      async read() {
        return { ok: true, record: null }
      },
      async write() {
        return { ok: false, reason: 'conflict', remote: null }
      },
    }
    const sch = fakeScheduler()
    const rep = new Replicator(src, remote, { schedule: sch.schedule })
    src.rev = 1
    src.text = '{"n":1}'
    await rep.sync()
    const delays = [sch.delays()[0]]
    await sch.fire(0, rep) // 재시도 발화 → 또 conflict(null) → 다음 예약
    delays.push(sch.delays()[0])
    await sch.fire(0, rep)
    delays.push(sch.delays()[0])
    expect(delays).toEqual([1000, 2000, 4000]) // 수정 전: [0, 0, 0]
    expect(sch.queue).toHaveLength(1) // 예약은 늘 하나
  })

  it('(d) 진행 중인 sync가 있어도 stop() 뒤에는 예약이 생기지 않는다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort({ latencyMs: 20 })
    const sch = fakeScheduler()
    const rep = new Replicator(src, remote, { schedule: sch.schedule })
    src.rev = 1
    src.text = '{"n":1}'
    remote.failFor(1)
    const inflight = rep.sync()
    rep.stop()
    await inflight
    expect(sch.queue).toHaveLength(0) // 수정 전: 1 (떨어져 나간 복제기가 계속 깨어났다)
    rep.start()
    rep.markChanged()
    expect(sch.queue).toHaveLength(1) // start() 뒤에는 다시 예약된다
  })

  it('(e) markChanged → 타이머 → 원격에 실제로 써진다 (프로덕션 트리거)', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const sch = fakeScheduler()
    const rep = new Replicator(src, remote, { schedule: sch.schedule })
    src.rev = 1
    src.text = '{"n":1}'
    rep.markChanged()
    expect(await remote.read()).toEqual({ ok: true, record: null })
    await sch.fire(0, rep)
    expect(await remote.read()).toEqual({ ok: true, record: { rev: 1, body: '{"n":1}' } })
  })

  it('변경이 없으면 focus sync는 직렬화하지 않는다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const rep = manual(src, remote)
    src.rev = 1
    src.text = '{"a":1}'
    await rep.sync()
    expect(src.bodyCalls).toBe(1)
    await rep.sync()
    await rep.sync()
    expect(src.bodyCalls).toBe(1)
  })

  it('저장 성공이 onSaved로 나온다 — 복제기가 변경을 아는 경로 (28-67-03)', () => {
    const p = new PlatformService()
    let saves = 0
    p.onSaved = () => {
      saves += 1
    }
    p.addRequest({
      customerName: '김반듯',
      customerId: 'AC-0001',
      region: '서울 강서구',
      category: '주방·욕실 공사',
      description: '실리콘 재시공',
      desiredDate: '2026-09-10',
      desiredTime: '오전',
    })
    expect(saves).toBeGreaterThan(0)
  })
})

/** 28-68-03 회귀 — 재시도해도 소용없는 거부 */
describe('거부(rejected) (28-68-03)', () => {
  it('원격이 거부하면 rejected가 되고 재시도를 예약하지 않는다', async () => {
    const src = fakeSource()
    const remote: SnapshotPort = {
      name: 'rejecting',
      async head() {
        return { ok: true, rev: null }
      },
      async read() {
        return { ok: true, record: null }
      },
      async write() {
        return { ok: false, reason: 'rejected', status: 401, detail: '인증이 필요합니다' }
      },
    }
    const sch = fakeScheduler()
    const rep = new Replicator(src, remote, { schedule: sch.schedule })
    src.rev = 1
    src.text = '{"n":1}'
    await rep.sync()
    expect(rep.currentStatus()).toEqual({ status: 'rejected', detail: '인증이 필요합니다 (HTTP 401)' })
    expect(sch.queue).toHaveLength(0)
    // 다음 변경에서는 한 번 더 시도한다(토큰이 갱신됐을 수 있다)
    src.rev = 2
    rep.markChanged()
    expect(sch.queue).toHaveLength(1)
  })
})

/**
 * 28-69 감사 회귀 — "붙이면 무슨 일이 나는가"를 기준으로 읽은 결함들.
 */
describe('28-69 감사 회귀', () => {
  /** 탭 사이에 공유되는 커서 저장소 — 프로덕션에서는 localStorage `banded-platform-v1:remote` */
  function cursorStore() {
    const m = new Map<string, string>()
    return { get: () => m.get('c') ?? null, set: (v: string) => void m.set('c', v) }
  }

  it('01: 보기만 하는 기기도 focus sync({checkRemote})에서 남의 변경을 받아들인다', async () => {
    const remote = new MemoryRemotePort()
    const a = fakeSource()
    a.rev = 1
    a.text = '{"A":1}'
    const b = fakeSource()
    b.rev = 1
    b.text = '{"B":1}'
    const ra = manual(a, remote)
    const rb = manual(b, remote)
    await ra.sync() // A → rev 1
    await rb.sync() // B 합류 → A를 받아들인다
    b.rev += 1
    b.text = '{"B":2}'
    await rb.sync() // B → rev 2
    const readsBefore = remote.reads
    await ra.sync({ checkRemote: true }) // A: 로컬 변경 없음 — 그래도 원격 rev를 확인한다
    expect(a.accepted).toEqual(['{"B":2}']) // 수정 전: [] (조기 반환 — GET조차 없다)
    expect(remote.reads).toBe(readsBefore + 1)
    expect(ra.currentStatus().status).toBe('conflict')
  })

  it('01-b: focus sync는 rev만 확인하고, 같으면 본문을 받지 않는다', async () => {
    const remote = new MemoryRemotePort()
    const src = fakeSource()
    src.rev = 1
    src.text = '{"a":1}'
    const rep = manual(src, remote)
    await rep.sync()
    const reads = remote.reads
    await rep.sync({ checkRemote: true })
    await rep.sync({ checkRemote: true })
    expect(remote.heads).toBe(2) // rev 확인 2회
    expect(remote.reads).toBe(reads) // 본문은 받지 않는다
    expect(src.bodyCalls).toBe(1) // 직렬화도 없다 (28-68-02a 유지)
  })

  it('02: 같은 브라우저의 두 탭 — 탭2가 탭1의 push를 conflict로 만들지 않고, 진짜 변경이 되돌려지지 않는다', async () => {
    const cursor = cursorStore()
    const remote = new MemoryRemotePort()
    const tab1 = fakeSource()
    tab1.rev = 6
    tab1.text = '{"n":6}'
    const tab2 = fakeSource()
    tab2.rev = 5
    tab2.text = '{"n":5}'
    const r1 = manual(tab1, remote, { cursor })
    const r2 = manual(tab2, remote, { cursor })
    await r1.sync() // 탭1 push → 원격 rev 1
    tab2.rev = 6
    tab2.text = tab1.text // 탭2: storage 이벤트 → syncFromStorage — 로컬 진실이 같아졌다
    await r2.sync()
    expect(remote.writes).toBe(1) // 수정 전: 2 (헛 write → 409)
    expect(tab2.accepted).toEqual([]) // 수정 전: ['{"n":6}'] (같은 본문을 "받아들였다")
    expect(r2.currentStatus().status).toBe('synced') // 수정 전: 'conflict' (거짓 배너)
    tab1.rev = tab2.rev
    tab1.text = tab2.text // 탭1: storage 이벤트(탭2 쪽 save가 있었다면)
    await r1.sync()
    expect(remote.writes).toBe(1) // 수정 전: 3 (헛 업로드)
    tab2.rev += 1
    tab2.text = '{"n":"진짜 변경"}' // 탭2의 진짜 변경
    await r2.sync()
    expect(tab2.text).toBe('{"n":"진짜 변경"}') // 수정 전: '{"n":6}' (되돌려짐)
    expect((await recordOf(remote))?.body).toBe('{"n":"진짜 변경"}')
    expect(r2.currentStatus().status).toBe('synced')
  })

  it('02-c: 다른 탭의 storage 이벤트는 받기만 한다 — 보내는 것은 변경을 만든 탭의 디바운스 몫이다', async () => {
    const cursor = cursorStore()
    const remote = new MemoryRemotePort()
    const sch = fakeScheduler()
    const tab1 = fakeSource()
    tab1.rev = 1
    tab1.text = '{"n":1}'
    const tab2 = fakeSource()
    tab2.rev = 1
    tab2.text = '{"n":1}'
    const r1 = new Replicator(tab1, remote, { cursor, schedule: sch.schedule })
    const r2 = manual(tab2, remote, { cursor })
    await r1.sync() // 둘 다 원격 rev 1을 안다(커서)
    await r2.sync({ checkRemote: true })
    expect(remote.writes).toBe(1)
    tab1.rev = 2
    tab1.text = '{"n":2}'
    r1.markChanged() // 탭1 저장 → push 예약(디바운스)
    tab2.rev = 2
    tab2.text = '{"n":2}' // 탭2: storage 이벤트 → syncFromStorage
    await r2.sync({ checkRemote: true, pushLocal: false })
    expect(remote.writes).toBe(1) // 탭2는 보내지 않았다
    await sch.fire(0, r1) // 탭1의 디바운스가 보낸다
    expect(remote.writes).toBe(2)
    expect((await recordOf(remote))?.body).toBe('{"n":2}')
    await r2.sync({ checkRemote: true }) // 탭2: 커서로 탭1의 push를 안다 → 보낼 것 없음
    expect(remote.writes).toBe(2)
    expect(r2.currentStatus().status).toBe('synced')
  })

  it('02-b: 커서 없이도 conflict의 원격 본문이 내 본문과 같으면 받아들이지 않고 rev만 채택한다 (안전망)', async () => {
    const remote = new MemoryRemotePort()
    const a = fakeSource()
    a.rev = 3
    a.text = '{"같음":1}'
    const b = fakeSource()
    b.rev = 3
    b.text = '{"같음":1}'
    await manual(a, remote).sync()
    const rb = manual(b, remote)
    // b는 이미 pushedLocalRev를 안다고 가정(첫 접촉 정책을 지나갔다) — 원격 rev 1을 모른 채 쓴다
    remote.seed({ rev: 1, body: '{"같음":1}' })
    b.rev = 4
    await rb.sync() // 첫 접촉: 원격이 있으니 받아들인다 — 같은 본문
    expect(b.accepted).toEqual([]) // 수정 전: ['{"같음":1}']
    expect(rb.currentStatus().status).toBe('synced') // 수정 전: 'conflict'
  })

  it('02-c2: 진행 중에 쌓인 storage 이벤트 sync들은 다시 돌 때도 보내지 않는다 (again의 합집합)', async () => {
    const cursor = cursorStore()
    const remote = new MemoryRemotePort({ latencyMs: 15 })
    const tab1 = fakeSource()
    tab1.rev = 1
    tab1.text = '{"n":1}'
    const tab2 = fakeSource()
    tab2.rev = 1
    tab2.text = '{"n":1}'
    const r1 = manual(tab1, remote, { cursor })
    const r2 = manual(tab2, remote, { cursor })
    await r1.sync()
    await r2.sync() // 탭2도 커서를 안다
    tab1.rev = 2
    tab1.text = '{"n":2}'
    tab2.rev = 2
    tab2.text = tab1.text // 탭1 저장 → storage 이벤트 둘(본문·rev)
    const first = r2.sync({ checkRemote: true, pushLocal: false })
    void r2.sync({ checkRemote: true, pushLocal: false }) // 진행 중 → again
    await first
    await r2.idle()
    expect(remote.writes).toBe(1) // 수정 전: 2 (again이 기본 옵션으로 돌아 탭2가 밀어 올렸다)
    await r1.sync() // 변경을 만든 탭이 보낸다
    expect(remote.writes).toBe(2)
    expect(r1.currentStatus().status).toBe('synced')
  })

  it('02-d: 손상 리셋 뒤 낡은 커서 — 빈 로컬로 서버를 덮지 않고 원격을 받아들인다 (28-70-02)', async () => {
    const cursor = cursorStore()
    const remote = new MemoryRemotePort()
    // 이 브라우저가 예전에 rev 40까지 밀어 올렸다(원격 rev 7). 그 뒤 스냅샷이 손상돼 도메인이 새 인스턴스(rev 0)로 리셋됐다
    cursor.set(JSON.stringify({ remoteRev: 7, localRev: 40 }))
    remote.seed({ rev: 7, body: '{"마켓플레이스":"전체"}' })
    // 복제기 수준의 방어: 아직 save()가 없어 revision 0 — 커서(40)가 로컬보다 앞선다 → 커서를 버린다.
    // (첫 save가 `max(0, stored 40)+1 = 41`로 뛰어 커서가 유효해 보이는 경우는 bootstrap이 리셋 때 커서를 지워 막는다 — bootstrap.test.ts)
    const src = fakeSource()
    src.rev = 0
    src.text = '{}'
    const rep = manual(src, remote, { cursor })
    await rep.sync()
    expect((await recordOf(remote))?.body).toBe('{"마켓플레이스":"전체"}') // 수정 전: '{}' (빈 본문으로 덮었다)
    expect(src.accepted).toEqual(['{"마켓플레이스":"전체"}'])
    expect(rep.currentStatus().status).toBe('conflict')
  })

  it('03-a: offline 중 stop()→start() 뒤에도 재시도가 다시 예약된다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const sch = fakeScheduler()
    const rep = new Replicator(src, remote, { schedule: sch.schedule })
    src.rev = 1
    src.text = '{"n":1}'
    remote.failFor(1)
    await rep.sync()
    expect(rep.currentStatus().status).toBe('offline')
    expect(sch.queue).toHaveLength(1)
    rep.stop()
    expect(sch.queue).toHaveLength(0)
    rep.start()
    expect(sch.queue).toHaveLength(1) // 수정 전: 0 — markChanged도 offline이라 아무것도 안 했다
    rep.markChanged()
    expect(sch.queue).toHaveLength(1)
    await sch.fire(0, rep)
    expect(rep.currentStatus().status).toBe('synced')
  })

  it('03-a2: stopped 중의 실패는 start() 뒤 상태로 흘러나온다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort({ latencyMs: 20 })
    const sch = fakeScheduler()
    const seen: ReplicationStatus[] = []
    const rep = new Replicator(src, remote, { schedule: sch.schedule, onStatus: (s) => seen.push(s) })
    src.rev = 1
    src.text = '{"n":1}'
    remote.failFor(1)
    const inflight = rep.sync()
    rep.stop()
    await inflight
    rep.start()
    expect(rep.currentStatus().status).toBe('offline') // 수정 전: 'syncing' (얼어붙음)
    expect(seen).toContain('offline')
    expect(sch.queue).toHaveLength(1)
  })

  it('04-b: 413 뒤의 재시도는 원격 본문을 다시 읽지 않는다', async () => {
    const src = fakeSource()
    let reads = 0
    let rejectOnce = true
    const remote: SnapshotPort = {
      name: 'too-large-once',
      async head() {
        return { ok: true, rev: null }
      },
      async read() {
        reads += 1
        return { ok: true, record: null }
      },
      async write(_body, expectedRev) {
        if (rejectOnce) {
          rejectOnce = false
          return { ok: false, reason: 'rejected', status: 413, detail: '스냅샷이 너무 큽니다' }
        }
        return { ok: true, rev: (expectedRev ?? 0) + 1 }
      },
    }
    const sch = fakeScheduler()
    const rep = new Replicator(src, remote, { schedule: sch.schedule })
    src.rev = 1
    src.text = '{"n":1}'
    await rep.sync()
    expect(rep.currentStatus().status).toBe('rejected')
    expect(reads).toBe(1)
    src.rev = 2
    src.text = '{"n":2}'
    rep.markChanged()
    await sch.fire(0, rep)
    expect(reads).toBe(1) // 수정 전: 2 (413은 원격이 바뀌었다는 뜻이 아니다)
    expect(rep.currentStatus().status).toBe('synced')
  })
})

/**
 * 28-72-01: `sync()`는 **자기 일**이 끝나는 Promise를 돌려줘야 한다.
 *
 * 28-72까지는 진행 중인 동기화가 있으면 `return this.inFlight` — 즉 **남의 sync**를 돌려줬다.
 * `authActions.login()`이 첫 접촉을 기다리려고 그것을 await하면, 자기 `checkRemote`가 시작도 하기 전에
 * 반환된다. 28-71-01이 고치려던 증상(로그인 직후의 프로필 시드가 뒤늦은 accept에 덮인다)이 그대로 재발한다.
 */
describe('sync는 자기 일이 끝나야 resolve된다 (28-72-01)', () => {
  /** write에서 멈춰 있는 포트 — 그 사이에 다른 sync를 걸 수 있다 */
  function haltingPort() {
    let headsDone = 0
    let releaseWrite: () => void = () => {}
    let entered: () => void = () => {}
    const enteredWrite = new Promise<void>((r) => {
      entered = r
    })
    const port: SnapshotPort = {
      name: 'halting',
      // 실제 네트워크처럼 한 틱(매크로태스크) 걸린다 — 마이크로태스크로 끝나면 이 결함이 가려진다
      async head() {
        await new Promise((r) => setTimeout(r, 0))
        headsDone += 1
        return { ok: true, rev: 7 }
      },
      async read() {
        await new Promise((r) => setTimeout(r, 0))
        return { ok: true, record: null }
      },
      async write() {
        entered()
        await new Promise<void>((r) => {
          releaseWrite = r
        })
        return { ok: true, rev: 1 }
      },
    }
    return { port, enteredWrite, release: () => releaseWrite(), headsDone: () => headsDone }
  }

  it('진행 중 push가 있을 때 뒤이은 sync는 자기 원격 확인이 끝나기 전에 resolve되지 않는다', async () => {
    const src = fakeSource()
    src.rev = 1
    const h = haltingPort()
    const rep = new Replicator(src, h.port, { schedule: null })
    const first = rep.sync() // read(null) → push → write에서 멈춘다
    await h.enteredWrite
    let headsAtResolve = -1
    const second = rep.sync({ checkRemote: true }).then(() => {
      headsAtResolve = h.headsDone()
    })
    h.release()
    await second
    // 수정 전: 0 (남의 push가 끝나자마자 반환했다 — 자기 head는 시작도 안 했다)
    expect(headsAtResolve).toBe(1)
    await first
    await rep.idle()
  })

  it('stop()은 대기 중인 sync를 매달아 두지 않는다', async () => {
    const src = fakeSource()
    src.rev = 1
    const h = haltingPort()
    const rep = new Replicator(src, h.port, { schedule: null })
    const first = rep.sync()
    await h.enteredWrite
    let settled = false
    const waiting = rep.sync({ checkRemote: true }).then(() => {
      settled = true
    })
    rep.stop() // 언마운트 — 예약을 거둔다
    h.release()
    await waiting // 수정 전: 영원히 pending (테스트가 타임아웃)
    expect(settled).toBe(true)
    await first
  })
})

/**
 * 28-72-03: conflict로 원격을 받아들일 때 **덮이는 로컬 본문**을 버리지 않는다.
 * 병합은 여전히 불가능하지만(통째 스냅샷), 덮인 내용이 어디에도 남지 않던 것은 고칠 수 있다.
 */
describe('덮이는 본문은 보관한다 (28-72-03)', () => {
  it('conflict로 덮일 때 덮인 로컬 본문이 stash로 넘어온다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const stashed: Array<{ body: string; at: string }> = []
    const rep = new Replicator(src, remote, {
      schedule: null,
      stash: (body, at) => {
        stashed.push({ body, at })
        return true
      },
    })

    src.text = '{"mine":1}'
    src.rev = 1
    await rep.sync() // 원격이 비었다 → 밀어 올린다
    expect(stashed).toHaveLength(0)

    await remote.write('{"others":1}', 1) // 남이 썼다
    src.text = '{"mine":2}' // 그리고 이 기기도 바꿨다 — 아직 못 올렸다
    src.rev = 2
    await rep.sync() // conflict → 받아들인다(내 변경은 덮인다)

    expect(rep.currentStatus().status).toBe('conflict')
    // 수정 전: 0 (덮인 본문은 어디에도 남지 않았다)
    expect(stashed).toHaveLength(1)
    expect(stashed[0]!.body).toBe('{"mine":2}')
    expect(stashed[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  /**
   * 28-75-01: 예산을 재는 시점은 `accept` **직전**이라, 그때의 로컬 크기로 재면 곧 들어올 원격 본문을 놓친다.
   * 원격이 더 크면 보관 뒤 합계가 한도를 넘어 그 기기의 저장이 다시 막힌다 — 28-74-01이 없앴다고 적은 상태다.
   * 복제기는 그 크기를 이미 손에 쥐고 있다(`remote.body`). 그것을 함께 넘겨야 한다.
   */
  it('보관 콜백이 받아들일 원격 본문의 크기를 함께 받는다 (28-75-01)', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const seen: Array<{ body: string; incoming: number }> = []
    const rep = new Replicator(src, remote, {
      schedule: null,
      stash: (body, _at, incoming) => {
        seen.push({ body, incoming: incoming ?? -1 })
        return true
      },
    })

    src.text = '{"mine":1}'
    src.rev = 1
    await rep.sync()
    const remoteBody = '{"others":1,"big":"' + 'x'.repeat(50) + '"}'
    await remote.write(remoteBody, 1)
    src.text = '{"mine":2}'
    src.rev = 2
    await rep.sync()

    expect(seen).toHaveLength(1)
    expect(seen[0]!.body).toBe('{"mine":2}')
    // 수정 전: 세 번째 인자가 없어 -1 (복제기가 크기를 알면서도 알려 주지 않았다)
    expect(seen[0]!.incoming).toBe(remoteBody.length)
  })

  /**
   * 28-75-04(b): `stash`를 아예 넘기지 않은 앱(저장소 없음)에는 보관 기능이 없다.
   * 그런데도 "보관하지 못했습니다"라고 말하면, 사용자는 **없는 것**을 찾으러 나선다.
   */
  it('보관 기능이 없으면 보관 이야기를 꺼내지 않는다 (28-75-04)', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const rep = new Replicator(src, remote, { schedule: null }) // stash 없음

    src.text = '{"mine":1}'
    src.rev = 1
    await rep.sync()
    await remote.write('{"others":1}', 1)
    src.text = '{"mine":2}'
    src.rev = 2
    await rep.sync()

    const { detail } = rep.currentStatus()
    expect(detail).toContain('덮였습니다')
    expect(detail).not.toContain('보관했습니다')
    expect(detail).not.toContain('보관하지 못했습니다') // 수정 전: 이렇게 말했다
  })

  /**
   * 28-74-04: 보관은 **최선 노력**이다 — 예산을 넘거나 저장소가 던지면 보관되지 않는다.
   * 그때도 문구가 "보관했습니다"라고 말하면, 잃었을 때 잃지 않았다고 알리는 셈이다.
   */
  it('보관하지 못하면 문구가 보관했다고 말하지 않는다 (28-74-04)', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const rep = new Replicator(src, remote, { schedule: null, stash: () => false }) // 자리가 없어 보관 못 함

    src.text = '{"mine":1}'
    src.rev = 1
    await rep.sync()
    await remote.write('{"others":1}', 1)
    src.text = '{"mine":2}'
    src.rev = 2
    await rep.sync()

    const { status, detail } = rep.currentStatus()
    expect(status).toBe('conflict')
    expect(detail).toContain('덮였습니다') // 덮인 것은 사실대로 말한다
    expect(detail).not.toContain('보관했습니다') // 수정 전: 보관하지 못했는데도 이렇게 말했다
    expect(detail).toContain('보관하지 못했습니다')
    // 28-75 리뷰: 실패 원인은 단정하지 않는다 — 자리가 없어서일 수도, 저장소가 아예 없어서일 수도 있다
    expect(detail).not.toContain('저장 공간')
  })

  it('보관에 성공하면 보관했다고 말한다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const rep = new Replicator(src, remote, { schedule: null, stash: () => true })

    src.text = '{"mine":1}'
    src.rev = 1
    await rep.sync()
    await remote.write('{"others":1}', 1)
    src.text = '{"mine":2}'
    src.rev = 2
    await rep.sync()

    expect(rep.currentStatus().detail).toContain('보관했습니다')
  })

  it('덮일 것이 없으면(새 기기 합류) 보관하지 않는다', async () => {
    const src = fakeSource()
    const remote = new MemoryRemotePort()
    const stashed: string[] = []
    await remote.write('{"others":1}', null)
    const rep = new Replicator(src, remote, {
      schedule: null,
      stash: (body) => {
        stashed.push(body)
        return true
      },
    })
    await rep.sync() // 커서 없음 → 규칙 2로 받아들인다
    expect(src.accepted).toHaveLength(1)
    expect(stashed).toHaveLength(0)
  })
})
