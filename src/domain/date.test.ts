import { describe, it, expect } from 'vitest'
import { isValidDateStr, assertValidDateStr, DateFormatError } from './date'

describe('isValidDateStr (28-1-01/02/06 공통 유틸)', () => {
  it('정상 날짜를 허용한다', () => {
    expect(isValidDateStr('2026-09-01')).toBe(true)
    expect(isValidDateStr('2026-01-01')).toBe(true)
    expect(isValidDateStr('2026-12-31')).toBe(true)
  })

  it('윤년을 정확히 처리한다', () => {
    expect(isValidDateStr('2024-02-29')).toBe(true) // 윤년
    expect(isValidDateStr('2026-02-29')).toBe(false) // 평년
    expect(isValidDateStr('2100-02-29')).toBe(false) // 100년 규칙
    expect(isValidDateStr('2000-02-29')).toBe(true) // 400년 규칙
  })

  it('달력에 없는 날짜를 거부한다 (28-1 재현 케이스)', () => {
    expect(isValidDateStr('2026-02-31')).toBe(false)
    expect(isValidDateStr('2026-13-99')).toBe(false)
    expect(isValidDateStr('2026-00-10')).toBe(false)
    expect(isValidDateStr('2026-04-31')).toBe(false)
  })

  it('형식 오류를 거부한다', () => {
    expect(isValidDateStr('2026/09/01')).toBe(false)
    expect(isValidDateStr('26-9-1')).toBe(false)
    expect(isValidDateStr('')).toBe(false)
    expect(isValidDateStr('invalid-date')).toBe(false)
  })
})

describe('assertValidDateStr', () => {
  it('실패 시 필드명을 포함한 DateFormatError를 던진다', () => {
    expect(() => assertValidDateStr('2026-02-31', 'desiredDate')).toThrow(DateFormatError)
    expect(() => assertValidDateStr('2026-02-31', 'desiredDate')).toThrow(/desiredDate/)
  })

  it('정상 날짜는 통과한다', () => {
    expect(() => assertValidDateStr('2026-09-01', 'date')).not.toThrow()
  })
})
