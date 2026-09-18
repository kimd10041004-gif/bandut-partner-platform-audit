import {z} from 'zod';
import type {Database,User,Partner,Order} from './model';
import {fail} from './errors';
import {defaultPageConfig,pageConfigSchema,parsePageConfig,type PageConfig} from './company-page';
const now=()=>new Date().toISOString(),uid=()=>crypto.randomUUID();
/**
 * 공개 게시판에 실명을 남기지 않는다 (29-14). 성만 남기고 나머지를 가린다.
 * 한 글자 이름은 가릴 것이 없으므로 그대로 둔다 — 빈 문자열보다 낫다.
 */
const maskName=(name:string)=>{const n=name.trim();return n.length<=1?n:n[0]+'O'.repeat(n.length-1);};
/**
 * 날짜별 접수 건수를 **한국 시간 기준**으로 센다 (29-25).
 *
 * 원래는 SQL 한 줄이었다 — `date(created_at,'+9 hours')`. 그것은 SQLite 함수라 **Postgres 에서 터진다**
 * (`syntax error at or near "day"`). 단위 테스트는 SQLite 로 돌기 때문에 초록이었고, 운영에서만
 * 관리자 운영 대시보드가 숫자를 하나도 못 그렸다. 거래 감사 봇이 그것을 잡았다.
 *
 * 두 방언에서 같이 도는 날짜 표현식을 찾는 대신 **세는 일을 여기로 가져왔다.** 방언이 없으면
 * 방언 때문에 틀릴 일도 없다. 30일 치 주문만 읽으므로 양도 갇혀 있다.
 */
export function dailyCounts(rows:{created_at:string}[]):{day:string;count:number}[]{
 const byDay=new Map<string,number>();
 for(const r of rows){
  // ISO 문자열은 UTC 다. 한국은 +9 시간이라 그만큼 민 뒤 날짜만 취한다
  const day=new Date(new Date(r.created_at).getTime()+9*3600000).toISOString().slice(0,10);
  byDay.set(day,(byDay.get(day)??0)+1);
 }
 return [...byDay.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(([day,count])=>({day,count}));
}
const text=z.string().trim().min(5).max(2000);
export interface Case {id:string;partner_id:string;title:string;body:string;region:string;asset_id:string|null;published:number;created_at:string;updated_at:string}
/** 업체가 올린 사진 한 장 (29-31). 사례에 붙지 않은 것도 있다 — 커버·로고가 그렇다 */
export interface Asset {id:string;mime:string;created_at:string}
export interface Review {order_id:string;partner_id:string;rating:number;body:string;reply:string|null;hidden:number;created_at:string;updated_at:string}
export interface Post {id:string;kind:'NOTICE'|'FAQ';title:string;body:string;published:number;revision:number;created_at:string;updated_at:string}
export interface Settings {accepting:number;notice:string;revision:number}
/** 거래 전 상담 한 줄 (29-16) */
export interface ConsultMessage {seq:number;id:string;sender_id:string;sender_name:string;body:string;created_at:string}
export interface ConsultRoom {id:string;partner_id:string;company:string;customer_id:string;customer_name:string;case_id:string|null;updated_at:string;unread:number}
/** 공개 Q&A 한 줄 (29-14). 질문자는 이름을 내지 않는다 — 가린 이름만 나간다 */
export interface Question {
 id:string;partner_id:string;case_id:string|null;body:string;answer:string|null;
 answered_at:string|null;created_at:string;asker:string
}
/** 업체 찾기 목록의 한 줄 (29-13) — 상세와 달리 사례 본문·후기 본문을 담지 않는다 */
export interface CompanyCard {
 user_id:string;company:string;representative:string;work_items:string;regions:string;
 case_count:number;rating:number|null;review_count:number
}
export interface Company {partner:Pick<Partner,'user_id'|'company'|'representative'|'work_items'|'regions'>;about:string;cases:Case[];reviews:Review[];rating:number|null;reviewCount:number}
export interface Metrics {orders:number;partners:number;pendingPartners:number;reviewNeeded:number;unrouted:number;disputes:number;paid:number;refunded:number;net:number;settlementPaid:number;daily:{day:string;count:number}[];statuses:{status:string;count:number}[]}
export function community(db:Database){
 const s=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
 const roles=(u:User,...r:string[])=>{if(u.suspended||!r.includes(u.role))fail(403,'이 작업의 권한이 없습니다.');};
 const audit=(u:User,action:string,target:string,reason:string)=>s('INSERT INTO audit_logs (id,actor_id,role,order_id,action,before_state,after_state,reason,created_at) VALUES (?,?,?,NULL,?,NULL,?,?,?)',uid(),u.id,u.role,action,JSON.stringify({target}),reason,now());
 const guard=(sql:string,...args:unknown[])=>s('SELECT CASE WHEN EXISTS('+sql+') THEN 1 ELSE abs(-9223372036854775807 - (SELECT COUNT(*) FROM (SELECT 1) AS one)) END',...args);
 async function approved(u:User){roles(u,'PARTNER');const p=await s("SELECT user_id FROM partners WHERE user_id=? AND status='APPROVED'",u.id).first();if(!p)fail(403,'파트너 승인 후 이용할 수 있습니다.');}
 return {
  async company(u:User|null,id:string):Promise<Company>{if(u)roles(u,'CUSTOMER','PARTNER','ADMIN');const p=await s("SELECT user_id,company,representative,work_items,regions FROM partners WHERE user_id=? AND status='APPROVED' AND EXISTS(SELECT 1 FROM users WHERE users.id=partners.user_id AND suspended=0)",id).first<Company['partner']>();if(!p)fail(404,'공개된 업체 정보를 찾을 수 없습니다.');const [profile,cases,reviews,score]=await Promise.all([s('SELECT about FROM partner_profiles WHERE partner_id=?',id).first<{about:string}>(),s('SELECT * FROM portfolio_cases WHERE partner_id=? AND published=1 ORDER BY created_at DESC LIMIT 50',id).all<Case>(),s('SELECT order_id,partner_id,rating,body,reply,hidden,created_at,updated_at FROM reviews WHERE partner_id=? AND hidden=0 ORDER BY created_at DESC LIMIT 100',id).all<Review>(),s('SELECT AVG(rating) rating,COUNT(*) count FROM reviews WHERE partner_id=? AND hidden=0',id).first<{rating:number|null;count:number}>()]);return {partner:p,about:profile?.about??'',cases:cases.results,reviews:reviews.results,rating:score?.rating??null,reviewCount:score?.count??0};},
  /**
   * 업체 찾기 (29-13, 명세 4절).
   *
   * **로그인 없이 본다.** 상세와 같은 규칙으로 승인된 업체만, 정지된 계정은 빼고 고른다 —
   * 목록에서 보이는데 눌러 보면 404 인 일이 없어야 한다.
   *
   * 숫자는 **있는 행에서만** 나온다. 공개 사례 수는 실제 published=1 행의 수이고, 별점은 숨기지
   * 않은 후기가 있을 때만 준다(없으면 null). 명세 4절이 "시공 건수·별점·인기 표시를 근거 없이
   * 만들지 않는다"고 한 자리다 — 후기가 0건인 업체에 0.0점을 붙이지 않는다.
   *
   * `work_items`는 JSON 배열 문자열, `regions`는 문자열이라 LIKE 로 고른다. 항목 수가 적은 동안은
   * 이걸로 충분하고, 늘어나면 색인 있는 표로 옮긴다(그때는 이 함수 하나만 바뀐다).
   */
  async companies(filter:{region?:string;workItem?:string;q?:string;offset?:number}={}){
   const where=["p.status='APPROVED'","u.suspended=0"];const args:unknown[]=[];
   const region=(filter.region??'').trim(),workItem=(filter.workItem??'').trim(),q=(filter.q??'').trim();
   if(region!==''){where.push('p.regions LIKE ?');args.push('%'+region+'%');}
   if(workItem!==''){where.push('p.work_items LIKE ?');args.push('%"'+workItem+'"%');}
   if(q!==''){where.push('(p.company LIKE ? OR p.representative LIKE ?)');args.push('%'+q+'%','%'+q+'%');}
   const offset=Math.max(0,Math.trunc(Number(filter.offset??0)||0));
   const rows=await s(
    'SELECT p.user_id,p.company,p.representative,p.work_items,p.regions,'+
    "(SELECT COUNT(*) FROM portfolio_cases c WHERE c.partner_id=p.user_id AND c.published=1) AS case_count,"+
    '(SELECT AVG(r.rating) FROM reviews r WHERE r.partner_id=p.user_id AND r.hidden=0) AS rating,'+
    '(SELECT COUNT(*) FROM reviews r WHERE r.partner_id=p.user_id AND r.hidden=0) AS review_count '+
    'FROM partners p JOIN users u ON u.id=p.user_id WHERE '+where.join(' AND ')+
    ' ORDER BY p.company LIMIT 21 OFFSET ?',...args,offset,
   ).all<CompanyCard>();
   // 22번째를 세지 않고 21개를 받아 "더 있는가"만 안다 — 전체 개수를 세면 목록마다 한 번 더 훑는다
   const more=rows.results.length>20;
   return {companies:rows.results.slice(0,20).map((c)=>({...c,rating:c.review_count>0?c.rating:null})),more};
  },
  /**
   * 업체의 공개 질문 (29-14, 명세 7절).
   *
   * **로그인 없이 읽는다.** 질문은 다음 손님이 같은 것을 묻지 않게 하려고 공개하는 것이다.
   * 숨김 처리된 질문(`hidden=1`)은 나가지 않는다.
   *
   * 질문자의 이름은 내지 않는다. 가린 이름만 준다 — "김OO". 공개 게시판에 실명이 남을 이유가 없고,
   * 한 번 나간 이름은 되돌릴 수 없다.
   */
  async questions(partnerId:string){
   const rows=await s(
    "SELECT q.id,q.partner_id,q.case_id,q.body,q.answer,q.answered_at,q.created_at,u.name AS asker "+
    'FROM questions q JOIN users u ON u.id=q.customer_id '+
    'WHERE q.partner_id=? AND q.hidden=0 ORDER BY q.created_at DESC LIMIT 100',partnerId,
   ).all<Question>();
   return rows.results.map((q)=>({...q,asker:maskName(q.asker)}));
  },

  /** 질문 작성 — 로그인한 고객만. 승인된 업체에만 걸 수 있다(없는 문 앞에 질문을 쌓지 않는다) */
  async ask(u:User,partnerId:string,raw:unknown){
   roles(u,'CUSTOMER');
   const i=z.object({body:z.string().trim().min(5).max(1000),caseId:z.string().uuid().nullable()}).strict().parse(raw);
   const p=await s("SELECT user_id FROM partners WHERE user_id=? AND status='APPROVED'",partnerId).first();
   if(!p)fail(404,'공개된 업체 정보를 찾을 수 없습니다.');
   // 사례를 걸었다면 그 업체의 공개 사례여야 한다 — 남의 사례 ID 를 붙여 넣지 못하게
   if(i.caseId&&!await s('SELECT id FROM portfolio_cases WHERE id=? AND partner_id=? AND published=1',i.caseId,partnerId).first()){
    fail(403,'이 업체의 공개된 시공 사례가 아닙니다.');
   }
   if((await s('SELECT COUNT(*) n FROM questions WHERE customer_id=? AND answer IS NULL',u.id).first<{n:number}>())!.n>=20){
    fail(409,'답변을 기다리는 질문이 너무 많습니다. 먼저 답변을 확인해 주세요.');
   }
   const id=uid();
   // 알림 벨을 울리지 않는다. `notifications.order_id`가 NOT NULL 이라 주문 없는 알림은 그 표에
   // 들어가지 않는다 — 질문 하나 때문에 v17 표의 모양을 바꾸지 않는다. 업체는 받은 질문함에서
   // 미답변이 맨 위에 오는 것으로 안다(`inbox`). 문자·푸시가 붙는 라운드에서 다시 본다.
   await db.batch([
    s('INSERT INTO questions (id,partner_id,customer_id,case_id,body,answer,answered_at,hidden,created_at,updated_at) VALUES (?,?,?,?,?,NULL,NULL,0,?,?)',id,partnerId,u.id,i.caseId,i.body,now(),now()),
   ]);
   return {id};
  },

  /** 답변 — **그 업체만**. 질문이 걸린 업체와 답변하는 계정의 업체가 같아야 한다(명세 8절) */
  async answer(u:User,questionId:string,raw:unknown){
   await approved(u);
   const i=z.object({answer:z.string().trim().min(5).max(2000)}).strict().parse(raw);
   const q=await s('SELECT partner_id FROM questions WHERE id=?',questionId).first<{partner_id:string}>();
   if(!q)fail(404,'질문을 찾을 수 없습니다.');
   if(q.partner_id!==u.id)fail(403,'우리 업체에 온 질문만 답변할 수 있습니다.');
   await db.batch([
    s('UPDATE questions SET answer=?,answered_at=?,updated_at=? WHERE id=?',i.answer,now(),now(),questionId),
    audit(u,'QUESTION_ANSWERED',questionId,'공개 질문 답변'),
   ]);
   return {ok:true};
  },

  /** 우리 업체에 온 질문 — 미답변이 먼저 온다. 숨김도 보인다(답변 대상이므로) */
  async inbox(u:User){
   await approved(u);
   const rows=await s(
    "SELECT q.id,q.partner_id,q.case_id,q.body,q.answer,q.answered_at,q.created_at,u.name AS asker "+
    'FROM questions q JOIN users u ON u.id=q.customer_id WHERE q.partner_id=? '+
    'ORDER BY (CASE WHEN q.answer IS NULL THEN 0 ELSE 1 END),q.created_at DESC LIMIT 100',u.id,
   ).all<Question>();
   return rows.results.map((q)=>({...q,asker:maskName(q.asker)}));
  },

  /** 숨김·해제 — 관리자만 (명세 7절의 "신고·숨김") */
  async hideQuestion(u:User,raw:unknown){
   roles(u,'ADMIN');
   const i=z.object({id:z.string().uuid(),hidden:z.boolean()}).strict().parse(raw);
   const q=await s('SELECT id FROM questions WHERE id=?',i.id).first();
   if(!q)fail(404,'질문을 찾을 수 없습니다.');
   await db.batch([
    s('UPDATE questions SET hidden=?,updated_at=? WHERE id=?',Number(i.hidden),now(),i.id),
    audit(u,'QUESTION_MODERATED',i.id,i.hidden?'공개 질문 숨김':'공개 질문 숨김 해제'),
   ]);
   return {ok:true};
  },

  /**
   * 업체 페이지 편집본 (29-15, 명세 5·6절) — 자기 것만 본다.
   *
   * 아직 한 번도 꾸미지 않았으면 기본값을 준다. 빈 화면 앞에 세워 두면 무엇부터 해야 할지 알 수 없다.
   */
  async pageDraft(u:User){
   await approved(u);
   const row=await s('SELECT draft_config,published_config,draft_revision,published_revision,published_at FROM company_pages WHERE partner_id=?',u.id)
    .first<{draft_config:string;published_config:string|null;draft_revision:number;published_revision:number;published_at:string|null}>();
   return {
    config:parsePageConfig(row?.draft_config),
    revision:row?.draft_revision??0,
    published:row?.published_config!=null,
    publishedRevision:row?.published_revision??0,
    publishedAt:row?.published_at??null,
   };
  },

  /**
   * 편집본 저장 (명세 11절) — **덮어쓰기를 막는다.**
   *
   * 다른 탭에서 먼저 저장했으면 여기 리비전이 뒤처진다. 그때 그냥 쓰면 앞선 변경이 조용히 사라진다.
   * 409 로 알려 주고 다시 불러오게 한다. 공개본은 건드리지 않는다 — 저장은 아직 손님에게 보이지 않는다.
   */
  async savePage(u:User,raw:unknown){
   await approved(u);
   const i=z.object({config:pageConfigSchema,revision:z.number().int().nonnegative()}).strict().parse(raw);
   const row=await s('SELECT draft_revision FROM company_pages WHERE partner_id=?',u.id).first<{draft_revision:number}>();
   const current=row?.draft_revision??0;
   if(current!==i.revision)fail(409,'다른 곳에서 먼저 저장했습니다. 다시 불러온 뒤 수정해 주세요.');
   const body=JSON.stringify(i.config);
   await db.batch([row
    ?s('UPDATE company_pages SET draft_config=?,draft_revision=draft_revision+1,updated_at=? WHERE partner_id=? AND draft_revision=?',body,now(),u.id,i.revision)
    :s('INSERT INTO company_pages (partner_id,draft_config,published_config,draft_revision,published_revision,published_at,created_at,updated_at) VALUES (?,?,NULL,1,0,NULL,?,?)',u.id,body,now(),now())]);
   return {revision:current+1};
  },

  /**
   * 공개 (명세 6절) — **한 번에 바꾸고, 실패하면 기존 공개본을 그대로 둔다.**
   *
   * 검사에 걸리면 공개본에 손대지 않는다. 반쯤 바뀐 페이지가 손님에게 보이는 일이 없어야 한다.
   * 보는 것: 사진이 내 것인지, 사례가 내 것이고 공개된 것인지. 배치 값 자체는 스키마가 이미 걸렀다.
   */
  async publishPage(u:User,raw:unknown){
   await approved(u);
   const i=z.object({revision:z.number().int().nonnegative()}).strict().parse(raw);
   const row=await s('SELECT draft_config,draft_revision FROM company_pages WHERE partner_id=?',u.id).first<{draft_config:string;draft_revision:number}>();
   if(!row)fail(404,'저장된 편집본이 없습니다. 먼저 저장해 주세요.');
   if(row.draft_revision!==i.revision)fail(409,'다른 곳에서 먼저 저장했습니다. 다시 불러온 뒤 공개해 주세요.');
   const config=pageConfigSchema.parse(JSON.parse(row.draft_config));
   for(const assetId of [config.coverAssetId,config.logoAssetId]){
    if(assetId&&!await s('SELECT id FROM portfolio_assets WHERE id=? AND partner_id=?',assetId,u.id).first()){
     fail(403,'본인이 올린 사진만 사용할 수 있습니다.');
    }
   }
   for(const caseId of config.featuredPortfolioIds){
    if(!await s('SELECT id FROM portfolio_cases WHERE id=? AND partner_id=? AND published=1',caseId,u.id).first()){
     fail(403,'본인의 공개된 시공 사례만 올릴 수 있습니다.');
    }
   }
   await db.batch([
    s('UPDATE company_pages SET published_config=draft_config,published_revision=draft_revision,published_at=?,updated_at=? WHERE partner_id=? AND draft_revision=?',now(),now(),u.id,i.revision),
    audit(u,'COMPANY_PAGE_PUBLISHED',u.id,'업체 페이지 공개'),
   ]);
   return {publishedRevision:row.draft_revision};
  },

  /** 손님이 보는 공개본 — 공개한 적이 없으면 기본값. 로그인 없이 읽는다 */
  async publishedPage(partnerId:string):Promise<{config:PageConfig;published:boolean}>{
   const row=await s("SELECT p.published_config FROM company_pages p JOIN partners t ON t.user_id=p.partner_id JOIN users u ON u.id=t.user_id WHERE p.partner_id=? AND t.status='APPROVED' AND u.suspended=0",partnerId)
    .first<{published_config:string|null}>();
   if(!row?.published_config)return {config:defaultPageConfig(),published:false};
   return {config:parsePageConfig(row.published_config),published:true};
  },

  /**
   * 거래 전 상담방 열기 (29-16, 명세 7절).
   *
   * ## 방은 한 고객·한 업체에 하나뿐이다
   *
   * 같은 조합으로 다시 열어도 **새 방을 만들지 않는다**(`consultations_pair` 유일 색인). 다른 사례를
   * 보다가 문의해도 같은 방으로 들어가고, 그 사례를 방에 매어 둔다 — 명세 7절의 "같은 고객과 업체의
   * 일반 상담방은 중복 생성을 막는다".
   *
   * 거래 메시지(`messages`)는 그대로 둔다. 그쪽은 주문에 매여 있고 이쪽은 주문이 없다.
   */
  async openConsultation(u:User,partnerId:string,raw:unknown){
   roles(u,'CUSTOMER');
   const i=z.object({caseId:z.string().uuid().nullable()}).strict().parse(raw);
   const p=await s("SELECT user_id FROM partners WHERE user_id=? AND status='APPROVED'",partnerId).first();
   if(!p)fail(404,'공개된 업체 정보를 찾을 수 없습니다.');
   if(i.caseId&&!await s('SELECT id FROM portfolio_cases WHERE id=? AND partner_id=? AND published=1',i.caseId,partnerId).first()){
    fail(403,'이 업체의 공개된 시공 사례가 아닙니다.');
   }
   const found=await s('SELECT id,case_id FROM consultations WHERE customer_id=? AND partner_id=?',u.id,partnerId).first<{id:string;case_id:string|null}>();
   if(found){
    // 다른 사례에서 문의하면 그 사례를 이 방에 매어 둔다. 방을 새로 만들지는 않는다
    if(i.caseId&&i.caseId!==found.case_id)await s('UPDATE consultations SET case_id=?,updated_at=? WHERE id=?',i.caseId,now(),found.id).run();
    return {id:found.id,created:false};
   }
   const id=uid();
   await s('INSERT INTO consultations (id,customer_id,partner_id,case_id,created_at,updated_at) VALUES (?,?,?,?,?,?)',id,u.id,partnerId,i.caseId,now(),now()).run();
   return {id,created:true};
  },

  /** 이 사람이 이 방의 참여자인가 — 고객 본인이거나 그 업체. 관리자는 기본 열람하지 않는다(명세 8절) */
  async consultRoom(u:User,id:string){
   const room=await s('SELECT id,customer_id,partner_id,case_id,updated_at FROM consultations WHERE id=?',id)
    .first<{id:string;customer_id:string;partner_id:string;case_id:string|null;updated_at:string}>();
   if(!room)fail(404,'상담방을 찾을 수 없습니다.');
   if(u.suspended||(u.id!==room.customer_id&&u.id!==room.partner_id))fail(403,'이 상담방의 참여자가 아닙니다.');
   return room;
  },

  /** 대화 읽기 — 읽은 자리까지 기록한다 */
  async consultMessages(u:User,id:string){
   const room=await this.consultRoom(u,id);
   const rows=await s('SELECT seq,id,sender_id,sender_name,body,created_at FROM consultation_messages WHERE consultation_id=? ORDER BY seq LIMIT 200',id).all<ConsultMessage>();
   const last=rows.results.at(-1)?.seq??0;
   await s('INSERT INTO consultation_reads (consultation_id,user_id,last_seq) VALUES (?,?,?) ON CONFLICT(consultation_id,user_id) DO UPDATE SET last_seq=excluded.last_seq',id,u.id,last).run();
   return {room,messages:rows.results};
  },

  /**
   * 보내기 — **같은 메시지 ID 로 두 번 오면 한 번만 저장한다.**
   *
   * 전송이 실패한 것처럼 보여 다시 누르는 일이 흔하다. 그때 같은 글이 두 번 남으면 대화가 더러워진다.
   * 화면이 만든 ID 를 유일 색인으로 받아 두 번째를 조용히 넘긴다(명세 7절의 "요청별 중복 방지 ID").
   */
  async sendConsult(u:User,id:string,raw:unknown){
   const room=await this.consultRoom(u,id);
   if(u.id===room.partner_id)await approved(u); // 승인이 풀린 업체는 더 말하지 않는다
   const i=z.object({id:z.string().uuid(),body:z.string().trim().min(1).max(2000)}).strict().parse(raw);
   const dup=await s('SELECT seq FROM consultation_messages WHERE id=?',i.id).first<{seq:number}>();
   if(dup)return {seq:dup.seq,duplicate:true};
   await db.batch([
    s('INSERT INTO consultation_messages (id,consultation_id,sender_id,sender_name,body,created_at) VALUES (?,?,?,?,?,?)',i.id,id,u.id,u.name,i.body,now()),
    s('UPDATE consultations SET updated_at=? WHERE id=?',now(),id),
   ]);
   const saved=await s('SELECT seq FROM consultation_messages WHERE id=?',i.id).first<{seq:number}>();
   return {seq:saved?.seq??0,duplicate:false};
  },

  /** 내 상담방 목록 — 고객이면 내가 연 방, 업체면 우리에게 온 방. 안 읽은 수를 함께 준다 */
  async consultations(u:User){
   roles(u,'CUSTOMER','PARTNER');
   const mine=u.role==='CUSTOMER'?'c.customer_id=?':'c.partner_id=?';
   const rows=await s(
    'SELECT c.id,c.partner_id,p.company,c.customer_id,cu.name AS customer_name,c.case_id,c.updated_at,'+
    '(SELECT COUNT(*) FROM consultation_messages m WHERE m.consultation_id=c.id AND m.sender_id<>? '+
    ' AND m.seq>COALESCE((SELECT r.last_seq FROM consultation_reads r WHERE r.consultation_id=c.id AND r.user_id=?),0)) AS unread '+
    'FROM consultations c JOIN partners p ON p.user_id=c.partner_id JOIN users cu ON cu.id=c.customer_id '+
    'WHERE '+mine+' ORDER BY c.updated_at DESC LIMIT 100',u.id,u.id,u.id,
   ).all<ConsultRoom>();
   return rows.results;
  },

  /**
   * 내 소개·사례·사진 (29-31 에서 `assets` 추가).
   *
   * 사진 목록이 여기 없으면 편집기가 커버·로고로 **고를 목록 자체를 못 만든다.** 사례에 붙은 사진만
   * 주면 안 된다 — 커버는 사례가 아니고, 로고는 더더욱 아니다. 그래서 내 `portfolio_assets` 를 그대로 준다.
   * 남의 사진은 섞이지 않는다(`partner_id=?`).
   */
  async mine(u:User){await approved(u);return {
   about:(await s('SELECT about FROM partner_profiles WHERE partner_id=?',u.id).first<{about:string}>())?.about??'',
   cases:(await s('SELECT * FROM portfolio_cases WHERE partner_id=? ORDER BY created_at DESC LIMIT 50',u.id).all<Case>()).results,
   assets:(await s('SELECT id,mime,created_at FROM portfolio_assets WHERE partner_id=? ORDER BY created_at DESC LIMIT 100',u.id).all<Asset>()).results,
  };},
  async about(u:User,raw:unknown){await approved(u);const i=z.object({about:text}).strict().parse(raw);await db.batch([s('INSERT INTO partner_profiles VALUES (?,?,?) ON CONFLICT(partner_id) DO UPDATE SET about=excluded.about,updated_at=excluded.updated_at',u.id,i.about,now()),audit(u,'PARTNER_ABOUT',u.id,'업체 소개 수정')]);return {ok:true};},
  async saveCase(u:User,raw:unknown){await approved(u);const i=z.object({id:z.string().uuid(),title:z.string().trim().min(3).max(80),body:text,region:z.string().trim().min(2).max(40),assetId:z.string().uuid().nullable(),published:z.boolean(),rightsConfirmed:z.literal(true)}).strict().parse(raw);const old=await s('SELECT partner_id FROM portfolio_cases WHERE id=?',i.id).first<{partner_id:string}>();if(old&&old.partner_id!==u.id)fail(403,'본인 작업사례만 수정할 수 있습니다.');if(!old&&(await s('SELECT COUNT(*) n FROM portfolio_cases WHERE partner_id=?',u.id).first<{n:number}>())!.n>=50)fail(409,'작업사례는 최대 50개까지 등록할 수 있습니다.');if(i.assetId&&!await s('SELECT id FROM portfolio_assets WHERE id=? AND partner_id=?',i.assetId,u.id).first())fail(403,'본인이 작업사례용으로 올린 사진만 사용할 수 있습니다.');await db.batch([s('INSERT INTO portfolio_cases VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,region=excluded.region,asset_id=excluded.asset_id,published=excluded.published,updated_at=excluded.updated_at WHERE portfolio_cases.partner_id=excluded.partner_id',i.id,u.id,i.title,i.body,i.region,i.assetId,Number(i.published),now(),now()),audit(u,'PORTFOLIO_SAVED',i.id,i.published?'공개 동의 확인 후 사례 게시':'사례 비공개 저장')]);return {ok:true};},
  async assetPermission(u:User,id:string){roles(u,'CUSTOMER','PARTNER','ADMIN');const a=await s('SELECT * FROM portfolio_assets WHERE id=?',id).first<{id:string;partner_id:string;object_key:string;mime:string}>();if(!a)fail(404,'사진이 없습니다.');if(u.role!=='ADMIN'&&u.id!==a.partner_id&&!await s("SELECT c.id FROM portfolio_cases c JOIN partners p ON p.user_id=c.partner_id JOIN users u ON u.id=p.user_id WHERE c.asset_id=? AND c.published=1 AND p.status='APPROVED' AND u.suspended=0",id).first())fail(403,'이 사진을 볼 수 없습니다.');return a;},
  async uploadPermission(u:User){await approved(u);if((await s('SELECT COUNT(*) n FROM portfolio_assets WHERE partner_id=?',u.id).first<{n:number}>())!.n>=100)fail(409,'사진 보관 한도에 도달했습니다. 관리자에게 문의해 주세요.');},
  async review(u:User,orderId:string){roles(u,'CUSTOMER','PARTNER','ADMIN');const o=await s('SELECT * FROM orders WHERE id=?',orderId).first<Order>();if(!o)fail(404,'주문이 없습니다.');const b=await s('SELECT partner_id FROM bids WHERE id=?',o.selected_bid_id).first<{partner_id:string}>();if(u.role!=='ADMIN'&&o.customer_id!==u.id&&b?.partner_id!==u.id)fail(403,'이 주문의 후기를 볼 수 없습니다.');return {review:await s('SELECT order_id,partner_id,rating,body,reply,hidden,created_at,updated_at FROM reviews WHERE order_id=?',orderId).first<Review>(),eligible:o.customer_id===u.id&&['COMPLETED','SETTLED'].includes(o.status)};},
  async writeReview(u:User,orderId:string,raw:unknown){roles(u,'CUSTOMER','ADMIN');const i=z.object({rating:z.number().int().min(1).max(5),body:text}).strict().parse(raw);const o=await s('SELECT * FROM orders WHERE id=?',orderId).first<Order>();if(!o||o.customer_id!==u.id)fail(403,'본인 주문에만 후기를 작성할 수 있습니다.');if(!['COMPLETED','SETTLED'].includes(o.status))fail(409,'작업 완료 확인 후 작성할 수 있습니다.');const b=await s('SELECT partner_id FROM bids WHERE id=?',o.selected_bid_id).first<{partner_id:string}>();if(!b)fail(409,'선택한 파트너가 없습니다.');if(await s('SELECT order_id FROM reviews WHERE order_id=?',orderId).first())fail(409,'이미 작성한 후기입니다.');await db.batch([guard("SELECT id FROM orders WHERE id=? AND status IN ('COMPLETED','SETTLED')",orderId),s('INSERT INTO reviews (order_id,partner_id,customer_id,rating,body,hidden,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)',orderId,b.partner_id,u.id,i.rating,i.body,now(),now()),audit(u,'REVIEW_CREATED',orderId,'완료한 작업 후기 작성')]);return {ok:true};},
  async reply(u:User,orderId:string,raw:unknown){await approved(u);const i=z.object({reply:text}).strict().parse(raw);const r=await s('SELECT partner_id FROM reviews WHERE order_id=?',orderId).first<{partner_id:string}>();if(r?.partner_id!==u.id)fail(403,'본인 업체의 후기에만 답변할 수 있습니다.');await db.batch([s('UPDATE reviews SET reply=?,updated_at=? WHERE order_id=? AND partner_id=?',i.reply,now(),orderId,u.id),audit(u,'REVIEW_REPLY',orderId,'파트너 답변 수정')]);return {ok:true};},
  async moderate(u:User,raw:unknown){roles(u,'ADMIN');const i=z.object({orderId:z.string().uuid(),hidden:z.boolean(),reason:text}).strict().parse(raw);await db.batch([guard('SELECT order_id FROM reviews WHERE order_id=?',i.orderId),s('UPDATE reviews SET hidden=?,updated_at=? WHERE order_id=?',Number(i.hidden),now(),i.orderId),audit(u,'REVIEW_MODERATION',i.orderId,(i.hidden?'비공개: ':'공개 복구: ')+i.reason)]);return {ok:true};},
  async reviewList(u:User){roles(u,'ADMIN');return (await s('SELECT order_id,partner_id,rating,body,reply,hidden,created_at,updated_at FROM reviews ORDER BY created_at DESC LIMIT 200').all<Review>()).results;},
  async posts(u?:User){if(u)roles(u,'ADMIN');return (await s('SELECT * FROM content_posts '+(u?'':'WHERE published=1 ')+'ORDER BY updated_at DESC LIMIT 100').all<Post>()).results;},
  async savePost(u:User,raw:unknown){roles(u,'ADMIN');const i=z.object({id:z.string().uuid(),kind:z.enum(['NOTICE','FAQ']),title:z.string().trim().min(3).max(100),body:z.string().trim().min(5).max(6000),published:z.boolean(),revision:z.number().int().nonnegative()}).strict().parse(raw);const old=await s('SELECT * FROM content_posts WHERE id=?',i.id).first<Post>();if((old?.revision??0)!==i.revision)fail(409,'다른 관리자가 수정했습니다. 다시 불러와 주세요.');await db.batch([...(old?[guard('SELECT id FROM content_posts WHERE id=? AND revision=?',i.id,i.revision)]:[]),old?s('UPDATE content_posts SET kind=?,title=?,body=?,published=?,revision=revision+1,updated_at=? WHERE id=?',i.kind,i.title,i.body,Number(i.published),now(),i.id):s('INSERT INTO content_posts VALUES (?,?,?,?,?,1,?,?)',i.id,i.kind,i.title,i.body,Number(i.published),now(),now()),audit(u,'CONTENT_SAVED',i.id,i.published?'공지/FAQ 게시':'공지/FAQ 비공개 저장')]);return {ok:true};},
  async settings():Promise<Settings>{return await s("SELECT accepting,notice,revision FROM operation_settings WHERE id='main'").first<Settings>()??{accepting:1,notice:'',revision:0};},
  async saveSettings(u:User,raw:unknown){roles(u,'ADMIN');const i=z.object({accepting:z.boolean(),notice:z.string().trim().max(300),revision:z.number().int().nonnegative(),reason:text}).strict().parse(raw);if(!i.accepting&&i.notice.length<5)fail(400,'접수 중단 사유를 고객에게 안내해 주세요.');const old=await this.settings();if(old.revision!==i.revision)fail(409,'설정이 변경됐습니다. 다시 불러와 주세요.');await db.batch([...(old.revision?[guard("SELECT id FROM operation_settings WHERE id='main' AND revision=?",i.revision)]:[]),old.revision?s("UPDATE operation_settings SET accepting=?,notice=?,revision=revision+1,updated_at=? WHERE id='main'",Number(i.accepting),i.notice,now()):s("INSERT INTO operation_settings VALUES ('main',?,?,1,?)",Number(i.accepting),i.notice,now()),audit(u,'OPERATION_SETTINGS','main',i.reason)]);return {ok:true};},
  async metrics(u:User):Promise<Metrics>{roles(u,'ADMIN');const n=async(sql:string)=>(await s(sql).first<{n:number}>())?.n??0;const [orders,partners,pendingPartners,reviewNeeded,unrouted,disputes,paid,refunded,settlementPaid,daily,statuses]=await Promise.all([n('SELECT COUNT(*) n FROM orders'),n("SELECT COUNT(*) n FROM partners WHERE status='APPROVED'"),n("SELECT COUNT(*) n FROM partners WHERE status='PENDING'"),n("SELECT COUNT(*) n FROM orders WHERE status='SUBMITTED' AND review_status='MANUAL_REVIEW' AND review_completed_at IS NULL"),n("SELECT COUNT(*) n FROM orders WHERE status='SUBMITTED' AND routing_status='UNDECIDED'"),n("SELECT COUNT(*) n FROM disputes WHERE status='OPEN'"),n("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE mode='live' AND status IN ('DONE','PARTIAL_CANCELED','CANCELED')"),n("SELECT COALESCE(SUM(refunded),0) n FROM payments WHERE mode='live' AND status IN ('DONE','PARTIAL_CANCELED','CANCELED')"),n("SELECT COALESCE(SUM(payable),0) n FROM settlements WHERE status='PAID'"),s('SELECT created_at FROM orders WHERE created_at>=? ORDER BY created_at',new Date(Date.now()-30*86400000).toISOString()).all<{created_at:string}>(),s('SELECT status,COUNT(*) count FROM orders GROUP BY status').all<{status:string;count:number}>()]);return {orders,partners,pendingPartners,reviewNeeded,unrouted,disputes,paid,refunded,net:paid-refunded,settlementPaid,daily:dailyCounts(daily.results),statuses:statuses.results};}
 };
}
