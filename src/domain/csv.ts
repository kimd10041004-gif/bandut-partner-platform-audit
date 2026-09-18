/** CSV 직렬화 (28-47-01): UTF-8 BOM(엑셀 한글 호환), RFC 4180 이스케이프(쉼표·따옴표·줄바꿈), CRLF 줄끝 */
export const CSV_BOM = '﻿'

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>,
): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))]
  return CSV_BOM + lines.join('\r\n') + '\r\n'
}
