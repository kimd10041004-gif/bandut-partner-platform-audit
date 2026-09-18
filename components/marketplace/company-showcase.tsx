'use client'
/**
 * 업체가 꾸민 것을 손님 화면에 얹는다 (29-31, 명세 5·6절).
 *
 * ## 왜 이 파일이 따로 있나
 *
 * 업체 상세(`community.tsx`)는 v17 원본이고 29-1부터 고치지 않는다 — 시안과 대조할 수 있어야 하기
 * 때문이다(`questions.tsx` 주석과 같은 이유). 그래서 **경로에서 조립하던 것을 여기로 옮겨** 공개본 순서대로
 * 늘어놓는다. v17 블록은 그대로 한 조각으로 쓴다.
 *
 * ## 무엇이 어디로 가나
 *
 * | 편집기의 영역 | 손님 화면의 블록 |
 * |---|---|
 * | `intro` 업체 소개 | v17 업체 상세(소개·작업사례·후기 탭) |
 * | `portfolio` 시공 사례 | **대표로 고른 사례**를 고른 배치로 |
 * | `qna` 공개 질문 | 공개 Q&A |
 *
 * 커버·로고·강조 색은 맨 위 배너에 쓴다. 사진은 29-30 에서 실제 라우트가 된
 * `/api/portfolio-photo/:id` 로 나간다 — 게시된 사례에 쓰인 사진이 아니어도 **공개본에 걸린 사진은
 * 손님이 봐야 하므로**, 그 판단은 서버(`lib/media.ts`)가 한다.
 *
 * ## 꾸미지 않은 업체는 그대로다
 *
 * 공개한 적이 없으면 29-15 이전과 똑같은 순서로 그린다(상세 → 상담 → 질문). 아무도 손해 보지 않는다.
 *
 * ## 아직 아쉬운 것
 *
 * `company/:id` 를 이 파일과 v17 블록이 **각각 한 번씩** 부른다(대표 사례의 제목·사진이 필요해서다).
 * 공개 읽기라 위험하지는 않지만 한 번이면 될 일이다 — v17 블록을 손대는 날 함께 접는다.
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { api } from '@/lib/client'
import { themeAccent, type PageConfig } from '@/lib/company-page'
import type { Case, Company } from '@/lib/community'
import { CompanyPage } from './community'
import { CompanyQuestions } from './questions'
import { ConsultButton } from './consult'

const LAYOUT_CLASS: Record<string, string> = { photo: 'layout-photo', card: 'layout-card', compare: 'layout-compare' }

export function CompanyShowcase({ id }: { id: string }) {
  const [config, setConfig] = useState<PageConfig | null>(null)
  const [cases, setCases] = useState<Case[]>([])

  useEffect(() => {
    let live = true
    // 공개본이 없거나 못 읽어도 화면은 선다 — 꾸미기는 덤이지 상세의 조건이 아니다
    api<{ config: PageConfig; published: boolean }>(`company/${encodeURIComponent(id)}/page`)
      .then((d) => live && setConfig(d.published ? d.config : null))
      .catch(() => live && setConfig(null))
    api<Company>(`company/${encodeURIComponent(id)}`)
      .then((c) => live && setCases(c.cases))
      .catch(() => live && setCases([]))
    return () => {
      live = false
    }
  }, [id])

  const detail = <CompanyPage id={id} />
  const consult = <ConsultButton companyId={id} />
  const qna = <CompanyQuestions companyId={id} />

  if (config === null) {
    return (
      <>
        {detail}
        {consult}
        {qna}
      </>
    )
  }

  // 고른 순서대로. 지워진 사례는 조용히 빠진다 — 공개 시점엔 있었어도 그 뒤에 지울 수 있다
  const featured = config.featuredPortfolioIds
    .map((caseId) => cases.find((c) => c.id === caseId))
    .filter((c): c is Case => c !== undefined)
  const layout = config.sections.find((s) => s.kind === 'portfolio')?.layout ?? 'card'

  const block = (kind: string) => {
    if (kind === 'intro') return detail
    if (kind === 'qna') return qna
    if (featured.length === 0) return null // 고른 사례가 없으면 빈 칸을 내걸지 않는다
    return (
      <section className={'panel company-featured ' + (LAYOUT_CLASS[layout] ?? 'layout-card')} data-company-featured>
        <h2>대표 시공 사례</h2>
        <div className="portfolio-grid">
          {featured.map((c) => (
            <article className="case-card" key={c.id} data-featured-case={c.id}>
              {c.asset_id !== null && (
                <Image unoptimized width={640} height={420} src={'/api/portfolio-photo/' + c.asset_id} alt={c.title} />
              )}
              <small className="teal">{c.region}</small>
              <h3>{c.title}</h3>
              <p className="description-text">{c.body}</p>
            </article>
          ))}
        </div>
      </section>
    )
  }

  return (
    <div
      className="company-showcase"
      data-company-showcase
      style={{ ['--company-accent' as string]: themeAccent(config.themeKey) }}
    >
      {(config.coverAssetId !== null || config.logoAssetId !== null) && (
        <section
          className={'company-banner' + (config.coverAssetId === null ? ' cover-less' : '')}
          data-company-banner
        >
          {config.coverAssetId !== null && (
            // alt 는 비운다 — 바로 아래 제목이 업체 이름을 말한다. 읽어 주는 화면에서 같은 말을 두 번 하지 않는다
            <Image
              unoptimized
              className="company-cover"
              width={1600}
              height={520}
              src={'/api/portfolio-photo/' + config.coverAssetId}
              alt=""
              data-company-cover
            />
          )}
          {config.logoAssetId !== null && (
            <Image
              unoptimized
              className="company-logo"
              width={120}
              height={120}
              src={'/api/portfolio-photo/' + config.logoAssetId}
              alt=""
              data-company-logo
            />
          )}
        </section>
      )}
      {consult}
      {config.sections.map((sec) => (
        <div key={sec.kind} data-showcase-section={sec.kind}>
          {block(sec.kind)}
        </div>
      ))}
    </div>
  )
}
