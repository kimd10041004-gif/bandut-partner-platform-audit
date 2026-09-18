import { describe, it, expect } from 'vitest'
import { RequestStore, RequestNotFoundError, DateFormatError } from './store'
import { InvalidTransitionError } from './jobStatus'

function newRequest() {
  return {
    customerName: '김반듯',
    region: '서울 강서구',
    category: '급배수·누수·설비' as const,
    description: '욕실 천장 누수',
    desiredDate: '2026-09-05',
  }
}

describe('RequestStore', () => {
  it('요청을 추가하면 requested 상태와 순번 ID가 부여된다', () => {
    const store = new RequestStore()
    const r1 = store.add(newRequest())
    const r2 = store.add(newRequest())
    expect(r1.id).toBe('REQ-0001')
    expect(r2.id).toBe('REQ-0002')
    expect(r1.status).toBe('requested')
  })

  it('달력에 없는 desiredDate를 거부한다 (28-1-06)', () => {
    const store = new RequestStore()
    expect(() => store.add({ ...newRequest(), desiredDate: '2026-02-31' })).toThrow(DateFormatError)
    expect(() => store.add({ ...newRequest(), desiredDate: '내일' })).toThrow(DateFormatError)
    expect(() => store.add({ ...newRequest(), desiredDate: '2026/09/05' })).toThrow(DateFormatError)
    expect(store.size).toBe(0)
  })

  it('상태 전이 규칙을 강제한다', () => {
    const store = new RequestStore()
    const r = store.add(newRequest())
    expect(store.updateStatus(r.id, 'estimated').status).toBe('estimated')
    expect(() => store.updateStatus(r.id, 'completed')).toThrow(InvalidTransitionError)
  })

  it('없는 요청의 상태 변경은 RequestNotFoundError (28-1-07)', () => {
    const store = new RequestStore()
    expect(() => store.updateStatus('REQ-9999', 'estimated')).toThrow(RequestNotFoundError)
    // 전이 규칙 위반과 타입으로 구분 가능해야 한다
    try {
      store.updateStatus('REQ-9999', 'estimated')
    } catch (err) {
      expect(err).not.toBeInstanceOf(InvalidTransitionError)
    }
  })

  it('상태별 필터 목록을 반환한다', () => {
    const store = new RequestStore()
    const r1 = store.add(newRequest())
    store.add(newRequest())
    store.updateStatus(r1.id, 'estimated')
    expect(store.list('requested')).toHaveLength(1)
    expect(store.list('estimated')).toHaveLength(1)
    expect(store.list()).toHaveLength(2)
  })

  it('반환 객체를 수정해도 내부 상태가 바뀌지 않는다 (방어적 복사)', () => {
    const store = new RequestStore()
    const r = store.add(newRequest())
    r.status = 'settled'
    expect(store.get(r.id)!.status).toBe('requested')
    const listed = store.list()[0]!
    listed.customerName = '변조'
    expect(store.get(r.id)!.customerName).toBe('김반듯')
  })
})

describe('snapshot/restore (28-3-01)', () => {
  it('스냅샷 복원 후 상태와 ID 순번이 유지된다', () => {
    const store = new RequestStore()
    const r1 = store.add(newRequest())
    store.updateStatus(r1.id, 'estimated')
    const snap = store.snapshot()

    const restored = new RequestStore()
    restored.restore(snap)
    expect(restored.get(r1.id)!.status).toBe('estimated')
    expect(restored.add(newRequest()).id).toBe('REQ-0002')
  })

  it('스냅샷은 방어적 복사본이다', () => {
    const store = new RequestStore()
    const r1 = store.add(newRequest())
    const snap = store.snapshot()
    snap.requests[0]!.customerName = '변조'
    expect(store.get(r1.id)!.customerName).toBe('김반듯')
  })
})
