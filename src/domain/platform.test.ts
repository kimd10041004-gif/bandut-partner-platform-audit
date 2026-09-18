import type { RequestPhoto, RepairCategory } from './types'
import { describe, it, expect } from 'vitest'
import {
  PlatformService,
  PlatformError,
  DEFAULT_PACKAGES,
  DEFAULT_QUESTIONS,
  DEFAULT_PARTNER_PROFILE,
  todayUTC,
  type StorageLike,
  profileMatch,
  parseTokens,
  validatePhotos,
  MAX_PHOTO_BYTES,
  PHOTO_RETENTION_DAYS,
  NOTIFICATION_CAP,
  CHAT_MAX_TEXT,
  CHAT_MAX_PER_REQUEST,
  AUDIT_CAP,
  AUDIT_RETENTION_DAYS,
  AUDIT_COLLAPSE_MS,
  SECURITY_AUDIT_ACTIONS,
  PROGRESS_DETAIL_AUDIT_ACTIONS,
  assertNoRealNames,
  assertNoRealIdentifiers,
  assertPseudonymousShape,
  PSEUDONYMOUS_REFUND_KEYS,
  EXPORT_PAYMENT_KEYS,
  EXPORT_REFUND_KEYS,
  EXPORT_JOB_KEYS,
  DEFAULT_LANDING,
  landingTitle,
  normalizeLanding,
  heldForReview,
  requestForPartner,
  maskName,
  PARTNER_PRIVATE_KEYS,
} from './platform'
import { memoryStorage } from '../../server/domain/memoryStorage'
import { RequestNotFoundError } from './store'
import { InvalidTransitionError } from './jobStatus'
import { ScheduleError } from './schedule'
import { DateFormatError, addDays } from './date'
import { payoutAccountLabels } from '../../server/domain/auth'

const ESTIMATE_INPUT = {
  laborCost: 150_000,
  materialCost: 80_000,
  transportCost: 20_000,
  discount: 0,
}

function newRequest() {
  return {
    customerName: '김반듯',
    region: '서울 강서구',
    category: '급배수·누수·설비' as const,
    description: '욕실 천장 누수',
    desiredDate: '2026-09-05',
  }
}

function platformWithRequest(storage?: StorageLike) {
  const p = new PlatformService(storage ? { storage } : {})
  const r = p.addRequest(newRequest())
  return { p, r }
}

/** 테스트용 인메모리 저장소 */
class FakeStorage implements StorageLike {
  private map = new Map<string, string>()
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  get size() {
    return this.map.size
  }
}

describe('submitEstimate', () => {
  it('requested 상태에서 제출하면 estimated로 전이되고 견적이 저장된다', () => {
    const { p, r } = platformWithRequest()
    const breakdown = p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    expect(breakdown.total).toBe(275_000)
    expect(p.store.get(r.id)!.status).toBe('estimated')
    expect(p.getEstimate(r.id)!.breakdown.total).toBe(275_000)
  })

  it('estimated 상태에서 재제출하면 견적만 교체된다', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    const updated = p.submitEstimate(r.id, 'P-001', { ...ESTIMATE_INPUT, discount: 50_000 })
    expect(updated.total).toBe(220_000)
    expect(p.store.get(r.id)!.status).toBe('estimated')
  })

  it('accepted 이후 상태에서는 PlatformError', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    expect(() => p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)).toThrow(PlatformError)
  })

  it('없는 요청이면 RequestNotFoundError', () => {
    const p = new PlatformService()
    expect(() => p.submitEstimate('REQ-9999', 'P-001', ESTIMATE_INPUT)).toThrow(RequestNotFoundError)
  })
})

function driveToAccepted(storage?: StorageLike) {
  const { p, r } = platformWithRequest(storage)
  p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
  p.transitionRequest(r.id, 'accepted')
  return { p, r }
}

describe('scheduleVisit (28-3-02)', () => {
  it('accepted 요청을 예약하면 슬롯이 생기고 scheduled로 전이된다', () => {
    const { p, r } = driveToAccepted()
    const slot = p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    expect(slot.requestId).toBe(r.id)
    expect(slot.partnerId).toBe('P-001')
    expect(p.store.get(r.id)!.status).toBe('scheduled')
    expect(p.scheduleSlots).toHaveLength(1)
  })

  it('accepted가 아닌 상태에서는 PlatformError, 슬롯은 생기지 않는다', () => {
    const { p, r } = platformWithRequest()
    expect(() => p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })).toThrow(PlatformError)
    expect(p.scheduleSlots).toHaveLength(0)
  })

  it('일정 충돌 시 ScheduleError, 전이도 슬롯 추가도 일어나지 않는다', () => {
    const { p, r } = driveToAccepted()
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    const r2 = p.addRequest(newRequest())
    p.submitEstimate(r2.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r2.id, 'accepted')
    expect(() => p.scheduleVisit(r2.id, { date: '2026-09-05', startHour: 10, endHour: 11 })).toThrow(ScheduleError)
    expect(p.store.get(r2.id)!.status).toBe('accepted')
    expect(p.scheduleSlots).toHaveLength(1)
  })

  it('달력에 없는 날짜/잘못된 시간은 ScheduleError', () => {
    const { p, r } = driveToAccepted()
    expect(() => p.scheduleVisit(r.id, { date: '2026-02-31', startHour: 9, endHour: 12 })).toThrow(ScheduleError)
    expect(() => p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 12, endHour: 9 })).toThrow(ScheduleError)
  })

  it('없는 요청이면 RequestNotFoundError', () => {
    const p = new PlatformService()
    expect(() => p.scheduleVisit('REQ-9999', { date: '2026-09-05', startHour: 9, endHour: 12 })).toThrow(
      RequestNotFoundError,
    )
  })
})

describe('transitionRequest', () => {
  it('전용 경로가 있는 전이(estimated/scheduled)를 직접 요구하면 PlatformError', () => {
    const { p, r } = platformWithRequest()
    expect(() => p.transitionRequest(r.id, 'estimated')).toThrow(PlatformError)
    expect(() => p.transitionRequest(r.id, 'scheduled')).toThrow(PlatformError)
  })

  it('전이 규칙 위반은 InvalidTransitionError를 그대로 전파한다', () => {
    const { p, r } = platformWithRequest()
    expect(() => p.transitionRequest(r.id, 'settled')).toThrow(InvalidTransitionError)
  })
})

function driveToInProgress(storage?: StorageLike) {
  const { p, r } = driveToAccepted(storage)
  p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
  p.transitionRequest(r.id, 'in_progress')
  return { p, r }
}

describe('completeJob', () => {
  it('완료 시 견적 금액으로 미정산 CompletedJob이 생성된다', () => {
    const { p, r } = driveToInProgress()
    const job = p.completeJob(r.id, '2026-09-06')
    expect(job).toEqual({
      requestId: r.id,
      partnerId: 'P-001',
      completedDate: '2026-09-06',
      total: 275_000,
      platformFee: 8_250,
      extraTotal: 0,
      settled: false,
    })
    expect(p.store.get(r.id)!.status).toBe('completed')
  })

  it('completedDate를 생략하면 UTC 오늘 날짜를 쓴다', () => {
    const { p, r } = driveToInProgress()
    expect(p.completeJob(r.id).completedDate).toBe(todayUTC())
  })

  it('달력에 없는 완료일은 DateFormatError, job은 생기지 않는다', () => {
    const { p, r } = driveToInProgress()
    expect(() => p.completeJob(r.id, '2026-02-31')).toThrow(DateFormatError)
    expect(p.completedJobs).toHaveLength(0)
    expect(p.store.get(r.id)!.status).toBe('in_progress')
  })

  it('in_progress가 아니면 InvalidTransitionError, job은 생기지 않는다', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    expect(() => p.completeJob(r.id, '2026-09-06')).toThrow(InvalidTransitionError)
    expect(p.completedJobs).toHaveLength(0)
  })

  it('견적 없이 완료할 수 없다', () => {
    const { p, r } = platformWithRequest()
    expect(() => p.completeJob(r.id, '2026-09-06')).toThrow(PlatformError)
  })
})

describe('settle / settlements (28-3-03)', () => {
  it('settle하면 요청은 settled, job에는 정산 표시가 남는다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-01')
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    expect(p.store.get(r.id)!.status).toBe('settled')
    expect(p.completedJobs[0]!.settled).toBe(true)
  })

  it('settlements 필터가 미정산/정산 확정을 구분한다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-01')
    const r2 = p.addRequest(newRequest())
    p.submitEstimate(r2.id, 'P-001', { ...ESTIMATE_INPUT, discount: 150_000 }) // total 110,000
    p.transitionRequest(r2.id, 'accepted')
    p.scheduleVisit(r2.id, { date: '2026-09-06', startHour: 14, endHour: 16 })
    p.transitionRequest(r2.id, 'in_progress')
    p.completeJob(r2.id, '2026-09-02')
    p.payFinal(r.id, 'card')
    p.settle(r.id)

    expect(p.settlements('all')[0]!.jobCount).toBe(2)
    const settledRows = p.settlements('settled')
    expect(settledRows).toHaveLength(1)
    expect(settledRows[0]!.totalAmount).toBe(275_000)
    const unsettledRows = p.settlements('unsettled')
    expect(unsettledRows).toHaveLength(1)
    expect(unsettledRows[0]!.totalAmount).toBe(110_000)
  })

  it('unsettledPayout은 미정산 지급액만 합산한다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-01')
    expect(p.unsettledPayout()).toBe(266_750)
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    expect(p.unsettledPayout()).toBe(0)
  })

  it('completedJobs는 방어적 복사본을 반환한다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-01')
    const jobs = p.completedJobs
    jobs[0]!.total = 0
    expect(p.completedJobs[0]!.total).toBe(275_000)
  })
})

describe('영속화 (28-3-01)', () => {
  it('전체 흐름이 저장/복원 round-trip을 통과한다', () => {
    const storage = new FakeStorage()
    const { p, r } = driveToInProgress(storage)
    p.completeJob(r.id, '2026-09-01')
    p.payFinal(r.id, 'card')
    p.settle(r.id)

    const { service: restored, restored: ok } = PlatformService.load({ storage })
    expect(ok).toBe(true)
    expect(restored.store.get(r.id)!.status).toBe('settled')
    expect(restored.getEstimate(r.id)!.breakdown.total).toBe(275_000)
    expect(restored.completedJobs).toHaveLength(1)
    expect(restored.completedJobs[0]!.settled).toBe(true)
    expect(restored.scheduleSlots).toHaveLength(1)
    expect(restored.settlements('settled')[0]!.payout).toBe(266_750)
  })

  it('복원 후 신규 ID가 이어져 충돌하지 않는다', () => {
    const storage = new FakeStorage()
    const { p, r } = platformWithRequest(storage)
    const { service: restored } = PlatformService.load({ storage })
    const r2 = restored.addRequest(newRequest())
    expect(r.id).toBe('REQ-0001')
    expect(r2.id).toBe('REQ-0002')
    void p
  })

  it('복원된 서비스의 일정 충돌 검사가 기존 슬롯을 인식한다', () => {
    const storage = new FakeStorage()
    const { p, r } = driveToAccepted(storage)
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })

    const { service: restored } = PlatformService.load({ storage })
    const r2 = restored.addRequest(newRequest())
    restored.submitEstimate(r2.id, 'P-001', ESTIMATE_INPUT)
    restored.transitionRequest(r2.id, 'accepted')
    expect(() => restored.scheduleVisit(r2.id, { date: '2026-09-05', startHour: 11, endHour: 13 })).toThrow(
      ScheduleError,
    )
  })

  it('손상된 저장 데이터는 버리고 새로 시작한다', () => {
    const storage = new FakeStorage()
    storage.setItem('banded-platform-v1', '{"broken json')
    const { service, restored } = PlatformService.load({ storage })
    expect(restored).toBe(false)
    expect(service.store.size).toBe(0)
    expect(storage.getItem('banded-platform-v1')).toBeNull() // 손상 키 제거
  })

  it('알 수 없는 스냅샷 버전은 복원하지 않는다', () => {
    const storage = new FakeStorage()
    storage.setItem('banded-platform-v1', JSON.stringify({ version: 99 }))
    const { restored } = PlatformService.load({ storage })
    expect(restored).toBe(false)
  })

  it('저장소가 없어도 모든 기능이 동작한다', () => {
    const { p, r } = driveToInProgress()
    expect(() => p.completeJob(r.id, '2026-09-01')).not.toThrow()
  })
})

describe('취소 시 슬롯 해제 (28-4-01)', () => {
  it('scheduled 요청을 취소하면 슬롯이 해제되고 같은 시간대 재예약이 가능하다', () => {
    const { p, r } = driveToAccepted()
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    p.transitionRequest(r.id, 'cancelled')
    expect(p.scheduleSlots).toHaveLength(0)

    const r2 = p.addRequest(newRequest())
    p.submitEstimate(r2.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r2.id, 'accepted')
    expect(() => p.scheduleVisit(r2.id, { date: '2026-09-05', startHour: 10, endHour: 11 })).not.toThrow()
  })

  it('취소 전이가 불가능한 상태에서는 슬롯이 유지된다', () => {
    const { p, r } = driveToInProgress()
    expect(() => p.transitionRequest(r.id, 'cancelled')).toThrow(InvalidTransitionError)
    expect(p.scheduleSlots).toHaveLength(1)
  })

  it('완료된 작업의 슬롯은 이력으로 유지된다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    expect(p.scheduleSlots).toHaveLength(1)
  })
})

describe('백업 내보내기/가져오기 (28-4-03)', () => {
  it('export → import round-trip으로 전체 상태가 복제된다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-01')
    const backup = p.exportData()

    const fresh = new PlatformService()
    fresh.importSnapshot(backup)
    expect(fresh.store.get(r.id)!.status).toBe('completed')
    expect(fresh.completedJobs).toHaveLength(1)
    expect(fresh.scheduleSlots).toHaveLength(1)
    expect(fresh.addRequest(newRequest()).id).toBe('REQ-0002')
  })

  it('손상된 JSON은 PlatformError, 기존 데이터는 보존된다', () => {
    const { p, r } = platformWithRequest()
    expect(() => p.importSnapshot('{"broken')).toThrow(PlatformError)
    expect(() => p.importSnapshot('{"version":2}')).toThrow(PlatformError)
    expect(() => p.importSnapshot('null')).toThrow(PlatformError)
    expect(p.store.get(r.id)).toBeDefined()
  })

  it('가져오기 성공 시 저장소에도 반영된다', () => {
    const storage = new FakeStorage()
    const target = new PlatformService({ storage })
    const { p, r } = platformWithRequest()
    target.importSnapshot(p.exportData())
    const { service: reloaded, restored } = PlatformService.load({ storage })
    expect(restored).toBe(true)
    expect(reloaded.store.get(r.id)).toBeDefined()
  })
})

describe('대시보드 집계 (28-4-02)', () => {
  it('statusCounts가 상태별 요청 수를 집계한다', () => {
    const { p, r } = platformWithRequest()
    p.addRequest(newRequest())
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    const counts = p.statusCounts()
    expect(counts.requested).toBe(1)
    expect(counts.estimated).toBe(1)
    expect(counts.cancelled).toBe(0)
  })

  it('upcomingSlots가 기준일 이후를 날짜·시각 순으로 최대 limit개 반환한다', () => {
    const p = new PlatformService()
    const make = (date: string, start: number, end: number) => {
      const r = p.addRequest({ ...newRequest(), desiredDate: date })
      p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
      p.transitionRequest(r.id, 'accepted')
      p.scheduleVisit(r.id, { date, startHour: start, endHour: end })
    }
    make('2026-09-10', 14, 16)
    make('2026-09-08', 9, 11)
    make('2026-09-08', 13, 15)
    make('2026-09-01', 9, 11) // 기준일 이전
    const upcoming = p.upcomingSlots('2026-09-05', 2)
    expect(upcoming.map((s) => `${s.date} ${s.startHour}`)).toEqual(['2026-09-08 9', '2026-09-08 13'])
  })
})

describe('활성 일정만 표시 (28-5-01)', () => {
  it('완료된 요청의 슬롯은 upcomingSlots에서 제외된다', () => {
    const { p, r } = driveToInProgress()
    expect(p.upcomingSlots('2026-09-01')).toHaveLength(1)
    p.completeJob(r.id, '2026-09-05')
    expect(p.upcomingSlots('2026-09-01')).toHaveLength(0)
  })

  it('scheduled와 in_progress 요청의 슬롯은 포함된다', () => {
    const { p, r } = driveToAccepted()
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    expect(p.upcomingSlots('2026-09-01')).toHaveLength(1)
    p.transitionRequest(r.id, 'in_progress')
    expect(p.upcomingSlots('2026-09-01')).toHaveLength(1)
  })
})

describe('백업 요소 수준 검증 (28-5-02)', () => {
  function baseSnap() {
    return {
      version: 1,
      store: { seq: 0, requests: [] as unknown[] },
      estimates: [] as unknown[],
      jobs: [] as unknown[],
      slots: [] as unknown[],
      slotSeq: 0,
    }
  }

  it('job.total이 정수가 아니면 거부한다 (NaN 정산 재현 케이스)', () => {
    const p = new PlatformService()
    const snap = baseSnap()
    snap.jobs = [
      {
        requestId: 'R1',
        partnerId: 'P-001',
        completedDate: '2026-09-01',
        total: 'abc',
        platformFee: 5,
        settled: false,
      },
    ]
    expect(() => p.importSnapshot(JSON.stringify(snap))).toThrow(PlatformError)
  })

  it('허용되지 않은 요청 상태·잘못된 날짜·불량 슬롯을 거부한다', () => {
    const p = new PlatformService()
    const s1 = baseSnap()
    s1.store.requests = [
      {
        id: 'R1',
        customerName: 'A',
        region: 'B',
        category: '급배수·누수·설비',
        description: 'C',
        desiredDate: '2026-09-05',
        status: 'hacked',
        createdAt: '',
      },
    ]
    expect(() => p.importSnapshot(JSON.stringify(s1))).toThrow(PlatformError)

    const s2 = baseSnap()
    s2.jobs = [
      { requestId: 'R1', partnerId: 'P-001', completedDate: '2026-02-31', total: 100, platformFee: 5, settled: false },
    ]
    expect(() => p.importSnapshot(JSON.stringify(s2))).toThrow(PlatformError)

    const s3 = baseSnap()
    s3.slots = [{ id: 'S-1', partnerId: 'P-001', requestId: 'R1', date: '2026-09-05', startHour: 20, endHour: 9 }]
    expect(() => p.importSnapshot(JSON.stringify(s3))).toThrow(PlatformError)
  })

  it('검증 실패 시 기존 데이터가 보존된다', () => {
    const { p, r } = platformWithRequest()
    const snap = baseSnap()
    snap.jobs = [
      { requestId: 'R1', partnerId: 'P-001', completedDate: '2026-09-01', total: 1.5, platformFee: 5, settled: false },
    ]
    expect(() => p.importSnapshot(JSON.stringify(snap))).toThrow(PlatformError)
    expect(p.store.get(r.id)).toBeDefined()
  })

  it('견적 breakdown은 저장값을 무시하고 재계산한다', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    const snap = JSON.parse(p.exportData())
    snap.estimates[0][1].breakdown.total = 999 // 조작된 breakdown
    const fresh = new PlatformService()
    fresh.importSnapshot(JSON.stringify(snap))
    expect(fresh.getEstimate(r.id)!.breakdown.total).toBe(275_000)
  })
})

describe('월별 리포트 (28-5-03)', () => {
  it('월별 건수/금액/정산 구분을 집계하고 최신 월부터 정렬한다', () => {
    const p = new PlatformService()
    const make = (date: string, discount: number) => {
      const r = p.addRequest(newRequest())
      p.submitEstimate(r.id, 'P-001', { ...ESTIMATE_INPUT, discount })
      p.transitionRequest(r.id, 'accepted')
      p.scheduleVisit(r.id, {
        date,
        startHour: 9 + p.scheduleSlots.length * 4,
        endHour: 11 + p.scheduleSlots.length * 4,
      })
      p.transitionRequest(r.id, 'in_progress')
      p.completeJob(r.id, date)
      return r
    }
    const aug = make('2026-08-25', 0) // total 275,000 / fee 8,250 / payout 266,750
    make('2026-09-02', 150_000) // total 110,000 / fee 3,300 / payout 106,700
    p.payFinal(aug.id, 'card')
    p.settle(aug.id)

    const report = p.monthlyReport()
    expect(report.map((m) => m.month)).toEqual(['2026-09', '2026-08'])
    const sep = report[0]!
    expect(sep.jobCount).toBe(1)
    expect(sep.payout).toBe(106_700)
    expect(sep.unsettledPayout).toBe(106_700)
    expect(sep.settledPayout).toBe(0)
    const augRow = report[1]!
    expect(augRow.settledPayout).toBe(266_750)
    expect(augRow.unsettledPayout).toBe(0)
    expect(augRow.totalAmount).toBe(275_000)
  })

  it('완료 작업이 없으면 빈 리포트', () => {
    expect(new PlatformService().monthlyReport()).toEqual([])
  })
})

describe('견적 메모 (28-5-04)', () => {
  it('메모가 저장되고 백업 round-trip에도 유지된다', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'P-001', { ...ESTIMATE_INPUT, memo: '자재 사전 주문 필요' })
    expect(p.getEstimate(r.id)!.estimate.memo).toBe('자재 사전 주문 필요')
    const fresh = new PlatformService()
    fresh.importSnapshot(p.exportData())
    expect(fresh.getEstimate(r.id)!.estimate.memo).toBe('자재 사전 주문 필요')
  })
})

describe('입찰 모델 정렬 (28-6-01)', () => {
  it('예산·입찰 마감이 검증과 함께 저장된다', () => {
    const p = new PlatformService()
    const deadline = addDays(todayUTC(), 3) // 고정 날짜는 자정이 지나면 만료된다 — 상대 날짜로 (28-61-04)
    const r = p.addRequest({ ...newRequest(), budget: 380_000, bidDeadline: deadline })
    expect(p.store.get(r.id)!.budget).toBe(380_000)
    expect(p.store.get(r.id)!.bidDeadline).toBe(deadline)
  })

  it('잘못된 예산/마감일을 거부한다', () => {
    const p = new PlatformService()
    expect(() => p.addRequest({ ...newRequest(), budget: 100.5 })).toThrow(PlatformError)
    expect(() => p.addRequest({ ...newRequest(), budget: -1 })).toThrow(PlatformError)
    expect(() => p.addRequest({ ...newRequest(), bidDeadline: '2026-02-31' })).toThrow(DateFormatError)
    expect(p.store.size).toBe(0)
  })

  it('입찰 중(estimated) 일감을 미낙찰(lost) 처리할 수 있다', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'lost')
    expect(p.store.get(r.id)!.status).toBe('lost')
  })

  it('입찰 전(requested)에는 미낙찰이 불가하다', () => {
    const { p, r } = platformWithRequest()
    expect(() => p.transitionRequest(r.id, 'lost')).toThrow(InvalidTransitionError)
  })
})

describe('추가 작업 승인 (28-6-02)', () => {
  it('시공 중 승인한 추가 작업이 완료 시 총액·수수료에 반영된다', () => {
    const { p, r } = driveToInProgress()
    p.approveExtraWork(r.id, { amount: 50_000, memo: '곰팡이 제거', approvedDate: '2026-09-05' })
    const job = p.completeJob(r.id, '2026-09-06')
    expect(job.total).toBe(325_000) // 275,000 + 50,000
    expect(job.extraTotal).toBe(50_000)
    expect(job.platformFee).toBe(9_750) // round(325,000 * 3%)
    expect(p.extraWorksFor(r.id)).toHaveLength(1)
  })

  it('시공 중이 아니면 승인할 수 없다', () => {
    const { p, r } = driveToAccepted()
    expect(() => p.approveExtraWork(r.id, { amount: 50_000, memo: 'x' })).toThrow(PlatformError)
  })

  it('0 이하·비정수 금액과 잘못된 승인일을 거부한다', () => {
    const { p, r } = driveToInProgress()
    expect(() => p.approveExtraWork(r.id, { amount: 0, memo: 'x' })).toThrow(PlatformError)
    expect(() => p.approveExtraWork(r.id, { amount: 1.5, memo: 'x' })).toThrow(PlatformError)
    expect(() => p.approveExtraWork(r.id, { amount: 1_000, memo: 'x', approvedDate: '2026-02-31' })).toThrow(
      DateFormatError,
    )
    expect(p.extraWorksFor(r.id)).toHaveLength(0)
  })

  it('추가 작업이 백업 round-trip에 유지된다', () => {
    const { p, r } = driveToInProgress()
    p.approveExtraWork(r.id, { amount: 30_000, memo: '실리콘 보강', approvedDate: '2026-09-05' })
    const fresh = new PlatformService()
    fresh.importSnapshot(p.exportData())
    expect(fresh.extraWorksFor(r.id)).toHaveLength(1)
    const job = fresh.completeJob(r.id, '2026-09-06')
    expect(job.total).toBe(305_000)
  })

  it('extraWorks가 없는 구(28-6 이전) 스냅샷도 복원된다 (28-6-04)', () => {
    const { p, r } = platformWithRequest()
    const snap = JSON.parse(p.exportData())
    delete snap.extraWorks
    delete snap.extraSeq
    const fresh = new PlatformService()
    fresh.importSnapshot(JSON.stringify(snap))
    expect(fresh.store.get(r.id)).toBeDefined()
    expect(fresh.extraWorksFor(r.id)).toEqual([])
  })

  it('오염된 extraWorks는 거부한다', () => {
    const { p } = platformWithRequest()
    const snap = JSON.parse(p.exportData())
    snap.extraWorks = [{ id: 'EW-0001', requestId: 'R1', amount: 'abc', memo: '', approvedDate: '2026-09-01' }]
    expect(() => new PlatformService().importSnapshot(JSON.stringify(snap))).toThrow(PlatformError)
  })
})

describe('작업 체크리스트 (28-8-02)', () => {
  it('기본 3항목이 미완료로 제공되고 토글이 영속화된다', () => {
    const { p, r } = platformWithRequest()
    const list = p.checklistFor(r.id)
    expect(list).toHaveLength(3)
    expect(list.every((i) => !i.done)).toBe(true)

    p.toggleChecklistItem(r.id, 'visit')
    expect(p.checklistFor(r.id).find((i) => i.key === 'visit')!.done).toBe(true)
    p.toggleChecklistItem(r.id, 'visit')
    expect(p.checklistFor(r.id).find((i) => i.key === 'visit')!.done).toBe(false)
  })

  it('없는 요청·알 수 없는 키를 거부한다', () => {
    const { p, r } = platformWithRequest()
    expect(() => p.toggleChecklistItem('REQ-9999', 'visit')).toThrow(RequestNotFoundError)
    expect(() => p.toggleChecklistItem(r.id, 'hack' as never)).toThrow(PlatformError)
  })

  it('체크 상태가 백업 round-trip에 유지된다', () => {
    const { p, r } = platformWithRequest()
    p.toggleChecklistItem(r.id, 'materials')
    const fresh = new PlatformService()
    fresh.importSnapshot(p.exportData())
    expect(fresh.checklistFor(r.id).find((i) => i.key === 'materials')!.done).toBe(true)
  })

  it('checklists가 없는 구 스냅샷도 복원된다', () => {
    const { p, r } = platformWithRequest()
    const snap = JSON.parse(p.exportData())
    delete snap.checklists
    const fresh = new PlatformService()
    fresh.importSnapshot(JSON.stringify(snap))
    expect(fresh.checklistFor(r.id).every((i) => !i.done)).toBe(true)
  })

  it('오염된 checklists는 거부한다', () => {
    const { p } = platformWithRequest()
    const snap = JSON.parse(p.exportData())
    snap.checklists = [['REQ-0001', { hack: true }]]
    expect(() => new PlatformService().importSnapshot(JSON.stringify(snap))).toThrow(PlatformError)
    const snap2 = JSON.parse(p.exportData())
    snap2.checklists = [['REQ-0001', { visit: 'yes' }]]
    expect(() => new PlatformService().importSnapshot(JSON.stringify(snap2))).toThrow(PlatformError)
  })
})

describe('파트너 프로필 (28-8-04)', () => {
  const PROFILE = { name: '반듯인테리어', specialties: '도배, 타일', region: '서울 전체', intro: '정직한 시공' }

  it('프로필을 저장·조회하고 공백을 정리한다', () => {
    const p = new PlatformService()
    expect(p.getProfile()).toBeUndefined()
    const saved = p.updateProfile({ ...PROFILE, name: '  반듯인테리어  ' })
    expect(saved.name).toBe('반듯인테리어')
    expect(p.getProfile()!.region).toBe('서울 전체')
  })

  it('업체명이 비어 있으면 거부한다', () => {
    const p = new PlatformService()
    expect(() => p.updateProfile({ ...PROFILE, name: '   ' })).toThrow(PlatformError)
    expect(p.getProfile()).toBeUndefined()
  })

  it('프로필이 백업 round-trip에 유지되고, 없는 구 스냅샷도 복원된다', () => {
    const p = new PlatformService()
    p.updateProfile(PROFILE)
    const fresh = new PlatformService()
    fresh.importSnapshot(p.exportData())
    expect(fresh.getProfile()!.name).toBe('반듯인테리어')

    const snap = JSON.parse(p.exportData())
    delete snap.profile
    delete snap.profiles // 28-42: 프로필은 profiles(파트너별)로 저장 — 둘 다 없는 구 스냅샷
    const fresh2 = new PlatformService()
    fresh2.importSnapshot(JSON.stringify(snap))
    expect(fresh2.getProfile()).toBeUndefined()
  })

  it('오염된 profile은 거부한다', () => {
    const p = new PlatformService()
    const snap = JSON.parse(p.exportData())
    snap.profile = { name: 123 }
    expect(() => new PlatformService().importSnapshot(JSON.stringify(snap))).toThrow(PlatformError)
  })
})

describe('입찰 성과 지표 (28-11-03)', () => {
  it('낙찰/미낙찰/대기를 집계하고 낙찰률은 결정된 건 기준으로 계산한다', () => {
    const p = new PlatformService()
    // 낙찰 1건
    const r1 = p.addRequest(newRequest())
    p.submitEstimate(r1.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r1.id, 'accepted')
    // 미낙찰 1건
    const r2 = p.addRequest(newRequest())
    p.submitEstimate(r2.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r2.id, 'lost')
    // 대기 1건
    const r3 = p.addRequest(newRequest())
    p.submitEstimate(r3.id, 'P-001', ESTIMATE_INPUT)
    // 입찰 안 한 일감 1건 (집계 제외)
    p.addRequest(newRequest())

    const stats = p.bidStats()
    expect(stats).toEqual({ totalBids: 3, won: 1, lost: 1, pending: 1, winRate: 50 })
  })

  it('결정된 입찰이 없으면 낙찰률은 null', () => {
    const p = new PlatformService()
    expect(p.bidStats().winRate).toBeNull()
    const r = p.addRequest(newRequest())
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    expect(p.bidStats()).toEqual({ totalBids: 1, won: 0, lost: 0, pending: 1, winRate: null })
  })

  it('입찰 후 취소된 건은 totalBids에만 포함된다', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'cancelled')
    expect(p.bidStats()).toEqual({ totalBids: 1, won: 0, lost: 0, pending: 0, winRate: null })
  })

  it('낙찰 이후 어느 단계에 있어도 낙찰로 집계된다', () => {
    const { p, r } = driveToInProgress()
    expect(p.bidStats().won).toBe(1)
    p.completeJob(r.id, '2026-09-06')
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    expect(p.bidStats().won).toBe(1)
    expect(p.bidStats().winRate).toBe(100)
  })
})

describe('adminOverview (28-14-03)', () => {
  it('빈 플랫폼이면 전 항목 0', () => {
    const p = new PlatformService()
    expect(p.adminOverview()).toEqual({
      totalRequests: 0,
      activeRequests: 0,
      completedOrSettled: 0,
      lostOrCancelled: 0,
      feeConfirmed: 0,
      feePending: 0,
    })
  })

  it('진행/완료/이탈 계열과 수수료 확정·예정을 함께 집계한다', () => {
    const { p, r } = driveToInProgress()
    // r: 완료 후 정산 확정 → feeConfirmed
    p.completeJob(r.id, '2026-09-06')
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    // r2: 완료만 (미정산) → feePending
    const r2 = p.addRequest(newRequest())
    p.submitEstimate(r2.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r2.id, 'accepted')
    p.scheduleVisit(r2.id, { date: '2026-09-07', startHour: 9, endHour: 12 })
    p.transitionRequest(r2.id, 'in_progress')
    p.completeJob(r2.id, '2026-09-08')
    // r3: 진행 계열 (requested)
    p.addRequest(newRequest())
    // r4: 미낙찰 (이탈 계열)
    const r4 = p.addRequest(newRequest())
    p.submitEstimate(r4.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r4.id, 'lost')

    const fee = Math.round(275_000 * 0.03) // ESTIMATE_INPUT 총액 275,000원의 3%
    expect(p.adminOverview()).toEqual({
      totalRequests: 4,
      activeRequests: 1,
      completedOrSettled: 2,
      lostOrCancelled: 1,
      feeConfirmed: fee,
      feePending: fee,
    })
  })

  it('정산이 진행되면 수수료가 예정에서 확정으로 이동한다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    const before = p.adminOverview()
    expect(before.feePending).toBeGreaterThan(0)
    expect(before.feeConfirmed).toBe(0)
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    const after = p.adminOverview()
    expect(after.feeConfirmed).toBe(before.feePending)
    expect(after.feePending).toBe(0)
  })
})

describe('추가 작업 승인 흐름 (28-15-01)', () => {
  it('requestExtraWork는 pending으로 생성되고 시공 중에만 가능하다', () => {
    const { p, r } = driveToInProgress()
    const extra = p.requestExtraWork(r.id, { amount: 80_000, memo: '배관 연결 부속 교체' })
    expect(extra.status).toBe('pending')
    const { p: p2, r: r2 } = platformWithRequest()
    expect(() => p2.requestExtraWork(r2.id, { amount: 10_000, memo: 'x' })).toThrow(PlatformError)
  })

  it('pending이 남아 있으면 completeJob이 거부된다', () => {
    const { p, r } = driveToInProgress()
    p.requestExtraWork(r.id, { amount: 80_000, memo: '부속 교체' })
    expect(() => p.completeJob(r.id, '2026-09-06')).toThrow(PlatformError)
  })

  it('승인된 추가 작업만 완료 총액에 포함된다', () => {
    const { p, r } = driveToInProgress()
    const a = p.requestExtraWork(r.id, { amount: 80_000, memo: '승인될 것' })
    const b = p.requestExtraWork(r.id, { amount: 50_000, memo: '거절될 것' })
    p.decideExtraWork(a.id, 'approved', '2026-09-05')
    p.decideExtraWork(b.id, 'rejected', '2026-09-05')
    const job = p.completeJob(r.id, '2026-09-06')
    expect(job.extraTotal).toBe(80_000)
    expect(job.total).toBe(275_000 + 80_000)
  })

  it('이미 결정된 추가 작업은 다시 결정할 수 없다', () => {
    const { p, r } = driveToInProgress()
    const a = p.requestExtraWork(r.id, { amount: 10_000, memo: 'x' })
    p.decideExtraWork(a.id, 'approved')
    expect(() => p.decideExtraWork(a.id, 'rejected')).toThrow(PlatformError)
    // 구 방식(approveExtraWork)으로 만든 항목(status 없음)도 재결정 불가
    const legacy = p.approveExtraWork(r.id, { amount: 5_000, memo: 'legacy' })
    expect(() => p.decideExtraWork(legacy.id, 'approved')).toThrow(PlatformError)
  })

  it('status 없는 구 스냅샷의 추가 작업은 승인으로 취급된다 (하위 호환)', () => {
    const { p, r } = driveToInProgress()
    p.approveExtraWork(r.id, { amount: 30_000, memo: '구 방식 즉시 승인' })
    const snap = p.exportData()
    const restored = new PlatformService()
    restored.importSnapshot(snap)
    const job = restored.completeJob(r.id, '2026-09-06')
    expect(job.extraTotal).toBe(30_000)
  })
})

describe('requestTimeline (28-15-03)', () => {
  it('정산 완료 거래는 전 구간 done + 파생 날짜를 갖는다', () => {
    const { p, r } = driveToInProgress()
    const a = p.requestExtraWork(r.id, { amount: 80_000, memo: '부속' })
    p.decideExtraWork(a.id, 'approved')
    p.completeJob(r.id, '2026-09-06')
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    const tl = p.requestTimeline(r.id)
    expect(tl.every((e) => e.done)).toBe(true)
    expect(tl.find((e) => e.key === 'scheduled')?.date).toBe('2026-09-05')
    expect(tl.find((e) => e.key === 'completed')?.date).toBe('2026-09-06')
    expect(tl.find((e) => e.key === 'extra')?.label).toContain('결정됨')
  })

  it('미낙찰 거래는 종결 이벤트로 닫히고 이후 단계는 done이 아니다', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'lost')
    const tl = p.requestTimeline(r.id)
    expect(tl.find((e) => e.key === 'estimated')?.done).toBe(true)
    expect(tl.find((e) => e.key === 'accepted')?.done).toBe(false)
    expect(tl[tl.length - 1]).toMatchObject({ key: 'lost', done: true })
  })
})

describe('희망 시간대·예산 범위 (28-16-02)', () => {
  it('desiredTime·budgetRange가 저장되고 스냅샷을 왕복한다', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), desiredTime: '오후', budgetRange: '30~50만원' })
    expect(r.desiredTime).toBe('오후')
    expect(r.budgetRange).toBe('30~50만원')
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    const back = restored.store.get(r.id)!
    expect(back.desiredTime).toBe('오후')
    expect(back.budgetRange).toBe('30~50만원')
  })

  it('잘못된 desiredTime은 등록·복원 모두 거부된다', () => {
    const p = new PlatformService()
    expect(() => p.addRequest({ ...newRequest(), desiredTime: '심야' as unknown as '오전' })).toThrow(PlatformError)
    const q = new PlatformService()
    const r = q.addRequest(newRequest())
    const snap = JSON.parse(q.exportData())
    snap.store.requests[0].desiredTime = '심야'
    void r
    expect(() => new PlatformService().importSnapshot(JSON.stringify(snap))).toThrow(PlatformError)
  })
})

describe('리뷰·평점 (28-17-01)', () => {
  it('완료 이후에만 작성 가능, 별점 범위·중복을 검증한다', () => {
    const { p, r } = driveToInProgress()
    expect(() => p.writeReview(r.id, { rating: 5, text: '좋아요' })).toThrow(PlatformError)
    p.completeJob(r.id, '2026-09-06')
    expect(() => p.writeReview(r.id, { rating: 6, text: 'x' })).toThrow(PlatformError)
    expect(() => p.writeReview(r.id, { rating: 0, text: 'x' })).toThrow(PlatformError)
    const review = p.writeReview(r.id, { rating: 5, text: '  꼼꼼하고 깔끔했어요  ', createdDate: '2026-09-07' })
    expect(review).toEqual({ requestId: r.id, rating: 5, text: '꼼꼼하고 깔끔했어요', createdDate: '2026-09-07' })
    expect(() => p.writeReview(r.id, { rating: 4, text: '중복' })).toThrow(PlatformError)
  })

  it('reviewStats는 건수와 평균(소수 1자리)을 집계한다', () => {
    const p = new PlatformService()
    expect(p.reviewStats()).toEqual({ count: 0, average: null })
    const drive = () => {
      const r = p.addRequest(newRequest())
      p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
      p.transitionRequest(r.id, 'accepted')
      p.scheduleVisit(r.id, {
        date: '2026-09-05',
        startHour: 9 + p.reviewStats().count * 3,
        endHour: 10 + p.reviewStats().count * 3,
      })
      p.transitionRequest(r.id, 'in_progress')
      p.completeJob(r.id, '2026-09-06')
      return r
    }
    p.writeReview(drive().id, { rating: 5, text: 'a' })
    p.writeReview(drive().id, { rating: 4, text: 'b' })
    p.writeReview(drive().id, { rating: 4, text: 'c' })
    expect(p.reviewStats()).toEqual({ count: 3, average: 4.3 })
  })

  it('스냅샷을 왕복하고, 리뷰 있는 거래의 타임라인에 리뷰 이벤트가 붙는다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    p.writeReview(r.id, { rating: 5, text: '만족', createdDate: '2026-09-07' })
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    expect(restored.reviewFor(r.id)).toEqual({ requestId: r.id, rating: 5, text: '만족', createdDate: '2026-09-07' })
    const tl = restored.requestTimeline(r.id)
    expect(tl[tl.length - 1]).toMatchObject({ key: 'review', done: true, date: '2026-09-07' })
    // 잘못된 rating이 든 스냅샷은 거부
    const snap = JSON.parse(p.exportData())
    snap.reviews[0].rating = 9
    expect(() => new PlatformService().importSnapshot(JSON.stringify(snap))).toThrow(PlatformError)
  })
})

describe('운영 설정 SiteSettings (28-21-01)', () => {
  it('기본값이 병합된 설정을 돌려주고 부분 갱신이 영속된다', () => {
    const p = new PlatformService()
    expect(p.getSettings().heroTitle).toContain('집수리')
    expect(p.getSettings().faqs.length).toBeGreaterThan(0)
    p.updateSettings({ heroTitle: '우리 동네 수리 전문가', notice: '추석 연휴 휴무 안내' })
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    expect(restored.getSettings().heroTitle).toBe('우리 동네 수리 전문가')
    expect(restored.getSettings().notice).toBe('추석 연휴 휴무 안내')
    // 패치하지 않은 필드는 기본값 유지
    expect(restored.getSettings().heroSub).toBe(p.getSettings().heroSub)
  })

  it('카테고리 비활성이 enabledCategories에 반영되고, 전부 비활성은 거부된다', () => {
    const p = new PlatformService()
    p.updateSettings({ disabledCategories: ['도배·도장·필름', '바닥·타일'] })
    const enabled = p.enabledCategories()
    expect(enabled).not.toContain('도배·도장·필름')
    expect(enabled).not.toContain('바닥·타일')
    expect(enabled).toContain('주방·욕실 공사')
    expect(() =>
      p.updateSettings({ disabledCategories: [...p.enabledCategories(), '도배·도장·필름', '바닥·타일'] }),
    ).toThrow(PlatformError)
    expect(() => p.updateSettings({ disabledCategories: ['페인트' as unknown as '도배·도장·필름'] })).toThrow(
      PlatformError,
    )
  })

  it('히어로 공백·빈 FAQ 질문은 거부되고, 불량 스냅샷도 거부된다', () => {
    const p = new PlatformService()
    expect(() => p.updateSettings({ heroTitle: '   ' })).toThrow(PlatformError)
    expect(() => p.updateSettings({ faqs: [{ q: ' ', a: 'x' }] })).toThrow(PlatformError)
    const snap = JSON.parse(p.exportData())
    snap.settings.heroTitle = ''
    expect(() => new PlatformService().importSnapshot(JSON.stringify(snap))).toThrow(PlatformError)
    // settings 없는 구 스냅샷은 기본값으로 복원
    const legacy = JSON.parse(p.exportData())
    delete legacy.settings
    const q = new PlatformService()
    q.importSnapshot(JSON.stringify(legacy))
    expect(q.getSettings().heroTitle).toContain('집수리')
  })
})

describe('분쟁 접수 (28-22-01 → 28-90)', () => {
  it('분쟁은 낙찰 이후에만 접수된다 — 완료 뒤의 하자도 같은 통로다', () => {
    const { p, r } = platformWithRequest()
    expect(() => p.fileClaim(r.id, { detail: '연락 두절' })).toThrow(PlatformError)
    const { p: p2, r: r2 } = driveToInProgress()
    const d = p2.fileClaim(r2.id, { detail: '일정 무단 변경', createdDate: '2026-09-05' })
    expect(d).toMatchObject({ id: 'CL-0001', status: 'open' })
    expect('kind' in d).toBe(false) // 28-90: A/S·분쟁 구분이 사라졌다
    p2.completeJob(r2.id, '2026-09-06')
    p2.fileClaim(r2.id, { detail: '실리콘 들뜸' })
    expect(() => p2.fileClaim(r2.id, { detail: '   ' })).toThrow(PlatformError)
    expect(p2.openClaimCount()).toBe(2)
  })

  it('28-90: 열린 분쟁은 그 거래의 정산 확정·지급을 보류하고, 해결되면 풀린다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    p.payFinal(r.id, 'card')
    const c = p.fileClaim(r.id, { detail: '마감이 들떠요', createdDate: '2026-09-07' })
    // 수정 전: 분쟁이 열려 있어도 정산·지급이 그대로 됐다
    expect(() => p.settle(r.id)).toThrow('분쟁 검토 중')
    p.resolveClaim(c.id, '재방문 보수 완료', '2026-09-08')
    p.settle(r.id)
    const c2 = p.fileClaim(r.id, { detail: '다시 들떴어요', createdDate: '2026-09-09' })
    expect(() => p.markPayout(r.id, '국민은행 123****890 (김반듯)')).toThrow('분쟁 검토 중')
    expect(p.hasOpenClaim(r.id)).toBe(true)
    p.resolveClaim(c2.id, '재시공 완료', '2026-09-10')
    expect(p.hasOpenClaim(r.id)).toBe(false)
    // 28-90: 인증되지 않은 계좌에는 지급하지 않는다
    expect(() =>
      p.markPayout(r.id, {
        label: '국민은행 123****890 (김반듯)',
        masked: '국민은행 123****890 (김**)',
        verified: false,
      }),
    ).toThrow('인증되지 않은')
    expect(p.markPayout(r.id, '국민은행 123****890 (김반듯)').payout?.amount).toBeGreaterThan(0)
    // 옛 스냅샷의 kind 는 무시하고 읽는다
    const snap = JSON.parse(p.exportData())
    snap.claims[0].kind = 'as'
    const again = new PlatformService()
    again.importSnapshot(JSON.stringify(snap))
    expect(again.allClaims()).toHaveLength(2)
  })

  it('검토 시작 → 해결 처리 흐름과 상태 규칙을 강제한다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    const c = p.fileClaim(r.id, { detail: '벽지 모서리 들뜸' })
    p.reviewClaim(c.id)
    expect(() => p.reviewClaim(c.id)).toThrow(PlatformError)
    expect(() => p.resolveClaim(c.id, '  ')).toThrow(PlatformError)
    const done = p.resolveClaim(c.id, '재방문 보수 완료', '2026-09-08')
    expect(done).toMatchObject({ status: 'resolved', resolution: '재방문 보수 완료', resolvedDate: '2026-09-08' })
    expect(() => p.resolveClaim(c.id, '중복')).toThrow(PlatformError)
    expect(p.openClaimCount()).toBe(0)
  })

  it('미해결 우선 정렬·스냅샷 왕복·불량 스냅샷 거부', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    const c1 = p.fileClaim(r.id, { detail: '먼저 접수', createdDate: '2026-09-07' })
    p.fileClaim(r.id, { detail: '나중 접수', createdDate: '2026-09-08' })
    p.resolveClaim(c1.id, '보수 완료')
    const all = p.allClaims()
    expect(all[0]!.detail).toBe('나중 접수')
    expect(all[all.length - 1]!.status).toBe('resolved')
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    expect(restored.allClaims().length).toBe(2)
    expect(restored.claimsFor(r.id).length).toBe(2)
    const snap = JSON.parse(p.exportData())
    snap.claims[0].status = 'resolved'
    delete snap.claims[0].resolution
    expect(() => new PlatformService().importSnapshot(JSON.stringify(snap))).toThrow(PlatformError)
  })
})

describe('monthSummary (28-24-01)', () => {
  it('해당 월 실적 행을 돌려주고, 없는 월은 0 행', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    const s = p.monthSummary('2026-09')
    expect(s.jobCount).toBe(1)
    expect(s.payout).toBe(s.settledPayout)
    expect(s.payout).toBeGreaterThan(0)
    expect(p.monthSummary('2026-01')).toEqual({
      month: '2026-01',
      jobCount: 0,
      totalAmount: 0,
      totalFee: 0,
      payout: 0,
      settledPayout: 0,
      unsettledPayout: 0,
    })
  })
})

describe('가격 패키지 (28-25-01)', () => {
  it('기본 시드가 있고, 등록은 정찰가·카테고리를 검증한다', () => {
    const p = new PlatformService()
    expect(p.listPackages().length).toBeGreaterThan(0)
    const pkg = p.addPackage({
      name: ' 형광등 교체 ',
      category: '전기·조명',
      price: 30000,
      description: ' LED 평판등 포함 ',
    })
    expect(pkg.id).toMatch(/^PK-\d{4}$/)
    expect(pkg.name).toBe('형광등 교체')
    expect(pkg.description).toBe('LED 평판등 포함')
    expect(pkg.active).toBe(true)
    expect(p.listPackages().at(-1)?.id).toBe(pkg.id)
    expect(() => p.addPackage({ name: '  ', category: '전기·조명', price: 1000 })).toThrow('이름')
    expect(() => p.addPackage({ name: 'x', category: '전기·조명', price: 0 })).toThrow('정수')
    expect(() => p.addPackage({ name: 'x', category: '전기·조명', price: -5 })).toThrow('정수')
    expect(() => p.addPackage({ name: 'x', category: '전기·조명', price: 1000.5 })).toThrow('정수')
    // @ts-expect-error 미지의 카테고리 거부 검증
    expect(() => p.addPackage({ name: 'x', category: '골프장', price: 1000 })).toThrow('카테고리')
  })

  it('수정·토글·삭제가 동작하고 없는 id는 거부한다', () => {
    const p = new PlatformService()
    const pkg = p.addPackage({ name: '형광등 교체', category: '전기·조명', price: 30000 })
    const up = p.updatePackage(pkg.id, { price: 35000, name: '형광등·LED 교체' })
    expect(up.price).toBe(35000)
    expect(up.name).toBe('형광등·LED 교체')
    expect(() => p.updatePackage(pkg.id, { price: 3.5 })).toThrow('정수')
    expect(p.togglePackage(pkg.id).active).toBe(false)
    expect(p.togglePackage(pkg.id).active).toBe(true)
    p.removePackage(pkg.id)
    expect(p.listPackages().some((x) => x.id === pkg.id)).toBe(false)
    expect(() => p.togglePackage('PK-9999')).toThrow('찾을 수 없습니다')
    expect(() => p.updatePackage('PK-9999', {})).toThrow('찾을 수 없습니다')
    expect(() => p.removePackage('PK-9999')).toThrow('찾을 수 없습니다')
  })

  it('activePackages는 숨김 패키지와 비활성 카테고리를 제외한다', () => {
    const p = new PlatformService()
    const a = p.addPackage({ name: '전기 A', category: '전기·조명', price: 10000 })
    const b = p.addPackage({ name: '욕실 B', category: '주방·욕실 공사', price: 20000 })
    p.togglePackage(a.id)
    let ids = p.activePackages().map((x) => x.id)
    expect(ids).not.toContain(a.id)
    expect(ids).toContain(b.id)
    p.updateSettings({ disabledCategories: ['주방·욕실 공사'] })
    ids = p.activePackages().map((x) => x.id)
    expect(ids).not.toContain(b.id)
  })

  it('스냅샷 왕복이 유지되고, 구 스냅샷(패키지 없음)은 기본 시드로 복원된다', () => {
    const p = new PlatformService()
    const pkg = p.addPackage({ name: '형광등 교체', category: '전기·조명', price: 30000 })
    p.togglePackage(pkg.id)
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    const found = restored.listPackages().find((x) => x.id === pkg.id)
    expect(found?.active).toBe(false)
    // 신규 등록 ID가 이어져 충돌하지 않는다
    const next = restored.addPackage({ name: '추가', category: '전기·조명', price: 1000 })
    expect(next.id).not.toBe(pkg.id)
    // 구 스냅샷: packages 필드 제거
    const legacy = JSON.parse(p.exportData())
    delete legacy.packages
    delete legacy.packageSeq
    const old = new PlatformService()
    old.importSnapshot(JSON.stringify(legacy))
    expect(old.listPackages().map((x) => x.id)).toEqual(DEFAULT_PACKAGES.map((x) => x.id))
    // 손상 스냅샷: 가격이 정수가 아니면 거부
    const bad = JSON.parse(p.exportData())
    bad.packages[0].price = '9만원'
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow()
  })
})

describe('질문 빌더 (28-26-01)', () => {
  it('기본 시드가 있고, 등록은 질문·선택지·카테고리를 검증한다', () => {
    const p = new PlatformService()
    expect(p.listQuestions().length).toBeGreaterThan(0)
    expect(p.questionsFor('주방·욕실 공사').length).toBeGreaterThan(0)
    const q = p.addQuestion({ category: '창호·유리', label: ' 창 개수가 몇 개인가요? ' })
    expect(q.id).toMatch(/^Q-\d{4}$/)
    expect(q.label).toBe('창 개수가 몇 개인가요?')
    expect(q.options).toBeUndefined()
    const c = p.addQuestion({ category: '창호·유리', label: '샷시 재질은?', options: [' PVC ', '알루미늄', ''] })
    expect(c.options).toEqual(['PVC', '알루미늄'])
    expect(() => p.addQuestion({ category: '창호·유리', label: '   ' })).toThrow('비울 수 없습니다')
    expect(() => p.addQuestion({ category: '창호·유리', label: 'x', options: ['하나만'] })).toThrow('2개 이상')
    // @ts-expect-error 미지의 카테고리 거부 검증
    expect(() => p.addQuestion({ category: '골프장', label: 'x' })).toThrow('카테고리')
  })

  it('토글·삭제와 questionsFor 필터가 동작한다', () => {
    const p = new PlatformService()
    const q = p.addQuestion({ category: '목공·가구', label: '몰딩 교체가 필요한가요?' })
    expect(p.questionsFor('목공·가구').some((x) => x.id === q.id)).toBe(true)
    expect(p.toggleQuestion(q.id).active).toBe(false)
    expect(p.questionsFor('목공·가구').some((x) => x.id === q.id)).toBe(false)
    p.removeQuestion(q.id)
    expect(p.listQuestions().some((x) => x.id === q.id)).toBe(false)
    expect(() => p.toggleQuestion('Q-9999')).toThrow('찾을 수 없습니다')
    expect(() => p.removeQuestion('Q-9999')).toThrow('찾을 수 없습니다')
  })

  it('스냅샷 왕복·구 스냅샷 시드 복원·손상 거부', () => {
    const p = new PlatformService()
    const q = p.addQuestion({ category: '급배수·누수·설비', label: '몇 층인가요?' })
    p.toggleQuestion(q.id)
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    expect(restored.listQuestions().find((x) => x.id === q.id)?.active).toBe(false)
    const legacy = JSON.parse(p.exportData())
    delete legacy.questions
    delete legacy.questionSeq
    const old = new PlatformService()
    old.importSnapshot(JSON.stringify(legacy))
    expect(old.listQuestions().map((x) => x.id)).toEqual(DEFAULT_QUESTIONS.map((x) => x.id))
    const bad = JSON.parse(p.exportData())
    bad.questions[0].options = ['하나']
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow()
  })
})

describe('요청 답변 (28-26-02)', () => {
  it('답변이 요청에 실리고, 빈 답변은 걸러지며, 스냅샷 왕복이 유지된다', () => {
    const p = new PlatformService()
    const r = p.addRequest({
      customerName: '김반듯',
      region: '서울',
      category: '주방·욕실 공사',
      description: '실리콘 재시공',
      desiredDate: '2026-09-10',
      answers: [
        { question: '누수나 곰팡이가 있나요?', answer: ' 곰팡이 있음 ' },
        { question: '건물 연식이 어떻게 되나요?', answer: '   ' },
      ],
    })
    expect(r.answers).toEqual([{ question: '누수나 곰팡이가 있나요?', answer: '곰팡이 있음' }])
    // 전부 빈 답변이면 answers 자체가 실리지 않는다
    const r2 = p.addRequest({
      customerName: '김반듯',
      region: '서울',
      category: '주방·욕실 공사',
      description: '테스트',
      desiredDate: '2026-09-10',
      answers: [{ question: 'Q', answer: '' }],
    })
    expect(r2.answers).toBeUndefined()
    expect(() =>
      p.addRequest({
        customerName: '김반듯',
        region: '서울',
        category: '주방·욕실 공사',
        description: '테스트',
        desiredDate: '2026-09-10',
        answers: [{ question: ' ', answer: '값' }],
      }),
    ).toThrow('질문 텍스트')
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    expect(restored.store.get(r.id)?.answers).toEqual(r.answers)
    // 손상: answers 요소가 문자열 쌍이 아니면 거부
    const bad = JSON.parse(p.exportData())
    bad.store.requests[0].answers = [{ question: '', answer: 'x' }]
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow()
  })
})

describe('거래 채팅 (28-27-01)', () => {
  it('견적 이후 전송 가능, 견적 전·종료 거래·공백은 거부한다', () => {
    const { p, r } = platformWithRequest()
    expect(() => p.sendMessage(r.id, 'customer', '안녕하세요')).toThrow('견적이 도착한 뒤')
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    const m = p.sendMessage(r.id, 'customer', ' 주차 가능한가요? ')
    expect(m.id).toMatch(/^MSG-\d{4}$/)
    expect(m.text).toBe('주차 가능한가요?')
    expect(() => p.sendMessage(r.id, 'customer', '   ')).toThrow('메시지를 입력하세요')
    expect(() => p.sendMessage('REQ-9999', 'customer', 'x')).toThrow(RequestNotFoundError)
    p.transitionRequest(r.id, 'lost')
    expect(() => p.sendMessage(r.id, 'partner', '답장')).toThrow('종료된 거래')
  })

  it('chatFor는 순서를 보존하고 unread/markRead 워터마크가 동작한다', () => {
    const { p, r } = driveToAccepted()
    p.sendMessage(r.id, 'customer', '주차 가능한가요?')
    p.sendMessage(r.id, 'customer', '오전에 와주세요')
    expect(p.chatFor(r.id).map((m) => m.text)).toEqual(['주차 가능한가요?', '오전에 와주세요'])
    // 파트너 입장: 안 읽은 2건, 자기 메시지는 카운트 안 됨
    expect(p.unreadCount(r.id, 'partner')).toBe(2)
    expect(p.unreadCount(r.id, 'customer')).toBe(0)
    p.markRead(r.id, 'partner')
    expect(p.unreadCount(r.id, 'partner')).toBe(0)
    p.sendMessage(r.id, 'partner', '네 가능합니다')
    expect(p.unreadCount(r.id, 'partner')).toBe(0)
    expect(p.unreadCount(r.id, 'customer')).toBe(1)
    p.markRead(r.id, 'customer')
    expect(p.unreadCount(r.id, 'customer')).toBe(0)
  })

  it('스냅샷 왕복(메시지·읽음 상태)과 구 스냅샷·손상 거부', () => {
    const { p, r } = driveToAccepted()
    p.sendMessage(r.id, 'customer', '주차 가능한가요?')
    p.markRead(r.id, 'partner')
    p.sendMessage(r.id, 'partner', '네 가능합니다')
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    expect(restored.chatFor(r.id)).toEqual(p.chatFor(r.id))
    expect(restored.unreadCount(r.id, 'customer')).toBe(1)
    expect(restored.unreadCount(r.id, 'partner')).toBe(0)
    // 신규 메시지 ID가 이어져 충돌하지 않는다
    expect(restored.sendMessage(r.id, 'customer', '감사합니다').id).not.toBe(p.chatFor(r.id)[1]!.id)
    // 구 스냅샷: chats 없음 → 빈 대화
    const legacy = JSON.parse(p.exportData())
    delete legacy.chats
    delete legacy.chatSeq
    delete legacy.chatReads
    const old = new PlatformService()
    old.importSnapshot(JSON.stringify(legacy))
    expect(old.chatFor(r.id)).toEqual([])
    // 손상: 빈 텍스트 메시지 거부
    const bad = JSON.parse(p.exportData())
    bad.chats[0].text = '  '
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow()
  })
})

describe('결제 (28-28-01)', () => {
  it('예약금은 낙찰 상태에서만, 낙찰가의 10%(최소 1만원), 중복 거부', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    expect(() => p.payDeposit(r.id, 'card')).toThrow('낙찰(accepted) 상태')
    p.transitionRequest(r.id, 'accepted')
    const dep = p.payDeposit(r.id, 'card')
    expect(dep.amount).toBe(27_500) // 275,000의 10%
    expect(dep.receiptNo).toMatch(/^RCT-\d{4}$/)
    expect(() => p.payDeposit(r.id, 'card')).toThrow('이미 예약금')
    // @ts-expect-error 미지의 결제 수단 거부 검증
    expect(() => p.payFinal(r.id, 'bitcoin')).toThrow('결제 수단')
  })

  it('최종 결제는 완료 상태에서만, 최종 금액 − 예약금, 중복 거부', () => {
    const { p, r } = driveToAccepted()
    p.payDeposit(r.id, 'card')
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    p.transitionRequest(r.id, 'in_progress')
    expect(() => p.payFinal(r.id, 'card')).toThrow('작업 완료(completed) 상태')
    p.approveExtraWork(r.id, { amount: 50_000, memo: '곰팡이 제거', approvedDate: '2026-09-05' })
    p.completeJob(r.id, '2026-09-06') // total 325,000
    const fin = p.payFinal(r.id, 'transfer')
    expect(fin.amount).toBe(325_000 - 27_500)
    expect(() => p.payFinal(r.id, 'card')).toThrow('이미 결제가 완료')
    expect(p.paymentsFor(r.id).map((x) => x.kind)).toEqual(['deposit', 'final'])
  })

  it('최종 결제 없이는 정산할 수 없다 (상용 불변식)', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    expect(() => p.settle(r.id)).toThrow('고객 결제 완료 후')
    expect(() => p.transitionRequest(r.id, 'settled')).toThrow('고객 결제 완료 후')
    p.payFinal(r.id, 'card')
    expect(p.settle(r.id).status).toBe('settled')
  })

  it('스냅샷 왕복이 유지되고, 구 스냅샷·손상은 규칙대로 처리된다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    p.payFinal(r.id, 'card')
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    expect(restored.paymentFor(r.id, 'final')?.amount).toBe(275_000)
    expect(restored.settle(r.id).status).toBe('settled')
    const legacy = JSON.parse(p.exportData())
    delete legacy.payments
    delete legacy.paymentSeq
    const old = new PlatformService()
    old.importSnapshot(JSON.stringify(legacy))
    expect(old.paymentsFor(r.id)).toEqual([])
    const bad = JSON.parse(p.exportData())
    bad.payments[0].amount = 12.5
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow()
  })
})

describe('업체 요약 partnerSummary (28-31-01)', () => {
  it('프로필 미설정 시 기본 프로필, 설정·실적·평판이 반영된다', () => {
    const p = new PlatformService()
    const before = p.partnerSummary()
    expect(before.profile).toEqual(DEFAULT_PARTNER_PROFILE)
    expect(before.completedCount).toBe(0)
    expect(before.average).toBeNull()
    p.updateProfile({ name: '반듯설비', specialties: '욕실, 누수', region: '서울 서남권', intro: '10년 경력' })
    const { p: p2, r } = driveToInProgress()
    p2.updateProfile({ name: '반듯설비', specialties: '욕실, 누수', region: '서울 서남권', intro: '10년 경력' })
    p2.completeJob(r.id, '2026-09-06')
    p2.payFinal(r.id, 'card')
    p2.settle(r.id)
    p2.writeReview(r.id, { rating: 5, text: '깔끔했어요', createdDate: '2026-09-07' })
    const s = p2.partnerSummary()
    expect(s.profile.name).toBe('반듯설비')
    expect(s.completedCount).toBe(1)
    expect(s.winRate).toBe(100)
    expect(s.reviewCount).toBe(1)
    expect(s.average).toBe(5)
  })
})

describe('요청-계정 연결 (28-32-01)', () => {
  it('customerId가 요청에 실리고 스냅샷 왕복이 유지되며 손상은 거부된다', () => {
    const p = new PlatformService()
    const mine = p.addRequest({
      customerId: 'AC-0001',
      customerName: '정지훈',
      region: '서울',
      category: '주방·욕실 공사',
      description: '실리콘 재시공',
      desiredDate: '2026-09-10',
    })
    const anon = p.addRequest({
      customerName: '김하늘',
      region: '서울',
      category: '급배수·누수·설비',
      description: '천장 누수',
      desiredDate: '2026-09-10',
    })
    expect(mine.customerId).toBe('AC-0001')
    expect(anon.customerId).toBeUndefined()
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    expect(restored.store.get(mine.id)?.customerId).toBe('AC-0001')
    expect(restored.store.list().filter((r) => r.customerId === 'AC-0001')).toHaveLength(1)
    const bad = JSON.parse(p.exportData())
    bad.store.requests[0].customerId = ''
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow()
  })
})

describe('인앱 알림 (28-35-01)', () => {
  it('거래 이벤트마다 역할별 알림이 쌓이고, 읽음 처리·최신순·왕복이 동작한다', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    expect(p.unreadNotificationCount('customer')).toBe(1)
    expect(p.notificationsFor('customer')[0]?.text).toContain('견적이 도착')
    p.transitionRequest(r.id, 'accepted')
    expect(p.notificationsFor('partner')[0]?.text).toContain('낙찰')
    p.payDeposit(r.id, 'card')
    expect(p.notificationsFor('partner')[0]?.text).toContain('예약금')
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    expect(p.notificationsFor('customer')[0]?.text).toContain('방문 일정')
    p.transitionRequest(r.id, 'in_progress')
    const ex = p.requestExtraWork(r.id, { amount: 50_000, memo: '곰팡이 제거' })
    expect(p.notificationsFor('customer')[0]?.text).toContain('추가 작업 승인 요청')
    p.decideExtraWork(ex.id, 'approved')
    expect(p.notificationsFor('partner')[0]?.text).toContain('승인')
    p.completeJob(r.id, '2026-09-06')
    expect(p.notificationsFor('customer')[0]?.text).toContain('최종 결제')
    p.payFinal(r.id, 'card')
    expect(p.notificationsFor('admin')[0]?.text).toContain('결제 완료')
    p.settle(r.id)
    p.writeReview(r.id, { rating: 5, text: '좋아요', createdDate: '2026-09-07' })
    expect(p.notificationsFor('partner')[0]?.text).toContain('★5')
    const claim = p.fileClaim(r.id, { detail: '실리콘 들뜸', createdDate: '2026-09-08' })
    expect(p.notificationsFor('admin')[0]?.text).toContain('분쟁 접수')
    p.resolveClaim(claim.id, '재방문 보수 완료', '2026-09-09')
    expect(p.notificationsFor('customer')[0]?.text).toContain('분쟁 처리 완료')
    // 읽음 처리 + 왕복
    const before = p.unreadNotificationCount('customer')
    expect(before).toBeGreaterThan(1)
    p.markAllNotificationsRead('customer')
    expect(p.unreadNotificationCount('customer')).toBe(0)
    expect(p.unreadNotificationCount('partner')).toBeGreaterThan(0)
    const restored = new PlatformService()
    restored.importSnapshot(p.exportData())
    expect(restored.unreadNotificationCount('customer')).toBe(0)
    expect(restored.notificationsFor('partner')).toEqual(p.notificationsFor('partner'))
    const legacy = JSON.parse(p.exportData())
    delete legacy.notifications
    delete legacy.notificationSeq
    const old = new PlatformService()
    old.importSnapshot(JSON.stringify(legacy))
    expect(old.notificationsFor('customer')).toEqual([])
    const bad = JSON.parse(p.exportData())
    bad.notifications[0].role = 'alien'
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow()
  })

  it('고객 알림은 계정 스코프 — 다른 고객·계정 미연결 요청의 알림은 보이지 않는다', () => {
    const p = new PlatformService()
    const mine = p.addRequest({
      customerId: 'AC-0001',
      customerName: '정지훈',
      region: '서울',
      category: '주방·욕실 공사',
      description: '내 요청',
      desiredDate: '2026-09-10',
    })
    const other = p.addRequest({
      customerId: 'AC-0002',
      customerName: '김하늘',
      region: '서울',
      category: '급배수·누수·설비',
      description: '남의 요청',
      desiredDate: '2026-09-10',
    })
    const anon = p.addRequest({
      customerName: '시드',
      region: '서울',
      category: '전기·조명',
      description: '시드 요청',
      desiredDate: '2026-09-10',
    })
    for (const r of [mine, other, anon]) p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    expect(p.unreadNotificationCount('customer')).toBe(3) // 스코프 없음(역할 전체)
    expect(p.unreadNotificationCount('customer', 'AC-0001')).toBe(1)
    expect(p.notificationsFor('customer', 'AC-0001').map((n) => n.requestId)).toEqual([mine.id])
    p.markAllNotificationsRead('customer', 'AC-0001')
    expect(p.unreadNotificationCount('customer', 'AC-0002')).toBe(1)
    p.clearNotifications()
    expect(p.notificationsFor('partner')).toEqual([])
  })
})

describe('약관·개인정보처리방침 설정 (28-37-02)', () => {
  it('기본 초안 제공, 편집 저장, 빈 본문 거부, 저장소 왕복', () => {
    const data = new Map<string, string>()
    const storage: StorageLike = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    }
    const p = new PlatformService({ storage })
    expect(p.getSettings().terms).toContain('제1조')
    expect(p.getSettings().privacy).toContain('수집 항목')
    expect(() => p.updateSettings({ terms: '   ' })).toThrow('이용약관 본문')
    expect(() => p.updateSettings({ privacy: '' })).toThrow('개인정보처리방침 본문')
    p.updateSettings({ terms: '검토본 약관 v1', privacy: '검토본 방침 v1' })
    const again = PlatformService.load({ storage }).service
    expect(again.getSettings().terms).toBe('검토본 약관 v1')
    expect(again.getSettings().privacy).toBe('검토본 방침 v1')
  })
})

describe('정산 지급 (28-38-01)', () => {
  it('정산 확정 전·계좌 없음·중복 지급 거부, 지급 기록 + 파트너 알림, 대기/완료 집계, 왕복', () => {
    const data = new Map<string, string>()
    const storage: StorageLike = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    }
    const { p, r } = driveToInProgress(storage)
    p.completeJob(r.id, '2026-09-01')
    expect(() => p.markPayout(r.id, '국민은행 123****890 (김반듯)')).toThrow('정산 확정 후')
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    expect(p.pendingPayouts().map((j) => j.requestId)).toEqual([r.id])
    expect(() => p.markPayout(r.id, undefined)).toThrow('정산 계좌가 등록되지 않은')
    expect(() => p.markPayout(r.id, '  ')).toThrow('정산 계좌가 등록되지 않은')
    const job = p.jobFor(r.id)!
    expect(p.pendingPayoutAmount()).toBe(job.total - job.platformFee)
    const paid = p.markPayout(r.id, '국민은행 123****890 (김반듯)')
    expect(paid.payout?.amount).toBe(job.total - job.platformFee)
    expect(paid.payout?.account).toBe('국민은행 123****890 (김반듯)')
    expect(() => p.markPayout(r.id, '국민은행 123****890 (김반듯)')).toThrow('이미 지급된')
    expect(p.pendingPayouts()).toHaveLength(0)
    expect(p.paidPayouts().map((j) => j.requestId)).toEqual([r.id])
    expect(p.notificationsFor('partner').some((n) => n.text.includes('정산금 지급 완료'))).toBe(true)
    expect(() => p.markPayout('R-9999', 'x')).toThrow(PlatformError)
    const again = PlatformService.load({ storage }).service
    expect(again.jobFor(r.id)?.payout?.account).toBe('국민은행 123****890 (김반듯)')
    // 손상: 정산 확정 전 지급 기록 → 거부
    const snap = JSON.parse(again.exportData())
    snap.jobs[0].settled = false
    expect(() => again.importSnapshot(JSON.stringify(snap))).toThrow()
  })
})

describe('탈퇴 차단·비식별화 (28-39-01)', () => {
  it('진행 중 거래 수: 수락~시공 중·완료 미결제는 차단, 최종 결제·정산 후 0', () => {
    const { p, r } = driveToInProgress()
    // 시드 요청은 customerId가 없으므로 계정 스코프 집계에 포함되지 않는다
    expect(p.openTransactionCount('AC-0001')).toBe(0)
    const mine = p.addRequest({ ...newRequest(), customerId: 'AC-0001' })
    expect(p.openTransactionCount('AC-0001')).toBe(0) // requested 단계는 취소 가능 → 차단 아님
    expect(p.partnerHasOpenWork()).toBe(true) // 시공 중 작업 존재
    p.completeJob(r.id, '2026-09-01')
    expect(p.partnerHasOpenWork()).toBe(true) // 완료했지만 최종 결제 전
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    expect(p.partnerHasOpenWork()).toBe(true) // 정산 확정 → 지급 대기
    p.markPayout(r.id, '국민은행 123****890 (반듯설비)')
    expect(p.partnerHasOpenWork()).toBe(false)
    expect(p.anonymizeCustomer('AC-0001')).toBe(1)
    expect(p.store.get(mine.id)?.customerName).toBe('탈퇴 회원')
    expect(p.anonymizeCustomer('AC-0001')).toBe(0)
  })
})

describe('파트너 범위 분리 (28-41-01/02)', () => {
  it('두 파트너의 견적·작업·정산·리뷰·알림·프로필이 교차하지 않는다', () => {
    const p = new PlatformService()
    const a = p.addRequest(newRequest())
    const b = p.addRequest({ ...newRequest(), description: '주방 수전 교체' })
    p.submitEstimate(a.id, 'AC-0001', ESTIMATE_INPUT)
    p.submitEstimate(b.id, 'AC-0002', ESTIMATE_INPUT)
    expect(p.partnerOf(a.id)).toBe('AC-0001')
    expect(p.partnerRequests('AC-0002').map((r) => r.id)).toEqual([b.id])
    expect(p.statusCounts('AC-0001').estimated).toBe(1)
    expect(p.statusCounts().estimated).toBe(2)
    // A 낙찰·완료·정산, B 미낙찰
    p.transitionRequest(a.id, 'accepted')
    p.transitionRequest(b.id, 'lost')
    expect(p.bidStats('AC-0001')).toMatchObject({ won: 1, lost: 0, winRate: 100 })
    expect(p.bidStats('AC-0002')).toMatchObject({ won: 0, lost: 1, winRate: 0 })
    expect(p.bidStats()).toMatchObject({ won: 1, lost: 1, winRate: 50 })
    const slot = p.scheduleVisit(a.id, { date: '2026-09-06', startHour: 9, endHour: 12 })
    expect(slot.partnerId).toBe('AC-0001')
    expect(p.upcomingSlots('2026-09-01', 5, 'AC-0002')).toHaveLength(0)
    expect(p.upcomingSlots('2026-09-01', 5, 'AC-0001')).toHaveLength(1)
    p.transitionRequest(a.id, 'in_progress')
    p.completeJob(a.id, '2026-09-06')
    expect(p.completedJobsOf('AC-0001')).toHaveLength(1)
    expect(p.completedJobsOf('AC-0002')).toHaveLength(0)
    expect(p.unsettledPayout('AC-0002')).toBe(0)
    expect(p.unsettledPayout('AC-0001')).toBeGreaterThan(0)
    expect(p.settlements('all', 'AC-0002')).toHaveLength(0)
    expect(p.monthSummary('2026-09', 'AC-0002').jobCount).toBe(0)
    expect(p.monthSummary('2026-09', 'AC-0001').jobCount).toBe(1)
    expect(p.partnerHasOpenWork('AC-0002')).toBe(false)
    expect(p.partnerHasOpenWork('AC-0001')).toBe(true)
    // 리뷰는 요청의 견적 파트너에게 귀속
    p.payFinal(a.id, 'card')
    p.writeReview(a.id, { rating: 5, text: '좋아요' })
    expect(p.reviewStats('AC-0001').count).toBe(1)
    expect(p.reviewStats('AC-0002').count).toBe(0)
    expect(p.allReviews('AC-0002')).toHaveLength(0)
    // 알림: 파트너 계정 범위 — A의 낙찰 알림은 B에게 보이지 않는다
    expect(p.notificationsFor('partner', 'AC-0001').some((n) => n.text.includes('낙찰되었습니다'))).toBe(true)
    expect(p.notificationsFor('partner', 'AC-0002').some((n) => n.text.includes('낙찰되었습니다'))).toBe(false)
    expect(p.notificationsFor('partner', 'AC-0002').some((n) => n.text.includes('미낙찰'))).toBe(true)
    // 프로필: 파트너별
    p.updateProfile({ name: 'A설비', specialties: '', region: '', intro: '' }, 'AC-0001')
    expect(p.getProfile('AC-0002')).toBeUndefined()
    expect(p.partnerSummary('AC-0001').profile.name).toBe('A설비')
    expect(p.partnerSummary('AC-0002').completedCount).toBe(0)
  })

  it('구 스냅샷의 단일 profile은 시드 파트너(P-001)로 이전되고, profiles는 왕복된다', () => {
    const p = new PlatformService()
    p.updateProfile({ name: '반듯인테리어', specialties: '도배·도장·필름', region: '서울', intro: '' })
    p.updateProfile({ name: '둘째설비', specialties: '', region: '', intro: '' }, 'AC-0002')
    const snap = JSON.parse(p.exportData())
    expect(snap.profiles).toHaveLength(2)
    const legacy = { ...snap, profile: { name: '옛프로필', specialties: '', region: '', intro: '' } }
    delete legacy.profiles
    const restored = new PlatformService()
    restored.importSnapshot(JSON.stringify(legacy))
    expect(restored.getProfile('P-001')?.name).toBe('옛프로필')
    expect(restored.getProfile('AC-0002')).toBeUndefined()
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.getProfile('AC-0002')?.name).toBe('둘째설비')
    const bad = { ...snap, profiles: [['', { name: 'x', specialties: '', region: '', intro: '' }]] }
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })
})

describe('다중 입찰 (28-42-01)', () => {
  it('요청 1건에 파트너별 견적 1건씩, 금액순 조회, 재제출은 교체', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'AC-0001', ESTIMATE_INPUT)
    p.submitEstimate(r.id, 'AC-0002', { ...ESTIMATE_INPUT, discount: 50_000 })
    expect(p.bidCount(r.id)).toBe(2)
    expect(p.bidsFor(r.id).map((b) => b.estimate.partnerId)).toEqual(['AC-0002', 'AC-0001'])
    expect(p.getEstimate(r.id)).toBeUndefined() // 낙찰 전 다중 입찰 → 대표 견적 없음
    p.submitEstimate(r.id, 'AC-0001', { ...ESTIMATE_INPUT, discount: 100_000 })
    expect(p.bidCount(r.id)).toBe(2)
    expect(p.bidsFor(r.id)[0]!.estimate.partnerId).toBe('AC-0001')
    expect(p.bidOf(r.id, 'AC-0002')?.breakdown.total).toBeGreaterThan(p.bidOf(r.id, 'AC-0001')!.breakdown.total)
    expect(p.store.get(r.id)?.status).toBe('estimated')
  })

  it('acceptBid: 낙찰 파트너 기록, 낙찰/미낙찰 파트너별 알림, 이후 흐름은 낙찰 견적 기준', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'AC-0001', ESTIMATE_INPUT)
    p.submitEstimate(r.id, 'AC-0002', { ...ESTIMATE_INPUT, discount: 50_000 })
    expect(() => p.transitionRequest(r.id, 'accepted')).toThrow('acceptBid')
    expect(() => p.acceptBid(r.id, 'AC-0009')).toThrow('해당 파트너의 견적이 없습니다')
    p.acceptBid(r.id, 'AC-0002')
    expect(p.store.get(r.id)?.acceptedPartnerId).toBe('AC-0002')
    expect(p.partnerOf(r.id)).toBe('AC-0002')
    expect(p.getEstimate(r.id)?.estimate.partnerId).toBe('AC-0002')
    expect(p.statusFor(r.id, 'AC-0001')).toBe('lost')
    expect(p.statusFor(r.id, 'AC-0002')).toBe('accepted')
    expect(p.bidStats('AC-0001')).toMatchObject({ won: 0, lost: 1 })
    expect(p.bidStats('AC-0002')).toMatchObject({ won: 1, lost: 0 })
    expect(p.bidStats()).toMatchObject({ totalBids: 2, won: 1, lost: 1 })
    expect(p.statusCounts('AC-0001').lost).toBe(1)
    const n1 = p.notificationsFor('partner', 'AC-0001').map((n) => n.text)
    const n2 = p.notificationsFor('partner', 'AC-0002').map((n) => n.text)
    expect(n1.some((t) => t.includes('미낙찰'))).toBe(true)
    expect(n1.some((t) => t.includes('낙찰되었습니다'))).toBe(false)
    expect(n2.some((t) => t.includes('낙찰되었습니다'))).toBe(true)
    expect(() => p.acceptBid(r.id, 'AC-0001')).toThrow('estimated')
    const slot = p.scheduleVisit(r.id, { date: '2026-09-06', startHour: 9, endHour: 12 })
    expect(slot.partnerId).toBe('AC-0002')
    p.transitionRequest(r.id, 'in_progress')
    const job = p.completeJob(r.id, '2026-09-06')
    expect(job.partnerId).toBe('AC-0002')
    expect(job.total).toBe(p.bidOf(r.id, 'AC-0002')!.breakdown.total)
  })

  it('단일 입찰은 transitionRequest(accepted) 하위 호환, 전체 거절은 모든 입찰자에게 알림, 스냅샷 왕복', () => {
    const { p, r } = platformWithRequest()
    p.submitEstimate(r.id, 'AC-0001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    expect(p.store.get(r.id)?.acceptedPartnerId).toBe('AC-0001')
    const r2 = p.addRequest({ ...newRequest(), description: '두 번째' })
    p.submitEstimate(r2.id, 'AC-0001', ESTIMATE_INPUT)
    p.submitEstimate(r2.id, 'AC-0002', ESTIMATE_INPUT)
    p.transitionRequest(r2.id, 'lost')
    expect(p.notificationsFor('partner', 'AC-0002').some((n) => n.text.includes('미낙찰'))).toBe(true)
    const snap = p.exportData()
    expect(JSON.parse(snap).estimates.filter((e: [string, unknown]) => e[0] === r2.id)).toHaveLength(2)
    const again = new PlatformService()
    again.importSnapshot(snap)
    expect(again.bidCount(r2.id)).toBe(2)
    expect(again.partnerOf(r.id)).toBe('AC-0001')
    const bad = JSON.parse(snap)
    bad.store.requests[0].acceptedPartnerId = ''
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })
})

describe('입찰 마감 (28-43-01)', () => {
  const T = '2026-09-02'
  it('기본 마감일 = min(희망일−1, 오늘+3) ≥ 오늘, 과거 마감일은 거부', () => {
    expect(PlatformService.defaultBidDeadline('2026-09-10', T)).toBe('2026-09-05')
    expect(PlatformService.defaultBidDeadline('2026-09-04', T)).toBe('2026-09-03')
    expect(PlatformService.defaultBidDeadline('2026-09-02', T)).toBe('2026-09-02')
    expect(PlatformService.defaultBidDeadline('2026-08-20', T)).toBe('2026-09-02')
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), desiredDate: '2026-09-10' }, T)
    expect(r.bidDeadline).toBe('2026-09-05')
    expect(() => p.addRequest({ ...newRequest(), bidDeadline: '2026-09-01' }, T)).toThrow('오늘')
    expect(p.addRequest({ ...newRequest(), bidDeadline: '2026-09-02' }, T).bidDeadline).toBe('2026-09-02')
  })

  it('마감 당일은 입찰 가능, 다음날부터 거부; 마감 정리는 멱등이며 견적 수에 따라 다른 알림', () => {
    const p = new PlatformService()
    const empty = p.addRequest({ ...newRequest(), bidDeadline: '2026-09-03' }, T)
    const withBids = p.addRequest({ ...newRequest(), description: '견적 있음', bidDeadline: '2026-09-03' }, T)
    p.submitEstimate(withBids.id, 'AC-0001', ESTIMATE_INPUT, '2026-09-03')
    p.submitEstimate(withBids.id, 'AC-0002', ESTIMATE_INPUT, '2026-09-03')
    expect(p.bidClosed(withBids.id, '2026-09-03')).toBe(false)
    expect(p.bidClosed(withBids.id, '2026-09-04')).toBe(true)
    expect(() => p.submitEstimate(empty.id, 'AC-0001', ESTIMATE_INPUT, '2026-09-04')).toThrow('입찰이 마감')
    expect(p.sweepDeadlines('2026-09-03')).toBe(0)
    expect(p.sweepDeadlines('2026-09-04')).toBe(2)
    expect(p.sweepDeadlines('2026-09-05')).toBe(0) // 멱등
    const notes = p.notificationsFor('customer')
    expect(notes.some((n) => n.text.includes('견적이 들어오지 않았습니다') && n.requestId === empty.id)).toBe(true)
    expect(notes.some((n) => n.text.includes('견적 2건을 비교') && n.requestId === withBids.id)).toBe(true)
    expect(p.store.get(empty.id)?.deadlineNotifiedFor).toBe('2026-09-03')
  })

  it('마감 연장: 낙찰 전만, 오늘·현재 마감일 이후로만, 연장 후 입찰 재개 + 알림 플래그 초기화 + 왕복', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), bidDeadline: '2026-09-03' }, T)
    expect(() => p.extendDeadline(r.id, '2026-09-03', T)).toThrow('현재 마감일')
    p.sweepDeadlines('2026-09-04')
    expect(() => p.extendDeadline(r.id, '2026-09-01', '2026-09-04')).toThrow('오늘')
    const ext = p.extendDeadline(r.id, '2026-09-08', '2026-09-04')
    expect(ext.bidDeadline).toBe('2026-09-08')
    expect(ext.deadlineNotifiedFor).toBeUndefined()
    p.submitEstimate(r.id, 'AC-0001', ESTIMATE_INPUT, '2026-09-05')
    expect(p.sweepDeadlines('2026-09-09')).toBe(1) // 새 마감에 대해 다시 1회
    p.acceptBid(r.id, 'AC-0001')
    expect(() => p.extendDeadline(r.id, '2026-09-20', '2026-09-09')).toThrow('낙찰 전')
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.store.get(r.id)?.deadlineNotifiedFor).toBe('2026-09-08')
    const bad = JSON.parse(p.exportData())
    bad.store.requests[0].deadlineNotifiedFor = '2026-13-40'
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })
})

describe('운영 큐·결제 지연 (28-44-01)', () => {
  it('opsQueue: 마감 경과·방문일 경과·미결제 완료·미해결 클레임·지급 대기를 오래된 순으로 모은다', () => {
    const p = new PlatformService()
    const T = '2026-09-02'
    const overdue = p.addRequest({ ...newRequest(), bidDeadline: '2026-09-02' }, T)
    const fresh = p.addRequest({ ...newRequest(), description: '신규', bidDeadline: '2026-09-12' }, T) // 조회 시점(09-10)에도 미경과
    // 방문일 경과 미시작
    const stale = p.addRequest({ ...newRequest(), description: '방문 지연' }, T)
    p.submitEstimate(stale.id, 'AC-0001', ESTIMATE_INPUT, T)
    p.transitionRequest(stale.id, 'accepted')
    p.scheduleVisit(stale.id, { date: '2026-09-03', startHour: 9, endHour: 12 })
    // 완료 미결제
    const unpaid = p.addRequest({ ...newRequest(), description: '미결제' }, T)
    p.submitEstimate(unpaid.id, 'AC-0001', ESTIMATE_INPUT, T)
    p.transitionRequest(unpaid.id, 'accepted')
    p.scheduleVisit(unpaid.id, { date: '2026-09-04', startHour: 9, endHour: 12 })
    p.transitionRequest(unpaid.id, 'in_progress')
    p.completeJob(unpaid.id, '2026-09-04')
    p.fileClaim(unpaid.id, { detail: '마감 들뜸', createdDate: '2026-09-05' })
    const q = p.opsQueue('2026-09-10')
    expect(q.counts).toEqual({
      overdueRequests: 1,
      staleScheduled: 1,
      unpaidCompleted: 1,
      openClaims: 1,
      pendingPayouts: 0,
      pendingRefunds: 0,
      frequentCancellers: 0,
      unansweredClaims: expect.any(Number),
      reviewQueue: 0,
    })
    expect(q.overdueRequests[0]).toMatchObject({ bidCount: 0, daysOver: 8 })
    expect(q.overdueRequests[0]!.request.id).toBe(overdue.id)
    expect(q.staleScheduled[0]).toMatchObject({ visitDate: '2026-09-03', daysOver: 7 })
    expect(q.unpaidCompleted[0]).toMatchObject({ completedDate: '2026-09-04', daysSince: 6 })
    expect(p.opsQueue(T).counts.overdueRequests).toBe(0) // 마감 당일은 경과 아님
    expect(fresh.bidDeadline).toBe('2026-09-12')
    // 마감 경과 견적 0건 → 관리자에게도 알림
    p.sweepDeadlines('2026-09-03')
    expect(
      p.notificationsFor('admin').some((n) => n.text.includes('입찰 마감 경과') && n.requestId === overdue.id),
    ).toBe(true)
  })

  it('sweepPaymentReminders: 완료 3일 후부터 고객·관리자 1회, 결제되면 대상 아님', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-01')
    expect(p.sweepPaymentReminders('2026-09-03')).toBe(0)
    expect(p.sweepPaymentReminders('2026-09-04')).toBe(1)
    expect(p.sweepPaymentReminders('2026-09-05')).toBe(0)
    expect(p.notificationsFor('customer').some((n) => n.text.includes('3일째 미완료'))).toBe(true)
    expect(p.notificationsFor('admin').some((n) => n.text.includes('결제 지연 3일'))).toBe(true)
    expect(p.store.get(r.id)?.paymentReminderFor).toBe('2026-09-01')
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.sweepPaymentReminders('2026-09-09')).toBe(0)
    p.payFinal(r.id, 'card')
    expect(p.opsQueue('2026-09-09').counts.unpaidCompleted).toBe(0)
    const bad = JSON.parse(p.exportData())
    bad.store.requests[0].paymentReminderFor = 'x'
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })
})

describe('취소·환불 (28-45-01)', () => {
  it('예약금 결제 후 취소 → 환불 대기(전액), 관리자 완료 → 알림, 미결제 취소는 환불 없음', () => {
    const { p, r } = driveToAccepted()
    p.payDeposit(r.id, 'card')
    p.transitionRequest(r.id, 'cancelled')
    const rf = p.refundFor(r.id)!
    expect(rf).toMatchObject({ status: 'pending', afterVisit: false, deduction: 0 })
    expect(rf.amount).toBe(p.paymentsFor(r.id).find((x) => x.kind === 'deposit')!.amount)
    expect(p.paymentFor(r.id, 'deposit')).toBeUndefined() // 28-50-01: 환불 걸린 예약금은 유효 결제에서 제외
    expect(p.pendingRefunds()).toHaveLength(1)
    expect(p.opsQueue('2026-09-02').counts.pendingRefunds).toBe(1)
    expect(p.notificationsFor('admin').some((n) => n.text.includes('환불 대기'))).toBe(true)
    expect(() => p.settleRefund(rf.id, { deduction: 1000, reason: 'x' })).toThrow('전액 환불')
    expect(() => p.settleRefund(rf.id, { deduction: -1 })).toThrow('0 이상')
    const done = p.settleRefund(rf.id)
    expect(done.status).toBe('done')
    expect(done.doneAt).toBeDefined()
    expect(() => p.settleRefund(rf.id)).toThrow('이미 환불')
    expect(p.notificationsFor('customer').some((n) => n.text.includes('예약금 환불 완료'))).toBe(true)
    expect(p.pendingRefunds()).toHaveLength(0)
    // 미결제 취소
    const p2 = new PlatformService()
    const r2 = p2.addRequest(newRequest())
    p2.transitionRequest(r2.id, 'cancelled')
    expect(p2.refundFor(r2.id)).toBeUndefined()
  })

  it('방문일 경과 후 취소 → 차감 협의: 차감 ≤ 예약금·사유 필수, 파트너 알림, 탈퇴 차단, 스냅샷 왕복·검증', () => {
    const { p, r } = driveToAccepted()
    p.payDeposit(r.id, 'card')
    p.scheduleVisit(r.id, { date: '2026-01-05', startHour: 9, endHour: 12 }) // 과거 방문일
    p.transitionRequest(r.id, 'cancelled')
    const rf = p.refundFor(r.id)!
    expect(rf.afterVisit).toBe(true)
    expect(() => p.settleRefund(rf.id, { deduction: rf.amount + 1, reason: '출장비' })).toThrow('넘을 수 없습니다')
    expect(() => p.settleRefund(rf.id, { deduction: 5000 })).toThrow('사유')
    const req = p.store.get(r.id)!
    if (req.customerId) expect(p.openTransactionCount(req.customerId)).toBe(1)
    const done = p.settleRefund(rf.id, { deduction: 5000, reason: '출장비 실비' })
    expect(done.deduction).toBe(5000)
    expect(p.notificationsFor('partner', 'P-001').some((n) => n.text.includes('취소 실비'))).toBe(true)
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.refundFor(r.id)).toMatchObject({ status: 'done', deduction: 5000 })
    const bad = JSON.parse(p.exportData())
    bad.refunds[0].deduction = bad.refunds[0].amount + 1
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })
})

describe('지역·분야 매칭 (28-46-01)', () => {
  it('profileMatch: 분야 필수, 지역 토큰 포함 매칭, 지역 비면 통과; 알 수 없는 분야는 저장 거부', () => {
    const base = { name: 'A', intro: '' }
    expect(
      profileMatch(
        { ...base, specialties: '주방·욕실 공사, 바닥·타일', region: '서울, 고양' },
        { category: '주방·욕실 공사', region: '서울 관악구' },
      ),
    ).toBe(true)
    expect(
      profileMatch(
        { ...base, specialties: '주방·욕실 공사', region: '서울' },
        { category: '주방·욕실 공사', region: '부천 원미구' },
      ),
    ).toBe(false)
    expect(
      profileMatch(
        { ...base, specialties: '주방·욕실 공사', region: '' },
        { category: '주방·욕실 공사', region: '부천 원미구' },
      ),
    ).toBe(true)
    expect(
      profileMatch({ ...base, specialties: '', region: '서울' }, { category: '주방·욕실 공사', region: '서울 관악구' }),
    ).toBe(false)
    expect(
      profileMatch(
        { ...base, specialties: '전기·조명', region: '서울' },
        { category: '주방·욕실 공사', region: '서울 관악구' },
      ),
    ).toBe(false)
    expect(parseTokens(' 욕실 ,타일,, 욕실 ')).toEqual(['욕실', '타일'])
    const p = new PlatformService()
    expect(() => p.updateProfile({ ...base, specialties: '욕실, 페인트', region: '' }, 'AC-0001')).toThrow(
      '알 수 없는 전문 분야: 페인트',
    )
    p.updateProfile({ ...base, specialties: '', region: '' }, 'AC-0001') // 비움 허용
  })

  it('addRequest는 매칭 파트너에게만 새 일감 알림, matchedRequests는 낙찰 전·마감 전만', () => {
    const p = new PlatformService()
    p.updateProfile({ name: 'A설비', specialties: '주방·욕실 공사', region: '서울', intro: '' }, 'AC-0001')
    p.updateProfile({ name: 'B전기', specialties: '전기·조명', region: '', intro: '' }, 'AC-0002')
    const r = p.addRequest({ ...newRequest(), category: '주방·욕실 공사', region: '서울 관악구' }, '2026-09-02')
    expect(
      p.notificationsFor('partner', 'AC-0001').some((n) => n.text.includes('새 일감') && n.requestId === r.id),
    ).toBe(true)
    expect(p.notificationsFor('partner', 'AC-0002').some((n) => n.text.includes('새 일감'))).toBe(false)
    expect(p.matchedRequests('AC-0001', '2026-09-02').map((x) => x.id)).toEqual([r.id])
    expect(p.matchedRequests('AC-0002', '2026-09-02')).toHaveLength(0)
    expect(p.matchedRequests('AC-0009', '2026-09-02')).toHaveLength(0) // 프로필 없음
    p.submitEstimate(r.id, 'AC-0001', ESTIMATE_INPUT, '2026-09-02')
    expect(p.matchedRequests('AC-0001', '2026-09-02')).toHaveLength(1) // estimated도 대상
    p.transitionRequest(r.id, 'accepted')
    expect(p.matchedRequests('AC-0001', '2026-09-02')).toHaveLength(0)
  })
})

describe('원장 (28-47-01)', () => {
  it('결제·환불·수수료·지급이 부호와 날짜순으로 모이고 월 필터·요약이 맞는다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    p.payFinal(r.id, 'transfer')
    p.settle(r.id)
    p.markPayout(r.id, '국민은행 123****890 (김반듯)')
    // 취소·환불 건
    const { p: p2 } = driveToAccepted()
    const all = p.ledger()
    const types = all.map((x) => x.type)
    expect(types).not.toContain('예약금') // driveToInProgress는 예약금 없이 진행
    expect(types).toContain('최종결제')
    expect(types).toContain('플랫폼수수료')
    expect(types).toContain('파트너지급')
    const payout = all.find((x) => x.type === '파트너지급')!
    expect(payout.amount).toBeLessThan(0)
    expect(payout.ref).toBe('국민은행 123****890 (김반듯)')
    const fee = all.find((x) => x.type === '플랫폼수수료')!
    expect(fee.date).toBe('2026-09-06')
    expect(fee.counterparty).toBe('P-001')
    const sum = p.ledgerSummary()
    expect(sum.inflow).toBe(
      all.filter((x) => x.amount > 0 && x.type !== '플랫폼수수료').reduce((s, x) => s + x.amount, 0),
    )
    expect(sum.outflow).toBe(-payout.amount)
    expect(sum.fee).toBe(fee.amount)
    expect(sum.net).toBe(sum.inflow - sum.outflow)
    expect(p.ledgerMonths()).toContain('2026-09')
    expect(p.ledger('1999-01')).toHaveLength(0)
    expect(p.ledgerSummary('1999-01').rows).toBe(0)
    // 환불 행: 완료된 환불만, 음수
    const r2 = p2.store.list()[0]!
    p2.payDeposit(r2.id, 'card')
    p2.transitionRequest(r2.id, 'cancelled')
    expect(p2.ledger().some((x) => x.type === '환불')).toBe(false) // pending은 제외
    p2.settleRefund(p2.refundFor(r2.id)!.id)
    expect(p2.ledger().map((x) => x.type)).toContain('예약금')
    const refund = p2.ledger().find((x) => x.type === '환불')!
    expect(refund.amount).toBe(-p2.paymentsFor(r2.id).find((x) => x.kind === 'deposit')!.amount)
    // 파트너 정산 내역
    const mine = p.partnerLedger('P-001')
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ requestId: r.id, settled: true, payout: mine[0]!.total - mine[0]!.fee })
    expect(mine[0]!.paidAt).toMatch(/^\d{4}-/)
  })
})

describe('요청 사진 (28-48-01)', () => {
  const png = (id: string, bytes = 1000): RequestPhoto => ({
    id,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 640,
    height: 480,
    bytes,
  })
  it('장수·크기·형식 검증, 낙찰 전 추가·삭제, 스냅샷 왕복·손상 거부', () => {
    expect(() => validatePhotos([png('a'), png('b'), png('c'), png('d')])).toThrow('최대 3장')
    expect(() => validatePhotos([png('a', MAX_PHOTO_BYTES + 1)])).toThrow('200KB')
    expect(() => validatePhotos([{ ...png('a'), dataUrl: 'data:text/plain;base64,QQ==' }])).toThrow('JPEG/PNG')
    expect(() => validatePhotos([png('a'), png('a')])).toThrow('id')
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), photos: [png('a'), png('b')] })
    expect(r.photos).toHaveLength(2)
    const empty = p.addRequest({ ...newRequest(), photos: [] })
    expect(empty.photos).toBeUndefined()
    p.addPhoto(r.id, png('c'))
    expect(() => p.addPhoto(r.id, png('d'))).toThrow('최대 3장')
    expect(() => p.removePhoto(r.id, 'zzz')).toThrow('사진이 없습니다')
    p.removePhoto(r.id, 'b')
    expect(p.store.get(r.id)?.photos?.map((x) => x.id)).toEqual(['a', 'c'])
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    expect(() => p.addPhoto(r.id, png('e'))).toThrow('낙찰 전')
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.store.get(r.id)?.photos).toHaveLength(2)
    const bad = JSON.parse(p.exportData())
    bad.store.requests[0].photos[0].bytes = MAX_PHOTO_BYTES * 2
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })
})

describe('저장 용량·완료 사진·보관 정책 (28-49)', () => {
  const png = (id: string, bytes = 1000): RequestPhoto => ({
    id,
    dataUrl: `data:image/png;base64,${'A'.repeat(1332)}`,
    width: 640,
    height: 480,
    bytes,
  })

  it('save 실패는 기록·통지되고, 다음 성공 시 지워진다 (28-49-01)', () => {
    let failing = true
    const notes: string[] = []
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        if (failing) {
          const e = new Error('The quota has been exceeded.')
          e.name = 'QuotaExceededError'
          throw e
        }
      },
      removeItem: () => {},
    }
    const p = new PlatformService({ storage, onSaveError: (m) => notes.push(m) })
    p.addRequest(newRequest())
    expect(p.lastSaveError).toContain('저장 공간이 부족')
    expect(notes).toHaveLength(1)
    failing = false
    expect(p.save()).toBe(true)
    expect(p.lastSaveError).toBeNull()
    expect(new PlatformService().save()).toBe(true)
  })

  it('storageUsage와 용량 가드: 한도를 넘는 사진 쓰기는 변경 전에 거부 (28-49-01)', () => {
    const p = new PlatformService({ storageLimit: 5000 })
    expect(p.storageUsage().photoCount).toBe(0)
    expect(() => p.addRequest({ ...newRequest(), photos: [png('a'), png('b'), png('c')] })).toThrow('저장 공간이 부족')
    expect(p.store.list()).toHaveLength(0)
    const big = new PlatformService({ storageLimit: 100_000 })
    const r = big.addRequest({ ...newRequest(), photos: [png('a')] })
    const u = big.storageUsage()
    expect(u.photoCount).toBe(1)
    expect(u.photoChars).toBe(png('a').dataUrl.length)
    expect(u.limit).toBe(100_000)
    expect(u.ratio).toBeGreaterThan(0)
    expect(u.chars).toBeGreaterThan(u.photoChars)
    big.addPhoto(r.id, png('b'))
    expect(big.storageUsage().photoCount).toBe(2)
  })

  /**
   * 28-73-01: 한도는 브라우저 하나가 공유한다. 덮인 변경 보관함(28-72-03)이 같은 저장소의 다른 키를 쓰는데
   * 용량 회계에 없어서, 가드가 통과시킨 저장이 브라우저 할당량에서 실패했다 — 원인이 어디에도 보이지 않았다.
   */
  it('보관함 등 다른 키의 크기가 용량 카드와 가드에 잡힌다 (28-73-01)', () => {
    let external = 0
    const p = new PlatformService({ storageLimit: 100_000, externalChars: () => external })
    const before = p.storageUsage()
    expect(before.externalChars).toBe(0)
    expect(before.totalChars).toBe(before.chars)

    external = 60_000 // 보관함이 한도의 60%를 쓰고 있다
    const u = p.storageUsage()
    expect(u.externalChars).toBe(60_000) // 수정 전: 이 필드가 없었다
    expect(u.totalChars).toBe(u.chars + 60_000)
    expect(u.ratio).toBeCloseTo(u.totalChars / 100_000) // 수정 전: chars / limit — 실제보다 낮게 보고했다

    // 그리고 가드가 합계로 막는다 — 스냅샷만 보면 통과시켰을 쓰기다
    external = 99_000
    expect(() => p.addRequest({ ...newRequest(), photos: [png('a')] })).toThrow('저장 공간이 부족')
    expect(() => p.addRequest({ ...newRequest(), photos: [png('a')] })).toThrow('보관함')
    expect(p.store.list()).toHaveLength(0)

    // 보관함을 비우면 같은 쓰기가 통과한다
    external = 0
    expect(p.addRequest({ ...newRequest(), photos: [png('a')] }).id).toBeTruthy()
  })

  it('externalChars가 던져도 용량 계산은 계속된다 (앱 때문에 도메인이 멈추지 않는다)', () => {
    const p = new PlatformService({
      storageLimit: 100_000,
      externalChars: () => {
        throw new Error('저장소 접근 불가')
      },
    })
    const u = p.storageUsage()
    expect(u.externalChars).toBe(0)
    expect(u.totalChars).toBe(u.chars)
  })

  it('완료 사진: 낙찰 파트너만, 시공 중~최종 결제 전, 스냅샷 왕복·손상 거부 (28-49-03)', () => {
    const { p, r } = driveToInProgress()
    expect(() => p.setCompletionPhotos(r.id, 'P-999', [png('x')])).toThrow('낙찰 파트너')
    p.setCompletionPhotos(r.id, 'P-001', [png('x'), png('y')])
    expect(p.store.get(r.id)?.completionPhotos).toHaveLength(2)
    expect(p.storageUsage().photoCount).toBe(2)
    p.completeJob(r.id, '2026-09-06')
    p.setCompletionPhotos(r.id, 'P-001', [png('x')])
    p.payFinal(r.id, 'card')
    expect(() => p.setCompletionPhotos(r.id, 'P-001', [])).toThrow('최종 결제 후')
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.store.get(r.id)?.completionPhotos).toHaveLength(1)
    const bad = JSON.parse(p.exportData())
    bad.store.requests[0].completionPhotos[0].dataUrl = 'nope'
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
    const early = platformWithRequest()
    early.p.submitEstimate(early.r.id, 'P-001', ESTIMATE_INPUT)
    expect(() => early.p.setCompletionPhotos(early.r.id, 'P-001', [png('x')])).toThrow('시공 중')
  })

  it('prunePhotos: 정산 90일 경과 제거·30일 유지·취소 건은 생성일 기준·멱등 (28-49-02)', () => {
    expect(PHOTO_RETENTION_DAYS).toBe(90)
    const p = new PlatformService()
    const settle = (date: string) => {
      const r = p.addRequest({ ...newRequest(), photos: [png(`s${date}`)] })
      p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
      p.transitionRequest(r.id, 'accepted')
      p.scheduleVisit(r.id, { date, startHour: 9, endHour: 12 })
      p.transitionRequest(r.id, 'in_progress')
      p.setCompletionPhotos(r.id, 'P-001', [png(`c${date}`)])
      p.completeJob(r.id, date)
      p.payFinal(r.id, 'card')
      p.transitionRequest(r.id, 'settled')
      return r
    }
    const old = settle('2026-05-01')
    const recent = settle('2026-08-20')
    const cancelled = p.addRequest({ ...newRequest(), photos: [png('cc')] })
    p.transitionRequest(cancelled.id, 'cancelled')
    expect(p.storageUsage().photoCount).toBe(5)
    expect(p.prunePhotos('2026-09-02')).toBe(1)
    expect(p.store.get(old.id)?.photos).toBeUndefined()
    expect(p.store.get(old.id)?.completionPhotos).toBeUndefined()
    expect(p.store.get(recent.id)?.photos).toHaveLength(1)
    expect(p.store.get(cancelled.id)?.photos).toHaveLength(1)
    expect(p.prunePhotos('2026-09-02')).toBe(0)
    expect(p.prunePhotos(todayUTC(), 0)).toBe(2)
    expect(p.storageUsage().photoCount).toBe(0)
    expect(() => p.prunePhotos('2026-13-01')).toThrow()
  })
})

describe('파트너 낙찰 철회·재오픈 (28-50)', () => {
  it('권한·상태·사유 검증, 재오픈·마감 재설정·슬롯 해제·환불 대기·알림·재입찰·재결제·스냅샷 (28-50-01)', () => {
    const { p, r } = driveToAccepted()
    const dep1 = p.payDeposit(r.id, 'card')
    expect(() => p.withdrawAward(r.id, 'P-999', '사정', '2026-09-02')).toThrow('낙찰 파트너')
    expect(() => p.withdrawAward(r.id, 'P-001', '   ', '2026-09-02')).toThrow('사유')
    expect(() => p.withdrawAward(r.id, 'P-001', '사정', '2026-13-01')).toThrow()
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    const re = p.withdrawAward(r.id, 'P-001', '일정 충돌', '2026-09-02')
    expect(re.status).toBe('requested')
    expect(re.acceptedPartnerId).toBeUndefined()
    expect(re.bidDeadline).toBe(PlatformService.defaultBidDeadline('2026-09-05', '2026-09-02'))
    expect(re.deadlineNotifiedFor).toBeUndefined()
    expect(p.scheduleSlots).toHaveLength(0)
    expect(p.bidOf(r.id, 'P-001')).toBeUndefined()
    expect(p.bidCount(r.id)).toBe(0)
    expect(p.refundFor(r.id)).toMatchObject({
      status: 'pending',
      afterVisit: false,
      deduction: 0,
      amount: dep1.amount,
      paymentId: dep1.id,
    })
    expect(p.refundFor(r.id)?.reason).toContain('파트너 철회')
    expect(p.paymentFor(r.id, 'deposit')).toBeUndefined()
    expect(p.partnerCancels('P-001')).toHaveLength(1)
    expect(p.partnerCancels()[0]).toMatchObject({
      id: 'PC-0001',
      requestId: r.id,
      partnerId: 'P-001',
      reason: '일정 충돌',
      date: '2026-09-02',
    })
    expect(p.partnerCancelCount('P-001', 90, '2026-09-02')).toBe(1)
    expect(p.partnerCancelCount('P-001', 90, '2027-01-01')).toBe(0)
    expect(p.partnerSummary('P-001', '2026-09-02').cancelCount).toBe(1)
    const notes = JSON.parse(p.exportData()).notifications as Array<{ role: string; text: string }>
    expect(notes.some((n) => n.role === 'customer' && n.text.includes('철회') && n.text.includes('환불 대기'))).toBe(
      true,
    )
    expect(notes.some((n) => n.role === 'admin' && n.text.includes('일정 충돌'))).toBe(true)
    // 재입찰 → 재낙찰 → 예약금 재결제(환불된 예약금은 유효 결제에서 제외)
    // 28-69: 재오픈 마감이 '2026-09-02' 기준(→ 09-04)으로 계산됐으므로 입찰도 같은 날짜로 — 실제 시계에 기대면
    //   컨테이너 날짜가 09-05를 넘는 순간 "입찰이 마감되었습니다"로 깨진다(실제로 그렇게 깨졌다)
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT, '2026-09-02')
    expect(p.store.get(r.id)?.status).toBe('estimated')
    p.acceptBid(r.id, 'P-001')
    const dep2 = p.payDeposit(r.id, 'card')
    expect(dep2.id).not.toBe(dep1.id)
    expect(p.paymentFor(r.id, 'deposit')?.id).toBe(dep2.id)
    p.scheduleVisit(r.id, { date: '2026-09-06', startHour: 9, endHour: 12 })
    p.transitionRequest(r.id, 'in_progress')
    expect(() => p.withdrawAward(r.id, 'P-001', '늦음', '2026-09-02')).toThrow('낙찰·방문 예정')
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.partnerCancels('P-001')).toHaveLength(1)
    expect(again.refundFor(r.id)?.paymentId).toBe(dep1.id)
    const bad = JSON.parse(p.exportData())
    bad.partnerCancels[0].date = '2026-99-99'
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })

  it('다른 입찰이 남으면 estimated로 재오픈·미낙찰 해제·재오픈 알림, 운영 큐는 90일 내 2회 이상 (28-50-02)', () => {
    const p = new PlatformService()
    const r = p.addRequest(newRequest())
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.submitEstimate(r.id, 'P-002', { ...ESTIMATE_INPUT, laborCost: 100_000 })
    p.acceptBid(r.id, 'P-002')
    expect(p.statusFor(r.id, 'P-001')).toBe('lost')
    p.withdrawAward(r.id, 'P-002', '자재 수급 지연', '2026-09-02')
    expect(p.store.get(r.id)?.status).toBe('estimated')
    expect(p.statusFor(r.id, 'P-001')).toBe('estimated')
    expect(p.bidCount(r.id)).toBe(1)
    expect(p.refundFor(r.id)).toBeUndefined()
    const notes = JSON.parse(p.exportData()).notifications as Array<{ role: string; text: string; accountId?: string }>
    expect(notes.some((n) => n.role === 'partner' && n.accountId === 'P-001' && n.text.includes('재오픈'))).toBe(true)
    expect(p.opsQueue('2026-09-02').counts.frequentCancellers).toBe(0)
    const r2 = p.addRequest(newRequest())
    p.submitEstimate(r2.id, 'P-002', ESTIMATE_INPUT)
    p.acceptBid(r2.id, 'P-002')
    p.withdrawAward(r2.id, 'P-002', '사고', '2026-09-01')
    const q = p.opsQueue('2026-09-02')
    expect(q.frequentCancellers).toEqual([{ partnerId: 'P-002', count: 2, last: '2026-09-02' }])
    expect(q.counts.frequentCancellers).toBe(1)
    expect(p.opsQueue('2027-01-01').counts.frequentCancellers).toBe(0)
    expect(p.partnerSummary('P-002', '2026-09-02').cancelCount).toBe(2)
  })
})

describe('낙찰 전 수정 (28-52)', () => {
  it('요청 수정: 상태·검증·마감 재계산·기록·입찰자 알림·스냅샷 (28-52-01)', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), desiredDate: '2026-09-20' }, '2026-09-02')
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT, '2026-09-02')
    expect(() => p.updateRequest(r.id, { description: ' ' }, '2026-09-02')).toThrow('비울 수 없습니다')
    expect(() => p.updateRequest(r.id, { desiredDate: '2026-09-01' }, '2026-09-02')).toThrow('오늘')
    expect(() => p.updateRequest(r.id, { budget: -1 }, '2026-09-02')).toThrow('예산')
    expect(() => p.updateRequest(r.id, {}, '2026-09-02')).toThrow('수정할 내용')
    const u = p.updateRequest(
      r.id,
      { description: '욕실 천장 누수 + 곰팡이', region: '서울 강서구 화곡동', desiredTime: '오전' },
      '2026-09-02',
    )
    expect(u).toMatchObject({
      description: '욕실 천장 누수 + 곰팡이',
      region: '서울 강서구 화곡동',
      desiredTime: '오전',
      editCount: 1,
      bidDeadline: '2026-09-05',
    })
    expect(u.editedAt).toMatch(/^\d{4}-/)
    const u2 = p.updateRequest(
      r.id,
      {
        desiredDate: '2026-09-04',
        answers: [
          { question: '누수?', answer: ' 있음 ' },
          { question: '연식', answer: '' },
        ],
      },
      '2026-09-02',
    )
    expect(u2.bidDeadline).toBe(PlatformService.defaultBidDeadline('2026-09-04', '2026-09-02'))
    expect(u2.editCount).toBe(2)
    expect(u2.answers).toEqual([{ question: '누수?', answer: '있음' }])
    const notes = JSON.parse(p.exportData()).notifications as Array<{ role: string; accountId?: string; text: string }>
    expect(
      notes.filter((n) => n.role === 'partner' && n.accountId === 'P-001' && n.text.includes('수정되었습니다')),
    ).toHaveLength(2)
    p.acceptBid(r.id, 'P-001')
    expect(() => p.updateRequest(r.id, { description: 'x' }, '2026-09-02')).toThrow('낙찰 전')
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.store.get(r.id)?.editCount).toBe(2)
    const bad = JSON.parse(p.exportData())
    bad.store.requests[0].editCount = 0
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })

  it('견적 수정 n차·고객 알림, 입찰 철회 → 남은 입찰 없으면 requested, 마감 후·낙찰 후 거부, 신뢰 지표 미기록 (28-52-02)', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), desiredDate: '2026-09-20' }, '2026-09-02')
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT, '2026-09-02')
    expect(p.bidOf(r.id, 'P-001')?.revision).toBeUndefined()
    expect(p.bidOf(r.id, 'P-001')?.submittedAt).toMatch(/^\d{4}-/)
    p.submitEstimate(r.id, 'P-001', { ...ESTIMATE_INPUT, laborCost: 130_000 }, '2026-09-02')
    expect(p.bidOf(r.id, 'P-001')).toMatchObject({ revision: 1 })
    expect(p.bidOf(r.id, 'P-001')?.breakdown.total).toBe(253_000)
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT, '2026-09-02')
    expect(p.bidOf(r.id, 'P-001')?.revision).toBe(2)
    const notes = JSON.parse(p.exportData()).notifications as Array<{ role: string; text: string }>
    expect(
      notes.some((n) => n.role === 'customer' && n.text.includes('(2차)') && n.text.includes('이전 253,000원')),
    ).toBe(true)
    p.submitEstimate(r.id, 'P-002', ESTIMATE_INPUT, '2026-09-02')
    expect(() => p.withdrawBid(r.id, 'P-003', '2026-09-02')).toThrow('내 입찰이 없습니다')
    p.withdrawBid(r.id, 'P-002', '2026-09-02')
    expect(p.store.get(r.id)?.status).toBe('estimated')
    expect(p.bidCount(r.id)).toBe(1)
    expect(() => p.withdrawBid(r.id, 'P-001', '2026-09-10')).toThrow('마감')
    p.withdrawBid(r.id, 'P-001', '2026-09-02')
    expect(p.store.get(r.id)?.status).toBe('requested')
    expect(p.bidCount(r.id)).toBe(0)
    expect(p.partnerCancelCount('P-001', 90, '2026-09-02')).toBe(0)
    const n2 = JSON.parse(p.exportData()).notifications as Array<{ role: string; text: string }>
    expect(n2.some((n) => n.role === 'customer' && n.text.includes('철회') && n.text.includes('남은 견적 0건'))).toBe(
      true,
    )
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT, '2026-09-02')
    p.acceptBid(r.id, 'P-001')
    expect(() => p.withdrawBid(r.id, 'P-001', '2026-09-02')).toThrow('낙찰 전')
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.bidOf(r.id, 'P-001')?.submittedAt).toMatch(/^\d{4}-/)
  })
})

describe('파트너 응답 (28-53)', () => {
  it('분쟁 파트너 답변: 권한·미해결·빈 답변·덮어쓰기·알림, 무응답 운영 큐 2일 SLA (28-53-02)', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    const c = p.fileClaim(r.id, { detail: '들뜸', createdDate: '2026-09-08' })
    expect(() => p.replyClaim(c.id, 'P-999', '방문하겠습니다', '2026-09-08')).toThrow('낙찰 파트너')
    expect(() => p.replyClaim(c.id, 'P-001', '  ', '2026-09-08')).toThrow('답변')
    expect(p.opsQueue('2026-09-09').counts.unansweredClaims).toBe(0)
    const q = p.opsQueue('2026-09-10')
    expect(q.counts.unansweredClaims).toBe(1)
    expect(q.unansweredClaims[0]).toMatchObject({ claim: { id: c.id }, daysSince: 2 })
    const replied = p.replyClaim(c.id, 'P-001', '내일 오전 재방문하겠습니다', '2026-09-10')
    expect(replied).toMatchObject({
      partnerReply: '내일 오전 재방문하겠습니다',
      repliedDate: '2026-09-10',
      status: 'open',
    })
    expect(p.opsQueue('2026-09-12').counts.unansweredClaims).toBe(0)
    p.replyClaim(c.id, 'P-001', '오후로 변경', '2026-09-10')
    expect(p.claimsFor(r.id)[0]?.partnerReply).toBe('오후로 변경')
    const notes = JSON.parse(p.exportData()).notifications as Array<{ role: string; text: string }>
    expect(notes.filter((n) => n.role === 'customer' && n.text.includes('파트너 답변'))).toHaveLength(2)
    p.resolveClaim(c.id, '재시공 완료', '2026-09-11')
    expect(() => p.replyClaim(c.id, 'P-001', 'x', '2026-09-11')).toThrow('해결')
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.claimsFor(r.id)[0]?.repliedDate).toBe('2026-09-10')
  })

  it('리뷰 답글: 권한·빈 답글·수정·알림·스냅샷 (28-53-03)', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    expect(() => p.replyReview(r.id, 'P-001', '감사합니다', '2026-09-07')).toThrow('리뷰가 없습니다')
    p.writeReview(r.id, { rating: 3, text: '마감이 아쉬워요', createdDate: '2026-09-07' })
    expect(() => p.replyReview(r.id, 'P-999', '감사합니다', '2026-09-07')).toThrow('파트너만')
    expect(() => p.replyReview(r.id, 'P-001', ' ', '2026-09-07')).toThrow('답글')
    const rv = p.replyReview(r.id, 'P-001', '보수 방문 드리겠습니다', '2026-09-08')
    expect(rv).toMatchObject({ reply: '보수 방문 드리겠습니다', repliedDate: '2026-09-08' })
    p.replyReview(r.id, 'P-001', '보수 완료했습니다', '2026-09-09')
    expect(p.reviewFor(r.id)?.reply).toBe('보수 완료했습니다')
    expect(p.allReviews('P-001')[0]?.reply).toBe('보수 완료했습니다')
    const notes = JSON.parse(p.exportData()).notifications as Array<{ role: string; text: string }>
    expect(notes.filter((n) => n.role === 'customer' && n.text.includes('리뷰 답글'))).toHaveLength(2)
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.reviewFor(r.id)?.reply).toBe('보수 완료했습니다')
    const bad = JSON.parse(p.exportData())
    bad.reviews[0].repliedDate = 'nope'
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })
})

describe('데이터 위생 (28-54)', () => {
  it('알림 보관: 읽은 30일·안 읽은 90일 경과 제거, 상한 초과 시 오래된 읽은 것부터, 멱등 (28-54-01)', () => {
    const p = new PlatformService()
    const r = p.addRequest(newRequest())
    const now = Date.parse('2026-09-03T00:00:00Z')
    const mk = (i: number, daysAgo: number, read: boolean) => ({
      id: `NT-${String(i).padStart(4, '0')}`,
      role: 'customer',
      requestId: r.id,
      text: `n${i}`,
      createdAt: new Date(now - daysAgo * 86400000).toISOString(),
      read,
    })
    const snap = JSON.parse(p.exportData())
    snap.notifications = [mk(1, 31, true), mk(2, 29, true), mk(3, 91, false), mk(4, 89, false)]
    snap.notificationSeq = 4
    p.importSnapshot(JSON.stringify(snap))
    expect(p.pruneNotifications(now)).toBe(2)
    expect(
      p
        .notificationsFor('customer')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['NT-0002', 'NT-0004'])
    expect(p.pruneNotifications(now)).toBe(0)
    const many = JSON.parse(p.exportData())
    many.notifications = Array.from({ length: NOTIFICATION_CAP + 20 }, (_, i) => mk(i + 1, 1, i < 10))
    many.notificationSeq = NOTIFICATION_CAP + 20
    p.importSnapshot(JSON.stringify(many))
    expect(p.pruneNotifications(now)).toBe(20)
    const ids = p.notificationsFor('customer').map((n) => n.id)
    expect(ids).toHaveLength(NOTIFICATION_CAP)
    expect(ids).not.toContain('NT-0001')
    expect(ids).not.toContain('NT-0010')
    expect(ids).not.toContain('NT-0011')
    expect(ids).not.toContain('NT-0020')
    expect(ids).toContain('NT-0021')
    expect(ids).toContain(`NT-${String(NOTIFICATION_CAP + 20).padStart(4, '0')}`)
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.pruneNotifications(now)).toBe(0)
  })

  it('채팅 한도·보관: 500자·300건 거부, 정산 180일 경과 거래 채팅·읽음 제거, 멱등 (28-54-02)', () => {
    const { p, r } = driveToInProgress()
    expect(() => p.sendMessage(r.id, 'customer', 'x'.repeat(CHAT_MAX_TEXT + 1))).toThrow('500자')
    p.sendMessage(r.id, 'customer', 'x'.repeat(CHAT_MAX_TEXT))
    for (let i = 1; i < CHAT_MAX_PER_REQUEST; i += 1) p.sendMessage(r.id, i % 2 ? 'partner' : 'customer', `m${i}`)
    expect(p.chatFor(r.id)).toHaveLength(CHAT_MAX_PER_REQUEST)
    expect(() => p.sendMessage(r.id, 'customer', 'more')).toThrow('300건')
    p.markRead(r.id, 'partner')
    p.completeJob(r.id, '2026-03-01')
    p.payFinal(r.id, 'card')
    p.transitionRequest(r.id, 'settled')
    expect(p.pruneChats('2026-08-27')).toBe(0)
    expect(p.pruneChats('2026-08-28')).toBe(1)
    expect(p.chatFor(r.id)).toHaveLength(0)
    expect(p.unreadCount(r.id, 'customer')).toBe(0)
    expect(p.pruneChats('2026-08-28')).toBe(0)
    expect(p.storageUsage().chatCount).toBe(0)
    expect(() => p.pruneChats('2026-13-01')).toThrow()
  })

  it('저장 용량 내역: 사진·알림·채팅·기록·기타 합이 전체와 같다 (28-54-03, 28-58-04)', () => {
    const { p, r } = driveToInProgress()
    p.sendMessage(r.id, 'customer', '안녕하세요')
    const u = p.storageUsage()
    expect(u.chatCount).toBe(1)
    expect(u.chatChars).toBeGreaterThan(0)
    expect(u.notificationCount).toBeGreaterThan(0)
    expect(u.notificationChars).toBeGreaterThan(0)
    expect(u.otherChars).toBeGreaterThan(0)
    // 28-58-04: 감사 로그가 내역으로 분리돼 합에 포함된다
    expect(u.photoChars + u.notificationChars + u.chatChars + u.auditChars + u.otherChars).toBe(u.chars)
  })
})

describe('다중 탭 동기화 (28-55)', () => {
  const mem = (): StorageLike => {
    const m = new Map<string, string>()
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    }
  }

  it('리비전·동기화: A 저장 → B 동기화 true, 재호출 false, 리비전 단조 증가·별도 키 (28-55-01)', () => {
    const storage = mem()
    const a = PlatformService.load({ storage }).service
    const b = PlatformService.load({ storage }).service
    expect(b.syncFromStorage()).toBe(false)
    a.addRequest(newRequest())
    expect(a.revision).toBe(1)
    expect(b.store.size).toBe(0)
    expect(b.syncFromStorage()).toBe(true)
    expect(b.store.size).toBe(1)
    expect(b.revision).toBe(1)
    expect(b.lastSyncAt).toMatch(/^\d{4}-/)
    expect(b.syncFromStorage()).toBe(false)
    a.addRequest(newRequest())
    expect(a.revision).toBe(2)
    expect(JSON.parse(storage.getItem('banded-platform-v1')!).rev).toBe(2)
    expect(storage.getItem('banded-platform-v1:rev')).toBe('2')
    expect(b.syncFromStorage()).toBe(true)
    expect(b.store.size).toBe(2)
    const bad = JSON.parse(a.exportData())
    bad.rev = -1
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })

  it('충돌 감지: 같은 리비전에서 A 저장 후 B 저장 → 충돌 1·리비전 max+1·통지, A 동기화 true (28-55-02)', () => {
    const storage = mem()
    const a = PlatformService.load({ storage }).service
    a.addRequest(newRequest())
    const b = PlatformService.load({ storage }).service
    expect(b.revision).toBe(1)
    a.addRequest(newRequest())
    let notified = 0
    b.onConflict = () => {
      notified += 1
    }
    b.updateSettings({ notice: 'x' })
    expect(b.conflictCount).toBe(1)
    expect(notified).toBe(1)
    expect(b.revision).toBe(3)
    expect(a.conflictCount).toBe(0)
    expect(a.syncFromStorage()).toBe(true)
    expect(a.revision).toBe(3)
    // 마지막 쓰기 우선 — B가 몰랐던 A의 두 번째 요청은 유실된다(그래서 화면은 storage/focus 이벤트로 먼저 동기화한다)
    expect(a.store.size).toBe(1)
    a.updateSettings({ notice: 'y' })
    expect(a.conflictCount).toBe(0)
    expect(a.revision).toBe(4)
    expect(b.syncFromStorage()).toBe(true)
    expect(b.updateSettings({}).notice).toBe('y')
  })
})

describe('일정 변경·휴무·리마인더 (28-56)', () => {
  it('휴무일: 설정·중복 제거·정렬·검증, 예약 거부, 토글, 스냅샷 (28-56-02)', () => {
    const { p, r } = driveToAccepted()
    expect(p.setDaysOff('P-001', ['2026-09-06', '2026-09-05', '2026-09-06'])).toEqual(['2026-09-05', '2026-09-06'])
    expect(() => p.setDaysOff('P-001', ['2026-13-01'])).toThrow()
    expect(p.isDayOff('P-001', '2026-09-05')).toBe(true)
    expect(() => p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })).toThrow('휴무일')
    expect(p.store.get(r.id)?.status).toBe('accepted')
    expect(p.toggleDayOff('P-001', '2026-09-05')).toBe(false)
    expect(p.daysOffOf('P-001')).toEqual(['2026-09-06'])
    expect(p.toggleDayOff('P-002', '2026-09-06')).toBe(true)
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.daysOffOf('P-001')).toEqual(['2026-09-06'])
    const bad = JSON.parse(p.exportData())
    bad.daysOff = [['P-001', ['nope']]]
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow(PlatformError)
  })

  it('일정 변경: 상태·과거·충돌·동일·휴무 거부, 슬롯 교체·횟수·상대방 알림·자기 슬롯 제외 (28-56-01)', () => {
    const { p, r } = driveToAccepted()
    expect(() =>
      p.rescheduleVisit(r.id, { date: '2026-09-06', startHour: 9, endHour: 12 }, 'customer', '2026-09-02'),
    ).toThrow('방문 예정')
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    const r2 = p.addRequest(newRequest())
    p.submitEstimate(r2.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r2.id, 'accepted')
    p.scheduleVisit(r2.id, { date: '2026-09-06', startHour: 9, endHour: 12 })
    expect(() =>
      p.rescheduleVisit(r.id, { date: '2026-09-01', startHour: 9, endHour: 12 }, 'customer', '2026-09-02'),
    ).toThrow('지난 날짜')
    expect(() =>
      p.rescheduleVisit(r.id, { date: '2026-09-06', startHour: 10, endHour: 11 }, 'customer', '2026-09-02'),
    ).toThrow('일정 충돌')
    expect(() =>
      p.rescheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 }, 'customer', '2026-09-02'),
    ).toThrow('같은 일정')
    expect(() =>
      p.rescheduleVisit(r.id, { date: '2026-09-05', startHour: 12, endHour: 9 }, 'customer', '2026-09-02'),
    ).toThrow()
    p.setDaysOff('P-001', ['2026-09-07'])
    expect(() =>
      p.rescheduleVisit(r.id, { date: '2026-09-07', startHour: 9, endHour: 12 }, 'customer', '2026-09-02'),
    ).toThrow('휴무일')
    expect(p.store.get(r.id)?.rescheduleCount).toBeUndefined()
    const s = p.rescheduleVisit(r.id, { date: '2026-09-08', startHour: 14, endHour: 16 }, 'customer', '2026-09-02')
    expect(s).toMatchObject({ requestId: r.id, partnerId: 'P-001', date: '2026-09-08', startHour: 14, endHour: 16 })
    expect(p.scheduleSlots.filter((x) => x.requestId === r.id)).toHaveLength(1)
    expect(p.scheduleSlots).toHaveLength(2)
    expect(p.store.get(r.id)?.rescheduleCount).toBe(1)
    expect(p.store.get(r.id)?.rescheduledAt).toMatch(/^\d{4}-/)
    const notes = JSON.parse(p.exportData()).notifications as Array<{ role: string; accountId?: string; text: string }>
    expect(
      notes.some(
        (n) =>
          n.role === 'partner' &&
          n.accountId === 'P-001' &&
          n.text.includes('고객이 방문 일정을 변경') &&
          n.text.includes('2026-09-05 09:00~12:00 → 2026-09-08 14:00~16:00'),
      ),
    ).toBe(true)
    // 28-95: 파트너는 단독으로 바꾸지 못한다 — 제안하고 고객이 승인한다
    expect(() =>
      p.rescheduleVisit(r.id, { date: '2026-09-08', startHour: 9, endHour: 11 }, 'partner', '2026-09-02'),
    ).toThrow('제안해야')
    const sc = p.proposeSchedule(
      r.id,
      'P-001',
      { date: '2026-09-08', startHour: 9, endHour: 11, reason: '앞 현장 지연' },
      '2026-09-02',
    )
    p.decideSchedule(r.id, sc.id, true, '2026-09-02')
    expect(p.store.get(r.id)?.rescheduleCount).toBe(2)
    const n2 = JSON.parse(p.exportData()).notifications as Array<{ role: string; text: string }>
    expect(n2.some((n) => n.role === 'customer' && n.text.includes('파트너가 방문 일정을 변경'))).toBe(true)
    const sc2 = p.proposeSchedule(
      r.id,
      'P-001',
      { date: '2026-09-08', startHour: 10, endHour: 12, reason: '자재 수급' },
      '2026-09-02',
    )
    p.decideSchedule(r.id, sc2.id, true, '2026-09-02')
    p.transitionRequest(r.id, 'in_progress')
    expect(() =>
      p.proposeSchedule(r.id, 'P-001', { date: '2026-09-09', startHour: 9, endHour: 12, reason: '지연' }, '2026-09-02'),
    ).toThrow('방문 예정')
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.store.get(r.id)?.rescheduleCount).toBe(3)
  })

  it('방문 전날 리마인더: D-1 슬롯에 고객·파트너 1회, 멱등, 변경 후 재알림, 스냅샷 (28-56-03)', () => {
    const { p, r } = driveToAccepted()
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    expect(p.sweepVisitReminders('2026-09-03')).toBe(0)
    expect(p.sweepVisitReminders('2026-09-04')).toBe(1)
    expect(p.sweepVisitReminders('2026-09-04')).toBe(0)
    const notes = JSON.parse(p.exportData()).notifications as Array<{ role: string; accountId?: string; text: string }>
    const reminders = notes.filter((n) => n.text.includes('내일 방문 예정'))
    expect(reminders).toHaveLength(2)
    expect(reminders.find((n) => n.role === 'partner')?.accountId).toBe('P-001')
    const sc = p.proposeSchedule(
      r.id,
      'P-001',
      { date: '2026-09-06', startHour: 9, endHour: 12, reason: '지연' },
      '2026-09-04',
    )
    p.decideSchedule(r.id, sc.id, true, '2026-09-04')
    expect(p.sweepVisitReminders('2026-09-05')).toBe(1)
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.sweepVisitReminders('2026-09-05')).toBe(0)
    expect(() => p.sweepVisitReminders('2026-13-01')).toThrow()
  })
})

describe('운영 감사 로그 (28-57-01)', () => {
  it('관리자 행위 순서대로 기록(최신순 조회), 상세 문자열, 수동 audit, 스냅샷 왕복·잘못된 actor 거부', () => {
    const p = new PlatformService()
    expect(p.auditLog()).toEqual([])
    const pkg = p.addPackage({ name: '실리콘 패키지', category: '주방·욕실 공사', price: 50000 })
    p.updatePackage(pkg.id, { price: 60000 })
    p.updateSettings({ notice: '추석 연휴 휴무' })
    const q = p.addQuestion({ category: '주방·욕실 공사', label: '곰팡이 여부' })
    p.removeQuestion(q.id)
    p.removePackage(pkg.id)
    const log = p.auditLog()
    expect(log.map((e) => e.action)).toEqual([
      '패키지 삭제',
      '질문 삭제',
      '질문 등록',
      '설정 변경',
      '패키지 수정',
      '패키지 등록',
    ])
    expect(log.every((e) => e.actor === 'admin')).toBe(true)
    expect(log[5]).toMatchObject({ id: 'AUD-00001', target: pkg.id, detail: '실리콘 패키지' })
    expect(log[3]).toMatchObject({ target: 'settings', detail: 'notice' })
    expect(log[2]).toMatchObject({ target: q.id, detail: '곰팡이 여부' })
    expect(log[1]).toMatchObject({ action: '질문 삭제', target: q.id, detail: '곰팡이 여부' })
    expect(p.auditLog(2)).toHaveLength(2)
    expect(p.auditLog(2)[0]!.action).toBe('패키지 삭제')
    const manual = p.audit('admin', '파트너 승인', 'P-0001', '반듯설비')
    expect(manual).toMatchObject({
      id: 'AUD-00007',
      actor: 'admin',
      action: '파트너 승인',
      target: 'P-0001',
      detail: '반듯설비',
    })
    expect(p.audit('admin', '기록 파기', 'C-0001').detail).toBeUndefined()
    expect(() => p.audit('admin', ' ', 'x')).toThrow(PlatformError)
    // 왕복
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.auditLog()).toEqual(p.auditLog())
    again.audit('admin', '계정 정지', 'C-0002')
    expect(again.auditLog()[0]!.id).toBe('AUD-00009')
    const bad = JSON.parse(p.exportData())
    bad.auditLog[0].actor = 'hacker'
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow('actor')
    const bad2 = JSON.parse(p.exportData())
    bad2.auditLog = 'x'
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad2))).toThrow('auditLog')
  })

  it('지급·환불·클레임 기록, 시스템 정리 기록(n>0일 때만), 보관 180일·상한 1000 (pruneAuditLog 멱등)', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-01')
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    p.markPayout(r.id, '국민은행 123****890 (김반듯)')
    const paid = p.auditLog()[0]!
    expect(paid).toMatchObject({ actor: 'admin', action: '지급 완료', target: r.id })
    expect(paid.detail).toContain('국민은행')
    const c = p.fileClaim(r.id, { detail: '누수 재발' })
    p.reviewClaim(c.id)
    p.resolveClaim(c.id, '재방문 조치')
    expect(
      p
        .auditLog()
        .slice(0, 2)
        .map((e) => [e.action, e.target, e.detail]),
    ).toEqual([
      ['해결 처리', c.id, '재방문 조치'],
      ['검토 시작', c.id, r.id],
    ])
    // 환불
    const { p: p2, r: r2 } = driveToAccepted()
    p2.payDeposit(r2.id, 'card')
    p2.transitionRequest(r2.id, 'cancelled')
    const rf = p2.refundFor(r2.id)!
    p2.settleRefund(rf.id)
    expect(p2.auditLog()[0]).toMatchObject({ actor: 'admin', action: '환불 완료', target: rf.id })
    expect(p2.auditLog()[0]!.detail).toContain(r2.id)
    // 시스템 정리: 제거 0건이면 기록 없음, n>0이면 system 기록
    const before = p2.auditLog().length
    expect(p2.pruneNotifications()).toBe(0)
    expect(p2.auditLog().length).toBe(before)
    // 사진 정리 n>0 → system 기록
    const p3 = new PlatformService()
    const r3 = p3.addRequest({
      ...newRequest(),
      photos: [{ id: 'audit', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 640, height: 480, bytes: 1000 }],
    })
    p3.submitEstimate(r3.id, 'P-001', ESTIMATE_INPUT)
    p3.transitionRequest(r3.id, 'accepted')
    p3.scheduleVisit(r3.id, { date: '2026-01-05', startHour: 9, endHour: 12 })
    p3.transitionRequest(r3.id, 'in_progress')
    p3.completeJob(r3.id, '2026-01-05')
    p3.payFinal(r3.id, 'card')
    p3.transitionRequest(r3.id, 'settled')
    expect(p3.prunePhotos('2026-09-01')).toBe(1)
    expect(p3.auditLog()[0]).toMatchObject({ actor: 'system', action: '사진 정리', target: '1' })
    // 보관 정책: 1005건 중 1건은 200일 전 → 기간 초과 1건 제거 후 상한으로 4건 더 → 1000건
    const p4 = new PlatformService()
    for (let i = 0; i < AUDIT_CAP + 5; i += 1) p4.audit('admin', '테스트', `T-${i}`)
    expect(p4.auditLog()).toHaveLength(AUDIT_CAP + 5)
    const snap = JSON.parse(p4.exportData())
    snap.auditLog[0].at = new Date(Date.now() - (AUDIT_RETENTION_DAYS + 20) * 86400000).toISOString()
    const p5 = new PlatformService()
    p5.importSnapshot(JSON.stringify(snap))
    expect(p5.pruneAuditLog()).toBe(5)
    expect(p5.auditLog()).toHaveLength(AUDIT_CAP)
    expect(p5.auditLog().some((e) => e.target === 'T-0')).toBe(false)
    expect(p5.auditLog(1)[0]!.target).toBe(`T-${AUDIT_CAP + 4}`)
    expect(p5.pruneAuditLog()).toBe(0)
  })
})

describe('백업 복원·감사 무결성 (28-58-02)', () => {
  it('복원은 스냅샷을 적용하되 운영 기록을 보존하고 복원 사실을 남긴다 — importSnapshot 의미는 그대로', () => {
    const a = new PlatformService()
    a.addPackage({ name: 'A 패키지', category: '주방·욕실 공사', price: 50000 })
    const backup = a.exportData()

    const b = new PlatformService()
    b.audit('admin', '파트너 승인', 'AC-0002', '반듯설비')
    b.audit('admin', '계정 정지', 'AC-0001')
    expect(b.auditLog()).toHaveLength(2)
    expect(b.listPackages().some((p) => p.name === 'A 패키지')).toBe(false)

    const res = b.restoreBackup(backup)
    expect(res).toEqual({ kept: 2, ignored: 1 })
    // 스냅샷은 반영됐다
    expect(b.listPackages().some((p) => p.name === 'A 패키지')).toBe(true)
    // 운영 기록은 보존 + 맨 위에 '백업 복원'
    const log = b.auditLog()
    expect(log).toHaveLength(3)
    expect(log[0]).toMatchObject({ actor: 'admin', action: '백업 복원' })
    expect(log[0]!.detail).toBe('보존 2건 · 가져온 기록 1건 무시')
    expect(log.slice(1).map((e) => e.action)).toEqual(['계정 정지', '파트너 승인'])
    // 가져온 로그(A 패키지 등록)는 반영되지 않는다
    expect(log.some((e) => e.action === '패키지 등록')).toBe(false)
    // 다음 기록의 id가 보존된 로그와 충돌하지 않는다
    b.audit('admin', '기록 파기', 'AC-0003')
    expect(new Set(b.auditLog().map((e) => e.id)).size).toBe(4)

    // importSnapshot 자체(동기화·기동 경로)는 종전대로 스냅샷의 로그를 그대로 쓴다
    const c = new PlatformService()
    c.audit('admin', '계정 정지', 'AC-0009')
    c.importSnapshot(backup)
    expect(c.auditLog().map((e) => e.action)).toEqual(['패키지 등록'])
    expect(() => b.restoreBackup('{')).toThrow(PlatformError)
  })

  it('storageUsage가 감사 로그를 분리해 보여준다 (합 = 전체)', () => {
    const p = new PlatformService()
    const base = p.storageUsage()
    expect(base.auditCount).toBe(0)
    for (let i = 0; i < 20; i += 1) p.audit('admin', '설정 변경', `settings-${i}`, '문구 저장')
    const u = p.storageUsage()
    expect(u.auditCount).toBe(20)
    expect(u.auditChars).toBeGreaterThan(base.auditChars)
    expect(u.photoChars + u.notificationChars + u.chatChars + u.auditChars + u.otherChars).toBe(u.chars)
  })
})

describe('감사 로그 신뢰성 (28-59-02)', () => {
  it('창 안의 같은 행위·대상 반복은 한 줄로 접고 횟수·첫 시각을 남긴다', () => {
    const p = new PlatformService()
    // 28-64-04: '로그인 실패'의 detail은 진행 표시라 계속 접힌다(마지막 값만 남겨도 잃는 것이 없다).
    for (let i = 0; i < 4; i += 1) p.audit('system', '로그인 실패', '고객 010****0001', `남은 시도 ${4 - i}회`)
    const log = p.auditLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      actor: 'system',
      action: '로그인 실패',
      target: '고객 010****0001',
      count: 4,
      detail: '남은 시도 1회',
    })
    expect(log[0]!.firstAt).toBeDefined()
    expect(Date.parse(log[0]!.firstAt!)).toBeLessThanOrEqual(Date.parse(log[0]!.at))
    // 대상이 다르면 접히지 않는다
    p.audit('system', '로그인 실패', '고객 010****0002')
    expect(p.auditLog()).toHaveLength(2)
    expect(p.auditLog()[0]!.count).toBeUndefined()
    // 다른 행위가 끼면 새 줄
    p.audit('system', '로그인 잠금', '고객 010****0002')
    p.audit('system', '로그인 실패', '고객 010****0002')
    expect(p.auditLog().map((e) => e.action)).toEqual(['로그인 실패', '로그인 잠금', '로그인 실패', '로그인 실패'])
    // 창(5분)을 넘기면 새 줄 — 스냅샷의 마지막 기록 시각을 과거로 밀어 확인
    const snap = JSON.parse(p.exportData())
    const last = snap.auditLog[snap.auditLog.length - 1]
    last.at = new Date(Date.now() - AUDIT_COLLAPSE_MS - 1000).toISOString()
    const q = new PlatformService()
    q.importSnapshot(JSON.stringify(snap))
    q.audit('system', last.action, last.target)
    expect(q.auditLog()[0]!.count).toBeUndefined()
    expect(q.auditLog()).toHaveLength(snap.auditLog.length + 1)
    // count는 2 이상만 유효
    const bad = JSON.parse(p.exportData())
    bad.auditLog[0].count = 1
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow('count')
  })

  it('상한 초과 시 시스템 기록을 먼저 버려 관리자 행위 기록을 지킨다 (로그인 폭주가 로그를 밀어내지 못한다)', () => {
    const p = new PlatformService()
    // 관리자 행위 10건
    for (let i = 0; i < 10; i += 1) p.audit('admin', '설정 변경', `settings-${i}`)
    // 무차별 로그인 실패 — 대상을 매번 바꿔 접기를 피한다(공격자의 최선)
    for (let i = 0; i < AUDIT_CAP + 100; i += 1)
      p.audit('system', '로그인 실패', `고객 010****${String(i).padStart(4, '0')}`)
    expect(p.auditLog().length).toBe(AUDIT_CAP + 110)
    const removed = p.pruneAuditLog()
    expect(removed).toBe(110)
    const log = p.auditLog()
    expect(log).toHaveLength(AUDIT_CAP)
    // 관리자 기록 10건은 전부 살아 있다
    const admins = log.filter((e) => e.actor === 'admin')
    expect(admins).toHaveLength(10)
    expect(admins.map((e) => e.target).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `settings-${i}`).sort())
    // 버려진 것은 가장 오래된 시스템 기록이다
    expect(log.some((e) => e.target === '고객 010****0000')).toBe(false)
    expect(log.some((e) => e.target === `고객 010****${String(AUDIT_CAP + 99).padStart(4, '0')}`)).toBe(true)
    expect(p.pruneAuditLog()).toBe(0)
  })
})

describe('반출 기록·복원 되돌리기 (28-59-01/03)', () => {
  it('exportBackup은 반출을 기록하고 JSON을 돌려준다', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest() })
    const { json, chars } = p.exportBackup()
    expect(chars).toBe(json.length)
    expect(JSON.parse(json).store.requests.some((x: { id: string }) => x.id === r.id)).toBe(true)
    const log = p.auditLog()
    expect(log[0]).toMatchObject({ actor: 'admin', action: '백업 내보내기' })
    expect(log[0]!.detail).toContain('요청 1건')
    expect(log[0]!.target).toMatch(/^rev \d+$/)
    // 돌려준 JSON은 기록 직전 스냅샷 — 내보내기 기록 자체는 담기지 않는다
    expect((JSON.parse(json).auditLog ?? []).some((e: { action: string }) => e.action === '백업 내보내기')).toBe(false)
  })

  it('복원 후 직전 상태로 되돌릴 수 있고, 되돌리기도 기록된다 (한 번만)', () => {
    const a = new PlatformService()
    a.addPackage({ name: '복원본 패키지', category: '주방·욕실 공사', price: 50000 })
    const backup = a.exportData()

    const b = new PlatformService()
    const own = b.addPackage({ name: '원래 패키지', category: '전기·조명', price: 30000 })
    b.audit('admin', '계정 정지', 'AC-0001')
    expect(b.canUndoRestore).toBe(false)
    expect(() => b.undoRestore()).toThrow('되돌릴 복원이 없습니다')

    b.restoreBackup(backup)
    expect(b.canUndoRestore).toBe(true)
    expect(b.listPackages().some((x) => x.name === '복원본 패키지')).toBe(true)
    // 두 서비스가 같은 기본 시드에서 출발해 id(PK-000n)가 겹치므로 이름으로 확인한다
    expect(b.listPackages().some((x) => x.name === '원래 패키지')).toBe(false)

    const res = b.undoRestore()
    expect(res).toEqual({ kept: 3 })
    // 직전 상태 복귀
    expect(b.listPackages().some((x) => x.name === '원래 패키지')).toBe(true)
    expect(b.listPackages().find((x) => x.name === '원래 패키지')?.id).toBe(own.id)
    expect(b.listPackages().some((x) => x.name === '복원본 패키지')).toBe(false)
    // 운영 기록은 보존 + 되돌리기 기록
    const log = b.auditLog()
    expect(log[0]).toMatchObject({ actor: 'admin', action: '복원 되돌리기' })
    expect(log[0]!.detail).toContain('운영 기록 3건 보존')
    expect(log.map((e) => e.action)).toEqual(['복원 되돌리기', '백업 복원', '계정 정지', '패키지 등록'])
    // 연쇄 되돌리기는 없다
    expect(b.canUndoRestore).toBe(false)
    expect(() => b.undoRestore()).toThrow(PlatformError)
  })
})

describe('가명 처리 백업 (28-60-01)', () => {
  it('가명본에는 이름·요청 내용·채팅·사진이 남지 않고, 운영 지표는 그대로다', () => {
    const p = new PlatformService()
    const r = p.addRequest({
      ...newRequest(),
      customerId: 'AC-0001',
      customerName: '김반듯',
      region: '서울 관악구 신림동 123',
      description: '욕실 실리콘이 곰팡이로 새까맣습니다',
      photos: [{ id: 'ph1', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 640, height: 480, bytes: 1000 }],
    })
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    p.sendMessage(r.id, 'customer', '문 앞 비밀번호는 1234입니다')

    const { json } = p.exportBackup('pseudonymous')
    expect(json).not.toContain('김반듯')
    expect(json).not.toContain('새까맣습니다') // '곰팡이'는 기본 질문 시드에도 있는 단어라 요청 본문 고유 문구로 확인한다
    expect(json).not.toContain('비밀번호는 1234')
    expect(json).not.toContain('iVBORw0KGgo=')
    expect(json).not.toContain('신림동')
    expect(JSON.parse(json).notifications.every((n: { text: string }) => n.text === '[가명 처리]')).toBe(true)
    const snap = JSON.parse(json)
    expect(snap.pseudonymous).toBe(true)
    const one = snap.store.requests[0]
    expect(one.customerName).toBe('고객 A')
    expect(one.region).toBe('서울 관악구')
    expect(one.description).toContain('[가명 처리]')
    expect(one.photos).toBeUndefined()
    expect(one.photoCount).toBe(1)
    // 운영 지표는 보존 — 상태·일정·금액
    expect(one.status).toBe('accepted')
    expect(one.desiredDate).toBe(r.desiredDate)
    expect(snap.estimates.length).toBeGreaterThan(0) // 견적은 스냅샷에서 estimates로 직렬화된다
    expect(snap.chats).toEqual([])
    // 같은 고객은 같은 가명, 다른 고객은 다른 가명
    const r2 = p.addRequest({ ...newRequest(), customerId: 'AC-0001', customerName: '김반듯' })
    const r3 = p.addRequest({ ...newRequest(), customerId: 'AC-0002', customerName: '이웃집' })
    const snap2 = JSON.parse(p.exportBackup('pseudonymous').json)
    const byId = (id: string) => snap2.store.requests.find((x: { id: string }) => x.id === id).customerName
    expect(byId(r2.id)).toBe(byId(r.id))
    expect(byId(r3.id)).not.toBe(byId(r.id))
    // 원본 모드는 그대로
    expect(p.exportBackup('full').json).toContain('김반듯')
    // 모드가 기록에 남는다
    const log = p.auditLog()
    expect(log[0]!.detail).toContain('원본')
    expect(log[1]!.detail).toContain('가명본')
  })
})

describe('감사 기록 행위자 (28-60-02)', () => {
  it('관리자 행위에 actorId가 붙고, 시스템 기록에는 붙지 않으며, 행위자가 다르면 접히지 않는다', () => {
    const p = new PlatformService()
    p.actorId = 'AC-ADMIN1'
    p.audit('admin', '계정 정지', 'AC-0001')
    expect(p.auditLog()[0]).toMatchObject({ actor: 'admin', by: 'AC-ADMIN1' })
    // 같은 행위자·행위·대상은 접힌다
    p.audit('admin', '계정 정지', 'AC-0001')
    expect(p.auditLog()).toHaveLength(1)
    expect(p.auditLog()[0]!.count).toBe(2)
    // 행위자가 바뀌면 새 줄
    p.actorId = 'AC-ADMIN2'
    p.audit('admin', '계정 정지', 'AC-0001')
    expect(p.auditLog()).toHaveLength(2)
    expect(p.auditLog()[0]).toMatchObject({ by: 'AC-ADMIN2' })
    expect(p.auditLog()[0]!.count).toBeUndefined()
    // 시스템 기록에는 행위자가 없다
    p.audit('system', '로그인 잠금', '고객 010****0001')
    expect(p.auditLog()[0]!.by).toBeUndefined()
    // actorId가 없으면 by 없이 기록
    p.actorId = undefined
    p.audit('admin', '설정 변경', 'settings')
    expect(p.auditLog()[0]!.by).toBeUndefined()
    // 왕복 + 잘못된 by 거부
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.auditLog()).toEqual(p.auditLog())
    const bad = JSON.parse(p.exportData())
    bad.auditLog[0].by = ''
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow('by')
  })
})

describe('데이터 주체 열람권 (28-60-03)', () => {
  const within = (rows: Array<Record<string, unknown>>, allowed: readonly string[]) =>
    rows.flatMap((row) => Object.keys(row)).filter((k) => !allowed.includes(k))

  it('본인 요청 범위만 담고 다른 고객 데이터는 섞이지 않는다', () => {
    const p = new PlatformService()
    const mine = p.addRequest({
      ...newRequest(),
      customerId: 'AC-0001',
      customerName: '김반듯',
      description: '내 요청',
    })
    const other = p.addRequest({
      ...newRequest(),
      customerId: 'AC-0002',
      customerName: '이웃집',
      description: '남의 요청',
    })
    p.submitEstimate(mine.id, 'P-001', ESTIMATE_INPUT)
    p.submitEstimate(other.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(mine.id, 'accepted')
    p.transitionRequest(other.id, 'accepted')
    p.sendMessage(mine.id, 'customer', '내 대화')
    p.sendMessage(other.id, 'customer', '남의 대화')
    p.payDeposit(mine.id, 'card')
    p.payDeposit(other.id, 'card')

    const { json, requests } = p.exportCustomerData('AC-0001')
    expect(requests).toBe(1)
    expect(json).toContain('내 요청')
    expect(json).not.toContain('남의 요청')
    expect(json).not.toContain('남의 대화')
    expect(json).not.toContain(other.id)
    const data = JSON.parse(json)
    expect(data.customerId).toBe('AC-0001')
    expect(data.requests).toHaveLength(1)
    expect(data.payments).toHaveLength(1)
    expect(data.chats.every((m: { requestId: string }) => m.requestId === mine.id)).toBe(true)
    // 요약 행도 본인 것만
    const rows = p.customerDataRows('AC-0001')
    expect(rows).toHaveLength(1)
    expect(rows[0]![0]).toBe(mine.id)
    expect(p.customerDataRows('AC-0002')).toHaveLength(1)
    expect(p.customerDataRows('AC-9999')).toHaveLength(0)
    // 내보내기는 기록된다 (시스템 주체)
    expect(p.auditLog()[0]).toMatchObject({ actor: 'system', action: '내 데이터 내보내기', target: 'AC-0001' })
    expect(() => p.exportCustomerData(' ')).toThrow(PlatformError)
  })

  /**
   * 28-65-02: 28-64-03이 "통째 전개를 끊는다"고 적고 requests·claims 둘만 고쳤다.
   * payments·refunds·reviews(고객)와 jobs·reviews(파트너)는 `{...x}` 그대로였다.
   *
   * "결과의 키가 허용 목록 안에 있다"만 확인하면 **수정 전 코드에서도 통과한다** —
   * 통째 전개의 결과가 마침 현재 타입의 필드 전부이기 때문이다(공허한 테스트).
   * 그래서 저장된 레코드에 **목록에 없는 필드를 직접 심고** 그것이 결과에 따라오지 않는지 본다.
   * 필드가 하나 늘었을 때 무슨 일이 일어나는지가 이 항목의 요점이다.
   */
  it('저장된 레코드에 목록 밖 필드가 생겨도 고객 내보내기에 따라오지 않는다 (28-65-02)', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), customerId: 'AC-0001', customerName: '김반듯' })
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    p.payDeposit(r.id, 'card')
    p.transitionRequest(r.id, 'cancelled')

    // 미래에 필드가 하나 늘어난 상황을 그대로 만든다 (운영 내부 메모라고 하자)
    const internals = p as unknown as {
      payments: Array<Record<string, unknown>>
      refunds: Array<Record<string, unknown>>
    }
    internals.payments[0]!.내부메모 = 'PG 대사 담당 박준서'
    internals.refunds[0]!.내부메모 = '환불 승인자 메모'

    const { json } = p.exportCustomerData('AC-0001')
    const data = JSON.parse(json)
    expect(data.payments).toHaveLength(1)
    expect(data.refunds).toHaveLength(1)
    expect(json).not.toContain('내부메모')
    expect(json).not.toContain('박준서')
    expect(within(data.payments, EXPORT_PAYMENT_KEYS)).toEqual([])
    expect(within(data.refunds, EXPORT_REFUND_KEYS)).toEqual([])
  })

  /**
   * 28-66-02 회귀 테스트. 28-66이 통째 전개를 허용 목록으로 바꾸면서 payout.account를 떨어뜨렸다.
   * account는 **마스킹된 본인 이체 계좌**이고 타입 주석이 "분쟁 시 근거"라고 적은 값이다.
   * 파트너 본인이 정보주체인 산출물에서 본인 데이터를 뺀 것이라 과다 노출이 아니라 과소 제공이다.
   * 같은 값을 파트너 정산 CSV(Settlement.tsx)는 여전히 주고 있어 일관성도 깨져 있었다.
   */
  it('파트너 열람권이 지급 근거(마스킹 계좌)를 담는다 (28-66-02)', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), customerId: 'AC-0001', customerName: '김반듯' })
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    p.payDeposit(r.id, 'card')
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    p.transitionRequest(r.id, 'in_progress')
    p.completeJob(r.id)
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    p.markPayout(
      r.id,
      payoutAccountLabels({
        bank: '국민',
        number: '123456789012',
        holder: '김반듯',
        updatedAt: '2026-09-01T00:00:00.000Z',
        verifiedAt: '2026-09-02T00:00:00.000Z',
        verifiedBy: 'admin',
      }),
    )

    const data = JSON.parse(p.exportPartnerData('P-001').json)
    expect(data.jobs).toHaveLength(1)
    // 도메인이 실제로 보관한 값과 같아야 한다 — 파트너 정산 내역(CSV)이 주는 값과 같은 출처다
    const stored = p.completedJobsOf('P-001')[0]!.payout
    expect(stored?.accountMasked).toBeTruthy()
    expect(data.jobs[0].payout).toEqual({
      paidAt: stored!.paidAt,
      amount: stored!.amount,
      // 28-67-01: 실명이 든 account가 아니라 마스킹본이 담긴다
      accountMasked: stored!.accountMasked,
    })
    expect(p.partnerLedger('P-001')[0]!.account).toBe(stored!.accountMasked)
    // 허용 목록 밖은 여전히 막는다
    expect(within(data.jobs, [...EXPORT_JOB_KEYS, 'payout'])).toEqual([])
  })

  /**
   * 28-67-01 재현. `payoutAccountLabel`은 **계좌번호만** 마스킹하고 예금주는 평문으로 남긴다.
   * 가입명·업체명·예금주는 서로 별개의 자유 입력이라(Settlement.tsx의 예금주 placeholder가
   * "예: 반듯설비 (사업자) / 김반듯 (개인)") 예금주 = 가입명 ≠ 업체명이 흔하다.
   * 그때 자체 검사는 **업체명 하나만** 제외하므로 가입명이 걸려 본인 열람권이 실패한다.
   */
  it('예금주가 가입명과 같아도 파트너 본인 열람권이 실패하지 않는다 (28-67-01)', () => {
    const p = new PlatformService()
    p.extraNames = ['김반듯'] // 가입명 (PlatformProvider가 넣는 것과 같다)
    p.updateProfile({ ...DEFAULT_PARTNER_PROFILE, name: '반듯설비' }, 'P-001') // 업체명 — 이것만 검사에서 제외된다
    const r = p.addRequest({ ...newRequest(), customerId: 'AC-0001', customerName: '이고객' })
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    p.payDeposit(r.id, 'card')
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    p.transitionRequest(r.id, 'in_progress')
    p.completeJob(r.id)
    p.payFinal(r.id, 'card')
    p.settle(r.id)
    // 관리자 화면이 실제로 넘기는 값과 같은 형태 — payoutAccountLabel(계좌) 그대로
    p.markPayout(
      r.id,
      payoutAccountLabels({
        bank: '국민',
        number: '123456789012',
        holder: '김반듯',
        updatedAt: '2026-09-01T00:00:00.000Z',
        verifiedAt: '2026-09-02T00:00:00.000Z',
        verifiedBy: 'admin',
      }),
    )

    const { json } = p.exportPartnerData('P-001')
    const data = JSON.parse(json)
    // 예금주 실명이 산출물에 남지 않는다
    expect(json).not.toContain('김반듯')
    // 그러면서도 지급 근거는 준다 (28-66-02가 지적한 과소 제공으로 되돌아가지 않는다)
    expect(data.jobs[0].payout.accountMasked).toBe('국민 123******012 (김**)')
    expect(data.jobs[0].payout.account).toBeUndefined()
  })

  it('저장된 정산 기록에 목록 밖 필드가 생겨도 파트너 내보내기에 따라오지 않는다 (28-65-02)', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), customerId: 'AC-0001', customerName: '김반듯' })
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    p.payDeposit(r.id, 'card')
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    p.transitionRequest(r.id, 'in_progress')
    p.completeJob(r.id)

    const internals = p as unknown as { jobs: Array<Record<string, unknown>> }
    internals.jobs[0]!.내부메모 = '정산 담당 메모'
    // 지급 기록의 예금주는 허용 목록 밖이다 (28-61-02가 지적한 경로)
    internals.jobs[0]!.payout = { paidAt: '2026-09-10', amount: 1000, holder: '반듯설비' }

    const { json } = p.exportPartnerData('P-001')
    const data = JSON.parse(json)
    expect(data.jobs).toHaveLength(1)
    expect(json).not.toContain('내부메모')
    expect(data.jobs[0].payout).toEqual({ paidAt: '2026-09-10', amount: 1000 })
    expect(within(data.jobs, [...EXPORT_JOB_KEYS, 'payout'])).toEqual([])
  })
})

describe('가명본 복원 차단 (28-61-01)', () => {
  it('가명본은 복원을 거부하고 상태를 하나도 바꾸지 않는다 — 원본은 정상 복원된다', () => {
    const a = new PlatformService()
    a.addRequest({ ...newRequest(), customerId: 'AC-0001', customerName: '김반듯', description: '원본 요청 내용' })
    const full = a.exportBackup('full').json
    const pseudo = a.exportBackup('pseudonymous').json
    expect(JSON.parse(pseudo).pseudonymous).toBe(true)

    const b = new PlatformService()
    const own = b.addRequest({
      ...newRequest(),
      customerId: 'AC-0009',
      customerName: '이웃집',
      description: '건드리면 안 되는 요청',
    })
    b.audit('admin', '계정 정지', 'AC-0001')
    const before = b.exportData()

    expect(() => b.restoreBackup(pseudo)).toThrow('가명 처리된 백업은 복원할 수 없습니다')
    // 상태가 하나도 바뀌지 않았다 — 거부는 부분 적용이 아니다
    expect(b.store.get(own.id)?.customerName).toBe('이웃집')
    expect(b.store.get(own.id)?.description).toBe('건드리면 안 되는 요청')
    expect(b.canUndoRestore).toBe(false)
    // savedAt은 직렬화할 때마다 새로 찍히므로 제외하고 비교한다
    const normalize = (j: string) => {
      const o = JSON.parse(j)
      delete o.savedAt
      return JSON.stringify(o)
    }
    expect(normalize(b.exportData())).toBe(normalize(before))

    // 원본은 정상 복원
    const res = b.restoreBackup(full)
    expect(res.kept).toBeGreaterThan(0)
    expect(b.store.list().some((r) => r.description === '원본 요청 내용')).toBe(true)
    expect(b.canUndoRestore).toBe(true)
    // 가명본 판별은 깨진 JSON에 흔들리지 않는다(복원 검증이 처리)
    expect(() => b.restoreBackup('{')).toThrow(PlatformError)
  })
})

describe('가명 처리 허용 목록 (28-61-02)', () => {
  it('감사 로그 상세·클레임 처리 내용·파트너 상호·customerId까지 지우고, 운영 지표는 남긴다', () => {
    const p = new PlatformService()
    p.actorId = 'AC-ADMIN1'
    p.updateProfile(
      { name: '반듯설비', specialties: '욕실, 누수', region: '서울 관악구 신림동', intro: '20년 경력 김사장입니다' },
      'P-001',
    )
    const r = p.addRequest({
      ...newRequest(),
      customerId: 'AC-0001',
      customerName: '김반듯',
      region: '서울 관악구 신림동 123',
    })
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    p.scheduleVisit(r.id, { date: '2026-09-10', startHour: 9, endHour: 12 })
    p.transitionRequest(r.id, 'in_progress')
    p.completeJob(r.id, '2026-09-10')
    const c = p.fileClaim(r.id, { detail: '누수 재발' })
    p.resolveClaim(c.id, '김반듯 고객님 댁 재방문 후 조치 완료')
    p.audit('admin', '파트너 승인', 'AC-0002', '반듯설비')

    const json = p.exportBackup('pseudonymous').json
    // 실명·자유 서술이 하나도 없다
    for (const s of ['김반듯', '반듯설비', '20년 경력', '재방문 후 조치', '누수 재발', '신림동']) {
      expect(json).not.toContain(s)
    }
    const snap = JSON.parse(json)
    expect(snap.store.requests[0].customerId).toBe('고객 A')
    expect(snap.store.requests[0].customerName).toBe('고객 A')
    expect(snap.store.requests[0].region).toBe('서울 관악구')
    expect(snap.profiles[0][1].name).toBe('파트너 A')
    expect(snap.profiles[0][1].intro).toBe('')
    expect(snap.profiles[0][1].specialties).toBe('주방·욕실 공사, 급배수·누수·설비') // 운영 지표는 유지 (28-92: 저장 때 옛 라벨을 옮겼다)
    expect(snap.claims[0].resolution).toBeUndefined()
    expect(snap.claims[0].detail).toBeUndefined()
    expect(snap.claims[0].status).toBe('resolved') // 상태는 유지
    expect(
      snap.auditLog.every(
        (e: { detail?: string; by?: string; target?: string }) =>
          e.detail === undefined && e.by === undefined && e.target === undefined,
      ),
    ).toBe(true)
    expect(snap.auditLog.some((e: { action: string }) => e.action === '파트너 승인')).toBe(true) // 행위는 유지
    // 운영 지표 보존
    expect(snap.jobs.length).toBe(1)
    expect(snap.estimates.length).toBe(1)
    expect(snap.slots[0].date).toBe('2026-09-10')
  })

  it('자체 검사가 실명 잔존을 잡아낸다', () => {
    // 28-64-02: 검사가 이름 밖 식별자까지 보게 넓어지며 메시지도 '실제 식별자'로 바뀌었다
    expect(() => assertNoRealNames('{"x":"반듯설비"}', ['반듯설비'])).toThrow('실제 식별자가 남아 있습니다')
    expect(() => assertNoRealNames('{"x":"고객 A"}', ['반듯설비'])).not.toThrow()
    expect(() => assertNoRealNames('{"x":"김"}', ['김'])).not.toThrow() // 한 글자는 오탐이라 제외
  })
})

describe('파트너 열람권 (28-61-03)', () => {
  it('내 입찰·낙찰 범위만 담기고 다른 파트너·다른 고객 데이터는 섞이지 않는다', () => {
    const p = new PlatformService()
    const mine = p.addRequest({
      ...newRequest(),
      customerId: 'AC-0001',
      customerName: '김반듯',
      description: '내가 입찰한 건',
    })
    const other = p.addRequest({
      ...newRequest(),
      customerId: 'AC-0002',
      customerName: '이웃집',
      description: '남이 입찰한 건',
    })
    p.submitEstimate(mine.id, 'P-001', ESTIMATE_INPUT)
    p.submitEstimate(other.id, 'P-002', ESTIMATE_INPUT)

    const { json, requests } = p.exportPartnerData('P-001')
    expect(requests).toBe(1)
    const data = JSON.parse(json)
    expect(data.partnerId).toBe('P-001')
    expect(data.requests).toHaveLength(1)
    expect(data.requests[0].id).toBe(mine.id)
    expect(json).not.toContain(other.id)
    // 고객 이름은 담기지 않는다
    expect(json).not.toContain('김반듯')
    expect(json).not.toContain('내가 입찰한 건')
    expect(data.estimates).toHaveLength(1)
    expect(p.exportPartnerData('P-002').requests).toBe(1)
    expect(p.exportPartnerData('P-999').requests).toBe(0)
    expect(() => p.exportPartnerData(' ')).toThrow(PlatformError)
    expect(p.auditLog()[0]).toMatchObject({ actor: 'system', action: '내 데이터 내보내기' })
  })
})

describe('허용 목록 완성 (28-62-01)', () => {
  it('통째로 통과하던 컬렉션의 자유 서술(견적 메모·환불 사유·철회 사유)이 가명본에서 사라진다', () => {
    const p = new PlatformService()
    // 견적 메모가 남아 있는 요청 (철회하지 않는다 — 낙찰 철회는 입찰을 지운다)
    const kept = p.addRequest({
      ...newRequest(),
      customerId: 'AC-0001',
      customerName: '김반듯',
      description: '메모 있는 요청',
    })
    p.submitEstimate(kept.id, 'P-001', { ...ESTIMATE_INPUT, memo: '김반듯 고객님 010-1234-5678로 연락 바랍니다' })
    // 낙찰 철회 → PartnerCancel + Refund 생성용 별도 요청
    const r = p.addRequest({
      ...newRequest(),
      customerId: 'AC-0001',
      customerName: '김반듯',
      description: '철회될 요청',
    })
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    p.payDeposit(r.id, 'card')
    p.withdrawAward(r.id, 'P-001', '개인 사정으로 시공이 어렵습니다')
    const rf = p.refundFor(r.id)!
    p.settleRefund(rf.id, { deduction: 0 })
    p.updateSettings({ notice: '관리자 공지 문구' })

    const json = p.exportBackup('pseudonymous').json
    for (const s of ['010-1234-5678', '개인 사정으로', '관리자 공지 문구']) expect(json).not.toContain(s)
    const snap = JSON.parse(json)
    // 견적은 금액 항목만 남는다
    expect(snap.estimates[0][1].estimate.memo).toBeUndefined()
    expect(snap.estimates[0][1].estimate.laborCost).toBe(ESTIMATE_INPUT.laborCost)
    // 환불·철회는 사유가 빠지고 금액·상태는 남는다
    expect(snap.refunds[0].reason).toBeUndefined()
    expect(snap.refunds[0].status).toBe('done')
    expect(snap.partnerCancels[0].reason).toBeUndefined()
    expect(snap.partnerCancels[0].partnerId).toBe('P-001')
    // 설정은 운영 지표만
    expect(snap.settings.notice).toBeUndefined()
    expect(snap.settings.disabledCategories).toBeDefined()
  })

  it('구조 대조가 허용 목록 밖 키를 잡아낸다 — 통째 통과 실수가 성립하지 않는다', () => {
    expect(() =>
      assertPseudonymousShape({ refunds: [{ id: 'RF-1', reason: '실수로 남은 사유' }] }, [
        ['refunds', PSEUDONYMOUS_REFUND_KEYS],
      ]),
    ).toThrow('허용되지 않은 필드')
    // 목록 안의 키만 있으면 통과
    expect(() =>
      assertPseudonymousShape({ refunds: [{ id: 'RF-1', status: 'done' }] }, [['refunds', PSEUDONYMOUS_REFUND_KEYS]]),
    ).not.toThrow()
    // 28-64-02: 객체 하나짜리 컬렉션도 이제 검사한다 — 이전에는 Array.isArray 실패로 건너뛰었다
    expect(() => assertPseudonymousShape({ settings: { a: 1 } }, [['settings', []]])).toThrow('허용되지 않은 필드')
    expect(() => assertPseudonymousShape({ settings: { a: 1 } }, [['settings', ['a']]])).not.toThrow()
    // 28-66-01: 없는 경로는 이제 **실패**다. 이 줄은 원래 "여전히 건너뛴다"를 단언했는데,
    // 그 fail-open이 spec 경로 오타나 산출물 키 변경으로 검사가 소리 없이 사라지는 통로였다.
    expect(() => assertPseudonymousShape({}, [['store.requests', []]])).toThrow('찾을 수 없습니다')
  })
})

describe('입찰 철회 이력 (28-62-02)', () => {
  it('낙찰 전 철회가 기록·집계되고 스냅샷을 왕복하며, 파트너 열람권에 포함된다', () => {
    const p = new PlatformService()
    const a = p.addRequest({ ...newRequest(), description: '첫 요청' })
    const b = p.addRequest({ ...newRequest(), description: '둘째 요청' })
    p.submitEstimate(a.id, 'P-001', ESTIMATE_INPUT)
    p.submitEstimate(b.id, 'P-001', ESTIMATE_INPUT)
    p.submitEstimate(b.id, 'P-002', ESTIMATE_INPUT)
    expect(p.bidWithdrawals()).toHaveLength(0)
    expect(p.bidWithdrawalCount('P-001')).toBe(0)

    p.withdrawBid(a.id, 'P-001')
    p.withdrawBid(b.id, 'P-001')
    const log = p.bidWithdrawals('P-001')
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ requestId: b.id, partnerId: 'P-001', beforeDeadline: true })
    expect(log[0]!.id).toMatch(/^BW-\d{4}$/)
    expect(p.bidWithdrawalCount('P-001')).toBe(2)
    expect(p.bidWithdrawalCount('P-002')).toBe(0)
    // 철회해도 다른 파트너 입찰은 남는다
    expect(p.bidsFor(b.id)).toHaveLength(1)

    // 스냅샷 왕복 + 잘못된 형식 거부
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.bidWithdrawals('P-001')).toEqual(p.bidWithdrawals('P-001'))
    const bad = JSON.parse(p.exportData())
    bad.bidWithdrawals[0].beforeDeadline = 'yes'
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow('beforeDeadline')

    // 파트너 열람권: 철회한 요청도 내 이력으로 담긴다
    const { json } = p.exportPartnerData('P-001')
    const data = JSON.parse(json)
    expect(data.withdrawnBids).toHaveLength(2)
    expect(data.requests.map((x: { id: string }) => x.id).sort()).toEqual([a.id, b.id].sort())
    // 가명본에서도 허용 목록을 거친다
    const snap = JSON.parse(p.exportBackup('pseudonymous').json)
    expect(snap.bidWithdrawals).toHaveLength(2)
    expect(Object.keys(snap.bidWithdrawals[0]).sort()).toEqual(['at', 'beforeDeadline', 'id', 'partnerId', 'requestId'])
  })
})

describe('자체 검사 이름 출처 확장 (28-63-02)', () => {
  it('요청·프로필에 없는 이름도 주입하면 검사 대상이 된다', () => {
    const p = new PlatformService()
    // 요청도 프로필도 없는 회원 이름이 어떤 경로로 결과에 남았다고 가정한다
    p.updateSettings({ notice: '가입만 한 회원 홍길동 문의 건' })
    // 주입 전: settings.notice는 허용 목록에서 빠지므로 애초에 나가지 않는다
    expect(() => p.exportBackup('pseudonymous')).not.toThrow()
    // 주입해도 실제로 새지 않으면 통과한다 — 검사 범위만 넓힌다
    p.extraNames = ['홍길동']
    expect(() => p.exportBackup('pseudonymous')).not.toThrow()
    // 이름이 실제로 결과에 남는 자리(요청 고객명)에 있으면 가명화되므로 여전히 통과
    p.addRequest({ ...newRequest(), customerName: '홍길동' })
    const json = p.exportBackup('pseudonymous').json
    expect(json).not.toContain('홍길동')
    // 주입 목록이 비어 있어도 기존 동작 그대로
    p.extraNames = []
    expect(() => p.exportBackup('pseudonymous')).not.toThrow()
  })
})

describe('가명본 구조 검사가 요청 컬렉션에 실제로 닿는다 (28-64-02)', () => {
  it('중첩 경로(store.requests)의 허용 밖 키를 잡는다 — 이전에는 통째로 건너뛰었다', () => {
    expect(() =>
      assertPseudonymousShape({ store: { requests: [{ id: 'R-1', 유출: '실명' }] } }, [['store.requests', ['id']]]),
    ).toThrow('store.requests')
  })

  it('[id, obj] 쌍 컬렉션도 두 번째 원소를 검사한다 — 이전에는 배열이라 continue 했다', () => {
    expect(() =>
      assertPseudonymousShape({ profiles: [['P-1', { name: '반듯설비', 유출: 'x' }]] }, [['profiles', ['name']]]),
    ).toThrow('profiles')
  })

  it('객체 하나짜리 컬렉션(settings)도 검사한다', () => {
    expect(() =>
      assertPseudonymousShape({ settings: { feeRate: 0.1, 유출: 'x' } }, [['settings', ['feeRate']]]),
    ).toThrow('settings')
  })

  it('실제 가명본이 새 필드에 대해 기본 "제외"로 동작한다 — 방출 키가 전부 허용 목록 안이다', () => {
    const { p } = platformWithRequest()
    const snap = JSON.parse(p.exportBackup('pseudonymous').json)
    // 방출되는 요청 키가 하나라도 허용 목록 밖이면 exportBackup 자체가 던져야 한다.
    expect(snap.store.requests.length).toBeGreaterThan(0)
    // photoCount는 28-64 시점에 허용 목록 밖이었는데 아무도 잡지 못했다
    expect(Object.keys(snap.store.requests[0])).toContain('photoCount')
  })

  it('daysOff는 통째로 통과하지 않는다 — 형태를 재조립한다', () => {
    const p = new PlatformService({})
    p.toggleDayOff('P-0001', '2026-09-10')
    const snap = JSON.parse(p.exportBackup('pseudonymous').json)
    for (const row of snap.daysOff) {
      expect(Array.isArray(row)).toBe(true)
      expect(row).toHaveLength(2)
      expect(Array.isArray(row[1])).toBe(true)
      expect(row[1].every((d: unknown) => typeof d === 'string')).toBe(true)
    }
  })
})

describe('가명 처리 값 검사가 이름 밖 식별자도 본다 (28-64-02)', () => {
  it('전화번호가 결과에 남으면 실패시킨다 — 구분자가 달라도 잡는다', () => {
    expect(() => assertNoRealIdentifiers('{"x":"010-1234-5678"}', ['010-1234-5678'])).toThrow(
      '가명 처리에 실패했습니다',
    )
    expect(() => assertNoRealIdentifiers('{"x":"01012345678"}', ['010-1234-5678'])).toThrow('가명 처리에 실패했습니다')
  })

  it('사업자등록번호도 잡는다', () => {
    expect(() => assertNoRealIdentifiers('{"x":"123-45-67890"}', ['1234567890'])).toThrow('가명 처리에 실패했습니다')
  })

  it('2자 이하 토큰은 오탐을 막기 위해 값 대조에서 제외한다', () => {
    expect(() => assertNoRealIdentifiers('{"pkg":"한샘 도배 패키지"}', ['도배·도장·필름'])).not.toThrow()
    expect(() => assertNoRealIdentifiers('{"pkg":"한샘 도배 패키지"}', ['한샘도배'])).not.toThrow()
  })

  it('걸린 식별자를 오류 메시지에 담는다', () => {
    expect(() => assertNoRealIdentifiers('{"n":"김반듯"}', ['김반듯'])).toThrow('김반듯')
  })
})

describe('지역 축약이 실패 시 닫힌다 (28-64-02)', () => {
  it('공백 없이 입력한 상세 주소는 그대로 남지 않는다', () => {
    const p = new PlatformService({})
    p.addRequest({ ...newRequest(), region: '서울강서구화곡동123-45 202호' })
    const snap = JSON.parse(p.exportBackup('pseudonymous').json)
    const regions = snap.store.requests.map((r: { region: string }) => r.region)
    expect(regions).toContain('[가명 처리] 지역')
    expect(JSON.stringify(regions)).not.toContain('123-45')
    expect(JSON.stringify(regions)).not.toContain('202호')
  })

  it('도로명·번지가 섞이면 시/도 + 시군구까지만 남긴다', () => {
    const p = new PlatformService({})
    p.addRequest({ ...newRequest(), region: '서울 강서구 화곡로12길 3' })
    const snap = JSON.parse(p.exportBackup('pseudonymous').json)
    expect(snap.store.requests[0].region).toBe('서울 강서구')
  })

  it('알아볼 수 없는 지역은 가명으로 떨어뜨린다', () => {
    const p = new PlatformService({})
    p.addRequest({ ...newRequest(), region: '우리집 앞' })
    const snap = JSON.parse(p.exportBackup('pseudonymous').json)
    expect(snap.store.requests[0].region).toBe('[가명 처리] 지역')
  })

  it('정상적인 시/도 + 시군구는 그대로 남긴다 (운영 지표용)', () => {
    const p = new PlatformService({})
    p.addRequest({ ...newRequest(), region: '고양 덕양구' })
    const snap = JSON.parse(p.exportBackup('pseudonymous').json)
    expect(snap.store.requests[0].region).toBe('고양 덕양구')
  })
})

describe('열람권 범위 (28-64-03)', () => {
  /** A가 낙찰받아 시공을 끝내고 분쟁이 접수된 요청. B는 같은 요청에 입찰만 했다가 떨어졌다. */
  function twoBidders() {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), customerId: 'CU-1' })
    p.submitEstimate(r.id, 'P-A', ESTIMATE_INPUT)
    p.submitEstimate(r.id, 'P-B', ESTIMATE_INPUT)
    p.acceptBid(r.id, 'P-A')
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    p.transitionRequest(r.id, 'in_progress')
    p.completeJob(r.id, '2026-09-05')
    const c = p.fileClaim(r.id, { detail: '누수가 재발했습니다' })
    p.replyClaim(c.id, 'P-A', 'A 업체의 자유 서술 답변입니다')
    p.resolveClaim(c.id, '관리자 내부 처리 메모입니다')
    return { p, r, c }
  }

  it('낙찰 실패한 파트너의 내보내기에 남의 분쟁 기록이 들어가지 않는다', () => {
    const { p, r } = twoBidders()
    const loser = JSON.parse(p.exportPartnerData('P-B').json)
    expect(loser.claims).toHaveLength(0)
    expect(JSON.stringify(loser)).not.toContain('A 업체의 자유 서술 답변입니다')
    // 자기가 입찰한 요청 자체는 여전히 자기 이력이다
    expect(loser.requests.map((x: { id: string }) => x.id)).toContain(r.id)
  })

  it('낙찰받아 시공한 파트너는 자기 분쟁 기록을 그대로 본다', () => {
    const { p } = twoBidders()
    const winner = JSON.parse(p.exportPartnerData('P-A').json)
    expect(winner.claims).toHaveLength(1)
    expect(JSON.stringify(winner)).toContain('A 업체의 자유 서술 답변입니다')
  })

  it('고객 내보내기에 관리자 내부 처리 메모가 들어가지 않는다', () => {
    const { p } = twoBidders()
    const mine = JSON.parse(p.exportCustomerData('CU-1').json)
    expect(JSON.stringify(mine)).not.toContain('관리자 내부 처리 메모입니다')
  })

  it('고객 내보내기도 통째 전개가 아니라 필드를 골라 담는다 — 사진은 개수만', () => {
    const { p } = twoBidders()
    const mine = JSON.parse(p.exportCustomerData('CU-1').json)
    for (const req of mine.requests) {
      expect(req).not.toHaveProperty('photos')
      expect(req).not.toHaveProperty('completionPhotos')
      expect(req).toHaveProperty('photoCount')
    }
  })

  it('고객 내보내기에도 자체 검사가 걸려 다른 고객 이름이 섞이면 실패한다', () => {
    const p = new PlatformService()
    p.addRequest({ ...newRequest(), customerId: 'CU-1', customerName: '김반듯' })
    p.addRequest({ ...newRequest(), customerId: 'CU-2', customerName: '박다른' })
    const mine = JSON.parse(p.exportCustomerData('CU-1').json)
    expect(mine.requests).toHaveLength(1)
    expect(JSON.stringify(mine)).not.toContain('박다른')
  })
})

describe('감사 로그가 남겨야 할 것을 지키다 (28-64-04)', () => {
  it('내용(detail)이 다른 기록은 5분 안이라도 접지 않는다 — 첫 변경 내역이 사라지지 않는다', () => {
    const p = new PlatformService()
    p.updateSettings({ heroTitle: '우리 동네 수리 전문가' })
    p.updateSettings({ notice: '점검 안내' })
    const rows = p.auditLog().filter((e) => e.action === '설정 변경')
    expect(rows).toHaveLength(2)
    const details = rows.map((e) => e.detail ?? '').join(' | ')
    expect(details).toContain('heroTitle')
    expect(details).toContain('notice')
  })

  it('진행 표시 detail(로그인 실패의 남은 횟수)은 무시하고 접는다 — 잃는 내용이 없다', () => {
    const p = new PlatformService()
    for (let i = 0; i < 3; i += 1) p.audit('system', '로그인 실패', '고객 010****0001', `남은 시도 ${3 - i}회`)
    const rows = p.auditLog().filter((e) => e.action === '로그인 실패')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.count).toBe(3)
    expect(rows[0]!.detail).toBe('남은 시도 1회')
    expect(PROGRESS_DETAIL_AUDIT_ACTIONS.has('로그인 실패')).toBe(true)
    expect(PROGRESS_DETAIL_AUDIT_ACTIONS.has('설정 변경')).toBe(false)
  })

  it('내용이 같은 반복은 여전히 한 줄로 접고 횟수를 센다', () => {
    const p = new PlatformService()
    p.audit('admin', '같은 행위', 'T-1', '같은 내용')
    p.audit('admin', '같은 행위', 'T-1', '같은 내용')
    const rows = p.auditLog().filter((e) => e.action === '같은 행위')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.count).toBe(2)
  })

  it('보안 행위 목록이 인증이 실제로 내보내는 이름과 짝을 이룬다', () => {
    for (const a of ['로그인 실패', '로그인 잠금', 'OTP 시도 초과', '비밀번호 변경', '회원 탈퇴']) {
      expect(SECURITY_AUDIT_ACTIONS.has(a)).toBe(true)
    }
    expect(SECURITY_AUDIT_ACTIONS.has('설정 변경')).toBe(false)
  })

  it('상한 초과 시 보안 이벤트는 마지막까지 남고 일반 정리 기록이 먼저 빠진다', () => {
    const p = new PlatformService()
    p.audit('system', '로그인 잠금', 'AC-0001', '5회 실패')
    for (let i = 0; i < AUDIT_CAP + 50; i += 1) p.audit('system', '사진 정리', `T-${i}`, `${i}`)
    p.pruneAuditLog()
    const log = p.auditLog()
    expect(log.length).toBeLessThanOrEqual(AUDIT_CAP)
    expect(log.some((e) => e.action === '로그인 잠금')).toBe(true)
  })

  it('파싱 불가 타임스탬프는 보관 정책을 통과하지 못한다', () => {
    const p = new PlatformService()
    p.audit('admin', '정상 기록', 'T-1')
    // 손상된 스냅샷이 들어온 상황을 재현한다
    const snap = JSON.parse(p.exportData())
    snap.auditLog.push({ id: 'AUD-99999', at: '언젠가', actor: 'system', action: '망가진 기록', target: 'T-9' })
    const q = new PlatformService()
    q.importSnapshot(JSON.stringify(snap))
    q.pruneAuditLog()
    expect(q.auditLog().some((e) => e.action === '망가진 기록')).toBe(false)
  })

  it('audit()는 새 줄인지 접힌 줄인지 알려준다', () => {
    const p = new PlatformService()
    const a = p.auditWithMeta('admin', '행위', 'T-1', '내용')
    expect(a.merged).toBe(false)
    const b = p.auditWithMeta('admin', '행위', 'T-1', '내용')
    expect(b.merged).toBe(true)
    expect(b.entry.id).toBe(a.entry.id)
  })
})

describe('감사 로그 축출 예약분 — 어느 쪽도 다른 쪽을 굶기지 못한다 (28-64-04)', () => {
  it('분산 무차별 로그인(보안 폭주)이 관리자 기록을 밀어내지 못한다', () => {
    const p = new PlatformService()
    for (let i = 0; i < 10; i += 1) p.audit('admin', '설정 변경', `settings-${i}`)
    // 대상을 매번 바꿔 접기를 피한다 — 공격자의 최선
    for (let i = 0; i < AUDIT_CAP + 100; i += 1) {
      p.audit('system', '로그인 실패', `고객 010****${String(i).padStart(4, '0')}`)
    }
    p.pruneAuditLog()
    const log = p.auditLog()
    expect(log).toHaveLength(AUDIT_CAP)
    expect(log.filter((e) => e.actor === 'admin')).toHaveLength(10)
  })

  it('평범한 관리자 작업 폭주가 로그인 잠금 이력을 지우지 못한다', () => {
    const p = new PlatformService()
    p.audit('system', '로그인 잠금', 'AC-0001', '5회 실패')
    p.audit('system', '비밀번호 변경', 'AC-0002')
    for (let i = 0; i < AUDIT_CAP + 100; i += 1) p.audit('admin', '요청 상태 변경', `R-${i}`)
    p.pruneAuditLog()
    const log = p.auditLog()
    expect(log).toHaveLength(AUDIT_CAP)
    expect(log.some((e) => e.action === '로그인 잠금')).toBe(true)
    expect(log.some((e) => e.action === '비밀번호 변경')).toBe(true)
  })
})

describe('28-78: 보관함이 저장을 막으면 보관함이 양보한다 · 정리는 기록에 남는다', () => {
  /** 외부 키(보관함)를 흉내 내는 최소 포트 — 도메인은 저장소를 모르고 숫자와 함수만 안다 */
  function externalStash(initialChars: number) {
    let chars = initialChars
    return {
      chars: () => chars,
      trim: (need: number) => {
        const freed = Math.min(chars, Math.max(0, need))
        chars -= freed
        return freed
      },
    }
  }

  /**
   * 28-79-04: 가드를 **실제 경로**(사진 첨부)로 태운다. 28-78은 이것 때문에 `assertRoomForTest`라는
   * 테스트 전용 공개 메서드를 도메인 표면에 남겼는데, 표면은 화면이 쓰는 계약이라 테스트 편의로 넓히면
   * 다음 사람이 그것을 계약으로 오해한다. 사진 경로가 원래 이 가드의 주인이다.
   */
  const bigPhoto = (chars: number): RequestPhoto => ({
    id: 'big',
    dataUrl: `data:image/png;base64,${'A'.repeat(Math.max(0, chars))}`,
    width: 640,
    height: 480,
    bytes: 1000,
  })
  const seedRequest = (p: PlatformService) =>
    p.addRequest({
      customerName: '김고객',
      region: '서울 강서구',
      category: '급배수·누수·설비',
      description: '첨부 시험',
      desiredDate: '2026-12-01',
    })

  it('28-78-01: 용량이 모자라면 보관함을 먼저 줄이고 저장을 통과시킨다', () => {
    const stash = externalStash(900_000)
    const p = PlatformService.load({ externalChars: stash.chars, trimExternal: stash.trim }).service
    const r = seedRequest(p)
    const usage = p.storageUsage()
    const extra = usage.limit - usage.chars - 500_000 // 보관함까지 더하면 넘고, 보관함을 줄이면 들어간다
    expect(usage.totalChars + extra).toBeGreaterThan(usage.limit)
    // 수정 전: 보관함은 그대로 두고 던진다 — 사용자는 새로고침 전까지 풀 방법이 없다
    expect(() => p.addPhoto(r.id, bigPhoto(extra))).not.toThrow()
    expect(stash.chars()).toBeLessThan(900_000) // 보관함이 양보했다
  })

  it('28-78-01: 보관함을 다 비워도 모자라면 여전히 거절한다 (가드는 살아 있다)', () => {
    const stash = externalStash(100_000)
    const p = PlatformService.load({ externalChars: stash.chars, trimExternal: stash.trim }).service
    const r = seedRequest(p)
    expect(() => p.addPhoto(r.id, bigPhoto(p.storageUsage().limit * 2))).toThrow(/저장 공간이 부족/)
    expect(stash.chars()).toBe(0) // 줄일 수 있는 만큼은 줄였다
  })

  it('28-78-02 · 28-79-03: 보관함 정리는 운영 기록에 남고, 행위명은 도메인이 정한다', () => {
    const p = PlatformService.load({}).service
    p.recordStashTrim(2)
    const rows = p.auditLog().filter((e) => e.action === '보관함 정리')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.actor).toBe('system')
    expect(rows[0]?.target).toBe('2')
    p.recordStashTrim(0) // 지운 것이 없으면 남기지 않는다
    expect(p.auditLog().filter((e) => e.action === '보관함 정리')).toHaveLength(1)
  })
})

describe('28-78 리뷰: 앱 포트가 던져도 용량 가드는 결정적이다', () => {
  it('trimExternal이 던지면 그것을 삼키고 PlatformError로 거절한다', () => {
    const p = PlatformService.load({
      externalChars: () => 900_000,
      trimExternal: () => {
        throw new Error('localStorage 접근 실패')
      },
    }).service
    const r = p.addRequest({
      customerName: '김고객',
      region: '서울 강서구',
      category: '급배수·누수·설비',
      description: '첨부 시험',
      desiredDate: '2026-12-01',
    })
    // 수정 전: 앱 포트의 예외가 그대로 새어 나와, 화면은 도메인 오류가 아닌 정체불명 예외를 받는다
    expect(() =>
      p.addPhoto(r.id, {
        id: 'x',
        dataUrl: `data:image/png;base64,${'A'.repeat(p.storageUsage().limit)}`,
        width: 640,
        height: 480,
        bytes: 1000,
      }),
    ).toThrow(/저장 공간이 부족/)
  })
})

describe('28-89-B: 첫 화면 배치는 데이터다', () => {
  const ids = (p: PlatformService) => p.getSettings().landing.sections.map((s) => `${s.id}:${s.visible ? 1 : 0}`)
  const STORAGE_KEY = 'banded-platform-v1'

  it('기본 배치는 여섯 섹션이 기본 순서로 전부 보인다 — 구 스냅샷(landing 없음)도 같다', () => {
    const p = PlatformService.load({}).service
    expect(ids(p)).toEqual(['categories:1', 'steps:1', 'services:1', 'packages:1', 'faq:1', 'cta:1'])
    expect(landingTitle(p.getSettings().landing, 'faq')).toBe('자주 묻는 질문')
    expect(landingTitle({ ...DEFAULT_LANDING, titles: { faq: '  ' } }, 'faq')).toBe('자주 묻는 질문') // 공백은 기본으로
    expect(landingTitle(p.getSettings().landing, 'services')).toBeNull()
    // 28-88 까지의 스냅샷에는 `landing` 이 없다 — 있는 것처럼 읽힌다
    const storage = memoryStorage()
    const snap = JSON.parse(PlatformService.load({ storage }).service.exportData()) as {
      settings: Record<string, unknown>
    }
    delete snap.settings['landing']
    storage.setItem(STORAGE_KEY, JSON.stringify(snap))
    expect(ids(PlatformService.load({ storage }).service)).toEqual([
      'categories:1',
      'steps:1',
      'services:1',
      'packages:1',
      'faq:1',
      'cta:1',
    ])
  })

  it('관리자가 순서를 바꾸고 숨기고 제목을 고치면 저장되고 다시 읽힌다', () => {
    const storage = memoryStorage()
    const p = PlatformService.load({ storage }).service
    p.updateSettings({
      landing: {
        sections: [
          { id: 'faq', visible: true },
          { id: 'categories', visible: true },
          { id: 'steps', visible: false },
          { id: 'services', visible: true },
          { id: 'packages', visible: false },
          { id: 'cta', visible: true },
        ],
        titles: { faq: '  궁금한 것들  ', services: '무시된다(제목 없는 섹션)' },
      },
    })
    const again = PlatformService.load({ storage }).service
    expect(ids(again)).toEqual(['faq:1', 'categories:1', 'steps:0', 'services:1', 'packages:0', 'cta:1'])
    expect(landingTitle(again.getSettings().landing, 'faq')).toBe('궁금한 것들')
    expect(again.getSettings().landing.titles.services).toBeUndefined()
    // 운영 기록에 남는다
    expect(again.auditLog().some((e) => e.action === '설정 변경' && (e.detail ?? '').includes('landing'))).toBe(true)
  })

  it('잘못된 배치는 거부한다 — 중복·누락·전부 숨김·긴 제목', () => {
    const p = PlatformService.load({}).service
    const all = DEFAULT_LANDING.sections
    expect(() =>
      p.updateSettings({ landing: { sections: [...all, { id: 'faq', visible: true }], titles: {} } }),
    ).toThrow('두 번')
    expect(() => p.updateSettings({ landing: { sections: all.slice(1), titles: {} } })).toThrow('빠졌습니다')
    expect(() =>
      p.updateSettings({ landing: { sections: all.map((s) => ({ ...s, visible: false })), titles: {} } }),
    ).toThrow('최소 1개')
    expect(() => p.updateSettings({ landing: { sections: all, titles: { faq: 'x'.repeat(61) } } })).toThrow('60자')
    expect(ids(p)).toEqual(['categories:1', 'steps:1', 'services:1', 'packages:1', 'faq:1', 'cta:1']) // 그대로다
  })

  it('손으로 고친 JSON 은 정규화된다 — 모르는 섹션은 버리고 빠진 섹션은 뒤에 붙는다', () => {
    const l = normalizeLanding({
      sections: [{ id: 'cta', visible: false }, { id: 'hero' }, { id: 'cta', visible: true }, 'junk'],
      titles: { cta: '무시', faq: 7, steps: ' 넷 ' },
    })
    expect(l.sections.map((s) => `${s.id}:${s.visible ? 1 : 0}`)).toEqual([
      'cta:0',
      'categories:1',
      'steps:1',
      'services:1',
      'packages:1',
      'faq:1',
    ])
    expect(l.titles).toEqual({ steps: '넷' })
    expect(normalizeLanding(null)).toEqual(DEFAULT_LANDING)
    expect(normalizeLanding(DEFAULT_LANDING)).not.toBe(DEFAULT_LANDING) // 복사본이다
  })
})

describe('28-92: 카탈로그 라벨 이전', () => {
  const req = (category: string, extra: Record<string, unknown> = {}) =>
    ({
      customerName: '김하늘',
      region: '서울 강서구',
      category,
      description: '욕실 천장 누수',
      desiredDate: '2026-12-01',
      ...extra,
    }) as unknown as Parameters<PlatformService['addRequest']>[0]

  it('addRequest는 옛 라벨을 카탈로그 라벨로 옮기고, 목록 밖은 거절한다', () => {
    const p = PlatformService.load({}).service
    // 수정 전: 요청의 category는 검증되지 않아 어떤 문자열이든 저장됐다
    expect(p.addRequest(req('욕실')).category).toBe('주방·욕실 공사')
    expect(p.addRequest(req('기타')).category).toBe('분야를 모르겠어요')
    expect(() => p.addRequest(req('로봇 수리'))).toThrow('알 수 없는 분야')
  })

  it('28-91 이전 스냅샷의 요청·패키지·질문·비활성 목록·전문 분야가 읽을 때 옮겨진다', () => {
    const p = PlatformService.load({}).service
    p.addRequest(req('급배수·누수·설비'))
    const snap = JSON.parse(JSON.stringify(p.snapshot())) as Record<string, unknown>
    const store = snap.store as { requests: Array<Record<string, unknown>> }
    store.requests[0]!.category = '욕실'
    store.requests.push({ ...store.requests[0]!, id: 'REQ-9999', category: '외계 분야' })
    snap.packages = [
      { id: 'PK-1', name: '실리콘', category: '욕실', price: 90000, description: '', active: true },
      { id: 'PK-2', name: '로봇', category: '로봇 수리', price: 90000, description: '', active: true },
      null, // #251 리뷰: 손상된 행도 이전 단계에서 버린다 — 남기면 검증이 스냅샷 전체를 거절한다
    ]
    snap.questions = [{ id: 'Q-1', category: '전기', label: '차단기?', active: true }]
    snap.settings = { ...(snap.settings as object), disabledCategories: ['도배', '장판', '타일', '없는 것'] }
    snap.profiles = [['AC-1', { name: '반듯설비', specialties: '욕실, 누수, 수전·배수', region: '서울', intro: '' }]]

    const loaded = PlatformService.load({}).service
    // 수정 전: `packages[1].category: 로봇 수리` 같은 검증 실패로 스냅샷 전체가 거절됐고, 옛 라벨은 그대로 남아
    //   카탈로그 목록에 없는 카테고리가 화면에 걸렸다
    loaded.importSnapshot(JSON.stringify(snap))
    const requests = loaded.store.list()
    expect(requests.map((r) => r.category)).toEqual(['주방·욕실 공사', '분야를 모르겠어요'])
    expect(loaded.listPackages().map((x) => x.category)).toEqual(['주방·욕실 공사'])
    expect(loaded.listQuestions().map((x) => x.category)).toEqual(['전기·조명'])
    expect(loaded.getSettings().disabledCategories).toEqual(['도배·도장·필름', '바닥·타일'])
    expect(loaded.partnerSummary('AC-1').profile.specialties).toBe('주방·욕실 공사, 급배수·누수·설비')
  })
})

describe('28-93: 여러 분야 + 안전 질문 → 관리자 검토', () => {
  const T = '2026-09-01'
  const safe = { isLocked: null, urgent: false, ack: false }
  const profiled = () => {
    const p = new PlatformService()
    p.updateProfile({ name: '전기설비', specialties: '전기·조명', region: '서울', intro: '' }, 'AC-9')
    return p
  }

  it('분야 여럿: 첫 항목이 주 분야, 중복·옛 라벨은 정리, 매칭·질문·라벨이 묶음 전체를 본다', () => {
    const p = profiled()
    const r = p.addRequest(
      {
        ...newRequest(),
        category: '주방·욕실 공사',
        categories: ['욕실', '전기', '주방·욕실 공사'] as unknown as RepairCategory[],
        desiredDate: T,
      },
      T,
    )
    expect(r.category).toBe('주방·욕실 공사')
    expect(r.categories).toEqual(['주방·욕실 공사', '전기·조명'])
    // 전기 파트너에게도 맞는다 (주 분야만 보면 빠진다)
    expect(p.matchedRequests('AC-9', T).map((x) => x.id)).toEqual([r.id])
    expect(p.notificationsFor('partner', 'AC-9').some((n) => n.text.includes('[주방·욕실 공사 + 전기·조명]'))).toBe(
      true,
    )
    // 질문은 분야 순서대로 합쳐진다
    expect(p.questionsFor(r.categories!).map((q) => q.category)).toEqual([
      '주방·욕실 공사',
      '주방·욕실 공사',
      '전기·조명',
      '전기·조명',
    ])
    // 분야 하나면 categories 키가 없다 (구 데이터와 같은 모양)
    expect(
      p.addRequest({ ...newRequest(), categories: ['급배수·누수·설비'], desiredDate: T }, T).categories,
    ).toBeUndefined()
  })

  it('안전 답이 실리면 검토를 거친다: 방충망은 AUTO_PASS, 범위 검토 분야는 MANUAL_REVIEW로 파트너에게 보이지 않는다', () => {
    const p = profiled()
    const auto = p.addRequest(
      { ...newRequest(), category: '방충망', desiredDate: T, safety: { isLocked: null, urgent: null, ack: false } },
      T,
    )
    expect(auto.reviewStatus).toBe('AUTO_PASS')
    expect(auto.reviewFlags).toBeUndefined()
    const held = p.addRequest({ ...newRequest(), category: '전기·조명', desiredDate: T, safety: safe }, T)
    expect(held.reviewStatus).toBe('MANUAL_REVIEW')
    expect(held.reviewFlags).toEqual(['WORK_SCOPE_REVIEW'])
    expect(heldForReview(held)).toBe(true)
    expect(p.matchedRequests('AC-9', T)).toEqual([])
    expect(p.notificationsFor('partner', 'AC-9')).toEqual([])
    expect(p.notificationsFor('customer').some((n) => n.text.includes('접수 확인 중'))).toBe(true)
    expect(() => p.submitEstimate(held.id, 'AC-9', ESTIMATE_INPUT, T)).toThrow(
      '관리자 검토 전에는 견적을 낼 수 없습니다',
    )
    expect(p.opsQueue(T).counts.reviewQueue).toBe(1)
    expect(p.opsQueue(T).reviewQueue[0]).toMatchObject({ flags: ['WORK_SCOPE_REVIEW'] })
  })

  it('규칙 위반은 접수 자체가 거절된다 (INCOMPLETE·ack·RECHECK)', () => {
    const p = new PlatformService()
    const base = { ...newRequest(), category: '문·도어락' as const, desiredDate: T }
    expect(() => p.addRequest({ ...base, safety: { isLocked: null, urgent: null, ack: false } }, T)).toThrow(
      '안전 질문에 답해 주세요',
    )
    expect(() => p.addRequest({ ...base, safety: { isLocked: true, urgent: false, ack: false } }, T)).toThrow(
      '안전 안내 확인이 필요합니다',
    )
    expect(() =>
      p.addRequest(
        { ...base, description: '문이 잠겨서 못 들어가요', safety: { isLocked: false, urgent: false, ack: false } },
        T,
      ),
    ).toThrow('다시 확인해 주세요')
    expect(p.store.list()).toEqual([])
  })

  it('관리자 검토 완료: 조건(사유·연락·안전 안내·신원·범위)을 채워야 하고, 끝나면 파트너 공개·알림·운영 기록', () => {
    const p = profiled()
    const r = p.addRequest(
      {
        ...newRequest(),
        category: '문·도어락',
        categories: ['문·도어락', '전기·조명'],
        description: '도어락이 고장나 문이 잠겨 못 들어가요',
        desiredDate: T,
        safety: { isLocked: true, urgent: false, ack: true },
      },
      T,
    )
    expect(r.reviewFlags).toEqual(['LOCKOUT', 'WORK_SCOPE_REVIEW'])
    const ok = { note: '고객 통화로 신원·현장 확인', contactChecked: true, safetyDelivered: true }
    expect(() => p.reviewRequest(r.id, { ...ok, note: '확인' }, 'admin')).toThrow('5자 이상')
    expect(() => p.reviewRequest(r.id, { ...ok, contactChecked: false }, 'admin')).toThrow('연락 확인')
    expect(() => p.reviewRequest(r.id, { ...ok, safetyDelivered: false }, 'admin')).toThrow('안전 안내 전달')
    expect(() => p.reviewRequest(r.id, ok, 'admin')).toThrow('신원 확인')
    expect(() => p.reviewRequest(r.id, { ...ok, identityChecked: true }, 'admin')).toThrow('범위 확인')
    const done = p.reviewRequest(r.id, { ...ok, identityChecked: true, scopeChecked: true }, 'admin')
    expect(done.review).toMatchObject({ by: 'admin', note: ok.note })
    expect(heldForReview(done)).toBe(false)
    expect(p.matchedRequests('AC-9', T).map((x) => x.id)).toEqual([r.id])
    expect(p.notificationsFor('partner', 'AC-9').some((n) => n.text.includes('새 일감'))).toBe(true)
    expect(p.notificationsFor('customer').some((n) => n.text.includes('접수 확인 완료'))).toBe(true)
    expect(p.auditLog().some((a) => a.action === '접수 검토' && a.target === r.id)).toBe(true)
    expect(p.opsQueue(T).counts.reviewQueue).toBe(0)
    expect(p.submitEstimate(r.id, 'AC-9', ESTIMATE_INPUT, T).total).toBeGreaterThan(0)
    // 두 번은 안 된다, 검토 대상이 아닌 요청도 안 된다
    expect(() => p.reviewRequest(r.id, { ...ok, identityChecked: true, scopeChecked: true }, 'admin')).toThrow(
      '이미 검토가 끝난',
    )
    const plain = p.addRequest({ ...newRequest(), desiredDate: T }, T)
    expect(() => p.reviewRequest(plain.id, ok, 'admin')).toThrow('검토 대상 요청이 아닙니다')
  })

  it('가명본 반출: 분야 묶음·안전 답변·검토 결과는 실리고, 검토 메모는 빠진다', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), categories: ['전기·조명', '방충망'], desiredDate: T, safety: safe }, T)
    p.reviewRequest(
      r.id,
      { note: '현장 범위 확인 메모', contactChecked: true, safetyDelivered: true, scopeChecked: true },
      'admin',
    )
    const out = JSON.parse(p.exportBackup('pseudonymous').json) as {
      store: { requests: Array<Record<string, unknown>> }
    }
    const row = out.store.requests[0]!
    expect(row.categories).toEqual(['전기·조명', '방충망'])
    expect(row.safety).toEqual(safe)
    expect(row.reviewStatus).toBe('MANUAL_REVIEW')
    expect(row.reviewFlags).toEqual(['WORK_SCOPE_REVIEW'])
    expect(row.review).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('현장 범위 확인 메모')
  })

  it('설명 수정은 안전 답변과 다시 대조한다', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), category: '전기·조명', desiredDate: T, safety: safe }, T)
    expect(() => p.updateRequest(r.id, { description: '콘센트에서 타는 냄새가 나요' }, T)).toThrow(
      '긴급 증상에 대한 설명과 답변을 다시 확인해 주세요',
    )
    expect(p.updateRequest(r.id, { description: '콘센트 교체 2곳' }, T).description).toBe('콘센트 교체 2곳')
  })

  it('스냅샷: 분야 묶음·안전·검토 필드가 저장·복원되고, 어긋난 값은 거절된다', () => {
    const p = new PlatformService()
    const r = p.addRequest(
      { ...newRequest(), categories: ['급배수·누수·설비', '전기·조명'], desiredDate: T, safety: safe },
      T,
    )
    p.reviewRequest(
      r.id,
      { note: '현장 범위 확인', contactChecked: true, safetyDelivered: true, scopeChecked: true },
      'admin',
    )
    const raw = JSON.parse(JSON.stringify(p.snapshot())) as { store: { requests: Array<Record<string, unknown>> } }
    const loaded = new PlatformService()
    loaded.importSnapshot(JSON.stringify(raw))
    const back = loaded.store.get(r.id)!
    expect(back.categories).toEqual(['급배수·누수·설비', '전기·조명'])
    expect(back.safety).toEqual(safe)
    expect(back.reviewStatus).toBe('MANUAL_REVIEW')
    expect(back.review?.by).toBe('admin')
    const bad = (mut: (req: Record<string, unknown>) => void) => {
      const copy = structuredClone(raw)
      mut(copy.store.requests[0]!)
      return () => new PlatformService().importSnapshot(JSON.stringify(copy))
    }
    // 순서가 어긋나거나 중복된 묶음은 검증 전에 이전 단계가 바로잡는다 (주 분야가 첫 항목, 중복 제거)
    const fixed = (cats: string[]) => {
      const copy = structuredClone(raw)
      copy.store.requests[0]!.categories = cats
      const svc = new PlatformService()
      svc.importSnapshot(JSON.stringify(copy))
      return svc.store.get(r.id)!.categories
    }
    expect(fixed(['전기·조명', '급배수·누수·설비'])).toEqual(['급배수·누수·설비', '전기·조명'])
    expect(fixed(['급배수·누수·설비', '급배수·누수·설비'])).toBeUndefined()
    expect(bad((q) => (q.safety = { isLocked: 'no', urgent: null, ack: false }))).toThrow('safety')
    expect(bad((q) => (q.reviewStatus = 'PASSED'))).toThrow('reviewStatus')
    expect(bad((q) => (q.reviewFlags = ['FIRE']))).toThrow('reviewFlags')
    expect(bad((q) => (q.review = { at: 1, by: 'admin', note: '' }))).toThrow('review')
    // 28-92 이전: 옛 라벨이 든 묶음은 옮겨지고, 주 분야가 첫 항목이 된다
    const legacy = structuredClone(raw)
    legacy.store.requests[0]!.category = '전기'
    legacy.store.requests[0]!.categories = ['누수', '전기', '로봇 수리']
    const old = new PlatformService()
    old.importSnapshot(JSON.stringify(legacy))
    const moved = old.store.get(r.id)!
    expect(moved.category).toBe('전기·조명')
    expect(moved.categories).toEqual(['전기·조명', '급배수·누수·설비'])
  })
})

describe('28-94: 상세 주소·연락처 · 낙찰 전 파트너 가림', () => {
  const T = '2026-09-01'
  const full = () => ({
    ...newRequest(),
    customerName: '정지훈',
    address: '  화곡로 12길 34,   101동 202호 ',
    phone: '010-1234-5678',
    photos: [{ id: 'PH-1', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ', width: 10, height: 10, bytes: 100 }],
    desiredDate: T,
  })

  it('주소는 다듬어 저장하고 5자 미만·200자 초과는 거절, 연락처는 숫자만 남기고 010 규칙을 본다', () => {
    const p = new PlatformService()
    const r = p.addRequest(full(), T)
    expect(r.address).toBe('화곡로 12길 34, 101동 202호')
    expect(r.phone).toBe('01012345678')
    expect(() => p.addRequest({ ...full(), address: '서울' }, T)).toThrow('5자 이상')
    expect(() => p.addRequest({ ...full(), address: 'x'.repeat(201) }, T)).toThrow('200자 이하')
    expect(() => p.addRequest({ ...full(), phone: '02-123-4567' }, T)).toThrow('010으로 시작')
    // 둘 다 없으면 구 데이터와 같은 모양
    const plain = p.addRequest({ ...newRequest(), desiredDate: T }, T)
    expect(plain.address).toBeUndefined()
    expect(plain.phone).toBeUndefined()
  })

  it('maskName: 가운데를 *로 — 두 글자는 첫 글자 + *', () => {
    expect(maskName('정지훈')).toBe('정*훈')
    expect(maskName('김')).toBe('*')
    expect(maskName('이서')).toBe('이*')
    expect(maskName('남궁민수')).toBe('남**수')
  })

  it('requestForPartner: 낙찰 전에는 주소·연락처·사진이 없고 이름이 가려진다, 낙찰 파트너에게는 전부 열린다', () => {
    const p = new PlatformService()
    const r = p.addRequest(full(), T)
    const before = requestForPartner(r, 'AC-1')
    for (const k of PARTNER_PRIVATE_KEYS) expect(k in before).toBe(false)
    // #255 리뷰: 가림의 정의는 PARTNER_PRIVATE_KEYS 하나다 — 목록에 없는 키는 남는다(설명·지역·답변)
    expect(Object.keys(before).sort()).toEqual(
      Object.keys(r)
        .filter((k) => !(PARTNER_PRIVATE_KEYS as readonly string[]).includes(k))
        .sort(),
    )
    expect(before.customerName).toBe('정*훈')
    expect(before.description).toBe(r.description)
    p.submitEstimate(r.id, 'AC-1', ESTIMATE_INPUT, T)
    p.submitEstimate(r.id, 'AC-2', ESTIMATE_INPUT, T)
    p.acceptBid(r.id, 'AC-1')
    const awarded = p.store.get(r.id)!
    const mine = requestForPartner(awarded, 'AC-1')
    expect(mine.address).toBe('화곡로 12길 34, 101동 202호')
    expect(mine.phone).toBe('01012345678')
    expect(mine.photos?.length).toBe(1)
    expect(mine.customerName).toBe('정지훈')
    // 미낙찰 파트너에게는 여전히 가려진다
    const lost = requestForPartner(awarded, 'AC-2')
    expect(lost.address).toBeUndefined()
    expect(lost.customerName).toBe('정*훈')
  })

  it('반출: 본인 반출에는 주소·연락처가 있고, 파트너 반출·가명본에는 없다 (가명본은 전화번호 대조도 통과)', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...full(), customerId: 'AC-9' }, T)
    // 앱이 넘기는 계정 식별자 목록에 본인 번호(하이픈 형태)가 있어도 본인 반출은 막히지 않는다 — e2e가 잡았다
    p.extraNames = ['정지훈', '010-1234-5678', '반듯설비']
    const mine = JSON.parse(p.exportCustomerData('AC-9').json) as { requests: Array<Record<string, unknown>> }
    expect(mine.requests[0]).toMatchObject({ address: '화곡로 12길 34, 101동 202호', phone: '01012345678' })
    p.submitEstimate(r.id, 'AC-1', ESTIMATE_INPUT, T)
    const partner = p.exportPartnerData('AC-1').json
    expect(partner).not.toContain('화곡로')
    expect(partner).not.toContain('01012345678')
    const pseudo = p.exportBackup('pseudonymous').json
    expect(pseudo).not.toContain('화곡로')
    expect(pseudo).not.toContain('01012345678')
    expect(pseudo).not.toContain('정지훈')
  })

  it('스냅샷 검증: 짧은 주소·틀린 연락처는 거절', () => {
    const p = new PlatformService()
    p.addRequest(full(), T)
    const raw = JSON.parse(JSON.stringify(p.snapshot())) as { store: { requests: Array<Record<string, unknown>> } }
    const bad = (mut: (q: Record<string, unknown>) => void) => {
      const copy = structuredClone(raw)
      mut(copy.store.requests[0]!)
      return () => new PlatformService().importSnapshot(JSON.stringify(copy))
    }
    expect(bad((q) => (q.address = '서울'))).toThrow('address')
    expect(bad((q) => (q.phone = '0212345678'))).toThrow('phone')
    const ok = new PlatformService()
    ok.importSnapshot(JSON.stringify(raw))
    expect(ok.store.list()[0]!.phone).toBe('01012345678')
  })
})

describe('28-95: 계약서 · 수수료 조건 · 일정 변경 제안', () => {
  const T = '2026-09-01'
  const SCHED = { date: '2026-09-05', startHour: 14, endHour: 16 }
  const notes = (p: PlatformService) =>
    JSON.parse(p.exportData()).notifications as Array<{ role: string; accountId?: string; text: string }>

  it('계약서: 낙찰 파트너만, 낙찰 상태에서, 예약금은 총액 이하, 조건 필수, 일정 검증·휴무·충돌', () => {
    const { p, r } = driveToAccepted()
    const total = p.getEstimate(r.id)!.breakdown.total
    expect(() => p.proposeContract(r.id, 'P-999', { deposit: 0, terms: '조건', ...SCHED }, T)).toThrow('낙찰 파트너만')
    expect(() => p.proposeContract(r.id, 'P-001', { deposit: total + 1, terms: '조건', ...SCHED }, T)).toThrow('총액')
    expect(() => p.proposeContract(r.id, 'P-001', { deposit: -1, terms: '조건', ...SCHED }, T)).toThrow('0 이상')
    expect(() => p.proposeContract(r.id, 'P-001', { deposit: 0, terms: ' ', ...SCHED }, T)).toThrow('계약 조건')
    expect(() =>
      p.proposeContract(r.id, 'P-001', { deposit: 0, terms: '조건', date: '2026-08-31', startHour: 9, endHour: 12 }, T),
    ).toThrow('지난 날짜')
    p.setDaysOff('P-001', ['2026-09-06'])
    expect(() =>
      p.proposeContract(r.id, 'P-001', { deposit: 0, terms: '조건', date: '2026-09-06', startHour: 9, endHour: 12 }, T),
    ).toThrow('휴무')
    const c1 = p.proposeContract(r.id, 'P-001', { deposit: 30_000, terms: '자재 포함, 보증 1년', ...SCHED }, T)
    expect(c1).toMatchObject({
      id: 'CT-0001',
      version: 1,
      total,
      deposit: 30_000,
      commissionBps: 300,
      status: 'proposed',
    })
    expect(notes(p).some((n) => n.role === 'customer' && n.text.includes('계약서 v1이 도착'))).toBe(true)
    // 다시 내면 v2, 이전 제안은 superseded
    const c2 = p.proposeContract(r.id, 'P-001', { deposit: 20_000, terms: '자재 포함', ...SCHED }, T)
    expect(c2.version).toBe(2)
    expect(p.contractsFor(r.id).map((c) => c.status)).toEqual(['superseded', 'proposed'])
    expect(p.proposedContract(r.id)?.id).toBe(c2.id)
    // 계약서가 오간 요청은 직접 예약이 막힌다 — 수정 요청(declined)으로 끝난 뒤에도 (#257 리뷰)
    expect(() => p.scheduleVisit(r.id, SCHED)).toThrow('계약 동의로')
    p.decideContract(r.id, c2.id, false, T)
    expect(p.contractsFor(r.id).every((c) => c.status !== 'proposed')).toBe(true)
    expect(() => p.scheduleVisit(r.id, SCHED)).toThrow('계약 동의로')
    // 낙찰 상태가 아니면 발행 불가
    const other = new PlatformService()
    const r2 = other.addRequest(newRequest())
    expect(() => other.proposeContract(r2.id, 'P-001', { deposit: 0, terms: '조건', ...SCHED }, T)).toThrow('낙찰')
  })

  it('계약 결정: 거절 → declined + 파트너 알림, 동의 → 슬롯 생성·scheduled·예약금 = 계약 금액·수수료 = 계약 bps', () => {
    const { p, r } = driveToAccepted()
    const c1 = p.proposeContract(r.id, 'P-001', { deposit: 30_000, terms: '보증 1년', ...SCHED }, T)
    const declined = p.decideContract(r.id, c1.id, false, T)
    expect(declined.status).toBe('declined')
    expect(p.store.get(r.id)?.status).toBe('accepted')
    expect(notes(p).some((n) => n.role === 'partner' && n.text.includes('수정을 요청'))).toBe(true)
    expect(() => p.decideContract(r.id, c1.id, true, T)).toThrow('최신 계약서')
    const c2 = p.proposeContract(r.id, 'P-001', { deposit: 25_000, terms: '보증 1년, 자재 포함', ...SCHED }, T)
    const accepted = p.decideContract(r.id, c2.id, true, T)
    expect(accepted.status).toBe('accepted')
    expect(accepted.decidedAt).toMatch(/^\d{4}-/)
    expect(p.store.get(r.id)?.status).toBe('scheduled')
    expect(p.scheduleSlots.filter((s) => s.requestId === r.id)).toEqual([
      expect.objectContaining({ partnerId: 'P-001', date: '2026-09-05', startHour: 14, endHour: 16 }),
    ])
    expect(p.acceptedContract(r.id)?.id).toBe(c2.id)
    expect(notes(p).some((n) => n.role === 'partner' && n.text.includes('동의했습니다'))).toBe(true)
    expect(notes(p).some((n) => n.role === 'customer' && n.text.includes('예약금 25,000원'))).toBe(true)
    // 예약금은 계약의 금액 — 방문 예정(scheduled)에서 낸다
    expect(p.depositAmountFor(r.id)).toBe(25_000)
    expect(p.payDeposit(r.id, 'card').amount).toBe(25_000)
    // 두 번째 동의는 없다
    expect(() => p.proposeContract(r.id, 'P-001', { deposit: 0, terms: '조건', ...SCHED }, T)).toThrow('낙찰(accepted)')
    // 타임라인에 계약 이벤트
    expect(p.requestTimeline(r.id).map((e) => e.key)).toEqual(
      expect.arrayContaining(['contract', 'deposit', 'scheduled']),
    )
    // 수수료: 계약 bps로 — 관리자 조건 500bps를 먼저 정한 경우
    const { p: q, r: rq } = driveToAccepted()
    q.setCommissionTerms(rq.id, 500, '원거리 현장', 'admin')
    const cq = q.proposeContract(rq.id, 'P-001', { deposit: 0, terms: '조건', ...SCHED }, T)
    expect(cq.commissionBps).toBe(500)
    q.decideContract(rq.id, cq.id, true, T)
    expect(() => q.payDeposit(rq.id, 'card')).toThrow('예약금이 없는 계약')
    q.transitionRequest(rq.id, 'in_progress')
    // 28-96: 계약 경로 작업은 전/후 사진이 있어야 완료된다
    const shot = (id: string) => ({
      id,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      width: 640,
      height: 480,
      bytes: 1000,
    })
    q.setBeforePhotos(rq.id, 'P-001', [shot('b1')])
    q.setCompletionPhotos(rq.id, 'P-001', [shot('a1')])
    const job = q.completeJob(rq.id, '2026-09-06')
    expect(job.platformFee).toBe(Math.round((job.total * 500) / 10000))
  })

  it('수수료 조건: 낙찰 상태·동의 전에만, 0~10000, 사유 필수, 제안 중인 계약은 superseded, 운영 기록', () => {
    const { p, r } = driveToAccepted()
    expect(() => p.setCommissionTerms(r.id, 10001, '사유', 'admin')).toThrow('0~10000')
    expect(() => p.setCommissionTerms(r.id, 300, '', 'admin')).toThrow('사유')
    const c1 = p.proposeContract(r.id, 'P-001', { deposit: 0, terms: '조건', ...SCHED }, T)
    p.setCommissionTerms(r.id, 250, '단골 고객', 'admin')
    expect(p.contractsFor(r.id).find((c) => c.id === c1.id)?.status).toBe('superseded')
    expect(p.commissionBpsFor(r.id)).toBe(250)
    expect(p.auditLog().some((a) => a.action === '수수료 조건' && a.target === r.id)).toBe(true)
    const c2 = p.proposeContract(r.id, 'P-001', { deposit: 0, terms: '조건', ...SCHED }, T)
    p.decideContract(r.id, c2.id, true, T)
    expect(() => p.setCommissionTerms(r.id, 100, '사유', 'admin')).toThrow('동의된 계약')
  })

  it('일정 변경 제안: 담당 파트너·방문 예정에서, 사유 필수, 검증(과거·동일·휴무·충돌), 고객 승인/거절', () => {
    const { p, r } = driveToAccepted()
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    expect(() =>
      p.proposeSchedule(r.id, 'P-999', { date: '2026-09-08', startHour: 9, endHour: 12, reason: '지연' }, '2026-09-02'),
    ).toThrow('담당 파트너')
    expect(() =>
      p.proposeSchedule(r.id, 'P-001', { date: '2026-09-08', startHour: 9, endHour: 12, reason: ' ' }, '2026-09-02'),
    ).toThrow('사유')
    expect(() =>
      p.proposeSchedule(r.id, 'P-001', { date: '2026-09-05', startHour: 9, endHour: 12, reason: '지연' }, '2026-09-02'),
    ).toThrow('같은 일정')
    const s1 = p.proposeSchedule(
      r.id,
      'P-001',
      { date: '2026-09-08', startHour: 9, endHour: 12, reason: '앞 현장 지연' },
      '2026-09-02',
    )
    expect(s1).toMatchObject({ id: 'SC-0001', status: 'proposed' })
    expect(notes(p).some((n) => n.role === 'customer' && n.text.includes('일정 변경을 제안'))).toBe(true)
    // 거절: 슬롯 그대로
    p.decideSchedule(r.id, s1.id, false, '2026-09-02')
    expect(p.scheduleSlots.find((s) => s.requestId === r.id)?.date).toBe('2026-09-05')
    expect(notes(p).some((n) => n.role === 'partner' && n.text.includes('거절'))).toBe(true)
    // 새 제안 → 승인: 슬롯 교체 + rescheduleCount
    const s2 = p.proposeSchedule(
      r.id,
      'P-001',
      { date: '2026-09-09', startHour: 13, endHour: 15, reason: '자재' },
      '2026-09-02',
    )
    p.decideSchedule(r.id, s2.id, true, '2026-09-02')
    expect(p.scheduleSlots.find((s) => s.requestId === r.id)).toMatchObject({
      date: '2026-09-09',
      startHour: 13,
      endHour: 15,
    })
    expect(p.store.get(r.id)?.rescheduleCount).toBe(1)
    expect(p.scheduleChangesFor(r.id).map((c) => c.status)).toEqual(['rejected', 'approved'])
    expect(() => p.decideSchedule(r.id, s2.id, true, '2026-09-02')).toThrow('유효한')
    // #257 리뷰: 승인도 파트너에게 알린다 (새 일정 포함)
    expect(
      notes(p).some(
        (n) =>
          n.role === 'partner' &&
          n.accountId === 'P-001' &&
          n.text.includes('승인했습니다') &&
          n.text.includes('2026-09-09 13:00~15:00'),
      ),
    ).toBe(true)
  })

  it('스냅샷 왕복·검증, 가명본에는 조건·사유가 없다', () => {
    const { p, r } = driveToAccepted()
    p.setCommissionTerms(r.id, 400, '장거리 사유문', 'admin')
    const c = p.proposeContract(r.id, 'P-001', { deposit: 10_000, terms: '비밀 조건문', ...SCHED }, T)
    p.decideContract(r.id, c.id, true, T)
    p.proposeSchedule(r.id, 'P-001', { date: '2026-09-07', startHour: 9, endHour: 11, reason: '비밀 사유문' }, T)
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.acceptedContract(r.id)).toEqual(p.acceptedContract(r.id))
    expect(again.commissionTermsFor(r.id)?.bps).toBe(400)
    expect(again.proposedScheduleChange(r.id)?.reason).toBe('비밀 사유문')
    const pseudo = p.exportBackup('pseudonymous').json
    expect(pseudo).toContain('"commissionBps":400')
    expect(pseudo).not.toContain('비밀 조건문')
    expect(pseudo).not.toContain('비밀 사유문')
    expect(pseudo).not.toContain('장거리 사유문')
    const raw = JSON.parse(p.exportData()) as { contracts: Array<Record<string, unknown>> }
    raw.contracts.push({ ...raw.contracts[0]!, id: 'CT-9999' }) // 동의된 계약 둘
    expect(() => new PlatformService().importSnapshot(JSON.stringify(raw))).toThrow('동의된 계약이 2건')
    const bad = JSON.parse(p.exportData()) as { contracts: Array<Record<string, unknown>> }
    bad.contracts[0]!.deposit = 999_999_999
    expect(() => new PlatformService().importSnapshot(JSON.stringify(bad))).toThrow('금액')
  })
})

describe('28-96: 추가 공사 공급가+VAT · 작업 전/후 사진', () => {
  const T = '2026-09-01'
  const SCHED = { date: '2026-09-05', startHour: 14, endHour: 16 }
  const shot = (id: string) => ({
    id,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 640,
    height: 480,
    bytes: 1000,
  })

  it('추가 작업: 공급가를 주면 VAT 10%(반올림)를 얹어 amount = supply + vat, amount만 주는 구 호출은 그대로', () => {
    const { p, r } = driveToInProgress()
    const e = p.requestExtraWork(r.id, { supply: 70_000, memo: '곰팡이 제거' })
    expect(e).toMatchObject({ supply: 70_000, vat: 7_000, amount: 77_000 })
    const odd = p.requestExtraWork(r.id, { supply: 12_345, memo: '실리콘' })
    expect(odd).toMatchObject({ supply: 12_345, vat: 1_235, amount: 13_580 })
    expect(() => p.requestExtraWork(r.id, { supply: 0, memo: 'x' })).toThrow('공급가')
    const legacy = p.requestExtraWork(r.id, { amount: 50_000, memo: '구 호출' })
    expect(legacy.supply).toBeUndefined()
    expect(legacy.amount).toBe(50_000)
    expect(() => p.requestExtraWork(r.id, { memo: '금액 없음' })).toThrow('추가 작업 금액')
    const notes = JSON.parse(p.exportData()).notifications as Array<{ text: string }>
    expect(notes.some((n) => n.text.includes('+77,000원 (공급가 70,000원 + VAT 7,000원)'))).toBe(true)
    // 승인되면 최종 금액에 amount(VAT 포함)가 들어간다
    p.decideExtraWork(e.id, 'approved')
    p.decideExtraWork(odd.id, 'rejected')
    p.decideExtraWork(legacy.id, 'rejected')
    const job = p.completeJob(r.id, '2026-09-06')
    expect(job.extraTotal).toBe(77_000)
  })

  it('스냅샷 검증: 공급가·VAT·합계가 어긋나면 거절', () => {
    const { p, r } = driveToInProgress()
    p.requestExtraWork(r.id, { supply: 70_000, memo: '곰팡이 제거' })
    const raw = JSON.parse(p.exportData()) as { extraWorks: Array<Record<string, unknown>> }
    const bad = (mut: (e: Record<string, unknown>) => void) => {
      const copy = structuredClone(raw)
      mut(copy.extraWorks[0]!)
      return () => new PlatformService().importSnapshot(JSON.stringify(copy))
    }
    expect(bad((e) => (e.vat = 6_000))).toThrow('금액 불일치')
    expect(bad((e) => (e.amount = 70_000))).toThrow('금액 불일치')
    expect(bad((e) => (e.supply = -1))).toThrow('공급가·VAT')
    const ok = new PlatformService()
    ok.importSnapshot(JSON.stringify(raw))
    expect(ok.extraWorksFor(r.id)[0]).toMatchObject({ supply: 70_000, vat: 7_000, amount: 77_000 })
  })

  it('작업 전 사진: 낙찰 파트너만, 방문 예정부터 최종 결제 전까지, 용량·정리·개수에 포함', () => {
    const { p, r } = driveToAccepted()
    expect(() => p.setBeforePhotos(r.id, 'P-001', [shot('b1')])).toThrow('방문 예정')
    p.scheduleVisit(r.id, SCHED)
    expect(() => p.setBeforePhotos(r.id, 'P-999', [shot('b1')])).toThrow('낙찰 파트너만')
    expect(p.setBeforePhotos(r.id, 'P-001', [shot('b1'), shot('b2')]).beforePhotos).toHaveLength(2)
    expect(p.storageUsage().photoCount).toBe(2)
    p.setBeforePhotos(r.id, 'P-001', [])
    expect(p.store.get(r.id)?.beforePhotos).toBeUndefined()
    p.setBeforePhotos(r.id, 'P-001', [shot('b1')])
    // 계약 없는 구 경로는 사진 없이도 완료된다 (종전)
    p.transitionRequest(r.id, 'in_progress')
    p.completeJob(r.id, '2026-09-06')
    p.payFinal(r.id, 'card')
    expect(() => p.setBeforePhotos(r.id, 'P-001', [shot('b2')])).toThrow('최종 결제 후')
    // 정산·보관 기간 경과 → 전/후·현장 사진 모두 정리
    p.settle(r.id)
    expect(p.prunePhotos('2027-01-01')).toBe(1)
    expect(p.store.get(r.id)?.beforePhotos).toBeUndefined()
    // 본인 반출의 photoCount에 포함
    const again = driveToAccepted()
    again.p.scheduleVisit(again.r.id, SCHED)
    again.p.setBeforePhotos(again.r.id, 'P-001', [shot('b1')])
    const raw = JSON.parse(again.p.exportData()) as { store: { requests: Array<{ customerId?: string }> } }
    void raw
  })

  it('계약 경로 작업은 전/후 사진이 각 1장 이상 있어야 완료된다', () => {
    const { p, r } = driveToAccepted()
    const c = p.proposeContract(r.id, 'P-001', { deposit: 0, terms: '조건', ...SCHED }, T)
    p.decideContract(r.id, c.id, true, T)
    p.transitionRequest(r.id, 'in_progress')
    expect(() => p.completeJob(r.id, '2026-09-06')).toThrow('작업 전 사진과 완료 사진')
    p.setBeforePhotos(r.id, 'P-001', [shot('b1')])
    expect(() => p.completeJob(r.id, '2026-09-06')).toThrow('작업 전 사진과 완료 사진')
    p.setCompletionPhotos(r.id, 'P-001', [shot('a1')])
    expect(p.completeJob(r.id, '2026-09-06').requestId).toBe(r.id)
    expect(p.store.get(r.id)?.status).toBe('completed')
  })
})

describe('28-97: 결제 멱등 키 · 부분 환불 · 정산 = 총액 − 환불 − 수수료', () => {
  const ACC = '국민은행 123****890 (김반듯)'

  it('결제 준비 → 승인: 주문번호 발급, 같은 주문 재승인은 멱등, 다른 키·금액 불일치·실패 주문·중복 키는 거부', () => {
    const { p, r } = driveToAccepted()
    const prep = p.preparePayment(r.id, 'deposit', 'card')
    expect(prep.status).toBe('ready')
    expect(prep.orderId).toMatch(/^BD-REQ-\d{4}-deposit-\d{4}$/)
    // 같은 요청·종류·금액·수단의 준비는 같은 주문을 돌려준다 — 결제창을 다시 열어도 주문이 늘지 않는다
    expect(p.preparePayment(r.id, 'deposit', 'card').orderId).toBe(prep.orderId)
    expect(p.paymentFor(r.id, 'deposit')).toBeUndefined() // ready는 아직 결제가 아니다
    expect(() => p.confirmPayment(prep.orderId, { providerKey: 'tk_1', amount: prep.amount + 1 })).toThrow(
      '결제 금액 불일치',
    )
    const done = p.confirmPayment(prep.orderId, { providerKey: 'tk_1', amount: prep.amount })
    expect(done.status).toBe('done')
    expect(p.paymentFor(r.id, 'deposit')?.id).toBe(done.id)
    // 승인 재시도(같은 키)는 같은 결제를 돌려주고 아무것도 늘리지 않는다
    expect(p.confirmPayment(prep.orderId, { providerKey: 'tk_1', amount: prep.amount }).id).toBe(done.id)
    expect(p.paymentsFor(r.id)).toHaveLength(1)
    expect(() => p.confirmPayment(prep.orderId, { providerKey: 'tk_2', amount: prep.amount })).toThrow('다른 승인 키')
    expect(() => p.confirmPayment('BD-none', { providerKey: 'tk_3', amount: 1 })).toThrow('주문번호')
    expect(() => p.preparePayment(r.id, 'deposit', 'card')).toThrow('이미 예약금')
    // 실패한 주문은 승인되지 않고, 새 준비는 새 주문이다
    p.scheduleVisit(r.id, { date: '2026-09-05', startHour: 9, endHour: 12 })
    p.transitionRequest(r.id, 'in_progress')
    p.completeJob(r.id, '2026-09-06')
    const fin = p.preparePayment(r.id, 'final', 'card')
    expect(p.failPayment(fin.orderId, '사용자 취소').status).toBe('failed')
    expect(p.failPayment(fin.orderId, '재시도').status).toBe('failed') // 멱등
    expect(() => p.confirmPayment(fin.orderId, { providerKey: 'tk_4', amount: fin.amount })).toThrow('실패한 주문')
    const fin2 = p.preparePayment(r.id, 'final', 'transfer')
    expect(fin2.orderId).not.toBe(fin.orderId)
    expect(() => p.confirmPayment(fin2.orderId, { providerKey: 'tk_1', amount: fin2.amount })).toThrow(
      '다른 주문에 쓰인',
    )
    p.confirmPayment(fin2.orderId, { providerKey: 'tk_9', amount: fin2.amount })
    expect(() => p.failPayment(fin2.orderId, '늦은 실패')).toThrow('이미 승인된')
    expect(p.paymentsFor(r.id).map((x) => x.status)).toEqual(['done', 'failed', 'done'])
    expect(p.settle(r.id).status).toBe('settled')
    // 로컬 기록 결제도 같은 수명주기를 탄다 — 주문번호와 local 승인 키
    const q = driveToAccepted()
    const d = q.p.payDeposit(q.r.id, 'card')
    expect(d).toMatchObject({ status: 'done', providerKey: `local:${d.orderId}` })
  })

  it('준비된 주문은 승인 전에 거래가 바뀌면(취소) 실패로 남고 결제되지 않는다', () => {
    const { p, r } = driveToAccepted()
    const prep = p.preparePayment(r.id, 'deposit', 'card')
    p.transitionRequest(r.id, 'cancelled')
    expect(() => p.confirmPayment(prep.orderId, { providerKey: 'tk_late', amount: prep.amount })).toThrow(
      '승인할 수 없습니다',
    )
    expect(p.paymentsFor(r.id)[0]?.status).toBe('failed')
    expect(p.paymentFor(r.id, 'deposit')).toBeUndefined()
    expect(p.refundFor(r.id)).toBeUndefined() // 결제된 적이 없으니 환불도 없다
  })

  it('부분 환불: 완료 거래(지급 전)에만, 잔액 한도, 대기 중엔 정산·지급 보류, 완료되면 수수료·지급액 재산정', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    expect(() => p.requestRefund(r.id, { amount: 20_000, reason: '파손 보상' })).toThrow('환불할 결제가 없습니다')
    p.payFinal(r.id, 'card')
    const job = p.jobFor(r.id)!
    const feeAt = (base: number) => Math.round((base * 300) / 10000)
    expect(job.platformFee).toBe(feeAt(job.total))
    expect(() => p.requestRefund(r.id, { amount: 0, reason: '없음' })).toThrow('환불 금액')
    expect(() => p.requestRefund(r.id, { amount: 1_000, reason: 'x' })).toThrow('환불 사유')
    expect(() => p.requestRefund(r.id, { amount: job.total + 1, reason: '과다 환불' })).toThrow('환불 가능 금액')
    const rf = p.requestRefund(r.id, { amount: 20_000, reason: '타일 파손 보상' })
    expect(rf).toMatchObject({ status: 'pending', amount: 20_000, deduction: 0, afterVisit: false })
    expect(() => p.requestRefund(r.id, { amount: 1_000, reason: '또 하나' })).toThrow('처리 대기 중인 환불')
    expect(() => p.settle(r.id)).toThrow('환불 대기')
    expect(p.paymentFor(r.id, 'final')).toBeDefined() // 부분 환불은 결제를 지우지 않는다
    expect(p.notificationsFor('customer').some((n) => n.text.includes('환불 등록') && n.text.includes('20,000'))).toBe(
      true,
    )
    p.settleRefund(rf.id)
    expect(p.jobFor(r.id)).toMatchObject({ refunded: 20_000, platformFee: feeAt(job.total - 20_000) })
    expect(p.settlementFor(r.id)).toEqual({
      gross: job.total,
      refunded: 20_000,
      pendingRefund: 0,
      fee: feeAt(job.total - 20_000),
      bps: 300,
      payable: job.total - 20_000 - feeAt(job.total - 20_000),
    })
    p.settle(r.id)
    const rf2 = p.requestRefund(r.id, { amount: 5_000, reason: '추가 보상' })
    expect(p.settlementFor(r.id)?.pendingRefund).toBe(5_000)
    expect(() => p.markPayout(r.id, ACC)).toThrow('환불 대기')
    p.settleRefund(rf2.id)
    const fee = feeAt(job.total - 25_000)
    expect(p.pendingPayoutAmount()).toBe(job.total - 25_000 - fee)
    const paid = p.markPayout(r.id, ACC)
    expect(paid.payout).toMatchObject({ amount: job.total - 25_000 - fee, refunded: 25_000, fee })
    expect(() => p.requestRefund(r.id, { amount: 1_000, reason: '지급 뒤' })).toThrow('이미 지급된')
    // 원장: 환불 행 둘(음수), 수수료 행은 재산정 금액과 실제 요율
    const rows = p.ledger()
    expect(rows.filter((x) => x.type === '환불').map((x) => x.amount)).toEqual([-20_000, -5_000])
    const feeRow = rows.find((x) => x.type === '플랫폼수수료')!
    expect(feeRow.amount).toBe(fee)
    expect(feeRow.memo).toContain('3%')
    expect(feeRow.memo).toContain((job.total - 25_000).toLocaleString('ko-KR'))
    expect(p.partnerLedger('P-001')[0]).toMatchObject({ fee, payout: job.total - 25_000 - fee })
    expect(p.ledgerSummary().outflow).toBe(25_000 + (job.total - 25_000 - fee))
    // 왕복
    const again = new PlatformService()
    again.importSnapshot(p.exportData())
    expect(again.jobFor(r.id)).toMatchObject({ refunded: 25_000, platformFee: fee })
  })

  it('가명본·본인 반출에 주문번호·상태는 남고 승인 키는 빠진다; 구 스냅샷은 done/LEGACY로 올라온다; 손상 거부', () => {
    const p = new PlatformService()
    const r = p.addRequest({ ...newRequest(), customerId: 'AC-0001' })
    p.submitEstimate(r.id, 'P-001', ESTIMATE_INPUT)
    p.transitionRequest(r.id, 'accepted')
    p.payDeposit(r.id, 'card')
    const pseudo = JSON.parse(p.exportBackup('pseudonymous').json) as { payments: Array<Record<string, unknown>> }
    expect(pseudo.payments[0]).toMatchObject({ status: 'done', orderId: expect.stringMatching(/^BD-/) })
    expect(pseudo.payments[0]?.['providerKey']).toBeUndefined()
    const mine = JSON.parse(p.exportCustomerData('AC-0001').json) as { payments: Array<Record<string, unknown>> }
    expect(mine.payments[0]).toMatchObject({ status: 'done', orderId: expect.stringMatching(/^BD-/) })
    expect(mine.payments[0]?.['providerKey']).toBeUndefined()
    // 구 스냅샷(28-96 이전): status·orderId 없음 → done / LEGACY-<id>
    const raw = JSON.parse(p.exportData()) as { payments: Array<Record<string, unknown>>; jobs?: unknown[] }
    const legacy = structuredClone(raw)
    delete legacy.payments[0]!['status']
    delete legacy.payments[0]!['orderId']
    delete legacy.payments[0]!['providerKey']
    const again = new PlatformService()
    again.importSnapshot(JSON.stringify(legacy))
    expect(again.paymentsFor(r.id)[0]).toMatchObject({ status: 'done', orderId: 'LEGACY-PAY-0001' })
    expect(again.paymentFor(r.id, 'deposit')).toBeDefined()
    const bad = (mut: (s: typeof raw) => void, msg: string) => {
      const copy = structuredClone(raw)
      mut(copy)
      expect(() => new PlatformService().importSnapshot(JSON.stringify(copy))).toThrow(msg)
    }
    bad((s) => (s.payments[0]!['status'] = 'paid'), 'payments[0].status')
    bad((s) => (s.payments[0]!['orderId'] = 7), 'payments[0].orderId')
    bad((s) => s.payments.push({ ...s.payments[0]!, id: 'PAY-0002' }), 'orderId 중복')
  })

  it('스냅샷 검증: 완료 작업의 환불 누계는 0 이상 총액 이하의 정수다', () => {
    const { p, r } = driveToInProgress()
    p.completeJob(r.id, '2026-09-06')
    const raw = JSON.parse(p.exportData()) as { jobs: Array<Record<string, unknown>> }
    const bad = (v: unknown) => {
      const copy = structuredClone(raw)
      copy.jobs[0]!['refunded'] = v
      return () => new PlatformService().importSnapshot(JSON.stringify(copy))
    }
    expect(bad(-1)).toThrow('jobs[0].refunded')
    expect(bad(1.5)).toThrow('jobs[0].refunded')
    expect(bad((raw.jobs[0]!['total'] as number) + 1)).toThrow('jobs[0].refunded')
    const ok = new PlatformService()
    raw.jobs[0]!['refunded'] = 1_000
    ok.importSnapshot(JSON.stringify(raw))
    expect(ok.jobFor(r.id)?.refunded).toBe(1_000)
  })
})
