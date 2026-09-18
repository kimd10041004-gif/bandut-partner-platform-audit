export interface Estimate {
  requestId: string
  partnerId: string
  laborCost: number
  materialCost: number
  transportCost: number
  discount: number
  memo?: string
}

export interface EstimateBreakdown {
  subtotal: number
  vat: number
  total: number
  platformFee: number
  partnerPayout: number
}

export interface ScheduleSlot {
  id: string
  partnerId: string
  requestId: string
  date: string
  startHour: number
  endHour: number
}
