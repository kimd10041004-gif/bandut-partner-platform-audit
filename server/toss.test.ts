import { describe, it, expect } from 'vitest'
import { paymentProvider } from './toss'

/** 결제사 응답 흉내 — 모양은 토스 `/v1/payments/confirm` 응답에서 우리가 쓰는 부분만 */
const okPayment = {
  orderId: 'BD-REQ-0001-deposit-0001',
  paymentKey: 'tk_abc',
  status: 'DONE',
  currency: 'KRW',
  totalAmount: 30_000,
  balanceAmount: 30_000,
  receipt: { url: 'https://receipt.example/1' },
}

function fakeFetch(reply: { ok: boolean; body: unknown }, calls: Array<{ url: string; init: RequestInit }> = []) {
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return {
      ok: reply.ok,
      status: reply.ok ? 200 : 400,
      json: async () => reply.body,
    } as unknown as Response
  }) as unknown as typeof fetch
  return { fn, calls }
}

const TEST_ENV = {
  PAYMENTS_ENABLED: 'true',
  TOSS_CLIENT_KEY: 'test_ck_public',
  TOSS_SECRET_KEY: 'test_sk_secret',
} as NodeJS.ProcessEnv

describe('결제사 어댑터 (28-97)', () => {
  it('설정이 갖춰지지 않으면 준비되지 않았고, 어떤 호출도 나가지 않는다', async () => {
    const { fn, calls } = fakeFetch({ ok: true, body: okPayment })
    for (const env of [
      {} as NodeJS.ProcessEnv,
      { PAYMENTS_ENABLED: 'true' } as NodeJS.ProcessEnv,
      // 키는 있는데 스위치가 꺼져 있다
      { ...TEST_ENV, PAYMENTS_ENABLED: 'false' } as NodeJS.ProcessEnv,
      // 라이브 키인데 승인 플래그가 없다 — 실수로 진짜 돈이 움직이지 않게
      {
        PAYMENTS_ENABLED: 'true',
        TOSS_CLIENT_KEY: 'live_ck_public',
        TOSS_SECRET_KEY: 'live_sk_secret',
      } as NodeJS.ProcessEnv,
    ]) {
      const p = paymentProvider(env, fn)
      expect(p.ready).toBe(false)
      expect(p.clientKey).toBeNull()
      const out = await p.confirm('BD-1', 'tk_1', 1000)
      expect(out).toMatchObject({ ok: false, status: 503 })
    }
    expect(calls).toHaveLength(0)
  })

  it('테스트·라이브 모드를 구분하고 공개 키만 내보낸다', () => {
    const test = paymentProvider(TEST_ENV)
    expect([test.ready, test.mode, test.clientKey]).toEqual([true, 'test', 'test_ck_public'])
    const live = paymentProvider({
      PAYMENTS_ENABLED: 'true',
      PAYMENTS_LIVE_APPROVED: 'true',
      TOSS_CLIENT_KEY: 'live_ck_public',
      TOSS_SECRET_KEY: 'live_sk_secret',
    } as NodeJS.ProcessEnv)
    expect([live.ready, live.mode, live.clientKey]).toEqual([true, 'live', 'live_ck_public'])
    expect(JSON.stringify(live)).not.toContain('live_sk_secret')
  })

  it('승인은 주문번호를 멱등 키로 보내고, 비밀 키는 Basic 인증에만 쓴다', async () => {
    const { fn, calls } = fakeFetch({ ok: true, body: okPayment })
    const out = await paymentProvider(TEST_ENV, fn).confirm('BD-REQ-0001-deposit-0001', 'tk_abc', 30_000)
    expect(out).toEqual({
      ok: true,
      payment: {
        orderId: 'BD-REQ-0001-deposit-0001',
        paymentKey: 'tk_abc',
        status: 'DONE',
        totalAmount: 30_000,
        balanceAmount: 30_000,
        receiptUrl: 'https://receipt.example/1',
      },
    })
    const call = calls[0]!
    expect(call.url).toBe('https://api.tosspayments.com/v1/payments/confirm')
    const headers = call.init.headers as Record<string, string>
    expect(headers['idempotency-key']).toBe('confirm-BD-REQ-0001-deposit-0001')
    expect(headers['authorization']).toBe(`Basic ${Buffer.from('test_sk_secret:').toString('base64')}`)
    expect(JSON.parse(String(call.init.body))).toEqual({
      paymentKey: 'tk_abc',
      orderId: 'BD-REQ-0001-deposit-0001',
      amount: 30_000,
    })
  })

  it('결제사가 거절하면 502 + 코드, 응답 모양이 다르면 502, 응답을 못 받으면 503이다', async () => {
    const rejected = fakeFetch({ ok: false, body: { code: 'ALREADY_PROCESSED_PAYMENT' } })
    expect(await paymentProvider(TEST_ENV, rejected.fn).confirm('BD-1', 'tk_1', 1000)).toMatchObject({
      ok: false,
      status: 502,
      code: 'ALREADY_PROCESSED_PAYMENT',
    })
    // 통화·금액이 어긋난 응답은 승인으로 치지 않는다
    for (const body of [
      { ...okPayment, currency: 'USD' },
      { ...okPayment, balanceAmount: '30000' },
      { orderId: 'BD-1' },
      null,
    ]) {
      const weird = fakeFetch({ ok: true, body })
      expect(await paymentProvider(TEST_ENV, weird.fn).confirm('BD-1', 'tk_1', 1000)).toMatchObject({
        ok: false,
        status: 502,
      })
    }
    const dead = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const out = await paymentProvider(TEST_ENV, dead).confirm('BD-1', 'tk_1', 1000)
    expect(out).toMatchObject({ ok: false, status: 503 })
    if (out.ok) throw new Error('unreachable')
    expect(out.message).toContain('결제 상태를 확인')
  })

  it('취소는 환불 id를 멱등 키로 보내고, 조회는 주문번호로 GET한다', async () => {
    const cancel = fakeFetch({ ok: true, body: { ...okPayment, status: 'PARTIAL_CANCELED', balanceAmount: 10_000 } })
    const out = await paymentProvider(TEST_ENV, cancel.fn).cancel('tk_abc', 20_000, '타일 파손 보상', 'RF-0001')
    expect(out).toMatchObject({ ok: true, payment: { balanceAmount: 10_000, status: 'PARTIAL_CANCELED' } })
    const call = cancel.calls[0]!
    expect(call.url).toBe('https://api.tosspayments.com/v1/payments/tk_abc/cancel')
    expect((call.init.headers as Record<string, string>)['idempotency-key']).toBe('RF-0001')
    expect(JSON.parse(String(call.init.body))).toEqual({ cancelReason: '타일 파손 보상', cancelAmount: 20_000 })
    const lookup = fakeFetch({ ok: true, body: okPayment })
    await paymentProvider(TEST_ENV, lookup.fn).lookup('BD-REQ-0001-deposit-0001')
    expect(lookup.calls[0]!.url).toBe('https://api.tosspayments.com/v1/payments/orders/BD-REQ-0001-deposit-0001')
    expect(lookup.calls[0]!.init.method).toBe('GET')
  })
})
