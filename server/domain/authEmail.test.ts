import { describe, expect, it } from 'vitest'
import {
  AuthService,
  isEmailAddress,
  maskEmail,
  normalizeEmail,
  recoveryChannelOf,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  LOGIN_MAX_FAILS,
  AUTH_STORAGE_KEY,
  type SecurityEvent,
} from './auth'
import { memoryStorage } from './memoryStorage'

/**
 * 29-27: 이메일로도 비밀번호를 찾는다.
 *
 * 규칙은 휴대폰 복구(29-12)와 같은 모양이어야 한다 — 목적 분리·만료·시도 제한·세션 폐기. 여기에 이메일만의
 * 규칙이 둘 더 있다: **인증된 주소만 복구에 쓴다**, 그리고 **이메일로 복구했다고 휴대폰 인증이 서지는 않는다**.
 */
const PHONE = '01012345678'
const EMAIL = 'Kim.Gogaek@Example.Test'

function signedUp(email?: string): AuthService {
  const auth = new AuthService()
  const r = auth.register({
    agreeTerms: true,
    agreePrivacy: true,
    role: 'customer',
    name: '김고객',
    phone: PHONE,
    password: 'password1',
    ...(email !== undefined ? { email } : {}),
  })
  auth.verifyOtp('customer', PHONE, r.otp)
  return auth
}

/** 로그인해서 이메일을 등록하고 인증까지 끝낸 계정 */
function withVerifiedEmail(): AuthService {
  const auth = signedUp()
  auth.login('customer', PHONE, 'password1')
  const { otp } = auth.setEmail('customer', EMAIL)
  auth.verifyEmail('customer', otp)
  return auth
}

describe('이메일 모양·정규화', () => {
  it('대소문자와 앞뒤 공백을 무시한다 — 같은 사람이 두 번 등록되지 않게', () => {
    expect(normalizeEmail('  Kim@Example.Test ')).toBe('kim@example.test')
  })

  it('메일이 갈 수 있는 모양만 받는다', () => {
    expect(isEmailAddress('kim@example.test')).toBe(true)
    for (const bad of ['kim', 'kim@', '@example.test', 'kim@example', 'kim @example.test', 'a'.repeat(250) + '@x.co']) {
      expect(isEmailAddress(bad), bad).toBe(false)
    }
  })

  it('`@` 하나로 휴대폰과 이메일을 가른다', () => {
    expect(recoveryChannelOf('010-1234-5678')).toBe('phone')
    expect(recoveryChannelOf('kim@example.test')).toBe('email')
  })

  it('감사 로그에는 첫 글자와 도메인만 남는다', () => {
    expect(maskEmail('kim@example.test')).toBe('k***@example.test')
    expect(maskEmail('')).toBe('(없음)')
  })
})

describe('이메일 등록·인증', () => {
  it('가입 때 적은 이메일은 저장되지만 아직 인증되지 않았다', () => {
    const auth = signedUp(EMAIL)
    auth.login('customer', PHONE, 'password1')
    const me = auth.accountFor('customer')!
    expect(me.email).toBe('kim.gogaek@example.test')
    expect(me.emailVerifiedAt).toBeUndefined()
  })

  it('가입 때 이메일 모양이 틀리면 가입 자체를 거절한다', () => {
    const auth = new AuthService()
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: true,
        role: 'customer',
        name: '김고객',
        phone: PHONE,
        password: 'password1',
        email: 'not-an-email',
      }),
    ).toThrow('이메일 주소 모양')
  })

  it('주소는 인증한 사람의 것이다 — 적어만 둔 다른 계정에서는 거둔다 (자체 감사 04)', () => {
    // A 가 적어만 두고 인증하지 않은 주소를 B 가 인증한다. A 가 그 주소를 선점할 수 없어야 한다.
    const auth = signedUp(EMAIL) // A: 미인증으로 저장
    const b = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '이고객',
      phone: '01099998888',
      password: 'password1',
      email: EMAIL, // 미인증 중복은 허용된다
    })
    auth.verifyOtp('customer', '01099998888', b.otp)
    auth.login('customer', '01099998888', 'password1')
    auth.verifyEmail('customer', auth.setEmail('customer', EMAIL).otp)
    // B 가 인증했으니 복구는 B 에게 간다
    expect(auth.requestPasswordReset('customer', EMAIL).to).toBe('kim.gogaek@example.test')
    // A 의 미인증 주소는 거둬졌다
    auth.logout('customer')
    auth.login('customer', PHONE, 'password1')
    expect(auth.accountFor('customer')!.email).toBeUndefined()
    // 이제 A 가 같은 주소를 인증하려 하면 막힌다 — B 가 인증한 주소다
    expect(() => auth.setEmail('customer', EMAIL)).toThrow('이미 다른 계정에서 인증한 이메일')
    // 다른 역할(파트너)은 같은 주소를 쓸 수 있다 — 한 사람이 고객과 파트너 둘 다일 수 있다
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: true,
        role: 'partner',
        name: '김기사',
        phone: '01077776666',
        password: 'password1',
        partnerType: 'individual',
        email: EMAIL,
      }),
    ).not.toThrow()
  })

  it('탈퇴하면 이메일도 파기된다 — "식별 정보는 즉시 파기" 가 거짓이 되지 않게 (자체 감사 01)', () => {
    const auth = withVerifiedEmail()
    const gone = auth.withdraw('customer', 'password1')
    expect(gone.email).toBeUndefined()
    expect(gone.emailVerifiedAt).toBeUndefined()
    expect(auth.requestPasswordReset('customer', EMAIL).to).toBeNull()
  })

  it('같은 주소로 60초 안에 다시 요청하면 인증 메일을 다시 내지 않는다 (자체 감사 02)', () => {
    const auth = signedUp()
    auth.login('customer', PHONE, 'password1')
    const t0 = Date.now()
    auth.setEmail('customer', EMAIL, t0)
    expect(() => auth.setEmail('customer', EMAIL, t0 + 10_000)).toThrow('방금 보냈습니다')
    // 다른 주소로 바꾸는 것은 새 주소라 바로 낸다
    expect(() => auth.setEmail('customer', 'other@example.test', t0 + 10_000)).not.toThrow()
    // 간격이 지나면 다시 낸다
    expect(() => auth.setEmail('customer', 'other@example.test', t0 + 10_000 + OTP_RESEND_COOLDOWN_MS)).not.toThrow()
  })

  it('재설정도 60초 안에는 같은 코드를 돌려주고 보낼 곳이 없다 — 밖에서는 구분할 수 없다 (자체 감사 02)', () => {
    const auth = withVerifiedEmail()
    const t0 = Date.now()
    const first = auth.requestPasswordReset('customer', EMAIL, t0)
    const again = auth.requestPasswordReset('customer', EMAIL, t0 + 30_000)
    expect(first.to).toBe('kim.gogaek@example.test')
    expect(again.to).toBeNull()
    expect(again.otp).toBe(first.otp)
    const later = auth.requestPasswordReset('customer', EMAIL, t0 + OTP_RESEND_COOLDOWN_MS + 1)
    expect(later.to).toBe('kim.gogaek@example.test')
    expect(later.otp).not.toBe(first.otp)
  })

  it('메일이 못 나가서 코드를 버리면 다음 요청은 간격 제한 없이 새 코드를 낸다 (자체 감사 05)', () => {
    const auth = withVerifiedEmail()
    const t0 = Date.now()
    const first = auth.requestPasswordReset('customer', EMAIL, t0)
    auth.discardPasswordReset('customer', EMAIL)
    expect(() => auth.resetPassword('customer', EMAIL, first.otp, 'newpass12')).toThrow('발급된 인증번호가 없습니다')
    const next = auth.requestPasswordReset('customer', EMAIL, t0 + 1000)
    expect(next.to).toBe('kim.gogaek@example.test')
  })

  it('등록하면 인증번호가 나오고, 맞는 번호로 인증된다', () => {
    const auth = signedUp()
    auth.login('customer', PHONE, 'password1')
    const { email, otp } = auth.setEmail('customer', EMAIL)
    expect(email).toBe('kim.gogaek@example.test')
    expect(otp).toMatch(/^\d{6}$/)
    expect(auth.accountFor('customer')!.emailVerifiedAt).toBeUndefined()
    const me = auth.verifyEmail('customer', otp)
    expect(me.emailVerifiedAt).toBeDefined()
  })

  it('로그인하지 않으면 등록도 인증도 못 한다', () => {
    const auth = signedUp()
    expect(() => auth.setEmail('customer', EMAIL)).toThrow('로그인 후')
    expect(() => auth.verifyEmail('customer', '000000')).toThrow('로그인 후')
  })

  it('주소를 바꾸면 인증이 풀린다 — 인증은 주소에 붙은 것이지 계정에 붙은 것이 아니다', () => {
    const auth = withVerifiedEmail()
    auth.setEmail('customer', 'other@example.test')
    const me = auth.accountFor('customer')!
    expect(me.email).toBe('other@example.test')
    expect(me.emailVerifiedAt).toBeUndefined()
  })

  it('같은 주소를 다시 넣으면 인증 메일만 다시 낸다. 이미 인증된 주소는 할 일이 없다', () => {
    const auth = signedUp()
    auth.login('customer', PHONE, 'password1')
    const first = auth.setEmail('customer', EMAIL)
    const second = auth.setEmail('customer', EMAIL, Date.now() + OTP_RESEND_COOLDOWN_MS + 1)
    expect(() => auth.verifyEmail('customer', first.otp)).toThrow('일치하지 않습니다')
    auth.verifyEmail('customer', second.otp)
    expect(() => auth.setEmail('customer', EMAIL)).toThrow('이미 인증된 이메일')
  })

  it('인증도 5분·5회다', () => {
    const auth = signedUp()
    auth.login('customer', PHONE, 'password1')
    const a = auth.setEmail('customer', EMAIL)
    expect(() => auth.verifyEmail('customer', a.otp, Date.now() + OTP_TTL_MS + 1)).toThrow('만료')
    const b = auth.setEmail('customer', EMAIL, Date.now() + OTP_RESEND_COOLDOWN_MS + 1)
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i += 1) {
      expect(() => auth.verifyEmail('customer', '000000')).toThrow('일치하지 않습니다')
    }
    expect(() => auth.verifyEmail('customer', '000000')).toThrow('초과')
    expect(() => auth.verifyEmail('customer', b.otp)).toThrow('발급된 인증번호가 없습니다')
  })

  it('가입 인증번호로는 이메일 인증을 못 하고, 이메일 인증번호로는 가입 인증을 못 한다', () => {
    const auth = new AuthService()
    const reg = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김고객',
      phone: PHONE,
      password: 'password1',
    })
    auth.verifyOtp('customer', PHONE, reg.otp)
    auth.login('customer', PHONE, 'password1')
    const { otp } = auth.setEmail('customer', EMAIL)
    expect(() => auth.verifyEmail('customer', reg.otp)).toThrow('일치하지 않습니다')
    expect(() => auth.verifyOtp('customer', PHONE, otp)).toThrow('발급된 인증번호가 없습니다')
  })
})

describe('이메일로 비밀번호 찾기', () => {
  it('인증된 이메일로 요청하면 보낼 곳이 있고, 그 코드로 새 비밀번호를 정한다', () => {
    const auth = withVerifiedEmail()
    const r = auth.requestPasswordReset('customer', 'KIM.GOGAEK@example.test')
    expect(r.channel).toBe('email')
    expect(r.to).toBe('kim.gogaek@example.test')
    auth.resetPassword('customer', EMAIL, r.otp, 'newpass12')
    expect(() => auth.login('customer', PHONE, 'password1')).toThrow('일치하지 않습니다')
    expect(auth.login('customer', PHONE, 'newpass12').role).toBe('customer')
  })

  it('인증되지 않은 이메일은 없는 주소와 같다 — 코드는 돌려주되 저장하지 않고, 보낼 곳도 없다', () => {
    const auth = signedUp(EMAIL)
    const r = auth.requestPasswordReset('customer', EMAIL)
    expect(r.channel).toBe('email')
    expect(r.to).toBeNull()
    expect(r.otp).toMatch(/^\d{6}$/)
    expect(() => auth.resetPassword('customer', EMAIL, r.otp, 'newpass12')).toThrow('발급된 인증번호가 없습니다')
  })

  it('모르는 이메일도 같은 답이다 — 응답으로 가입 여부를 훑을 수 없다', () => {
    const auth = withVerifiedEmail()
    const r = auth.requestPasswordReset('customer', 'nobody@example.test')
    expect(r.to).toBeNull()
    expect(r.otp).toMatch(/^\d{6}$/)
  })

  it('이메일 모양이 아니면 거절한다 — 휴대폰 번호 모양이 아닌 것과 같은 자리', () => {
    const auth = withVerifiedEmail()
    expect(() => auth.requestPasswordReset('customer', 'kim@')).toThrow('이메일 주소 모양')
  })

  it('이메일로 받은 코드는 휴대폰 길로 통하지 않고, 휴대폰 코드는 이메일 길로 통하지 않는다', () => {
    const auth = withVerifiedEmail()
    const byMail = auth.requestPasswordReset('customer', EMAIL)
    expect(() => auth.resetPassword('customer', PHONE, byMail.otp, 'newpass12')).toThrow('발급된 인증번호가 없습니다')
    const byPhone = auth.requestPasswordReset('customer', PHONE)
    expect(() => auth.resetPassword('customer', EMAIL, byPhone.otp, 'newpass12')).toThrow('일치하지 않습니다')
    // 각자 제 길로는 통한다
    auth.resetPassword('customer', EMAIL, byMail.otp, 'newpass12')
  })

  it('이메일로 복구해도 휴대폰 인증이 서지는 않는다 — 쥔 것은 메일함이지 휴대폰이 아니다', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    const reg = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김고객',
      phone: PHONE,
      password: 'password1',
      email: EMAIL,
    })
    auth.verifyOtp('customer', PHONE, reg.otp)
    auth.login('customer', PHONE, 'password1')
    auth.verifyEmail('customer', auth.setEmail('customer', EMAIL).otp)
    // 휴대폰 인증을 일부러 되돌려 둔다 — 이메일 복구가 그것을 세우면 안 된다
    const snap = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) ?? '{}') as { accounts: Array<{ verified: boolean }> }
    snap.accounts[0]!.verified = false
    storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(snap))
    const reloaded = new AuthService(storage)
    const r = reloaded.requestPasswordReset('customer', EMAIL)
    reloaded.resetPassword('customer', EMAIL, r.otp, 'newpass12')
    expect(() => reloaded.login('customer', PHONE, 'newpass12')).toThrow('인증')
  })

  it('잠긴 계정도 이메일로 복구하면 곧바로 들어온다 — 잠금 키는 휴대폰 기준이라 따로 지워야 한다', () => {
    const auth = withVerifiedEmail()
    for (let i = 0; i < LOGIN_MAX_FAILS; i += 1) {
      expect(() => auth.login('customer', PHONE, 'wrongpass')).toThrow()
    }
    expect(auth.lockRemainingMs('customer', PHONE)).toBeGreaterThan(0)
    const r = auth.requestPasswordReset('customer', EMAIL)
    auth.resetPassword('customer', EMAIL, r.otp, 'newpass12')
    expect(auth.lockRemainingMs('customer', PHONE)).toBe(0)
    expect(auth.login('customer', PHONE, 'newpass12').role).toBe('customer')
  })

  it('만료·시도 제한은 휴대폰 복구와 같다 (5분·5회)', () => {
    const auth = withVerifiedEmail()
    const a = auth.requestPasswordReset('customer', EMAIL)
    expect(() => auth.resetPassword('customer', EMAIL, a.otp, 'newpass12', Date.now() + OTP_TTL_MS + 1)).toThrow('만료')
    const b = auth.requestPasswordReset('customer', EMAIL)
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i += 1) {
      expect(() => auth.resetPassword('customer', EMAIL, '000000', 'newpass12')).toThrow('일치하지 않습니다')
    }
    expect(() => auth.resetPassword('customer', EMAIL, '000000', 'newpass12')).toThrow('초과')
    expect(() => auth.resetPassword('customer', EMAIL, b.otp, 'newpass12')).toThrow('발급된 인증번호가 없습니다')
  })

  it('감사 로그에 이메일은 가려서 남는다', () => {
    const auth = withVerifiedEmail()
    const events: SecurityEvent[] = []
    auth.onSecurityEvent = (e) => events.push(e)
    const r = auth.requestPasswordReset('customer', EMAIL)
    auth.resetPassword('customer', EMAIL, r.otp, 'newpass12')
    const reset = events.find((e) => e.action === '비밀번호 재설정')
    expect(reset?.detail).toContain('k***@example.test')
    expect(JSON.stringify(events)).not.toContain('kim.gogaek')
  })

  it('이메일과 인증 시각은 저장소를 오가도 남는다', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    const reg = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김고객',
      phone: PHONE,
      password: 'password1',
    })
    auth.verifyOtp('customer', PHONE, reg.otp)
    auth.login('customer', PHONE, 'password1')
    auth.verifyEmail('customer', auth.setEmail('customer', EMAIL).otp)
    const again = new AuthService(storage)
    const r = again.requestPasswordReset('customer', EMAIL)
    expect(r.to).toBe('kim.gogaek@example.test')
  })
})
