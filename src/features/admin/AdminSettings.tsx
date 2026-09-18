import { useState } from 'react'
import { downloadText } from '../../ui/download'
import { todayUTC, PlatformService, type BackupMode } from '../../domain/platform'
import { groupOf } from '../../domain/catalog'
import {
  DEFAULT_SETTINGS,
  DEFAULT_LANDING,
  LANDING_SECTION_LABEL,
  LANDING_DEFAULT_TITLE,
  cloneLanding,
} from '../../domain/platform'
import { ALL_CATEGORIES, type RepairCategory, type LandingLayout, type LandingSectionId } from '../../domain/types'
import { parseWonInput } from '../../domain/money'
import { usePlatform, useAdminCan, gradeHint } from '../../app/PlatformContext'
import { krw, isKnownError } from '../../ui/format'
import { Card, ToggleGroup } from '../../ui/primitives'
import OverwrittenBox from '../../ui/OverwrittenBox'

const RESTORE_CONFIRM = '복원'

/**
 * 데이터 백업 (28-58-01): 28-57까지 파트너 대시보드에 있던 전체 백업을 관리자 전용으로 옮겼다.
 * 복원은 플랫폼 전체 상태를 덮어쓰는 비가역 조작이라 확인 문구를 요구하고,
 * 감사 로그를 보존하는 `restoreBackup`(28-58-02)을 쓴다.
 */
function BackupCard({ onRestored }: { onRestored: () => void }) {
  const { platform, refresh } = usePlatform()
  const can = useAdminCan()
  // 28-89-A: 복원·되돌리기는 전체 상태를 덮어쓰는 비가역 조작 — 소유자만. 반출은 매니저부터.
  const mayDestroy = can('destructive')
  const mayExport = can('exportBackup')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mode, setMode] = useState<BackupMode>('pseudonymous')
  const armed = confirm.trim() === RESTORE_CONFIRM && mayDestroy

  // 28-59-01: 반출은 도메인 메서드로 — 감사 기록을 남기고 파일을 내려준다
  const doExport = () => {
    setErr('')
    const { json, chars } = platform.exportBackup(mode)
    const label = mode === 'pseudonymous' ? '가명본' : '원본'
    downloadText(
      `banded-backup${mode === 'pseudonymous' ? '-pseudonymous' : ''}-${todayUTC()}.json`,
      json,
      'application/json',
    )
    setMsg(`${label} 백업을 내려받았습니다 (${Math.round(chars / 1024)}KB) — 운영 기록에 남았습니다`)
    refresh()
  }

  const doImport = (file: File | undefined) => {
    setMsg('')
    setErr('')
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result)
        // 28-61-01: 가명본은 복원할 수 없다 — 직전 상태 백업을 만들기 전에 먼저 거른다
        if (PlatformService.isPseudonymousBackup(text)) {
          setErr('가명 처리된 백업은 복원할 수 없습니다 — 원본 백업 파일을 사용하세요')
          return
        }
        // 28-59-03: 복원 직전 상태를 먼저 파일로 내려 되돌릴 수단을 확보한다
        downloadText(`banded-before-restore-${todayUTC()}.json`, platform.exportData(), 'application/json')
        const { kept, ignored } = platform.restoreBackup(text)
        setMsg(
          `백업을 복원했습니다 — 운영 기록 ${kept}건 보존, 가져온 기록 ${ignored}건은 반영하지 않았습니다. 직전 상태는 banded-before-restore 파일로 내려받았고, 아래에서 바로 되돌릴 수 있습니다`,
        )
        setConfirm('')
        onRestored()
        refresh()
      } catch (e) {
        if (isKnownError(e)) setErr(e.message)
        else throw e
      }
    }
    reader.readAsText(file)
  }

  const doUndo = () => {
    setErr('')
    try {
      const { kept } = platform.undoRestore()
      setMsg(`직전 상태로 되돌렸습니다 — 운영 기록 ${kept}건 보존`)
      onRestored()
      refresh()
    } catch (e) {
      if (isKnownError(e)) setErr(e.message)
      else throw e
    }
  }

  return (
    <Card title="데이터 백업">
      <ToggleGroup
        label="백업 모드"
        value={mode}
        style={{ marginBottom: 8 }}
        options={(['pseudonymous', 'full'] as const).map((k) => ({
          value: k,
          label: k === 'pseudonymous' ? '가명본 (권장)' : '원본',
          data: { 'data-backup-mode': k },
        }))}
        onChange={setMode}
      />
      <div className="meta" style={{ marginBottom: 8 }} data-backup-mode-note>
        {mode === 'pseudonymous'
          ? '고객·파트너 이름을 가명으로 바꾸고 지역은 시·구까지만 남기며, 요청 내용·채팅·사진·운영 기록 상세는 제외합니다. 운영 분석·이관용이며 **복원에는 쓸 수 없습니다**(복원 시 거부됩니다).'
          : '고객 이름·요청 내용·사진·채팅이 평문으로 들어갑니다. 복원에 쓸 수 있지만 보관에 주의하세요.'}
      </div>
      <div className="row" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <button data-export-backup onClick={doExport} disabled={!mayExport}>
          JSON 내보내기
        </button>

        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={`복원하려면 "${RESTORE_CONFIRM}" 입력`}
          aria-label="복원 확인"
          style={{ maxWidth: 200 }}
        />
        <label
          className={`btn-secondary${armed ? '' : ' disabled'}`}
          style={{ cursor: armed ? 'pointer' : 'not-allowed' }}
          data-import-backup
        >
          백업 가져오기
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            disabled={!armed}
            onChange={(e) => doImport(e.target.files?.[0])}
          />
        </label>
      </div>
      {platform.canUndoRestore && (
        <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
          <button className="btn-secondary" onClick={doUndo} data-undo-restore disabled={!mayDestroy}>
            직전 상태로 되돌리기
          </button>
        </div>
      )}
      {!mayDestroy && (
        <div className="meta" style={{ marginTop: 6 }} data-grade-note>
          복원·되돌리기는 {gradeHint('destructive')}
        </div>
      )}
      <div className="meta" style={{ marginTop: 6 }}>
        내보내기·복원·되돌리기는 어느 모드로 했는지까지 운영 기록에 남습니다.
      </div>
      <div className="meta" style={{ marginTop: 4 }}>
        복원은 플랫폼 전체 상태를 덮어씁니다. 운영 기록(감사 로그)은 복원되지 않고 그대로 보존되며, 복원 직전 상태는
        파일로 내려받고 같은 세션 동안 되돌릴 수 있습니다.
      </div>
      {/* 28-75-04: 보관함은 역할 무관 부품이다 — 관리자·파트너·고객이 같은 것을 쓴다 */}
      <OverwrittenBox restoreHint="되살리려면 위의 복원 입력에 이 파일을 넣으세요" />
      {msg && (
        <div className="meta" style={{ marginTop: 6 }} data-backup-msg>
          {msg}
        </div>
      )}
      {err && (
        <div className="error" style={{ marginTop: 6 }} data-backup-error>
          {err}
        </div>
      )}
    </Card>
  )
}

/**
 * 첫 화면 배치 (28-89-B): 관리자가 코드 없이 섹션의 **순서·노출·제목**을 직접 바꾼다.
 * 히어로와 푸터는 고정이다(문구는 위 카드에서). 저장 전까지는 화면에 반영되지 않고,
 * 검증(여섯 섹션 정확히 한 번, 최소 하나 노출, 제목 60자)은 도메인이 한다.
 */
function LayoutCard({ onSaved, onError }: { onSaved: (msg: string) => void; onError: (msg: string) => void }) {
  const { platform, refresh } = usePlatform()
  const can = useAdminCan()
  const mayEdit = can('editSettings')
  const [layout, setLayout] = useState<LandingLayout>(() => cloneLanding(platform.getSettings().landing))
  const savedJson = JSON.stringify(platform.getSettings().landing)
  const dirty = JSON.stringify(layout) !== savedJson

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= layout.sections.length) return
    const sections = layout.sections.map((x) => ({ ...x }))
    const a = sections[index]
    const b = sections[target]
    if (a === undefined || b === undefined) return
    sections[index] = b
    sections[target] = a
    setLayout({ ...layout, sections })
  }
  const toggle = (id: LandingSectionId) => {
    setLayout({ ...layout, sections: layout.sections.map((x) => (x.id === id ? { ...x, visible: !x.visible } : x)) })
  }
  const setTitle = (id: LandingSectionId, value: string) => {
    const titles = { ...layout.titles }
    if (value === '') delete titles[id]
    else titles[id] = value
    setLayout({ ...layout, titles })
  }
  const save = () => {
    try {
      platform.updateSettings({ landing: layout })
      setLayout(cloneLanding(platform.getSettings().landing))
      onSaved('첫 화면 배치를 저장했습니다')
      refresh()
    } catch (e) {
      if (isKnownError(e)) onError(e.message)
      else throw e
    }
  }
  const reset = () => setLayout(cloneLanding(DEFAULT_LANDING))

  return (
    <Card title="첫 화면 배치">
      <div className="meta" style={{ marginBottom: 6 }} data-layout-card>
        고객이 보는 첫 화면의 섹션 순서·노출·제목을 바꿉니다. 히어로 문구는 위 카드에서 고칩니다. 저장을 눌러야
        반영됩니다.
      </div>
      {layout.sections.map((sec, i) => {
        const defaultTitle = LANDING_DEFAULT_TITLE[sec.id]
        return (
          <div
            key={sec.id}
            className={`layout-row${sec.visible ? '' : ' hidden'}`}
            data-layout-row={sec.id}
            data-layout-visible={sec.visible ? '1' : '0'}
          >
            <div className="layout-move">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => move(i, -1)}
                disabled={i === 0 || !mayEdit}
                aria-label={`${LANDING_SECTION_LABEL[sec.id]} 위로`}
                data-layout-up
              >
                ↑
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => move(i, 1)}
                disabled={i === layout.sections.length - 1 || !mayEdit}
                aria-label={`${LANDING_SECTION_LABEL[sec.id]} 아래로`}
                data-layout-down
              >
                ↓
              </button>
            </div>
            <div>
              <div className="layout-name">{LANDING_SECTION_LABEL[sec.id]}</div>
              {defaultTitle !== null && (
                <input
                  type="text"
                  value={layout.titles[sec.id] ?? ''}
                  placeholder={defaultTitle}
                  maxLength={60}
                  disabled={!mayEdit}
                  onChange={(e) => setTitle(sec.id, e.target.value)}
                  aria-label={`${LANDING_SECTION_LABEL[sec.id]} 제목`}
                  data-layout-title
                />
              )}
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={sec.visible}
                disabled={!mayEdit}
                onChange={() => toggle(sec.id)}
                aria-label={`${LANDING_SECTION_LABEL[sec.id]} 노출`}
                data-layout-toggle
              />
            </label>
          </div>
        )
      })}
      <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8, gap: 8 }}>
        <button onClick={save} disabled={!dirty || !mayEdit} data-layout-save>
          배치 저장
        </button>
        <button className="btn-secondary" onClick={reset} disabled={!mayEdit} data-layout-reset>
          기본 배치로
        </button>
        {!mayEdit && (
          <span className="meta" data-grade-note>
            배치 편집은 {gradeHint('editSettings')}
          </span>
        )}
      </div>
    </Card>
  )
}

/** 운영 설정 (28-21-02, 시안 3 CMS): 코드 수정 없이 고객 웹을 조작한다 — 저장 즉시 반영 */
export default function AdminSettings() {
  const { platform, refresh } = usePlatform()
  const settings = platform.getSettings()
  const [heroTitle, setHeroTitle] = useState(settings.heroTitle)
  const [heroSub, setHeroSub] = useState(settings.heroSub)
  const [notice, setNotice] = useState(settings.notice)
  // 약관·개인정보처리방침 본문 (28-37-02)
  const [terms, setTerms] = useState(settings.terms)
  const [privacy, setPrivacy] = useState(settings.privacy)
  const [faqQ, setFaqQ] = useState('')
  const [faqA, setFaqA] = useState('')
  // 질문 빌더 등록 폼 (28-26-04)
  const [qLabel, setQLabel] = useState('')
  const [qCategory, setQCategory] = useState<RepairCategory>(ALL_CATEGORIES[0]!)
  const [qOptions, setQOptions] = useState('')
  // 가격 패키지 등록 폼 (28-25-02)
  const [pkgName, setPkgName] = useState('')
  const [pkgCategory, setPkgCategory] = useState<RepairCategory>(ALL_CATEGORIES[0]!)
  const [pkgPrice, setPkgPrice] = useState('')
  const [pkgDesc, setPkgDesc] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // 28-59-03: 복원·되돌리기는 설정을 통째로 바꾼다 — 마운트 때 잡아둔 폼 상태를 다시 채운다
  const syncFromSettings = () => {
    const s = platform.getSettings()
    setHeroTitle(s.heroTitle)
    setHeroSub(s.heroSub)
    setNotice(s.notice)
    setTerms(s.terms)
    setPrivacy(s.privacy)
  }

  const apply = (fn: () => void, ok: string) => {
    setError('')
    setMessage('')
    try {
      fn()
      setMessage(ok)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  const toggleCategory = (c: (typeof ALL_CATEGORIES)[number]) => {
    const disabled = settings.disabledCategories.includes(c)
      ? settings.disabledCategories.filter((x) => x !== c)
      : [...settings.disabledCategories, c]
    apply(() => platform.updateSettings({ disabledCategories: disabled }), '카테고리 노출을 갱신했습니다')
  }

  const restore = () => {
    apply(() => {
      platform.updateSettings(DEFAULT_SETTINGS)
    }, '기본값으로 복원했습니다')
    setHeroTitle(DEFAULT_SETTINGS.heroTitle)
    setHeroSub(DEFAULT_SETTINGS.heroSub)
    setNotice(DEFAULT_SETTINGS.notice)
    setTerms(DEFAULT_SETTINGS.terms)
    setPrivacy(DEFAULT_SETTINGS.privacy)
  }

  return (
    <div>
      {error && (
        <div className="error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      {message && (
        <div className="meta" style={{ marginBottom: 8 }}>
          {message}
        </div>
      )}
      <Card title="서비스 카테고리 관리">
        <div className="meta">끄면 고객 웹(랜딩·작업 올리기)에서 숨겨집니다 — 최소 1개는 활성 유지.</div>
        <div style={{ marginTop: 6 }}>
          {ALL_CATEGORIES.map((c) => (
            <div key={c} className="toggle-row">
              <span className="t-label">
                {c} <span className="meta">{groupOf(c) ?? '상담'}</span>
              </span>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={!settings.disabledCategories.includes(c)}
                  onChange={() => toggleCategory(c)}
                  aria-label={`${c} 노출`}
                />
              </label>
            </div>
          ))}
        </div>
      </Card>
      <Card className="form" title="홈페이지 문구">
        <label className="form-wide">
          히어로 타이틀 (줄바꿈은 엔터)
          <textarea rows={2} value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} />
        </label>
        <label className="form-wide">
          히어로 서브 문구
          <textarea rows={2} value={heroSub} onChange={(e) => setHeroSub(e.target.value)} />
        </label>
        <label className="form-wide">
          공지 배너 (비우면 미표시)
          <input
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            placeholder="예: 추석 연휴 기간 방문 일정 안내"
          />
        </label>
        <button
          onClick={() =>
            apply(() => platform.updateSettings({ heroTitle, heroSub, notice }), '홈페이지 문구를 저장했습니다')
          }
        >
          문구 저장
        </button>
      </Card>
      <LayoutCard
        onSaved={(m) => {
          setError('')
          setMessage(m)
        }}
        onError={(m) => {
          setMessage('')
          setError(m)
        }}
      />
      <Card className="form" title="약관·개인정보처리방침">
        <div className="meta form-wide">
          가입 시 동의 대상이며 랜딩 푸터에 공개됩니다. 상용 개통 전 법무 검토본으로 교체하세요 — 비울 수 없습니다.
        </div>
        <label className="form-wide">
          이용약관 본문
          <textarea rows={8} value={terms} onChange={(e) => setTerms(e.target.value)} aria-label="이용약관 본문" />
        </label>
        <label className="form-wide">
          개인정보처리방침 본문
          <textarea
            rows={8}
            value={privacy}
            onChange={(e) => setPrivacy(e.target.value)}
            aria-label="개인정보처리방침 본문"
          />
        </label>
        <button
          onClick={() =>
            apply(() => platform.updateSettings({ terms, privacy }), '약관·개인정보처리방침을 저장했습니다')
          }
        >
          약관 저장
        </button>
      </Card>
      <Card title={`FAQ 관리 (${settings.faqs.length}건)`}>
        {settings.faqs.map((f, i) => (
          <div key={i} className="toggle-row">
            <div>
              <div className="t-label">Q. {f.q}</div>
              <div className="meta">{f.a}</div>
            </div>
            <button
              className="btn-danger"
              onClick={() =>
                apply(
                  () => platform.updateSettings({ faqs: settings.faqs.filter((_, j) => j !== i) }),
                  'FAQ를 삭제했습니다',
                )
              }
            >
              삭제
            </button>
          </div>
        ))}
        <div className="form" style={{ marginTop: 10 }}>
          <label>
            질문
            <input value={faqQ} onChange={(e) => setFaqQ(e.target.value)} placeholder="예: 결제는 언제 하나요?" />
          </label>
          <label>
            답변
            <input
              value={faqA}
              onChange={(e) => setFaqA(e.target.value)}
              placeholder="예: 작업 완료 확인 후 정산됩니다"
            />
          </label>
          <button
            onClick={() =>
              apply(() => {
                platform.updateSettings({ faqs: [...settings.faqs, { q: faqQ, a: faqA }] })
                setFaqQ('')
                setFaqA('')
              }, 'FAQ를 추가했습니다')
            }
          >
            FAQ 추가
          </button>
        </div>
      </Card>
      <Card title={`가격·패키지 관리 (${platform.listPackages().length}건)`}>
        <div className="meta">
          노출 중인 패키지는 고객 홈페이지 "표준 가격"에 정찰가로 표시됩니다. 카테고리를 끄면 해당 패키지도 자동으로
          숨겨집니다.
        </div>
        <div style={{ marginTop: 6 }}>
          {platform.listPackages().map((p) => (
            <div key={p.id} className="toggle-row pkg-row">
              <div>
                <div className="t-label">
                  <span className="svc-tag">{p.category}</span> {p.name} · <strong>{krw(p.price)}</strong>
                  {!p.active && <span className="meta"> (숨김)</span>}
                </div>
                {p.description && <div className="meta">{p.description}</div>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    apply(
                      () => platform.togglePackage(p.id),
                      p.active ? '패키지를 숨겼습니다' : '패키지를 노출했습니다',
                    )
                  }
                >
                  {p.active ? '숨김' : '노출'}
                </button>
                <button
                  className="btn-danger"
                  onClick={() => apply(() => platform.removePackage(p.id), '패키지를 삭제했습니다')}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="form" style={{ marginTop: 10 }}>
          <label>
            패키지 이름
            <input value={pkgName} onChange={(e) => setPkgName(e.target.value)} placeholder="예: 형광등 교체" />
          </label>
          <label>
            카테고리
            <select value={pkgCategory} onChange={(e) => setPkgCategory(e.target.value as RepairCategory)}>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            정찰 가격 (원)
            <input
              value={pkgPrice}
              onChange={(e) => setPkgPrice(e.target.value)}
              inputMode="numeric"
              placeholder="예: 30000"
            />
          </label>
          <label>
            설명 (선택)
            <input
              value={pkgDesc}
              onChange={(e) => setPkgDesc(e.target.value)}
              placeholder="예: LED 평판등 자재 포함"
            />
          </label>
          <button
            onClick={() =>
              apply(() => {
                platform.addPackage({
                  name: pkgName,
                  category: pkgCategory,
                  price: parseWonInput(pkgPrice),
                  description: pkgDesc,
                })
                setPkgName('')
                setPkgPrice('')
                setPkgDesc('')
              }, '패키지를 등록했습니다')
            }
          >
            패키지 등록
          </button>
        </div>
      </Card>
      <Card title={`질문 빌더 (${platform.listQuestions().length}건)`}>
        <div className="meta">
          작업 올리기 1단계에서 선택한 카테고리의 활성 질문이 표시됩니다. 답변은 파트너 일감 카드와 거래 상세에
          전달됩니다.
        </div>
        <div style={{ marginTop: 6 }}>
          {platform.listQuestions().map((q) => (
            <div key={q.id} className="toggle-row q-row">
              <div>
                <div className="t-label">
                  <span className="svc-tag">{q.category}</span> {q.label}
                  {!q.active && <span className="meta"> (숨김)</span>}
                </div>
                <div className="meta">{q.options ? `선택형: ${q.options.join(' / ')}` : '단답형'}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    apply(() => platform.toggleQuestion(q.id), q.active ? '질문을 숨겼습니다' : '질문을 노출했습니다')
                  }
                >
                  {q.active ? '숨김' : '노출'}
                </button>
                <button
                  className="btn-danger"
                  onClick={() => apply(() => platform.removeQuestion(q.id), '질문을 삭제했습니다')}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="form" style={{ marginTop: 10 }}>
          <label>
            질문
            <input
              value={qLabel}
              onChange={(e) => setQLabel(e.target.value)}
              placeholder="예: 샷시 재질은 무엇인가요?"
            />
          </label>
          <label>
            카테고리
            <select
              aria-label="질문 카테고리"
              value={qCategory}
              onChange={(e) => setQCategory(e.target.value as RepairCategory)}
            >
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="form-wide">
            선택지 (쉼표 구분, 비우면 단답형)
            <input
              value={qOptions}
              onChange={(e) => setQOptions(e.target.value)}
              placeholder="예: PVC, 알루미늄, 모름"
            />
          </label>
          <button
            onClick={() =>
              apply(() => {
                platform.addQuestion({
                  category: qCategory,
                  label: qLabel,
                  ...(qOptions.trim() !== '' ? { options: qOptions.split(',') } : {}),
                })
                setQLabel('')
                setQOptions('')
              }, '질문을 등록했습니다')
            }
          >
            질문 등록
          </button>
        </div>
      </Card>
      <BackupCard onRestored={syncFromSettings} />
      <Card title="초기화">
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <button className="btn-secondary" onClick={restore}>
            기본값 복원
          </button>
        </div>
      </Card>
    </div>
  )
}
