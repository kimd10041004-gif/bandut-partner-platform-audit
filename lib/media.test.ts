import { describe, expect, it } from 'vitest'
import { shownOnPage } from './media'

/**
 * 29-32: 공개본에 걸린 커버·로고를 공개로 칠지 가르는 순수 함수.
 *
 * 29-31 은 이 판단 자체가 없어서, 업체가 공개한 커버를 손님이 403 으로 못 받았다. 여기서 재는 것은
 * **열어 주는 조건**과 **열어 주지 않는 조건** 양쪽이다 — 못 읽는 설정 때문에 남의 사진이 열리면 더 나쁘다.
 */
describe('29-32: 공개본이 이 사진을 내걸고 있는가', () => {
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'

  it('커버로 걸려 있으면 공개다', () => {
    expect(shownOnPage(JSON.stringify({ coverAssetId: A, logoAssetId: null }), A)).toBe(true)
  })

  it('로고로 걸려 있어도 공개다', () => {
    expect(shownOnPage(JSON.stringify({ coverAssetId: null, logoAssetId: A }), A)).toBe(true)
  })

  it('걸려 있지 않으면 공개가 아니다 — 남의 사진이 열리지 않는다', () => {
    expect(shownOnPage(JSON.stringify({ coverAssetId: B, logoAssetId: B }), A)).toBe(false)
  })

  it('둘 다 비어 있으면 공개가 아니다', () => {
    expect(shownOnPage(JSON.stringify({ coverAssetId: null, logoAssetId: null }), A)).toBe(false)
  })

  it('깨진 저장본은 닫는다 — 못 읽는다고 열어 주지 않는다', () => {
    expect(shownOnPage('{', A)).toBe(false)
    expect(shownOnPage('null', A)).toBe(false)
    expect(shownOnPage('"문자열"', A)).toBe(false)
    expect(shownOnPage('[]', A)).toBe(false)
  })

  it('id 가 문자열이 아니면 닫는다', () => {
    expect(shownOnPage(JSON.stringify({ coverAssetId: 1, logoAssetId: true }), A)).toBe(false)
  })
})
