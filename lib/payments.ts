import { z } from 'zod';
import { fail, ServiceError } from './errors';
export interface PaymentConfig {
    TOSS_CLIENT_KEY?: string;
    TOSS_SECRET_KEY?: string;
    PAYMENTS_ENABLED?: string;
    PAYMENTS_LIVE_APPROVED?: string;
}
const responseSchema = z.object({ orderId: z.string(), paymentKey: z.string(), status: z.string(), currency: z.literal('KRW'), totalAmount: z.number().int().nonnegative(), balanceAmount: z.number().int().nonnegative(), receipt: z.object({ url: z.string().url() }).nullish() });
export type ProviderPayment = z.infer<typeof responseSchema>;
export function paymentProvider(config: PaymentConfig, request: typeof fetch = fetch) {
    const test = !!config.TOSS_CLIENT_KEY?.startsWith('test_ck_') && !!config.TOSS_SECRET_KEY?.startsWith('test_sk_');
    const live = !!config.TOSS_CLIENT_KEY?.startsWith('live_ck_') && !!config.TOSS_SECRET_KEY?.startsWith('live_sk_') && config.PAYMENTS_LIVE_APPROVED === 'true';
    const ready = config.PAYMENTS_ENABLED === 'true' && (test || live);
    async function call(path: string, data?: unknown, key?: string) { if (!ready)
        fail(503, '결제사 연결을 준비 중입니다. 아직 결제할 수 없습니다.'); let res: Response; try {
        res = await request('https://api.tosspayments.com/v1/payments/' + path, { method: data ? 'POST' : 'GET', headers: { Authorization: 'Basic ' + btoa(config.TOSS_SECRET_KEY + ':'), 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(8000) });
    }
    catch {
        fail(503, '결제사 응답을 확인하지 못했습니다. 다시 결제하기 전에 결제 상태를 확인해 주세요.');
    } const result = await res.json() as {
        code?: string;
    }; if (!res.ok) {
        const error = new ServiceError(502, '결제사에서 처리를 완료하지 못했습니다. 결제 상태를 확인해 주세요.');
        Object.assign(error, { providerCode: result.code });
        throw error;
    } return responseSchema.parse(result); }
    return { ready, mode: (test ? 'test' : live ? 'live' : 'unconfigured') as 'test' | 'live' | 'unconfigured', clientKey: ready ? config.TOSS_CLIENT_KEY : null,
        confirm: (id: string, paymentKey: string, amount: number) => call('confirm', { paymentKey, orderId: id, amount }, 'confirm-' + id),
        lookup: (id: string) => call('orders/' + encodeURIComponent(id)),
        refund: (key: string, amount: number, reason: string, id: string) => call(encodeURIComponent(key) + '/cancel', { cancelReason: reason, cancelAmount: amount }, id) };
}
