export interface Contract {
    id: string;
    order_id: string;
    version: number;
    partner_id: string;
    snapshot: string;
    total: number;
    deposit: number;
    commission_bps: number;
    terms: string;
    date: string;
    start_hour: number;
    end_hour: number;
    status: string;
    created_at: string;
    accepted_at: string | null;
}
export interface Extra {
    id: string;
    order_id: string;
    partner_id: string;
    description: string;
    supply: number;
    vat: number;
    total: number;
    photo_ids: string;
    status: string;
    created_at: string;
    decided_at: string | null;
    decided_by: string | null;
    decision_snapshot: string | null;
}
export interface ScheduleChange {
    id: string;
    order_id: string;
    date: string;
    start_hour: number;
    end_hour: number;
    reason: string;
    status: string;
    created_at: string;
}
export interface Completion {
    id: string;
    order_id: string;
    summary: string;
    before_photos: string;
    after_photos: string;
    status: string;
    response: string | null;
    created_at: string;
}
export interface Payment {
    id: string;
    order_id: string;
    target_id: string;
    kind: string;
    mode: string;
    amount: number;
    status: string;
    provider_key: string | null;
    refunded: number;
    receipt_url: string | null;
    created_at: string;
    updated_at: string;
}
export interface Refund {
    id: string;
    payment_id: string;
    amount: number;
    prior_refunded: number;
    reason: string;
    status: string;
    actor_id: string;
    created_at: string;
}
export interface Dispute {
    id: string;
    order_id: string;
    opened_by: string;
    reason: string;
    photo_ids: string;
    previous_status: string;
    status: string;
    resolution: string | null;
    resolved_by: string | null;
    created_at: string;
    resolved_at: string | null;
}
export interface Settlement {
    order_id: string;
    partner_id: string;
    gross: number;
    refunded: number;
    fee: number;
    payable: number;
    status: string;
    reason: string;
    approved_by: string | null;
    approved_at: string | null;
    transfer_reference: string | null;
    paid_at: string | null;
    updated_at: string;
}
export interface Message {
    seq: number;
    id: string;
    order_id: string;
    partner_id: string;
    sender_id: string;
    sender_name: string;
    kind: string;
    body: string;
    photo_ids: string;
    created_at: string;
}
export interface Notification {
    id: string;
    user_id: string;
    order_id: string;
    message: string;
    created_at: string;
    read_at: string | null;
}
export interface TradeData {
    contracts: Contract[];
    extras: Extra[];
    schedules: ScheduleChange[];
    completions: Completion[];
    payments: Payment[];
    refunds: Refund[];
    disputes: Dispute[];
    settlement: Settlement | null;
    commissionBps: number | null;
    slot: {
        date: string;
        start_hour: number;
        end_hour: number;
    } | null;
    photos: {
        id: string;
        mime: string;
    }[];
    provider: {
        ready: boolean;
        mode: 'test' | 'live' | 'unconfigured';
    };
}
