import { describe, it, expect } from 'vitest'
import {
  assertPseudonymousShape,
  PSEUDONYMOUS_STORED_ESTIMATE_KEYS,
  PSEUDONYMOUS_ESTIMATE_KEYS,
  PSEUDONYMOUS_BREAKDOWN_KEYS,
  PSEUDONYMOUS_JOB_KEYS,
  PSEUDONYMOUS_PAYOUT_KEYS,
  PSEUDONYMOUS_REQUEST_KEYS,
} from './platform'

/**
 * 28-65-01 회귀 테스트.
 *
 * 아래 두 경우는 28-65 코드에서 **통과했다**(감사 때 탐침으로 확인). 구조 검사가 각 행의
 * 최상위 키만 보고 값이 객체여도 그 안으로 들어가지 않았기 때문이다. 그래서 spec이
 * `estimate`·`payout`을 키로 허용하는 순간 그 안은 무방비였다.
 */
const ESTIMATES_SPEC = {
  keys: [...PSEUDONYMOUS_STORED_ESTIMATE_KEYS, 'estimate'],
  nested: { estimate: PSEUDONYMOUS_ESTIMATE_KEYS, breakdown: PSEUDONYMOUS_BREAKDOWN_KEYS },
} as const

const JOBS_SPEC = {
  keys: [...PSEUDONYMOUS_JOB_KEYS, 'payout'],
  nested: { payout: PSEUDONYMOUS_PAYOUT_KEYS },
} as const

describe('가명본 구조 검사 (28-65-01)', () => {
  it('중첩된 견적의 자유 서술 memo를 잡는다 — 28-62-01이 막았다고 선언한 필드', () => {
    const out = {
      estimates: [
        [
          'E-1',
          {
            breakdown: { subtotal: 1, vat: 0, total: 1, platformFee: 0, partnerPayout: 1 },
            revision: 1,
            submittedAt: '2026-01-01T00:00:00Z',
            estimate: { requestId: 'R-1', partnerId: 'P-1', memo: '고객 김하늘 010-1234-5678 자택' },
          },
        ],
      ],
    }
    expect(() => assertPseudonymousShape(out, [['estimates', ESTIMATES_SPEC]])).toThrow(/memo/)
  })

  it('중첩된 지급 기록의 예금주를 잡는다 — 28-61-02가 "자체 검사가 잡아낸 경로"라 적은 필드', () => {
    const out = {
      jobs: [
        {
          requestId: 'R-1',
          partnerId: 'P-1',
          completedDate: '2026-01-01',
          total: 1,
          platformFee: 0,
          settled: true,
          payout: { paidAt: '2026-01-02', amount: 1, holder: '박준서' },
        },
      ],
    }
    expect(() => assertPseudonymousShape(out, [['jobs', JOBS_SPEC]])).toThrow(/holder/)
  })

  it('중첩 허용 목록을 선언하지 않은 객체는 통과가 아니라 실패다', () => {
    const out = { jobs: [{ requestId: 'R-1', payout: { paidAt: 'x', amount: 1 } }] }
    expect(() => assertPseudonymousShape(out, [['jobs', ['requestId', 'payout']]])).toThrow(
      /중첩 허용 목록이 선언되지 않았습니다/,
    )
  })

  it('검사할 수 없는 형태의 행은 조용히 건너뛰지 않는다 — 28-64-02가 없앤 패턴의 재발 방지', () => {
    const out = { reviews: ['문자열 행'] }
    expect(() => assertPseudonymousShape(out, [['reviews', ['requestId']]])).toThrow(/검사할 수 없는 형태/)
  })

  it('점 경로로 중첩 컬렉션에 닿는다 (28-64-02)', () => {
    const out = { store: { requests: [{ id: 'R-1', customerName: '[가명] 고객1', 실명: '김하늘' }] } }
    expect(() => assertPseudonymousShape(out, [['store.requests', PSEUDONYMOUS_REQUEST_KEYS]])).toThrow(/실명/)
  })

  // ---- 28-66-01: 완전성 + fail-closed ----

  it('결과에 실리는데 spec이 없는 컬렉션을 잡는다 — daysOff가 그렇게 빠져 있었다', () => {
    const out = { daysOff: [['P-001', ['2026-01-01']]] }
    expect(() => assertPseudonymousShape(out, [])).toThrow(/daysOff.*허용 목록\(spec\)이 없습니다/)
  })

  it('spec이 선언된 daysOff는 통과하고, 값 배열에 객체가 섞이면 실패한다', () => {
    const ok = { daysOff: [['P-001', ['2026-01-01', '2026-01-02']]] }
    expect(() => assertPseudonymousShape(ok, [['daysOff', { pairOf: 'scalars' }]])).not.toThrow()
    // 휴무 사유 같은 필드가 붙는 날 — 조용히 사라지거나 조용히 새지 않는다
    const withReason = { daysOff: [['P-001', [{ date: '2026-01-01', reason: '김하늘 병원' }]]] }
    expect(() => assertPseudonymousShape(withReason, [['daysOff', { pairOf: 'scalars' }]])).toThrow(
      /객체가 들어 있습니다/,
    )
  })

  it('spec 경로를 결과에서 찾을 수 없으면 실패한다 — 검사가 조용히 사라지지 않는다', () => {
    // 경로 오타(notifcations)나 산출물 키 변경이 검사를 통째로 무력화하던 통로
    expect(() => assertPseudonymousShape({ notifications: [] }, [['notifcations', []]])).toThrow(/찾을 수 없습니다/)
  })

  it('최상위 [id, 레코드] 행의 나머지 원소도 검사한다 — row[1]만 보던 비대칭 제거', () => {
    const threeElement = {
      estimates: [['E-1', { revision: 1 }, { memo: '고객 김하늘 010-1234-5678' }]],
    }
    expect(() => assertPseudonymousShape(threeElement, [['estimates', ['revision']]])).toThrow(/두 원소여야 합니다/)
    const objectId = { estimates: [[{ 실명: '김하늘' }, { revision: 1 }]] }
    expect(() => assertPseudonymousShape(objectId, [['estimates', ['revision']]])).toThrow(/식별자가 스칼라가 아닙니다/)
  })

  it('스칼라·스칼라 배열은 spec 없이도 통과한다 — 실릴 내용이 없다', () => {
    const out = { version: 1, rev: 3, savedAt: '2026-01-01T00:00:00Z', pseudonymous: true, chats: [] }
    expect(() => assertPseudonymousShape(out, [])).not.toThrow()
  })

  it('컨테이너는 안쪽 spec으로 통과시키되 나머지 키를 마저 본다 (out.store)', () => {
    const ok = { store: { seq: 3, requests: [{ id: 'R-1' }] } }
    expect(() => assertPseudonymousShape(ok, [['store.requests', ['id']]])).not.toThrow()
    // store 안에 spec 없는 컬렉션이 새로 생기면 잡는다
    const extra = { store: { seq: 3, requests: [{ id: 'R-1' }], drafts: [{ memo: '김하늘' }] } }
    expect(() => assertPseudonymousShape(extra, [['store.requests', ['id']]])).toThrow(
      /store\.drafts.*허용 목록\(spec\)이 없습니다/,
    )
  })

  it('허용 목록을 지킨 결과는 통과한다', () => {
    const out = {
      estimates: [
        [
          'E-1',
          {
            breakdown: { subtotal: 1, vat: 0, total: 1, platformFee: 0, partnerPayout: 1 },
            revision: 1,
            submittedAt: '2026-01-01T00:00:00Z',
            estimate: { requestId: 'R-1', partnerId: 'P-1' },
          },
        ],
      ],
      jobs: [
        {
          requestId: 'R-1',
          partnerId: 'P-1',
          completedDate: '2026-01-01',
          total: 1,
          platformFee: 0,
          settled: true,
          payout: { paidAt: '2026-01-02', amount: 1 },
        },
      ],
    }
    expect(() =>
      assertPseudonymousShape(out, [
        ['estimates', ESTIMATES_SPEC],
        ['jobs', JOBS_SPEC],
      ]),
    ).not.toThrow()
  })
})
