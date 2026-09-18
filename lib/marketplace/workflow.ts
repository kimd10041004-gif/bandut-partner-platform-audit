import type {Role} from '../model';
import type {TradeData} from '../trade-model';
export type TradeTab='contract'|'work'|'payment'|'dispute'|'settlement';
export function nextAction(status:string,role:Role,d:TradeData):{tab:TradeTab;title:string;detail:string}{
 const next=(tab:TradeTab,title:string,detail:string)=>({tab,title,detail});
 if(status==='DISPUTED'||d.disputes.some(v=>v.status==='OPEN'))return next('dispute',role==='ADMIN'?'분쟁 내용을 검토해 주세요':'분쟁 검토가 진행 중입니다','접수 사유와 처리 기록을 확인하세요.');
 if(['CANCELLED','EXPIRED'].includes(status))return next('contract','종료된 거래입니다','확정했던 계약과 변경 기록을 확인할 수 있습니다.');
 if(status==='SETTLED')return next('settlement','정산이 종료되었습니다','정산 금액과 지급 기록을 확인하세요.');
 const c=d.contracts.find(v=>v.status==='ACCEPTED');
 if(!c){
  if(d.commissionBps===null)return next('contract',role==='ADMIN'?'수수료 조건을 확정해 주세요':'계약 준비 중입니다','관리자가 합의된 수수료 조건을 기록하면 계약서를 발행할 수 있습니다.');
  if(d.contracts.some(v=>v.status==='PROPOSED'))return next('contract',role==='CUSTOMER'?'도착한 계약서를 확인해 주세요':'고객의 계약 확인을 기다립니다','금액, 작업 범위, 일정과 취소·환불 조건을 확인하세요.');
  return next('contract',role==='PARTNER'?'견적을 계약서로 발행해 주세요':'파트너의 계약서를 기다립니다','예약금과 방문 일정을 포함한 계약 조건을 확정합니다.');
 }
 const paid=(kind:string,target?:string)=>d.payments.some(p=>p.kind===kind&&(!target||p.target_id===target)&&['DONE','PARTIAL_CANCELED','CANCELED'].includes(p.status));
 if(d.payments.some(p=>p.status==='PROCESSING'))return next('payment','결제 결과를 확인해 주세요','결제를 다시 요청하기 전에 결제사 처리 상태를 확인하세요.');
 if(c.deposit>0&&!paid('DEPOSIT'))return next('payment',role==='CUSTOMER'?'예약금 결제를 확인해 주세요':'예약금 확인을 기다립니다',d.provider.ready?'계약서의 예약금과 결제 내역을 확인하세요.':'결제사 연결 준비 중입니다. 현재 카드 결제를 진행할 수 없습니다.');
 if(role==='CUSTOMER'&&d.schedules.some(v=>v.status==='PROPOSED'))return next('contract','일정 변경 요청이 도착했습니다','승인하기 전까지 기존 방문 일정이 유지됩니다.');
 if(d.extras.some(v=>v.status==='PROPOSED'))return next('work',role==='CUSTOMER'?'추가 작업 내용을 확인해 주세요':'추가 작업 승인을 기다립니다','고객 승인 전에는 추가 작업을 진행하지 않습니다.');
 if(status==='COMPLETION_REQUESTED')return next('work',role==='CUSTOMER'?'작업 결과를 확인해 주세요':'고객의 완료 확인을 기다립니다','작업 전·후 사진과 결과를 확인하고 필요한 보완 내용을 남기세요.');
 if(status==='COMPLETED'){
  const unpaid=(c.total>c.deposit&&!paid('BALANCE'))||d.extras.some(e=>e.status==='APPROVED'&&!paid('EXTRA',e.id));
  if(unpaid)return next('payment',role==='CUSTOMER'?'남은 결제 내역을 확인해 주세요':'잔금·추가 작업 결제를 기다립니다',d.provider.ready?'고객이 승인한 작업 금액을 기준으로 결제합니다.':'결제사 연결 준비 중입니다. 현재 카드 결제를 진행할 수 없습니다.');
  return next('settlement',role==='ADMIN'?(d.settlement?.status==='APPROVED'?'실제 이체 내역을 확인해 주세요':'정산을 검토해 주세요'):'정산 진행 상황을 확인하세요','결제·환불과 계약 수수료를 반영합니다. 실제 송금은 별도로 진행합니다.');
 }
 if(status==='IN_PROGRESS')return next('work',role==='PARTNER'?'작업 결과와 사진을 남겨 주세요':'작업이 진행 중입니다','작업이 끝나면 파트너가 완료 확인을 요청합니다.');
 return next('work',role==='PARTNER'?'방문 일정과 작업을 확인하세요':'방문 준비를 확인하세요','예약금이 필요한 경우 결제 확인 후, 확정된 방문 시각부터 작업을 시작할 수 있습니다.');
}
