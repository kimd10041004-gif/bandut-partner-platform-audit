import type { RepairCategory } from '../domain/types'

/** 홈페이지 → 작업 올리기 위저드로의 카테고리 사전 선택 전달 (28-16-02) */
let draftCategory: RepairCategory | null = null

export function setDraftCategory(c: RepairCategory) {
  draftCategory = c
}

export function takeDraftCategory(): RepairCategory | null {
  const c = draftCategory
  draftCategory = null
  return c
}
