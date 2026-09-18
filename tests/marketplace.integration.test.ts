import { describe,it,expect,beforeAll,afterAll,beforeEach } from 'vitest';
import { openTestDatabase,type TestDatabase } from './support/testDatabase';
import { marketplace } from '../lib/service';
import { partnerDocuments,DOCUMENT_KINDS } from '../lib/partner-documents';
import { safety,orderSchema,questions } from '../lib/policy';
import { calcEstimate } from '../lib/marketplace/estimate';
import type { Database,User,Order } from '../lib/model';
let t:TestDatabase;
let currentDb:Database;
async function fixture(){currentDb=await t.reset();return marketplace(currentDb);}
let svc:ReturnType<typeof marketplace>,admin:User,customer:User,otherCustomer:User,a:User,b:User;
const future=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
const input=()=>({workItems:['CURTAIN','FIXTURE'],description:'거실 커튼과 욕실 선반 설치가 필요합니다.',region:'서울 은평구',address:'테스트 도로 123 테스트호',phone:'01012345678',desiredDate:future,budget:300000,answers:{isLocked:null,urgent:null,ack:false},consent:true as const});
const bid=(overrides={})=>({laborCost:150000,materialCost:10000,transportCost:20000,discount:0,included:'설치와 뒷정리',excluded:'제품 구매',message:'방문 전 자재 규격 확인 부탁드립니다.',availableDate:future,startHour:9,endHour:11,...overrides});
const route={decision:'MARKETPLACE',reason:'작업 내용 확인 후 파트너 견적 모집'};
async function openOrder(){const {id}=await svc.createOrder(customer,input());await svc.route(admin,id,route);return id;}
beforeAll(async()=>{t=await openTestDatabase('marketplace');});afterAll(()=>t.close());
beforeEach(async()=>{svc=await fixture();admin=await svc.identity('owner','owner@example.test','관리자');await t.run("UPDATE users SET role='ADMIN' WHERE id=?",admin.id);admin.role='ADMIN';customer=await svc.identity('customer-a','ca@example.test','고객 A');otherCustomer=await svc.identity('customer-b','cb@example.test','고객 B');a=await svc.identity('partner-a','pa@example.test','파트너 A');b=await svc.identity('partner-b','pb@example.test','파트너 B');for(const p of [a,b]){await svc.registerPartner(p,{company:p.name,representative:'확인용 기술자',phone:'01012345678',workItems:['CURTAIN','FIXTURE'],regions:'서울·경기',partnerType:'individual'});await svc.approve(admin,p.id,{verified:true,reason:'독립 테스트용 신원 확인 완료'});}a=(await svc.identity(a.id,a.email,a.name));b=(await svc.identity(b.id,b.email,b.name));});
describe('분리 계정의 주문·복수 견적·낙찰',()=>{
 it('고객 A 접수 → 파트너 A/B 입찰 → B 선택 → 기록과 일정 저장',async()=>{const id=await openOrder();await svc.bid(a,id,bid());await svc.bid(b,id,bid({laborCost:140000}));const before=await svc.detail(customer,id);expect(before.bids).toHaveLength(2);const chosen=before.bids.find(v=>v.partner_id===b.id)!;await svc.select(customer,id,selection(chosen));const after=await svc.detail(customer,id);expect(after.order.status).toBe('BID_SELECTED');expect(after.bids.filter(v=>v.status==='SELECTED')).toHaveLength(1);expect(after.bids.find(v=>v.id===chosen.id)?.total).toBe(187000);expect(after.logs.some(v=>v.action==='BID_SELECTED')).toBe(true);expect(await t.all('SELECT * FROM schedule_slots')).toHaveLength(1);});
 it('다른 고객은 주문을 열거나 낙찰 선택할 수 없다',async()=>{const id=await openOrder();await svc.bid(a,id,bid());const d=await svc.detail(customer,id);await expect(svc.detail(otherCustomer,id)).rejects.toThrow();await expect(svc.select(otherCustomer,id,selection(d.bids[0]))).rejects.toThrow();});
 it('선택 전 주소·연락처·안전 응답은 파트너에게 제외된다',async()=>{const id=await openOrder();const d=await svc.detail(a,id);expect(d.order.address).toBeUndefined();expect(d.order.phone).toBeUndefined();expect(d.order.answers).toBe('{}');});
 it('선택된 B만 상세주소를 보고 A는 계속 제한된다',async()=>{const id=await openOrder();await svc.bid(a,id,bid());await svc.bid(b,id,bid());const d=await svc.detail(customer,id);await svc.select(customer,id,selection(d.bids.find(v=>v.partner_id===b.id)!));expect((await svc.detail(b,id)).order.address).toBe(input().address);expect((await svc.detail(a,id)).order.address).toBeUndefined();});
 it('견적 수정은 같은 행을 유지하고 금액·메시지를 다시 읽는다',async()=>{const id=await openOrder();await svc.bid(a,id,bid());await svc.bid(a,id,bid({laborCost:160000,message:'고객에게 전달할 수정한 메시지'}));const d=await svc.detail(a,id);expect(d.bids).toHaveLength(1);expect(d.bids[0].labor_cost).toBe(160000);expect(d.bids[0].message).toBe('고객에게 전달할 수정한 메시지');expect(d.bids[0].status).toBe('UPDATED');});
 it('파트너는 다른 파트너 견적을 조회할 수 없다',async()=>{const id=await openOrder();await svc.bid(a,id,bid());await svc.bid(b,id,bid());expect((await svc.detail(a,id)).bids.map(v=>v.partner_id)).toEqual([a.id]);});
 it('선택 후 다른 견적 수정과 재선택이 금지된다',async()=>{const id=await openOrder();await svc.bid(a,id,bid());await svc.bid(b,id,bid());const d=await svc.detail(customer,id);await svc.select(customer,id,selection(d.bids[0]));await expect(svc.bid(b,id,bid())).rejects.toThrow();await expect(svc.select(customer,id,selection(d.bids[1]))).rejects.toThrow();});
 it('모집 마감 후 입찰과 수정이 중지된다',async()=>{const id=await openOrder();await svc.bid(a,id,bid());await t.run('UPDATE orders SET deadline=? WHERE id=?','2000-01-01T00:00:00.000Z',id);await expect(svc.bid(a,id,bid())).rejects.toThrow();await expect(svc.bid(b,id,bid())).rejects.toThrow();});
 it('고객과 파트너는 관리자 결정 권한이 없다',async()=>{const {id}=await svc.createOrder(customer,input());await expect(svc.route(customer,id,route)).rejects.toThrow();await expect(svc.route(a,id,route)).rejects.toThrow();await expect(svc.createOrder(a,input())).rejects.toThrow();await expect(svc.bid(customer,id,bid())).rejects.toThrow();});
 it('거래방식은 확정 후 변경할 수 없다',async()=>{const id=await openOrder();await expect(svc.route(admin,id,{decision:'DIRECT',reason:'직영 방식으로 변경 요청'})).rejects.toThrow();expect((await svc.detail(customer,id)).order.routing_decision).toBe('MARKETPLACE');});
 it('취소된 접수를 거래방식 확정으로 다시 열 수 없다',async()=>{const {id}=await svc.createOrder(customer,input());await svc.cancel(customer,id,{reason:'일정 변경으로 취소합니다'});await expect(svc.route(admin,id,route)).rejects.toThrow();expect((await svc.detail(customer,id)).order.status).toBe('CANCELLED');});
 it('LOCKOUT은 안내 확인 후에도 수동검토, 신원 확인 전 모집 불가',async()=>{const {id}=await svc.createOrder(customer,{...input(),workItems:['LOCK','CURTAIN'],description:'잠긴 문과 커튼 설치를 확인해 주세요.',answers:{isLocked:true,urgent:false,ack:true}});await expect(svc.route(admin,id,route)).rejects.toThrow();await expect(svc.review(admin,id,{reason:'안내만 확인한 상태입니다',contactChecked:true,safetyDelivered:true,identityChecked:false})).rejects.toThrow();await svc.review(admin,id,{reason:'신원과 거주 여부를 직접 확인했습니다',contactChecked:true,safetyDelivered:true,identityChecked:true});await svc.route(admin,id,route);const d=await svc.detail(customer,id);expect(d.order.review_status).toBe('MANUAL_REVIEW');expect(d.order.review_completed_at).toBeTruthy();});
 it('일정이 겹치면 낙찰 전체를 취소하고 주문을 모집 중으로 보존',async()=>{const one=await openOrder(),two=await openOrder();await svc.bid(a,one,bid());await svc.bid(a,two,bid());await svc.select(customer,one,selection((await svc.detail(customer,one)).bids[0]));await expect(svc.select(customer,two,selection((await svc.detail(customer,two)).bids[0]))).rejects.toThrow();expect((await svc.detail(customer,two)).order.status).toBe('BIDDING');expect((await svc.detail(customer,two)).logs.filter(v=>v.action==='BID_SELECTED')).toHaveLength(0);});
 it('취소 후 일정이 해제되어 다른 요청을 선택할 수 있다',async()=>{const one=await openOrder(),two=await openOrder();await svc.bid(a,one,bid());await svc.bid(a,two,bid());await svc.select(customer,one,selection((await svc.detail(customer,one)).bids[0]));await svc.cancel(customer,one,{reason:'일정 변경으로 접수를 취소합니다'});await svc.select(customer,two,selection((await svc.detail(customer,two)).bids[0]));expect((await svc.detail(customer,two)).order.status).toBe('BID_SELECTED');});
 it('승인 대기 파트너는 일감 조회와 입찰을 할 수 없다',async()=>{const u=await svc.identity('new-partner','new@example.test','대기 파트너');await svc.registerPartner(u,{company:'대기 업체',representative:'테스트 기술자',phone:'01012345678',workItems:['CURTAIN'],regions:'서울',partnerType:'individual'});const p=await svc.identity(u.id,u.email,u.name);await expect(svc.orders(p,'jobs')).rejects.toThrow();});
 it('재조회와 새 서비스 인스턴스에서도 데이터가 유지된다',async()=>{const id=await openOrder();const d=await svc.detail(customer,id);const row=(await t.get<Order>('SELECT * FROM orders WHERE id=?',id))!;expect(row.id).toBe(d.order.id);expect(row.routing_status).toBe('DECIDED');});
});
describe('입력과 금액 정책',()=>{
 it('서울·경기 밖의 전국 주소도 접수한다',()=>{expect(orderSchema.safeParse({...input(),region:'부산 해운대구'}).success).toBe(true);expect(orderSchema.safeParse({...input(),region:'제주 서귀포시'}).success).toBe(true);});
 it('주문 접수 초기값은 null/UNDECIDED',async()=>{const {id}=await svc.createOrder(customer,input());const {order:o}=await svc.detail(customer,id);expect(o.routing_decision).toBeNull();expect(o.routing_status).toBe('UNDECIDED');});
 it('서버가 VAT와 총액을 재계산한다',async()=>{const id=await openOrder();await svc.bid(a,id,bid());const d=await svc.detail(customer,id);expect(d.bids[0].vat).toBe(18000);expect(d.bids[0].total).toBe(198000);});
 it('허용하지 않은 파생 필드는 접수하지 않는다',()=>{expect(orderSchema.safeParse({...input(),reviewStatus:'AUTO_PASS'}).success).toBe(false);});
 it('최소 견적과 안전 정수 범위를 확인한다',async()=>{const id=await openOrder();await expect(svc.bid(a,id,bid({laborCost:0,materialCost:0,transportCost:0}))).rejects.toThrow();expect(()=>calcEstimate({laborCost:Number.MAX_SAFE_INTEGER,materialCost:1,transportCost:0,discount:0,requestId:'x',partnerId:'x'})).toThrow();});
 it('복수 공종 질문 합집합과 미응답 검증',()=>{expect(questions(['LOCK','CURTAIN'])).toEqual({lock:true,urgent:true});expect(()=>safety({...input(),workItems:['LOCK']})).toThrow(/INCOMPLETE/);});
 it('설명과 안전 답변의 모순을 다시 확인한다',()=>{expect(()=>safety({...input(),workItems:['ELECTRIC'],description:'주방에서 타는 냄새가 나고 있습니다',answers:{isLocked:null,urgent:false,ack:false}})).toThrow(/RECHECK_REQUIRED/);});
 it('감사로그는 수정과 삭제 API 없이 DB에서도 보존된다',async()=>{await openOrder();await expect(t.run('DELETE FROM audit_logs')).rejects.toThrow();});
});

describe('접수 임시저장과 재시도',()=>{
 const draft=()=>({step:1,items:['CURTAIN'],locked:null,urgent:null,ack:false,description:'작성 중',city:'서울',district:'',address:'',phone:'',date:'',budget:''});
 it('불완전한 입력을 본인만 저장·조회하고 파트너 접근을 거부한다',async()=>{const key=crypto.randomUUID();const saved=await svc.saveDraft(customer,{id:key,revision:0,data:draft()});expect(saved.revision).toBe(1);expect((await svc.draft(customer))?.data.description).toBe('작성 중');expect(await svc.draft(otherCustomer)).toBeNull();await expect(svc.draft(a)).rejects.toThrow();await expect(svc.discardDraft(otherCustomer,{id:key,revision:1})).rejects.toThrow();});
 it('다른 탭의 예전 버전으로 덮어쓰거나 삭제할 수 없다',async()=>{const key=crypto.randomUUID();await svc.saveDraft(customer,{id:key,revision:0,data:draft()});await svc.saveDraft(customer,{id:key,revision:1,data:{...draft(),description:'새로 저장한 내용'}});await expect(svc.saveDraft(customer,{id:key,revision:1,data:draft()})).rejects.toThrow();await expect(svc.discardDraft(customer,{id:key,revision:1})).rejects.toThrow();expect((await svc.draft(customer))?.data.description).toBe('새로 저장한 내용');});
 it('보유기간이 지난 임시저장을 읽지 않으며 삭제한다',async()=>{const key=crypto.randomUUID();await svc.saveDraft(customer,{id:key,revision:0,data:draft()});await t.run('UPDATE request_drafts SET expires_at=?','2000-01-01T00:00:00.000Z');expect(await svc.draft(customer)).toBeNull();expect(await t.all('SELECT * FROM request_drafts')).toHaveLength(0);});
 it('접수 성공 후 임시저장을 제거하고 같은 요청 재전송은 같은 주문을 반환한다',async()=>{const key=crypto.randomUUID();await svc.saveDraft(customer,{id:key,revision:0,data:draft()});const first=await svc.createOrder(customer,input(),key);expect(await svc.draft(customer)).toBeNull();expect(await svc.createOrder(customer,input(),key)).toEqual(first);expect(await t.all('SELECT * FROM orders')).toHaveLength(1);expect(await t.all("SELECT * FROM audit_logs WHERE action='ORDER_SUBMITTED'")).toHaveLength(1);await expect(svc.saveDraft(customer,{id:key,revision:0,data:draft()})).rejects.toThrow();});
 it('이미 사용된 접수 번호의 내용 변경과 다른 계정 재사용을 차단한다',async()=>{const key=crypto.randomUUID();await svc.createOrder(customer,input(),key);await expect(svc.createOrder(customer,{...input(),budget:123000},key)).rejects.toThrow();await expect(svc.createOrder(otherCustomer,input(),key)).rejects.toThrow();expect(await t.all('SELECT * FROM orders')).toHaveLength(1);});
 it('접수 직후 늦게 도착한 임시저장도 DB에서 차단한다',async()=>{const key=crypto.randomUUID();await svc.createOrder(customer,input(),key);await expect(t.run('INSERT INTO request_drafts VALUES (?,?,?,?,?,?)',customer.id,key,JSON.stringify(draft()),1,new Date().toISOString(),future)).rejects.toThrow(/already submitted/);});
 it('파트너 홈은 모집 일감과 본인 입찰 작업을 포함하고 마감된 미참여 일감은 제외한다',async()=>{const own=await openOrder(),open=await openOrder(),closed=await openOrder();await svc.bid(a,own,bid());await svc.select(customer,own,selection((await svc.detail(customer,own)).bids[0]));await t.run('UPDATE orders SET deadline=? WHERE id=?','2000-01-01T00:00:00.000Z',closed);const list=await svc.orders(a,'overview');expect(list.map(o=>o.id).sort()).toEqual([own,open].sort());expect(list.find(o=>o.id===own)?.scheduled_date).toBeNull();});
});

describe('확장된 공간 서비스 접수',()=>{
 it('복수 공사 분야를 접수하고 작업 범위 검토 전에는 모집하지 않는다',async()=>{const v={...input(),workItems:['RENOVATION','WALL_FINISH','CARPENTRY'],answers:{isLocked:null,urgent:false,ack:false}};const {id}=await svc.createOrder(customer,v);const d=await svc.detail(customer,id);expect(d.order.review_status).toBe('MANUAL_REVIEW');expect(JSON.parse(d.order.answers).flags).toContain('WORK_SCOPE_REVIEW');await expect(svc.route(admin,id,route)).rejects.toThrow();await expect(svc.review(admin,id,{reason:'공사 조건을 확인했습니다',contactChecked:true,safetyDelivered:true,identityChecked:false})).rejects.toThrow();await svc.review(admin,id,{reason:'공사 범위와 필요한 전문성을 확인했습니다',contactChecked:true,safetyDelivered:true,identityChecked:false,scopeChecked:true});await svc.route(admin,id,route);expect((await svc.detail(customer,id)).order.status).toBe('BIDDING');});
 it('기존 7개 제한 없이 8개 이상의 분야를 함께 접수할 수 있다',async()=>{const items=['PLUMBING','ELECTRIC','HVAC','WALL_FINISH','FLOOR','CARPENTRY','WINDOW','KITCHEN_BATH','SMART_HOME'];const {id}=await svc.createOrder(customer,{...input(),workItems:items,answers:{isLocked:null,urgent:false,ack:false}});expect(JSON.parse((await svc.detail(customer,id)).order.work_items)).toHaveLength(9);});
 it('확장 공종은 해당 분야를 승인받은 파트너만 견적을 낼 수 있다',async()=>{const {id}=await svc.createOrder(customer,{...input(),workItems:['COMMERCIAL'],answers:{isLocked:null,urgent:false,ack:false}});await svc.review(admin,id,{reason:'상업공간 공사 범위와 자격을 확인했습니다',contactChecked:true,safetyDelivered:true,identityChecked:false,scopeChecked:true});await svc.route(admin,id,route);await expect(svc.bid(a,id,bid())).rejects.toThrow(/승인받은/);await svc.registerPartner(a,{company:a.name,representative:'공간 시공 파트너',phone:'01012345678',workItems:['COMMERCIAL'],regions:'서울·경기',partnerType:'individual'});await expect(svc.bid(a,id,bid())).rejects.toThrow();await svc.approve(admin,a.id,{verified:true,reason:'상업공간 전문 분야와 필요한 자격을 확인했습니다'});await svc.bid(a,id,bid());expect((await svc.detail(customer,id)).bids).toHaveLength(1);});
 it('기존 소규모 공종·LOCKOUT과 새 공종의 안전 질문을 함께 유지한다',()=>{expect(questions(['LOCK','RENOVATION'])).toEqual({lock:true,urgent:true});expect(()=>safety({...input(),workItems:['HVAC']})).toThrow(/INCOMPLETE/);const d=safety({...input(),workItems:['LOCK','RENOVATION'],answers:{isLocked:true,urgent:false,ack:true}});expect(d.reviewStatus).toBe('MANUAL_REVIEW');expect(d.flags).toEqual(expect.arrayContaining(['LOCKOUT','WORK_SCOPE_REVIEW']));});
});

it('빈 데이터베이스의 첫 가입자도 고객이며 기존 관리자 역할만 유지한다',async()=>{
 expect((await svc.identity(admin.id,'changed@example.test','변경된 표시명')).role).toBe('ADMIN');
 const fresh=await fixture();const visitor=await fresh.identity('first-visitor','first@example.test','첫 방문자');expect(visitor.role).toBe('CUSTOMER');await expect(fresh.partners(visitor)).rejects.toThrow();
});

function selection(b:{id:string;total:number;updated_at:string}){return {bidId:b.id,expectedTotal:b.total,expectedUpdatedAt:b.updated_at};}

it('고객이 비교 중인 견적이 바뀌면 이전 금액·일정으로 선택하지 못한다',async()=>{
 const id=await openOrder();await svc.bid(a,id,bid());const viewed=(await svc.detail(customer,id)).bids[0];await svc.bid(a,id,bid({laborCost:170000}));await expect(svc.select(customer,id,selection(viewed))).rejects.toThrow(/변경/);expect((await svc.detail(customer,id)).order.selected_bid_id).toBeNull();const latest=(await svc.detail(customer,id)).bids[0];await svc.select(customer,id,selection(latest));expect((await svc.detail(customer,id)).bids[0].status).toBe('SELECTED');
});

it('금액이 같은 견적이라도 작업 범위 변경 전의 선택은 거부한다',async()=>{
 const id=await openOrder();await svc.bid(a,id,bid());const first=(await svc.detail(customer,id)).bids[0];await svc.bid(a,id,bid({included:'설치만 포함하고 철거는 별도'}));await expect(svc.select(customer,id,selection(first))).rejects.toThrow(/변경/);
});

describe('사업자 파트너는 서류 없이 승인되지 않는다 (29-23)',()=>{
 /** 저장소는 바이트만 맡는다 — 이 시험의 대상은 승인 문이라 가짜로 충분하다 */
 const fakeStore=()=>{const files=new Map<string,{bytes:Uint8Array;contentType:string}>();return {async put(key:string,bytes:Uint8Array,contentType:string){files.set(key,{bytes,contentType});return {key};},async get(key:string){return files.get(key)??null;},async remove(key:string){files.delete(key);},files};};
 const register=async(u:User,partnerType:'business'|'individual')=>svc.registerPartner(u,{company:u.name,representative:'확인용 기술자',phone:'01012345678',workItems:['CURTAIN'],regions:'서울',partnerType});

 it('서류가 하나도 없으면 승인이 막히고, 둘 다 내면 열린다',async()=>{
  const u=await svc.identity('biz-partner','biz@example.test','사업자 파트너');
  await register(u,'business');
  await expect(svc.approve(admin,u.id,{verified:true,reason:'사업자 파트너 신원 확인 완료'})).rejects.toThrow(/사업자등록증/);
  expect((await svc.partners(admin)).find(v=>v.user_id===u.id)?.status).toBe('PENDING');

  const docs=partnerDocuments(currentDb,fakeStore());
  const partner=await svc.identity(u.id,u.email,u.name);
  await docs.submit(partner,{kind:DOCUMENT_KINDS[0],mime:'application/pdf',base64:Buffer.from('%PDF-1.4 사업자등록증').toString('base64')});
  // 한 장만으로도 아직 막힌다 — 둘을 요구한 것이 실제로 둘인지 본다
  await expect(svc.approve(admin,u.id,{verified:true,reason:'사업자 파트너 신원 확인 완료'})).rejects.toThrow(/출입국|사업자등록증/);

  await docs.submit(partner,{kind:DOCUMENT_KINDS[1],mime:'application/pdf',base64:Buffer.from('%PDF-1.4 출입국사실증명서').toString('base64')});
  await svc.approve(admin,u.id,{verified:true,reason:'사업자 파트너 신원 확인 완료'});
  expect((await svc.partners(admin)).find(v=>v.user_id===u.id)?.status).toBe('APPROVED');
 });

 it('개인 파트너는 서류 없이 그대로 승인된다',async()=>{
  const u=await svc.identity('solo-partner','solo@example.test','개인 파트너');
  await register(u,'individual');
  await svc.approve(admin,u.id,{verified:true,reason:'개인 파트너 신원 확인 완료'});
  expect((await svc.partners(admin)).find(v=>v.user_id===u.id)?.status).toBe('APPROVED');
 });
});
