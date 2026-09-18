import { describe, it, expect } from 'vitest'
import {
  clearStaleCursor,
  CURSOR_KEY,
  OVERWRITTEN_KEY,
  OVERWRITTEN_MAX,
  OVERWRITTEN_BUDGET,
  readOverwritten,
  stashOverwritten,
  overwrittenChars,
  clearOverwritten,
  trimOverwritten,
} from './bootstrap'
import type { StorageLike } from '../domain/platform'
import { memoryStorage } from '../../server/domain/memoryStorage'

/** 28-70-02: 손상 리셋 뒤 남은 커서가 빈 로컬을 서버 위에 쓰지 않게 — 리셋된 브라우저는 새 기기다 */
describe('리셋된 브라우저의 커서 (28-70-02)', () => {
  it('복원되지 않은(fresh) 플랫폼이면 커서를 지운다', () => {
    const s = memoryStorage()
    s.setItem(CURSOR_KEY, JSON.stringify({ remoteRev: 7, localRev: 40 }))
    s.setItem('banded-platform-v1:rev', '40') // 도메인의 rev 키는 손상 리셋 뒤에도 남는다
    clearStaleCursor(s, true)
    expect(s.getItem(CURSOR_KEY)).toBeNull() // 수정 전: 커서가 남아 첫 save(rev 41) 뒤 빈 본문을 밀어 올렸다
  })

  it('복원된 플랫폼이면 커서를 그대로 둔다', () => {
    const s = memoryStorage()
    s.setItem(CURSOR_KEY, JSON.stringify({ remoteRev: 7, localRev: 40 }))
    clearStaleCursor(s, false)
    expect(s.getItem(CURSOR_KEY)).not.toBeNull()
  })

  it('저장소가 없거나 던져도 조용히 지나간다', () => {
    clearStaleCursor(undefined, true)
    clearStaleCursor(
      {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {
          throw new Error('x')
        },
      },
      true,
    )
  })
})

/**
 * 28-73-02: 28-72-03의 보관함은 복제기 쪽에서 **콜백 스텁**으로만 검증됐다 — 실제 구현(상한·예산·내성)은
 * 테스트가 하나도 없었다. 28-72-04b가 "복제기가 지키는 계약을 복제기 없이 검증했다"고 지적한 것과 같은 모양이라
 * 여기서 구현을 직접 태운다.
 */

describe('덮인 변경 보관함 (28-72-03 · 28-73-01/02)', () => {
  it('최근 것이 앞에 오고 개수 상한을 넘지 않는다', () => {
    const s = memoryStorage()
    for (let i = 0; i < OVERWRITTEN_MAX + 2; i += 1) {
      stashOverwritten(s, `{"n":${i}}`, `2026-09-0${i + 1}T00:00:00.000Z`)
    }
    const list = readOverwritten(s)
    expect(list).toHaveLength(OVERWRITTEN_MAX)
    expect(list[0]!.body).toBe(`{"n":${OVERWRITTEN_MAX + 1}}`) // 마지막에 넣은 것이 맨 앞
  })

  it('예산을 넘으면 오래된 것부터 버린다', () => {
    const s = memoryStorage()
    // 예산의 60%짜리 본문 둘 — 합치면 예산을 넘는다
    const big = (tag: string) =>
      `"${tag.repeat(Math.floor((OVERWRITTEN_BUDGET * 0.6) / 1))}"`.slice(0, Math.floor(OVERWRITTEN_BUDGET * 0.6))
    stashOverwritten(s, big('a'), '2026-09-01T00:00:00.000Z')
    stashOverwritten(s, big('b'), '2026-09-02T00:00:00.000Z')
    const list = readOverwritten(s)
    // 수정 전: 둘 다 남아 예산(한도의 1/4)을 넘었다
    expect(list).toHaveLength(1)
    expect(list[0]!.at).toBe('2026-09-02T00:00:00.000Z')
    expect(overwrittenChars(s)).toBeLessThanOrEqual(OVERWRITTEN_BUDGET)
  })

  it('본문 하나도 예산에 안 들어가면 아예 보관하지 않는다 — 저장을 막느니 포기한다', () => {
    const s = memoryStorage()
    stashOverwritten(s, 'x'.repeat(OVERWRITTEN_BUDGET + 10), '2026-09-01T00:00:00.000Z')
    expect(readOverwritten(s)).toHaveLength(0)
    expect(overwrittenChars(s)).toBe(0)
  })

  it('손상된 값·배열 아닌 값은 빈 목록으로 읽는다 (보관함 때문에 앱이 깨지지 않는다)', () => {
    const s = memoryStorage()
    s.data.set(OVERWRITTEN_KEY, '{')
    expect(readOverwritten(s)).toEqual([])
    s.data.set(OVERWRITTEN_KEY, '{"at":"x"}')
    expect(readOverwritten(s)).toEqual([])
    s.data.set(OVERWRITTEN_KEY, '[{"at":"a"},{"at":"b","body":"ok"}]')
    expect(readOverwritten(s)).toHaveLength(1) // 모양이 맞는 것만
  })

  it('setItem이 던져도(할당량 초과) 예외가 새지 않는다', () => {
    const s = memoryStorage()
    const throwing: StorageLike = {
      ...s,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => stashOverwritten(throwing, '{"a":1}', '2026-09-01T00:00:00.000Z')).not.toThrow()
  })

  it('비우면 보관함이 사라지고 용량도 0이 된다', () => {
    const s = memoryStorage()
    stashOverwritten(s, '{"a":1}', '2026-09-01T00:00:00.000Z')
    expect(overwrittenChars(s)).toBeGreaterThan(0)
    clearOverwritten(s)
    expect(readOverwritten(s)).toEqual([])
    expect(overwrittenChars(s)).toBe(0)
  })

  it('저장소가 없으면 조용히 아무 일도 하지 않는다', () => {
    expect(() => stashOverwritten(undefined, '{"a":1}', 'x')).not.toThrow()
    expect(readOverwritten(undefined)).toEqual([])
    expect(overwrittenChars(undefined)).toBe(0)
  })
})

/**
 * 28-74-01: 보관함이 **정식으로 용량을 먹기 시작한 뒤**로는, 보관 자체가 이 기기의 저장을 막을 수 있다.
 * 28-74의 예산은 한도의 1/4로 고정이라 스냅샷이 이미 76%를 쓰고 있어도 그만큼을 더 쓴다 —
 * 그러면 `assertRoom`이 합계로 막는다. 보관함을 비울 수 있는 화면은 관리자에게만 있으므로,
 * 파트너 기기는 풀 방법 없이 막힌다. 예산은 **남은 자리**를 넘지 않아야 한다.
 */
describe('보관은 남은 자리를 넘지 않는다 (28-74-01)', () => {
  it('남은 자리보다 큰 본문은 보관하지 않는다', () => {
    const s = memoryStorage()
    stashOverwritten(s, 'x'.repeat(50_000), '2026-01-01T00:00:00.000Z', 1_000) // 자리가 1,000자뿐
    expect(readOverwritten(s)).toHaveLength(0) // 수정 전: 예산 고정이라 보관됐다
  })

  it('남은 자리에 맞춰 오래된 것부터 버린다', () => {
    const s = memoryStorage()
    stashOverwritten(s, 'a'.repeat(2_000), '2026-01-01T00:00:00.000Z', 100_000)
    stashOverwritten(s, 'b'.repeat(2_000), '2026-01-02T00:00:00.000Z', 100_000)
    expect(readOverwritten(s)).toHaveLength(2)
    // 자리가 줄었다 — 최근 것 하나만 들어간다
    stashOverwritten(s, 'c'.repeat(2_000), '2026-01-03T00:00:00.000Z', 2_100)
    const kept = readOverwritten(s)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.at).toBe('2026-01-03T00:00:00.000Z')
  })

  it('보관 여부를 돌려준다 — 문구가 사실을 말할 수 있게 (28-74-04)', () => {
    const s = memoryStorage()
    expect(stashOverwritten(s, 'ok', '2026-01-01T00:00:00.000Z', 100_000)).toBe(true)
    expect(stashOverwritten(s, 'x'.repeat(50_000), '2026-01-02T00:00:00.000Z', 1_000)).toBe(false)
    expect(stashOverwritten(undefined, 'ok', '2026-01-03T00:00:00.000Z', 100_000)).toBe(false)
    const throws: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    }
    expect(stashOverwritten(throws, 'ok', '2026-01-04T00:00:00.000Z', 100_000)).toBe(false)
  })

  it('예산을 넘겨받지 않으면 기존 상한(OVERWRITTEN_BUDGET)을 쓴다', () => {
    const s = memoryStorage()
    expect(stashOverwritten(s, 'ok', '2026-01-01T00:00:00.000Z')).toBe(true)
    expect(readOverwritten(s)).toHaveLength(1)
  })
})

/**
 * 28-75-02: 28-74는 **프로덕션에 나갔고**, 그때 고정 예산으로 쓰인 보관함이 실제 기기에 남아 있다.
 * 28-75는 앞으로의 보관만 고쳤다 — `stashOverwritten`은 예산에 안 들어가면 아무것도 쓰지 않고 돌아가므로
 * 이미 쓰인 초과분은 그대로 남는다. 그리고 그것이 남아 있는 기기가 바로 저장이 막힌 기기다.
 * 부팅 때 한 번 맞춰 보면 그 기기는 즉시 풀린다.
 */
describe('부팅 때 보관함을 예산에 맞춘다 (28-75-02)', () => {
  it('예산을 넘는 보관함은 오래된 것부터 잘라 낸다', () => {
    const s = memoryStorage()
    // 28-74가 남긴 모양: 예산을 넘는 항목 셋
    s.setItem(
      OVERWRITTEN_KEY,
      JSON.stringify([
        { at: '2026-01-03T00:00:00.000Z', body: 'c'.repeat(2_000) },
        { at: '2026-01-02T00:00:00.000Z', body: 'b'.repeat(2_000) },
        { at: '2026-01-01T00:00:00.000Z', body: 'a'.repeat(2_000) },
      ]),
    )
    const removed = trimOverwritten(s, 2_200)
    expect(removed).toBe(2)
    const kept = readOverwritten(s)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.at).toBe('2026-01-03T00:00:00.000Z') // 최근 것이 남는다
  })

  it('하나도 안 들어가면 비운다 — 꺼낼 수 없는 1MB보다 쓸 수 있는 1MB가 낫다', () => {
    const s = memoryStorage()
    s.setItem(OVERWRITTEN_KEY, JSON.stringify([{ at: '2026-01-01T00:00:00.000Z', body: 'a'.repeat(5_000) }]))
    expect(trimOverwritten(s, 100)).toBe(1)
    expect(readOverwritten(s)).toHaveLength(0)
    expect(s.getItem(OVERWRITTEN_KEY)).toBeNull() // 키 자체가 사라진다(용량이 실제로 돌아온다)
  })

  it('예산 안이면 손대지 않는다 — 원문이 그대로다', () => {
    const s = memoryStorage()
    stashOverwritten(s, 'ok', '2026-01-01T00:00:00.000Z', 100_000)
    const before = s.getItem(OVERWRITTEN_KEY)
    expect(trimOverwritten(s, 100_000)).toBe(0)
    expect(s.getItem(OVERWRITTEN_KEY)).toBe(before)
  })

  it('보관함이 없거나 저장소가 없으면 조용히 0', () => {
    expect(trimOverwritten(memoryStorage(), 1_000)).toBe(0)
    expect(trimOverwritten(undefined, 1_000)).toBe(0)
  })
})

/**
 * 28-77-04: **배선에 회귀를 건다.** 28-75-02의 실제 약속은 "부팅 때 보관함을 예산에 맞춘다"인데,
 * 28-76까지의 테스트는 `trimOverwritten`만 직접 태웠다 — `initPlatform()`에서 그 호출을 지워도
 * 448건이 전부 초록이었다(28-76 감사 04에 출력을 인용했다). 여기서는 **부팅 경로를 그대로 탄다**.
 *
 * `browserStorage()`가 `window.localStorage`를 읽으므로 그 자리에 가짜를 세운다 — 이 파일에서만.
 */
describe('부팅 배선 (28-77-04)', () => {
  it('initPlatform이 예산 밖 보관함을 실제로 줄이고, 줄인 개수를 알려 준다', async () => {
    const store = memoryStorage()
    const big = 'X'.repeat(OVERWRITTEN_BUDGET) // 예산을 통째로 넘기는 한 건
    store.setItem(OVERWRITTEN_KEY, JSON.stringify([{ at: '2026-09-01T00:00:00.000Z', body: big }]))
    const original = Reflect.get(globalThis, 'window')
    Reflect.set(globalThis, 'window', { localStorage: store })
    try {
      const { initPlatform } = await import('./bootstrap')
      const { trimmedStash } = initPlatform()
      // 수정 전(배선이 없으면): trimmedStash가 애초에 없고, 보관함도 그대로 남는다
      expect(trimmedStash).toBe(1)
      expect(readOverwritten(store)).toHaveLength(0)
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, 'window')
      else Reflect.set(globalThis, 'window', original)
    }
  })

  /**
   * 28-91: 시연 시드를 없앴다 — 빈 저장소로 부팅하면 **요청이 0건**이고, 쓸 것이 없으니 **저장소도 건드리지
   * 않는다**. 첫 쓰기(요청 등록)부터 저장된다 — 그것이 부팅 배선이 살아 있다는 증거다. (#249 리뷰: 처음에는
   * "그래도 스냅샷은 저장된다"고 적어 단언과 모순됐다.) 28-77~28-78이 여기서 잡던 것("시드가 던져 부팅이
   * 통째로 실패")은 시드와 함께 사라졌다.
   */
  it('빈 저장소로 부팅하면 요청 0건 — 시연 데이터를 넣지 않는다 (28-91)', async () => {
    const store = memoryStorage()
    const original = Reflect.get(globalThis, 'window')
    Reflect.set(globalThis, 'window', { localStorage: store })
    try {
      const { initPlatform } = await import('./bootstrap')
      const { platform } = initPlatform()
      const snap = JSON.parse(platform.exportData()) as { store: { requests: unknown[] } }
      expect(snap.store.requests).toHaveLength(0) // 수정 전: 시연 일감 3 + 정산 이력 3 = 6건이 들어 있었다
      expect(store.getItem('banded-platform-v1')).toBeNull() // 쓸 것이 없으면 저장소도 건드리지 않는다
      platform.addRequest({
        customerName: '정지훈',
        region: '서울 강서구',
        category: '급배수·누수·설비',
        description: '첫 요청',
        desiredDate: '2026-12-01',
      })
      expect(store.getItem('banded-platform-v1')).not.toBeNull() // 첫 쓰기부터 저장된다(부팅 배선이 살아 있다)
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, 'window')
      else Reflect.set(globalThis, 'window', original)
    }
  })
})

/**
 * 28-79-02: 부팅과 런타임이 **같은 기준**으로 보관함을 줄인다. 28-78은 부팅은 예산(한도−스냅샷),
 * 런타임은 "모자란 만큼만"이라 서로 달랐다 — 간신히 통과한 기기가 다음 저장에서 또 걸리고, 그때마다
 * 조금씩 지워졌으며 그 지움은 기록에도 남지 않았다.
 */
describe('정리 정책은 하나다 (28-79-02)', () => {
  it('런타임 정리도 예산까지 줄이고, 운영 기록에 남는다', async () => {
    const store = memoryStorage()
    const original = Reflect.get(globalThis, 'window')
    Reflect.set(globalThis, 'window', { localStorage: store })
    try {
      const { initPlatform } = await import('./bootstrap')
      const { platform } = initPlatform()
      // 부팅 뒤에 보관함을 예산 밖으로 만든다 — 런타임에만 걸리는 상황이다
      const big = 'Z'.repeat(OVERWRITTEN_BUDGET)
      store.setItem(OVERWRITTEN_KEY, JSON.stringify([{ at: '2026-09-02T00:00:00.000Z', body: big }]))
      const before = overwrittenChars(store)
      const req = platform.addRequest({
        customerName: '정지훈',
        region: '서울 강서구',
        category: '급배수·누수·설비',
        description: '사진을 붙일 요청',
        desiredDate: '2026-12-01',
      })

      const usage = platform.storageUsage()
      const extra = usage.limit - usage.chars - 100_000 // 보관함까지 더하면 넘는다
      platform.addPhoto(req.id, {
        id: 'p1',
        dataUrl: `data:image/png;base64,${'A'.repeat(extra)}`,
        width: 640,
        height: 480,
        bytes: 1000,
      })

      // 수정 전: 딱 모자란 만큼만 지워 보관함이 여전히 예산 밖이었다(다음 저장에서 또 걸린다)
      expect(overwrittenChars(store)).toBeLessThan(before)
      expect(overwrittenChars(store)).toBeLessThanOrEqual(OVERWRITTEN_BUDGET)
      // 수정 전: 런타임 정리는 어디에도 남지 않았다
      expect(platform.auditLog().some((e) => e.action === '보관함 정리')).toBe(true)
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, 'window')
      else Reflect.set(globalThis, 'window', original)
    }
  })

  it('28-80-02: 런타임 정리는 **실제로 지운 건수**를 기록한다', async () => {
    const store = memoryStorage()
    const original = Reflect.get(globalThis, 'window')
    Reflect.set(globalThis, 'window', { localStorage: store })
    try {
      const { initPlatform } = await import('./bootstrap')
      const { platform } = initPlatform()
      // 예산을 넘기는 보관 항목 3건 — 한 번의 런타임 정리로 여러 건이 함께 빠진다
      const chunk = 'Z'.repeat(Math.floor(OVERWRITTEN_BUDGET / 2))
      store.setItem(
        OVERWRITTEN_KEY,
        JSON.stringify([
          { at: '2026-09-03T00:00:00.000Z', body: chunk },
          { at: '2026-09-02T00:00:00.000Z', body: chunk },
          { at: '2026-09-01T00:00:00.000Z', body: chunk },
        ]),
      )
      const beforeCount = readOverwritten(store).length
      const req = platform.addRequest({
        customerName: '정지훈',
        region: '서울 강서구',
        category: '급배수·누수·설비',
        description: '사진을 붙일 요청',
        desiredDate: '2026-12-01',
      })

      const usage = platform.storageUsage()
      const extra = usage.limit - usage.chars - 100_000
      platform.addPhoto(req.id, {
        id: 'p1',
        dataUrl: `data:image/png;base64,${'A'.repeat(extra)}`,
        width: 640,
        height: 480,
        bytes: 1000,
      })

      const actuallyRemoved = beforeCount - readOverwritten(store).length
      expect(actuallyRemoved).toBeGreaterThan(1) // 여러 건이 함께 빠지는 상황임을 먼저 확인한다
      const entry = platform.auditLog().find((e) => e.action === '보관함 정리')
      expect(entry).toBeDefined()
      // 수정 전: 몇 건이 지워졌든 늘 '1'이 남았다 — 없는 기록보다 틀린 기록이 나쁘다
      expect(entry?.target).toBe(String(actuallyRemoved))
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, 'window')
      else Reflect.set(globalThis, 'window', original)
    }
  })
})
