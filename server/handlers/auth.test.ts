import { describe, it, expect } from 'vitest'
import { handleAuth } from './auth'
import {
  isThrottled,
  recordFailure,
  resetRateLimit,
  MAX_FAILS_PER_WINDOW,
  clientIp,
  clientIpOf,
  UNKNOWN_IP,
} from '../rateLimit'

/** DB 없이 보는 것들 — 환경변수 검사는 DB보다 먼저다 */
const req = (op: string, args: unknown[] = [], headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers,
  query: {},
  body: { op, args },
})
const env = { DATABASE_URL: 'postgres://unused', ADMIN_PASSWORD: 'ci-admin-pass-1' }

describe('api/auth 환경 검사 (28-70-01·03)', () => {
  it('ADMIN_PASSWORD가 시연값이면 503', async () => {
    expect((await handleAuth(req('login'), { DATABASE_URL: 'x', ADMIN_PASSWORD: 'bandut1234!' })).status).toBe(503)
  })

  it('한 IP가 창 안에서 실패를 반복하면 login·register·verifyOtp가 429다 (28-70-03c)', async () => {
    resetRateLimit()
    const ip = '203.0.113.9'
    for (let i = 0; i < MAX_FAILS_PER_WINDOW; i += 1) recordFailure(ip, 1, 1_000_000 + i)
    expect(isThrottled(ip, 1_000_000 + MAX_FAILS_PER_WINDOW)).toBe(true)
    expect(isThrottled(ip, 1_000_000 + 61_000)).toBe(false) // 창이 지나면 풀린다
    for (let i = 0; i < MAX_FAILS_PER_WINDOW; i += 1) recordFailure(ip)
    const res = await handleAuth(
      req('login', ['customer', '01000000000', 'x'], { 'x-forwarded-for': `${ip}, 10.0.0.1` }),
      env,
    )
    expect(res.status).toBe(429) // 수정 전: DB로 갔다
    expect(clientIp({ 'x-forwarded-for': ' 1.2.3.4 ,5.6.7.8' })).toBe('1.2.3.4')
    // 28-72-04c: 헤더가 없으면 IP를 구분할 수 없다 — 호출자가 그 사실을 알 수 있어야 한다
    expect(clientIpOf({ 'x-forwarded-for': ' 1.2.3.4 ,5.6.7.8' })).toEqual({ ip: '1.2.3.4', trusted: true })
    expect(clientIpOf({ 'x-real-ip': '9.9.9.9' })).toEqual({ ip: '9.9.9.9', trusted: true })
    expect(clientIpOf({})).toEqual({ ip: UNKNOWN_IP, trusted: false })
    expect(clientIpOf({ 'x-forwarded-for': '   ' })).toEqual({ ip: UNKNOWN_IP, trusted: false })
    resetRateLimit()
  })
})

describe('운영에서는 인증번호를 내주지 않는다 (29-11)', () => {
  const ready = env // 29-21: 가입 코드가 없어졌다 — 준비된 환경은 DATABASE_URL·ADMIN_PASSWORD 둘이다

  it('운영에 문자 설정이 없으면 가입 자체를 받지 않는다', async () => {
    // 수정 전: 이 요청이 DB까지 가서 계정을 만들고 인증번호를 응답에 실어 돌려줬다
    const res = await handleAuth(req('register', [{}]), { ...ready, VERCEL_ENV: 'production' })
    expect(res.status).toBe(503)
    expect(JSON.stringify(res.body)).toContain('문자 발송이 아직 연결되지 않아')
  })

  it('플래그를 켜도 운영은 열리지 않는다', async () => {
    const res = await handleAuth(req('register', [{}]), {
      ...ready,
      VERCEL_ENV: 'production',
      AUTH_DEV_OTP: 'on',
    })
    expect(res.status).toBe(503)
    // 503만 보면 DB 오류로도 통과한다 — 고치기 전 상태에서 실제로 그랬다. 이유까지 본다
    expect(JSON.stringify(res.body)).toContain('문자 발송이 아직 연결되지 않아')
  })

  it('플래그를 켜지 않은 프리뷰도 운영과 같이 막힌다 — 전환 전 마지막 점검을 그대로 해 본다', async () => {
    const res = await handleAuth(req('register', [{}]), { ...ready, VERCEL_ENV: 'preview' })
    expect(res.status).toBe(503)
    expect(JSON.stringify(res.body)).toContain('문자 발송이 아직 연결되지 않아')
  })
})

describe('무차별 대입 표적의 가중치 (28-71-02)', () => {
  it('가중치 5짜리 실패는 4번째부터 429', () => {
    resetRateLimit()
    const ip = '203.0.113.10'
    for (let i = 0; i < 3; i += 1) recordFailure(ip, 5)
    expect(isThrottled(ip)).toBe(false)
    recordFailure(ip, 5)
    expect(isThrottled(ip)).toBe(true) // 수정 전: 가중치 없음 → 20번째까지 통과
    resetRateLimit()
  })
})
