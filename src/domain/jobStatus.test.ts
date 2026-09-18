import { describe, it, expect } from 'vitest'
import { canTransition, transition, nextStatuses, isTerminal, InvalidTransitionError } from './jobStatus'
import type { JobStatus } from './types'

describe('상태 전이', () => {
  it('정상 흐름 전체를 통과한다', () => {
    const flow: JobStatus[] = ['requested', 'estimated', 'accepted', 'scheduled', 'in_progress', 'completed', 'settled']
    for (let i = 0; i < flow.length - 1; i++) {
      expect(transition(flow[i]!, flow[i + 1]!)).toBe(flow[i + 1])
    }
  })

  it('단계 건너뛰기를 금지한다', () => {
    expect(canTransition('requested', 'accepted')).toBe(false)
    expect(canTransition('estimated', 'in_progress')).toBe(false)
    expect(() => transition('requested', 'completed')).toThrow(InvalidTransitionError)
  })

  it('역방향 전이를 금지한다', () => {
    expect(canTransition('completed', 'in_progress')).toBe(false)
    expect(canTransition('accepted', 'estimated')).toBe(false)
  })

  it('시공 중에는 취소할 수 없다', () => {
    expect(canTransition('in_progress', 'cancelled')).toBe(false)
  })

  it('시공 전 단계에서는 취소할 수 있다', () => {
    for (const s of ['requested', 'estimated', 'accepted', 'scheduled'] as const) {
      expect(canTransition(s, 'cancelled')).toBe(true)
    }
  })

  it('종결 상태에서는 어떤 전이도 불가하다', () => {
    expect(isTerminal('settled')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('lost')).toBe(true)
    expect(nextStatuses('settled')).toHaveLength(0)
    expect(nextStatuses('cancelled')).toHaveLength(0)
    expect(nextStatuses('lost')).toHaveLength(0)
  })

  it('미낙찰(lost)은 입찰 중(estimated)에서만 가능하다 (28-6-01)', () => {
    expect(canTransition('estimated', 'lost')).toBe(true)
    expect(canTransition('requested', 'lost')).toBe(false)
    expect(canTransition('accepted', 'lost')).toBe(false)
    expect(canTransition('scheduled', 'lost')).toBe(false)
  })

  it('자기 자신으로의 전이는 금지한다', () => {
    expect(canTransition('requested', 'requested')).toBe(false)
  })
})
