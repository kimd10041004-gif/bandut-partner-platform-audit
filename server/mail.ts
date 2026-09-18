/**
 * 메일 발송 (29-27) — 이메일 인증번호와 이메일로 받는 비밀번호 재설정 코드가 여기로 나간다.
 *
 * ## 발송사
 *
 * HTTP API 하나로 보낸다. 서버리스에서 SMTP 소켓을 여는 것보다 단순하고, 의존성을 더하지 않는다.
 * 지금 아는 발송사는 `resend` 하나다(`MAIL_PROVIDER=resend`). 다른 이름이 오면 **보내는 척하지 않고**
 * 던진다 — 조용히 실패하면 사용자는 오지 않는 메일을 기다린다.
 *
 * ## 비밀값
 *
 * `MAIL_API_KEY` 는 여기서만 읽고 어디에도 적지 않는다. 발송사가 거절하면 상태 코드만 남긴다 —
 * 응답 본문에 키의 일부가 섞여 있을 수 있어 그대로 로그에 쓰지 않는다.
 *
 * ## 테스트
 *
 * `fetch` 를 주입받는다. 진짜 발송사는 CI 에서 부르지 않는다.
 */

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export type MailSender = (env: NodeJS.ProcessEnv, message: MailMessage) => Promise<void>

export class MailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailError'
  }
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/**
 * 발송사를 기다리는 상한 (29-27 자체 감사 03).
 *
 * 발송은 `/api/auth` 트랜잭션 안에서 일어나고, 그 트랜잭션은 계정 행의 잠금을 쥐고 있다(`server/authState.ts`).
 * 발송사가 답을 안 주면 그 잠금을 기다리는 모든 로그인·가입이 함께 선다. `pg` 쿼리 상한(`QUERY_TIMEOUT_MS`)과
 * 같은 8초에서 끊는다 — 그 뒤는 `MailError` 라서 트랜잭션째 되돌아간다.
 */
export const MAIL_TIMEOUT_MS = 8_000

export async function sendMail(
  env: NodeJS.ProcessEnv,
  message: MailMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const provider = (env['MAIL_PROVIDER'] ?? '').trim().toLowerCase()
  const key = env['MAIL_API_KEY'] ?? ''
  const sender = env['MAIL_SENDER'] ?? ''
  if (provider === '' || key === '' || sender === '') throw new MailError('메일 발송 설정이 갖춰지지 않았습니다')
  if (provider !== 'resend') throw new MailError(`알 수 없는 메일 발송사: ${provider}`)
  let response: Response
  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: sender, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
    })
  } catch (e) {
    const name = e instanceof Error ? e.name : 'error'
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new MailError(`메일 발송사가 제때 답하지 않았습니다 (${MAIL_TIMEOUT_MS / 1000}초)`)
    }
    throw new MailError(`메일 발송사에 닿지 못했습니다 (${name})`)
  }
  if (!response.ok) throw new MailError(`메일 발송사가 요청을 거절했습니다 (${response.status})`)
}

/** 사용자에게 하는 말 — 발송 실패는 저장소 오류가 아니다. 다시 요청하면 새 코드가 나간다 */
export const MAIL_SEND_FAILED = '메일을 보내지 못했습니다 — 잠시 뒤 다시 요청해 주세요.'

const BRAND = '반듯집수리'

/** 이메일 인증 메일 — 코드는 5분(`OTP_TTL_MS`) 안에 써야 한다 */
export function emailVerificationMail(to: string, code: string): MailMessage {
  return {
    to,
    subject: `[${BRAND}] 이메일 인증번호 ${code}`,
    text: [
      `${BRAND} 이메일 인증번호입니다.`,
      '',
      `인증번호: ${code}`,
      '',
      '이 번호는 5분 동안만 유효합니다. 내 계정 화면의 "이메일 인증" 칸에 입력해 주세요.',
      '본인이 요청한 것이 아니라면 이 메일을 무시하셔도 됩니다 — 아무것도 바뀌지 않습니다.',
    ].join('\n'),
  }
}

/** 비밀번호 재설정 메일 */
export function passwordResetMail(to: string, code: string): MailMessage {
  return {
    to,
    subject: `[${BRAND}] 비밀번호 재설정 인증번호 ${code}`,
    text: [
      `${BRAND} 비밀번호 재설정 인증번호입니다.`,
      '',
      `인증번호: ${code}`,
      '',
      '이 번호는 5분 동안만 유효합니다. 비밀번호 찾기 화면에 입력하고 새 비밀번호를 정해 주세요.',
      '비밀번호를 바꾸면 로그인되어 있던 모든 기기에서 로그아웃됩니다.',
      '본인이 요청한 것이 아니라면 이 메일을 무시하셔도 됩니다 — 비밀번호는 바뀌지 않습니다.',
    ].join('\n'),
  }
}
