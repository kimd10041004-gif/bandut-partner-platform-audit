import { describe, it, expect } from 'vitest'
import { parseWonInput, parseHourInput, MoneyParseError } from './money'

describe('parseWonInput (28-1-05, 28-2-04)', () => {
  it('일반 정수 입력을 파싱한다', () => {
    expect(parseWonInput('150000')).toBe(150_000)
    expect(parseWonInput('0')).toBe(0)
    expect(parseWonInput(' 20000 ')).toBe(20_000)
  })

  it('천 단위 쉼표를 허용한다', () => {
    expect(parseWonInput('150,000')).toBe(150_000)
    expect(parseWonInput('1,234,567')).toBe(1_234_567)
    expect(parseWonInput('10,000')).toBe(10_000)
  })

  it('빈 값을 조용히 0으로 바꾸지 않는다 (28-1 재현 케이스)', () => {
    expect(() => parseWonInput('')).toThrow(MoneyParseError)
    expect(() => parseWonInput('   ')).toThrow(MoneyParseError)
  })

  it('지수/소수/음수/비숫자를 거부한다', () => {
    expect(() => parseWonInput('12e3')).toThrow(MoneyParseError)
    expect(() => parseWonInput('1.5')).toThrow(MoneyParseError)
    expect(() => parseWonInput('-5000')).toThrow(MoneyParseError)
    expect(() => parseWonInput('만원')).toThrow(MoneyParseError)
    expect(() => parseWonInput('1,23')).toThrow(MoneyParseError)
  })

  it('선행 0과 비정상 쉼표 그룹핑을 거부한다 (28-2-04 재현 케이스)', () => {
    expect(() => parseWonInput('007')).toThrow(MoneyParseError)
    expect(() => parseWonInput('0,100')).toThrow(MoneyParseError)
    expect(() => parseWonInput('01,000')).toThrow(MoneyParseError)
  })

  it('안전 정수 범위를 벗어나면 거부한다', () => {
    expect(() => parseWonInput('9007199254740993')).toThrow(MoneyParseError)
  })
})

describe('parseHourInput (28-2-02)', () => {
  it('정수 시각을 파싱한다', () => {
    expect(parseHourInput('0')).toBe(0)
    expect(parseHourInput('9')).toBe(9)
    expect(parseHourInput('24')).toBe(24)
  })

  it('25~99를 파싱 단계에서 거부한다 (28-2-02 재현 케이스)', () => {
    expect(() => parseHourInput('25')).toThrow(MoneyParseError)
    expect(() => parseHourInput('99')).toThrow(MoneyParseError)
  })

  it('빈 값/비숫자를 거부한다', () => {
    expect(() => parseHourInput('')).toThrow(MoneyParseError)
    expect(() => parseHourInput('9시')).toThrow(MoneyParseError)
    expect(() => parseHourInput('-1')).toThrow(MoneyParseError)
  })
})
