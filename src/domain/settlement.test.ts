import { describe, it, expect } from 'vitest'
import { isoWeekLabel, weeklySettlements } from './settlement'
import { DateFormatError } from './date'
import type { CompletedJob } from './types'

function job(partial: Partial<CompletedJob>): CompletedJob {
  return {
    requestId: 'REQ-0001',
    partnerId: 'P-001',
    completedDate: '2026-09-01',
    total: 275_000,
    platformFee: 13_750,
    settled: false,
    ...partial,
  }
}

describe('isoWeekLabel', () => {
  it('평일의 ISO 주차를 구한다', () => {
    expect(isoWeekLabel('2026-09-01')).toBe('2026-W36')
  })

  it('연초 경계: 1월 1일이 전년도 주차에 속할 수 있다', () => {
    // 2027-01-01은 금요일 → 2026-W53
    expect(isoWeekLabel('2027-01-01')).toBe('2026-W53')
  })

  it('연말 경계: 12월 말일이 다음 해 주차에 속할 수 있다', () => {
    // 2024-12-30은 월요일 → 2025-W01
    expect(isoWeekLabel('2024-12-30')).toBe('2025-W01')
  })

  it('잘못된 입력은 NaN 라벨 대신 DateFormatError (28-1-02)', () => {
    expect(() => isoWeekLabel('invalid-date')).toThrow(DateFormatError)
    expect(() => isoWeekLabel('2026-02-31')).toThrow(DateFormatError)
    expect(() => isoWeekLabel('')).toThrow(DateFormatError)
  })
})

describe('weeklySettlements', () => {
  it('주차별로 건수/금액/수수료/지급액을 집계한다', () => {
    const jobs = [
      job({ requestId: 'R1', completedDate: '2026-09-01' }),
      job({ requestId: 'R2', completedDate: '2026-09-03', total: 100_000, platformFee: 5_000 }),
      job({ requestId: 'R3', completedDate: '2026-09-08' }),
    ]
    const result = weeklySettlements(jobs)
    expect(result).toHaveLength(2)
    const w36 = result[0]!
    expect(w36.partnerId).toBe('P-001')
    expect(w36.week).toBe('2026-W36')
    expect(w36.jobCount).toBe(2)
    expect(w36.totalAmount).toBe(375_000)
    expect(w36.totalFee).toBe(18_750)
    expect(w36.payout).toBe(356_250)
  })

  it('파트너가 다르면 같은 주차라도 분리 집계한다 (28-1-03)', () => {
    const jobs = [
      job({ requestId: 'R1', partnerId: 'P-001', total: 100_000, platformFee: 5_000 }),
      job({ requestId: 'R2', partnerId: 'P-002', total: 200_000, platformFee: 10_000 }),
    ]
    const result = weeklySettlements(jobs)
    expect(result).toHaveLength(2)
    expect(result[0]!.partnerId).toBe('P-001')
    expect(result[0]!.payout).toBe(95_000)
    expect(result[1]!.partnerId).toBe('P-002')
    expect(result[1]!.payout).toBe(190_000)
  })

  it('빈 목록은 빈 결과를 반환한다', () => {
    expect(weeklySettlements([])).toEqual([])
  })

  it('파트너 → 주차 순으로 정렬한다', () => {
    const jobs = [
      job({ partnerId: 'P-002', completedDate: '2026-09-01' }),
      job({ partnerId: 'P-001', completedDate: '2026-09-15' }),
      job({ partnerId: 'P-001', completedDate: '2026-09-01' }),
    ]
    expect(weeklySettlements(jobs).map((s) => `${s.partnerId} ${s.week}`)).toEqual([
      'P-001 2026-W36',
      'P-001 2026-W38',
      'P-002 2026-W36',
    ])
  })
})
