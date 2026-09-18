import type { PoolClient } from 'pg'

/**
 * 탈퇴를 막아야 하는 이유를 센다 (29-24).
 *
 * ## 왜 이 파일이 따로 있나
 *
 * `withdraw`(`server/domain/auth.ts`)는 비밀번호만 본다. 그럴 수밖에 없다 — 계정 도메인은 주문을 모르고,
 * 알게 만들면 안 된다. 그래서 **판단은 계정 쪽, 사실은 거래 쪽**에서 오도록 이 파일을 사이에 둔다.
 *
 * ## 막지 않으면 무슨 일이 생기나
 *
 * 계약금을 낸 고객이 탈퇴하면 `withdraw`가 이름과 번호를 즉시 지운다. 그런데 주문은 남는다 — 파트너는
 * 방문 일정이 잡힌 일감을 쥐고 있는데 연락할 사람이 없다. 파트너 쪽도 같다. 정산이 아직 안 끝났는데
 * 탈퇴하면 **받을 돈이 있는 사람이 사라진다.**
 *
 * 탈퇴를 거절하는 것이 불친절해 보일 수 있다. 그러나 여기서 통과시키면 그 대가를 **다른 사람**이 치른다.
 *
 * ## 무엇을 "진행 중"으로 보나
 *
 * 끝난 것은 `CANCELLED`(취소)와 `COMPLETED`(작업 완료) 둘이다. 나머지는 전부 누군가 기다리고 있는 상태다.
 * 작업이 끝났어도 **돈이 안 끝났으면** 끝난 것이 아니라서, 결제와 환불과 정산을 따로 센다.
 *
 * 관리자는 여기 오지 않는다 — 관리자 계정은 탈퇴가 아니라 소유자의 제거로 사라진다(28-89).
 */

/** 누군가 기다리고 있는 주문 상태 — 이 둘만 끝난 것이다 */
const SETTLED_ORDER = ['CANCELLED', 'COMPLETED']
/** 아직 결과가 안 난 결제 — 열어 둔 채 사라지면 대사할 수 없다 */
const OPEN_PAYMENT = ['READY', 'PROCESSING']
/** 지급이 끝난 정산 — 나머지는 파트너가 받을 것이 남아 있다는 뜻이다 */
const CLOSED_SETTLEMENT = ['PAID', 'NO_PAYOUT']

export interface ExitBlock {
  /** 화면과 봇이 이름으로 붙잡을 수 있게 — 문구가 바뀌어도 이것은 그대로다 */
  kind: 'ORDER' | 'PAYMENT' | 'REFUND' | 'SETTLEMENT'
  count: number
  message: string
}

/**
 * 한 줄 세기.
 *
 * 표가 없으면 **예외가 그대로 올라간다.** 0으로 바꾸지 않는다 — 스키마가 덜 선 서버에서
 * "막을 것이 없다"는 결론이 나오면, 이 문은 정확히 필요한 순간에 열려 버린다.
 * 못 세면 탈퇴를 거절하는 쪽이 맞다.
 */
async function count(c: PoolClient, sql: string, args: unknown[]): Promise<number> {
  const r = await c.query<{ n: string }>(sql, args)
  return Number(r.rows[0]?.n ?? 0)
}

/**
 * 이 계정이 지금 탈퇴할 수 있는가. 빈 목록이면 할 수 있다.
 *
 * `accountId`는 계정 ID 그대로다 — v17 `users.id`가 같은 값이다(`server/identity.ts`).
 */
export async function withdrawBlocks(
  c: PoolClient,
  role: 'customer' | 'partner',
  accountId: string,
): Promise<ExitBlock[]> {
  const blocks: ExitBlock[] = []

  if (role === 'customer') {
    const orders = await count(
      c,
      `select count(*) n from orders where customer_id = $1 and status <> all($2::text[])`,
      [accountId, SETTLED_ORDER],
    )
    if (orders > 0) {
      blocks.push({
        kind: 'ORDER',
        count: orders,
        message: `진행 중인 작업 요청이 ${orders}건 있습니다. 취소하거나 완료한 뒤에 탈퇴할 수 있습니다.`,
      })
    }
    const payments = await count(
      c,
      `select count(*) n from payments p join orders o on o.id = p.order_id
       where o.customer_id = $1 and p.status = any($2::text[])`,
      [accountId, OPEN_PAYMENT],
    )
    if (payments > 0) {
      blocks.push({
        kind: 'PAYMENT',
        count: payments,
        message: `결과가 확인되지 않은 결제가 ${payments}건 있습니다. 결제 상태를 먼저 확인해 주세요.`,
      })
    }
    const refunds = await count(
      c,
      `select count(*) n from refunds r join payments p on p.id = r.payment_id
       join orders o on o.id = p.order_id
       where o.customer_id = $1 and r.status = 'PENDING'`,
      [accountId],
    )
    if (refunds > 0) {
      blocks.push({
        kind: 'REFUND',
        count: refunds,
        message: `받지 않으신 환불이 ${refunds}건 있습니다. 환불이 끝난 뒤에 탈퇴할 수 있습니다.`,
      })
    }
    return blocks
  }

  // 파트너는 낙찰된 주문으로 이어진다 — 견적만 낸 것은 붙잡지 않는다(상대가 기다리고 있지 않다)
  const jobs = await count(
    c,
    `select count(*) n from orders o join bids b on b.id = o.selected_bid_id
     where b.partner_id = $1 and o.status <> all($2::text[])`,
    [accountId, SETTLED_ORDER],
  )
  if (jobs > 0) {
    blocks.push({
      kind: 'ORDER',
      count: jobs,
      message: `맡으신 작업이 ${jobs}건 남아 있습니다. 고객이 기다리고 있어 지금은 탈퇴할 수 없습니다.`,
    })
  }
  const settlements = await count(
    c,
    `select count(*) n from settlements where partner_id = $1 and status <> all($2::text[])`,
    [accountId, CLOSED_SETTLEMENT],
  )
  if (settlements > 0) {
    blocks.push({
      kind: 'SETTLEMENT',
      count: settlements,
      message: `지급이 끝나지 않은 정산이 ${settlements}건 있습니다. 정산을 받으신 뒤에 탈퇴해 주세요.`,
    })
  }
  return blocks
}
