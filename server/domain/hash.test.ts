import { describe, it, expect } from 'vitest'
import { sha256Hex, hashPassword, verifyPassword, isPasswordHash, randomSalt } from './hash'

describe('해시 (28-51-01)', () => {
  it('SHA-256 알려진 벡터', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
    expect(sha256Hex('한글 비밀번호')).toHaveLength(64)
    expect(sha256Hex('a'.repeat(1000))).toBe(sha256Hex('a'.repeat(1000)))
  })
  it('솔트·반복 해시: 같은 솔트는 결정적, 다른 솔트는 다르고, 검증은 원문만 통과', () => {
    const salt = randomSalt()
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
    const h1 = hashPassword('password1', salt)
    expect(h1).toBe(hashPassword('password1', salt))
    expect(h1).not.toBe(hashPassword('password1', randomSalt()))
    expect(isPasswordHash(h1)).toBe(true)
    expect(h1.startsWith('s256$2000$')).toBe(true)
    expect(verifyPassword('password1', h1)).toBe(true)
    expect(verifyPassword('password2', h1)).toBe(false)
    expect(verifyPassword('password1', '')).toBe(false)
    expect(verifyPassword('password1', 'password1')).toBe(false)
    expect(() => hashPassword('x', salt, 0)).toThrow()
  })
})
