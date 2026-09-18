import type { ScheduleSlot } from './types'
import { isValidDateStr } from './date'

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduleError'
  }
}

/** 슬롯 형식 검증: 실제 달력 날짜(28-1-01), 시간 범위(0<=start<end<=24) */
export function validateSlot(slot: ScheduleSlot): void {
  if (!isValidDateStr(slot.date)) {
    throw new ScheduleError(
      `날짜가 올바르지 않습니다 (YYYY-MM-DD, 실제 달력 기준): ${slot.date}`,
    )
  }
  if (!Number.isInteger(slot.startHour) || !Number.isInteger(slot.endHour)) {
    throw new ScheduleError('시작/종료 시각은 정수(시)여야 합니다')
  }
  if (slot.startHour < 0 || slot.endHour > 24 || slot.startHour >= slot.endHour) {
    throw new ScheduleError(
      `시간 범위가 올바르지 않습니다: ${slot.startHour}시 ~ ${slot.endHour}시`,
    )
  }
}

/** 같은 파트너의 같은 날짜에서 시간이 겹치면 true */
export function overlaps(a: ScheduleSlot, b: ScheduleSlot): boolean {
  if (a.partnerId !== b.partnerId) return false
  if (a.date !== b.date) return false
  return a.startHour < b.endHour && b.startHour < a.endHour
}

/**
 * 기존 슬롯 목록에 새 슬롯을 추가. 검증 실패 또는 충돌 시 ScheduleError.
 * 원본 배열은 변경하지 않고 새 배열을 반환한다.
 */
export function addSlot(
  slots: readonly ScheduleSlot[],
  slot: ScheduleSlot,
): ScheduleSlot[] {
  validateSlot(slot)
  const conflict = slots.find((s) => overlaps(s, slot))
  if (conflict) {
    throw new ScheduleError(
      `일정 충돌: ${conflict.date} ${conflict.startHour}시~${conflict.endHour}시 (요청 ${conflict.requestId})`,
    )
  }
  return [...slots, slot]
}

/** 특정 날짜의 슬롯을 시작 시각 순으로 반환 */
export function slotsOn(
  slots: readonly ScheduleSlot[],
  partnerId: string,
  date: string,
): ScheduleSlot[] {
  return slots
    .filter((s) => s.partnerId === partnerId && s.date === date)
    .sort((a, b) => a.startHour - b.startHour)
}
