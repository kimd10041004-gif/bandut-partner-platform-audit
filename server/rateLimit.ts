/**
 * IP별 실패 제한 (28-70-03c) — **완화**일 뿐이다.
 *
 * 도메인의 잠금 규칙(5회 실패 → 15분, 전화번호 기준)은 인터넷에 노출되면 "전화번호만 알면 남을 잠글 수 있다"가 된다.
 * 서버가 요청 IP 기준으로 실패를 세어, 한 IP가 60초 안에 20번 넘게 실패하면 429로 끊는다. 서버리스 인스턴스마다
 * 따로 세므로(인메모리) 분산 공격은 못 막는다 — 그것은 SMS 2단계·엣지 레이트리밋의 일이다.
 */
const WINDOW_MS = 60_000
export const MAX_FAILS_PER_WINDOW = 20
/**
 * **인스턴스마다 따로 센다** (28-70-03c, 28-88-05에서 선언 옆으로 옮겨 적음).
 * 그래서 이 표가 막는 것은 *한 인스턴스에 몰린* 반복 실패이지 분산 공격이 아니다 —
 * 그것은 SMS 2단계·엣지 레이트리밋의 일이고, 둘 다 아직 이월 항목이다.
 */
const fails = new Map<string, { count: number; windowStart: number }>()

/** `'unknown'` — 프록시 헤더가 없어 요청 IP를 구분할 수 없을 때의 값 (28-72-04c) */
export const UNKNOWN_IP = 'unknown'

/**
 * 요청 IP와 **그 값을 믿을 수 있는지**를 함께 돌려준다 (28-72-04c).
 *
 * `trusted === false`면 모든 요청이 같은 값(`UNKNOWN_IP`)을 쓴다 — 그러면 (계정, IP) 잠금 범위와 IP 실패
 * 제한이 **전원 공유**로 무너져 28-71-02 이전과 같아진다. Vercel은 `x-forwarded-for`를 넣으므로
 * 프로덕션에서는 나지 않지만, 프록시 없는 자체 호스팅에서는 난다 — 호출자가 알아야 한다.
 */
export function clientIpOf(headers: Record<string, string | undefined>): { ip: string; trusted: boolean } {
  const xff = headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim() !== '') return { ip: xff.split(',')[0]!.trim(), trusted: true }
  const real = headers['x-real-ip']
  if (typeof real === 'string' && real.trim() !== '') return { ip: real.trim(), trusted: true }
  return { ip: UNKNOWN_IP, trusted: false }
}

/** 값만 필요한 곳을 위한 얇은 껍데기 */
export function clientIp(headers: Record<string, string | undefined>): string {
  return clientIpOf(headers).ip
}

export function isThrottled(ip: string, now: number = Date.now()): boolean {
  const rec = fails.get(ip)
  if (!rec) return false
  if (now - rec.windowStart > WINDOW_MS) {
    fails.delete(ip)
    return false
  }
  return rec.count >= MAX_FAILS_PER_WINDOW
}

/** `weight`(28-71-02): 관리자 비밀번호처럼 무차별 대입 표적인 실패는 여러 회분으로 센다 */
export function recordFailure(ip: string, weight: number = 1, now: number = Date.now()): void {
  const rec = fails.get(ip)
  if (!rec || now - rec.windowStart > WINDOW_MS) {
    fails.set(ip, { count: weight, windowStart: now })
    return
  }
  rec.count += weight
  // 표가 무한히 크지 않게 — 오래된 항목은 지운다
  if (fails.size > 10_000) for (const [k, v] of fails) if (now - v.windowStart > WINDOW_MS) fails.delete(k)
}

/**
 * 메일이 나갈 수 있는 요청의 IP별 상한 (29-27 자체 감사 02).
 *
 * 이메일 복구·이메일 등록은 요청 하나가 진짜 메일 하나로 이어진다 — 실패가 아니라 **성공**을 세어야 발송사
 * 요금과 수신자 스팸함을 지킨다. 도메인의 60초 재발송 쿨다운은 *같은 주소*에 대한 것이고, 이 표는 *한 IP가
 * 여러 주소로* 쏟는 것을 막는다. 위 실패 표와 같은 한계(인스턴스마다 따로)를 가진다.
 */
const MAIL_WINDOW_MS = 10 * 60_000
export const MAX_MAIL_REQUESTS_PER_WINDOW = 5
/**
 * **인스턴스마다 따로 센다** — 위 `fails` 와 같다. 그래서 한 인스턴스에 몰린 반복 요청만 막고, 여러 인스턴스로
 * 흩어지는 요청은 발송사 쪽 한도와 엣지 레이트리밋(이월)이 맡는다.
 */
const mails = new Map<string, { count: number; windowStart: number }>()

export function mailThrottled(ip: string, now: number = Date.now()): boolean {
  const rec = mails.get(ip)
  if (!rec) return false
  if (now - rec.windowStart > MAIL_WINDOW_MS) {
    mails.delete(ip)
    return false
  }
  return rec.count >= MAX_MAIL_REQUESTS_PER_WINDOW
}

export function recordMailRequest(ip: string, now: number = Date.now()): void {
  const rec = mails.get(ip)
  if (!rec || now - rec.windowStart > MAIL_WINDOW_MS) {
    mails.set(ip, { count: 1, windowStart: now })
    return
  }
  rec.count += 1
  if (mails.size > 10_000) for (const [k, v] of mails) if (now - v.windowStart > MAIL_WINDOW_MS) mails.delete(k)
}

/** 테스트용 */
export function resetRateLimit(): void {
  fails.clear()
  mails.clear()
}
