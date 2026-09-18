import { isValidDateStr } from '../domain/date'
import { DomainError } from '../../server/domain/errors'

/** 12345 → "12,345원" */
export const krw = (n: number) => `${n.toLocaleString('ko-KR')}원`

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const

/**
 * "2026-09-01" → "9월 1일 화요일" (UTC 기준 — 도메인 날짜 규약과 동일)
 *
 * 28-64-01: 달력에 없는 날짜는 도메인의 `isValidDateStr`로 먼저 거른다.
 * `new Date('2026-02-31T00:00:00Z')`는 3월 3일로 롤오버하므로, 이 가드가 없으면
 * 사용자가 입력하지 않은 날짜를 사실인 것처럼 보여준다(28-1-04 규약).
 * 규약은 원래 `scripts/format.mjs`에만 있었고 실제 배포 코드에는 없었다.
 */
export function koreanDate(iso: string): string {
  if (!isValidDateStr(iso)) return iso
  const d = new Date(`${iso}T00:00:00Z`)
  const weekday = WEEKDAY_KO[d.getUTCDay()] ?? ''
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${weekday}요일`
}

/**
 * 도메인에서 정의한 "사용자에게 보여줄 수 있는" 오류인지 판별.
 *
 * 28-65-03: 예전에는 클래스를 손으로 나열했다. 도메인 오류가 9개인데 목록에는 8개뿐이었고
 * (`PlatformReopenError` 누락), 같은 라운드에 새로 넣은 테스트가 그 목록을 그대로 베껴서
 * 누락을 구조적으로 잡을 수 없었다. 이제 상속 하나로 판정한다 —
 * 목록을 유지할 일이 없으니 목록이 틀릴 일도 없다.
 */
export function isKnownError(err: unknown): err is DomainError {
  return err instanceof DomainError
}

/** 연락처 표시 (28-94): 숫자만 저장된 값을 010-0000-0000 꼴로 — 자릿수가 다르면 그대로 */
export function fmtPhone(p: string): string {
  if (p.length === 11) return `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`
  if (p.length === 10) return `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`
  return p
}
