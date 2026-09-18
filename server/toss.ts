/**
 * 결제사(토스페이먼츠) 어댑터 (28-97) — 참고 v12 `lib/payments.ts`의 우리 판.
 *
 * ## 경계
 *
 * 이 모듈은 **결제사와의 HTTP만** 안다. 무엇을 얼마에 청구할지는 도메인(`PlatformService.preparePayment`)이
 * 정하고, 승인 결과를 기록하는 것도 도메인(`confirmPayment`)이다. 여기서는 비밀 키를 들고 토스에 묻고 답을
 * 옮길 뿐이다 — 그래서 서버는 스냅샷을 몰라도 되고, 클라이언트는 비밀 키를 몰라도 된다.
 *
 * ## 멱등
 *
 * 승인·취소 요청에 `Idempotency-Key`를 실어 보낸다. 키는 **주문번호**(`orderId`, 도메인이 발급)와 환불 id다 —
 * 네트워크가 끊겨 같은 요청이 두 번 가도 결제사 쪽에서 한 번으로 합쳐진다. 도메인도 같은 주문번호로 한 번만
 * 기록하므로(28-97), 양쪽 모두에서 이중 결제가 성립하지 않는다.
 *
 * ## 켜지지 않은 상태가 기본이다
 *
 * `PAYMENTS_ENABLED=true`가 아니거나 키 접두사(`test_ck_`/`test_sk_`, 라이브는 `live_ck_`/`live_sk_` +
 * `PAYMENTS_LIVE_APPROVED=true`)가 맞지 않으면 `ready=false`이고 어떤 호출도 나가지 않는다. 잘못된 설정으로
 * 실제 돈이 움직이는 것보다 "아직 결제할 수 없습니다"가 낫다.
 *
 * 모듈 전역 가변 상태 없음 — 호출마다 설정을 읽어 새 객체를 만든다(인스턴스 경계 문제가 생기지 않는다).
 */

/** 결제사 응답 중 우리가 쓰는 것만 (28-97) */
export interface ProviderPayment {
  orderId: string
  paymentKey: string
  status: string
  totalAmount: number
  balanceAmount: number
  receiptUrl?: string
}

export interface ProviderError {
  /** HTTP 상태로 옮긴 값 — 503(연결 안 됨·응답 못 받음) · 502(결제사가 거절·모양이 다름) */
  status: 502 | 503
  message: string
  /** 결제사 오류 코드 — 있으면 운영 기록에 남긴다(고객에게는 문구만 보여 준다) */
  code?: string
}

export type ProviderResult = { ok: true; payment: ProviderPayment } | ({ ok: false } & ProviderError)

export type PaymentMode = 'test' | 'live' | 'unconfigured'

const TOSS_BASE = 'https://api.tosspayments.com/v1/payments/'
const TIMEOUT_MS = 15_000

/** 결제사 응답 모양 검증 — 하나라도 어긋나면 승인으로 치지 않는다 */
function parsePayment(raw: unknown): ProviderPayment | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const receipt = o['receipt']
  const url = typeof receipt === 'object' && receipt !== null ? (receipt as Record<string, unknown>)['url'] : undefined
  if (
    typeof o['orderId'] !== 'string' ||
    typeof o['paymentKey'] !== 'string' ||
    typeof o['status'] !== 'string' ||
    o['currency'] !== 'KRW' ||
    !Number.isInteger(o['totalAmount']) ||
    !Number.isInteger(o['balanceAmount'])
  ) {
    return null
  }
  return {
    orderId: o['orderId'],
    paymentKey: o['paymentKey'],
    status: o['status'],
    totalAmount: o['totalAmount'] as number,
    balanceAmount: o['balanceAmount'] as number,
    ...(typeof url === 'string' ? { receiptUrl: url } : {}),
  }
}

export interface PaymentProvider {
  ready: boolean
  mode: PaymentMode
  /** 결제창을 여는 공개 키 — 준비되지 않았으면 null (비밀 키는 어떤 경우에도 나가지 않는다) */
  clientKey: string | null
  confirm(orderId: string, paymentKey: string, amount: number): Promise<ProviderResult>
  lookup(orderId: string): Promise<ProviderResult>
  cancel(paymentKey: string, amount: number, reason: string, idempotencyKey: string): Promise<ProviderResult>
}

/** 결제사 설정을 읽어 어댑터를 만든다. `request`는 테스트에서 가짜 fetch를 넣기 위한 것 */
export function paymentProvider(env: NodeJS.ProcessEnv, request: typeof fetch = fetch): PaymentProvider {
  const clientKey = env['TOSS_CLIENT_KEY'] ?? ''
  const secretKey = env['TOSS_SECRET_KEY'] ?? ''
  const test = clientKey.startsWith('test_ck_') && secretKey.startsWith('test_sk_')
  const live =
    clientKey.startsWith('live_ck_') && secretKey.startsWith('live_sk_') && env['PAYMENTS_LIVE_APPROVED'] === 'true'
  const ready = env['PAYMENTS_ENABLED'] === 'true' && (test || live)
  const mode: PaymentMode = test ? 'test' : live ? 'live' : 'unconfigured'

  async function call(path: string, body?: unknown, idempotencyKey?: string): Promise<ProviderResult> {
    if (!ready) {
      return { ok: false, status: 503, message: '결제사 연결을 준비 중입니다 — 아직 카드 결제를 할 수 없습니다' }
    }
    let res: Response
    try {
      const headers: Record<string, string> = {
        authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
        'content-type': 'application/json',
      }
      if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey
      res = await request(`${TOSS_BASE}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      // 응답을 못 받았다 — 승인이 났는지 안 났는지 **모른다**. 다시 결제하기 전에 조회부터 해야 한다
      return {
        ok: false,
        status: 503,
        message: '결제사 응답을 확인하지 못했습니다 — 다시 결제하기 전에 결제 상태를 확인해 주세요',
      }
    }
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    if (!res.ok) {
      const code = typeof json === 'object' && json !== null ? (json as Record<string, unknown>)['code'] : undefined
      return {
        ok: false,
        status: 502,
        message: '결제사에서 처리를 완료하지 못했습니다 — 결제 상태를 확인해 주세요',
        ...(typeof code === 'string' ? { code } : {}),
      }
    }
    const payment = parsePayment(json)
    if (payment === null) {
      return { ok: false, status: 502, message: '결제사 응답 형식이 예상과 다릅니다 — 결제 상태를 확인해 주세요' }
    }
    return { ok: true, payment }
  }

  return {
    ready,
    mode,
    clientKey: ready ? clientKey : null,
    // 멱등 키 = 주문번호. 같은 주문의 승인은 몇 번을 보내도 결제사에서 한 건이다
    confirm: (orderId, paymentKey, amount) => call('confirm', { paymentKey, orderId, amount }, `confirm-${orderId}`),
    lookup: (orderId) => call(`orders/${encodeURIComponent(orderId)}`),
    cancel: (paymentKey, amount, reason, idempotencyKey) =>
      call(`${encodeURIComponent(paymentKey)}/cancel`, { cancelReason: reason, cancelAmount: amount }, idempotencyKey),
  }
}
