import { useState } from 'react'
import type { RepairCategory, DesiredTime, SafetyAnswers } from '../../domain/types'
import { PlatformService, todayUTC, ADDRESS_MIN } from '../../domain/platform'
import { assessSafety, safetyQuestions, EMPTY_SAFETY } from '../../domain/safety'
import { isValidDateStr } from '../../domain/date'
import { parseWonInput } from '../../domain/money'
import { usePlatform } from '../../app/PlatformContext'
import { takeDraftCategory } from '../../app/entry'
import CategoryPicker from '../../ui/CategoryPicker'
import RegionSelect from '../../ui/RegionSelect'
import { krw, isKnownError } from '../../ui/format'
import { Card, ToggleGroup } from '../../ui/primitives'
import PhotoStrip from '../../ui/PhotoStrip'
import { resizeImageFile } from '../../ui/image'
import { MAX_PHOTOS } from '../../domain/platform'
import type { RequestPhoto } from '../../domain/types'

const STEPS = ['작업 내용', '일정 선택', '희망 예산', '등록 확인'] as const

const BUDGET_RANGES = ['잘 모르겠어요', '30만원 이하', '30~50만원', '50~80만원', '80만원 이상', '직접 입력'] as const
type BudgetChoice = (typeof BUDGET_RANGES)[number]

/** 안전 질문 문구 (28-93) — 답이 "예"면 안내 확인을 받는다 */
const SAFETY_TEXT = {
  lock: '지금 문이 잠겨 들어갈 수 없는 상태인가요?',
  urgent: '타는 냄새·가스 냄새·연기·감전·물이 계속 새는 등 긴급 증상이 있나요?',
  ack: '긴급·잠김 상황은 먼저 안전을 확보해 주세요 — 가스는 밸브를 잠그고 환기, 전기는 차단기를 내리고, 누수는 계량기 밸브를 잠급니다. 위험하면 119에 먼저 연락하세요. 접수 뒤 관리자가 연락해 확인합니다.',
} as const

/** 수리 요청 4단계 위저드 (28-16-02, 시안 "작업 올리기"):
 *  ①작업 내용 → ②일정 선택 → ③희망 예산 → ④등록 확인 */
export default function CustomerRequest() {
  const { platform, auth, refresh } = usePlatform()
  // 28-32-02: 로그인한 고객 정보 자동 사용 — 이름을 다시 묻지 않는다
  const me = auth.sessionFor('customer')
  // 28-94: 상세 주소는 필수, 연락처는 계정 번호로 채우고 고칠 수 있다 — 둘 다 낙찰 파트너에게만 열린다
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState(() => auth.accountFor('customer')?.phone ?? '')
  const cats = platform.enabledCategories()
  const [step, setStep] = useState(0)
  // 28-93: 분야는 여럿 고를 수 있다 — 고른 순서대로, 첫 항목이 주 분야. 처음엔 비어 있다(히어로에서 고른 것만 실린다)
  const [categories, setCategories] = useState<RepairCategory[]>(() => {
    const drafted = takeDraftCategory()
    return drafted && platform.enabledCategories().includes(drafted) ? [drafted] : []
  })
  const toggleCategory = (c: RepairCategory) =>
    setCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
  const category = categories[0] ?? '분야를 모르겠어요'
  // 28-93: 안전 질문 — 분야 묶음이 정하는 질문만 묻고, 묻지 않는 답은 비운다
  const asked = safetyQuestions(categories)
  const [safetyRaw, setSafetyRaw] = useState<SafetyAnswers>(EMPTY_SAFETY)
  const safety: SafetyAnswers = {
    isLocked: asked.lock ? safetyRaw.isLocked : null,
    urgent: asked.urgent ? safetyRaw.urgent : null,
    ack: safetyRaw.ack,
  }
  const needsAck = safety.isLocked === true || safety.urgent === true
  const [region, setRegion] = useState('')
  const [description, setDescription] = useState('')
  // 28-48-02: 현장 사진 — 브라우저 리사이즈 후 보관, 최대 MAX_PHOTOS장
  const [photos, setPhotos] = useState<RequestPhoto[]>([])
  const [photoMsg, setPhotoMsg] = useState('')
  const addFiles = async (files: FileList | null) => {
    setPhotoMsg('')
    if (!files) return
    const room = MAX_PHOTOS - photos.length
    const picked = [...files].slice(0, room)
    if (files.length > room) setPhotoMsg(`사진은 최대 ${MAX_PHOTOS}장까지 첨부됩니다`)
    const next: RequestPhoto[] = []
    for (const f of picked) {
      try {
        next.push(await resizeImageFile(f))
      } catch (err) {
        // 28-67-04: `err instanceof Error`는 TypeError 같은 진짜 버그의 메시지까지 사용자에게 보였다.
        //   28-67이 ImageError를 만든 목적이 이 두 줄인데 정작 여기는 그대로였다(MyAccount만 조였다).
        if (!isKnownError(err)) throw err
        setPhotoMsg(err.message)
      }
    }
    if (next.length > 0) setPhotos((cur) => [...cur, ...next].slice(0, MAX_PHOTOS))
  }
  const [desiredDate, setDesiredDate] = useState(todayUTC())
  const [desiredTime, setDesiredTime] = useState<DesiredTime>('오후')
  // 28-43-03: 기본 마감일 자동(희망일 전날, 최대 3일 후) — 직접 고치면 유지
  const [bidDeadline, setBidDeadline] = useState(() => PlatformService.defaultBidDeadline(todayUTC(), todayUTC()))
  const [deadlineTouched, setDeadlineTouched] = useState(false)
  const [budgetChoice, setBudgetChoice] = useState<BudgetChoice>('잘 모르겠어요')
  const [budgetInput, setBudgetInput] = useState('')
  // 28-26-02: 카테고리 질문 답변 (질문 id → 답변, 선택 사항)
  const [answerMap, setAnswerMap] = useState<Record<string, string>>({})
  const questions = platform.questionsFor(categories)
  const setAnswer = (id: string, v: string) => setAnswerMap((m) => ({ ...m, [id]: v }))
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // 28-93: 접수 검토 예상 — 규칙 위반이면 문구, 아니면 결과
  const verdict = (() => {
    try {
      return { ok: true as const, ...assessSafety({ categories, description: description.trim(), answers: safety }) }
    } catch (err) {
      if (isKnownError(err)) return { ok: false as const, message: err.message }
      throw err
    }
  })()

  const validateStep = (): string => {
    if (step === 0) {
      if (categories.length === 0) return '작업 분야를 하나 이상 고르세요'
      if (region.trim() === '') return '방문 지역의 시·도와 시·군·구를 고르세요'
      if (address.trim().length < ADDRESS_MIN) return `상세 주소를 ${ADDRESS_MIN}자 이상 입력해 주세요`
      if (!/^010\d{7,8}$/.test(phone.replace(/[^0-9]/g, ''))) return '연락처는 010으로 시작하는 10~11자리여야 합니다'
      if (description.trim() === '') return '요청 내용을 입력하세요'
      if (!verdict.ok) return verdict.message
    }
    if (step === 1 && desiredDate < todayUTC()) {
      return `희망 방문일은 오늘(${todayUTC()}) 이후여야 합니다`
    }
    if (step === 2 && budgetChoice === '직접 입력' && budgetInput.trim() === '') {
      return '예산 금액을 입력하거나 범위를 선택하세요'
    }
    return ''
  }

  const next = () => {
    const v = validateStep()
    setError(v)
    if (v === '') setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }
  const prev = () => {
    setError('')
    setStep((s) => Math.max(s - 1, 0))
  }

  const submit = () => {
    setError('')
    setMessage('')
    try {
      platform.addRequest({
        customerName: me?.name ?? '고객',
        ...(me ? { customerId: me.accountId } : {}),
        region: region.trim(),
        address: address.trim(),
        phone,
        category,
        ...(categories.length > 1 ? { categories } : {}),
        safety,
        description: description.trim(),
        ...(photos.length > 0 ? { photos } : {}),
        desiredDate,
        desiredTime,
        ...(budgetChoice === '직접 입력'
          ? { budget: parseWonInput(budgetInput) }
          : budgetChoice !== '잘 모르겠어요'
            ? { budgetRange: budgetChoice }
            : {}),
        ...(bidDeadline !== '' ? { bidDeadline } : {}),
        ...(questions.some((q) => (answerMap[q.id] ?? '').trim() !== '')
          ? { answers: questions.map((q) => ({ question: q.label, answer: answerMap[q.id] ?? '' })) }
          : {}),
      })
      const held = verdict.ok && verdict.reviewStatus === 'MANUAL_REVIEW'
      setDescription('')
      setAddress('')
      setBudgetInput('')
      setBudgetChoice('잘 모르겠어요')
      setAnswerMap({})
      setSafetyRaw(EMPTY_SAFETY)
      setCategories([])
      setStep(0)
      setMessage(
        held
          ? '요청을 등록했습니다 — 관리자가 안전·작업 범위를 확인한 뒤 파트너에게 공개됩니다'
          : '요청을 등록했습니다 — 파트너의 견적이 도착하면 견적함에 표시됩니다',
      )
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  const budgetSummary = (() => {
    if (budgetChoice !== '직접 입력') return budgetChoice
    try {
      return budgetInput.trim() === '' ? '—' : krw(parseWonInput(budgetInput))
    } catch {
      return budgetInput
    }
  })()

  return (
    <div>
      <div className="wizard-steps">
        {STEPS.map((label, i) => (
          <div key={label} className={`wz-step ${i === step ? 'now' : ''} ${i < step ? 'done' : ''}`}>
            <span className="wz-dot">{i < step ? '✓' : i + 1}</span>
            <span className="wz-label">{label}</span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card className="form">
          <h3 style={{ margin: 0 }}>어떤 작업이 필요하세요?</h3>
          <div className="form-wide">
            <div className="meta" style={{ marginBottom: 6 }}>
              작업 분야 — 여러 개를 골라도 됩니다(처음 고른 것이 주 분야). 분야를 모르면 마지막 카드를 고르면 됩니다.
            </div>
            <CategoryPicker categories={cats} selected={categories} onPick={toggleCategory} multi />
            <div className="meta" data-picked-categories style={{ marginTop: 6 }}>
              {categories.length === 0 ? '선택한 분야 없음' : `선택한 분야: ${categories.join(' + ')}`}
            </div>
          </div>
          <div className="form-wide">
            <div className="meta" style={{ marginBottom: 6 }}>
              방문 지역 (필수) — 전국 17개 시·도에서 고릅니다. 파트너 선택 전에는 시·군·구까지만 보입니다.
            </div>
            <RegionSelect value={region} onChange={setRegion} />
          </div>
          <label className="form-wide">
            상세 주소 (필수, {ADDRESS_MIN}자 이상) — 낙찰된 파트너에게만 보입니다
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="예: 화곡로 12길 34, 101동 202호"
              aria-label="상세 주소"
            />
          </label>
          <label>
            연락처 — 낙찰된 파트너에게만 보입니다
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="numeric"
              placeholder="010-0000-0000"
              aria-label="요청 연락처"
            />
          </label>
          <label className="form-wide">
            요청 내용 (필수)
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="예: 거실 도배 시공, 방 2개 포함"
            />
          </label>
          <label className="form-wide">
            현장 사진 (선택, 최대 {MAX_PHOTOS}장 — 자동으로 줄여 저장됩니다)
            <input
              type="file"
              accept="image/*"
              multiple
              className="photo-input"
              aria-label="현장 사진"
              disabled={photos.length >= MAX_PHOTOS}
              onChange={(e) => {
                void addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <PhotoStrip photos={photos} onRemove={(id) => setPhotos((cur) => cur.filter((p) => p.id !== id))} />
            {photoMsg && <span className="meta">{photoMsg}</span>}
          </label>
          {(asked.lock || asked.urgent) && (
            <div className="form-wide safety-q" data-safety>
              <div className="meta" style={{ marginBottom: 6 }}>
                안전 확인 (필수) — 답에 따라 관리자가 먼저 연락드립니다
              </div>
              {(['lock', 'urgent'] as const)
                .filter((k) => asked[k])
                .map((k) => {
                  const key = k === 'lock' ? 'isLocked' : 'urgent'
                  const v = safety[key]
                  return (
                    <label key={k} className="q-item" data-safety-q={k}>
                      {SAFETY_TEXT[k]}
                      <ToggleGroup
                        label={SAFETY_TEXT[k]}
                        value={v === null ? '' : v ? '예' : '아니요'}
                        style={{ display: 'flex', gap: 6 }}
                        options={[
                          { value: '예', label: '예' },
                          { value: '아니요', label: '아니요' },
                        ]}
                        onChange={(next) => setSafetyRaw((cur) => ({ ...cur, [key]: next === '예' }))}
                      />
                    </label>
                  )
                })}
              {needsAck && (
                <label className="q-item safety-ack" data-safety-ack>
                  <span className="meta">{SAFETY_TEXT.ack}</span>
                  <span className="row" style={{ justifyContent: 'flex-start', gap: 6 }}>
                    <input
                      type="checkbox"
                      aria-label="안전 안내 확인"
                      checked={safety.ack}
                      onChange={(e) => setSafetyRaw((cur) => ({ ...cur, ack: e.target.checked }))}
                    />
                    안전 안내를 읽었고, 관리자 연락을 기다리겠습니다
                  </span>
                </label>
              )}
            </div>
          )}
          {questions.length > 0 && (
            <div className="form-wide">
              <div className="meta" style={{ marginBottom: 6 }}>
                더 정확한 견적을 위해 몇 가지만 알려주세요 (선택)
              </div>
              {questions.map((q) => (
                <label key={q.id} className="q-item">
                  {q.label}
                  {q.options ? (
                    <ToggleGroup
                      label={q.label}
                      deselectable
                      value={answerMap[q.id] ?? ''}
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
                      options={q.options.map((o) => ({ value: o, label: o }))}
                      onChange={(next) => setAnswer(q.id, next)}
                    />
                  ) : (
                    <input
                      value={answerMap[q.id] ?? ''}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                      placeholder="선택 입력"
                    />
                  )}
                </label>
              ))}
            </div>
          )}
        </Card>
      )}

      {step === 1 && (
        <Card className="form">
          <h3 style={{ margin: 0 }}>언제 방문하면 좋을까요?</h3>
          <label>
            희망 방문일
            <input
              type="date"
              value={desiredDate}
              onChange={(e) => {
                setDesiredDate(e.target.value)
                if (!deadlineTouched && isValidDateStr(e.target.value))
                  setBidDeadline(PlatformService.defaultBidDeadline(e.target.value, todayUTC()))
              }}
            />
          </label>
          <label>
            시간대
            <ToggleGroup
              label="희망 시간대"
              value={desiredTime}
              style={{ display: 'inline-flex', gap: 6 }}
              options={(['오전', '오후'] as const).map((t) => ({ value: t, label: t }))}
              onChange={(t) => setDesiredTime(t as typeof desiredTime)}
            />
          </label>
          <label>
            입찰 마감일
            <input
              type="date"
              value={bidDeadline}
              min={todayUTC()}
              onChange={(e) => {
                setDeadlineTouched(true)
                setBidDeadline(e.target.value)
              }}
              aria-label="입찰 마감일"
            />
            <span className="meta">
              기본값은 희망일 전날(최대 3일 후)입니다. 마감 후에는 파트너가 견적을 낼 수 없습니다.
            </span>
          </label>
        </Card>
      )}

      {step === 2 && (
        <Card className="form">
          <h3 style={{ margin: 0 }}>어느 정도의 금액을 생각하고 계세요?</h3>
          <div className="budget-options form-wide">
            {BUDGET_RANGES.map((b) => (
              <label key={b} className={`budget-option ${budgetChoice === b ? 'active' : ''}`}>
                <input type="radio" name="budget" checked={budgetChoice === b} onChange={() => setBudgetChoice(b)} />
                {b}
              </label>
            ))}
          </div>
          {budgetChoice === '직접 입력' && (
            <label>
              예산 (원)
              <input
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                inputMode="numeric"
                placeholder="예: 450000"
              />
            </label>
          )}
          <div className="meta form-wide">
            희망 예산은 참고용입니다. 실제 작업 금액은 선택하신 업체의 견적을 통해 결정됩니다.
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card title="아래 내용으로 작업을 등록할까요?">
          <div className="breakdown">
            <div>
              <strong>[{categories.join(' + ')}]</strong> {description || '—'}
            </div>
            <PhotoStrip photos={photos} />
            {verdict.ok && verdict.reviewStatus === 'MANUAL_REVIEW' && (
              <div className="meta" data-review-notice>
                이 요청은 관리자가 안전·작업 범위를 먼저 확인합니다. 확인이 끝나면 파트너에게 공개되고 알림을 드립니다.
              </div>
            )}
            <div className="meta">
              {me?.name ?? '고객'} · {region} {address}
            </div>
            <div className="meta">
              희망 일정: {desiredDate} {desiredTime}
              {bidDeadline && <> · 입찰 마감 {bidDeadline}</>}
            </div>
            <div className="meta">희망 예산: {budgetSummary}</div>
          </div>
        </Card>
      )}

      {error && (
        <div className="error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {message && (
        <div className="meta" style={{ marginTop: 8 }}>
          {message}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
        {step > 0 && (
          <button className="btn-secondary" onClick={prev}>
            이전
          </button>
        )}
        {step < STEPS.length - 1 && <button onClick={next}>다음</button>}
        {step === STEPS.length - 1 && <button onClick={submit}>입찰 시작하기</button>}
      </div>
    </div>
  )
}
