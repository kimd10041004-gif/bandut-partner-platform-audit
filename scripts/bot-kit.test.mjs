import { describe, expect, it } from 'vitest'
import { PRODUCTION_HOSTS, refuseUnlessSafeTarget } from './bot-kit.mjs'

/**
 * 29-28: 운영 도메인이 생겼다. 계정을 만드는 봇이 그리로 향하면 **이름으로** 막혀야 한다 —
 * 도메인을 붙이면서 이 표를 빠뜨리면, 봇이 진짜 손님 옆에 계정을 만든다.
 */
const ok = { db: '', adminPassword: 'ci-admin-pass-1' }

describe('봇의 안전한 표적 (29-28)', () => {
  it('운영 주소 셋을 전부 거부한다 — vercel.app 기본 주소와 연결한 도메인 둘', () => {
    expect(PRODUCTION_HOSTS).toEqual([
      'bandut-partner-platform.vercel.app',
      'www.bandeutjipsuri.co.kr',
      'bandeutjipsuri.co.kr',
    ])
    for (const host of PRODUCTION_HOSTS) {
      expect(refuseUnlessSafeTarget({ ...ok, remote: `https://${host}` })).toMatch(/운영 주소입니다/)
    }
  })

  it('프리뷰(vercel.app)는 통과하고, 그 밖의 배포 주소는 프리뷰가 아니라고 거부한다', () => {
    expect(
      refuseUnlessSafeTarget({
        ...ok,
        remote: 'https://bandut-partner-platform-git-r-abc123-kimd10041004-gifs-projects.vercel.app',
      }),
    ).toBeNull()
    expect(refuseUnlessSafeTarget({ ...ok, remote: 'https://staging.bandeutjipsuri.co.kr' })).toMatch(
      /프리뷰 주소가 아닙니다/,
    )
  })

  it('로컬이면 DB 이름에 test 가 있어야 한다', () => {
    expect(refuseUnlessSafeTarget({ ...ok, remote: '', db: 'postgres://x@h/bandut_prod' })).toMatch(/test 가 없습니다/)
    expect(refuseUnlessSafeTarget({ ...ok, remote: '', db: 'postgres://x@h/bandut_e2e_test' })).toBeNull()
  })
})
