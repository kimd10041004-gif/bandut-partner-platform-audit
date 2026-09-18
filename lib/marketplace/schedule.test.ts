import { describe, it, expect } from 'vitest'
import { addSlot, overlaps, slotsOn, validateSlot, ScheduleError } from './schedule'
import type { ScheduleSlot } from './types'

function slot(partial: Partial<ScheduleSlot>): ScheduleSlot {
  return {
    id: 'S-1',
    partnerId: 'P-001',
    requestId: 'REQ-0001',
    date: '2026-09-01',
    startHour: 9,
    endHour: 12,
    ...partial,
  }
}

describe('overlaps', () => {
  it('겹치는 구간을 감지한다', () => {
    expect(overlaps(slot({}), slot({ id: 'S-2', startHour: 11, endHour: 13 }))).toBe(true)
  })

  it('맞닿은 구간(end==start)은 겹치지 않는다', () => {
    expect(overlaps(slot({}), slot({ id: 'S-2', startHour: 12, endHour: 14 }))).toBe(false)
  })

  it('다른 날짜는 겹치지 않는다', () => {
    expect(overlaps(slot({}), slot({ id: 'S-2', date: '2026-09-02' }))).toBe(false)
  })

  it('다른 파트너는 겹치지 않는다', () => {
    expect(overlaps(slot({}), slot({ id: 'S-2', partnerId: 'P-002' }))).toBe(false)
  })

  it('완전히 포함되는 구간도 겹침이다', () => {
    expect(overlaps(slot({ startHour: 8, endHour: 18 }), slot({ id: 'S-2', startHour: 10, endHour: 11 }))).toBe(true)
  })
})

describe('addSlot', () => {
  it('충돌 없는 슬롯을 추가하고 원본을 변경하지 않는다', () => {
    const existing = [slot({})]
    const next = addSlot(existing, slot({ id: 'S-2', startHour: 13, endHour: 15 }))
    expect(next).toHaveLength(2)
    expect(existing).toHaveLength(1)
  })

  it('충돌 시 ScheduleError를 던진다', () => {
    expect(() => addSlot([slot({})], slot({ id: 'S-2', startHour: 10, endHour: 11 }))).toThrow(
      ScheduleError,
    )
  })
})

describe('validateSlot', () => {
  it('잘못된 날짜 형식을 거부한다', () => {
    expect(() => validateSlot(slot({ date: '2026/09/01' }))).toThrow(ScheduleError)
  })

  it('달력에 없는 날짜를 거부한다 (28-1-01)', () => {
    expect(() => validateSlot(slot({ date: '2026-02-31' }))).toThrow(ScheduleError)
    expect(() => validateSlot(slot({ date: '2026-13-99' }))).toThrow(ScheduleError)
    expect(() => validateSlot(slot({ date: '2026-04-31' }))).toThrow(ScheduleError)
  })

  it('윤년 2월 29일은 허용, 평년은 거부한다 (28-1-01)', () => {
    expect(() => validateSlot(slot({ date: '2024-02-29' }))).not.toThrow()
    expect(() => validateSlot(slot({ date: '2026-02-29' }))).toThrow(ScheduleError)
  })

  it('start >= end를 거부한다', () => {
    expect(() => validateSlot(slot({ startHour: 12, endHour: 12 }))).toThrow(ScheduleError)
    expect(() => validateSlot(slot({ startHour: 14, endHour: 12 }))).toThrow(ScheduleError)
  })

  it('범위를 벗어난 시각을 거부한다', () => {
    expect(() => validateSlot(slot({ startHour: -1 }))).toThrow(ScheduleError)
    expect(() => validateSlot(slot({ endHour: 25 }))).toThrow(ScheduleError)
  })

  it('0시~24시 풀타임 슬롯은 허용한다', () => {
    expect(() => validateSlot(slot({ startHour: 0, endHour: 24 }))).not.toThrow()
  })
})

describe('slotsOn', () => {
  it('해당 파트너/날짜의 슬롯을 시작 시각 순으로 반환한다', () => {
    const slots = [
      slot({ id: 'S-1', startHour: 14, endHour: 16 }),
      slot({ id: 'S-2', startHour: 9, endHour: 11 }),
      slot({ id: 'S-3', date: '2026-09-02' }),
    ]
    const result = slotsOn(slots, 'P-001', '2026-09-01')
    expect(result.map((s) => s.id)).toEqual(['S-2', 'S-1'])
  })
})
