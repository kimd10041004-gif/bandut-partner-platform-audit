import { describe, it, expect } from 'vitest'
import { ALL_CATEGORIES } from './types'
import {
  CATALOG,
  SERVICE_GROUPS,
  UNKNOWN_CATEGORY,
  LEGACY_CATEGORY_MAP,
  normalizeCategory,
  catalogEntry,
  groupOf,
  DISTRICTS,
  CITIES,
  formatRegion,
  parseRegion,
} from './catalog'

describe('서비스 카탈로그 (28-92)', () => {
  it('카탈로그·타입 목록·그룹이 같은 집합을 말한다 — 하나가 늘면 셋이 함께 는다', () => {
    expect(CATALOG.map((e) => e.label)).toEqual(ALL_CATEGORIES)
    expect(new Set(CATALOG.map((e) => e.code)).size).toBe(CATALOG.length)
    const grouped = SERVICE_GROUPS.flatMap((g) => g.labels)
    expect(new Set(grouped).size).toBe(grouped.length) // 한 분야가 두 그룹에 들어가지 않는다
    expect([...grouped, UNKNOWN_CATEGORY].sort()).toEqual([...ALL_CATEGORIES].sort())
    expect(ALL_CATEGORIES[ALL_CATEGORIES.length - 1]).toBe(UNKNOWN_CATEGORY)
    expect(groupOf(UNKNOWN_CATEGORY)).toBeUndefined()
    expect(groupOf('급배수·누수·설비')).toBe('설비·전기·기기')
    expect(catalogEntry('청소·공간 관리').code).toBe('MAINTENANCE')
  })

  it('옛 라벨 13개는 전부 현재 라벨로 옮겨지고, 현재 라벨은 그대로, 모르는 값은 undefined', () => {
    expect(Object.keys(LEGACY_CATEGORY_MAP)).toHaveLength(13)
    for (const [legacy, now] of Object.entries(LEGACY_CATEGORY_MAP)) {
      expect(ALL_CATEGORIES).toContain(now)
      expect(normalizeCategory(legacy)).toBe(now)
      expect(normalizeCategory(` ${legacy} `)).toBe(now)
    }
    expect(normalizeCategory('누수')).toBe('급배수·누수·설비') // 수정 전: 라벨 13개뿐이라 옮길 곳이 없었다
    expect(normalizeCategory('기타')).toBe(UNKNOWN_CATEGORY)
    for (const c of ALL_CATEGORIES) expect(normalizeCategory(c)).toBe(c)
    expect(normalizeCategory('로봇 수리')).toBeUndefined()
    expect(normalizeCategory(42)).toBeUndefined()
  })
})

describe('전국 시·도 (28-92)', () => {
  it('17개 시·도, 시·군·구는 비어 있지 않고 시·도 안에서 중복이 없다', () => {
    expect(CITIES).toHaveLength(17)
    expect(CITIES[0]).toBe('서울')
    for (const [city, list] of Object.entries(DISTRICTS)) {
      expect(list.length, city).toBeGreaterThan(0)
      expect(new Set(list).size, city).toBe(list.length)
      for (const d of list) expect(d, `${city} ${d}`).toMatch(/(구|시|군)$/)
    }
    expect(DISTRICTS['세종']).toEqual(['세종시'])
  })

  it('formatRegion·parseRegion이 왕복하고, 목록 밖·자유 입력은 undefined', () => {
    expect(formatRegion('서울', '강서구')).toBe('서울 강서구')
    expect(parseRegion('서울 강서구')).toEqual({ city: '서울', district: '강서구' })
    expect(parseRegion('  경기  고양시 ')).toEqual({ city: '경기', district: '고양시' })
    expect(parseRegion('서울 강서구 화곡동')).toBeUndefined() // 상세 주소는 지역이 아니다
    expect(parseRegion('서울특별시 강서구')).toBeUndefined() // 옛 자유 입력 — 화면이 다시 고르게 한다
    expect(parseRegion('서울')).toBeUndefined()
    expect(parseRegion('부산 강서구')).toEqual({ city: '부산', district: '강서구' }) // 같은 구 이름도 시·도가 가른다
  })
})
