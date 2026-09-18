/** 비밀번호 해시 (28-51-01): 의존성 없는 동기 SHA-256 + 솔트·반복.
 *  브라우저 WebCrypto는 비동기라 동기 도메인(AuthService)에서 쓸 수 없어 직접 구현한다.
 *  상용 전환 시 서버의 bcrypt/argon2로 대체 — 저장 형식 접두사(`s256$`)로 구분한다. */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
])

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

/** SHA-256 16진 다이제스트 (UTF-8 입력) */
export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message)
  const len = bytes.length
  const padLen = ((len + 9 + 63) >> 6) << 6
  const buf = new Uint8Array(padLen)
  buf.set(bytes)
  buf[len] = 0x80
  const view = new DataView(buf.buffer)
  const bitLen = len * 8
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(padLen - 4, bitLen >>> 0)
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const W = new Uint32Array(64)
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i += 1) W[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i += 1) {
      const w15 = W[i - 15]!
      const w2 = W[i - 2]!
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0
    }
    let a = H[0]!,
      b = H[1]!,
      c = H[2]!,
      d = H[3]!,
      e = H[4]!,
      f = H[5]!,
      g = H[6]!,
      h = H[7]!
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i]! + W[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    H[0] = (H[0]! + a) >>> 0
    H[1] = (H[1]! + b) >>> 0
    H[2] = (H[2]! + c) >>> 0
    H[3] = (H[3]! + d) >>> 0
    H[4] = (H[4]! + e) >>> 0
    H[5] = (H[5]! + f) >>> 0
    H[6] = (H[6]! + g) >>> 0
    H[7] = (H[7]! + h) >>> 0
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('')
}

export const HASH_ITERATIONS = 2000
const PREFIX = 's256'

/** 16바이트 랜덤 솔트(hex). WebCrypto가 있으면 사용, 없으면 Math.random 폴백 */
export function randomSalt(): string {
  const bytes = new Uint8Array(16)
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 29-29: 바꿔 끼울 수 있는 해시 구현.
 *
 * 이 파일의 SHA-256×2000 은 브라우저에서도 도는 동기 구현이라 남겨 두지만, GPU 대입 앞에서는 약하다. 서버는
 * `node:crypto` 의 scrypt 를 끼운다(`server/passwordHasher.ts`). 도메인은 어느 쪽인지 모른다 — `hashPassword` 가
 * 끼워진 구현을 먼저 쓰고, `verifyPassword` 는 저장 형식의 접두사로 구현을 고른다. 옛 `s256$` 해시는 그대로 검증되고,
 * 로그인에 성공하는 순간 새 형식으로 다시 저장된다(`needsRehash`).
 */
export interface PasswordHasher {
  /** 접두사를 포함한 저장 형식 */
  hash(password: string): string
  /** 내 형식이면 true/false, 내 형식이 아니면 null */
  verify(password: string, stored: string): boolean | null
  /** 내 저장 형식인가 */
  owns(stored: string): boolean
}

// **인스턴스마다 따로** 존재하는 모듈 상태다 — 서버리스 함수가 새로 뜨면 비어 있으므로, 핸들러 모듈이 로드될 때
// 매번 끼운다(`server/handlers/auth.ts` 의 `installScryptHasher()`). 요청 사이에 값이 바뀌지 않으니 인스턴스가 여럿이어도 같다.
let installed: PasswordHasher | null = null

export function installPasswordHasher(hasher: PasswordHasher | null): void {
  installed = hasher
}

/** 저장 형식 `s256$<iterations>$<salt>$<hex>` — 끼워진 구현이 있으면 그 형식 */
export function hashPassword(
  password: string,
  salt: string = randomSalt(),
  iterations: number = HASH_ITERATIONS,
): string {
  if (installed !== null && arguments.length === 1) return installed.hash(password)
  return hashLegacy(password, salt, iterations)
}

function hashLegacy(password: string, salt: string, iterations: number): string {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error('iterations')
  let h = sha256Hex(`${salt}:${password}`)
  for (let i = 1; i < iterations; i += 1) h = sha256Hex(`${h}${salt}`)
  return `${PREFIX}$${iterations}$${salt}$${h}`
}

/** 끼워진 구현이 있는데 그 형식이 아닌 (유효한) 해시 — 로그인 성공 때 다시 저장한다 */
export function needsRehash(stored: string): boolean {
  return installed !== null && isPasswordHash(stored) && !installed.owns(stored)
}

export function isPasswordHash(stored: string): boolean {
  return /^s256\$\d+\$[0-9a-f]+\$[0-9a-f]{64}$/.test(stored) || (installed !== null && installed.owns(stored))
}

/** 검증 — 형식이 아니면 false(빈 해시 = 파기된 계정) */
export function verifyPassword(password: string, stored: string): boolean {
  if (installed !== null) {
    const r = installed.verify(password, stored)
    if (r !== null) return r
  }
  if (!/^s256\$\d+\$[0-9a-f]+\$[0-9a-f]{64}$/.test(stored)) return false
  const [, iter, salt, digest] = stored.split('$')
  const computed = hashLegacy(password, salt!, Number(iter)).split('$')[3]!
  // 길이가 같은 hex끼리 전량 비교 — 조기 종료 없이
  let diff = 0
  for (let i = 0; i < digest!.length; i += 1) diff |= digest!.charCodeAt(i) ^ computed.charCodeAt(i)
  return diff === 0
}
