import { describe, expect, it } from 'vitest'
import { THEMES, themeAccent, defaultPageConfig, parsePageConfig, pageConfigSchema } from './company-page'

/**
 * 29-31: 고르게 해 놓은 값이 **쓸 수 있는 값인가**.
 *
 * 29-15 는 강조 색을 이름표로만 두었다("숲 초록"). 화면에 쓸 값이 없으니 고른 색이 아무 데도 나타나지
 * 않았고, 그래서 아무도 그것이 읽히는 색인지 확인하지 않았다. 값을 넣는 김에 **대비를 계산해서 지킨다** —
 * 파일 주석이 "대비를 미리 확인한 값들만"이라고 말해 온 것을 말로만 두지 않는다.
 */

/** WCAG 상대 휘도 */
function luminance(hex: string): number {
  const channel = (i: number): number => {
    const v = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/** 흰 바탕 대비 — 본문 글자 기준 4.5:1 이 하한이다 */
const contrastOnWhite = (hex: string): number => 1.05 / (luminance(hex) + 0.05)

describe('강조 색', () => {
  it('넷 다 흰 바탕에서 읽힌다 (대비 4.5:1 이상)', () => {
    for (const t of THEMES) {
      expect(t.accent, `${t.key} 는 #rrggbb 여야 한다`).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrastOnWhite(t.accent), `${t.key}(${t.accent}) 대비`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('고른 이름으로 값을 찾고, 모르는 이름이면 첫 색으로 버틴다', () => {
    expect(themeAccent('ocean')).toBe(THEMES.find((t) => t.key === 'ocean')?.accent)
    // 옛 저장본이나 손댄 값이 들어와도 화면이 색 없이 무너지지 않는다
    expect(themeAccent('없는색')).toBe(THEMES[0].accent)
  })

  it('고를 수 있는 이름은 이 넷뿐이다 — 스키마가 같은 표를 본다', () => {
    expect(pageConfigSchema.safeParse({ ...defaultPageConfig(), themeKey: 'neon' }).success).toBe(false)
    for (const t of THEMES) {
      expect(pageConfigSchema.safeParse({ ...defaultPageConfig(), themeKey: t.key }).success).toBe(true)
    }
  })
})

describe('영역 순서', () => {
  it('저장한 순서가 읽을 때 그대로 나온다 — 손님 화면이 이 순서로 그린다', () => {
    const config = {
      ...defaultPageConfig(),
      sections: [
        { kind: 'qna' as const, layout: 'card' as const },
        { kind: 'intro' as const, layout: 'photo' as const },
      ],
    }
    expect(parsePageConfig(JSON.stringify(config)).sections.map((s) => s.kind)).toEqual(['qna', 'intro'])
  })

  it('깨진 저장본은 기본 순서로 — 빈 화면보다 낫다', () => {
    expect(parsePageConfig('{').sections.map((s) => s.kind)).toEqual(['intro', 'portfolio', 'qna'])
    expect(parsePageConfig(null).sections).toHaveLength(3)
  })
})
