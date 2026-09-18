import { describe, it, expect } from 'vitest'
import {
  AuthService,
  AuthError,
  ADMIN_ID,
  ADMIN_INITIAL_PASSWORD,
  isValidBusinessNumber,
  LOGIN_MAX_FAILS,
  LOGIN_LOCK_MS,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_LOCK_MS,
  SESSION_TTL_MS,
} from './auth'
import { AUTH_STORAGE_KEY, maskAccountNumber, payoutAccountLabel, maskPhone, type SecurityEvent } from './auth'
import { memoryStorage } from './memoryStorage'

describe('인증 (28-30-01)', () => {
  it('가입 검증: 이름·휴대폰 형식·비밀번호 8자·파트너 사업자번호·중복 가입', () => {
    const auth = new AuthService()
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: true,
        role: 'customer',
        name: ' ',
        phone: '01012345678',
        password: 'password1',
      }),
    ).toThrow('이름')
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: true,
        role: 'customer',
        name: '김',
        phone: '021234567',
        password: 'password1',
      }),
    ).toThrow('휴대폰')
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: true,
        role: 'customer',
        name: '김',
        phone: '010-1234-5678',
        password: 'short',
      }),
    ).toThrow('8자')
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: true,
        role: 'partner',
        name: '반듯설비',
        phone: '01011112222',
        password: 'password1',
      }),
    ).toThrow('파트너 유형')
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: true,
        role: 'partner',
        name: '반듯설비',
        phone: '01011112222',
        password: 'password1',
        partnerType: 'business',
      }),
    ).toThrow('사업자등록번호')
    const { account, otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '010-1234-5678',
      password: 'password1',
    })
    expect(account.id).toMatch(/^AC-\d{4}$/)
    expect(account.phone).toBe('01012345678')
    expect(account.verified).toBe(false)
    expect(otp).toMatch(/^\d{6}$/)
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: true,
        role: 'customer',
        name: '딴사람',
        phone: '01012345678',
        password: 'password2',
      }),
    ).toThrow('이미 가입된')
    // 같은 번호라도 역할이 다르면 별도 계정
    const p = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'partner',
      name: '반듯설비',
      phone: '01012345678',
      password: 'password1',
      partnerType: 'business',
      bizNo: '123-45-67891',
    })
    expect(p.account.bizNo).toBe('1234567891')
  })

  it('OTP 인증 없이는 로그인 불가, 인증 후 로그인·로그아웃', () => {
    const auth = new AuthService()
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '01012345678',
      password: 'password1',
    })
    expect(() => auth.login('customer', '01012345678', 'password1')).toThrow('인증이 완료되지')
    expect(() => auth.verifyOtp('customer', '01012345678', '000000')).toThrow('일치하지')
    auth.verifyOtp('customer', '010-1234-5678', otp)
    expect(() => auth.verifyOtp('customer', '01012345678', otp)).toThrow('발급된 인증번호가 없습니다')
    expect(() => auth.login('customer', '01012345678', 'wrongpass')).toThrow('일치하지')
    const s = auth.login('customer', '01012345678', 'password1')
    expect(s).toMatchObject({ role: 'customer', name: '김반듯', accountId: 'AC-0001' })
    expect(auth.sessionFor('customer')?.name).toBe('김반듯')
    auth.logout('customer')
    expect(auth.sessionFor('customer')).toBeUndefined()
  })

  it('역할별 세션은 독립이고 관리자는 시드 계정으로 로그인한다', () => {
    const auth = new AuthService()
    expect(() => auth.login('admin', ADMIN_ID, 'nope')).toThrow(AuthError)
    auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD)
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'partner',
      name: '반듯설비',
      phone: '01099998888',
      password: 'password1',
      partnerType: 'business',
      bizNo: '1234567891',
    })
    auth.verifyOtp('partner', '01099998888', otp)
    auth.login('partner', '01099998888', 'password1')
    expect(auth.sessionFor('admin')?.accountId).toBe(ADMIN_ID)
    expect(auth.sessionFor('partner')?.name).toBe('반듯설비')
    expect(auth.sessionFor('customer')).toBeUndefined()
    auth.logout('partner')
    expect(auth.sessionFor('admin')).toBeDefined()
  })

  it('저장소 왕복이 유지되고 손상 데이터는 초기화된다', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '01012345678',
      password: 'password1',
    })
    auth.verifyOtp('customer', '01012345678', otp)
    auth.login('customer', '01012345678', 'password1')
    const restored = new AuthService(storage)
    expect(restored.sessionFor('customer')?.name).toBe('김반듯')
    expect(restored.login('customer', '01012345678', 'password1').accountId).toBe('AC-0001')
    // 손상 데이터 → 초기화(예외 없이 빈 상태)
    storage.setItem('banded-auth-v1', '{"version":1,"accounts":[{"id":1}],"accountSeq":"x"}')
    const wiped = new AuthService(storage)
    expect(wiped.sessionFor('customer')).toBeUndefined()
    expect(storage.getItem('banded-auth-v1')).toBeNull()
  })
})

describe('계정 운영 (28-33-01)', () => {
  function signedUp(auth: AuthService, role: 'customer' | 'partner', phone: string) {
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role,
      name: role === 'partner' ? '반듯설비' : '김반듯',
      phone,
      password: 'password1',
      ...(role === 'partner' ? { partnerType: 'business', bizNo: '1234567891' } : {}),
    })
    auth.verifyOtp(role, phone, otp)
    return auth.login(role, phone, 'password1')
  }

  it('비밀번호 변경: 현재 불일치·8자 미만·동일 거부, 변경 후 새 비밀번호로 로그인', () => {
    const auth = new AuthService()
    signedUp(auth, 'customer', '01012345678')
    expect(() => auth.changePassword('customer', 'wrong', 'newpass123')).toThrow('현재 비밀번호')
    expect(() => auth.changePassword('customer', 'password1', 'short')).toThrow('8자')
    expect(() => auth.changePassword('customer', 'password1', 'password1')).toThrow('같습니다')
    auth.changePassword('customer', 'password1', 'newpass123')
    auth.logout('customer')
    expect(() => auth.login('customer', '01012345678', 'password1')).toThrow('일치하지')
    expect(auth.login('customer', '01012345678', 'newpass123').name).toBe('김반듯')
    // 관리자 비밀번호 교체
    auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD)
    auth.changePassword('admin', ADMIN_INITIAL_PASSWORD, 'admin-new-1')
    expect(() => auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD)).toThrow(AuthError)
    expect(auth.login('admin', ADMIN_ID, 'admin-new-1').role).toBe('admin')
  })

  it('계정 목록은 비밀번호를 노출하지 않고, 정지 시 세션 종료 + 로그인 거부, 해제 후 복구', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    signedUp(auth, 'customer', '01012345678')
    const partner = signedUp(auth, 'partner', '01099998888')
    const list = auth.listAccounts()
    expect(list).toHaveLength(2)
    expect(list.every((a) => !('password' in a))).toBe(true)
    expect(auth.accountFor('partner')?.bizNo).toBe('1234567891')
    auth.setSuspended(partner.accountId, true)
    expect(auth.sessionFor('partner')).toBeUndefined()
    expect(auth.sessionFor('customer')).toBeDefined()
    expect(() => auth.login('partner', '01099998888', 'password1')).toThrow('정지된 계정')
    // 저장소 왕복 후에도 정지 유지
    const restored = new AuthService(storage)
    expect(() => restored.login('partner', '01099998888', 'password1')).toThrow('정지된 계정')
    restored.setSuspended(partner.accountId, false)
    expect(restored.login('partner', '01099998888', 'password1').name).toBe('반듯설비')
    expect(() => restored.setSuspended('AC-9999', true)).toThrow('찾을 수 없습니다')
  })
})

describe('파트너 승인 (28-34-01)', () => {
  it('파트너는 가입 시 대기, 승인/거절(사유 필수) 전이, 고객은 승인 대상 아님, 저장소 왕복', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    const c = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '01012345678',
      password: 'password1',
    })
    expect(c.account.approval).toBeUndefined()
    const p = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'partner',
      name: '반듯설비',
      phone: '01099998888',
      password: 'password1',
      partnerType: 'business',
      bizNo: '1234567891',
    })
    expect(p.account.approval).toBe('pending')
    auth.verifyOtp('partner', '01099998888', p.otp)
    auth.login('partner', '01099998888', 'password1')
    expect(auth.partnerApproval()).toEqual({ approval: 'pending' })
    expect(() => auth.approvePartner(c.account.id)).toThrow('파트너 계정만')
    expect(() => auth.rejectPartner(p.account.id, '  ')).toThrow('거절 사유')
    auth.rejectPartner(p.account.id, '사업자 정보 불일치')
    expect(auth.partnerApproval()).toEqual({ approval: 'rejected', rejectReason: '사업자 정보 불일치' })
    // 거절돼도 로그인은 가능(사유 확인용)
    auth.logout('partner')
    expect(auth.login('partner', '01099998888', 'password1').name).toBe('반듯설비')
    auth.approvePartner(p.account.id)
    expect(auth.partnerApproval()).toEqual({ approval: 'approved' })
    const restored = new AuthService(storage)
    expect(restored.listAccounts().find((a) => a.id === p.account.id)?.approval).toBe('approved')
    expect(() => restored.approvePartner('AC-9999')).toThrow('찾을 수 없습니다')
  })
})

describe('파트너 유형·사업자 조회 (28-36-01)', () => {
  it('사업자등록번호 체크섬: 유효/무효/자릿수/동일 숫자 반복', () => {
    expect(isValidBusinessNumber('123-45-67891')).toBe(true)
    expect(isValidBusinessNumber('220-81-62517')).toBe(true)
    expect(isValidBusinessNumber('123-45-67890')).toBe(false)
    expect(isValidBusinessNumber('101-81-12345')).toBe(false)
    expect(isValidBusinessNumber('12345')).toBe(false)
    expect(isValidBusinessNumber('000-00-00000')).toBe(false)
  })

  it('사업자는 조회 통과 필수, 개인은 사업자번호 없이 가입, 저장소 왕복', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: true,
        role: 'partner',
        name: '반듯설비',
        phone: '01099998888',
        password: 'password1',
        partnerType: 'business',
        bizNo: '123-45-67890',
      }),
    ).toThrow('사업자 정보 조회에 실패')
    const biz = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'partner',
      name: '반듯설비',
      phone: '01099998888',
      password: 'password1',
      partnerType: 'business',
      bizNo: '123-45-67891',
    })
    expect(biz.account.partnerType).toBe('business')
    expect(biz.account.bizVerified).toBe(true)
    const solo = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'partner',
      name: '김기술',
      phone: '01077776666',
      password: 'password1',
      partnerType: 'individual',
    })
    expect(solo.account.partnerType).toBe('individual')
    expect(solo.account.bizNo).toBeUndefined()
    expect(solo.account.approval).toBe('pending') // 개인도 관리자 승인 대상
    const restored = new AuthService(storage)
    const list = restored.listAccounts()
    expect(list.find((a) => a.id === biz.account.id)?.bizVerified).toBe(true)
    expect(list.find((a) => a.id === solo.account.id)?.partnerType).toBe('individual')
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: true,
        role: 'partner',
        name: 'x',
        phone: '01055554444',
        password: 'password1',
        // @ts-expect-error 미지의 유형 거부 검증
        partnerType: 'robot',
      }),
    ).toThrow('파트너 유형')
  })
})

describe('약관·개인정보 동의 (28-37-01)', () => {
  it('필수 약관 미동의는 가입 거부, 동의 일시 기록, 마케팅은 선택', () => {
    const auth = new AuthService()
    expect(() =>
      auth.register({
        agreeTerms: false,
        agreePrivacy: true,
        role: 'customer',
        name: '김반듯',
        phone: '01012345678',
        password: 'password1',
      }),
    ).toThrow('필수 약관')
    expect(() =>
      auth.register({
        agreeTerms: true,
        agreePrivacy: false,
        role: 'customer',
        name: '김반듯',
        phone: '01012345678',
        password: 'password1',
      }),
    ).toThrow('필수 약관')
    const { account } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '01012345678',
      password: 'password1',
    })
    expect(account.consent.termsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(account.consent.privacyAt).toBe(account.consent.termsAt)
    expect(account.consent.marketing).toBe(false)
    expect(account.consent.marketingAt).toBeUndefined()
    const m = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      marketing: true,
      role: 'customer',
      name: '이반듯',
      phone: '01087654321',
      password: 'password1',
    })
    expect(m.account.consent.marketing).toBe(true)
    expect(m.account.consent.marketingAt).toBe(m.account.consent.termsAt)
  })

  it('마케팅 수신 동의·철회는 로그인 후 변경, 일시 갱신, 저장소 왕복', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    expect(() => auth.setMarketingOptIn('customer', true)).toThrow('로그인 후')
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '01012345678',
      password: 'password1',
    })
    auth.verifyOtp('customer', '01012345678', otp)
    auth.login('customer', '01012345678', 'password1')
    const on = auth.setMarketingOptIn('customer', true)
    expect(on.marketing).toBe(true)
    expect(on.marketingAt).toBeDefined()
    const off = auth.setMarketingOptIn('customer', false)
    expect(off.marketing).toBe(false)
    expect(off.marketingAt).toBeDefined()
    const reloaded = new AuthService(storage)
    expect(reloaded.accountFor('customer')?.consent.marketing).toBe(false)
    expect(reloaded.accountFor('customer')?.consent.marketingAt).toBe(off.marketingAt)
  })

  it('동의 기록이 없는 손상 스냅샷은 초기화', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '01012345678',
      password: 'password1',
    })
    const snap = JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!) as { accounts: Array<Record<string, unknown>> }
    delete snap.accounts[0]!.consent
    storage.data.set(AUTH_STORAGE_KEY, JSON.stringify(snap))
    const reloaded = new AuthService(storage)
    expect(reloaded.listAccounts()).toHaveLength(0)
    expect(storage.data.has(AUTH_STORAGE_KEY)).toBe(false)
  })
})

describe('정산 계좌 (28-38-01)', () => {
  it('파트너 로그인 후 등록, 형식 검증, 마스킹, 저장소 왕복, 손상 거부', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    expect(() => auth.setPayoutAccount({ bank: '국민은행', number: '1234567890', holder: '반듯설비' })).toThrow(
      '파트너 로그인',
    )
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'partner',
      name: '반듯설비',
      phone: '01099998888',
      password: 'password1',
      partnerType: 'individual',
    })
    auth.verifyOtp('partner', '01099998888', otp)
    auth.login('partner', '01099998888', 'password1')
    expect(() => auth.setPayoutAccount({ bank: ' ', number: '1234567890', holder: '김반듯' })).toThrow('은행')
    expect(() => auth.setPayoutAccount({ bank: '국민은행', number: '123-456', holder: '김반듯' })).toThrow('10~14자리')
    expect(() => auth.setPayoutAccount({ bank: '국민은행', number: '1234567890', holder: '' })).toThrow('예금주')
    // 28-90: 예금주는 가입한 이름과 같아야 한다 — 남의 계좌로 정산받는 길을 막는다
    expect(() => auth.setPayoutAccount({ bank: '국민은행', number: '1234567890', holder: '김반듯' })).toThrow(
      '가입한 이름과 같아야',
    )
    const acc = auth.setPayoutAccount({ bank: '국민은행', number: '123-456-7890123', holder: '반듯 설비' }) // 공백은 무시
    expect(acc.number).toBe('1234567890123')
    expect(acc.verifiedAt).toBeUndefined()
    expect(payoutAccountLabel(acc)).toBe('국민은행 123*******123 (반듯 설비)')
    // 28-90: 관리자 인증 — 기록되고, 계좌를 바꾸면 사라진다
    expect(() => auth.verifyPayoutAccount('AC-9999', 'admin')).toThrow('찾을 수 없습니다')
    const verified = auth.verifyPayoutAccount(auth.accountFor('partner')!.id, 'admin')
    expect(verified.verifiedBy).toBe('admin')
    expect(typeof verified.verifiedAt).toBe('string')
    expect(
      auth.setPayoutAccount({ bank: '국민은행', number: '1234567890123', holder: '반듯설비' }).verifiedAt,
    ).toBeUndefined()
    auth.verifyPayoutAccount(auth.accountFor('partner')!.id, 'admin')
    expect(maskAccountNumber('123456')).toBe('******')
    const reloaded = new AuthService(storage)
    expect(reloaded.accountFor('partner')?.payoutAccount?.bank).toBe('국민은행')
    const snap = JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!) as {
      accounts: Array<{ payoutAccount?: { number: string } }>
    }
    snap.accounts[0]!.payoutAccount!.number = 'abc'
    storage.data.set(AUTH_STORAGE_KEY, JSON.stringify(snap))
    expect(new AuthService(storage).listAccounts()).toHaveLength(0)
  })
})

describe('회원 탈퇴·파기 (28-39-01)', () => {
  it('비밀번호 확인 후 식별 정보 즉시 파기, 세션 종료, 로그인 거부, 같은 번호 재가입 허용', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    expect(() => auth.withdraw('customer', 'password1')).toThrow('로그인 후')
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'partner',
      name: '반듯설비',
      phone: '01099998888',
      password: 'password1',
      partnerType: 'business',
      bizNo: '123-45-67891',
    })
    auth.verifyOtp('partner', '01099998888', otp)
    auth.login('partner', '01099998888', 'password1')
    auth.setPayoutAccount({ bank: '국민은행', number: '1234567890', holder: '반듯설비' })
    expect(() => auth.withdraw('partner', 'wrong')).toThrow('비밀번호가 일치하지')
    const view = auth.withdraw('partner', 'password1')
    expect(view.name).toBe('탈퇴 회원')
    expect(view.phone).toBe('')
    expect(view.bizNo).toBeUndefined()
    expect(view.payoutAccount).toBeUndefined()
    expect(view.withdrawnAt).toMatch(/^\d{4}-/)
    expect(auth.sessionFor('partner')).toBeUndefined()
    expect(auth.consumeNotice()).toContain('탈퇴가 완료')
    expect(auth.consumeNotice()).toBe('')
    expect(() => auth.login('partner', '01099998888', 'password1')).toThrow('일치하지')
    // 같은 번호 재가입 — 탈퇴 계정은 중복 검사에서 제외
    const again = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'partner',
      name: '반듯설비2',
      phone: '01099998888',
      password: 'password1',
      partnerType: 'individual',
    })
    expect(again.account.id).not.toBe(view.id)
    // 저장소 왕복: 탈퇴 기록 보존
    const reloaded = new AuthService(storage)
    expect(reloaded.listAccounts().filter((a) => a.withdrawnAt)).toHaveLength(1)
  })

  it('파기는 탈퇴 계정만, 기록 삭제 후 왕복', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    const { otp, account } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '01012345678',
      password: 'password1',
    })
    expect(() => auth.purgeAccount(account.id)).toThrow('탈퇴한 계정만')
    expect(() => auth.purgeAccount('AC-9999')).toThrow('찾을 수 없습니다')
    auth.verifyOtp('customer', '01012345678', otp)
    auth.login('customer', '01012345678', 'password1')
    auth.withdraw('customer', 'password1')
    auth.purgeAccount(account.id)
    expect(auth.listAccounts()).toHaveLength(0)
    expect(new AuthService(storage).listAccounts()).toHaveLength(0)
  })
})

describe('계정 보안 (28-51)', () => {
  const signup = (auth: AuthService, phone = '01012345678', role: 'customer' | 'partner' = 'customer') => {
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role,
      name: '김반듯',
      phone,
      password: 'password1',
      ...(role === 'partner' ? { partnerType: 'individual' as const } : {}),
    })
    auth.verifyOtp(role, phone, otp)
  }

  it('비밀번호는 해시로만 저장되고 뷰·스냅샷에 평문이 없다, 구 스냅샷(평문)은 로드 시 해시로 마이그레이션 (28-51-01)', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    signup(auth)
    auth.login('customer', '01012345678', 'password1')
    const raw = storage.data.get(AUTH_STORAGE_KEY)!
    expect(raw).not.toContain('password1')
    expect(raw).not.toContain(ADMIN_INITIAL_PASSWORD)
    expect(raw).toContain('"passwordHash":"s256$')
    // 28-89-A: 관리자 해시는 `admins[]` 안으로 옮겨졌다 — 여전히 해시만, 평문은 없다
    expect(raw).toContain('"admins":[{"id":"admin"')
    expect(raw).toMatch(/"passwordHash":"s256\$/)
    expect(raw).not.toContain('"adminPasswordHash"')
    expect(Object.keys(auth.listAccounts()[0]!)).not.toContain('passwordHash')
    expect(Object.keys(auth.accountFor('customer')!)).not.toContain('passwordHash')
    auth.changePassword('customer', 'password1', 'newpass123')
    expect(() => auth.login('customer', '01012345678', 'password1')).toThrow('일치하지')
    expect(auth.login('customer', '01012345678', 'newpass123').accountId).toBe('AC-0001')
    auth.withdraw('customer', 'newpass123')
    expect(storage.data.get(AUTH_STORAGE_KEY)!).toContain('"passwordHash":""')
    // 구 스냅샷 마이그레이션
    const legacy = memoryStorage()
    legacy.data.set(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accountSeq: 1,
        accounts: [
          {
            id: 'AC-0001',
            role: 'customer',
            name: '옛사람',
            phone: '01099998888',
            password: 'oldpass99',
            verified: true,
            consent: { termsAt: 'x', privacyAt: 'x', marketing: false },
            createdAt: 'x',
          },
        ],
        otps: [['customer:01077776666', '123456']],
        sessions: [['customer', { role: 'customer', name: '옛사람', accountId: 'AC-0001' }]],
        adminPassword: 'oldadmin!',
      }),
    )
    const migrated = new AuthService(legacy)
    const after = legacy.data.get(AUTH_STORAGE_KEY)!
    expect(after).not.toContain('oldpass99')
    expect(after).not.toContain('oldadmin!')
    expect(after).not.toContain('"password":')
    expect(migrated.login('customer', '01099998888', 'oldpass99').accountId).toBe('AC-0001')
    expect(migrated.login('admin', 'admin', 'oldadmin!').accountId).toBe('admin')
    expect(migrated.sessionFor('customer')?.expiresAt).toMatch(/^\d{4}-/)
    expect(after).toContain('"issuedAt"')
    expect(after).toContain('"attempts":0')
  })

  it('로그인 5회 실패 → 15분 잠금(맞는 비밀번호도 거부) → 해제 후 성공·카운트 초기화, 관리자 동일 (28-51-02)', () => {
    const auth = new AuthService()
    signup(auth)
    const t0 = Date.parse('2026-09-02T10:00:00Z')
    for (let i = 1; i < LOGIN_MAX_FAILS; i += 1) {
      expect(() => auth.login('customer', '01012345678', 'wrong', t0)).toThrow(`남은 시도 ${LOGIN_MAX_FAILS - i}회`)
    }
    expect(() => auth.login('customer', '010-1234-5678', 'wrong', t0)).toThrow('잠겼습니다')
    expect(auth.lockRemainingMs('customer', '01012345678', t0)).toBe(LOGIN_LOCK_MS)
    expect(() => auth.login('customer', '01012345678', 'password1', t0 + 60_000)).toThrow('14분 후')
    expect(auth.login('customer', '01012345678', 'password1', t0 + LOGIN_LOCK_MS).accountId).toBe('AC-0001')
    expect(auth.lockRemainingMs('customer', '01012345678', t0 + LOGIN_LOCK_MS)).toBe(0)
    expect(() => auth.login('customer', '01012345678', 'wrong', t0 + LOGIN_LOCK_MS)).toThrow('남은 시도 4회')
    auth.login('customer', '01012345678', 'password1', t0 + LOGIN_LOCK_MS)
    expect(() => auth.login('customer', '01012345678', 'wrong', t0 + LOGIN_LOCK_MS)).toThrow('남은 시도 4회')
    for (let i = 0; i < LOGIN_MAX_FAILS; i += 1) {
      try {
        auth.login('admin', 'admin', 'nope', t0)
      } catch {
        /* 카운트 */
      }
    }
    expect(() => auth.login('admin', 'admin', ADMIN_INITIAL_PASSWORD, t0)).toThrow('잠겨 있습니다')
    expect(auth.login('admin', 'admin', ADMIN_INITIAL_PASSWORD, t0 + LOGIN_LOCK_MS + 1).role).toBe('admin')
  })

  it('OTP 5분 만료·5회 시도 초과 시 폐기 (28-51-02)', () => {
    const auth = new AuthService()
    const t0 = Date.now()
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '01012345678',
      password: 'password1',
    })
    expect(() => auth.verifyOtp('customer', '01012345678', otp, t0 + OTP_TTL_MS + 5_000)).toThrow('만료')
    expect(() => auth.verifyOtp('customer', '01012345678', otp, t0)).toThrow('발급된 인증번호가 없습니다')
    const again = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'partner',
      name: '반듯설비',
      phone: '01012345678',
      password: 'password1',
      partnerType: 'individual',
    })
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i += 1) {
      expect(() => auth.verifyOtp('partner', '01012345678', '000000', t0)).toThrow(
        `남은 시도 ${OTP_MAX_ATTEMPTS - i}회`,
      )
    }
    expect(() => auth.verifyOtp('partner', '01012345678', '000000', t0)).toThrow('초과')
    // 29-21-C: 초과해도 **지우지 않는다** — 남이 남의 대기 중 가입을 끝내지 못한다. 잠시 쉬고 다시 받는다
    expect(() => auth.verifyOtp('partner', '01012345678', again.otp, t0)).toThrow('잠시')
    expect(auth.verifyOtp('partner', '01012345678', again.otp, t0 + OTP_LOCK_MS + 1_000).verified).toBe(true)
  })

  it('세션 만료: 고객 24h·관리자 8h, 만료 시 세션 제거 + 게이트 안내 (28-51-03)', () => {
    const auth = new AuthService()
    signup(auth)
    const t0 = Date.parse('2026-09-02T10:00:00Z')
    const s = auth.login('customer', '01012345678', 'password1', t0)
    expect(Date.parse(s.expiresAt) - Date.parse(s.issuedAt)).toBe(SESSION_TTL_MS.customer)
    expect(auth.sessionFor('customer', t0 + SESSION_TTL_MS.customer - 1)?.accountId).toBe('AC-0001')
    expect(auth.sessionFor('customer', t0 + SESSION_TTL_MS.customer)).toBeUndefined()
    expect(auth.consumeNotice()).toContain('만료')
    expect(auth.consumeNotice()).toBe('')
    const a = auth.login('admin', 'admin', ADMIN_INITIAL_PASSWORD, t0)
    expect(Date.parse(a.expiresAt) - t0).toBe(SESSION_TTL_MS.admin)
    expect(auth.sessionFor('admin', t0 + SESSION_TTL_MS.admin + 1)).toBeUndefined()
  })
})

describe('인증 동기화 (28-55-03)', () => {
  it('한 탭의 로그인·로그아웃이 다른 탭에 반영된다', () => {
    const storage = memoryStorage()
    const a = new AuthService(storage)
    const { otp } = a.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '01012345678',
      password: 'password1',
    })
    a.verifyOtp('customer', '01012345678', otp)
    const b = new AuthService(storage)
    expect(b.revision).toBe(a.revision)
    expect(b.syncFromStorage()).toBe(false)
    a.login('customer', '01012345678', 'password1')
    expect(b.sessionFor('customer')).toBeUndefined()
    expect(b.syncFromStorage()).toBe(true)
    expect(b.sessionFor('customer')?.accountId).toBe('AC-0001')
    a.logout('customer')
    expect(b.syncFromStorage()).toBe(true)
    expect(b.sessionFor('customer')).toBeUndefined()
    expect(b.syncFromStorage()).toBe(false)
    expect(storage.data.get(`${AUTH_STORAGE_KEY}:rev`)).toBe(String(a.revision))
  })
})

describe('보안 이벤트 훅 (28-58-03)', () => {
  it('로그인 실패·잠금·비밀번호 변경·탈퇴를 마스킹된 대상으로 통지, 훅이 없거나 던져도 인증 흐름은 그대로', () => {
    expect(maskPhone('010-1234-5678')).toBe('010****5678')
    expect(maskPhone('01012')).toBe('010****')
    expect(maskPhone('')).toBe('(없음)')

    const auth = new AuthService()
    const events: SecurityEvent[] = []
    auth.onSecurityEvent = (e) => void events.push(e)
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '010-1234-5678',
      password: 'password1',
    })
    const account = auth.verifyOtp('customer', '01012345678', otp)

    // 실패 4회 → '로그인 실패', 5회째 → '로그인 잠금'
    for (let i = 0; i < LOGIN_MAX_FAILS - 1; i += 1) {
      expect(() => auth.login('customer', '01012345678', 'wrong-pass')).toThrow(AuthError)
    }
    expect(events).toHaveLength(LOGIN_MAX_FAILS - 1)
    expect(events[0]).toEqual({
      action: '로그인 실패',
      target: '고객 010****5678',
      detail: `남은 시도 ${LOGIN_MAX_FAILS - 1}회`,
    })
    expect(() => auth.login('customer', '01012345678', 'wrong-pass')).toThrow('잠겼습니다')
    const lock = events[events.length - 1]!
    expect(lock.action).toBe('로그인 잠금')
    expect(lock.target).toBe('고객 010****5678')
    expect(lock.detail).toContain(`${LOGIN_MAX_FAILS}회 실패`)
    // 원문 번호·비밀번호는 어디에도 남지 않는다
    expect(JSON.stringify(events)).not.toContain('01012345678')
    expect(JSON.stringify(events)).not.toContain('wrong-pass')

    // 비밀번호 변경·탈퇴
    const auth2 = new AuthService()
    const seen: SecurityEvent[] = []
    auth2.onSecurityEvent = (e) => void seen.push(e)
    const r2 = auth2.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '010-1234-5678',
      password: 'password1',
    })
    const acc2 = auth2.verifyOtp('customer', '01012345678', r2.otp)
    auth2.login('customer', '01012345678', 'password1')
    auth2.changePassword('customer', 'password1', 'password2')
    expect(seen.pop()).toEqual({ action: '비밀번호 변경', target: acc2.id, detail: '고객' })
    auth2.changePassword('admin', ADMIN_INITIAL_PASSWORD, 'admin-next-1')
    // 28-89-A: 관리자가 여럿이라 대상은 아이디, 상세가 역할이다
    expect(seen.pop()).toEqual({ action: '비밀번호 변경', target: 'admin', detail: '관리자' })
    auth2.withdraw('customer', 'password2')
    expect(seen.pop()).toEqual({ action: '회원 탈퇴', target: acc2.id, detail: '고객' })

    // OTP 시도 초과
    const auth3 = new AuthService()
    const otpEvents: SecurityEvent[] = []
    auth3.onSecurityEvent = (e) => void otpEvents.push(e)
    auth3.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'partner',
      name: '반듯설비',
      phone: '010-9999-8888',
      password: 'password1',
      partnerType: 'individual',
    })
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      expect(() => auth3.verifyOtp('partner', '01099998888', '000000')).toThrow(AuthError)
    }
    expect(otpEvents.map((e) => e.action)).toEqual(['OTP 시도 초과'])
    expect(otpEvents[0]!.target).toBe('파트너 010****8888')

    // 훅이 던져도 인증은 성공한다
    const auth4 = new AuthService()
    auth4.onSecurityEvent = () => {
      throw new Error('감사 기록 실패')
    }
    const r4 = auth4.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone: '010-1234-5678',
      password: 'password1',
    })
    auth4.verifyOtp('customer', '01012345678', r4.otp)
    expect(() => auth4.login('customer', '01012345678', 'nope')).toThrow('일치하지 않습니다')
    expect(auth4.login('customer', '01012345678', 'password1').accountId).toBe(account.id)
  })
})

/**
 * 28-70 거울 모드 — 서버 모드의 클라이언트 AuthService. 읽기는 그대로, 변경은 던진다,
 * 서버가 준 세션·계정 뷰를 받아들인다.
 */
describe('거울 모드 (28-70)', () => {
  const session = {
    role: 'customer' as const,
    name: '김고객',
    accountId: 'AC-0007',
    issuedAt: '2026-09-05T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
  }
  const view = {
    id: 'AC-0007',
    role: 'customer' as const,
    name: '김고객',
    phone: '01012345678',
    verified: true,
    consent: { termsAt: '2026-09-05T00:00:00.000Z', privacyAt: '2026-09-05T00:00:00.000Z', marketing: false },
    createdAt: '2026-09-05T00:00:00.000Z',
  }

  it('변경 메서드를 직접 부르면 던진다 — 호출부를 빠뜨리면 조용히 갈라지지 않는다', () => {
    const auth = new AuthService(memoryStorage(), { mirror: true })
    expect(auth.isMirror).toBe(true)
    expect(() => auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD)).toThrow(AuthError)
    expect(() =>
      auth.register({
        role: 'customer',
        name: '김',
        phone: '010-1234-5678',
        password: 'password1',
        agreeTerms: true,
        agreePrivacy: true,
      }),
    ).toThrow(/서버 모드/)
    expect(() => auth.approvePartner('AC-0001')).toThrow(/서버 모드/)
    expect(() => auth.withdraw('customer', 'x')).toThrow(/서버 모드/)
    // 읽기는 그대로
    expect(auth.listAccounts()).toEqual([])
    expect(auth.sessionFor('customer')).toBeUndefined()
  })

  it('서버가 준 세션·계정 뷰를 받아들이고, 렌더 중 읽기(sessionFor·accountFor·listAccounts)가 그것을 본다', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage, { mirror: true })
    auth.adoptSession(session)
    auth.applyMirror([view], false)
    expect(auth.sessionFor('customer')?.accountId).toBe('AC-0007')
    expect(auth.accountFor('customer')?.name).toBe('김고객')
    expect(auth.listAccounts()).toHaveLength(1)
    // 거울에는 해시가 없다 — 어떤 비밀번호도 맞지 않는다(변경 메서드가 막혀 있으니 실제로는 도달하지 않는다)
    expect(JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!).accounts[0].passwordHash).toBe('')
    // 다른 탭(같은 storage)의 거울도 같은 것을 본다 — 28-55-03의 동기화 경로 그대로
    const other = new AuthService(storage, { mirror: true })
    expect(other.sessionFor('customer')?.name).toBe('김고객')
    // upsert: 같은 id는 갱신, complete면 교체
    auth.applyMirror([{ ...view, name: '김고객2' }], false)
    expect(auth.accountFor('customer')?.name).toBe('김고객2')
    auth.applyMirror([{ ...view, id: 'AC-0008', name: '박파트너', role: 'partner' }], true)
    expect(auth.listAccounts().map((a) => a.id)).toEqual(['AC-0008'])
    // 로그아웃은 거울에서도 된다(토큰 폐기는 authActions가 서버에 한다)
    auth.logout('customer')
    expect(auth.sessionFor('customer')).toBeUndefined()
  })

  it('같은 세션·같은 계정 뷰를 다시 받아도 저장하지 않는다 — 탭 사이 storage 핑퐁 방지', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage, { mirror: true })
    auth.adoptSession(session)
    auth.applyMirror([view], false)
    const rev = auth.revision
    auth.adoptSession(session)
    auth.applyMirror([view], false)
    auth.applyMirror([view], true)
    expect(auth.revision).toBe(rev) // 수정 전: 매번 +1 → storage 이벤트 → 다른 탭의 me → 다시 여기로
  })

  it('exportState()는 세션·rev를 빼고 직렬화한다 — 같은 상태면 같은 문자열 (서버 변경 감지)', () => {
    const auth = new AuthService(memoryStorage())
    const before = auth.exportState()
    auth.adoptSession(session) // 세션만 바뀜 → 서버 상태는 그대로
    expect(auth.exportState()).toBe(before)
    expect(JSON.parse(auth.exportState()).sessions).toEqual([])
    expect('rev' in JSON.parse(auth.exportState())).toBe(false)
    auth.register({
      role: 'customer',
      name: '김고객',
      phone: '010-1234-5678',
      password: 'password1',
      agreeTerms: true,
      agreePrivacy: true,
    })
    expect(auth.exportState()).not.toBe(before)
    // 서버가 그 문자열을 Map 저장소에 넣어 다시 만들면 같은 계정을 안다
    const m = new Map<string, string>([[AUTH_STORAGE_KEY, auth.exportState()]])
    const again = new AuthService({
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    })
    expect(again.listAccounts().map((a) => a.phone)).toEqual(['01012345678'])
  })
})

/** 28-71-02: 잠금 키에 범위(요청 IP)를 더하면 남의 IP에서 낸 실패가 내 로그인을 잠그지 않는다 */
describe('잠금 범위 (28-71-02)', () => {
  it('다른 lockScope의 5회 실패는 이 lockScope를 잠그지 않는다 — 관리자도', () => {
    const auth = new AuthService(memoryStorage())
    for (let i = 0; i < LOGIN_MAX_FAILS; i += 1) {
      expect(() => auth.login('admin', ADMIN_ID, 'wrong-pass', 1_000_000 + i, { lockScope: '203.0.113.9' })).toThrow(
        AuthError,
      )
    }
    // 공격자 IP는 잠겼다
    expect(() =>
      auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_100, { lockScope: '203.0.113.9' }),
    ).toThrow(/잠겨/)
    // 운영자 IP는 그대로 들어온다 — 수정 전: 'admin:admin' 키 하나라 잠겼다
    expect(auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_100, { lockScope: '198.51.100.7' }).role).toBe(
      'admin',
    )
    // 범위 없는 호출(로컬 모드)은 예전 키 그대로 — 무변화
    expect(auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_100).role).toBe('admin')
  })

  it('15분 지난 잠금 기록은 저장 전에 지운다 — IP별 키가 영원히 쌓이지 않는다', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    for (let ip = 0; ip < 30; ip += 1) {
      expect(() => auth.login('admin', ADMIN_ID, 'wrong', 1_000_000, { lockScope: `10.0.0.${ip}` })).toThrow(AuthError)
    }
    auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_000 + LOGIN_LOCK_MS + 1, { lockScope: '10.1.1.1' })
    const snap = JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!) as { loginFails: unknown[] }
    expect(snap.loginFails.length).toBeLessThanOrEqual(1) // 수정 전: 30 (오래된 실패 기록이 남았다)
  })

  /**
   * 28-72-02: 28-71-02가 잠금 키에 IP를 넣어 DoS를 막은 대신, IP를 바꾸면 카운터도 바뀌는 상태가 됐다.
   * IP와 무관한 계정 카운터가 그 문을 닫는다.
   */
  it('다른 IP 6곳에서 각 5회 실패하면 30회째에 계정이 잠긴다 — IP를 바꿔도 무한히 시도할 수 없다', () => {
    const auth = new AuthService(memoryStorage())
    let attempts = 0
    let lastMessage = ''
    outer: for (let ip = 0; ip < 6; ip += 1) {
      for (let i = 0; i < 5; i += 1) {
        try {
          auth.login('admin', ADMIN_ID, 'wrong', 1_000_000, { lockScope: `203.0.113.${ip}` })
        } catch (e) {
          attempts += 1
          lastMessage = (e as AuthError).message
          if (attempts === 30) break outer
        }
      }
    }
    expect(attempts).toBe(30)
    expect(lastMessage).toMatch(/여러 곳에서 30회 실패해 이 계정이 15분간 잠겼습니다/)
    // 그리고 **아직 한 번도 쓰지 않은** IP에서도 잠겨 있다 — 수정 전: 그 IP는 멀쩡히 5회를 더 쓸 수 있었다
    expect(() =>
      auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_100, { lockScope: '198.51.100.77' }),
    ).toThrow(/잠겨/)
  })

  /**
   * 28-73-03: 28-72-02의 계정 카운터는 무차별 대입을 막았지만, 고정 아이디인 관리자에게는
   * "누구나 30회로 운영을 멈춘다"가 됐다. 최근 성공한 IP는 계정 잠금에서 면제한다.
   */
  it('계정이 잠겨도 최근 성공한 IP는 로그인된다 — 남이 운영자를 잠글 수 없다', () => {
    const auth = new AuthService(memoryStorage())
    const mine = '198.51.100.7'
    // 운영자가 자기 자리에서 한 번 성공해 둔다
    expect(auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_000, { lockScope: mine }).role).toBe('admin')
    // 공격자가 다른 IP 6곳에서 30회 실패시켜 계정을 잠근다
    let attempts = 0
    outer: for (let ip = 0; ip < 6; ip += 1) {
      for (let i = 0; i < 5; i += 1) {
        try {
          auth.login('admin', ADMIN_ID, 'wrong', 1_000_100, { lockScope: `203.0.113.${ip}` })
        } catch {
          attempts += 1
        }
        if (attempts === 30) break outer
      }
    }
    expect(attempts).toBe(30)
    // 처음 보는 IP는 막힌다
    expect(() =>
      auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_200, { lockScope: '203.0.113.99' }),
    ).toThrow(/잠겨/)
    // 그러나 운영자의 IP는 들어온다 — 수정 전: 여기서도 잠겼다
    expect(auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_200, { lockScope: mine }).role).toBe('admin')
  })

  it('면제는 (계정, IP) 5회 잠금까지 풀지는 않는다', () => {
    const auth = new AuthService(memoryStorage())
    const mine = '198.51.100.7'
    auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_000, { lockScope: mine })
    for (let i = 0; i < 5; i += 1) {
      expect(() => auth.login('admin', ADMIN_ID, 'wrong', 1_000_100 + i, { lockScope: mine })).toThrow(AuthError)
    }
    // 그 IP 자체가 5회로 잠겼다 — 면제는 계정 잠금에만 적용된다
    expect(() => auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_200, { lockScope: mine })).toThrow(/잠겨/)
  })

  it('최근 성공 IP는 스냅샷에 남아 다시 만든 서비스에서도 면제된다', () => {
    const storage = memoryStorage()
    const mine = '198.51.100.7'
    const a = new AuthService(storage)
    a.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_000, { lockScope: mine })
    let attempts = 0
    outer2: for (let ip = 0; ip < 6; ip += 1) {
      for (let i = 0; i < 5; i += 1) {
        try {
          a.login('admin', ADMIN_ID, 'wrong', 1_000_100, { lockScope: `203.0.113.${ip}` })
        } catch {
          attempts += 1
        }
        if (attempts === 30) break outer2
      }
    }
    const b = new AuthService(storage) // 서버리스의 다른 인스턴스처럼 같은 행에서 다시 만든다
    expect(b.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_200, { lockScope: mine }).role).toBe('admin')
  })

  /**
   * 28-74 리뷰(Copilot): 스냅샷의 `trustedIps` 복원 검증이 `typeof at === 'number'`뿐이라
   * 손상·조작된 값이 그대로 Map에 남았다. `Infinity`가 그중 최악이다 — `now - Infinity`는
   * `-Infinity`라 TTL 비교를 **항상** 통과해, 그 IP는 계정 잠금을 영원히 면제받는다.
   * (JSON에는 Infinity가 없지만 `1e999`가 파싱되면 Infinity가 된다.)
   */
  it('손상된 신뢰 IP(무한대 시각)는 불러올 때 버려진다 — 계정 잠금을 영원히 면제하지 않는다 (28-74 리뷰)', () => {
    const storage = memoryStorage()
    const evil = '203.0.113.200'
    const a = new AuthService(storage)
    a.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_000, { lockScope: evil }) // 정상 경로로 형태를 만든다
    // 28-77-02: 키가 가명이 되었으므로 원문 IP로 문자열 치환하지 않는다 — 자리로 찾아 바꾼다
    const snap = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) ?? '{}')
    expect(snap.trustedIps[0][1][0][1]).toBe(1_000_000) // 자리가 맞다(직렬화 형태가 바뀌면 여기서 잡힌다)
    snap.trustedIps[0][1][0][1] = '__INF__'
    const tampered = JSON.stringify(snap).replace('"__INF__"', '1e999')
    expect(JSON.parse(tampered).trustedIps[0][1][0][1]).toBe(Infinity)
    storage.setItem(AUTH_STORAGE_KEY, tampered)

    const b = new AuthService(storage)
    let attempts = 0
    outerInf: for (let ip = 0; ip < 6; ip += 1) {
      for (let i = 0; i < 5; i += 1) {
        try {
          b.login('admin', ADMIN_ID, 'wrong', 2_000_000, { lockScope: `198.51.100.${ip}` })
        } catch {
          attempts += 1
        }
        if (attempts === 30) break outerInf
      }
    }
    expect(attempts).toBe(30)
    // 수정 전: Infinity가 살아남아 이 IP만 잠금을 통과했다(TTL이 아무 의미가 없다)
    expect(() => b.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 2_000_100, { lockScope: evil })).toThrow(/잠겨/)
  })

  /**
   * 28-74-02: `trustedIps`의 키는 `acct|${role}:${전화번호}`다 — **전화번호가 그대로 들어 있다**.
   * `purgeAccount`는 계정 행만 지우고, TTL 30일은 `rememberTrustedIp`(=다시 성공 로그인) 안에서만
   * 적용된다. 파기된 계정은 다시 로그인하지 않으므로 그 번호가 스냅샷에 영원히 남는다.
   * 서버 모드에서는 그것이 `auth_state` 행이라 DB에 남는다 — 28-40의 파기 약속이 뚫린다.
   */
  it('파기하면 그 계정의 신뢰 IP도 사라진다 — 전화번호가 스냅샷에 남지 않는다 (28-74-02)', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    const phone = '01055556666'
    const { otp, account } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김반듯',
      phone,
      password: 'password1',
    })
    auth.verifyOtp('customer', phone, otp)
    auth.login('customer', phone, 'password1', 1_000_000, { lockScope: '198.51.100.7' })
    expect(storage.getItem(AUTH_STORAGE_KEY) ?? '').toContain(phone) // 아직은 당연히 있다

    auth.withdraw('customer', 'password1')
    auth.purgeAccount(account.id)
    expect(auth.listAccounts()).toHaveLength(0)
    // 수정 전: trustedIps 키 `acct|customer:01055556666`가 남아 여기서 실패했다
    expect(storage.getItem(AUTH_STORAGE_KEY) ?? '').not.toContain(phone)
  })

  it('30일 지난 신뢰 IP는 다음 로그인 때 쓸려 나간다 — 다시 안 쓰는 계정도 (28-74-02)', () => {
    const storage = memoryStorage()
    const a = new AuthService(storage)
    const gone = '01077778888'
    const { otp } = a.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '떠난이',
      phone: gone,
      password: 'password1',
    })
    a.verifyOtp('customer', gone, otp)
    a.login('customer', gone, 'password1', 1_000_000, { lockScope: '198.51.100.9' })
    a.withdraw('customer', 'password1') // 계정은 남지만 다시 로그인하지 않는다

    // 31일 뒤 **다른 사람**이 로그인한다 — 그때 오래된 항목이 정리되어야 한다
    const later = 1_000_000 + 31 * 24 * 60 * 60 * 1000
    a.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, later, { lockScope: '203.0.113.5' })
    const snap = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) ?? '{}')
    const keys: string[] = (snap.trustedIps ?? []).map((e: [string, unknown]) => e[0])
    // 수정 전: `acct|customer:01077778888`이 그대로 남았다 (TTL은 그 계정이 다시 성공할 때만 돈다)
    expect(keys).not.toContain(`acct|customer:${gone}`)
    // 28-89-A: 관리자도 아이디별 가명 키다 — 한 관리자의 실패가 다른 관리자를 잠그지 않는다
    expect(keys.some((k) => k.startsWith('acct|admin:'))).toBe(true) // 방금 성공한 것은 남는다
  })

  /**
   * 28-74-03: 프록시 헤더가 없으면 서버는 모든 요청에 같은 `'unknown'`을 준다. 그 값으로 신뢰 IP를
   * 기록하면 그 뒤 **누구나** 그 계정의 계정 잠금(30회)에서 면제된다. 도메인 쪽 방어선을 하나 둔다 —
   * 경계(api/auth.ts)에서 `undefined`로 넘기는 것이 본 수정이고, 이것은 그 계약을 고정하는 테스트다.
   */
  it('범위 없이 성공한 로그인은 신뢰 IP를 남기지 않는다 (28-74-03)', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_000) // lockScope 없음 = 믿을 수 없는 환경
    const snap = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) ?? '{}')
    expect(snap.trustedIps ?? []).toHaveLength(0)
    // 그래서 계정 잠금도 그대로 걸린다 — 면제가 조용히 열리지 않는다
    let attempts = 0
    outerNoScope: for (let ip = 0; ip < 7; ip += 1) {
      for (let i = 0; i < 5; i += 1) {
        try {
          auth.login('admin', ADMIN_ID, 'wrong', 1_000_100, { lockScope: `203.0.113.${ip}` })
        } catch {
          attempts += 1
        }
        if (attempts === 30) break outerNoScope
      }
    }
    expect(() =>
      auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_200, { lockScope: '203.0.113.99' }),
    ).toThrow(/잠겨/)
  })

  /**
   * 28-75-03: `pruneTrustedIps`가 로그인마다 **모든 계정 × 모든 IP**를 훑는다. 계정 1만이면 로그인 시도
   * 한 번에 5만 번의 Map 연산이고, 무차별 대입은 정확히 그 시도를 많이 만든다 — 막으려는 공격이 CPU를
   * 계정 수만큼 증폭해 먹는 구조다. 28-72 리뷰가 같은 모양(중복 prune)을 지적했고 28-73이 없앴다.
   *
   * 만료의 목적은 "영영 남지 않게"이지 밀리초 정확도가 아니므로 **시간 게이트**를 둔다. 게이트는
   * 스냅샷에 남아야 한다 — 서버 모드는 요청마다 AuthService를 새로 만들기 때문에, 메모리에만 두면
   * 게이트가 없는 것과 같다.
   */
  it('스윕은 게이트 간격으로만 돈다 — 그 사이에는 훑지 않는다 (28-75-03)', () => {
    const storage = memoryStorage()
    const a = new AuthService(storage)
    const stale = '01033334444'
    const { otp } = a.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '휴면',
      phone: stale,
      password: 'password1',
    })
    a.verifyOtp('customer', stale, otp)
    a.login('customer', stale, 'password1', 1_000_000, { lockScope: '198.51.100.3' })

    const snapAt = (): { keys: string[]; sweptAt: number | undefined } => {
      const snap = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) ?? '{}')
      return {
        keys: ((snap.trustedIps ?? []) as Array<[string, unknown]>).map((e) => e[0]),
        sweptAt: snap.trustedSweptAt,
      }
    }
    const staleKey = snapAt().keys[0] ?? ''
    expect(snapAt().keys).toHaveLength(1) // 이 계정의 신뢰 IP 항목이 생겼다
    expect(staleKey).not.toContain(stale) // 28-77-02: 키에 번호가 없다
    const firstSweep = snapAt().sweptAt
    expect(typeof firstSweep).toBe('number') // 수정 전: undefined (게이트 자체가 없다)

    // 31일 뒤 — 만료 대상이지만 게이트 간격 안이 아니라 **바로 다음 로그인**에서 훑였다(수정 전)
    const later = 1_000_000 + 31 * 24 * 60 * 60 * 1000
    a.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, later, { lockScope: '203.0.113.5' })
    expect(snapAt().keys).not.toContain(staleKey) // 게이트가 열렸으니 이번엔 쓸린다
    const secondSweep = snapAt().sweptAt
    expect(secondSweep).toBe(later)

    // 곧바로 또 로그인 — 게이트 안이라 스윕 시각이 움직이지 않는다(= 훑지 않았다)
    a.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, later + 60_000, { lockScope: '203.0.113.5' })
    expect(snapAt().sweptAt).toBe(secondSweep)
  })

  it('게이트가 있어도 만료된 IP는 면제되지 않는다 — 아직 안 지웠을 뿐이다 (28-75-03)', () => {
    const storage = memoryStorage()
    const a = new AuthService(storage)
    const mine = '198.51.100.8'
    a.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_000, { lockScope: mine })
    const later = 1_000_000 + 31 * 24 * 60 * 60 * 1000
    let attempts = 0
    outerGate: for (let ip = 0; ip < 7; ip += 1) {
      for (let i = 0; i < 5; i += 1) {
        try {
          a.login('admin', ADMIN_ID, 'wrong', later, { lockScope: `203.0.113.${ip}` })
        } catch {
          attempts += 1
        }
        if (attempts === 30) break outerGate
      }
    }
    // 30일이 지났으므로 이 IP는 더 이상 신뢰 대상이 아니다 — 스윕이 돌았든 아니든
    expect(() => a.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, later + 100, { lockScope: mine })).toThrow(/잠겨/)
  })

  it('계정 카운터가 있어도 28-71-02는 그대로 — 남의 IP 5회가 내 IP를 잠그지 않는다', () => {
    const auth = new AuthService(memoryStorage())
    for (let i = 0; i < 5; i += 1) {
      expect(() => auth.login('admin', ADMIN_ID, 'wrong', 1_000_000 + i, { lockScope: '203.0.113.9' })).toThrow(
        AuthError,
      )
    }
    expect(() =>
      auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_100, { lockScope: '203.0.113.9' }),
    ).toThrow(/잠겨/)
    // 5회는 계정 상한(30) 아래라 다른 IP는 여전히 들어올 수 있다
    expect(auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_100, { lockScope: '198.51.100.7' }).role).toBe(
      'admin',
    )
  })

  it('잠긴 기록도 마지막 실패로부터 15분이면 지워진다 — lockedUntil 기준이면 30분이 된다 (28-72 리뷰)', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    for (let i = 0; i < 5; i += 1) {
      // 5회 → 잠김(lockedUntil = 1_000_000 + 15분)
      expect(() => auth.login('admin', ADMIN_ID, 'wrong', 1_000_000, { lockScope: '10.0.0.1' })).toThrow(AuthError)
    }
    // 잠금이 막 풀린 시각. 이때 기록은 더 남을 이유가 없다.
    auth.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, 1_000_000 + LOGIN_LOCK_MS + 1, { lockScope: '10.9.9.9' })
    const snap = JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!) as { loginFails: [string, unknown][] }
    expect(snap.loginFails.map(([k]) => k)).not.toContain('admin:admin:10.0.0.1') // 수정 전: 남아 있다
  })
})

describe('28-77: 게이트가 실제로 남게 · 키에 식별자를 남기지 않게', () => {
  const signup = (auth: AuthService, phone: string, now: number) => {
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김고객',
      phone,
      password: 'password1',
    })
    auth.verifyOtp('customer', phone, otp, now)
  }

  it('28-77-01: 던지는 경로(정지된 계정)에서도 스윕 게이트가 저장된다', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    const t0 = 1_700_000_000_000
    signup(auth, '01044445555', t0)
    auth.login('customer', '01044445555', 'password1', t0, { lockScope: '203.0.113.5' })
    const swept0 = (JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!) as { trustedSweptAt?: number }).trustedSweptAt
    expect(swept0).toBe(t0) // 성공 로그인은 저장한다 — 여기까지는 28-75-03대로다

    const admin = new AuthService(storage) // 같은 저장소를 보는 관리자 인스턴스
    admin.login('admin', ADMIN_ID, ADMIN_INITIAL_PASSWORD, t0 + 1_000)
    const target = admin.listAccounts().find((a) => a.phone === '01044445555')!
    admin.setSuspended(target.id, true)

    const later = t0 + 3 * 60 * 60 * 1000 // 게이트(1시간)를 훌쩍 넘긴 뒤
    const auth2 = new AuthService(storage)
    expect(() => auth2.login('customer', '01044445555', 'password1', later, { lockScope: '203.0.113.5' })).toThrow(
      /정지/,
    )
    const sweptAfter = (JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!) as { trustedSweptAt?: number }).trustedSweptAt
    // 수정 전: 스윕은 돌았는데(메모리) 저장되지 않아 옛 시각 그대로다 → 다음 요청이 또 훑는다
    expect(sweptAfter).toBe(later)
  })

  it('28-77-02: 잠금·신뢰 IP 키에 원문 전화번호와 IP가 남지 않는다', () => {
    const storage = memoryStorage()
    const auth = new AuthService(storage)
    const t0 = 1_700_000_000_000
    signup(auth, '01066667777', t0)
    auth.login('customer', '01066667777', 'password1', t0, { lockScope: '198.51.100.42' })
    expect(() => auth.login('customer', '01066667777', 'nope-nope', t0 + 1, { lockScope: '198.51.100.42' })).toThrow(
      AuthError,
    )

    const raw = storage.data.get(AUTH_STORAGE_KEY)!
    const snap = JSON.parse(raw) as {
      loginFails: Array<[string, unknown]>
      trustedIps: Array<[string, Array<[string, number]>]>
    }
    const keys = [
      ...snap.loginFails.map(([k]) => k),
      ...snap.trustedIps.flatMap(([k, v]) => [k, ...v.map(([ip]) => ip)]),
    ]
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) {
      expect(k).not.toContain('01066667777')
      expect(k).not.toContain('198.51.100.42')
    }
    // 계정 목록의 전화번호는 로그인 식별자라 그대로다 — 이 항목이 없애는 것은 **IP와의 결합**이다
    expect(raw).toContain('01066667777')
  })

  it('28-77-02: 가명 키로도 면제와 잠금이 그대로 동작한다', () => {
    const auth = new AuthService(memoryStorage())
    const t0 = 1_700_000_000_000
    signup(auth, '01088889999', t0)
    auth.login('customer', '01088889999', 'password1', t0, { lockScope: '203.0.113.7' }) // 신뢰 IP 등록
    for (let i = 0; i < 30; i += 1) {
      // 남의 IP에서 계정 잠금
      expect(() =>
        auth.login('customer', '01088889999', 'wrong', t0 + 1_000 + i, { lockScope: `10.9.9.${i % 250}` }),
      ).toThrow(AuthError)
    }
    expect(() => auth.login('customer', '01088889999', 'password1', t0 + 2_000, { lockScope: '10.9.9.1' })).toThrow(
      /잠겨/,
    )
    expect(auth.login('customer', '01088889999', 'password1', t0 + 2_000, { lockScope: '203.0.113.7' }).role).toBe(
      'customer',
    )
  })

  it('28-77-02: 옛 평문 키는 불러올 때 버린다 (면제가 잠금 쪽으로 안전하게 풀린다)', () => {
    const storage = memoryStorage()
    const seed = new AuthService(storage)
    const t0 = 1_700_000_000_000
    signup(seed, '01033332222', t0)
    const snap = JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!) as Record<string, unknown>
    snap.trustedIps = [['acct|customer:01033332222', [['203.0.113.99', t0]]]]
    snap.loginFails = [['customer:01033332222:203.0.113.99', { count: 3, lastAt: t0 }]]
    storage.data.set(AUTH_STORAGE_KEY, JSON.stringify(snap))

    const loaded = new AuthService(storage)
    loaded.login('customer', '01033332222', 'password1', t0 + 10, { lockScope: '203.0.113.99' })
    const after = JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!) as {
      loginFails: Array<[string, unknown]>
      trustedIps: Array<[string, unknown]>
    }
    for (const [k] of [...after.loginFails, ...after.trustedIps]) {
      expect(k).not.toContain('01033332222')
    }
  })
})

describe('28-78-03: 가명 키에 설치별 소금', () => {
  const signup = (auth: AuthService, phone: string, now: number) => {
    const { otp } = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김고객',
      phone,
      password: 'password1',
    })
    auth.verifyOtp('customer', phone, otp, now)
  }
  const keysOf = (storage: ReturnType<typeof memoryStorage>) => {
    const snap = JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!) as {
      trustedIps: Array<[string, Array<[string, number]>]>
    }
    return snap.trustedIps.flatMap(([k, v]) => [k, ...v.map(([ip]) => ip)])
  }

  it('같은 번호·같은 IP라도 설치가 다르면 다른 해시다 (상호 대조 차단)', () => {
    const t0 = 1_700_000_000_000
    const a = memoryStorage()
    const b = memoryStorage()
    for (const st of [a, b]) {
      const auth = new AuthService(st)
      signup(auth, '01055556666', t0)
      auth.login('customer', '01055556666', 'password1', t0, { lockScope: '203.0.113.77' })
    }
    // 수정 전: 소금이 없어 두 배포의 키가 글자 하나까지 같다 — 번호를 몰라도 "같은 사람"이 읽힌다
    expect(keysOf(a)).not.toEqual(keysOf(b))
    expect(keysOf(a)).toHaveLength(2)
  })

  it('같은 설치 안에서는 그대로 동작한다 — 면제도 잠금도', () => {
    const storage = memoryStorage()
    const t0 = 1_700_000_000_000
    const auth = new AuthService(storage)
    signup(auth, '01077778888', t0)
    auth.login('customer', '01077778888', 'password1', t0, { lockScope: '203.0.113.8' })
    const reloaded = new AuthService(storage) // 소금이 스냅샷에서 복원된다
    for (let i = 0; i < 30; i += 1) {
      expect(() =>
        reloaded.login('customer', '01077778888', 'wrong', t0 + 1_000 + i, { lockScope: `10.8.8.${i % 250}` }),
      ).toThrow(AuthError)
    }
    expect(() => reloaded.login('customer', '01077778888', 'password1', t0 + 2_000, { lockScope: '10.8.8.1' })).toThrow(
      /잠겨/,
    )
    expect(reloaded.login('customer', '01077778888', 'password1', t0 + 2_000, { lockScope: '203.0.113.8' }).role).toBe(
      'customer',
    )
  })
})

describe('28-89-A: 관리자 계정과 등급', () => {
  const OWNER_PW = 'owner-pass-1'
  function withOwner(): AuthService {
    const auth = new AuthService(memoryStorage())
    auth.changePassword('admin', ADMIN_INITIAL_PASSWORD, OWNER_PW)
    return auth
  }

  it('처음 상태는 소유자 admin 하나다 — 로그인하면 세션에 등급이 실린다', () => {
    const auth = new AuthService(memoryStorage())
    expect(auth.listAdmins().map((a) => [a.id, a.grade])).toEqual([['admin', 'owner']])
    const s = auth.login('admin', 'admin', ADMIN_INITIAL_PASSWORD)
    // 수정 전: AuthSession 에 grade 가 없었다 — 누가 들어오든 전부 할 수 있었다
    expect(s.grade).toBe('owner')
    expect(s.accountId).toBe('admin')
  })

  it('구 스냅샷(adminPasswordHash)은 소유자 admin 으로 옮겨진다 — 비밀번호가 그대로 통한다', () => {
    const storage = memoryStorage()
    const old = new AuthService(storage)
    old.changePassword('admin', ADMIN_INITIAL_PASSWORD, OWNER_PW)
    const snap = JSON.parse(storage.data.get(AUTH_STORAGE_KEY) as string) as Record<string, unknown>
    const hash = (snap['admins'] as Array<{ passwordHash: string }>)[0]?.passwordHash
    delete snap['admins']
    snap['adminPasswordHash'] = hash // 28-88 까지의 모양
    storage.data.set(AUTH_STORAGE_KEY, JSON.stringify(snap))
    const migrated = new AuthService(storage)
    expect(migrated.listAdmins().map((a) => [a.id, a.grade])).toEqual([['admin', 'owner']])
    expect(migrated.login('admin', 'admin', OWNER_PW).grade).toBe('owner')
  })

  it('소유자만 관리자를 추가한다 — 매니저·열람은 거부된다', () => {
    const auth = withOwner()
    const v = auth.addAdmin('admin', { id: 'Viewer-1', name: '열람이', grade: 'viewer', password: 'viewer-pass-1' })
    expect(v.id).toBe('viewer-1') // 소문자로 정규화
    expect(v.createdBy).toBe('admin')
    auth.addAdmin('admin', { id: 'mgr', name: '매니저', grade: 'manager', password: 'manager-pass-1' })
    expect(() => auth.addAdmin('mgr', { id: 'x1', name: 'x', grade: 'viewer', password: 'password-1' })).toThrow(
      '소유자만',
    )
    expect(() => auth.addAdmin('viewer-1', { id: 'x1', name: 'x', grade: 'viewer', password: 'password-1' })).toThrow(
      '소유자만',
    )
    expect(() => auth.addAdmin('nobody', { id: 'x1', name: 'x', grade: 'viewer', password: 'password-1' })).toThrow(
      '소유자만',
    )
    // 형식·중복·비밀번호 길이
    expect(() => auth.addAdmin('admin', { id: 'ab', name: 'x', grade: 'viewer', password: 'password-1' })).toThrow(
      '3~20자',
    )
    expect(() => auth.addAdmin('admin', { id: 'mgr', name: 'x', grade: 'viewer', password: 'password-1' })).toThrow(
      '이미 있는',
    )
    expect(() => auth.addAdmin('admin', { id: 'ok1', name: 'x', grade: 'viewer', password: 'short' })).toThrow('8자')
    expect(auth.listAdmins().map((a) => a.id)).toEqual(['admin', 'viewer-1', 'mgr'])
    // 비밀번호 해시는 목록에 나가지 않는다
    expect(JSON.stringify(auth.listAdmins())).not.toContain('passwordHash')
  })

  it('추가된 관리자는 자기 아이디·비밀번호로 로그인하고 등급을 받는다', () => {
    const auth = withOwner()
    auth.addAdmin('admin', { id: 'mgr', name: '매니저', grade: 'manager', password: 'manager-pass-1' })
    const s = auth.login('admin', 'mgr', 'manager-pass-1')
    expect(s.grade).toBe('manager')
    expect(s.name).toBe('매니저')
    expect(() => auth.login('admin', 'mgr', OWNER_PW)).toThrow()
    expect(() => auth.login('admin', 'ghost', 'manager-pass-1')).toThrow()
  })

  it('등급 변경 — 마지막 소유자는 내릴 수 없고, 로그인 중인 세션의 등급은 따라간다', () => {
    const auth = withOwner()
    auth.addAdmin('admin', { id: 'mgr', name: '매니저', grade: 'manager', password: 'manager-pass-1' })
    expect(() => auth.setAdminGrade('admin', 'admin', 'manager')).toThrow('마지막 소유자')
    auth.setAdminGrade('admin', 'mgr', 'owner')
    auth.setAdminGrade('admin', 'admin', 'manager') // 이제 소유자가 둘이라 내릴 수 있다
    expect(auth.adminGradeOf('admin')).toBe('manager')
    expect(() => auth.setAdminGrade('admin', 'mgr', 'viewer')).toThrow('소유자만') // 내린 뒤에는 못 만진다
    // 로그인 중인 관리자의 등급이 바뀌면 그 세션도 바뀐다 (로컬 모드)
    auth.logout('admin')
    auth.login('admin', 'admin', OWNER_PW)
    expect(auth.sessionFor('admin')?.grade).toBe('manager')
    auth.setAdminGrade('mgr', 'admin', 'owner')
    expect(auth.sessionFor('admin')?.grade).toBe('owner')
  })

  it('제거 — 자기 자신·마지막 소유자는 안 되고, 제거된 관리자의 로컬 세션은 끝난다', () => {
    const auth = withOwner()
    auth.addAdmin('admin', { id: 'vw1', name: '열람', grade: 'viewer', password: 'viewer-pass-1' })
    expect(() => auth.removeAdmin('admin', 'admin')).toThrow('자기 자신')
    expect(() => auth.removeAdmin('vw1', 'admin')).toThrow('소유자만')
    auth.login('admin', 'vw1', 'viewer-pass-1')
    expect(auth.sessionFor('admin')?.accountId).toBe('vw1')
    auth.removeAdmin('admin', 'vw1')
    expect(auth.sessionFor('admin')).toBeUndefined()
    expect(auth.listAdmins().map((a) => a.id)).toEqual(['admin'])
    expect(() => auth.login('admin', 'vw1', 'viewer-pass-1')).toThrow()
  })

  it('비밀번호 초기화는 소유자만 — 초기화 뒤 옛 비밀번호는 통하지 않는다', () => {
    const auth = withOwner()
    auth.addAdmin('admin', { id: 'mgr', name: '매니저', grade: 'manager', password: 'manager-pass-1' })
    expect(() => auth.resetAdminPassword('mgr', 'admin', 'new-pass-123')).toThrow('소유자만')
    expect(() => auth.resetAdminPassword('admin', 'mgr', 'short')).toThrow('8자')
    auth.resetAdminPassword('admin', 'mgr', 'new-pass-123')
    expect(() => auth.login('admin', 'mgr', 'manager-pass-1')).toThrow()
    expect(auth.login('admin', 'mgr', 'new-pass-123').grade).toBe('manager')
  })

  it('잠금은 관리자 아이디별이다 — 한 관리자를 잠가도 다른 관리자는 들어온다', () => {
    const auth = withOwner()
    auth.addAdmin('admin', { id: 'mgr', name: '매니저', grade: 'manager', password: 'manager-pass-1' })
    for (let i = 0; i < LOGIN_MAX_FAILS; i += 1)
      expect(() => auth.login('admin', 'mgr', 'wrong-pass', 1_000_000 + i)).toThrow()
    expect(() => auth.login('admin', 'mgr', 'manager-pass-1', 1_000_000 + LOGIN_MAX_FAILS)).toThrow('잠')
    // 수정 전: 관리자 잠금 키가 'admin' 하나라 mgr 의 실패가 admin 도 잠갔다
    expect(auth.login('admin', 'admin', OWNER_PW, 1_000_000 + LOGIN_MAX_FAILS).grade).toBe('owner')
  })

  it('관리자 계정 변경은 전부 보안 이벤트로 남는다', () => {
    const auth = withOwner()
    const events: SecurityEvent[] = []
    auth.onSecurityEvent = (e) => events.push(e)
    auth.addAdmin('admin', { id: 'mgr', name: '매니저', grade: 'manager', password: 'manager-pass-1' })
    auth.setAdminGrade('admin', 'mgr', 'viewer')
    auth.resetAdminPassword('admin', 'mgr', 'new-pass-123')
    auth.removeAdmin('admin', 'mgr')
    expect(events.map((e) => e.action)).toEqual([
      '관리자 추가',
      '관리자 등급 변경',
      '관리자 비밀번호 초기화',
      '관리자 제거',
    ])
    expect(events.every((e) => e.target === 'mgr')).toBe(true)
  })

  it('거울(서버 모드)은 관리자 목록도 받는다', () => {
    const server = withOwner()
    server.addAdmin('admin', { id: 'mgr', name: '매니저', grade: 'manager', password: 'manager-pass-1' })
    const mirror = new AuthService(memoryStorage())
    mirror.applyMirror(server.listAccounts(), true, server.listAdmins())
    expect(mirror.listAdmins().map((a) => a.id)).toEqual(['admin', 'mgr'])
  })
})

describe('비밀번호 재설정 (29-12)', () => {
  const signedUp = () => {
    const auth = new AuthService()
    const r = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김고객',
      phone: '010-1234-5678',
      password: 'password1',
    })
    auth.verifyOtp('customer', '01012345678', r.otp)
    return auth
  }

  it('가입용 인증번호로는 비밀번호를 바꿀 수 없다 — 목적이 섞이면 가입 확인이 곧 비밀번호 변경이 된다', () => {
    const auth = new AuthService()
    const r = auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김고객',
      phone: '01012345678',
      password: 'password1',
    })
    // 아직 재설정을 요청하지 않았다. 가입용 인증번호가 그대로 통하면 안 된다
    expect(() => auth.resetPassword('customer', '01012345678', r.otp, 'newpass12')).toThrow(
      '발급된 인증번호가 없습니다',
    )
  })

  it('재설정용 인증번호로는 가입을 끝낼 수 없다 — 반대 방향도 막는다', () => {
    const auth = new AuthService()
    auth.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김고객',
      phone: '01012345678',
      password: 'password1',
    })
    const reset = auth.requestPasswordReset('customer', '01012345678')
    expect(() => auth.verifyOtp('customer', '01012345678', reset.otp)).toThrow('일치하지 않습니다')
  })

  it('재설정 뒤에는 새 비밀번호로만 들어온다', () => {
    const auth = signedUp()
    const { otp } = auth.requestPasswordReset('customer', '01012345678')
    auth.resetPassword('customer', '01012345678', otp, 'newpass12')
    expect(() => auth.login('customer', '01012345678', 'password1')).toThrow('일치하지 않습니다')
    expect(auth.login('customer', '01012345678', 'newpass12').role).toBe('customer')
  })

  it('한 번 쓴 재설정 인증번호는 다시 쓰이지 않는다', () => {
    const auth = signedUp()
    const { otp } = auth.requestPasswordReset('customer', '01012345678')
    auth.resetPassword('customer', '01012345678', otp, 'newpass12')
    expect(() => auth.resetPassword('customer', '01012345678', otp, 'other1234')).toThrow('발급된 인증번호가 없습니다')
  })

  it('만료와 시도 제한은 가입 인증과 같다 (5분·5회)', () => {
    const auth = signedUp()
    const a = auth.requestPasswordReset('customer', '01012345678')
    const t0 = Date.now()
    expect(() => auth.resetPassword('customer', '01012345678', a.otp, 'newpass12', t0 + OTP_TTL_MS + 1)).toThrow('만료')
    const b = auth.requestPasswordReset('customer', '01012345678')
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i += 1) {
      expect(() => auth.resetPassword('customer', '01012345678', '000000', 'newpass12')).toThrow('일치하지 않습니다')
    }
    expect(() => auth.resetPassword('customer', '01012345678', '000000', 'newpass12')).toThrow('초과')
    expect(() => auth.resetPassword('customer', '01012345678', b.otp, 'newpass12')).toThrow(
      '발급된 인증번호가 없습니다',
    )
  })

  it('잠긴 계정도 재설정하면 곧바로 들어온다 — 15분을 더 기다리는 것은 복구가 아니다', () => {
    const auth = signedUp()
    for (let i = 0; i < LOGIN_MAX_FAILS; i += 1) {
      expect(() => auth.login('customer', '01012345678', 'wrongpass')).toThrow()
    }
    expect(auth.lockRemainingMs('customer', '01012345678')).toBeGreaterThan(0)
    const { otp } = auth.requestPasswordReset('customer', '01012345678')
    auth.resetPassword('customer', '01012345678', otp, 'newpass12')
    expect(auth.login('customer', '01012345678', 'newpass12').role).toBe('customer')
  })

  it('없는 번호에도 코드를 돌려주되 저장하지 않는다 — 응답으로 가입 여부를 훑을 수 없다', () => {
    const auth = new AuthService()
    const { otp } = auth.requestPasswordReset('customer', '01099998888')
    expect(otp).toMatch(/^\d{6}$/)
    expect(() => auth.resetPassword('customer', '01099998888', otp, 'newpass12')).toThrow('발급된 인증번호가 없습니다')
  })

  it('저장을 넘어 살아남는다 — 다른 인스턴스가 같은 저장소를 읽어도 재설정이 이어진다', () => {
    const storage = memoryStorage()
    const a = new AuthService(storage)
    a.register({
      agreeTerms: true,
      agreePrivacy: true,
      role: 'customer',
      name: '김고객',
      phone: '01012345678',
      password: 'password1',
    })
    const { otp } = a.requestPasswordReset('customer', '01012345678')
    const b = new AuthService(storage)
    b.resetPassword('customer', '01012345678', otp, 'newpass12')
    // 가입을 중간에 그만둔 계정이다(휴대폰 인증 전). 재설정 인증번호를 받았다는 것이 곧 그 번호를
    // 쥐고 있다는 뜻이므로 여기서 막다른 길이 되면 안 된다
    expect(b.login('customer', '01012345678', 'newpass12').role).toBe('customer')
  })
})
