import { z } from 'zod';
z.setErrorMap(issue=>({message:issue.code==='unrecognized_keys'?'허용되지 않는 입력 항목이 포함되어 있습니다.':issue.code==='too_small'?'필수 항목을 빠짐없이 작성해 주세요.':issue.code==='too_big'?'입력 가능한 길이 또는 금액을 초과했습니다.':'입력값의 형식을 다시 확인해 주세요.'}));
import { isValidDateStr, todayInKorea } from './marketplace/date';
import {categories,needsScopeReview,scopeReviewCodes} from './catalog';
export {categories,serviceGroups,needsScopeReview} from './catalog';
export const workCodes=categories.map(c=>c[0]);
export const districts: Record<string,string[]> = {
 서울:['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구'],
 부산:['강서구','금정구','기장군','남구','동구','동래구','부산진구','북구','사상구','사하구','서구','수영구','연제구','영도구','중구','해운대구'],
 대구:['군위군','남구','달서구','달성군','동구','북구','서구','수성구','중구'],
 인천:['강화군','계양구','남동구','동구','미추홀구','부평구','서구','연수구','옹진군','중구'],
 광주:['광산구','남구','동구','북구','서구'], 대전:['대덕구','동구','서구','유성구','중구'], 울산:['남구','동구','북구','울주군','중구'], 세종:['세종시'],
 경기:['가평군','고양시','과천시','광명시','광주시','구리시','군포시','김포시','남양주시','동두천시','부천시','성남시','수원시','시흥시','안산시','안성시','안양시','양주시','양평군','여주시','연천군','오산시','용인시','의왕시','의정부시','이천시','파주시','평택시','포천시','하남시','화성시'],
 강원:['강릉시','고성군','동해시','삼척시','속초시','양구군','양양군','영월군','원주시','인제군','정선군','철원군','춘천시','태백시','평창군','홍천군','화천군','횡성군'],
 충북:['괴산군','단양군','보은군','영동군','옥천군','음성군','제천시','증평군','진천군','청주시','충주시'], 충남:['계룡시','공주시','금산군','논산시','당진시','보령시','부여군','서산시','서천군','아산시','예산군','천안시','청양군','태안군','홍성군'],
 전북:['고창군','군산시','김제시','남원시','무주군','부안군','순창군','완주군','익산시','임실군','장수군','전주시','정읍시','진안군'], 전남:['강진군','고흥군','곡성군','광양시','구례군','나주시','담양군','목포시','무안군','보성군','순천시','신안군','여수시','영광군','영암군','완도군','장성군','장흥군','진도군','함평군','해남군','화순군'],
 경북:['경산시','경주시','고령군','구미시','김천시','문경시','봉화군','상주시','성주군','안동시','영덕군','영양군','영주시','영천시','예천군','울릉군','울진군','의성군','청도군','청송군','칠곡군','포항시'], 경남:['거제시','거창군','고성군','김해시','남해군','밀양시','사천시','산청군','양산시','의령군','진주시','창녕군','창원시','통영시','하동군','함안군','함양군','합천군'],
 제주:['서귀포시','제주시']
};
const won=z.number().int().min(0).max(100_000_000);
export const dateSchema=z.string().refine(v=>isValidDateStr(v)&&v>=todayInKorea(),'오늘 이후의 실제 날짜를 입력해 주세요.');
export const orderSchema=z.object({workItems:z.array(z.string().refine(v=>workCodes.includes(v as typeof workCodes[number]))).min(1).max(workCodes.length).refine(v=>new Set(v).size===v.length),description:z.string().trim().min(10,'작업 내용을 10자 이상 적어 주세요.').max(2000),region:z.string().refine(v=>Object.entries(districts).some(([a,ds])=>ds.some(d=>v===a+' '+d)),'전국 시·도와 시·군·구를 선택해 주세요.'),address:z.string().trim().min(5,'상세주소를 5자 이상 입력해 주세요.').max(200),phone:z.string().regex(/^01[016789]\d{7,8}$/,'연락처 숫자 10~11자리를 확인해 주세요.'),desiredDate:dateSchema.nullable(),budget:won.nullable(),answers:z.object({isLocked:z.boolean().nullable(),urgent:z.boolean().nullable(),ack:z.boolean()}).strict(),consent:z.literal(true)}).strict();
export type OrderInput=z.infer<typeof orderSchema>;
export function questions(workItems:string[]){return {lock:workItems.includes('LOCK')||workItems.includes('UNKNOWN'),urgent:workItems.some(v=>['PLUMBING','ELECTRIC','LOCK','UNKNOWN',...scopeReviewCodes].includes(v))};}
// Reimplementation of the supplied written rules; original intake v5 was absent.
export function safety(input:OrderInput){const q=questions(input.workItems); const a=input.answers;
 if((q.lock&&a.isLocked===null)||(q.urgent&&a.urgent===null))throw Error('INCOMPLETE: 안전 질문에 답해 주세요.');
 if((!q.lock&&a.isLocked!==null)||(!q.urgent&&a.urgent!==null))throw Error('질문 대상이 아닌 답변은 비워 주세요.');
 if((a.isLocked||a.urgent)&&!a.ack)throw Error('안전 안내 확인이 필요합니다.');
 if(a.isLocked===false&&/(문.{0,5}잠겨|잠겨.{0,5}못|못.{0,5}들어|갇혀)/.test(input.description))throw Error('RECHECK_REQUIRED: 문 잠김에 대한 설명과 답변을 다시 확인해 주세요.');
 if(a.urgent===false&&/(타는\s*냄새|가스\s*냄새|연기|감전|물이\s*계속|불꽃)/.test(input.description))throw Error('RECHECK_REQUIRED: 긴급 증상에 대한 설명과 답변을 다시 확인해 주세요.');
 if(!a.urgent&&!input.desiredDate)throw Error('희망 일정을 선택해 주세요.');
 return {reviewStatus:a.isLocked||a.urgent||input.workItems.includes('UNKNOWN')||needsScopeReview(input.workItems)?'MANUAL_REVIEW':'AUTO_PASS',flags:[...(a.isLocked?['LOCKOUT']:[]),...(a.urgent?['URGENT_SYMPTOM']:[]),...(needsScopeReview(input.workItems)?['WORK_SCOPE_REVIEW']:[])]};
}
export const bidSchema=z.object({laborCost:won,materialCost:won,transportCost:won,discount:won,included:z.string().trim().min(2).max(1000),excluded:z.string().trim().min(2).max(1000),message:z.string().trim().min(5).max(1000),availableDate:dateSchema,startHour:z.number().int().min(8).max(20),endHour:z.number().int().min(9).max(21)}).strict().refine(v=>v.endHour>v.startHour,'종료 시간은 시작 시간 이후여야 합니다.').refine(v=>new Date(v.availableDate+'T'+String(v.startHour).padStart(2,'0')+':00:00+09:00').getTime()>Date.now(),'방문 시작 시간은 현재 이후여야 합니다.');
export const partnerSchema=z.object({company:z.string().trim().min(2).max(80),representative:z.string().trim().min(2).max(40),phone:z.string().regex(/^01[016789]\d{7,8}$/),workItems:z.array(z.string().refine(v=>workCodes.includes(v as typeof workCodes[number]))).min(1),regions:z.string().trim().min(2).max(200),
 // 29-23: 승인하는 사람이 보는 표에 근거가 있어야 한다. 계정 쪽 값을 건너가서 읽으면
 // 둘이 어긋났을 때 어느 쪽이 맞는지 다툴 여지가 남는다.
 partnerType:z.enum(['business','individual'])}).strict();
export const statusLabels:Record<string,string>={SUBMITTED:'접수 완료',BIDDING:'견적 받는 중',BID_SELECTED:'파트너 선택 완료',SCHEDULED:'일정 확정',IN_PROGRESS:'작업 중',COMPLETION_REQUESTED:'완료 확인 요청',COMPLETED:'작업 완료',SETTLED:'정산 완료',CANCELLED:'취소',EXPIRED:'마감',DISPUTED:'분쟁 검토',AUTO_PASS:'안전 자동통과',MANUAL_REVIEW:'안전 수동검토',UNDECIDED:'거래방식 검토 전',DECIDED:'거래방식 확정',DIRECT:'직영',MARKETPLACE:'중개',SELECTED:'선택됨',REJECTED:'미선택',UPDATED:'수정됨',APPROVED:'승인',PENDING:'승인 대기',WITHDRAWN:'철회'};
