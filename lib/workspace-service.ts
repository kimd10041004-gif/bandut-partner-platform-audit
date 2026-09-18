import { SEQ_MAX, SUPPORT_THREAD } from './chat-model';
import {z} from 'zod';
import type {Database,User} from './model';
import {fail} from './errors';
import {trade} from './trade';
import {categories} from './catalog';
import {daySchema,eventSchema,orderHref,type CalendarData,type CalendarEvent,type Visit,type ChatThread,type SearchData,type SearchHit} from './workspace-model';
export function workspaceService(db:Database){
 const stmt=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
 const rows=async<T>(sql:string,...args:unknown[])=>(await stmt(sql,...args).all<T>()).results;
 async function guard(u:User){if(u.suspended)fail(403,'사용이 제한된 계정입니다.');if(u.role==='PARTNER'&&!await stmt("SELECT user_id FROM partners WHERE user_id=? AND status='APPROVED'",u.id).first())fail(403,'파트너 승인 후 이용할 수 있습니다.');}
 const participants=(u:User)=>({sql:u.role==='ADMIN'?'1=1':u.role==='PARTNER'?'b.partner_id=?':'o.customer_id=?',args:u.role==='ADMIN'?[]:[u.id]});
 function range(from:string,to:string){daySchema.parse(from);daySchema.parse(to);if(to<from||(Date.parse(to)-Date.parse(from))/86400000>62)fail(400,'일정 조회 기간은 최대 62일입니다.');}
 return {
  async threads(u:User,query=''){await guard(u);const q=z.string().trim().max(100).parse(query).toLowerCase(),p=participants(u);return rows<ChatThread>(`SELECT * FROM (SELECT o.id order_id,b.partner_id,o.title,p.company,c.name customer_name,o.status,m.body last_body,COALESCE(m.created_at,b.updated_at) last_at,
   (SELECT COUNT(*) FROM messages n WHERE n.order_id=o.id AND n.partner_id=b.partner_id AND n.sender_id!=? AND n.seq>COALESCE(r.last_seq,0)) unread
   FROM bids b JOIN orders o ON o.id=b.order_id JOIN partners p ON p.user_id=b.partner_id JOIN users c ON c.id=o.customer_id
   LEFT JOIN messages m ON m.seq=(SELECT MAX(seq) FROM messages WHERE order_id=o.id AND partner_id=b.partner_id)
   LEFT JOIN chat_reads r ON r.order_id=o.id AND r.partner_id=b.partner_id AND r.user_id=?
   WHERE ${p.sql} AND (?='' OR instr(lower(o.title||' '||p.company||' '||c.name||' '||COALESCE(m.body,'')),?)>0)
   ${u.role==='PARTNER' ? '' : `UNION ALL SELECT o.id order_id,? partner_id,o.title,'반듯집수리 운영팀' company,c.name customer_name,o.status,m.body last_body,COALESCE(m.created_at,o.created_at) last_at,
   (SELECT COUNT(*) FROM messages n WHERE n.order_id=o.id AND n.partner_id=? AND n.sender_id!=? AND n.seq>COALESCE(r.last_seq,0)) unread
   FROM orders o JOIN users c ON c.id=o.customer_id
   LEFT JOIN messages m ON m.seq=(SELECT MAX(seq) FROM messages WHERE order_id=o.id AND partner_id=?)
   LEFT JOIN chat_reads r ON r.order_id=o.id AND r.partner_id=? AND r.user_id=?
   WHERE ${u.role==='ADMIN'?'1=1':'o.customer_id=?'} AND (?='' OR instr(lower(o.title||' 운영팀 '||c.name||' '||COALESCE(m.body,'')),?)>0)`}
   ) ORDER BY last_at DESC,order_id,partner_id LIMIT 200`,u.id,u.id,...p.args,q,q,...(u.role==='PARTNER'?[]:[SUPPORT_THREAD,SUPPORT_THREAD,u.id,SUPPORT_THREAD,SUPPORT_THREAD,u.id,...(u.role==='ADMIN'?[]:[u.id]),q,q]));},
  async read(u:User,raw:unknown){await guard(u);const i=z.object({orderId:z.string().uuid(),partnerId:z.string().min(1).max(200),seq:z.number().int().positive().max(SEQ_MAX)}).strict().parse(raw);await trade(db).chat(u,i.orderId,i.partnerId);if(!await stmt('SELECT seq FROM messages WHERE order_id=? AND partner_id=? AND seq=?',i.orderId,i.partnerId,i.seq).first())fail(400,'읽은 메시지를 확인할 수 없습니다.');await stmt('INSERT INTO chat_reads (user_id,order_id,partner_id,last_seq) VALUES (?,?,?,?) ON CONFLICT(user_id,order_id,partner_id) DO UPDATE SET last_seq=MAX(chat_reads.last_seq,excluded.last_seq)',u.id,i.orderId,i.partnerId,i.seq).run();return {ok:true};},
  async calendar(u:User,from:string,to:string):Promise<CalendarData>{await guard(u);range(from,to);const p=participants(u);return {events:await rows<CalendarEvent>('SELECT id,title,kind,date,start,"end",note,status,revision FROM calendar_events WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date,start,id',u.id,from,to),visits:await rows<Visit>(`SELECT o.id,o.title,o.region,s.date,s.start_hour,s.end_hour,o.status,p.company,
   CASE WHEN EXISTS(SELECT 1 FROM schedule_changes WHERE order_id=o.id AND status='PROPOSED') THEN 1 ELSE 0 END pending,
   CASE WHEN EXISTS(SELECT 1 FROM contracts WHERE order_id=o.id AND status='ACCEPTED') THEN 1 ELSE 0 END contract_accepted
   FROM schedule_slots s JOIN orders o ON o.id=s.order_id JOIN bids b ON b.id=o.selected_bid_id JOIN partners p ON p.user_id=b.partner_id
   WHERE ${p.sql} AND s.date BETWEEN ? AND ? AND o.status NOT IN ('CANCELLED','EXPIRED') ORDER BY s.date,s.start_hour,o.id`,...p.args,from,to)};},
  async saveEvent(u:User,raw:unknown){await guard(u);const i=eventSchema.parse(raw);const changed=i.revision===0
    ?await stmt('INSERT INTO calendar_events (id,user_id,title,kind,date,start,"end",note,status,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT DO NOTHING',i.id,u.id,i.title,i.kind,i.date,i.start,i.end,i.note,i.status,new Date().toISOString()).run()
    :await stmt('UPDATE calendar_events SET title=?,kind=?,date=?,start=?,"end"=?,note=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?',i.title,i.kind,i.date,i.start,i.end,i.note,i.status,new Date().toISOString(),i.id,u.id,i.revision).run();
   if(!changed.meta.changes)fail(409,'일정이 변경되었거나 삭제되었습니다. 목록을 새로고침한 뒤 다시 열어 주세요.');return {ok:true};},
  async deleteEvent(u:User,raw:unknown){await guard(u);const i=z.object({id:z.string().uuid(),revision:z.number().int().positive()}).strict().parse(raw);const r=await stmt('DELETE FROM calendar_events WHERE id=? AND user_id=? AND revision=?',i.id,u.id,i.revision).run();if(!r.meta.changes)fail(409,'일정이 변경되었거나 삭제되었습니다. 목록을 새로고침해 주세요.');return {ok:true};},
  async search(u:User,query:string,kind:string,offset:number):Promise<SearchData>{await guard(u);const q=z.string().trim().min(1).max(100).parse(query).toLowerCase();z.enum(['all','order','message','event','content','service']).parse(kind);z.number().int().min(0).max(10000).parse(offset);
   const p=participants(u),limit=offset+31;
   const orderFilter=u.role==='ADMIN'?{sql:'1=1',args:[]}:u.role==='PARTNER'?{sql:"((o.status='BIDDING' AND o.deadline>?) OR EXISTS(SELECT 1 FROM bids WHERE order_id=o.id AND partner_id=?))",args:[new Date().toISOString(),u.id]}:{sql:'o.customer_id=?',args:[u.id]};
   const queries:string[]=[],args:unknown[]=[];
   if(kind==='all'||kind==='order'){queries.push(`SELECT o.id id,'order' kind,o.title,substr(o.description,1,240)||' · '||o.region snippet,'' partner_id,o.updated_at stamp,o.id target,0 cursor FROM orders o WHERE ${orderFilter.sql} AND instr(lower(o.title||' '||o.region||' '||o.description||' '||o.id),?)>0`);args.push(...orderFilter.args,q);}
   if(kind==='all'||kind==='message'){queries.push(`SELECT m.id id,'message' kind,o.title,substr(m.body,1,240) snippet,m.partner_id,m.created_at stamp,m.order_id target,m.seq cursor FROM messages m JOIN orders o ON o.id=m.order_id JOIN bids b ON b.order_id=m.order_id AND b.partner_id=m.partner_id WHERE ${p.sql} AND instr(lower(m.body),?)>0`);args.push(...p.args,q);}
   if((kind==='all'||kind==='message')&&u.role!=='PARTNER'){queries.push(`SELECT m.id id,'message' kind,o.title,substr(m.body,1,240) snippet,m.partner_id,m.created_at stamp,m.order_id target,m.seq cursor FROM messages m JOIN orders o ON o.id=m.order_id WHERE m.partner_id=? AND ${u.role==='ADMIN'?'1=1':'o.customer_id=?'} AND instr(lower(m.body),?)>0`);args.push(SUPPORT_THREAD,...(u.role==='ADMIN'?[]:[u.id]),q);}
   if(kind==='all'||kind==='event'){queries.push("SELECT id,'event' kind,title,note||' · '||date||' '||start snippet,'' partner_id,updated_at stamp,date target,0 cursor FROM calendar_events WHERE user_id=? AND instr(lower(title||' '||note||' '||date),?)>0");args.push(u.id,q);}
   if(kind==='all'||kind==='content'){queries.push("SELECT id,'content' kind,title,substr(body,1,240) snippet,'' partner_id,updated_at stamp,id target,0 cursor FROM content_posts WHERE published=1 AND instr(lower(title||' '||body),?)>0");args.push(q);}
   const result=queries.length?await rows<{id:string;kind:SearchHit['kind'];title:string;snippet:string;partner_id:string;stamp:string;target:string;cursor:number}>(queries.join(' UNION ALL ')+' ORDER BY stamp DESC,id LIMIT ?',...args,limit):[];
   const items:SearchHit[]=[];
   for(const r of result){let href='/notices';if(r.kind==='order')href=orderHref(u.role,r.id);if(r.kind==='message')href='/messages?order='+encodeURIComponent(r.target)+'&partner='+encodeURIComponent(r.partner_id)+'&before='+(r.cursor+1);if(r.kind==='event')href='/schedule?date='+r.target;items.push({id:r.id,kind:r.kind,title:r.title,snippet:r.snippet,href});}
   if(kind==='all'||kind==='service')items.unshift(...categories.filter(c=>c.join(' ').toLowerCase().includes(q)).map(c=>({id:c[0],kind:'service' as const,title:c[1],snippet:c[2],href:'/services'})));
   return {items:items.slice(offset,offset+30),hasMore:items.length>offset+30};
  }
 };
}
