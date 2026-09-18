import type { Bid } from './model';

export const SUPPORT_THREAD = '__support__';
/**
 * 대화 커서의 상한 (29-25).
 *
 * `messages.seq` 는 Postgres 에서 `integer` 다 — 21억이 끝이다. 화면이 첫 장을 열 때 커서를 안 주므로
 * 서버가 대신 "가장 큰 수"를 넣는데, 그 자리에 `Number.MAX_SAFE_INTEGER`(9007조)를 두면
 * Postgres 가 **파라미터를 int4 로 못 바꿔서 질의 자체를 거절한다.** SQLite 는 받아 주기 때문에
 * 단위 테스트는 초록인 채로 운영에서만 대화방이 안 열렸다. 상한은 표의 상한과 같아야 한다.
 */
export const SEQ_MAX = 2_147_483_647;
export type ChatOption = Pick<Bid, 'id' | 'partner_id' | 'status' | 'company'>;
export const supportOption: ChatOption = { id: SUPPORT_THREAD, partner_id: SUPPORT_THREAD, status: 'SUPPORT', company: '반듯집수리 운영팀' };
