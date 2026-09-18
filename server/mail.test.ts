import { describe, expect, it, vi } from 'vitest'
import { emailVerificationMail, MailError, passwordResetMail, sendMail } from './mail'

/**
 * 29-27: 메일 발송 어댑터. 진짜 발송사는 부르지 않는다 — `fetch` 를 끼운다.
 */
const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv
const ready = {
  MAIL_PROVIDER: 'resend',
  MAIL_API_KEY: 're_test_key',
  MAIL_SENDER: '반듯집수리 <no-reply@example.test>',
}

describe('메일 발송 (29-27)', () => {
  it('resend 로 보낸다 — 키는 Authorization 에, 보내는 주소는 MAIL_SENDER 에서', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }))
    await sendMail(env(ready), { to: 'kim@example.test', subject: '제목', text: '본문' }, fetchImpl as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer re_test_key')
    expect(JSON.parse(String(init.body))).toEqual({
      from: '반듯집수리 <no-reply@example.test>',
      to: ['kim@example.test'],
      subject: '제목',
      text: '본문',
    })
  })

  it('발송사가 거절하면 상태 코드만 들고 던진다 — 본문(키가 섞일 수 있다)은 담지 않는다', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"invalid key re_test_key"}', { status: 401 }))
    await expect(
      sendMail(env(ready), { to: 'a@b.co', subject: 's', text: 't' }, fetchImpl as typeof fetch),
    ).rejects.toThrow(/거절했습니다 \(401\)/)
    await expect(
      sendMail(env(ready), { to: 'a@b.co', subject: 's', text: 't' }, fetchImpl as typeof fetch),
    ).rejects.not.toThrow(/re_test_key/)
  })

  it('발송사에 닿지 못해도 MailError 다 — 저장소 오류로 보이지 않게', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(
      sendMail(env(ready), { to: 'a@b.co', subject: 's', text: 't' }, fetchImpl as typeof fetch),
    ).rejects.toBeInstanceOf(MailError)
  })

  it('발송사가 제때 답하지 않으면 끊는다 — 트랜잭션 잠금을 오래 쥐지 않게 (자체 감사 03)', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    })
    await expect(
      sendMail(env(ready), { to: 'a@b.co', subject: 's', text: 't' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('제때 답하지 않았습니다')
  })

  it('모르는 발송사 이름이면 보내는 척하지 않는다', async () => {
    const fetchImpl = vi.fn()
    await expect(
      sendMail(
        env({ ...ready, MAIL_PROVIDER: 'pigeon' }),
        { to: 'a@b.co', subject: 's', text: 't' },
        fetchImpl as typeof fetch,
      ),
    ).rejects.toThrow('알 수 없는 메일 발송사')
    await expect(
      sendMail(env({ MAIL_PROVIDER: 'resend' }), { to: 'a@b.co', subject: 's', text: 't' }, fetchImpl as typeof fetch),
    ).rejects.toThrow('갖춰지지 않았습니다')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('두 메일 모두 코드와 5분 안내, 그리고 "본인이 아니면 무시" 를 담는다', () => {
    for (const m of [emailVerificationMail('a@b.co', '123456'), passwordResetMail('a@b.co', '654321')]) {
      expect(m.to).toBe('a@b.co')
      expect(m.subject).toMatch(/\d{6}/)
      expect(m.text).toContain('5분')
      expect(m.text).toContain('본인이 요청한 것이 아니라면')
    }
    expect(emailVerificationMail('a@b.co', '123456').text).toContain('123456')
    expect(passwordResetMail('a@b.co', '654321').text).toContain('654321')
    expect(passwordResetMail('a@b.co', '654321').text).toContain('모든 기기에서 로그아웃')
  })
})
