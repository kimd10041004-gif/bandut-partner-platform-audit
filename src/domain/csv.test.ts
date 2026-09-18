import { describe, it, expect } from 'vitest'
import { toCsv, csvCell, CSV_BOM } from './csv'

describe('CSV (28-47-01)', () => {
  it('BOM·CRLF·이스케이프(쉼표·따옴표·줄바꿈)·null 처리', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell(1234)).toBe('1234')
    expect(csvCell(null)).toBe('')
    const out = toCsv(
      ['날짜', '금액'],
      [
        ['2026-09-02', -27500],
        ['메모, 포함', 'x'],
      ],
    )
    expect(out.startsWith(CSV_BOM)).toBe(true)
    expect(out.slice(1)).toBe('날짜,금액\r\n2026-09-02,-27500\r\n"메모, 포함",x\r\n')
  })
})
