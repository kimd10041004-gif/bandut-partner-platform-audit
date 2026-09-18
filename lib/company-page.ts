/**
 * 업체 페이지 설정값 (29-15, 명세 5·6·11절).
 *
 * ## 왜 별도 파일인가
 *
 * 이 모양은 **서버와 화면이 같이 지켜야 한다.** 서버는 저장·공개 때 검사하고, 편집기는 같은 규칙으로
 * 화면을 그린다. 한 곳에 두지 않으면 둘이 조용히 어긋난다.
 *
 * ## 무엇을 담고 무엇을 안 담나
 *
 * 사례는 **복제하지 않는다.** `featuredPortfolioIds`에 ID만 둔다 — 사례를 고치면 페이지도 같이
 * 바뀌어야 하고, 복사본이 있으면 그 순간 둘이 갈라진다(명세 6절).
 *
 * 색상은 **고른다**. 자유 입력을 받으면 배경과 글자 대비가 무너져 읽을 수 없는 페이지가 나온다.
 * 대비를 미리 확인한 값들만 목록으로 둔다(명세 5절 "대비가 검증된 강조 색상 중 선택").
 *
 * 임의 HTML·스크립트·외부 주소는 설정값으로 받지 않는다(명세 6절). 이 파일에 그런 필드가 없다.
 */
import { z } from 'zod'

/**
 * 대비를 확인한 강조 색. 자유 입력을 받지 않는 이유가 이것이다.
 *
 * 29-31: **값까지 여기 둔다.** 29-15 에는 이름표뿐이어서 "고른 색"이 화면 어디에도 없었다 — 고르게만 하고
 * 쓰지 않은 것이다. 편집기 미리보기와 손님 화면이 같은 값을 쓰려면 한 곳에 있어야 한다.
 * 흰 바탕 위 글자로 쓰므로 명도 대비 4.5:1 을 넘어야 한다 — `company-page.test.ts` 가 넷 다 계산해서 지킨다.
 */
export const THEMES = [
  { key: 'forest', label: '숲 초록', accent: '#186b4b' },
  { key: 'ocean', label: '바다 파랑', accent: '#1b5f8f' },
  { key: 'clay', label: '흙 주황', accent: '#8a4a1d' },
  { key: 'slate', label: '차분한 회색', accent: '#44515c' },
] as const

/** 고른 색의 실제 값. 모르는 이름이면 첫 색 — 화면이 색 없이 무너지지 않는다 */
export function themeAccent(key: string): string {
  return (THEMES.find((t) => t.key === key) ?? THEMES[0]).accent
}

/** 영역 종류 — 이 넷 말고는 저장되지 않는다 */
export const SECTION_KINDS = ['intro', 'portfolio', 'qna'] as const

/** 사례를 늘어놓는 방식 (명세 5절: 큰 사진형 · 카드형 · 전후 비교형) */
export const LAYOUTS = ['photo', 'card', 'compare'] as const

export const PAGE_SCHEMA_VERSION = 1

export const pageConfigSchema = z
  .object({
    schemaVersion: z.literal(PAGE_SCHEMA_VERSION),
    themeKey: z.enum(THEMES.map((t) => t.key) as [string, ...string[]]),
    coverAssetId: z.string().uuid().nullable(),
    logoAssetId: z.string().uuid().nullable(),
    introText: z.string().trim().max(2000),
    /** 영역의 **순서**가 곧 화면의 순서다. 종류는 겹치지 않는다 */
    sections: z
      .array(
        z
          .object({
            kind: z.enum(SECTION_KINDS),
            layout: z.enum(LAYOUTS),
          })
          .strict(),
      )
      .min(1)
      .max(SECTION_KINDS.length)
      .refine((v) => new Set(v.map((s) => s.kind)).size === v.length, '같은 영역을 두 번 넣을 수 없습니다.'),
    /** 대표로 올릴 사례 — **ID만**. 사례 본문은 여기에 복사하지 않는다 */
    featuredPortfolioIds: z
      .array(z.string().uuid())
      .max(12)
      .refine((v) => new Set(v).size === v.length, {
        message: '같은 사례를 두 번 고를 수 없습니다.',
      }),
  })
  .strict()

export type PageConfig = z.infer<typeof pageConfigSchema>

/** 아직 아무것도 꾸미지 않은 업체가 보는 것. 빈 화면 대신 쓸 만한 기본값을 준다 */
export const defaultPageConfig = (): PageConfig => ({
  schemaVersion: PAGE_SCHEMA_VERSION,
  themeKey: 'forest',
  coverAssetId: null,
  logoAssetId: null,
  introText: '',
  sections: [
    { kind: 'intro', layout: 'card' },
    { kind: 'portfolio', layout: 'photo' },
    { kind: 'qna', layout: 'card' },
  ],
  featuredPortfolioIds: [],
})

/** 저장된 문자열을 설정으로 — 깨져 있으면 기본값. 화면이 무너지는 것보다 낫다 */
export function parsePageConfig(raw: string | null | undefined): PageConfig {
  if (raw === null || raw === undefined || raw === '') return defaultPageConfig()
  try {
    return pageConfigSchema.parse(JSON.parse(raw))
  } catch {
    return defaultPageConfig()
  }
}
