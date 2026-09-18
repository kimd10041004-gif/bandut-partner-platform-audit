import type { ReactNode } from 'react'
import type { JobStatus } from '../domain/types'
import type { TimelineEvent } from '../domain/platform'
import { STATUS_LABEL } from './constants'
import { Icon } from './icons'

/** 카드 컨테이너 (28-13-02): 레시피의 부품화 — 제목은 선택 */
export function Card({ title, className, children }: { title?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={className ? `card ${className}` : 'card'}>
      {title !== undefined && <h3>{title}</h3>}
      {children}
    </div>
  )
}

/** 지표 타일 (28-13-02): 대시보드 stat-grid의 부품화 */
export function Stat({
  tone,
  accent = false,
  icon,
  label,
  children,
}: {
  tone: 'green' | 'blue' | 'amber' | 'brand'
  accent?: boolean
  icon: string
  label: string
  children: ReactNode
}) {
  // 28-18-02: 당근 문법 — 아이콘 칩 없이 라벨+숫자. icon/tone은 API 호환 위해 유지(미사용).
  void icon
  void tone
  return (
    <div className={`stat${accent ? ' accent' : ''}`}>
      <span className="label">{label}</span>
      <div className="value">{children}</div>
    </div>
  )
}

/** 상태 컬러 칩 (시안 상태 가이드) */
export function StatusChip({ status }: { status: JobStatus }) {
  return <span className={`chip st-${status}`}>{STATUS_LABEL[status]}</span>
}

/** 진행 단계 스텝퍼 (28-8-01): 낙찰 → 방문 예정 → 시공 중 → 작업 완료 → 정산 완료 */
export const WORK_STEPS: JobStatus[] = ['accepted', 'scheduled', 'in_progress', 'completed', 'settled']

export function WorkStepper({ status }: { status: JobStatus }) {
  const current = WORK_STEPS.indexOf(status)
  if (current < 0) return null
  return (
    <div className="stepper">
      {WORK_STEPS.map((step, i) => (
        <div key={step} className={`step ${i < current ? 'done' : ''} ${i === current ? 'now' : ''}`}>
          <span className="dot">{i < current ? '✓' : i + 1}</span>
          <span className="step-label">{STATUS_LABEL[step]}</span>
        </div>
      ))}
    </div>
  )
}

/** 빈 상태 (28-9-05): 아이콘 + 제목 + 안내 */
export function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="empty card">
      <div className="empty-icon">
        <Icon d={icon} size={22} />
      </div>
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
    </div>
  )
}

/** 입찰 마감 D-day (28-7-04): D-2 이하 주황, 마감 빨강 */
export function Dday({ deadline, today }: { deadline: string | undefined; today: string }) {
  if (!deadline) return null
  const diff = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
  const label = diff < 0 ? '마감' : diff === 0 ? 'D-Day' : `D-${diff}`
  const cls = diff < 0 ? 'dday closed' : diff <= 2 ? 'dday urgent' : 'dday'
  return <span className={cls}>{label}</span>
}

/** 거래 진행 타임라인 (28-15-03): requestTimeline() 파생 이벤트를 세로로 렌더 */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="timeline">
      {events.map((e) => (
        <div key={e.key} className={`tl-item ${e.done ? 'done' : ''}`}>
          <span className="tl-dot">{e.done ? '✓' : ''}</span>
          <span className="tl-label">{e.label}</span>
          {e.date && <span className="tl-date">{e.date}</span>}
        </div>
      ))}
    </div>
  )
}

/** 별점 표시 (28-17-02): 채워진 별 + 흐린 별 */
export function Stars({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)))
  return (
    <span className="stars" aria-label={`별점 ${rating}점`}>
      {'★'.repeat(filled)}
      <span className="stars-off">{'★'.repeat(5 - filled)}</span>
    </span>
  )
}

/**
 * 토글 그룹 (28-62-03): 선택 상태를 눈에만 보이게 두지 않는다 —
 * `role="group"` + 이름, 각 버튼 `aria-pressed`. 모양은 기존 `.filter-group` 그대로.
 * 옵션이 `data` 속성을 실어 나르므로 e2e 선택자는 바뀌지 않는다.
 */
type ToggleGroupBase<T extends string> = {
  label: string
  options: Array<{ value: T; label: string; data?: Record<string, string> }>
  className?: string
  style?: React.CSSProperties
  buttonStyle?: React.CSSProperties
}

/**
 * 해제 가능 여부에 따라 값·콜백 타입이 갈린다 (28-63-03) —
 * 해제 그룹만 빈 문자열을 다루므로, 일반 필터 호출부가 `''`를 신경 쓸 일이 없다.
 */
type ToggleGroupProps<T extends string> = ToggleGroupBase<T> &
  (
    | { deselectable?: false; value: T; onChange: (next: T) => void }
    | { deselectable: true; value: T | ''; onChange: (next: T | '') => void }
  )

export function ToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  style,
  buttonStyle,
  deselectable = false,
}: ToggleGroupProps<T>) {
  return (
    <span className={`filter-group${className ? ` ${className}` : ''}`} role="group" aria-label={label} style={style}>
      {options.map((o) => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            className={on ? 'active' : ''}
            aria-pressed={on}
            style={buttonStyle}
            onClick={() => (onChange as (next: T | '') => void)(on && deselectable ? '' : o.value)}
            {...(o.data ?? {})}
          >
            {o.label}
          </button>
        )
      })}
    </span>
  )
}
