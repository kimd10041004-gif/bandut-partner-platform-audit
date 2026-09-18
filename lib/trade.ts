import { z } from 'zod';
import { fail } from './errors';
import { SEQ_MAX, SUPPORT_THREAD } from './chat-model';
import { paymentProvider, type PaymentConfig, type ProviderPayment } from './payments';
import type { Database, User, Order, Bid, Statement, Photo } from './model';
import type { Contract, Extra, ScheduleChange, Completion, Payment, Refund, Dispute, Settlement, Message, Notification } from './trade-model';
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const reason = z.string().trim().min(5, '내용을 5자 이상 입력해 주세요.').max(2000);
const money = z.number().int().min(0).max(100000000);
const photos = z.array(z.string().uuid()).max(6).default([]);
const schedule = { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startHour: z.number().int().min(8).max(20), endHour: z.number().int().min(9).max(21) };
function validateSchedule(i: {
    date: string;
    startHour: number;
    endHour: number;
}) { const d = new Date(i.date + 'T00:00:00Z'); if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== i.date || i.endHour <= i.startHour || new Date(i.date + 'T' + String(i.startHour).padStart(2, '0') + ':00:00+09:00').getTime() <= Date.now())
    fail(400, '방문 날짜와 시작·종료 시각을 확인해 주세요.'); }
export function trade(db: Database, config: PaymentConfig = {}, request: typeof fetch = fetch) {
    const stmt = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
    const rows = async <T>(sql: string, ...args: unknown[]) => (await stmt(sql, ...args).all<T>()).results;
    const provider = paymentProvider(config, request);
    const guard = (o: Order) => stmt('SELECT CASE WHEN EXISTS(SELECT 1 FROM orders WHERE id=? AND revision=?) THEN 1 ELSE abs(-9223372036854775807 - (SELECT COUNT(*) FROM (SELECT 1) AS one)) END', o.id, o.revision);
    const admin = (u: User) => { if (u.suspended || u.role !== 'ADMIN')
        fail(403, '관리자만 처리할 수 있습니다.'); };
    async function context(u: User, id: string) { if (u.suspended)
        fail(403, '사용이 제한된 계정입니다.'); const o = await stmt('SELECT * FROM orders WHERE id=?', id).first<Order>(); if (!o)
        fail(404, '주문을 찾을 수 없습니다.'); const b = o.selected_bid_id ? await stmt('SELECT * FROM bids WHERE id=?', o.selected_bid_id).first<Bid>() : null; const owner = o.customer_id === u.id, partner = u.role === 'PARTNER' && b?.partner_id === u.id; if (!owner && !partner && u.role !== 'ADMIN')
        fail(403, '거래 참여자만 이용할 수 있습니다.'); if (partner) {
        const p = await stmt("SELECT user_id FROM partners WHERE user_id=? AND status='APPROVED'", u.id).first();
        if (!p)
            fail(403, '파트너 승인이 필요합니다.');
    } return { o, b, owner, partner }; }
    function audit(u: Pick<User,'id'> & {role:string}, o: Order, action: string, after: unknown, why: string) { return stmt('INSERT INTO audit_logs (id,actor_id,role,order_id,action,before_state,after_state,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)', uid(), u.id, u.role, o.id, action, JSON.stringify({ status: o.status, revision: o.revision }), JSON.stringify(after), why, now()); }
    async function commit(u: Pick<User,'id'> & {role:string}, o: Order, action: string, why: string, changes: Statement[], status = o.status, after: unknown = { status }) {
        const b = o.selected_bid_id ? await stmt('SELECT partner_id FROM bids WHERE id=?', o.selected_bid_id).first<{
            partner_id: string;
        }>() : null;
        const admins = await rows<{
            id: string;
        }>("SELECT id FROM users WHERE role='ADMIN' AND suspended=0");
        const recipients = new Set([o.customer_id, ...(b ? [b.partner_id] : []), ...admins.map(a => a.id)]);
        recipients.delete(u.id);
        await db.batch([guard(o), ...changes, stmt('UPDATE orders SET status=?,revision=revision+1,updated_at=? WHERE id=?', status, now(), o.id), audit(u, o, action, after, why), ...(b ? [stmt("INSERT INTO messages (id,order_id,partner_id,sender_id,sender_name,kind,body,photo_ids,created_at) VALUES (?,?,?,?,?,'EVENT',?,'[]',?)", uid(), o.id, b.partner_id, u.id, '거래 알림', why, now())] : []), ...Array.from(recipients).map(id => stmt('INSERT INTO notifications (id,user_id,order_id,message,created_at) VALUES (?,?,?,?,?)', uid(), id, o.id, why.slice(0, 160), now()))]);
        return { ok: true };
    }
    async function accepted(id: string) { const c = await stmt("SELECT * FROM contracts WHERE order_id=? AND status='ACCEPTED'", id).first<Contract>(); if (!c)
        fail(409, '고객이 확정한 계약이 필요합니다.'); return c; }
    async function checkPhotos(id: string, ids: string[]) { for (const photo of ids) {
        if (!await stmt('SELECT id FROM photos WHERE id=? AND order_id=? AND expires_at>?', photo, id, now()).first())
            fail(400, '이 주문의 유효한 증빙 사진만 첨부할 수 있습니다.');
    } }
    async function activePayments(id: string) { return !!await stmt("SELECT id FROM payments WHERE order_id=? AND status IN ('READY','PROCESSING','DONE','PARTIAL_CANCELED')", id).first(); }
    async function financials(id: string) { const c = await accepted(id); const ex = await stmt("SELECT COALESCE(SUM(total),0) total FROM extra_works WHERE order_id=? AND status='APPROVED'", id).first<{
        total: number;
    }>(); const p = await stmt("SELECT COALESCE(SUM(amount),0) gross,COALESCE(SUM(refunded),0) refunded FROM payments WHERE order_id=? AND status IN ('DONE','PARTIAL_CANCELED','CANCELED')", id).first<{
        gross: number;
        refunded: number;
    }>(); const gross = p?.gross ?? 0, refunded = p?.refunded ?? 0; const fee = Math.floor((gross - refunded) * c.commission_bps / 10000); return { contract: c, expected: c.total + (ex?.total ?? 0), gross, refunded, fee, payable: gross - refunded - fee }; }
    async function applyPayment(u: User | null, p: Payment, v: ProviderPayment) {
        p = (await stmt('SELECT * FROM payments WHERE id=?', p.id).first<Payment>())!;
        if (p.mode !== provider.mode) fail(409, '결제 환경이 변경되었습니다. 기존 결제 환경에서 확인해 주세요.');
        if (v.orderId !== p.id || v.totalAmount !== p.amount || v.balanceAmount > v.totalAmount || (p.provider_key && p.provider_key !== v.paymentKey))
            fail(409, '결제사 거래 정보가 주문과 일치하지 않습니다.');
        const o = u ? (await context(u, p.order_id)).o : await stmt('SELECT * FROM orders WHERE id=?',p.order_id).first<Order>();
        if(!o) fail(404,'주문을 찾을 수 없습니다.');
        const mapped = ['DONE', 'PARTIAL_CANCELED', 'CANCELED', 'ABORTED', 'EXPIRED'].includes(v.status) ? v.status : 'PROCESSING';
        const refunded = ['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(mapped) ? p.amount - v.balanceAmount : 0;
        if (refunded < p.refunded || (['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(p.status) && !['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(mapped)) || (mapped === 'DONE' && refunded !== 0) || (mapped === 'CANCELED' && refunded !== p.amount))
            fail(409, '결제사 상태를 다시 확인해 주세요.');
        if (p.status === mapped && p.refunded === refunded && p.provider_key === v.paymentKey)
            return { ok: true };
        // A late financial response is always recorded, even when the transaction is under dispute.
        const c = await accepted(o.id);
        const scheduleReady = o.status === 'BID_SELECTED' && p.kind === 'DEPOSIT' && mapped === 'DONE' && refunded === 0;
        const receipt = v.receipt?.url && new URL(v.receipt.url).protocol === 'https:' ? v.receipt.url : null;
        return commit(u ?? {id:'system:tosspayments',role:'SYSTEM'}, o, 'PAYMENT_RECONCILED', '결제사에서 결제 상태를 확인했습니다.', [stmt('UPDATE payments SET status=?,provider_key=?,refunded=?,receipt_url=?,updated_at=? WHERE id=?', mapped, v.paymentKey, refunded, receipt, now(), p.id), ...(refunded > p.refunded ? [stmt("UPDATE settlements SET status='HELD',reason='환불 반영 후 재검토 필요',updated_at=? WHERE order_id=? AND status!='PAID'", now(), o.id)] : [])], scheduleReady ? 'SCHEDULED' : o.status, { paymentId: p.id, status: mapped, amount: p.amount, refunded, contractId: c.id });
    }
    return {
        async detail(u: User, id: string) { const { o } = await context(u, id); const terms = await stmt('SELECT commission_bps FROM trade_terms WHERE order_id=?', id).first<{
            commission_bps: number;
        }>(); return { contracts: await rows<Contract>('SELECT * FROM contracts WHERE order_id=? ORDER BY version DESC', id), extras: await rows<Extra>('SELECT * FROM extra_works WHERE order_id=? ORDER BY created_at DESC', id), schedules: await rows<ScheduleChange>('SELECT * FROM schedule_changes WHERE order_id=? ORDER BY created_at DESC', id), completions: await rows<Completion>('SELECT * FROM completions WHERE order_id=? ORDER BY created_at DESC', id), payments: (await rows<Payment>('SELECT * FROM payments WHERE order_id=? ORDER BY created_at DESC', id)).map(p => ({ ...p, provider_key: null })), refunds: await rows<Refund>('SELECT r.* FROM refunds r JOIN payments p ON r.payment_id=p.id WHERE p.order_id=?', id), disputes: await rows<Dispute>('SELECT * FROM disputes WHERE order_id=? ORDER BY created_at DESC', id), settlement: await stmt('SELECT * FROM settlements WHERE order_id=?', id).first<Settlement>(), commissionBps: terms?.commission_bps ?? null, slot: await stmt('SELECT date,start_hour,end_hour FROM schedule_slots WHERE order_id=?', id).first<{
                date: string;
                start_hour: number;
                end_hour: number;
            }>(), photos: await rows<Pick<Photo, 'id' | 'mime'>>('SELECT id,mime FROM photos WHERE order_id=? AND expires_at>?', o.id, now()), provider: { ready: provider.ready, mode: provider.mode } }; },
        async terms(u: User, id: string, raw: unknown) { admin(u); const i = z.object({ commissionBps: z.number().int().min(0).max(10000), reason }).strict().parse(raw); const { o } = await context(u, id); if (o.status !== 'BID_SELECTED' || await stmt('SELECT id FROM contracts WHERE order_id=?', id).first())
            fail(409, '계약 발행 전 선택된 주문에서만 수수료 조건을 정할 수 있습니다.'); return commit(u, o, 'COMMISSION_TERMS', i.reason, [stmt('INSERT INTO trade_terms (order_id,commission_bps,reason,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET commission_bps=excluded.commission_bps,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at', id, i.commissionBps, i.reason, u.id, now())], o.status, { commissionBps: i.commissionBps, basis: 'VAT 포함 실수납액(환불 차감 후)', rounding: '원 미만 버림' }); },
        async proposeContract(u: User, id: string, raw: unknown) { const i = z.object({ deposit: money, terms: reason, ...schedule }).strict().parse(raw); validateSchedule(i); const { o, b, partner } = await context(u, id); if (!partner || !b)
            fail(403, '선택된 파트너만 계약을 발행할 수 있습니다.'); if (o.status !== 'BID_SELECTED' || await stmt("SELECT id FROM contracts WHERE order_id=? AND status='ACCEPTED'", id).first())
            fail(409, '이미 계약이 확정되었습니다.'); if (i.deposit > b.total)
            fail(400, '예약금은 총액을 초과할 수 없습니다.'); const t = await stmt('SELECT commission_bps FROM trade_terms WHERE order_id=?', id).first<{
            commission_bps: number;
        }>(); if (!t)
            fail(409, '관리자의 수수료 조건 확정을 기다려 주세요.'); const n = await stmt('SELECT COALESCE(MAX(version),0)+1 version FROM contracts WHERE order_id=?', id).first<{
            version: number;
        }>(); const cid = uid(); return commit(u, o, 'CONTRACT_PROPOSED', '고객 확인을 요청하는 계약서가 도착했습니다.', [stmt("UPDATE contracts SET status='SUPERSEDED' WHERE order_id=? AND status='PROPOSED'", id), stmt("INSERT INTO contracts (id,order_id,version,partner_id,snapshot,total,deposit,commission_bps,terms,date,start_hour,end_hour,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'PROPOSED',?)", cid, id, n!.version, b.partner_id, JSON.stringify(b), b.total, i.deposit, t.commission_bps, i.terms, i.date, i.startHour, i.endHour, now())], o.status, { contractId: cid, version: n!.version, total: b.total, deposit: i.deposit }); },
        async decideContract(u: User, id: string, raw: unknown) { const i = z.object({ contractId: z.string().uuid(), accept: z.boolean(), consent: z.literal(true) }).strict().parse(raw); const { o, b, owner } = await context(u, id); if (!owner || !b)
            fail(403, '주문 고객만 계약을 결정할 수 있습니다.'); const c = await stmt("SELECT * FROM contracts WHERE id=? AND order_id=? AND status='PROPOSED'", i.contractId, id).first<Contract>(); if (!c || o.status !== 'BID_SELECTED')
            fail(409, '최신 계약서를 다시 확인해 주세요.'); if (i.accept)
            validateSchedule({ date: c.date, startHour: c.start_hour, endHour: c.end_hour }); return commit(u, o, 'CONTRACT_DECIDED', i.accept ? '고객이 계약과 방문 일정에 동의했습니다.' : '고객이 계약 수정을 요청했습니다.', [stmt('UPDATE contracts SET status=?,accepted_at=? WHERE id=?', i.accept ? 'ACCEPTED' : 'DECLINED', i.accept ? now() : null, c.id), ...(i.accept ? [stmt('DELETE FROM schedule_slots WHERE order_id=?', id), stmt('INSERT INTO schedule_slots (order_id,partner_id,date,start_hour,end_hour) VALUES (?,?,?,?,?)', id, b.partner_id, c.date, c.start_hour, c.end_hour)] : [])], i.accept && c.deposit === 0 ? 'SCHEDULED' : o.status, { contractId: c.id, accepted: i.accept }); },
        async chat(u: User, id: string, partnerId: string, before = SEQ_MAX) {
            z.number().int().positive().max(SEQ_MAX).parse(before);
            // Refresh authority during long-lived streams, including suspension and role changes.
            const actor = await stmt('SELECT * FROM users WHERE id=?', u.id).first<User>();
            const o = await stmt('SELECT * FROM orders WHERE id=?', id).first<Order>();
            if (!actor || actor.suspended || !o) fail(403, '대화방에 접근할 수 없습니다.');
            const support = partnerId === SUPPORT_THREAD;
            const b = support ? null : await stmt('SELECT * FROM bids WHERE order_id=? AND partner_id=?', id, partnerId).first<Bid>();
            if (actor.role === 'PARTNER' && !await stmt("SELECT user_id FROM partners WHERE user_id=? AND status='APPROVED'", actor.id).first()) fail(403, '파트너 승인이 필요합니다.');
            const owner = o.customer_id === actor.id;
            if (support ? !(actor.role === 'ADMIN' || owner) : !b || !(actor.role === 'ADMIN' || owner || (actor.role === 'PARTNER' && actor.id === partnerId))) fail(403, '이 대화방의 참여자가 아닙니다.');
            return { messages: (await rows<Message>('SELECT * FROM messages WHERE order_id=? AND partner_id=? AND seq<? ORDER BY seq DESC LIMIT 50', id, partnerId, before)).reverse(), readOnly: !support && (['CANCELLED', 'EXPIRED', 'SETTLED'].includes(o.status) || !!(o.selected_bid_id && o.selected_bid_id !== b?.id)) };
        },
        async send(u: User, id: string, raw: unknown) {
            const i = z.object({ id: z.string().uuid(), partnerId: z.string().min(1).max(200), body: z.string().trim().min(1).max(2000), photoIds: photos }).strict().parse(raw);
            const thread = await this.chat(u, id, i.partnerId);
            if (thread.readOnly) fail(409, '종료된 상담입니다. 이전 대화만 확인할 수 있습니다.');
            const existing = await stmt('SELECT * FROM messages WHERE id=?', i.id).first<Message>();
            if (existing) {
                if (existing.sender_id !== u.id || existing.order_id !== id || existing.partner_id !== i.partnerId || existing.body !== i.body || existing.photo_ids !== JSON.stringify(i.photoIds)) fail(409, '메시지 식별자가 중복되었습니다.');
                return { ok: true };
            }
            const o = (await stmt('SELECT * FROM orders WHERE id=?', id).first<Order>())!;
            const support = i.partnerId === SUPPORT_THREAD;
            if (i.photoIds.length) {
                if (support) fail(400, '사진은 작업 상세에 첨부해 주세요.');
                await context(u, id);
                if (!o.selected_bid_id) fail(409, '사진은 파트너 선택 후 공유할 수 있습니다.');
                await checkPhotos(id, i.photoIds);
            }
            const admins = support ? await rows<{id:string}>("SELECT id FROM users WHERE role='ADMIN' AND suspended=0") : [];
            const recipients = new Set([o.customer_id, ...(support ? admins.map(a=>a.id) : [i.partnerId])]);
            recipients.delete(u.id);
            await db.batch([guard(o), stmt("INSERT INTO messages (id,order_id,partner_id,sender_id,sender_name,kind,body,photo_ids,created_at) VALUES (?,?,?,?,?,'TEXT',?,?,?)", i.id, id, i.partnerId, u.id, u.name, i.body, JSON.stringify(i.photoIds), now()), ...[...recipients].map(recipient=>stmt('INSERT INTO notifications (id,user_id,order_id,message,created_at) VALUES (?,?,?,?,?)', uid(), recipient, id, support ? '운영팀 상담 메시지가 도착했습니다.' : '새 상담 메시지가 도착했습니다.', now())), ...(u.role === 'ADMIN' ? [audit(u, o, 'ADMIN_MESSAGE', { messageId: i.id, thread: i.partnerId }, '관리자가 대화에 참여했습니다.')] : [])]);
            return { ok: true };
        },
        async notifications(u: User) { return rows<Notification>('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100', u.id); },
        async readNotification(u: User, raw: unknown) { const i = z.object({ id: z.string().uuid() }).strict().parse(raw); await stmt('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?', now(), i.id, u.id).run(); return { ok: true }; },
        async proposeSchedule(u: User, id: string, raw: unknown) { const i = z.object({ ...schedule, reason }).strict().parse(raw); validateSchedule(i); const { o, partner } = await context(u, id); if (!partner)
            fail(403, '담당 파트너만 일정 변경을 요청할 수 있습니다.'); await accepted(id); if (!['BID_SELECTED', 'SCHEDULED'].includes(o.status))
            fail(409, '작업 시작 전 일정만 변경할 수 있습니다.'); return commit(u, o, 'SCHEDULE_PROPOSED', '방문 일정 변경 승인을 요청했습니다.', [stmt("UPDATE schedule_changes SET status='SUPERSEDED' WHERE order_id=? AND status='PROPOSED'", id), stmt("INSERT INTO schedule_changes (id,order_id,date,start_hour,end_hour,reason,status,created_at) VALUES (?,?,?,?,?,?,'PROPOSED',?)", uid(), id, i.date, i.startHour, i.endHour, i.reason, now())]); },
        async decideSchedule(u: User, id: string, raw: unknown) { const i = z.object({ id: z.string().uuid(), accept: z.boolean() }).strict().parse(raw); const { o, b, owner } = await context(u, id); if (!owner || !b)
            fail(403, '고객만 일정 변경을 승인할 수 있습니다.'); if (!['BID_SELECTED', 'SCHEDULED'].includes(o.status))
            fail(409, '일정을 변경할 수 없는 상태입니다.'); const s = await stmt("SELECT * FROM schedule_changes WHERE id=? AND order_id=? AND status='PROPOSED'", i.id, id).first<ScheduleChange>(); if (!s)
            fail(409, '유효한 일정 변경 요청이 없습니다.'); if (i.accept)
            validateSchedule({ date: s.date, startHour: s.start_hour, endHour: s.end_hour }); return commit(u, o, 'SCHEDULE_DECIDED', i.accept ? '고객이 새 방문 일정을 승인했습니다.' : '고객이 일정 변경을 거절했습니다.', [stmt('UPDATE schedule_changes SET status=?,decided_at=? WHERE id=?', i.accept ? 'APPROVED' : 'REJECTED', now(), i.id), ...(i.accept ? [stmt('DELETE FROM schedule_slots WHERE order_id=?', id), stmt('INSERT INTO schedule_slots (order_id,partner_id,date,start_hour,end_hour) VALUES (?,?,?,?,?)', id, b.partner_id, s.date, s.start_hour, s.end_hour)] : [])]); },
        async extra(u: User, id: string, raw: unknown) { const i = z.object({ description: reason, supply: money.refine(n => n > 0), photoIds: photos }).strict().parse(raw); const { o, partner } = await context(u, id); if (!partner)
            fail(403, '담당 파트너만 추가 작업을 요청할 수 있습니다.'); await accepted(id); if (!['SCHEDULED', 'IN_PROGRESS'].includes(o.status))
            fail(409, '추가 작업을 요청할 수 없는 상태입니다.'); await checkPhotos(id, i.photoIds); const vat = Math.round(i.supply * .1), total = i.supply + vat; return commit(u, o, 'EXTRA_PROPOSED', '추가 작업의 내용과 비용 승인을 요청했습니다.', [stmt("INSERT INTO extra_works (id,order_id,partner_id,description,supply,vat,total,photo_ids,status,created_at) VALUES (?,?,?,?,?,?,?,?,'PROPOSED',?)", uid(), id, u.id, i.description, i.supply, vat, total, JSON.stringify(i.photoIds), now())], o.status, { supply: i.supply, vat, total }); },
        async decideExtra(u: User, id: string, raw: unknown) { const i = z.object({ id: z.string().uuid(), accept: z.boolean(), expectedTotal: money, consent: z.boolean() }).strict().parse(raw); if(i.accept && !i.consent) fail(400, '추가 작업 내용과 금액에 동의해 주세요.'); const { o, owner } = await context(u, id); if (!owner)
            fail(403, '고객만 추가 작업을 승인할 수 있습니다.'); if (!['SCHEDULED', 'IN_PROGRESS'].includes(o.status))
            fail(409, '추가 작업을 결정할 수 없는 상태입니다.'); const e = await stmt("SELECT * FROM extra_works WHERE id=? AND order_id=? AND status='PROPOSED'", i.id, id).first<Extra>(); if (!e)
            fail(409, '이미 처리된 추가 작업입니다.'); if(i.expectedTotal!==e.total) fail(409, '표시된 추가 작업 금액을 다시 확인해 주세요.'); const snapshot={extraId:e.id,description:e.description,supply:e.supply,vat:e.vat,total:e.total,photoIds:JSON.parse(e.photo_ids),actorId:u.id,accepted:i.accept,consent:i.consent,decidedAt:now()}; return commit(u, o, 'EXTRA_DECIDED', i.accept ? '고객이 추가 작업과 금액을 승인했습니다.' : '고객이 추가 작업을 거절했습니다.', [stmt('UPDATE extra_works SET status=?,decided_at=?,decided_by=?,decision_snapshot=? WHERE id=?', i.accept ? 'APPROVED' : 'REJECTED', snapshot.decidedAt, u.id, JSON.stringify(snapshot), i.id)], o.status, snapshot); },
        async start(u: User, id: string, raw: unknown) { z.object({ confirmed: z.literal(true) }).strict().parse(raw); const { o, partner } = await context(u, id); if (!partner)
            fail(403, '담당 파트너만 작업을 시작할 수 있습니다.'); if (o.status !== 'SCHEDULED')
            fail(409, '계약·예약금·일정 확정 후 시작할 수 있습니다.'); const c = await accepted(id); if (c.deposit > 0 && !await stmt("SELECT id FROM payments WHERE order_id=? AND kind='DEPOSIT' AND status='DONE' AND refunded=0", id).first())
            fail(409, '예약금 결제를 확인해 주세요.'); if (await stmt("SELECT id FROM schedule_changes WHERE order_id=? AND status='PROPOSED'", id).first())
            fail(409, '대기 중인 일정 변경을 먼저 결정해 주세요.'); const slot = await stmt('SELECT date,start_hour FROM schedule_slots WHERE order_id=?', id).first<{
            date: string;
            start_hour: number;
        }>(); if (!slot || new Date(slot.date + 'T' + String(slot.start_hour).padStart(2, '0') + ':00:00+09:00').getTime() > Date.now())
            fail(409, '확정된 방문 시각부터 작업을 시작할 수 있습니다.'); return commit(u, o, 'WORK_STARTED', '파트너가 작업을 시작했습니다.', [], 'IN_PROGRESS'); },
        async complete(u: User, id: string, raw: unknown) { const i = z.object({ summary: reason, beforePhotos: photos.refine(v => v.length > 0, '작업 전 사진을 선택해 주세요.'), afterPhotos: photos.refine(v => v.length > 0, '작업 후 사진을 선택해 주세요.') }).strict().parse(raw); const { o, partner } = await context(u, id); if (!partner)
            fail(403, '담당 파트너만 완료 확인을 요청할 수 있습니다.'); if (o.status !== 'IN_PROGRESS')
            fail(409, '진행 중인 작업만 완료 요청할 수 있습니다.'); if (i.beforePhotos.some(p => i.afterPhotos.includes(p)))
            fail(400, '작업 전후 사진은 서로 다른 사진이어야 합니다.'); await checkPhotos(id, [...i.beforePhotos, ...i.afterPhotos]); if (await stmt("SELECT id FROM extra_works WHERE order_id=? AND status='PROPOSED'", id).first())
            fail(409, '대기 중인 추가 작업을 먼저 결정해 주세요.'); return commit(u, o, 'COMPLETION_REQUESTED', '작업 전후 사진과 완료 확인 요청이 도착했습니다.', [stmt("INSERT INTO completions (id,order_id,summary,before_photos,after_photos,status,created_at) VALUES (?,?,?,?,?,'REQUESTED',?)", uid(), id, i.summary, JSON.stringify(i.beforePhotos), JSON.stringify(i.afterPhotos), now())], 'COMPLETION_REQUESTED'); },
        async confirmCompletion(u: User, id: string, raw: unknown) { const i = z.object({ id: z.string().uuid(), accept: z.boolean(), reason }).strict().parse(raw); const { o, owner } = await context(u, id); if (!owner)
            fail(403, '고객만 작업 완료를 확인할 수 있습니다.'); if (o.status !== 'COMPLETION_REQUESTED')
            fail(409, '완료 확인 요청이 없습니다.'); if (!await stmt("SELECT id FROM completions WHERE id=? AND order_id=? AND status='REQUESTED'", i.id, id).first())
            fail(409, '최신 완료 요청을 확인해 주세요.'); return commit(u, o, 'COMPLETION_DECIDED', i.accept ? '고객이 작업 완료를 확인했습니다.' : '고객이 작업 보완을 요청했습니다.', [stmt('UPDATE completions SET status=?,response=?,decided_at=? WHERE id=?', i.accept ? 'CONFIRMED' : 'REWORK', i.reason, now(), i.id), ...(i.accept ? [stmt('DELETE FROM schedule_slots WHERE order_id=?', id)] : [])], i.accept ? 'COMPLETED' : 'IN_PROGRESS'); },
        async preparePayment(u: User, id: string, raw: unknown) { const i = z.object({ kind: z.enum(['DEPOSIT', 'BALANCE', 'EXTRA']), extraId: z.string().uuid().optional() }).strict().parse(raw); const { o, owner } = await context(u, id); if (!owner)
            fail(403, '고객만 결제할 수 있습니다.'); if (!provider.ready)
            fail(503, '결제사 연결을 준비 중입니다. 아직 결제할 수 없습니다.'); if (['DISPUTED', 'CANCELLED', 'SETTLED'].includes(o.status))
            fail(409, '현재 거래는 결제할 수 없습니다.'); if(await stmt("SELECT id FROM payments WHERE order_id=? AND mode!=?",id,provider.mode).first()) fail(409, '테스트·실결제 환경을 같은 주문에서 섞을 수 없습니다.'); const c = await accepted(id); let amount = 0, target = c.id; if (i.kind === 'DEPOSIT') {
            if (!['BID_SELECTED', 'SCHEDULED'].includes(o.status))
                fail(409, '예약금 결제 단계가 아닙니다.');
            amount = c.deposit;
        }
        else if (i.kind === 'BALANCE') {
            if (o.status !== 'COMPLETED')
                fail(409, '고객의 작업 완료 확인 후 잔금을 결제합니다.');
            amount = c.total - c.deposit;
        }
        else {
            const e = await stmt("SELECT * FROM extra_works WHERE id=? AND order_id=? AND status='APPROVED'", i.extraId ?? '', id).first<Extra>();
            if (!e)
                fail(409, '승인된 추가 작업만 결제할 수 있습니다.');
            amount = e.total;
            target = e.id;
        } if (amount <= 0)
            fail(409, '결제할 금액이 없습니다.'); const current = await stmt("SELECT * FROM payments WHERE order_id=? AND kind=? AND target_id=? AND status NOT IN ('ABORTED','EXPIRED') ORDER BY created_at DESC LIMIT 1", id, i.kind, target).first<Payment>(); if (current && current.status !== 'READY')
            fail(409, '기존 결제 상태를 먼저 확인해 주세요.'); let pid = current?.id; if (!pid) {
            pid = uid();
            await commit(u, o, 'PAYMENT_PREPARED', '결제 요청을 준비했습니다.', [stmt("INSERT INTO payments (id,order_id,target_id,kind,amount,status,mode,created_at,updated_at) VALUES (?,?,?,?,?,'READY',?,?,?)", pid, id, target, i.kind, amount, provider.mode, now(), now())]);
        } return { id: pid, amount, clientKey: provider.clientKey, mode: provider.mode, orderName: '반듯집수리 ' + ({ DEPOSIT: '예약금', BALANCE: '잔금', EXTRA: '추가 작업' }[i.kind]), customerKey: pid }; },
        async confirmPayment(u: User, id: string, raw: unknown) { const i = z.object({ paymentId: z.string().uuid(), paymentKey: z.string().min(1).max(200), amount: z.number().int().positive().max(400000000) }).strict().parse(raw); const { o, owner } = await context(u, id); if (!owner)
            fail(403, '본인 결제만 승인할 수 있습니다.'); const p = await stmt('SELECT * FROM payments WHERE id=? AND order_id=?', i.paymentId, id).first<Payment>(); if(p && p.mode!==provider.mode) fail(409, '결제 환경이 변경되었습니다.'); if (!p || p.amount !== i.amount)
            fail(400, '결제 요청 금액을 확인해 주세요.'); if (['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(p.status))
            return this.reconcile(u, id, { paymentId: p.id }); if (!['READY', 'PROCESSING'].includes(p.status) || ['DISPUTED', 'CANCELLED', 'SETTLED'].includes(o.status))
            fail(409, '결제 승인을 진행할 수 없습니다.'); if (p.provider_key && p.provider_key !== i.paymentKey)
            fail(409, '결제 정보가 일치하지 않습니다.'); if (p.status === 'READY')
            await commit(u, o, 'PAYMENT_CONFIRMING', '결제사 승인을 확인하고 있습니다.', [stmt("UPDATE payments SET status='PROCESSING',provider_key=?,updated_at=? WHERE id=?", i.paymentKey, now(), p.id)]); let v: ProviderPayment; try {
            v = await provider.confirm(p.id, i.paymentKey, p.amount);
        }
        catch {
            v = await provider.lookup(p.id);
        } return applyPayment(u, { ...p, provider_key: i.paymentKey }, v); },
        async paymentWebhook(raw: unknown) {
            const event=z.object({eventType:z.literal('PAYMENT_STATUS_CHANGED'),data:z.object({orderId:z.string().uuid()})}).parse(raw);
            const p=await stmt('SELECT * FROM payments WHERE id=?',event.data.orderId).first<Payment>();
            if(!p) return {ok:true};
            if(!provider.ready) fail(503,'결제사 연결을 확인해 주세요.');
            if(p.mode!==provider.mode) fail(409,'결제 환경이 변경되었습니다.');
            const key='payment-hook:'+p.id+':'+now().slice(0,16);
            await stmt('INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1',key,new Date(Date.now()+3600000).toISOString()).run();
            if(((await stmt('SELECT count FROM rate_limits WHERE key=?',key).first<{count:number}>())?.count??0)>20) fail(429,'잠시 후 다시 전송해 주세요.');
            // Payment webhooks have no signature. Treat the payload only as a lookup hint;
            // the secret-authenticated provider response is the sole authority for money.
            return applyPayment(null,p,await provider.lookup(p.id));
        },
        async reconcile(u: User, id: string, raw: unknown) { const i = z.object({ paymentId: z.string().uuid() }).strict().parse(raw); const { owner } = await context(u, id); if (!owner && u.role !== 'ADMIN')
            fail(403, '고객과 관리자만 결제사 상태를 확인할 수 있습니다.'); const p = await stmt('SELECT * FROM payments WHERE id=? AND order_id=?', i.paymentId, id).first<Payment>(); if (!p)
            fail(404, '결제 요청이 없습니다.'); if(p.mode!==provider.mode) fail(409, '결제 환경이 변경되었습니다.'); try {
            return await applyPayment(u, p, await provider.lookup(p.id));
        }
        catch (e) {
            if ((e as {
                providerCode?: string;
            }).providerCode === 'NOT_FOUND_PAYMENT' && p.status === 'READY' && Date.now() - new Date(p.created_at).getTime() > 30 * 60000) {
                const { o } = await context(u, id);
                return commit(u, o, 'PAYMENT_EXPIRED', '결제사에서 미생성 결제를 확인해 요청을 만료했습니다.', [stmt("UPDATE payments SET status='EXPIRED',updated_at=? WHERE id=? AND status='READY'", now(), p.id)]);
            }
            throw e;
        } },
        async openDispute(u: User, id: string, raw: unknown) { const i = z.object({ reason, photoIds: photos }).strict().parse(raw); const { o } = await context(u, id); if (!o.selected_bid_id || ['CANCELLED', 'EXPIRED', 'DISPUTED'].includes(o.status))
            fail(409, '분쟁을 접수할 수 없는 상태입니다.'); await checkPhotos(id, i.photoIds); return commit(u, o, 'DISPUTE_OPENED', '분쟁이 접수되어 거래 진행과 미지급 정산을 보류했습니다.', [stmt("INSERT INTO disputes (id,order_id,opened_by,reason,photo_ids,previous_status,status,created_at) VALUES (?,?,?,?,?,?,'OPEN',?)", uid(), id, u.id, i.reason, JSON.stringify(i.photoIds), o.status, now()), stmt("UPDATE settlements SET status='HELD',reason=?,updated_at=? WHERE order_id=? AND status!='PAID'", i.reason, now(), id)], 'DISPUTED'); },
        async resolve(u: User, id: string, raw: unknown) { admin(u); const i = z.object({ id: z.string().uuid(), decision: z.enum(['RESUME', 'CANCEL']), reason }).strict().parse(raw); const { o } = await context(u, id); const d = await stmt("SELECT * FROM disputes WHERE id=? AND order_id=? AND status='OPEN'", i.id, id).first<Dispute>(); if (!d || o.status !== 'DISPUTED')
            fail(409, '진행 중인 분쟁이 없습니다.'); if (i.decision === 'CANCEL') {
            if (await activePayments(id))
                fail(409, '결제 상태 확인과 환불을 먼저 완료해 주세요.');
            if (await stmt("SELECT order_id FROM settlements WHERE order_id=? AND status='PAID'", id).first())
                fail(409, '이미 지급한 거래는 자동 취소할 수 없습니다.');
        } return commit(u, o, 'DISPUTE_RESOLVED', i.reason, [stmt("UPDATE disputes SET status='RESOLVED',resolution=?,resolved_by=?,resolved_at=? WHERE id=?", i.decision + ': ' + i.reason, u.id, now(), i.id), ...(i.decision === 'CANCEL' ? [stmt('DELETE FROM schedule_slots WHERE order_id=?', id), stmt("UPDATE extra_works SET status='REJECTED',decided_at=? WHERE order_id=? AND status='PROPOSED'", now(), id)] : [])], i.decision === 'CANCEL' ? 'CANCELLED' : d.previous_status); },
        async cancel(u: User, id: string, raw: unknown) { const i = z.object({ reason }).strict().parse(raw); const { o, owner } = await context(u, id); if (!owner && u.role !== 'ADMIN')
            fail(403, '고객 또는 관리자만 취소할 수 있습니다.'); if (!['BID_SELECTED', 'SCHEDULED'].includes(o.status))
            fail(409, '작업 시작 후에는 분쟁 접수로 취소를 요청해 주세요.'); if (await activePayments(id))
            fail(409, '결제 내역이 있어 관리자 환불 검토가 필요합니다. 분쟁·취소 요청을 접수해 주세요.'); return commit(u, o, 'TRADE_CANCELLED', i.reason, [stmt('DELETE FROM schedule_slots WHERE order_id=?', id)], 'CANCELLED'); },
        async refund(u: User, id: string, raw: unknown) {
            admin(u);
            const i = z.object({ requestId: z.string().uuid(), paymentId: z.string().uuid(), amount: money.refine(n => n > 0), reason: z.string().trim().min(5).max(200) }).strict().parse(raw);
            const { o } = await context(u, id);
            if (o.status !== 'DISPUTED')
                fail(409, '분쟁 검토 상태에서 환불을 처리해 주세요.');
            if (await stmt("SELECT order_id FROM settlements WHERE order_id=? AND status='PAID'", id).first())
                fail(409, '지급 완료 거래는 별도 회수 절차가 필요합니다.');
            const p = await stmt('SELECT * FROM payments WHERE id=? AND order_id=?', i.paymentId, id).first<Payment>();
            if (!p?.provider_key)
                fail(404, '확인된 결제 정보가 없습니다.');
            let r = await stmt('SELECT * FROM refunds WHERE id=?', i.requestId).first<Refund>();
            if (r && (r.payment_id !== p.id || r.amount !== i.amount || r.reason !== i.reason))
                fail(409, '기존 환불 요청과 내용이 다릅니다.');
            if (r?.status === 'DONE')
                return this.reconcile(u, id, { paymentId: p.id });
            if (r) {
                const current = await provider.lookup(p.id);
                const expected = p.amount - r.prior_refunded - r.amount;
                if (current.balanceAmount === expected) {
                    await applyPayment(u, p, current);
                    await stmt("UPDATE refunds SET status='DONE' WHERE id=?", r.id).run();
                    return { ok: true };
                }
                if (current.balanceAmount !== p.amount - r.prior_refunded || Date.now() - new Date(r.created_at).getTime() > 23 * 3600000)
                    fail(409, '결제사 환불 내역을 관리자와 확인해야 합니다. 새 환불을 생성하지 마세요.');
            }
            else {
                if (!['DONE', 'PARTIAL_CANCELED'].includes(p.status) || i.amount > p.amount - p.refunded)
                    fail(409, '환불 가능한 잔액을 확인해 주세요.');
                if (await stmt("SELECT id FROM refunds WHERE payment_id=? AND status='PENDING'", p.id).first())
                    fail(409, '진행 중인 환불 요청을 먼저 확인해 주세요.');
                r = { id: i.requestId, payment_id: p.id, amount: i.amount, prior_refunded: p.refunded, reason: i.reason, status: 'PENDING', actor_id: u.id, created_at: now() };
                await commit(u, o, 'REFUND_REQUESTED', i.reason, [stmt("INSERT INTO refunds (id,payment_id,amount,prior_refunded,reason,status,actor_id,created_at) VALUES (?,?,?,?,?,'PENDING',?,?)", r.id, p.id, r.amount, r.prior_refunded, r.reason, u.id, r.created_at)]);
            }
            const v = await provider.refund(p.provider_key, r.amount, r.reason, r.id);
            await applyPayment(u, p, v);
            if (v.balanceAmount !== p.amount - r.prior_refunded - r.amount)
                fail(409, '환불 결과를 다시 확인해 주세요.');
            await stmt("UPDATE refunds SET status='DONE' WHERE id=?", r.id).run();
            return { ok: true };
        },
        async settlement(u: User, id: string, raw: unknown) {
            admin(u);
            const i = z.object({ action: z.enum(['APPROVE', 'HOLD', 'RECORD_TRANSFER']), reason, transferReference: z.string().trim().min(6).max(100).optional(), paidAt: z.string().datetime().optional(), verified: z.boolean().optional() }).strict().parse(raw);
            if (i.action !== 'HOLD') {
                await context(u, id);
                const paid = await rows<Payment>("SELECT * FROM payments WHERE order_id=? AND status IN ('DONE','PARTIAL_CANCELED','CANCELED')", id);
                for (const p of paid)
                    await this.reconcile(u, id, { paymentId: p.id });
            }
            const { o, b } = await context(u, id);
            if (!b)
                fail(409, '선택된 파트너가 없습니다.');
            const old = await stmt('SELECT * FROM settlements WHERE order_id=?', id).first<Settlement>();
            if (old?.status === 'PAID')
                fail(409, '이미 지급 기록이 확정되었습니다.');
            const f = await financials(id);
            if (i.action !== 'HOLD') {
                if (o.status !== 'COMPLETED')
                    fail(409, '작업 완료 및 분쟁 해결 후 정산할 수 있습니다.');
                if (f.contract.deposit > 0 && !await stmt("SELECT id FROM payments WHERE order_id=? AND kind='DEPOSIT' AND status IN ('DONE','PARTIAL_CANCELED','CANCELED') AND amount=?", id, f.contract.deposit).first())
                    fail(409, '예약금 결제가 확인되지 않았습니다.');
                if (f.contract.total > f.contract.deposit && !await stmt("SELECT id FROM payments WHERE order_id=? AND kind='BALANCE' AND status IN ('DONE','PARTIAL_CANCELED','CANCELED') AND amount=?", id, f.contract.total - f.contract.deposit).first())
                    fail(409, '잔금 결제가 확인되지 않았습니다.');
                if (f.gross !== f.expected)
                    fail(409, '계약·승인된 추가 작업의 최초 결제액이 일치해야 합니다.');
                if (await stmt("SELECT id FROM payments WHERE order_id=? AND status IN ('READY','PROCESSING')", id).first() || await stmt("SELECT r.id FROM refunds r JOIN payments p ON r.payment_id=p.id WHERE p.order_id=? AND r.status='PENDING'", id).first())
                    fail(409, '미확정 결제·환불을 먼저 확인해 주세요.');
            }
            if (i.action === 'RECORD_TRANSFER') {
                if(provider.mode!=='live' || await stmt("SELECT id FROM payments WHERE order_id=? AND mode!='live'",id).first()) fail(409, '테스트·미확인 결제는 실제 지급 기록으로 처리할 수 없습니다.');
                if (!old || old.status !== 'APPROVED' || !i.verified || !i.transferReference || !i.paidAt || new Date(i.paidAt).getTime() > Date.now() || new Date(i.paidAt).getTime() < new Date(old.approved_at!).getTime())
                    fail(409, '승인 이후 실제 이체 시각과 거래번호, 증빙 확인이 필요합니다.');
                if (old.payable !== f.payable)
                    fail(409, '정산 금액이 변경되어 재승인이 필요합니다.');
                return commit(u, o, 'TRANSFER_RECORDED', i.reason, [stmt("UPDATE settlements SET status='PAID',transfer_reference=?,paid_at=?,reason=?,updated_at=? WHERE order_id=?", i.transferReference, i.paidAt, i.reason, now(), id)], 'SETTLED', { payable: f.payable, reference: i.transferReference, source: 'ADMIN_RECORDED_NOT_BANK_VERIFIED' });
            }
            return commit(u, o, 'SETTLEMENT_' + i.action, i.reason, [stmt('INSERT INTO settlements (order_id,partner_id,gross,refunded,fee,payable,status,reason,approved_by,approved_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET gross=excluded.gross,refunded=excluded.refunded,fee=excluded.fee,payable=excluded.payable,status=excluded.status,reason=excluded.reason,approved_by=excluded.approved_by,approved_at=excluded.approved_at,updated_at=excluded.updated_at', id, b.partner_id, f.gross, f.refunded, f.fee, f.payable, i.action === 'APPROVE' ? (f.payable === 0 ? 'NO_PAYOUT' : 'APPROVED') : 'HELD', i.reason, i.action === 'APPROVE' ? u.id : null, i.action === 'APPROVE' ? now() : null, now())], i.action === 'APPROVE' && f.payable === 0 ? 'SETTLED' : o.status, { gross: f.gross, fee: f.fee, payable: f.payable });
        },
        async ledger(u: User, kind: 'settlements' | 'disputes') { if (kind === 'disputes')
            admin(u); if (u.role !== 'ADMIN' && u.role !== 'PARTNER')
            fail(403, '조회 권한이 없습니다.'); return kind === 'disputes' ? rows<Dispute & {
            title: string;
        }>('SELECT d.*,o.title FROM disputes d JOIN orders o ON o.id=d.order_id ORDER BY d.created_at DESC LIMIT 200') : rows<Settlement & {
            title: string;
        }>('SELECT s.*,o.title FROM settlements s JOIN orders o ON o.id=s.order_id' + (u.role === 'ADMIN' ? '' : ' WHERE s.partner_id=?') + ' ORDER BY s.updated_at DESC LIMIT 200', ...u.role === 'ADMIN' ? [] : [u.id]); },
        async uploadPermission(u: User, id: string) { const { o } = await context(u, id); if (!o.selected_bid_id || ['CANCELLED', 'EXPIRED', 'SETTLED'].includes(o.status))
            fail(409, '진행 중인 거래에만 증빙 사진을 추가할 수 있습니다.'); return o; }
    };
}
