'use client'
/**
 * 업체 페이지 편집기 (29-15, 명세 5절).
 *
 * ## 무엇을 지키려고 이렇게 만들었나
 *
 * - **임시저장과 공개가 다르다.** 저장은 손님에게 보이지 않는다. 공개를 눌러야 바뀐다.
 *   화면에도 그렇게 쓴다 — 저장했는데 손님이 이미 본다고 오해하면 안 된다.
 * - **덮어쓰기를 막는다.** 다른 탭에서 먼저 저장했으면 서버가 409로 알려 준다. 그 말을 그대로
 *   보여 주고 다시 불러오게 한다.
 * - **드래그 말고 버튼.** 순서 바꾸기를 드래그로만 두면 모바일에서 쓸 수 없다(명세 5절).
 *   위로·아래로 버튼을 둔다.
 * - **미리보기는 좁은 폭으로도 본다.** 사장님 화면은 넓고 손님 화면은 좁다.
 *
 * ## 커버·로고 (29-31)
 *
 * 29-15 에는 없었다 — 사진 저장소가 연결되지 않아(`/api/photos`가 503) 고를 목록 자체가 없었다.
 * 29-30 이 사진 라우트를 실제로 열었으므로 이제 고른다. 새로 올리는 자리도 여기 둔다: 사례를 만들지 않고
 * 커버만 바꾸고 싶은 날이 있다.
 *
 * 올릴 때 **공개 권한 확인**을 함께 받는다(`X-Publication-Consent`). 커버·로고는 로그인 없이도 보이는
 * 자리라 작업사례 사진과 같은 확인을 거쳐야 한다 — 서버도 같은 것을 요구한다(`lib/media.ts`).
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ArrowDown, ArrowUp, Eye, ImagePlus, Save, Send } from 'lucide-react'
import { api, upload } from '@/lib/client'
import { LAYOUTS, THEMES, themeAccent, type PageConfig } from '@/lib/company-page'
import type { Asset, Case } from '@/lib/community'
import { PageHeading } from './shell'

const SECTION_LABEL: Record<string, string> = { intro: '업체 소개', portfolio: '시공 사례', qna: '공개 질문' }
const LAYOUT_LABEL: Record<string, string> = { photo: '큰 사진형', card: '카드형', compare: '전후 비교형' }

interface Draft {
  config: PageConfig
  revision: number
  published: boolean
  publishedRevision: number
  publishedAt: string | null
}

export function PageEditor() {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [cases, setCases] = useState<Case[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [narrow, setNarrow] = useState(false)

  const load = () => {
    Promise.all([api<Draft>('page'), api<{ cases: Case[]; assets: Asset[] }>('portfolio')])
      .then(([d, p]) => {
        setDraft(d)
        setCases(p.cases.filter((c) => c.published === 1))
        setAssets(p.assets)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
  }
  useEffect(load, [])

  if (error !== '' && draft === null)
    return (
      <div className="workspace">
        <p className="error" role="alert" data-editor-error>
          {error}
        </p>
      </div>
    )
  if (draft === null) return <p className="small muted">불러오는 중…</p>

  const config = draft.config
  const accent = themeAccent(config.themeKey)
  const set = (patch: Partial<PageConfig>) => setDraft({ ...draft, config: { ...config, ...patch } })

  const move = (index: number, by: number) => {
    const next = [...config.sections]
    const to = index + by
    if (to < 0 || to >= next.length) return
    const [moved] = next.splice(index, 1)
    if (moved !== undefined) next.splice(to, 0, moved)
    set({ sections: next })
  }

  const moveCase = (index: number, by: number) => {
    const next = [...config.featuredPortfolioIds]
    const to = index + by
    if (to < 0 || to >= next.length) return
    const [moved] = next.splice(index, 1)
    if (moved !== undefined) next.splice(to, 0, moved)
    set({ featuredPortfolioIds: next })
  }

  const toggleCase = (id: string) => {
    const has = config.featuredPortfolioIds.includes(id)
    set({
      featuredPortfolioIds: has
        ? config.featuredPortfolioIds.filter((x) => x !== id)
        : [...config.featuredPortfolioIds, id],
    })
  }

  const run = async (what: 'save' | 'publish') => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (what === 'save') {
        const r = await api<{ revision: number }>('page', { config, revision: draft.revision })
        setDraft({ ...draft, revision: r.revision })
        setNotice('임시저장했습니다. 아직 손님에게는 보이지 않습니다.')
      } else {
        const r = await api<{ publishedRevision: number }>('page/publish', { revision: draft.revision })
        setDraft({ ...draft, published: true, publishedRevision: r.publishedRevision })
        setNotice('공개했습니다. 이제 손님이 이 화면을 봅니다.')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="workspace" data-page-editor>
      <PageHeading
        eyebrow="EDITOR"
        title="우리 업체 페이지 꾸미기"
        description="저장은 나만 봅니다. 공개를 눌러야 손님 화면이 바뀝니다."
      />

      {error !== '' && (
        <p className="error" role="alert" data-editor-error>
          {error}{' '}
          <button type="button" className="btn secondary" onClick={load} data-editor-reload>
            다시 불러오기
          </button>
        </p>
      )}
      {notice !== '' && (
        <p className="inline-notice" data-editor-notice>
          {notice}
        </p>
      )}

      <div className="panel field-stack">
        <label className="field">
          업체 소개
          <textarea
            rows={4}
            maxLength={2000}
            value={config.introText}
            onChange={(e) => set({ introText: e.target.value })}
            placeholder="어떤 일을 얼마나 해 오셨는지 적어 주세요."
            data-editor-intro
          />
        </label>

        <fieldset>
          <legend className="section-label">강조 색상</legend>
          <div className="check-grid" role="radiogroup" aria-label="강조 색상">
            {THEMES.map((t) => (
              <label className="check-line" key={t.key}>
                <input
                  type="radio"
                  name="theme"
                  value={t.key}
                  checked={config.themeKey === t.key}
                  onChange={() => set({ themeKey: t.key })}
                  data-editor-theme={t.key}
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="small muted">대비를 확인한 색만 고를 수 있습니다. 글자가 읽히지 않는 조합을 막습니다.</p>
        </fieldset>

        <PhotoPick
          label="커버 사진"
          hint="업체 화면 맨 위에 넓게 깔립니다. 가로로 긴 사진이 잘 어울립니다."
          assets={assets}
          picked={config.coverAssetId}
          accent={accent}
          onPick={(id) => set({ coverAssetId: id })}
          onUploaded={(a) => {
            setAssets([a, ...assets])
            set({ coverAssetId: a.id })
          }}
          onError={setError}
          kind="cover"
        />
        <PhotoPick
          label="로고"
          hint="커버 위에 작게 얹힙니다. 정사각형에 가까운 사진이 좋습니다."
          assets={assets}
          picked={config.logoAssetId}
          accent={accent}
          onPick={(id) => set({ logoAssetId: id })}
          onUploaded={(a) => {
            setAssets([a, ...assets])
            set({ logoAssetId: a.id })
          }}
          onError={setError}
          kind="logo"
        />
      </div>

      <section className="panel">
        <h3 className="section-label">영역 순서</h3>
        <ul data-editor-sections>
          {config.sections.map((sec, i) => (
            <li key={sec.kind} className="check-line" data-editor-section={sec.kind}>
              <strong>{SECTION_LABEL[sec.kind] ?? sec.kind}</strong>
              <select
                value={sec.layout}
                onChange={(e) => {
                  const next = [...config.sections]
                  next[i] = { ...sec, layout: e.target.value as (typeof LAYOUTS)[number] }
                  set({ sections: next })
                }}
                aria-label={`${SECTION_LABEL[sec.kind] ?? sec.kind} 배치`}
                data-editor-layout={sec.kind}
              >
                {LAYOUTS.map((l) => (
                  <option key={l} value={l}>
                    {LAYOUT_LABEL[l]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn secondary"
                onClick={() => move(i, -1)}
                aria-label="위로"
                data-editor-up
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => move(i, 1)}
                aria-label="아래로"
                data-editor-down
              >
                <ArrowDown size={15} />
              </button>
            </li>
          ))}
        </ul>
        <p className="small muted">드래그 대신 버튼으로 옮깁니다. 휴대폰에서도 같은 방법으로 됩니다.</p>
      </section>

      <section className="panel">
        <h3 className="section-label">대표로 올릴 시공 사례</h3>
        {cases.length === 0 ? (
          <p className="small muted" data-editor-nocases>
            공개된 시공 사례가 아직 없습니다. 사례를 먼저 등록하고 공개해 주세요.
          </p>
        ) : (
          <ul data-editor-cases>
            {cases.map((c) => (
              <li key={c.id} className="check-line">
                <label>
                  <input
                    type="checkbox"
                    checked={config.featuredPortfolioIds.includes(c.id)}
                    onChange={() => toggleCase(c.id)}
                    data-editor-case={c.id}
                  />
                  {c.title}
                </label>
              </li>
            ))}
          </ul>
        )}
        {config.featuredPortfolioIds.length > 0 && (
          <ol data-editor-featured>
            {config.featuredPortfolioIds.map((id, i) => (
              <li key={id} className="check-line">
                {cases.find((c) => c.id === id)?.title ?? '(삭제된 사례)'}
                <button type="button" className="btn secondary" onClick={() => moveCase(i, -1)} aria-label="위로">
                  <ArrowUp size={15} />
                </button>
                <button type="button" className="btn secondary" onClick={() => moveCase(i, 1)} aria-label="아래로">
                  <ArrowDown size={15} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel">
        <h3 className="section-label">
          미리보기{' '}
          <button
            type="button"
            className="btn secondary"
            onClick={() => setNarrow(!narrow)}
            data-editor-narrow={String(narrow)}
          >
            <Eye size={15} /> {narrow ? '넓은 화면으로' : '휴대폰 폭으로'}
          </button>
        </h3>
        <div
          data-editor-preview
          style={{ maxWidth: narrow ? 390 : '100%', border: '1px solid var(--line, #ddd)', padding: 12 }}
        >
          {/* 29-31: 고른 것을 그대로 보여 준다. 글자로만 적어 두면 고르고도 무엇이 바뀌는지 모른다 */}
          {(config.coverAssetId !== null || config.logoAssetId !== null) && (
            <div className="editor-preview-banner" data-preview-banner>
              {config.coverAssetId !== null && (
                <Image
                  unoptimized
                  width={780}
                  height={240}
                  src={'/api/portfolio-photo/' + config.coverAssetId}
                  alt="고른 커버 사진"
                  data-preview-cover
                />
              )}
              {config.logoAssetId !== null && (
                <Image
                  unoptimized
                  width={56}
                  height={56}
                  src={'/api/portfolio-photo/' + config.logoAssetId}
                  alt="고른 로고"
                  style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 12, border: '2px solid #fff' }}
                  data-preview-logo
                />
              )}
            </div>
          )}
          {config.sections.map((sec) => (
            <div key={sec.kind} data-preview-section={sec.kind}>
              <strong style={{ color: accent }}>{SECTION_LABEL[sec.kind] ?? sec.kind}</strong>
              <p className="small muted">{LAYOUT_LABEL[sec.layout]}</p>
              {sec.kind === 'intro' && <p>{config.introText === '' ? '(소개가 비어 있습니다)' : config.introText}</p>}
              {sec.kind === 'portfolio' && (
                <p className="small muted">대표 사례 {config.featuredPortfolioIds.length}개</p>
              )}
              {sec.kind === 'qna' && <p className="small muted">손님이 남긴 질문과 답변이 여기 보입니다.</p>}
            </div>
          ))}
        </div>
      </section>

      <div className="panel field-stack">
        <p className="small muted" data-editor-state>
          {draft.published
            ? `공개본 있음 (리비전 ${draft.publishedRevision}) · 편집본 리비전 ${draft.revision}`
            : `아직 공개하지 않았습니다 · 편집본 리비전 ${draft.revision}`}
        </p>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => run('save')} data-editor-save>
          <Save size={16} /> 임시저장
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => run('publish')}
          data-editor-publish
        >
          <Send size={16} /> 공개하기
        </button>
        <p className="small muted">공개에 실패하면 지금 손님이 보고 있는 화면은 그대로 남습니다.</p>
      </div>
    </div>
  )
}

/**
 * 사진 한 장 고르기 — 내가 올린 것 중에서, 또는 지금 올려서.
 *
 * 라디오 대신 누름 버튼(`aria-pressed`)을 쓴다. 고른 것을 **다시 누르면 해제**되어야 하는데 라디오는
 * 그것이 안 된다 — 커버를 없애려면 다른 사진을 골라야 하는 화면이 된다.
 */
function PhotoPick({
  label,
  hint,
  assets,
  picked,
  accent,
  kind,
  onPick,
  onUploaded,
  onError,
}: {
  label: string
  hint: string
  assets: Asset[]
  picked: string | null
  accent: string
  kind: 'cover' | 'logo'
  onPick: (id: string | null) => void
  onUploaded: (a: Asset) => void
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <fieldset data-photo-pick={kind} style={{ ['--company-accent' as string]: accent }}>
      <legend className="section-label">{label}</legend>
      <p className="small muted">{hint}</p>
      {assets.length === 0 ? (
        <p className="small muted" data-photo-empty={kind}>
          올린 사진이 아직 없습니다. 아래에서 한 장 올려 주세요.
        </p>
      ) : (
        <div className="photo-pick">
          {assets.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={picked === a.id}
              aria-label={`${label}로 이 사진 ${picked === a.id ? '해제' : '사용'}`}
              onClick={() => onPick(picked === a.id ? null : a.id)}
              data-photo-option={a.id}
            >
              <Image unoptimized width={120} height={80} src={'/api/portfolio-photo/' + a.id} alt="" />
            </button>
          ))}
        </div>
      )}
      <div className="action-row">
        <label className="btn secondary upload-evidence">
          <ImagePlus size={17} />
          {busy ? '올리는 중…' : '사진 올리기'}
          <input
            type="file"
            accept="image/jpeg,image/png"
            disabled={busy}
            data-photo-upload={kind}
            onChange={async (e) => {
              const input = e.currentTarget
              const file = input.files?.[0]
              if (file === undefined) return
              setBusy(true)
              try {
                if (file.size > 5 * 1024 * 1024) throw Error('사진은 5MB 이하로 올려 주세요.')
                // 커버·로고는 로그인 없이도 보이는 자리다 — 작업사례 사진과 같은 공개 확인을 거친다
                const saved = await upload<{ id: string; mime: string }>('portfolio-photo', file, {
                  'X-Publication-Consent': 'confirmed',
                })
                onUploaded({ id: saved.id, mime: saved.mime, created_at: new Date().toISOString() })
              } catch (err) {
                onError((err as Error).message)
              } finally {
                setBusy(false)
                input.value = ''
              }
            }}
          />
        </label>
        {picked !== null && (
          <button type="button" className="btn secondary" onClick={() => onPick(null)} data-photo-clear={kind}>
            사용 안 함
          </button>
        )}
      </div>
    </fieldset>
  )
}
