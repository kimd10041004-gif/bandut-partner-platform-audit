import type { Database, User } from './model';
import { ServiceError } from './errors';
import { trade } from './trade';

// ponytail: D1 changes are checked every 2 seconds per open thread. For high
// concurrent chat volume, replace this with a shared push broker.
export async function chatStream(db: Database, user: User, orderId: string, partnerId: string, signal: AbortSignal) {
    const service = trade(db);
    let snapshot = await service.chat(user, orderId, partnerId);
    let closed = false, first = true, last = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    const started = Date.now();
    const encoder = new TextEncoder();
    const stop = () => { closed = true; clearTimeout(timer); wake?.(); signal.removeEventListener('abort', stop); };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
            const finish=()=>{stop();try{controller.close();}catch{/* Reader already cancelled. */}};
            if (!first && !closed) await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 2000); });
            if (closed || Date.now() - started >= 28000) { finish(); return; }
            try {
                if (!first) snapshot = await service.chat(user, orderId, partnerId);
                first = false;
                if (closed) { finish(); return; }
                const payload = JSON.stringify(snapshot);
                controller.enqueue(encoder.encode(payload !== last ? `retry: 1000\nevent: snapshot\ndata: ${payload}\n\n` : ': keep-alive\n\n'));
                last = payload;
            } catch (error) {
                if (!closed) controller.enqueue(encoder.encode(`event: ${error instanceof ServiceError && error.status === 403 ? 'denied' : 'unavailable'}\ndata: {}\n\n`));
                finish();
            }
        },
        cancel() { stop(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
