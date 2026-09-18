import type { JobStatus, RepairCategory } from '../domain/types'
import { ALL_CATEGORIES } from '../domain/types'

/** 상태 → 한국어 라벨 (시안 용어 기준) */
export const STATUS_LABEL: Record<JobStatus, string> = {
  requested: '입찰 가능',
  estimated: '입찰 중',
  accepted: '낙찰',
  scheduled: '방문 예정',
  in_progress: '시공 중',
  completed: '작업 완료',
  settled: '정산 완료',
  lost: '미낙찰',
  cancelled: '취소',
}

export const CATEGORIES: RepairCategory[] = ALL_CATEGORIES

export const CLAIM_STATUS_LABEL = { open: '접수됨', in_review: '검토 중', resolved: '해결됨' } as const

/** 결제 라벨 (28-29) */
export const PAY_KIND_LABEL = { deposit: '예약금', final: '최종 결제' } as const
export const PAY_METHOD_LABEL = { card: '카드', transfer: '계좌이체' } as const
