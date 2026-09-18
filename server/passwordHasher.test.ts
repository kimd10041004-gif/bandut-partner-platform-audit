import { afterEach, describe, expect, it } from 'vitest'
import { hashPassword, installPasswordHasher, isPasswordHash, needsRehash, verifyPassword } from './domain/hash'
import { installScryptHasher, scryptHasher, SCRYPT_N } from './passwordHasher'
import { AuthService, AUTH_STORAGE_KEY } from './domain/auth'
import { memoryStorage } from './domain/memoryStorage'

/**
 * 29-29 자체 감사 02: 서버는 scrypt, 옛 해시는 로그인하는 순간 바뀐다.
 */
describe('scrypt 비밀번호 해시 (29-29)', () => {
  afterEach(() => installPasswordHasher(null))

  it('저장 형식이 scrypt$ 로 시작하고 같은 비밀번호도 솔트가 달라 다른 해시가 된다', () => {
    const a = scryptHasher.hash('correct horse')
    const b = scryptHasher.hash('correct horse')
    expect(a).toMatch(new RegExp(`^scrypt\\$${SCRYPT_N}\\.8\\.1\\$[0-9a-f]{32}\\$[0-9a-f]{64}$`))
    expect(a).not.toBe(b)
    expect(scryptHasher.verify('correct horse', a)).toBe(true)
    expect(scryptHasher.verify('wrong', a)).toBe(false)
    expect(scryptHasher.verify('x', 's256$2000$ab$' + 'c'.repeat(64))).toBeNull()
  })

  it('끼우면 hashPassword 는 scrypt 로, verifyPassword 는 옛 s256 도 그대로 검증한다', () => {
    const legacy = hashPassword('pw-legacy-1')
    expect(legacy.startsWith('s256$')).toBe(true)
    installScryptHasher()
    const fresh = hashPassword('pw-fresh-1')
    expect(fresh.startsWith('scrypt$')).toBe(true)
    expect(isPasswordHash(fresh)).toBe(true)
    expect(verifyPassword('pw-fresh-1', fresh)).toBe(true)
    expect(verifyPassword('pw-legacy-1', legacy)).toBe(true)
    expect(verifyPassword('nope', legacy)).toBe(false)
    expect(needsRehash(legacy)).toBe(true)
    expect(needsRehash(fresh)).toBe(false)
    expect(needsRehash('')).toBe(false) // 파기된 계정
  })

  it('옛 해시로 가입된 계정은 로그인에 성공하는 순간 scrypt 로 다시 저장된다', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    const hashOf = () =>
      (
        JSON.parse(storage.getItem(AUTH_STORAGE_KEY) ?? '{}') as {
          accounts: Array<{ phone: string; passwordHash: string }>
        }
      ).accounts.find((a) => a.phone === '01055551234')!.passwordHash
    const r = auth.register({
      role: 'customer',
      name: '김고객',
      phone: '01055551234',
      password: 'pw-legacy-2',
      agreeTerms: true,
      agreePrivacy: true,
    })
    auth.verifyOtp('customer', '01055551234', r.otp)
    const before = hashOf()
    expect(before.startsWith('s256$')).toBe(true)

    installScryptHasher()
    auth.login('customer', '01055551234', 'pw-legacy-2')
    const after = hashOf()
    expect(after.startsWith('scrypt$')).toBe(true)
    // 새 해시로도 들어온다, 틀린 비밀번호는 여전히 막힌다
    auth.logout('customer')
    expect(() => auth.login('customer', '01055551234', 'pw-legacy-2')).not.toThrow()
    auth.logout('customer')
    expect(() => auth.login('customer', '01055551234', 'wrong-pw-2')).toThrow()
  })
})
