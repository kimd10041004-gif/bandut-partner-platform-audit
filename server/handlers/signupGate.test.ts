import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { handleAuth } from './auth'
import { AuthService, OTP_MAX_ATTEMPTS, AuthError } from '../domain/auth'

/**
 * 29-21: 가입 코드를 없앤다.
 *
 * ## 왜 없애나
 *
 * 가입 코드는 서버 모드 초기(28-70-01)에 들어왔다. 그때는 **가입이 곧 마켓플레이스 전체 스냅샷의
 * 읽기·쓰기 권한**이었다. 아무나 가입하면 아무나 남의 주문을 읽었으므로, 코드를 아는 사람만
 * 들어오게 막을 이유가 있었다.
 *
 * 29-1에서 v17 마켓플레이스를 Postgres로 옮기면서 그 전제가 사라졌다. 지금은 역할로 갈린다.
 * `lib/service.ts`의 `approved()`가 승인되지 않은 파트너의 견적 제출을 403으로 끊고, `view()`가
 * 남의 주문에서 주소·연락처를 지워서 내준다. 가입은 더 이상 전체 권한이 아니다.
 *
 * 남은 자물쇠는 **운영자 승인**이고 그것은 서버가 건다. 가입 코드는 이미 잠긴 문에 덧댄 두 번째
 * 자물쇠이면서, 값이 어긋나면 아무도 못 들어오는 고장점이었다(29-20-3에서 실제로 그렇게 막혔다).
 *
 * ## 없애도 운영이 열리지 않는 이유
 *
 * 운영의 가입은 가입 코드가 아니라 `otpDeliverable`이 막는다(`server/authSafety.ts`). 운영에서는
 * 개발용 인증번호가 첫 줄에서 거부되고 문자 발송사도 없어서, 가입 요청이 503으로 끝난다. 가입 코드가
 * 있든 없든 같다. A가 그것을 고정한다.
 */

const req = (op: string, args: unknown[] = []) => ({
  method: 'POST',
  headers: {} as Record<string, string>,
  query: {},
  body: { op, args },
})
const env = { DATABASE_URL: 'postgres://unused', ADMIN_PASSWORD: 'ci-admin-pass-1' }

describe('29-21-A 가입 코드를 묻지 않는다', () => {
  it('SIGNUP_CODE가 없어도 그 이유로 막지 않는다 — 운영을 막는 것은 문자 발송이다', async () => {
    // 수정 전: 가입 코드 가드가 먼저 걸려 '가입 코드가 설정되지 않았습니다'로 끝났다
    const res = await handleAuth(req('register', [{}]), { ...env, VERCEL_ENV: 'production' })
    const body = JSON.stringify(res.body)
    expect(res.status).toBe(503)
    expect(body).not.toContain('가입 코드')
    expect(body).toContain('문자 발송이 아직 연결되지 않아')
  })

  it('SIGNUP_CODE를 설정해도 달라지는 것이 없다 — 값이 더 이상 읽히지 않는다', async () => {
    const withCode = { ...env, VERCEL_ENV: 'production', SIGNUP_CODE: 'ci-signup-code-1' }
    const res = await handleAuth(req('register', [{}]), withCode)
    expect(JSON.stringify(res.body)).toContain('문자 발송이 아직 연결되지 않아')
  })
})

/**
 * B: 열여섯 곳 중 한 곳이라도 남으면 가입이 조용히 막힌다.
 *
 * 29-20-3이 정확히 그 모양이었다 — 값 하나가 어긋났을 뿐인데 봇이 가입 단계에서 멈췄고, 왜인지는
 * 로그를 고치고 나서야 나왔다. 손으로 세는 대신 게이트가 세게 한다(29-17-3 `lib/adminRoutes.test.ts`와 같은 방식).
 */
const ROOTS = ['server', 'lib', 'components', 'app', 'src', 'scripts', 'tests', '.github/workflows']
const SCANNED = /\.(ts|tsx|mjs|yml)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (SCANNED.test(name)) out.push(p)
  }
  return out
}

describe('29-21-B 한 곳도 남기지 않는다', () => {
  it('살아 있는 코드·검사·워크플로 어디에도 가입 코드가 없다', () => {
    const root = process.cwd()
    const hits: string[] = []
    for (const r of ROOTS) {
      let files: string[]
      try {
        files = walk(join(root, r))
      } catch {
        continue // 없는 디렉터리는 건너뛴다
      }
      for (const f of files) {
        if (f.endsWith('signupGate.test.ts')) continue // 이 파일은 이름을 말해야 한다
        if (/SIGNUP_CODE|signupCode/.test(readFileSync(f, 'utf8'))) hits.push(f.slice(root.length + 1))
      }
    }
    expect(hits).toEqual([])
  })
})

/**
 * C: 가입 코드가 하던 다른 일 하나를 대신 세운다.
 *
 * `verifyOtp`는 가입 코드를 물었는데, 이유가 따로 있었다(28-71-03b) — 남의 번호로 인증번호를 5번
 * 틀려서 **대기 중인 가입을 지워 버리는** 것을 막기 위해서다. 코드를 없애면 그 문이 다시 열린다.
 *
 * 지우는 대신 잠시 쉬게 한다. 무차별 대입은 여전히 창당 5회로 막히고(1분 뒤 다시 5회), 정당한
 * 사용자는 가입을 처음부터 다시 하지 않아도 된다. 인증번호 자체의 5분 만료는 그대로다.
 */
describe('29-21-C 남이 대기 중 가입을 지우지 못한다', () => {
  const signup = () => {
    const auth = new AuthService()
    const r = auth.register({
      role: 'customer',
      name: '김고객',
      phone: '01012345678',
      password: 'password1',
      agreeTerms: true,
      agreePrivacy: true,
    })
    return { auth, otp: r.otp }
  }

  it('인증번호를 5회 틀려도 가입이 살아 있다 — 잠시 막힐 뿐이다', () => {
    const { auth, otp } = signup()
    const t0 = Date.now()
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      expect(() => auth.verifyOtp('customer', '01012345678', '000000', t0)).toThrow(AuthError)
    }
    // 수정 전: 여기서 '다시 가입해 주세요'가 나오고 인증번호가 지워졌다 — 남이 내 가입을 끝냈다
    expect(() => auth.verifyOtp('customer', '01012345678', otp, t0)).toThrow('잠시')
    // 창이 지나면 본인의 정상 인증번호가 통과한다
    const after = auth.verifyOtp('customer', '01012345678', otp, t0 + 61_000)
    expect(after.verified).toBe(true)
  })
})
