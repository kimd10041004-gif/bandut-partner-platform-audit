import { describe, expect, it } from 'vitest'
import {
  devOtpAllowed,
  emailDeliverable,
  mailConfigured,
  MAIL_UNDELIVERABLE,
  otpDeliverable,
  smsConfigured,
} from './authSafety'

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv

describe('개발용 인증번호를 보여도 되는 자리', () => {
  it('운영에서는 어떤 값으로도 열리지 않는다', () => {
    expect(devOtpAllowed(env({ VERCEL_ENV: 'production' }))).toBe(false)
    // 플래그가 실수로 운영에 새어 들어가도 마찬가지다 — 이 줄이 이 파일의 이유다
    expect(devOtpAllowed(env({ VERCEL_ENV: 'production', AUTH_DEV_OTP: 'on' }))).toBe(false)
  })

  it('프리뷰는 명시적으로 켠 경우에만 연다', () => {
    expect(devOtpAllowed(env({ VERCEL_ENV: 'preview' }))).toBe(false)
    expect(devOtpAllowed(env({ VERCEL_ENV: 'preview', AUTH_DEV_OTP: 'off' }))).toBe(false)
    expect(devOtpAllowed(env({ VERCEL_ENV: 'preview', AUTH_DEV_OTP: 'on' }))).toBe(true)
  })

  it('로컬·CI는 배포가 아니므로 연다 — 게이트가 가입 여정을 돈다', () => {
    expect(devOtpAllowed(env({}))).toBe(true)
  })
})

describe('문자 발송 설정', () => {
  it('셋이 다 있어야 갖춰진 것으로 본다', () => {
    expect(smsConfigured(env({ SMS_PROVIDER: 'x', SMS_API_KEY: 'y' }))).toBe(false)
    expect(smsConfigured(env({ SMS_PROVIDER: 'x', SMS_API_KEY: 'y', SMS_SENDER: '' }))).toBe(false)
    expect(smsConfigured(env({ SMS_PROVIDER: 'x', SMS_API_KEY: 'y', SMS_SENDER: '0100000' }))).toBe(true)
  })
})

describe('가입·복구를 받아도 되는 서버인가', () => {
  it('운영에 문자 설정이 없으면 받지 않는다', () => {
    expect(otpDeliverable(env({ VERCEL_ENV: 'production' }))).toBe(false)
  })

  it('전달할 방법이 하나라도 있으면 받는다', () => {
    expect(otpDeliverable(env({ VERCEL_ENV: 'preview', AUTH_DEV_OTP: 'on' }))).toBe(true)
    expect(
      otpDeliverable(env({ VERCEL_ENV: 'production', SMS_PROVIDER: 'x', SMS_API_KEY: 'y', SMS_SENDER: 'z' })),
    ).toBe(true)
  })
})

describe('메일 발송 설정 (29-27)', () => {
  it('셋이 다 있어야 갖춰진 것으로 본다 — 문자와 같은 규칙', () => {
    expect(mailConfigured(env({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k' }))).toBe(false)
    expect(mailConfigured(env({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k', MAIL_SENDER: '' }))).toBe(false)
    expect(mailConfigured(env({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k', MAIL_SENDER: 'a@b.co' }))).toBe(true)
  })

  it('운영에 메일 설정이 없으면 이메일 인증·이메일 복구를 받지 않는다 — 문자 설정이 있어도', () => {
    expect(emailDeliverable(env({ VERCEL_ENV: 'production' }))).toBe(false)
    expect(
      emailDeliverable(env({ VERCEL_ENV: 'production', SMS_PROVIDER: 'x', SMS_API_KEY: 'y', SMS_SENDER: 'z' })),
    ).toBe(false)
    expect(
      emailDeliverable(env({ VERCEL_ENV: 'production', MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k', MAIL_SENDER: 's' })),
    ).toBe(true)
    // 로컬·CI 는 응답에 코드를 싣는다
    expect(emailDeliverable(env({}))).toBe(true)
  })

  it('막는 문구는 휴대폰이라는 다른 길을 말한다', () => {
    expect(MAIL_UNDELIVERABLE).toContain('휴대폰 번호로')
  })
})
