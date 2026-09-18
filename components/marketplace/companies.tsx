'use client'
/**
 * 업체 찾기 (29-13, 명세 4절).
 *
 * ## 로그인 없이 본다
 *
 * 이 화면과 업체 상세는 서버에서도 공개 경로다(`server/marketplaceApi.ts`). 둘러보는 사람에게
 * 먼저 로그인을 요구하면 아무도 업체를 볼 수 없고, 업체 페이지는 원래 공개하려고 만드는 것이다.
 * 질문 작성·상담 시작·작업 요청에서 로그인을 묻는다.
 *
 * ## 숫자를 만들어 내지 않는다
 *
 * 카드에 붙는 것은 **행에서 나온 것뿐**이다. 공개 사례 수는 실제 공개된 사례의 수이고, 별점은
 * 숨기지 않은 후기가 있을 때만 보인다. 후기가 없으면 "후기 없음"이라고 쓴다 — 0.0점을 붙이면
 * 나쁜 업체처럼 보이고, 그건 근거 없는 표시다.
 *
 * "시공 건수"라고 쓰지 않는다. 우리가 세는 것은 업체가 스스로 올린 공개 사례이지 완료한 공사가
 * 아니다. 이름이 정확해야 숫자가 정직해진다.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { api } from '@/lib/client'
import { categories, districts } from '@/lib/policy'
import { PageHeading } from './shell'

interface CompanyCard {
  user_id: string
  company: string
  representative: string
  work_items: string
  regions: string
  case_count: number
  rating: number | null
  review_count: number
}

/** `work_items`는 JSON 배열 문자열로 저장된다. 깨진 값이 화면을 무너뜨리지 않게 한다 */
function workLabels(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const label = new Map<string, string>(categories.map((c) => [c[0], c[1]]))
    return parsed.filter((v): v is string => typeof v === 'string').map((code) => label.get(code) ?? code)
  } catch {
    return []
  }
}

export function CompanyFinder() {
  const [region, setRegion] = useState('')
  const [work, setWork] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<CompanyCard[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams()
    if (region !== '') params.set('region', region)
    if (work !== '') params.set('work', work)
    if (q.trim() !== '') params.set('q', q.trim())
    setLoading(true)
    api<{ companies: CompanyCard[]; more: boolean }>('companies?' + params.toString())
      .then((d) => {
        setRows(d.companies)
        setMore(d.more)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [region, work, q])

  return (
    <div className="workspace">
      <PageHeading
        eyebrow="COMPANIES"
        title="업체 찾기"
        description="지역과 작업 분야로 찾아보세요. 관리자 승인을 받은 업체만 보입니다."
      />
      <div className="panel field-stack" role="search">
        <label className="field">
          지역
          <select value={region} onChange={(e) => setRegion(e.target.value)} data-company-region>
            <option value="">전국</option>
            {Object.keys(districts).map((sido) => (
              <option key={sido} value={sido}>
                {sido}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          작업 분야
          <select value={work} onChange={(e) => setWork(e.target.value)} data-company-work>
            <option value="">전체</option>
            {categories.map((c) => (
              <option key={c[0]} value={c[0]}>
                {c[1]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          업체 이름
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 반듯설비" data-company-search />
        </label>
      </div>

      {error !== '' && (
        <p className="error" role="alert" data-company-error>
          {error}
        </p>
      )}
      {loading && error === '' && <p className="small muted">찾는 중…</p>}
      {!loading && error === '' && rows.length === 0 && (
        <p className="small muted" data-company-empty>
          조건에 맞는 업체가 아직 없습니다. 지역이나 분야를 바꿔 보세요.
        </p>
      )}

      <ul className="card-list" data-company-list>
        {rows.map((c) => (
          <li key={c.user_id} className="panel" data-company-card={c.user_id}>
            <Link className="inline-link" href={`/companies/${encodeURIComponent(c.user_id)}`}>
              <strong>{c.company}</strong>
            </Link>
            <p className="small muted">{c.regions}</p>
            <p className="small">{workLabels(c.work_items).join(' · ')}</p>
            <p className="small muted">
              공개 사례 {c.case_count}건 ·{' '}
              {c.review_count > 0 && c.rating !== null
                ? `후기 ${c.review_count}건 · 평점 ${c.rating.toFixed(1)}`
                : '후기 없음'}
            </p>
          </li>
        ))}
      </ul>

      {more && (
        <p className="small muted" data-company-more>
          조건에 맞는 업체가 더 있습니다. 지역이나 분야를 좁혀 보세요.
        </p>
      )}
      {/* 아이콘을 문단에 그냥 놓으면 자기 줄을 차지한다 — Tailwind preflight 가 svg 를 블록으로 만든다.
          글자는 span 하나로 묶는다. 안 묶으면 링크가 별개의 플렉스 항목이 되어 또 떨어진다. */}
      <p className="small muted icon-line">
        <Search size={15} />
        <span>
          원하는 업체를 찾지 못하셨다면 요청을 올려 여러 업체의 견적을 받아 보실 수 있습니다.{' '}
          <Link className="inline-link" href="/request">
            작업 요청하기
          </Link>
        </span>
      </p>
    </div>
  )
}
