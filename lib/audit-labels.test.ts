import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { AUDIT_LABELS, auditLabel } from './audit-labels'

/**
 * 29-29: 소스에서 기록 이벤트 이름을 긁어 표에 전부 있는지 본다. 이벤트를 하나 더하면서 표를 빠뜨리면 여기서 걸린다 —
 * 고객 화면에 `COMPLETION_DECIDED` 가 찍히던 일(29-28 실사용 점검)이 다시 나지 않게.
 */
function kindsIn(file: string, re: RegExp): string[] {
  const src = readFileSync(file, 'utf8')
  return [...src.matchAll(re)].map((m) => m[1]!)
}

describe('진행 기록 라벨 (29-29)', () => {
  it('lib/trade.ts 의 commit 이벤트 이름이 전부 표에 있다', () => {
    const kinds = new Set(kindsIn('lib/trade.ts', /commit\(u, ?o, ?'([A-Z_]+)'/g))
    kinds.delete('SETTLEMENT_') // 접두사 — 아래에서 action 별로 본다
    for (const a of ['APPROVE', 'HOLD', 'RECORD_TRANSFER']) kinds.add('SETTLEMENT_' + a)
    expect(kinds.size).toBeGreaterThan(15)
    const missing = [...kinds].filter((k) => AUDIT_LABELS[k] === undefined)
    expect(missing).toEqual([])
  })

  it('lib/service.ts 의 audit 이벤트 이름이 전부 표에 있다', () => {
    const kinds = new Set(kindsIn('lib/service.ts', /audit\(u,[^,]+,'([A-Z_]+)'/g))
    expect(kinds.size).toBeGreaterThan(5)
    expect([...kinds].filter((k) => AUDIT_LABELS[k] === undefined)).toEqual([])
  })

  it('모르는 이름도 코드 그대로 찍지 않는다', () => {
    expect(auditLabel('COMPLETION_DECIDED')).toBe('작업 완료 확인')
    expect(auditLabel('SOME_NEW_EVENT')).toBe('Some new event')
  })
})
