import { describe, expect, it } from 'vitest'
import { koreanDate, krw, isKnownError } from './format'

describe('koreanDate', () => {
  it('ISO 날짜를 한국어 날짜+요일로 변환한다 (UTC 기준)', () => {
    expect(koreanDate('2026-09-01')).toBe('9월 1일 화요일')
    expect(koreanDate('2026-01-04')).toBe('1월 4일 일요일')
    expect(koreanDate('2026-12-31')).toBe('12월 31일 목요일')
  })

  it('파싱 불가 입력은 원문을 그대로 돌려준다', () => {
    expect(koreanDate('not-a-date')).toBe('not-a-date')
    expect(koreanDate('2026-13-01')).toBe('2026-13-01')
  })

  // 28-64-01: 죽은 scripts/format.mjs가 지키던 28-1-04 규약을 실제 배포 코드로 옮긴다.
  // 이전 구현은 Date 롤오버 때문에 2026-02-31을 "3월 3일 화요일"로 조용히 바꿔 보여줬다.
  it('달력에 없는 날짜는 롤오버하지 않고 원문을 돌려준다 (28-1-04)', () => {
    expect(koreanDate('2026-02-31')).toBe('2026-02-31')
    expect(koreanDate('2026-02-30')).toBe('2026-02-30')
    expect(koreanDate('2025-02-29')).toBe('2025-02-29')
    expect(koreanDate('2026-04-31')).toBe('2026-04-31')
  })

  it('윤년 2월 29일은 정상 처리한다', () => {
    expect(koreanDate('2028-02-29')).toBe('2월 29일 화요일')
  })

  it('YYYY-MM-DD 형식이 아니면 원문을 돌려준다', () => {
    expect(koreanDate('2026-1-1')).toBe('2026-1-1')
    expect(koreanDate('')).toBe('')
  })
})

describe('krw', () => {
  it('천 단위 구분과 원 단위를 붙인다', () => {
    expect(krw(12345)).toBe('12,345원')
    expect(krw(0)).toBe('0원')
    expect(krw(1_000_000)).toBe('1,000,000원')
  })

  it('음수도 부호를 유지한다', () => {
    expect(krw(-5000)).toBe('-5,000원')
  })
})

describe('isKnownError', () => {
  // 28-65-03: 여기 있던 "도메인 오류 5개를 나열해 참을 확인" 테스트는 지웠다.
  // `isKnownError`가 나열한 것과 같은 목록을 다시 나열하는 테스트라, 목록에서 빠진 클래스를
  // 영원히 잡을 수 없었다(실제로 `PlatformReopenError`가 빠져 있었고 아무도 못 잡았다).
  // 도메인 오류 전수 확인은 `src/domain/errors.test.ts`가 **훑어서 발견하는** 방식으로 한다.
  it('도메인 밖의 오류·비오류는 거짓이다', () => {
    expect(isKnownError(new Error('평범한 오류'))).toBe(false)
    expect(isKnownError(new TypeError('타입'))).toBe(false)
    expect(isKnownError('문자열')).toBe(false)
    expect(isKnownError(undefined)).toBe(false)
  })
})
