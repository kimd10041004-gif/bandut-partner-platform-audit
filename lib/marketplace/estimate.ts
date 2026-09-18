import type { Estimate, EstimateBreakdown } from './types'

/** 부가세율 10% */
export const VAT_RATE = 0.1
/** 플랫폼 수수료율 3% (VAT 포함 총액 기준 — 기획 시안 확정값, 28-6-03) */
export const PLATFORM_FEE_RATE = 0.03

export class EstimateValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EstimateValidationError'
  }
}

/**
 * 견적 입력값 검증. 금액은 모두 0 이상의 정수(원)여야 하고,
 * 할인은 공급가(합계)를 초과할 수 없다.
 */
export function validateEstimate(e: Estimate): void {
  const fields: Array<[string, number]> = [
    ['laborCost', e.laborCost],
    ['materialCost', e.materialCost],
    ['transportCost', e.transportCost],
    ['discount', e.discount],
  ]
  for (const [name, value] of fields) {
    if (!Number.isSafeInteger(value)) {
      throw new EstimateValidationError(`${name}은(는) 정수(원)여야 합니다: ${value}`)
    }
    if (value < 0) {
      throw new EstimateValidationError(`${name}은(는) 0 이상이어야 합니다: ${value}`)
    }
  }
  const gross = e.laborCost + e.materialCost + e.transportCost
  if (!Number.isSafeInteger(gross) || gross > Math.floor(Number.MAX_SAFE_INTEGER / 1.1)) throw new EstimateValidationError('금액 합계가 안전 정수 범위를 초과합니다')
  if (e.discount > gross) {
    throw new EstimateValidationError(
      `할인(${e.discount})이 공급가 합계(${gross})를 초과할 수 없습니다`,
    )
  }
}

/**
 * 견적 금액 계산.
 * subtotal(공급가) = 인건비 + 자재비 + 출장비 - 할인
 * vat = subtotal의 10% (반올림)
 * total = subtotal + vat
 * platformFee = total의 3% (반올림)
 * partnerPayout = total - platformFee
 */
export function calcEstimate(e: Estimate): EstimateBreakdown {
  validateEstimate(e)
  const subtotal = e.laborCost + e.materialCost + e.transportCost - e.discount
  const vat = Math.round(subtotal * VAT_RATE)
  const total = subtotal + vat
  const platformFee = Math.round(total * PLATFORM_FEE_RATE)
  const partnerPayout = total - platformFee
  return { subtotal, vat, total, platformFee, partnerPayout }
}
