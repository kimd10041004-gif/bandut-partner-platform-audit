import { useState } from 'react'
import type { RepairCategory } from '../domain/types'
import { SERVICE_GROUPS, UNKNOWN_CATEGORY, catalogEntry } from '../domain/catalog'

/**
 * 분야 고르기 (28-92, 참고 v12 `ServiceChoices`). 그룹 탭으로 좁히고 카드 하나를 고른다(`multi`면 여러 개).
 * 홈 히어로(바로 접수)·요청 위저드·파트너 프로필(전문 분야)이 같은 부품을 쓴다 — 고객이 고르는 분야와
 * 파트너가 내거는 분야가 같은 목록·같은 이름이어야 매칭이 맞는다.
 */
export default function CategoryPicker({
  categories,
  selected,
  onPick,
  multi = false,
  groups = true,
  compact = false,
}: {
  /** 고를 수 있는 분야 — 보통 `platform.enabledCategories()` */
  categories: readonly RepairCategory[]
  selected: readonly RepairCategory[]
  onPick: (c: RepairCategory) => void
  multi?: boolean
  /** 그룹 탭 표시 */
  groups?: boolean
  /** 설명 없이 이름만(칩) */
  compact?: boolean
}) {
  const [group, setGroup] = useState<string>('전체')
  const groupNames = SERVICE_GROUPS.filter((g) => g.labels.some((l) => categories.includes(l))).map((g) => g.name)
  const visible = categories.filter((c) => {
    if (group === '전체' || c === UNKNOWN_CATEGORY) return true
    return SERVICE_GROUPS.find((g) => g.name === group)?.labels.includes(c) === true
  })
  return (
    <div className="cat-picker" data-cat-picker={multi ? 'multi' : 'single'}>
      {groups && groupNames.length > 1 && (
        <div className="filter-group cat-groups" role="group" aria-label="작업 분야 그룹">
          {['전체', ...groupNames].map((name) => (
            <button
              key={name}
              type="button"
              className={group === name ? 'active' : ''}
              aria-pressed={group === name}
              onClick={() => setGroup(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className={`cat-grid ${compact ? 'compact' : ''}`}>
        {visible.map((c) => {
          const picked = selected.includes(c)
          return (
            <button
              key={c}
              type="button"
              className={`cat-card ${picked ? 'active' : ''}`}
              aria-pressed={picked}
              data-category={c}
              onClick={() => onPick(c)}
            >
              <strong>{c}</strong>
              {!compact && <small>{catalogEntry(c).desc}</small>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
