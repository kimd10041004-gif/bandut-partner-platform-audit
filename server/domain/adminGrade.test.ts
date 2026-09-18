import { describe, it, expect } from 'vitest'
import { canAdmin, isAdminGrade, ADMIN_GRADES, ADMIN_MIN_GRADE, ADMIN_ID_RE, type AdminAction } from './adminGrade'

/**
 * 관리자 등급 표 (28-89-A) — 이 표가 곧 화면의 비활성과 서버의 403 이다. 표를 통째로 고정한다.
 */
describe('관리자 등급 (28-89-A)', () => {
  const ACTIONS: AdminAction[] = ['view', 'operate', 'editSettings', 'exportBackup', 'destructive', 'manageAdmins']

  it('등급 × 행위 표', () => {
    const table = Object.fromEntries(ADMIN_GRADES.map((g) => [g, ACTIONS.filter((a) => canAdmin(g, a))]))
    expect(table).toEqual({
      owner: ['view', 'operate', 'editSettings', 'exportBackup', 'destructive', 'manageAdmins'],
      manager: ['view', 'operate', 'editSettings', 'exportBackup'],
      viewer: ['view'],
    })
  })

  it('등급이 없으면(구 세션·비관리자) 열람도 못 한다', () => {
    for (const a of ACTIONS) expect(canAdmin(undefined, a), a).toBe(false)
  })

  it('모든 행위에 최소 등급이 있고, 그 등급은 실제 등급이다', () => {
    for (const a of ACTIONS) expect(isAdminGrade(ADMIN_MIN_GRADE[a]), a).toBe(true)
    expect(isAdminGrade('root')).toBe(false)
    expect(isAdminGrade(undefined)).toBe(false)
  })

  it('관리자 아이디 형식 — 소문자·숫자·-·_ 3~20자, 첫 글자는 영숫자', () => {
    for (const ok of ['admin', 'ops-1', 'a_b', 'x'.repeat(20)]) expect(ADMIN_ID_RE.test(ok), ok).toBe(true)
    for (const bad of ['ab', '-abc', 'Admin', '한글', 'x'.repeat(21), 'a b'])
      expect(ADMIN_ID_RE.test(bad), bad).toBe(false)
  })
})
