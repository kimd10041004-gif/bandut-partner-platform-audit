import { beforeEach, describe, expect, it } from 'vitest'
import { handleAuth } from './auth'
import { MAX_MAIL_REQUESTS_PER_WINDOW, resetRateLimit } from '../rateLimit'

/**
 * 29-27: 이메일 복구의 문 — DB 없이 보는 것들. 환경변수 검사는 DB보다 먼저다.
 */
const req = (op: string, args: unknown[] = []) => ({
  method: 'POST',
  headers: { 'x-forwarded-for': '203.0.113.77' },
  query: {},
  body: { op, args },
})
const ready = { DATABASE_URL: 'postgres://unused', ADMIN_PASSWORD: 'ci-admin-pass-1' }
const mail = { MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k', MAIL_SENDER: 's@example.test' }
const sms = { SMS_PROVIDER: 'x', SMS_API_KEY: 'y', SMS_SENDER: 'z' }

describe('이메일로 비밀번호 찾기의 문 (29-27)', () => {
  beforeEach(resetRateLimit)

  it('한 IP 가 메일이 나갈 수 있는 요청을 창 안에서 반복하면 429 다 — 성공도 센다 (자체 감사 02)', async () => {
    for (let i = 0; i < MAX_MAIL_REQUESTS_PER_WINDOW; i += 1) {
      const r = await handleAuth(req('requestPasswordReset', ['customer', `k${i}@example.test`]), ready)
      expect(r.status).not.toBe(429)
    }
    const blocked = await handleAuth(req('setEmail', ['kim@example.test']), ready)
    expect(blocked.status).toBe(429)
    expect(JSON.stringify(blocked.body)).toContain('인증 메일 요청이 많습니다')
    // 휴대폰 복구는 메일이 아니라 세지 않는다
    expect((await handleAuth(req('requestPasswordReset', ['customer', '01012345678']), ready)).status).not.toBe(429)
  })

  it('운영에 메일 설정이 없으면 이메일 복구를 받지 않는다 — 문자 설정이 있어도', async () => {
    const res = await handleAuth(req('requestPasswordReset', ['customer', 'kim@example.test']), {
      ...ready,
      ...sms,
      VERCEL_ENV: 'production',
    })
    expect(res.status).toBe(503)
    expect(JSON.stringify(res.body)).toContain('메일 발송이 아직 연결되지 않아')
    expect(JSON.stringify(res.body)).toContain('휴대폰 번호로')
  })

  it('운영에 문자 설정이 없어도 메일 설정이 있으면 이메일 복구는 문을 연다 (DB 로 간다)', async () => {
    // DB 주소가 가짜라 저장소 오류(503)로 끝난다 — 문이 닫혔다면 그 전에 "메일 발송이 아직" 으로 끝났을 것이다
    const res = await handleAuth(req('requestPasswordReset', ['customer', 'kim@example.test']), {
      ...ready,
      ...mail,
      VERCEL_ENV: 'production',
    })
    expect(JSON.stringify(res.body)).not.toContain('메일 발송이 아직 연결되지 않아')
    expect(JSON.stringify(res.body)).not.toContain('문자 발송이 아직 연결되지 않아')
  })

  it('휴대폰 복구는 예전 그대로 문자 쪽 문을 본다', async () => {
    const res = await handleAuth(req('requestPasswordReset', ['customer', '01012345678']), {
      ...ready,
      ...mail,
      VERCEL_ENV: 'production',
    })
    expect(res.status).toBe(503)
    expect(JSON.stringify(res.body)).toContain('문자 발송이 아직 연결되지 않아')
  })

  it('이메일 등록도 같은 문이다 — 인증 메일을 보낼 수 없으면 받지 않는다', async () => {
    const res = await handleAuth(req('setEmail', ['kim@example.test']), { ...ready, VERCEL_ENV: 'production' })
    expect(res.status).toBe(503)
    expect(JSON.stringify(res.body)).toContain('메일 발송이 아직 연결되지 않아')
  })

  it('로컬·CI 는 메일 설정 없이도 연다 — 응답에 코드를 싣는 자리', async () => {
    const res = await handleAuth(req('requestPasswordReset', ['customer', 'kim@example.test']), ready)
    expect(JSON.stringify(res.body)).not.toContain('메일 발송이 아직 연결되지 않아')
  })
})
