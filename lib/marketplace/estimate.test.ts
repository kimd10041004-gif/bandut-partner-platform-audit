import { describe, it, expect } from 'vitest'
import { calcEstimate, validateEstimate, EstimateValidationError } from './estimate'
import type { Estimate } from './types'

const base: Estimate = {
  requestId: 'REQ-0001',
  partnerId: 'P-001',
  laborCost: 150_000,
  materialCost: 80_000,
  transportCost: 20_000,
  discount: 0,
}

describe('calcEstimate', () => {
  it('공급가/부가세/총액을 계산한다', () => {
    const r = calcEstimate(base)
    expect(r.subtotal).toBe(250_000)
    expect(r.vat).toBe(25_000)
    expect(r.total).toBe(275_000)
  })

  it('플랫폼 수수료 3%와 파트너 지급액을 계산한다', () => {
    const r = calcEstimate(base)
    expect(r.platformFee).toBe(8_250)
    expect(r.partnerPayout).toBe(266_750)
    expect(r.platformFee + r.partnerPayout).toBe(r.total)
  })

  it('할인을 공급가에서 차감한다', () => {
    const r = calcEstimate({ ...base, discount: 50_000 })
    expect(r.subtotal).toBe(200_000)
    expect(r.total).toBe(220_000)
  })

  it('부가세는 반올림한다 (홀수 공급가)', () => {
    const r = calcEstimate({ ...base, laborCost: 33_333, materialCost: 0, transportCost: 0 })
    expect(r.vat).toBe(3_333) // 3333.3 → 3333
    const r2 = calcEstimate({ ...base, laborCost: 33_335, materialCost: 0, transportCost: 0 })
    expect(r2.vat).toBe(3_334) // 3333.5 → 3334
  })

  it('0원 견적도 허용한다', () => {
    const r = calcEstimate({ ...base, laborCost: 0, materialCost: 0, transportCost: 0 })
    expect(r.total).toBe(0)
    expect(r.partnerPayout).toBe(0)
  })
})

describe('validateEstimate', () => {
  it('음수 금액을 거부한다', () => {
    expect(() => validateEstimate({ ...base, laborCost: -1 })).toThrow(EstimateValidationError)
  })

  it('소수 금액을 거부한다', () => {
    expect(() => validateEstimate({ ...base, materialCost: 100.5 })).toThrow(
      EstimateValidationError,
    )
  })

  it('공급가 합계를 초과하는 할인을 거부한다', () => {
    expect(() => validateEstimate({ ...base, discount: 250_001 })).toThrow(
      EstimateValidationError,
    )
  })

  it('공급가 합계와 같은 할인은 허용한다', () => {
    expect(() => validateEstimate({ ...base, discount: 250_000 })).not.toThrow()
  })
})
