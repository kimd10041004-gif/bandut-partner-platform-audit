import { describe, it, expect } from 'vitest'
import type { ComponentProps } from 'react'
import { renderToString } from 'react-dom/server'
import { PlatformContext } from '../../app/PlatformContext'
import Landing from './Landing'
import { PlatformService } from '../../domain/platform'

/**
 * 28-82-02: **화면을 실제로 렌더해서** 본다 — `react-dom/server`로 실제 컴포넌트를 문자열로 그린다.
 * 새 의존성은 없다(react-dom은 이미 있다). 28-91에 히어로 지표가 사라져 남은 것은 첫 화면 배치뿐이다.
 */
/** 컨텍스트가 요구하는 값 타입 — `never`로 뭉개지 않고 실제 대상 타입에서 끌어온다 (28-82 리뷰) */
type CtxValue = ComponentProps<typeof PlatformContext.Provider>['value']

function withPlatform(platform: PlatformService): string {
  // Landing이 실제로 쓰는 것은 `platform`뿐이다 — 나머지 필드는 이 테스트의 관심사가 아니라 부분 스텁이다
  const value = { platform, refresh: () => {} } as unknown as CtxValue
  return renderToString(
    <PlatformContext.Provider value={value}>
      <Landing onPostJob={() => {}} onBrowse={() => {}} />
    </PlatformContext.Provider>,
  )
}

/**
 * 28-89-B: 배치는 데이터다 — 관리자가 저장한 순서·노출·제목대로 **실제로 그려지는가**를 본다.
 * 도메인 테스트는 설정이 저장되는지까지만 보고, 여기서는 `renderSection`이 그것을 따르는지 본다.
 */
describe('첫 화면 배치 렌더링 (28-89-B)', () => {
  const order = (html: string) => [...html.matchAll(/data-landing-section="([a-z]+)"/g)].map((m) => m[1])

  it('기본 배치는 여섯 섹션이 기본 순서로 나온다', () => {
    const p = PlatformService.load({}).service
    expect(order(withPlatform(p))).toEqual(['categories', 'steps', 'services', 'packages', 'faq', 'cta'])
  })

  it('순서를 바꾸고 숨기면 그대로 따른다 — 숨긴 섹션은 DOM 에 없다', () => {
    const p = PlatformService.load({}).service
    p.updateSettings({
      landing: {
        sections: [
          { id: 'faq', visible: true },
          { id: 'cta', visible: true },
          { id: 'categories', visible: true },
          { id: 'steps', visible: false },
          { id: 'services', visible: false },
          { id: 'packages', visible: true },
        ],
        titles: {},
      },
    })
    const html = withPlatform(p)
    // 수정 전: 순서가 코드에 박혀 있어 설정과 무관하게 언제나 기본 순서였다
    expect(order(html)).toEqual(['faq', 'cta', 'categories', 'packages'])
    expect(html).not.toContain('간편한 4단계')
  })

  it('제목을 고치면 그 제목이, 비우면 기본 제목이 나온다', () => {
    const p = PlatformService.load({}).service
    p.updateSettings({
      landing: { ...p.getSettings().landing, titles: { faq: '궁금한 것들', categories: '무엇을 고칠까요?' } },
    })
    const html = withPlatform(p)
    expect(html).toContain('궁금한 것들')
    expect(html).not.toContain('자주 묻는 질문')
    expect(html).toContain('무엇을 고칠까요?')
    expect(html).toContain('표준 가격') // 손대지 않은 것은 기본 제목
  })
})
