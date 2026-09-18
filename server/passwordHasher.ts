import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { installPasswordHasher, type PasswordHasher } from './domain/hash'

/**
 * scrypt 비밀번호 해시 (29-29 자체 감사 02).
 *
 * 저장 형식 `scrypt$<N>.<r>.<p>$<salt hex>$<key hex>`. N=2^15·r=8·p=1 은 요청 하나에 수십 ms — 로그인·가입에서만
 * 돌고, 서버리스 함수의 메모리(64MB 상한을 명시) 안에 든다. 도메인(`server/domain/hash.ts`)에 끼우면 새 비밀번호는
 * 이 형식으로 저장되고, 옛 `s256$` 해시는 로그인에 성공하는 순간 이 형식으로 바뀐다.
 */
export const SCRYPT_N = 2 ** 15
export const SCRYPT_R = 8
export const SCRYPT_P = 1
const KEY_LEN = 32
const PREFIX = 'scrypt'
const FORMAT = /^scrypt\$(\d+)\.(\d+)\.(\d+)\$([0-9a-f]{16,64})\$([0-9a-f]{64})$/

function derive(password: string, salt: string, N: number, r: number, p: number): Buffer {
  return scryptSync(password, salt, KEY_LEN, { N, r, p, maxmem: 64 * 1024 * 1024 })
}

export const scryptHasher: PasswordHasher = {
  hash(password) {
    const salt = randomBytes(16).toString('hex')
    const key = derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P).toString('hex')
    return `${PREFIX}$${SCRYPT_N}.${SCRYPT_R}.${SCRYPT_P}$${salt}$${key}`
  },
  verify(password, stored) {
    const m = FORMAT.exec(stored)
    if (m === null) return null
    const [, N, r, p, salt, key] = m
    const expected = Buffer.from(key!, 'hex')
    const actual = derive(password, salt!, Number(N), Number(r), Number(p))
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  },
  owns(stored) {
    return FORMAT.test(stored)
  },
}

export function installScryptHasher(): void {
  installPasswordHasher(scryptHasher)
}
