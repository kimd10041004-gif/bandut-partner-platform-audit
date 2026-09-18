'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { MessageSquare, Send, RefreshCw, FileCheck2, CalendarDays, CreditCard, ClipboardCheck, ShieldAlert, Wallet, Paperclip, Bell } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { toast } from 'sonner';
import {nextAction} from '@/lib/marketplace/workflow';
import { api, upload, won } from '@/lib/client';
import { SUPPORT_THREAD, supportOption, type ChatOption } from '@/lib/chat-model';
import type { Order, Bid } from '@/lib/model';
import type { TradeData, Message, Notification, Settlement, Dispute } from '@/lib/trade-model';
import { Access, Blank, PageHeading, useAccount } from './shell';
const labels: Record<string, string> = { PROPOSED: '확인 요청', ACCEPTED: '계약 확정', SUPERSEDED: '이전 제안', DECLINED: '수정 요청', APPROVED: '승인', REJECTED: '거절', REQUESTED: '완료 확인 요청', CONFIRMED: '완료 확인', REWORK: '보완 요청', READY: '결제 대기', PROCESSING: '결제 확인 필요', DONE: '결제 완료', PARTIAL_CANCELED: '부분 환불', CANCELED: '전액 취소', ABORTED: '결제 실패', EXPIRED: '결제 만료', OPEN: '검토 중', RESOLVED: '처리 완료', HELD: '정산 보류', PAID: '지급 기록 완료', DEPOSIT: '예약금', BALANCE: '잔금', EXTRA: '추가 작업', PENDING: '확인 중', NO_PAYOUT: '지급액 없음 · 정산 종료' };
const time = (v: string) => new Date(v).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const TradeStatus = ({ value }: {
    value: string;
}) => <span className={'status ' + (['ACCEPTED', 'APPROVED', 'DONE', 'CONFIRMED', 'PAID'].includes(value) ? 'green' : ['HELD', 'OPEN', 'PROCESSING', 'PROPOSED'].includes(value) ? 'amber' : '')}>{labels[value] ?? value}</span>;
type Field = {
    name: string;
    label: string;
    type?: 'number' | 'date' | 'datetime-local' | 'text' | 'textarea' | 'check' | 'photos';
    value?: string | number;
    min?: number;
    max?: number;
    step?: number;
    optional?: boolean;
    photos?: {
        id: string;
        mime: string;
    }[];
};
type Action = {
    title: string;
    description: string;
    endpoint: string;
    fields?: Field[];
    base?: Record<string, unknown>;
    map?: (d: Record<string, unknown>) => Record<string, unknown>;
};
function ActionModal({ action, close, submit, busy }: {
    action: Action | null;
    close: () => void;
    submit: (action: Action, data: Record<string, unknown>) => Promise<boolean>;
    busy: boolean;
}) { const [selected, setSelected] = useState<Record<string, string[]>>({}); return <Dialog open={!!action} onOpenChange={v => { if (!v && !busy)
    close(); }}><DialogContent className="trade-dialog"><DialogHeader><DialogTitle>{action?.title}</DialogTitle><DialogDescription>{action?.description}</DialogDescription></DialogHeader>{action && <form key={action.title} className="field-stack" onSubmit={async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const values: Record<string, unknown> = { ...action.base }; for (const f of action.fields ?? [])
    values[f.name] = f.type === 'photos' ? selected[f.name] ?? [] : f.type === 'check' ? fd.get(f.name) === 'on' : f.type === 'number' ? Number(fd.get(f.name)) : String(fd.get(f.name) ?? ''); if (await submit(action, action.map ? action.map(values) : values))
    close(); }}>{action.fields?.map(f => f.type === 'check' ? <label key={f.name} className="check-line"><Checkbox name={f.name} required={!f.optional}/>{f.label}</label> : f.type === 'photos' ? <fieldset key={f.name}><legend>{f.label}</legend><div className="evidence-picker">{f.photos?.map(p => <label key={p.id}><Checkbox checked={(selected[f.name] ?? []).includes(p.id)} onCheckedChange={v => setSelected(prev => ({ ...prev, [f.name]: v ? [...(prev[f.name] ?? []), p.id] : (prev[f.name] ?? []).filter(id => id !== p.id) }))}/><Image unoptimized src={'/api/photos/' + p.id} width={100} height={80} alt="선택할 증빙 사진"/></label>)}</div>{!f.photos?.length && <p className="muted small">거래 화면에서 증빙 사진을 먼저 올려 주세요.</p>}</fieldset> : <label className="field" key={f.name}>{f.label}{f.type === 'textarea' ? <textarea name={f.name} required={!f.optional} minLength={5} maxLength={2000} defaultValue={f.value}/> : <input name={f.name} type={f.type ?? 'text'} required={!f.optional} min={f.min} max={f.max} step={f.type === 'number' ? (f.step ?? 1) : undefined} defaultValue={f.value}/>}</label>)}<div className="action-row"><button type="button" className="btn secondary" disabled={busy} onClick={close}>돌아가기</button><button className="btn primary" type="submit" disabled={busy}>{busy ? '처리 중…' : action.title}</button></div></form>}</DialogContent></Dialog>; }
const reasonField: Field = { name: 'reason', label: '사유와 확인한 내용', type: 'textarea' };
export function TradePanel({ order: o, bid, onChange }: {
    order: Order;
    bid: Bid;
    onChange: () => Promise<unknown>;
}) {
    const { user } = useAccount();
    const [d, setD] = useState<TradeData | null>(null);
    const [tab,setTab]=useState('contract');
    const [error, setError] = useState('');
    const [action, setAction] = useState<Action | null>(null);
    const [busy, setBusy] = useState(false);
    const owner = user?.id === o.customer_id, partner = user?.id === bid.partner_id, admin = user?.role === 'ADMIN';
    const load = useCallback(() => api<TradeData>('orders/' + o.id + '/trade').then(v => { setD(v); setError(''); }).catch(e => setError(e.message)), [o.id]);
    useEffect(() => { void load(); }, [load, o.revision]);
    async function submit(a: Action, data: Record<string, unknown>) { setBusy(true); try {
        await api('orders/' + o.id + '/trade/' + a.endpoint, data);
        toast.success('거래 기록에 저장했습니다.');
        await load();
        await onChange();
        return true;
    }
    catch (e) {
        toast.error((e as Error).message);
        return false;
    }
    finally {
        setBusy(false);
    } }
    if (!d)
        return <article className="panel">{error ? <p role="alert">{error}<button className="btn secondary" onClick={load}>다시 확인</button></p> : <p>계약과 거래 내역을 불러오고 있습니다…</p>}</article>;
    const c = d.contracts.find(c => c.status === 'ACCEPTED'), latest = d.contracts[0];
    const active = !['CANCELLED', 'EXPIRED', 'SETTLED', 'DISPUTED'].includes(o.status);
    const scheduleFields: Field[] = [{ name: 'date', label: '방문 날짜', type: 'date', value: d.slot?.date ?? bid.available_date }, { name: 'startHour', label: '시작 시각', type: 'number', min: 8, max: 20, value: d.slot?.start_hour ?? bid.start_hour }, { name: 'endHour', label: '종료 시각', type: 'number', min: 9, max: 21, value: d.slot?.end_hour ?? bid.end_hour }];
    const photoField = (name: string, label: string): Field => ({ name, label, type: 'photos', photos: d.photos });
    const button = (label: string, a: Action, secondary = true) => <button className={'btn ' + (secondary ? 'secondary' : 'primary')} disabled={busy} onClick={() => setAction({ ...a, base: { ...a.base, ...(a.endpoint === 'refund' ? { requestId: crypto.randomUUID() } : {}) } })}>{label}</button>;
    const decision = (endpoint: string, id: string, accept: boolean, title: string) => ({ title, description: accept ? '표시된 내용과 금액·일정을 확인한 후 승인해 주세요. 승인 기록이 보존됩니다.' : '이 요청을 거절한 기록이 남습니다.', endpoint, base: { id, accept } });
    async function checkout(kind: string, extraId?: string) { setBusy(true); try {
        const p = await api<{
            id: string;
            clientKey: string;
            amount: number;
            orderName: string;
            customerKey: string;
        }>('orders/' + o.id + '/trade/payment', { kind, ...(extraId ? { extraId } : {}) });
        await openCheckout(p, o.id);
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy(false);
        await load();
    } }
    const next=nextAction(o.status,owner?'CUSTOMER':admin?'ADMIN':'PARTNER',d);
    return <article id="trade-management" className="panel trade-panel"><div className="between"><h2><FileCheck2 size={22}/>계약부터 작업 완료까지</h2><button className="icon-button" aria-label="거래 내역 새로고침" onClick={() => { void load(); void onChange(); }}><RefreshCw size={18}/></button></div>{error && <p role="alert" className="error">{error}</p>}
 <div className="next-action" role="status"><div><span className="eyebrow">다음 할 일</span><h3>{next.title}</h3><p>{next.detail}</p></div><button className="btn primary" onClick={()=>setTab(next.tab)}>내역 확인</button></div><Link className="inline-link no-print" href={'/receipts/'+o.id}>계약·결제 내역 인쇄 <FileCheck2 size={16}/></Link><div className="trade-summary"><div><span>확정 계약금액</span><strong>{c ? won(c.total) : '계약 확인 전'}</strong></div><div><span>승인된 추가 작업</span><strong>{won(d.extras.filter(e => e.status === 'APPROVED').reduce((n, e) => n + e.total, 0))}</strong></div><div><span>{c?'확정 방문 일정':'제안된 방문 일정'}</span><strong>{d.slot ? d.slot.date : '일정 종료'}</strong><small>{d.slot ? `${d.slot.start_hour}:00–${d.slot.end_hour}:00` : ''}</small></div></div>
 <Tabs value={tab} onValueChange={setTab}><TabsList variant="line" className="trade-tabs"><TabsTrigger value="contract"><FileCheck2 size={16}/>계약·일정</TabsTrigger><TabsTrigger value="work"><ClipboardCheck size={16}/>작업</TabsTrigger><TabsTrigger value="payment"><CreditCard size={16}/>결제</TabsTrigger><TabsTrigger value="dispute"><ShieldAlert size={16}/>분쟁</TabsTrigger><TabsTrigger value="settlement"><Wallet size={16}/>정산</TabsTrigger></TabsList>
 <TabsContent value="contract"><div className="trade-section">{!latest && <p className="muted">선택한 견적의 작업 범위와 금액을 계약서로 확정합니다. 고객 동의 전에는 작업을 시작할 수 없습니다.</p>}{admin && !latest && button('수수료 조건 확정', { title: '수수료 조건 확정', description: '파트너와 합의한 조건을 기록하세요. VAT 포함 실수납액에서 환불을 차감한 금액에 적용하며 원 미만은 버립니다. 계약 발행 후 변경할 수 없습니다.', endpoint: 'terms', fields: [{ name: 'commissionPercent', label: '합의한 수수료율 (%)', type: 'number', min: 0, max: 100, step: .01, value: d.commissionBps === null ? '' : d.commissionBps / 100 }, reasonField], map: v => ({ commissionBps: Math.round(Number(v.commissionPercent) * 100), reason: v.reason }) })}{d.commissionBps !== null && (admin || partner) && <p className="small muted">확정 수수료율 {d.commissionBps / 100}% · VAT 포함 실수납액 기준</p>}{partner && !c && active && button(latest ? '계약서 다시 발행' : '계약서 발행', { title: '계약서 발행', description: '선택한 견적의 총액과 포함·제외 항목은 그대로 보존됩니다. 예약금과 계약 조건, 방문 일정을 기재하세요. 이전 제안은 이력으로 남습니다.', endpoint: 'contract', fields: [{ name: 'deposit', label: '예약금 (VAT 포함 원, 없으면 0)', type: 'number', min: 0, max: bid.total, value: latest?.deposit ?? '' }, { name: 'terms', label: '계약 당사자·결제 수령자·증빙 발급자·취소·환불·A/S 조건', type: 'textarea', value: latest?.terms ?? '' }, ...scheduleFields] }, false)}
 {d.contracts.map(contract => <div className="trade-card" key={contract.id}><div className="between"><h3>견적 계약서 · {contract.version}차</h3><TradeStatus value={contract.status}/></div><dl className="amount-list"><div><dt>계약 총액 · VAT 포함</dt><dd>{won(contract.total)}</dd></div><div><dt>예약금</dt><dd>{won(contract.deposit)}</dd></div><div><dt>완료 확인 후 잔금</dt><dd>{won(contract.total - contract.deposit)}</dd></div><div><dt>방문일</dt><dd>{contract.date} {contract.start_hour}:00–{contract.end_hour}:00</dd></div></dl><p className="small">포함: {(JSON.parse(contract.snapshot) as Bid).included}</p><p className="small">제외: {(JSON.parse(contract.snapshot) as Bid).excluded}</p><p className="description-text">{contract.terms}</p><p className="small muted">발행 {time(contract.created_at)}{contract.accepted_at ? ' · 고객 동의 ' + time(contract.accepted_at) : ''}</p>{owner && contract.status === 'PROPOSED' && active && <div className="action-row">{button('수정 요청', { title: '계약 수정 요청', description: '현재 계약 제안을 거절합니다. 구체적인 수정 사항은 채팅으로 전달해 주세요.', endpoint: 'contract-decision', base: { contractId: contract.id, accept: false, consent: true } })}{button('계약에 동의', { title: '계약에 동의', description: `총액 ${won(contract.total)}, 예약금 ${won(contract.deposit)}입니다. 계약 당사자와 작업 범위, 일정, 취소·환불 조건을 확인해 주세요.`, endpoint: 'contract-decision', base: { contractId: contract.id, accept: true }, fields: [{ name: 'consent', label: '계약서의 금액과 조건, 일정에 동의합니다.', type: 'check' }] }, false)}</div>}</div>)}
 {c && partner && active && ['BID_SELECTED', 'SCHEDULED'].includes(o.status) && button('방문 일정 변경 요청', { title: '일정 변경 요청', description: '고객 승인 전까지 기존 방문 일정이 유지됩니다. 다른 예약과 겹치는 일정은 확정할 수 없습니다.', endpoint: 'schedule', fields: [...scheduleFields, reasonField] })}{d.schedules.map(s => <div className="trade-card" key={s.id}><div className="between"><strong><CalendarDays size={16}/> {s.date} · {s.start_hour}:00–{s.end_hour}:00</strong><TradeStatus value={s.status}/></div><p>{s.reason}</p>{owner && s.status === 'PROPOSED' && active && <div className="action-row">{button('거절', decision('schedule-decision', s.id, false, '일정 변경 거절'))}{button('새 일정 승인', decision('schedule-decision', s.id, true, '새 일정 승인'), false)}</div>}</div>)}{(owner || admin) && ['BID_SELECTED', 'SCHEDULED'].includes(o.status) && button('거래 취소 요청', { title: '거래 취소', description: '결제 내역이 있으면 분쟁 탭에서 취소·환불 검토를 요청해야 합니다. 결제가 없는 거래는 즉시 취소하고 일정을 해제합니다.', endpoint: 'cancel', fields: [reasonField] })}</div></TabsContent>
 <TabsContent value="work"><div className="trade-section"><div className="action-row">{partner && o.status === 'SCHEDULED' && button('작업 시작', { title: '작업 시작', description: '확정된 방문 시각부터 시작할 수 있습니다. 현장에 도착하여 계약 내용과 작업 범위를 확인해 주세요.', endpoint: 'start', fields: [{ name: 'confirmed', label: '현장에서 작업 시작을 확인했습니다.', type: 'check' }] }, false)}{partner && ['SCHEDULED', 'IN_PROGRESS'].includes(o.status) && button('추가 작업 요청', { title: '추가 작업 요청', description: '고객이 승인하기 전에는 추가 작업을 진행하지 않습니다. 금액은 공급가로 입력하며 VAT 10%를 더해 고객에게 표시합니다.', endpoint: 'extra', fields: [{ name: 'description', label: '추가 작업 내용과 필요한 이유', type: 'textarea' }, { name: 'supply', label: '추가 작업 공급가 (원)', type: 'number', min: 1, max: 100000000 }, photoField('photoIds', '증빙 사진 (최대 6장)')] })}{partner && o.status === 'IN_PROGRESS' && button('작업 완료 요청', { title: '작업 완료 요청', description: '작업 전과 후의 서로 다른 사진을 첨부해 고객 확인을 요청하세요.', endpoint: 'complete', fields: [{ name: 'summary', label: '작업 결과와 확인 사항', type: 'textarea' }, photoField('beforePhotos', '작업 전 사진'), photoField('afterPhotos', '작업 후 사진')] }, false)}</div>
 {active && <EvidenceUpload orderId={o.id} onUploaded={load}/>}<PhotoLinks ids={d.photos.map(p => p.id)}/>
 {d.extras.length === 0 && <p className="muted">추가 작업 요청이 없습니다. 동의 없는 추가 비용은 반영되지 않습니다.</p>}{d.extras.map(e => <div className="trade-card" key={e.id}><div className="between"><h3>추가 작업 · {won(e.total)}</h3><TradeStatus value={e.status}/></div><p className="description-text">{e.description}</p><p className="small muted">공급가 {won(e.supply)} + VAT {won(e.vat)}</p><PhotoLinks ids={JSON.parse(e.photo_ids)}/>{e.decided_by && e.decided_at && <p className="small muted">주문 고객 계정 확인 · {time(e.decided_at)} · {e.status==='APPROVED'?'승인':'거절'} 기록 보관</p>}{owner && e.status === 'PROPOSED' && active && <div className="action-row">{button('거절', {...decision('extra-decision', e.id, false, '추가 작업 거절'), base:{id:e.id,accept:false,expectedTotal:e.total,consent:false}})}{button('내용·금액 승인', {...decision('extra-decision', e.id, true, '추가 작업 ' + won(e.total) + ' 승인'), description:e.description+' · VAT 포함 '+won(e.total),base:{id:e.id,accept:true,expectedTotal:e.total},fields:[{name:'consent',type:'check',label:'위 작업 내용과 총액에 고객 본인으로 동의합니다.'}]}, false)}</div>}</div>)}
 {d.completions.map(v => <div className="trade-card" key={v.id}><div className="between"><h3>작업 완료 확인</h3><TradeStatus value={v.status}/></div><p className="description-text">{v.summary}</p><div className="two-cols"><div><h4>작업 전</h4><PhotoLinks ids={JSON.parse(v.before_photos)}/></div><div><h4>작업 후</h4><PhotoLinks ids={JSON.parse(v.after_photos)}/></div></div>{v.response && <p>고객 확인: {v.response}</p>}{owner && v.status === 'REQUESTED' && o.status === 'COMPLETION_REQUESTED' && <div className="action-row">{button('보완 요청', { ...decision('completion-decision', v.id, false, '작업 보완 요청'), fields: [reasonField] })}{button('작업 완료 확인', { ...decision('completion-decision', v.id, true, '작업 완료 확인'), fields: [reasonField] }, false)}</div>}</div>)}</div></TabsContent>
 <TabsContent value="payment"><div className="trade-section"><div className="inline-notice">{d.provider.ready ? (d.provider.mode === 'test' ? '테스트 결제 환경입니다. 실제 금액이 청구되지 않습니다.' : '결제 금액과 계약 조건을 확인한 뒤 결제해 주세요.') : '결제사 연결 준비 중입니다. 현재 카드 결제를 진행할 수 없습니다.'}</div>{c && owner && active && <div className="action-row">{c.deposit > 0 && ['BID_SELECTED', 'SCHEDULED'].includes(o.status) && !d.payments.some(p => p.kind === 'DEPOSIT' && ['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(p.status)) && <button className="btn primary" disabled={!d.provider.ready || busy} onClick={() => void checkout('DEPOSIT')}>예약금 {won(c.deposit)} 결제</button>}{o.status === 'COMPLETED' && c.total > c.deposit && !d.payments.some(p => p.kind === 'BALANCE' && ['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(p.status)) && <button className="btn primary" disabled={!d.provider.ready || busy} onClick={() => void checkout('BALANCE')}>잔금 {won(c.total - c.deposit)} 결제</button>}{d.extras.filter(e => e.status === 'APPROVED' && !d.payments.some(p => p.target_id === e.id && ['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(p.status))).map(e => <button className="btn secondary" disabled={!d.provider.ready || busy} key={e.id} onClick={() => void checkout('EXTRA', e.id)}>추가 작업 {won(e.total)} 결제</button>)}</div>}
 {d.payments.length === 0 ? <p className="muted">결제 내역이 없습니다.</p> : d.payments.map(p => <div className="trade-card" key={p.id}><div className="between"><h3>{labels[p.kind]} {won(p.amount)}</h3><TradeStatus value={p.status}/></div><p className="small muted">{p.mode==='test'?'테스트 · ':p.mode==='unknown'?'환경 미확인 · ':''}{time(p.created_at)} · 환불 {won(p.refunded)}</p><div className="action-row">{p.receipt_url && <a className="btn secondary" href={p.receipt_url} target="_blank" rel="noreferrer">결제 전표</a>}{(owner || admin) && <button className="btn secondary" disabled={!d.provider.ready || busy} onClick={() => void submit({ title: '결제 상태 확인', description: '', endpoint: 'payment-sync' }, { paymentId: p.id })}>결제 상태 확인</button>}{admin && o.status === 'DISPUTED' && ['DONE', 'PARTIAL_CANCELED'].includes(p.status) && button('환불 처리', { title: '환불 처리', description: '입력한 금액만큼 결제사에 실제 취소를 요청합니다. 분쟁 조정 근거와 환불 금액을 확인하세요. 응답이 끊기면 같은 요청을 재확인합니다.', endpoint: 'refund', base: { paymentId: p.id }, fields: [{ name: 'amount', label: '환불 금액 (원)', type: 'number', min: 1, max: p.amount - p.refunded, value: p.amount - p.refunded }, reasonField] })}</div></div>)}{d.refunds.map(r => <div className="trade-card" key={r.id}><p className="small">환불 요청 {won(r.amount)} · {r.reason} <TradeStatus value={r.status}/></p>{admin && r.status === 'PENDING' && <button className="btn secondary" disabled={busy} onClick={() => void submit({ title: '기존 환불 재확인', description: '', endpoint: 'refund' }, { requestId: r.id, paymentId: r.payment_id, amount: r.amount, reason: r.reason })}>기존 환불 요청 재확인</button>}</div>)}<p className="small muted">결제 오류나 화면 종료만으로 결제 실패를 확정하지 않습니다. 재시도 전에 결제 상태를 확인해 주세요.</p></div></TabsContent>
 <TabsContent value="dispute"><div className="trade-section"><p>작업 내용, 비용, 취소·환불에 이견이 있으면 사유와 증빙을 남겨 주세요. 접수 후 진행 중인 거래와 미지급 정산이 보류됩니다.</p>{!['DISPUTED', 'CANCELLED', 'EXPIRED'].includes(o.status) && button('분쟁·취소 검토 요청', { title: '분쟁·취소 검토 요청', description: o.status === 'SETTLED' ? '이미 지급 기록이 있는 거래입니다. 접수해도 송금이 자동 취소되지는 않습니다.' : '접수하면 거래 진행과 미지급 정산을 보류하고 관리자가 내용을 검토합니다.', endpoint: 'dispute', fields: [reasonField, photoField('photoIds', '증빙 사진')] }, false)}{d.disputes.map(v => <div className="trade-card" key={v.id}><div className="between"><h3>분쟁 접수 · {time(v.created_at)}</h3><TradeStatus value={v.status}/></div><p className="description-text">{v.reason}</p><PhotoLinks ids={JSON.parse(v.photo_ids)}/>{v.resolution && <p className="inline-notice">처리 결과: {v.resolution}</p>}{admin && v.status === 'OPEN' && <div className="action-row">{button('조정 후 거래 재개', { title: '분쟁 해결·거래 재개', description: '당사자 협의와 판단 근거를 기록합니다. 보류된 정산은 별도 재승인이 필요합니다.', endpoint: 'resolve', base: { id: v.id, decision: 'RESUME' }, fields: [reasonField] })}{button('환불 확인 후 거래 취소', { title: '분쟁 해결·거래 취소', description: '모든 결제 상태가 확정되고 전액 환불된 경우에만 취소할 수 있습니다.', endpoint: 'resolve', base: { id: v.id, decision: 'CANCEL' }, fields: [reasonField] })}</div>}</div>)}<p className="small muted">답변과 추가 설명은 이 주문의 채팅에 남겨 주세요. 관리자는 계약·대화·증빙·결제 기록을 함께 확인합니다.</p></div></TabsContent>
 <TabsContent value="settlement"><div className="trade-section">{d.settlement ? <><div className="between"><h3>지급 예정액 {won(d.settlement.payable)}</h3><TradeStatus value={d.settlement.status}/></div><dl className="amount-list"><div><dt>결제 총액</dt><dd>{won(d.settlement.gross)}</dd></div><div><dt>환불</dt><dd>−{won(d.settlement.refunded)}</dd></div><div><dt>계약 수수료</dt><dd>−{won(d.settlement.fee)}</dd></div></dl><p>{d.settlement.reason}</p>{d.settlement.paid_at && <p className="small">관리자가 기록한 이체: {time(d.settlement.paid_at)} · {d.settlement.transfer_reference}</p>}</> : <p className="muted">아직 정산 승인 내역이 없습니다. 고객의 완료 확인과 결제 내역을 검토한 뒤 관리자가 승인합니다.</p>}{admin && c && !['PAID', 'NO_PAYOUT'].includes(d.settlement?.status ?? '') && <div className="action-row">{button('정산 승인', { title: '정산 승인', description: '확정 계약과 고객 승인 추가 작업의 결제액을 비교합니다. 이 계약에서 합의한 수수료율을 적용하고 확인된 환불액을 차감합니다.', endpoint: 'settlement', base: { action: 'APPROVE' }, fields: [reasonField] })}{button('정산 보류', { title: '정산 보류', description: '보류 사유를 남겨 파트너가 확인할 수 있게 합니다.', endpoint: 'settlement', base: { action: 'HOLD' }, fields: [reasonField] })}{d.settlement?.status === 'APPROVED' && d.payments.length>0 && d.payments.every(p=>p.mode==='live') && button('실제 이체 기록', { title: '실제 이체 기록 확정', description: '이 버튼은 은행 송금을 실행하지 않습니다. 별도로 완료한 이체의 증빙과 거래번호를 확인한 뒤 기록하세요.', endpoint: 'settlement', base: { action: 'RECORD_TRANSFER' }, fields: [{ name: 'transferReference', label: '실제 은행 이체 거래번호' }, { name: 'paidAt', label: '실제 이체 일시 (기기 현지 시간)', type: 'datetime-local' }, reasonField, { name: 'verified', label: '이체 금액·수취인·계좌와 증빙을 직접 확인했습니다.', type: 'check' }], map: v => ({ ...v, paidAt: new Date(String(v.paidAt)).toISOString() }) }, false)}</div>}<div className="inline-notice">은행 자동 송금은 연결되지 않았습니다. 지급 완료 표시는 관리자가 확인해 기록한 이체 내역입니다.</div></div></TabsContent>
 </Tabs>{action && <ActionModal action={action} close={() => setAction(null)} submit={submit} busy={busy}/>}</article>;
}
function PhotoLinks({ ids }: {
    ids: string[];
}) { return ids.length > 0 ? <div className="trade-photos">{ids.map(id => <a key={id} href={'/api/photos/' + id} target="_blank" rel="noreferrer"><Image unoptimized width={160} height={120} src={'/api/photos/' + id} alt="거래 증빙 사진"/></a>)}</div> : null; }
function EvidenceUpload({ orderId, onUploaded }: {
    orderId: string;
    onUploaded: () => Promise<unknown>;
}) { const [busy, setBusy] = useState(false); return <label className="btn secondary upload-evidence"><Paperclip size={17}/>{busy ? '사진 저장 중…' : '증빙 사진 추가'}<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={async (e) => { const input = e.currentTarget; const f = input.files?.[0]; if (!f)
    return; setBusy(true); try {
    if (f.size > 5 * 1024 * 1024)
        throw Error('사진은 5MB 이하로 올려 주세요.');
    await upload('orders/' + orderId + '/photos?purpose=evidence', f);
    toast.success('증빙 사진을 저장했습니다.');
    await onUploaded();
}
catch (e) {
    toast.error((e as Error).message);
}
finally {
    setBusy(false);
    input.value = '';
} }}/></label>; }
export function ChatPanel({ order: o, bids, initialPartnerId = '', initialBefore, tradeHref = '#trade-management' }: {
    initialPartnerId?: string;
    initialBefore?: number;
    tradeHref?: string;
    order: Order;
    bids: ChatOption[];
}) {
    const { user } = useAccount();
    const [partnerId, setPartnerId] = useState(initialPartnerId);
    const [before,setBefore]=useState(initialBefore);
    const messageList=useRef<HTMLDivElement>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [readOnly, setReadOnly] = useState(false);
    const [text, setText] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [older, setOlder] = useState<Message[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const messageId = useRef<string | null>(null);
    const [attachments, setAttachments] = useState<string[]>([]);
    const [availablePhotos, setAvailablePhotos] = useState<{
        id: string;
        mime: string;
    }[]>([]);
    const [picking, setPicking] = useState(false);
    const canSupport=user?.role==='ADMIN'||user?.id===o.customer_id;
    const options:ChatOption[] = user?.role === 'PARTNER' ? bids.filter(b => b.partner_id === user.id) : [...bids,...(canSupport&&!bids.some(b=>b.partner_id===SUPPORT_THREAD)?[supportOption]:[])];
    const [connection,setConnection]=useState('connecting');
    const current = partnerId || options.find(b => b.status === 'SELECTED')?.partner_id || options[0]?.partner_id || '';
    const generation = useRef(0);
    const load = useCallback(() => { if (!current)
        return Promise.resolve(); const n = ++generation.current; return api<{
        messages: Message[];
        readOnly: boolean;
    }>('orders/' + o.id + '/chat?partnerId=' + encodeURIComponent(current)+(before?'&before='+before:'')).then(d => { if (n !== generation.current)
        return; setMessages(d.messages); setReadOnly(d.readOnly); setError(''); setHasMore(d.messages.length === 50); }).catch(e => { if (n === generation.current)
        setError(e.message); }); }, [current, o.id, before]);
    const cancelPending = useCallback(() => { generation.current++; }, []);
    useEffect(() => {
        if(!current)return;
        let source:EventSource|null=null,closed=false,connected=false,denied=false;
        const open=()=>{
            source?.close(); source=null; connected=false;
            if(document.visibilityState!=='visible'){setConnection('paused');return;}
            if(before){void load();return;}
            setConnection('connecting');
            if(typeof EventSource==='undefined'){void load();setConnection('reconnecting');return;}
            source=new EventSource('/api/orders/'+o.id+'/chat-stream?partnerId='+encodeURIComponent(current));
            source.addEventListener('snapshot',event=>{
                if(closed)return;
                try{
                    const d=JSON.parse((event as MessageEvent).data) as {messages:Message[];readOnly:boolean};
                    connected=true;setConnection('live');setMessages(d.messages);setReadOnly(d.readOnly);setError('');setHasMore(d.messages.length===50);
                    window.dispatchEvent(new CustomEvent('order-updated',{detail:o.id}));
                }catch{connected=false;setConnection('reconnecting');}
            });
            source.addEventListener('denied',()=>{cancelPending();denied=true;connected=false;source?.close();setMessages([]);setOlder([]);setReadOnly(true);setConnection('denied');setError('대화 권한이 변경되었습니다. 다시 로그인해 주세요.');});
            source.addEventListener('unavailable',()=>{connected=false;setConnection('reconnecting');});
            // 29-29: 스트림이 안 열리면(서버 재시작·네트워크) 10초를 기다리지 않고 바로 한 번 읽는다. 첫 화면이 비어 보이던 자리다. 29-30 부터 스트림은 실제로 열린다.
            let bootstrapped=false;
            source.onerror=()=>{if(!closed&&!denied){connected=false;setConnection('reconnecting');if(!bootstrapped&&!before){bootstrapped=true;void load();}}};
        };
        open();
        const fallback=setInterval(()=>{if(!before&&!connected&&!denied&&document.visibilityState==='visible')void load();},10000);
        document.addEventListener('visibilitychange',open);
        return()=>{closed=true;source?.close();cancelPending();clearInterval(fallback);document.removeEventListener('visibilitychange',open);};
    },[current,o.id,before,load,cancelPending]);
    const latestSeq=messages.at(-1)?.seq;
    useEffect(()=>{const list=messageList.current;if(list)list.scrollTop=list.scrollHeight;},[current,latestSeq]);
    const readSeq = useRef<Record<string,number>>({});
    useEffect(() => {
        const seq=messages.at(-1)?.seq;
        const key=o.id+':'+current;
        if(before||!seq||document.visibilityState!=='visible'||(readSeq.current[key]??0)>=seq)return;
        let cancelled=false;
        api('inbox/read',{orderId:o.id,partnerId:current,seq}).then(()=>{if(!cancelled){readSeq.current[key]=seq;window.dispatchEvent(new Event('inbox-read'));}}).catch(()=>{});
        return ()=>{cancelled=true;};
    },[messages,current,o.id,before]);
    if (!options.length)
        return null;
    const all = Array.from(new Map([...older, ...messages].filter(m => m.partner_id === current).map(m => [m.id, m])).values()).sort((a, b) => a.seq - b.seq);
    return <article className="panel chat-panel"><div className="between"><h2><MessageSquare size={21}/>주문 상담</h2><button className="icon-button" aria-label="대화 새로고침" onClick={load}><RefreshCw size={17}/></button></div><Select disabled={busy} value={current} onValueChange={v => { setPartnerId(v); setBefore(undefined); setText(''); setOlder([]); setMessages([]); setAttachments([]); messageId.current = null; }}><SelectTrigger className="chat-select"><SelectValue placeholder="상담할 파트너"/></SelectTrigger><SelectContent>{options.map(b => <SelectItem key={b.partner_id} value={b.partner_id}>{b.company ?? '파트너'}{b.status === 'SELECTED' ? ' · 선택한 파트너' : ''}</SelectItem>)}</SelectContent></Select><p className="small muted">{current===SUPPORT_THREAD?'접수·견적·분쟁을 운영팀에 문의하세요. 이 대화는 고객과 운영팀만 볼 수 있습니다.':'각 파트너와의 상담은 분리됩니다. 금액·일정 변경은 거래 관리에서 정식 승인을 받아야 합니다.'}</p><p className="small muted" role="status">{before?'이전 대화':connection==='live'?'자동 연결 중 · 새 메시지는 약 2초 간격으로 확인합니다.':connection==='paused'?'화면으로 돌아오면 다시 연결합니다.':connection==='denied'?'대화 접근 제한':connection==='reconnecting'?'다시 연결 중 · 10초마다 대화를 재확인합니다.':'대화 연결 중…'}</p>{error && <p className="error" role="alert">{error}</p>}
 <div ref={messageList} className="message-list" role="log" aria-label="주문 상담 기록">{hasMore && all.length > 0 && <button className="btn secondary" onClick={async () => { try {
        const d = await api<{
            messages: Message[];
        }>('orders/' + o.id + '/chat?partnerId=' + encodeURIComponent(current) + '&before=' + all[0].seq);
        setOlder(prev => [...d.messages, ...prev]);
        setHasMore(d.messages.length === 50);
    }
    catch (e) {
        setError((e as Error).message);
    } }}>이전 대화 보기</button>}{all.length === 0 && !error ? <p className="muted chat-empty">작업 범위나 준비할 사항을 물어보세요.</p> : all.map(m => <div className={'chat-message ' + (m.kind === 'EVENT' ? 'event' : m.sender_id === user?.id ? 'mine' : '')} key={m.id}><small>{m.sender_name} · {time(m.created_at)}</small><p>{m.body}</p>{m.kind === 'EVENT' && <a href={tradeHref} className="inline-link">거래 내역 확인</a>}<PhotoLinks ids={JSON.parse(m.photo_ids)}/></div>)}</div>
 {before ? <div className="inline-notice">검색한 메시지 시점의 대화입니다. <button className="btn secondary" onClick={()=>{setBefore(undefined);setOlder([]);setMessages([]);}}>최신 대화로 이동</button></div> : readOnly ? <div className="inline-notice">종료된 상담입니다. 이전 대화는 계속 확인할 수 있습니다.</div> : <form className="chat-composer" onSubmit={async (e) => { e.preventDefault(); setBusy(true); messageId.current ??= crypto.randomUUID(); try {
        await api('orders/' + o.id + '/chat', { id: messageId.current, partnerId: current, body: text, photoIds: attachments });
        setText('');
        setAttachments([]);
        messageId.current = null;
        await load();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}>{current!==SUPPORT_THREAD && o.selected_bid_id === options.find(b => b.partner_id === current)?.id && <button type="button" disabled={busy} className="icon-button" aria-label="상담에 사진 첨부" onClick={() => { api<TradeData>('orders/' + o.id + '/trade').then(d => { setAvailablePhotos(d.photos); setPicking(true); }).catch(e => setError(e.message)); }}><Paperclip size={18}/>{attachments.length > 0 && <span>{attachments.length}</span>}</button>}<textarea disabled={busy} aria-label="상담 메시지" maxLength={2000} required value={text} placeholder="메시지를 입력하세요" onChange={e => { setText(e.target.value); messageId.current = null; }}/><button aria-label="메시지 보내기" className="btn primary" type="submit" disabled={busy || !text.trim()}><Send size={18}/></button></form>}<Dialog open={picking} onOpenChange={setPicking}><DialogContent><DialogHeader><DialogTitle>상담에 사진 첨부</DialogTitle><DialogDescription>이 주문의 사진을 최대 6장 선택하세요. 선택한 사진은 메시지를 보낼 때 함께 전달됩니다.</DialogDescription></DialogHeader><EvidenceUpload orderId={o.id} onUploaded={async () => { const d = await api<TradeData>('orders/' + o.id + '/trade'); setAvailablePhotos(d.photos); }}/><div className="evidence-picker">{availablePhotos.map(p => <label key={p.id}><Checkbox checked={attachments.includes(p.id)} disabled={!attachments.includes(p.id) && attachments.length >= 6} onCheckedChange={v => { setAttachments(prev => v ? [...prev, p.id] : prev.filter(id => id !== p.id)); messageId.current = null; }}/><Image unoptimized src={'/api/photos/' + p.id} width={100} height={80} alt="상담 첨부 사진"/></label>)}</div><button className="btn primary" onClick={() => setPicking(false)}>사진 선택 완료</button></DialogContent></Dialog></article>;
}
type Checkout = {
    id: string;
    clientKey: string;
    amount: number;
    orderName: string;
    customerKey: string;
};
declare global {
    interface Window {
        TossPayments?: (key: string) => {
            payment: (v: {
                customerKey: string;
            }) => {
                requestPayment: (v: unknown) => Promise<void>;
            };
        };
    }
}
async function openCheckout(p: Checkout, orderId: string) { if (!window.TossPayments)
    await new Promise<void>((resolve, reject) => { const old = document.querySelector<HTMLScriptElement>('script[data-payment-sdk]'); if (old)
        old.remove(); const script = document.createElement('script'); script.src = 'https://js.tosspayments.com/v2/standard'; script.dataset.paymentSdk = 'true'; script.onload = () => resolve(); script.onerror = () => { script.remove(); reject(Error('결제창을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')); }; document.head.appendChild(script); }); if (!window.TossPayments)
    throw Error('결제창 초기화에 실패했습니다.'); await window.TossPayments(p.clientKey).payment({ customerKey: p.customerKey }).requestPayment({ method: 'CARD', amount: { currency: 'KRW', value: p.amount }, orderId: p.id, orderName: p.orderName, successUrl: location.origin + '/payment/return?tradeId=' + orderId, failUrl: location.origin + '/payment/return?tradeId=' + orderId + '&failed=1' }); }
export function PaymentReturn() { return <Access><PaymentResult /></Access>; }
function PaymentResult() { const [message, setMessage] = useState('결제 결과를 확인하고 있습니다…'); const [busy, setBusy] = useState(false); const [orderId, setOrderId] = useState(''); const [success, setSuccess] = useState(false); const attempted = useRef(false); const verify = useCallback(async () => { const q = new URLSearchParams(location.search); const id = q.get('tradeId') ?? ''; setOrderId(id); if (q.get('failed')) {
    setMessage('결제창이 종료되었거나 결제가 실패했습니다. 주문에서 결제 상태를 확인한 후 다시 시도해 주세요.');
    return;
} if (!id || !q.get('paymentKey') || !q.get('orderId')) {
    setMessage('결제 결과 정보가 없습니다. 주문의 결제 내역을 확인해 주세요.');
    return;
} setBusy(true); try {
    await api('orders/' + id + '/trade/payment-confirm', { paymentId: q.get('orderId'), paymentKey: q.get('paymentKey'), amount: Number(q.get('amount')) });
    setSuccess(true);
    setMessage('결제사에서 결과를 확인했습니다. 주문에서 현재 결제 상태를 확인해 주세요.');
}
catch (e) {
    setMessage((e as Error).message);
}
finally {
    setBusy(false);
} }, []); useEffect(() => { if (!attempted.current) {
    attempted.current = true;
    void verify();
} }, [verify]); return <div className="workspace"><PageHeading eyebrow="PAYMENT" title="결제 결과"/><article className="panel"><p role="status">{message}</p><div className="action-row">{!success && <button className="btn secondary" disabled={busy} onClick={() => void verify()}>결과 다시 확인</button>}<Link className="btn primary" href={orderId ? '/mypage/' + orderId : '/mypage'}>주문으로 돌아가기</Link></div></article></div>; }
export function Notifications() { const { user } = useAccount(); const [items, setItems] = useState<Notification[]>([]); const [open, setOpen] = useState(false); const [error, setError] = useState(''); useEffect(() => { if (!user)
    return; const load = () => api<Notification[]>('notifications').then(v => { setItems(v); setError(''); }).catch(e => setError(e.message)); void load(); const t = setInterval(() => { if (document.visibilityState === 'visible')
    void load(); }, 15000); return () => clearInterval(t); }, [user]); if (!user)
    return null; const unread = items.filter(i => !i.read_at).length; return <><button className="notification-trigger" onClick={() => setOpen(true)} aria-label={'알림 ' + unread + '개 미확인'}><Bell size={19}/>{unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}</button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>내 알림</DialogTitle><DialogDescription>새 대화와 거래 진행 상황을 확인하세요.</DialogDescription></DialogHeader><div className="notification-list">{error && <p role="alert">{error}</p>}{items.length === 0 ? <p className="muted">새 알림이 없습니다.</p> : items.map(n => <Link key={n.id} className={'notification-item ' + (!n.read_at ? 'unread' : '')} href={(user.role === 'ADMIN' ? '/admin/orders/' : user.role === 'PARTNER' ? '/partner/work/' : '/mypage/') + n.order_id} onClick={() => { void api('notifications', { id: n.id }).then(() => setItems(prev => prev.map(v => v.id === n.id ? { ...v, read_at: new Date().toISOString() } : v))).catch(e => toast.error(e.message)); setOpen(false); }}><span>{n.message}</span><small>{time(n.created_at)}</small></Link>)}</div></DialogContent></Dialog></>; }
/**
 * 정산·분쟁 원장.
 *
 * 29-22: `audience` 가 생겼다. 정산 화면은 `/partner/settlement` 와 `/admin/settlements` 두 주소가
 * 같은 부품을 쓰는데, 게이트를 `kind` 로만 고르면 **두 주소의 합집합**이 된다 — 파트너가 관리자
 * 주소를 그대로 열 수 있었다. 세 역할 동시 감사 봇이 그것을 잡았다.
 *
 * 새는 것은 없었다. 서버가 파트너에게는 `s.partner_id = 나` 만 돌려준다(`lib/trade.ts` 의 `ledger`).
 * 그래도 관리자 주소가 관리자만의 자리인 것은 지킨다 — 문을 주소로 나눠 놓고 한쪽만 잠그면,
 * 다음 사람이 그 주소에 관리자 전용 기능을 얹을 때 아무도 다시 보지 않는다.
 */
export function TradeLedger({ kind, audience = 'partner' }: {
    kind: 'settlements' | 'disputes';
    audience?: 'admin' | 'partner';
}) { return <Access roles={kind === 'disputes' || audience === 'admin' ? ['ADMIN'] : ['PARTNER', 'ADMIN']}><LedgerContent kind={kind}/></Access>; }
function LedgerContent({ kind }: {
    kind: 'settlements' | 'disputes';
}) { const { user } = useAccount(); const [rows, setRows] = useState<((Settlement | Dispute) & {
    title: string;
})[]>([]); const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false); useEffect(() => { api<((Settlement | Dispute) & {
    title: string;
})[]>(kind).then(setRows).catch(e => setError(e.message)).finally(() => setLoaded(true)); }, [kind]); const title = kind === 'settlements' ? '정산 내역' : '분쟁 관리'; return <div className={user?.role === 'ADMIN' ? '' : 'workspace'}><PageHeading eyebrow={kind.toUpperCase()} title={title} description={kind === 'settlements' ? '승인·보류·지급 기록을 주문별로 확인합니다.' : '계약, 상담, 증빙과 결제 내역을 함께 확인해 처리합니다.'}/><section className="panel">{error ? <p role="alert">{error}</p> : !loaded ? <p>내역을 불러오고 있습니다…</p> : rows.length === 0 ? <Blank title="등록된 내역이 없습니다" description={kind === 'settlements' ? '주문 상세에서 관리자가 정산을 검토하면 여기에 표시됩니다.' : '고객이나 파트너가 분쟁을 접수하면 여기에 표시됩니다.'}/> : <Table><TableHeader><TableRow><TableHead>작업</TableHead><TableHead>상태</TableHead><TableHead>{kind === 'settlements' ? '지급 예정액' : '접수 사유'}</TableHead></TableRow></TableHeader><TableBody>{rows.map(r => <TableRow key={'id' in r ? r.id : r.order_id}><TableCell><Link className="table-title" href={(user?.role === 'ADMIN' ? '/admin/orders/' : '/partner/work/') + r.order_id}>{r.title}</Link></TableCell><TableCell><TradeStatus value={r.status}/></TableCell><TableCell>{'payable' in r ? won(r.payable) : r.reason}</TableCell></TableRow>)}</TableBody></Table>}</section></div>; }
