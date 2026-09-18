/**
 * 인증 안전 조건 (29-11).
 *
 * ## 왜 이 파일이 생겼나
 *
 * `register()`가 발급한 인증번호를 **응답에 그대로 실어** 보내고 있었다(`handlers/auth.ts`). 조건이
 * 하나도 없었다 — 운영이든 프리뷰든 로컬이든 똑같이 나갔다. 그러면 휴대폰 인증이 "그 번호를 쥔
 * 사람인가"를 확인하지 못한다. 남의 번호를 적어 넣어도 서버가 인증번호를 되돌려 주기 때문이다.
 *
 * 시연 단계에서는 문자 발송이 없어 그렇게 두었고, 주석도 "SMS 연동 시 여기서 뺀다"고 적혀 있었다.
 * 이 파일이 그 "여기"다.
 *
 * ## 두 개의 문
 *
 * - `devOtpAllowed` — 개발용 인증번호를 화면·응답에 **보여도 되는가**.
 * - `smsConfigured` — 진짜 문자를 **보낼 수 있는가**.
 *
 * 둘 다 아니면 가입·비밀번호 복구를 받지 않는다. 받아 봐야 사용자는 인증번호를 얻을 수 없고,
 * 계정만 미인증 상태로 쌓인다. 조용히 실패하는 것보다 문 앞에서 분명히 막는 편이 낫다.
 */

/** 운영인가 — Vercel이 배포마다 넣어 주는 값. 로컬·CI에는 없다 */
function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env['VERCEL_ENV'] === 'production'
}

/**
 * 개발용 인증번호를 응답에 실어도 되는가.
 *
 * **운영은 어떤 값으로도 열리지 않는다** — 첫 줄에서 끝난다. 그 아래 조건이 아무리 켜져 있어도
 * `VERCEL_ENV`가 `'production'`이면 여기서 false다. 실수로 플래그가 운영에 새어 들어가도 마찬가지다.
 *
 * 프리뷰는 **명시적으로 켠 경우에만** 연다(`AUTH_DEV_OTP=on`). 켜 두지 않은 프리뷰는 운영과 같이
 * 동작하므로, 운영 전 마지막 점검을 프리뷰에서 그대로 해 볼 수 있다.
 *
 * 로컬·CI에는 `VERCEL_ENV`가 없다. 배포가 아니므로 연다 — 게이트(e2e·계약 테스트)가 이 값으로
 * 가입 여정을 돈다. 배포된 자리에서 무엇이 나오는지는 배포 확인이 따로 본다.
 */
export function devOtpAllowed(env: NodeJS.ProcessEnv): boolean {
  if (isProduction(env)) return false
  if (env['VERCEL_ENV'] === 'preview') return env['AUTH_DEV_OTP'] === 'on'
  return true
}

/**
 * 문자를 실제로 보낼 수 있는가.
 *
 * 발송사 연동은 아직 없다. 이 함수는 **값이 갖춰졌는지만** 본다 — 갖춰지면 다음 라운드의 발송
 * 코드가 그 자리에 들어간다. 지금 운영에서 이 함수가 true를 주는 일은 없어야 한다. 값만 넣고
 * 발송 코드가 없으면 가입이 인증번호 없이 통과하기 때문이다. 그래서 발송 코드가 붙기 전까지는
 * `signupAllowed`가 운영에서 언제나 막도록 `SMS_SENDER`까지 셋을 모두 요구한다.
 */
export function smsConfigured(env: NodeJS.ProcessEnv): boolean {
  return ['SMS_PROVIDER', 'SMS_API_KEY', 'SMS_SENDER'].every((k) => {
    const v = env[k]
    return typeof v === 'string' && v !== ''
  })
}

/** 가입·비밀번호 복구를 받아도 되는 서버인가 — 인증번호를 전달할 방법이 하나는 있어야 한다 */
export function otpDeliverable(env: NodeJS.ProcessEnv): boolean {
  return devOtpAllowed(env) || smsConfigured(env)
}

/** 막을 때 사용자에게 하는 말. 비밀값도 환경 이름도 담지 않는다 */
export const OTP_UNDELIVERABLE =
  '문자 발송이 아직 연결되지 않아 가입과 비밀번호 찾기를 받을 수 없습니다. 잠시 뒤 다시 시도해 주세요.'

/**
 * 메일을 실제로 보낼 수 있는가 (29-27).
 *
 * 문자와 같은 규칙이다 — 셋이 모두 있어야 한다. `MAIL_PROVIDER` 는 발송사 이름(`server/mail.ts` 가 아는
 * 것), `MAIL_API_KEY` 는 그 발송사의 키, `MAIL_SENDER` 는 보내는 주소(`반듯집수리 <no-reply@…>`)다.
 * 값은 Vercel 환경변수에만 둔다.
 */
export function mailConfigured(env: NodeJS.ProcessEnv): boolean {
  return ['MAIL_PROVIDER', 'MAIL_API_KEY', 'MAIL_SENDER'].every((k) => {
    const v = env[k]
    return typeof v === 'string' && v !== ''
  })
}

/** 이메일 인증·이메일로 비밀번호 찾기를 받아도 되는 서버인가 — 코드를 전달할 방법이 하나는 있어야 한다 */
export function emailDeliverable(env: NodeJS.ProcessEnv): boolean {
  return devOtpAllowed(env) || mailConfigured(env)
}

export const MAIL_UNDELIVERABLE =
  '메일 발송이 아직 연결되지 않아 이메일 인증과 이메일로 비밀번호 찾기를 받을 수 없습니다. 휴대폰 번호로 시도하거나 잠시 뒤 다시 시도해 주세요.'
