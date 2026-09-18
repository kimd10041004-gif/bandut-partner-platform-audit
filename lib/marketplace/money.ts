/**
 * 금액/시각 입력 파싱 (28-1-05, 28-2-02, 28-2-04).
 * Number() 캐스팅의 조용한 변환('' → 0, '12e3' → 12000)을 금지하고
 * 명시적 십진 정수만 허용한다.
 */

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyParseError'
  }
}

// 단독 '0', 쉼표 없는 정수(선행 0 금지), 또는 올바른 3자리 그룹핑만 허용 (28-2-04)
const WON_RE = /^(0|[1-9]\d*|[1-9]\d{0,2}(,\d{3})+)$/

/** "150000" 또는 "150,000" → 150000. 빈 값/음수/소수/지수/선행 0/비정상 그룹핑은 오류. */
export function parseWonInput(raw: string): number {
  const trimmed = raw.trim()
  if (trimmed === '') {
    throw new MoneyParseError('금액을 입력하세요')
  }
  if (!WON_RE.test(trimmed)) {
    throw new MoneyParseError(`금액은 0 이상의 정수(원)만 입력할 수 있습니다: ${raw}`)
  }
  const value = Number(trimmed.replace(/,/g, ''))
  if (!Number.isSafeInteger(value)) {
    throw new MoneyParseError(`금액이 처리 가능한 범위를 벗어났습니다: ${raw}`)
  }
  return value
}

/** "9" → 9. 0~24 범위를 파싱 단계에서 완결한다 (28-2-02). */
export function parseHourInput(raw: string): number {
  const trimmed = raw.trim()
  if (!/^\d{1,2}$/.test(trimmed)) {
    throw new MoneyParseError(`시각은 0~24 사이 정수만 입력할 수 있습니다: ${raw}`)
  }
  const value = Number(trimmed)
  if (value > 24) {
    throw new MoneyParseError(`시각은 0~24 사이여야 합니다: ${raw}`)
  }
  return value
}
