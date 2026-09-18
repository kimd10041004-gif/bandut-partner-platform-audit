import {z} from 'zod';
import {isValidDateStr} from './marketplace/date';
export const daySchema=z.string().refine(isValidDateStr,'실제 날짜를 입력해 주세요.');
export const eventSchema=z.object({id:z.string().uuid(),revision:z.number().int().nonnegative(),title:z.string().trim().min(1,'일정 제목을 입력해 주세요.').max(100),kind:z.enum(['CONSULT','MEASURE','PERSONAL']),date:daySchema,start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),note:z.string().trim().max(2000),status:z.enum(['PLANNED','DONE'])}).strict().refine(v=>v.end>v.start,{message:'종료 시각은 시작 시각보다 늦어야 합니다.',path:['end']});
export type CalendarEvent=z.infer<typeof eventSchema>;
export interface Visit {id:string;title:string;region:string;date:string;start_hour:number;end_hour:number;status:string;company:string;pending:number;contract_accepted:number}
export interface CalendarData {events:CalendarEvent[];visits:Visit[]}
export interface ChatThread {order_id:string;partner_id:string;title:string;company:string;customer_name:string;status:string;last_body:string|null;last_at:string;unread:number}
export type SearchKind='order'|'message'|'event'|'content'|'service';
export interface SearchHit {id:string;kind:SearchKind;title:string;snippet:string;href:string}
export interface SearchData {items:SearchHit[];hasMore:boolean}
export const eventKinds={CONSULT:'상담',MEASURE:'실측',PERSONAL:'개인 일정'};
export function orderHref(role:string,id:string){return (role==='ADMIN'?'/admin/orders/':role==='PARTNER'?'/partner/work/':'/mypage/')+encodeURIComponent(id);}
