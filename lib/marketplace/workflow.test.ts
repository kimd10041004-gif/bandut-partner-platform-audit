import {describe,it,expect} from 'vitest';
import {nextAction} from './workflow';
import type {TradeData,Contract,Extra,Dispute} from '../trade-model';
const data=():TradeData=>({contracts:[],extras:[],schedules:[],completions:[],payments:[],refunds:[],disputes:[],settlement:null,commissionBps:300,slot:null,photos:[],provider:{ready:false,mode:'unconfigured'}});
const accepted={id:'c',status:'ACCEPTED',total:100000,deposit:0} as Contract;
describe('거래별 다음 할 일',()=>{
 it('고객은 제안된 계약 확인, 파트너는 고객 동의를 기다린다',()=>{const d={...data(),contracts:[{status:'PROPOSED'} as Contract]};expect(nextAction('BID_SELECTED','CUSTOMER',d).title).toContain('확인해');expect(nextAction('BID_SELECTED','PARTNER',d).title).toContain('기다립니다');});
 it('계약 준비 중에는 관리자의 수수료 확정이 먼저다',()=>{expect(nextAction('BID_SELECTED','ADMIN',{...data(),commissionBps:null}).title).toContain('수수료');});
 it('예약금 미결제는 연결 준비 상태를 정확하게 안내한다',()=>{const d={...data(),contracts:[{...accepted,deposit:10000}]};expect(nextAction('BID_SELECTED','CUSTOMER',d)).toMatchObject({tab:'payment',detail:expect.stringContaining('연결 준비')});});
 it('추가 작업 승인은 완료 요청보다 먼저 안내한다',()=>{expect(nextAction('IN_PROGRESS','CUSTOMER',{...data(),contracts:[accepted],extras:[{status:'PROPOSED'} as Extra]}).title).toContain('추가 작업');});
 it('완료 확인 후 미결제 잔금이 있으면 정산 대신 결제를 안내한다',()=>{expect(nextAction('COMPLETED','CUSTOMER',{...data(),contracts:[accepted]}).tab).toBe('payment');});
 it('정산 이후 접수된 분쟁도 최우선으로 표시한다',()=>{expect(nextAction('SETTLED','ADMIN',{...data(),disputes:[{status:'OPEN'} as Dispute]}).tab).toBe('dispute');});
 it('취소된 거래에 진행할 작업을 요청하지 않는다',()=>{expect(nextAction('CANCELLED','PARTNER',data()).title).toContain('종료');});
});
