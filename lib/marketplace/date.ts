/**
 * 날짜 문자열 검증 공용 유틸 (28-1 감사 28-1-01/02/06의 공통 근본 원인 해소).
 * 형식(YYYY-MM-DD)뿐 아니라 실제 달력에 존재하는 날짜인지 검증한다.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export class DateFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DateFormatError'
  }
}

/** YYYY-MM-DD 형식이면서 실제 달력에 존재하는 날짜면 true */
export function isValidDateStr(dateStr: string): boolean {
  const m = DATE_RE.exec(dateStr)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  // Date.UTC는 범위를 벗어난 월/일을 롤오버시키므로, 역변환 값이 입력과 같은지 확인
  const date = new Date(Date.UTC(y, mo - 1, d))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  )
}

/** 검증 실패 시 DateFormatError를 던진다. label은 오류 메시지의 필드명. */
export function assertValidDateStr(dateStr: string, label: string): void {
  if (!isValidDateStr(dateStr)) {
    throw new DateFormatError(
      `${label}이(가) 올바른 날짜(YYYY-MM-DD, 실제 달력 기준)가 아닙니다: ${dateStr}`,
    )
  }
}

/** 한국 영업일 기준 오늘 날짜. UTC 날짜를 잘라 쓰지 않는다. */
export function todayInKorea(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
