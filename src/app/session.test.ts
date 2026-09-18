import { describe, it, expect } from 'vitest'
import { TokenStore, SESSION_STORAGE_KEY } from './session'
import type { StorageLike } from '../domain/platform'

function mem(): StorageLike {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}

/** 28-71: 토큰은 브라우저의 것 — 탭마다 하나인 인스턴스가 낡은 토큰으로 세션을 되살리면 안 된다 */
describe('TokenStore — 탭 사이 (28-71)', () => {
  it('탭1이 지운 토큰을 탭2가 더는 모른다', () => {
    const storage = mem()
    const tab1 = new TokenStore(storage)
    const tab2 = new TokenStore(storage)
    tab1.set('partner', 'tok-1')
    expect(tab2.for('partner')).toBe('tok-1')
    tab1.clear('partner')
    expect(tab2.for('partner')).toBeNull() // 수정 전: 'tok-1' (메모리 사본) → me → 세션 부활
    expect(tab2.roles()).toEqual([])
    expect(tab2.any()).toBeNull()
  })

  it('저장소가 없으면 메모리에만 — 그래도 동작한다', () => {
    const t = new TokenStore(undefined)
    t.set('admin', 'x')
    expect(t.any()).toBe('x')
    t.clear('admin')
    expect(t.for('admin')).toBeNull()
  })

  it('저장소가 손상돼도 비운다', () => {
    const storage = mem()
    storage.setItem(SESSION_STORAGE_KEY, '{손상')
    expect(new TokenStore(storage).roles()).toEqual([])
  })
})
