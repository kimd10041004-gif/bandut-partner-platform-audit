/**
 * 진행 기록·변경 이력의 사람이 읽는 제목 (29-29).
 *
 * 29-28 실사용 점검에서 고객 화면의 진행 기록에 `COMPLETION_DECIDED` 같은 내부 코드가 그대로 찍히는 것을 봤다.
 * 옛 표(`components/marketplace/dashboard.tsx`)는 접수·입찰까지만 알았고, 28-95 이후 거래 이벤트가 열여덟 종류
 * 늘어나는 동안 아무도 표를 채우지 않았다. 표를 여기로 옮기고 `lib/audit-labels.test.ts` 가 소스에서 이벤트 이름을
 * 긁어 **빠진 것이 없는지** 본다 — 다음에 이벤트가 하나 늘면 게이트가 먼저 잡는다.
 */
export const AUDIT_LABELS: Record<string, string> = {
  // 접수·검토·입찰 (lib/service.ts)
  ORDER_SUBMITTED: '수리 요청 접수',
  SAFETY_REVIEW: '안전 검토 완료',
  ROUTING_DECIDED: '거래방식 확정',
  BID_SUBMITTED: '견적 제출',
  BID_UPDATED: '견적 수정',
  BID_SELECTED: '파트너 선택',
  ORDER_CANCELLED: '주문 취소',
  PARTNER_APPLICATION: '파트너 신청',
  PARTNER_APPROVED: '파트너 승인',
  PRESENTATION_SAVED: '화면·숫자 편집 저장',
  // 거래 (lib/trade.ts)
  COMMISSION_TERMS: '수수료 조건 확정',
  CONTRACT_PROPOSED: '계약서 제안',
  CONTRACT_DECIDED: '계약 결정',
  SCHEDULE_PROPOSED: '일정 변경 제안',
  SCHEDULE_DECIDED: '일정 결정',
  WORK_STARTED: '작업 시작',
  EXTRA_PROPOSED: '추가 작업 제안',
  EXTRA_DECIDED: '추가 작업 결정',
  COMPLETION_REQUESTED: '완료 확인 요청',
  COMPLETION_DECIDED: '작업 완료 확인',
  PAYMENT_PREPARED: '결제 준비',
  PAYMENT_CONFIRMING: '결제 확인 중',
  PAYMENT_EXPIRED: '결제 기한 만료',
  PAYMENT_RECONCILED: '결제 대조 완료',
  PAYMENT_STATUS_CHANGED: '결제 상태 변경',
  REFUND_REQUESTED: '환불 요청',
  DISPUTE_OPENED: '분쟁 접수',
  DISPUTE_RESOLVED: '분쟁 종결',
  TRADE_CANCELLED: '거래 취소',
  TRANSFER_RECORDED: '이체 기록',
  SETTLEMENT_APPROVE: '정산 승인',
  SETTLEMENT_HOLD: '정산 보류',
  SETTLEMENT_RECORD_TRANSFER: '정산 지급 기록',
}

/** 표에 없는 이름은 코드 대신 읽을 수 있는 모양으로 — `SOME_EVENT` → `Some event` */
export function auditLabel(action: string): string {
  const known = AUDIT_LABELS[action]
  if (known !== undefined) return known
  const words = action.toLowerCase().split('_').filter(Boolean)
  return words.length === 0
    ? action
    : words[0]!.charAt(0).toUpperCase() +
        words[0]!.slice(1) +
        words
          .slice(1)
          .map((w) => ' ' + w)
          .join('')
}
