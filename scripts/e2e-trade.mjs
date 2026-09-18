/**
 * 거래 한 바퀴를 세 사람이 걸어 본다 (29-25).
 *
 * ## 왜 또 봇인가
 *
 * `e2e:roles`(29-22)는 **화면과 권한**을 잰다. 주소 열다섯 장이 각자에게 어떻게 답하는지, 상담
 * 채팅이 창을 건너가는지. `e2e:signup`(29-18)은 **가입에서 승인까지**를 잰다.
 *
 * 그 사이에 아무도 안 걸어 본 구간이 있다 — **접수부터 정산까지.** 견적을 내고, 낙찰하고,
 * 계약서를 주고받고, 작업을 끝내고, 돈을 정산하는 그 줄이다. 이 플랫폼이 하는 일의 본체인데
 * 브라우저로 끝까지 몰아 본 적이 없다.
 *
 * ## 이 봇이 재는 것
 *
 * 걸음마다 셋을 본다.
 *
 * **하나. 그 걸음의 주인만 누를 수 있다.** 관리자가 할 일을 파트너가 할 수 없어야 한다.
 * **둘. 아직 볼 자격이 없는 것은 안 보인다.** 낙찰 전 파트너에게 상세주소·연락처가 그렇다.
 * **셋. 못 나아가면 왜인지 화면이 말한다.** 결제사가 없으면 없다고 말해야 하고, 조용히 멈추면 안 된다.
 *
 * ## 결제는 여기서 끝까지 못 간다
 *
 * 결제사(토스) 키가 없으면 카드 결제 버튼이 열리지 않는다. 그것이 옳다 — 없는 결제를 있는 척하면
 * 안 된다. 그래서 이 봇은 **예약금 0원 계약**으로 작업 완료까지 가고, 잔금 앞에서 멈춘 뒤
 * **화면이 그 이유를 말하는지**를 잰다. 멈추는 것 자체가 결함이 아니라, 말없이 멈추는 것이 결함이다.
 */
import pg from 'pg'
import { loadChromium, findChromium, startServer, reporter, refuseUnlessSafeTarget, openPage } from './bot-kit.mjs'

const TAG = 'e2e:trade'
const PORT = Number(process.env.E2E_TRADE_PORT ?? 3218)
const REMOTE = process.env.E2E_BASE ?? ''
const BASE = REMOTE !== '' ? REMOTE.replace(/\/$/, '') : `http://127.0.0.1:${PORT}`
const DB = process.env.DATABASE_URL ?? ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''

const { step, finish } = reporter(TAG)

const STAMP = Date.now().toString().slice(-7)
const PARTNER = {
  name: `거래봇설비${STAMP.slice(-3)}`,
  phone: `010${STAMP}3`.slice(0, 11),
  password: 'trade-bot-pass-1!',
  company: `거래봇설비 ${STAMP.slice(-4)}`,
}
const OTHER = {
  name: `거래봇타사${STAMP.slice(-3)}`,
  phone: `010${STAMP}4`.slice(0, 11),
  password: 'trade-bot-pass-3!',
  company: `거래봇타사 ${STAMP.slice(-4)}`,
}
const CUSTOMER = {
  name: `거래봇고객${STAMP.slice(-3)}`,
  phone: `010${STAMP}5`.slice(0, 11),
  password: 'trade-bot-pass-2!',
}

/** 접수 내용. 상세주소와 연락처는 **낙찰 전에 파트너가 보면 안 되는 것**이라 따로 둔다 */
const ORDER = {
  description: `거래 감사 봇이 넣은 요청입니다 ${STAMP}. 거실 커튼 설치와 확인이 필요합니다.`,
  city: '부산',
  district: '해운대구',
  address: `감사로 ${STAMP.slice(-3)} 101동 1001호`,
  phone: '01055556666',
  /** 한국 날짜로 이레 뒤 — 오늘로 두면 자정 근처 실행에서 `min` 아래로 떨어진다 */
  date: new Date(Date.now() + 9 * 3600_000 + 7 * 86400_000).toISOString().slice(0, 10),
}

const CHAT = {
  fromCustomer: `창 폭은 180cm 입니다 ${STAMP}. 레일도 같이 봐 주세요.`,
  fromPartner: `확인했습니다 ${STAMP}. 방문 때 레일 규격을 재고 알려드리겠습니다.`,
}

const REFUSALS = ['이 계정의 이용 공간이 아닙니다', '로그인이 필요합니다']
// 29-30: 상담 스트림(SSE)이 늘 열려 있어 networkidle 은 오지 않는다 — bot-kit 의 openPage 가 상한을 두고 기다린다
const open = (page, path) => openPage(page, BASE + path)
const body = async (page) => (await page.textContent('body').catch(() => '')) ?? ''

/**
 * 지금 어느 걸음인가. 29-25 첫 실행에서 `locator.click: Timeout 30000ms` 한 줄만 받고
 * **어느 클릭인지 몰라** 한 바퀴를 헛돌았다. 시간을 쓰는 곳마다 이름을 남긴다.
 */
let where = '시작 전'
const at = (name) => {
  where = name
}

/** 넘어졌을 때 네 사람이 각자 무엇을 보고 있었는지 남긴다 — 사진과 본문 앞머리 */
async function dump(pages) {
  console.error(`\n[${TAG}] 넘어진 자리: ${where}`)
  for (const [who, page] of pages) {
    if (page === undefined) continue
    const text = (await body(page)).replace(/\s+/g, ' ').trim()
    console.error(`  ${who} ${page.url()}`)
    console.error(`    ${text.slice(0, 300)}`)
    await page.screenshot({ path: `/tmp/trade-fail-${who}.png` }).catch(() => {})
  }
  console.error(`  사진: /tmp/trade-fail-*.png`)
}

async function login(page, { path = '/login', id, password }) {
  await open(page, path)
  await page.fill('[data-login-id]', id)
  await page.fill('[data-login-password]', password)
  await page.click('[data-login-submit]')
  await page.waitForTimeout(2000)
}

async function signUp(page, role, who) {
  await open(page, `/signup/${role}`)
  await page.click(`[data-signup-role="${role}"]`)
  await page.fill('[data-signup-name]', who.name)
  await page.fill('[data-signup-phone]', who.phone)
  await page.fill('[data-signup-password]', who.password)
  const boxes = page.locator('button[role="checkbox"]')
  for (let i = 0; i < Math.min(await boxes.count(), 2); i += 1) {
    if ((await boxes.nth(i).getAttribute('data-state')) !== 'checked') await boxes.nth(i).click()
  }
  await page.click('[data-signup-submit]')
  const outcome = await Promise.race([
    page
      .waitForSelector('[data-otp-input]', { timeout: 20_000 })
      .then(() => ({ ok: true, text: '' }))
      .catch(() => null),
    page
      .waitForSelector('[data-signup-error]', { timeout: 20_000 })
      .then(async (h) => ({ ok: false, text: ((await h.textContent()) ?? '').trim() }))
      .catch(() => null),
  ])
  if (outcome === null || !outcome.ok) {
    throw new Error(`${role} 가입이 거절됐습니다: ${outcome?.text ?? '(오류 문구도 인증번호 칸도 없다)'}`)
  }
  const issued = ((await page.textContent('[data-otp-issued]').catch(() => '')) ?? '').match(/(\d{4,8})/)
  if (issued === null) throw new Error('화면에 인증번호가 없습니다')
  await page.fill('[data-otp-input]', issued[1])
  await page.click('[data-otp-submit]')
  await page.waitForTimeout(2000)
}

/** 개인 파트너로 업체 정보를 낸다 — 서류 게이트는 29-23 봇이 이미 잰다 */
async function submitPartnerProfile(page, who) {
  await open(page, '/partner/profile')
  await page.getByLabel('업체명').fill(who.company)
  await page.getByLabel('대표자').fill(who.name)
  await page.getByLabel('연락처').fill(who.phone)
  // 전국·커튼으로 맞춘다 — 이 봇의 주문이 커튼이라, 공종이나 지역이 어긋나면
  // 일감이 안 보이는 것이 **가림 결함인지 매칭 정상인지** 구분할 수 없게 된다
  await page.getByLabel('활동 지역').fill('전국')
  await page.locator('.check-line', { hasText: '커튼·블라인드' }).locator('button[role="checkbox"]').click()
  await page.click('[data-partner-type="individual"]')
  await page.getByRole('button', { name: /파트너 정보 제출/ }).click()
  await page.waitForTimeout(2500)
}

/** 관리자가 한 업체를 승인한다 */
async function approvePartner(page, company) {
  await open(page, '/admin/partners')
  const card = page.locator('article.panel', { hasText: company })
  await card.waitFor({ state: 'visible', timeout: 20_000 })
  await card.locator('textarea').fill('거래 감사 봇 — 신원 확인 완료')
  await card.locator('button[role="checkbox"]').click()
  await card.getByRole('button', { name: /파트너 승인/ }).click()
  await page.waitForTimeout(2500)
}

/**
 * 위저드의 다음 걸음으로 간다. **넘어갔는지 확인하고, 안 넘어갔으면 화면이 말한 이유를 들고 던진다.**
 *
 * 29-25 첫 실행에서 `locator.click: Timeout 30000ms` 한 줄만 받았다. 실제로 벌어진 일은
 * "안전 질문에 답해 주세요" 였는데 그 문구가 화면에 떠 있는데도 봇은 다음 걸음의 칸을 찾다가 굶었다.
 * **막힌 것과 못 찾은 것은 다른 일이라** 여기서 갈라 준다.
 */
async function advance(page, name) {
  await page.getByRole('button', { name }).click()
  const current = page.locator('.steps [aria-current="step"]')
  await current
    .filter({ hasText: name })
    .waitFor({ timeout: 5000 })
    .catch(async () => {
      const why = (
        (await page
          .locator('.error')
          .first()
          .textContent()
          .catch(() => '')) ?? ''
      ).trim()
      const now = ((await current.textContent().catch(() => '')) ?? '').trim()
      throw new Error(`위저드가 '${name}' 로 넘어가지 않았다(지금 '${now}') — 화면의 이유: ${why || '(없다)'}`)
    })
}

/** 라딕스 Select 하나를 고른다 */
async function pick(page, label, option) {
  await page.locator(`[aria-label="${label}"]`).click()
  await page.getByRole('option', { name: option, exact: true }).first().click()
  await page.waitForTimeout(400)
}

/** 1×1 PNG. 증빙 사진이 있어야 완료 요청을 낼 수 있어서 가장 작은 진짜 PNG 를 쓴다 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 사진 저장소가 있는 자리인가 — 있으면 사진이 실제로 오르내리는 길을 걷는다 (29-30) */
const HAS_STORE = (process.env.LOCAL_STORAGE_DIR ?? '') !== '' || (process.env.BLOB_STORE_ID ?? '') !== ''

/** 거래 패널의 탭 하나로 간다 */
const tab = (page, name) => page.getByRole('tab', { name, exact: true }).click()

/** 모달 안의 확인 칸을 전부 켠다 — 켜지 않으면 서버가 받지 않는 것이 정상이다 */
async function tickAll(modal) {
  const boxes = modal.locator('.check-line button[role="checkbox"]')
  for (let i = 0; i < (await boxes.count()); i += 1) {
    if ((await boxes.nth(i).getAttribute('data-state')) !== 'checked') await boxes.nth(i).click()
  }
}

/**
 * 거래 패널의 버튼을 눌러 모달을 채우고 보낸다. **받아들여졌는지, 아니면 왜 거절했는지**를 돌려준다.
 *
 * 모달이 닫히는 것이 성공이다 — `ActionModal` 은 서버가 받았을 때만 닫는다. 거절은 토스트로만
 * 말하고 몇 초 뒤 사라지므로 **떠 있는 동안 집어 와야 한다.** 사라진 뒤에 읽으면
 * "이유를 말하지 않았다"는 잘못된 결론이 난다(29-25 에서 한 번 그렇게 읽었다).
 */
async function tradeTry(page, name, fill = async () => {}) {
  await page.getByRole('button', { name, exact: true }).first().click()
  const modal = page.locator('.trade-dialog')
  await modal.waitFor({ timeout: 20_000 })
  await fill(modal)
  await modal.getByRole('button', { name, exact: true }).click()
  const until = Date.now() + 25_000
  let why = ''
  while (Date.now() < until) {
    if ((await modal.count()) === 0) return { ok: true, why: '' }
    const toast = (
      (await page
        .locator('[data-sonner-toast]')
        .first()
        .textContent()
        .catch(() => '')) ?? ''
    ).trim()
    if (toast !== '' && !toast.includes('저장했습니다')) {
      why = toast
      break
    }
    await page.waitForTimeout(250)
  }
  if ((await modal.count()) === 0) return { ok: true, why: '' }
  await modal
    .getByRole('button', { name: '돌아가기' })
    .click()
    .catch(() => {})
  await modal.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  return { ok: false, why }
}

async function tradeDo(page, name, fill = async () => {}) {
  const r = await tradeTry(page, name, fill)
  if (!r.ok) throw new Error(`'${name}' 이(가) 받아들여지지 않았다 — 화면의 이유: ${r.why || '(토스트도 없다)'}`)
}

/**
 * 확정된 방문 시각을 과거로 옮긴다. **시간을 건너뛰는 것 말고는 방법이 없다.**
 *
 * 계약은 방문 시각이 미래여야 맺을 수 있고(`validateSchedule`), 작업은 그 시각이 지나야
 * 시작할 수 있다(`start`). 둘 다 옳은 규칙이라 봇이 한 번에 만족시킬 수 없다 — 규칙을 끄는 대신
 * **하루가 지난 것으로 만든다.** 화면과 서버의 판단은 그대로 두고 시계만 민다.
 */
/**
 * 증빙 사진 두 줄을 표에 직접 넣는다 — **저장소를 안 준 자리를 위해.**
 *
 * 29-30 부터 사진은 파일 저장소 포트(`LOCAL_STORAGE_DIR` 또는 Vercel Blob)로 실제로 올라간다.
 * 그 어느 것도 없으면 서버는 503 으로 거절한다 — 그것이 옳다. 다만 완료 확인은 전·후 사진을
 * 요구하므로, 저장소가 없는 자리에서는 **저장소가 이미 받아 둔 상태**를 만들어 준다.
 * 거절 자체는 앞 걸음에서 따로 잰다. CI 는 저장소를 주므로 이 길로 오지 않는다.
 */
async function seedEvidencePhotos(orderId) {
  const client = new pg.Client({ connectionString: DB })
  await client.connect()
  try {
    const owner = await client.query('select partner_id from bids where order_id=$1 limit 1', [orderId])
    const ownerId = owner.rows[0]?.partner_id
    if (ownerId === undefined) throw new Error('이 주문의 파트너를 찾지 못했다')
    const expires = new Date(Date.now() + 30 * 86400_000).toISOString()
    for (const label of ['before', 'after']) {
      await client.query(
        `insert into photos (id,order_id,owner_id,object_key,mime,created_at,expires_at)
         values (gen_random_uuid(),$1,$2,$3,'image/png',$4,$5)`,
        [orderId, ownerId, `bot/${orderId}/${label}.png`, new Date().toISOString(), expires],
      )
    }
  } finally {
    await client.end()
  }
}

async function skipToVisit(orderId) {
  const client = new pg.Client({ connectionString: DB })
  await client.connect()
  try {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
    const r = await client.query('update schedule_slots set date=$1, start_hour=8 where order_id=$2', [
      yesterday,
      orderId,
    ])
    if (r.rowCount !== 1) throw new Error(`방문 일정이 한 줄이 아니다(${r.rowCount}줄)`)
  } finally {
    await client.end()
  }
}

const refusal = refuseUnlessSafeTarget({ remote: REMOTE, db: DB, adminPassword: ADMIN_PASSWORD })
if (refusal !== null) {
  console.error(`[${TAG}] 돌리지 않습니다 — ${refusal}`)
  process.exit(1)
}

console.log(`[${TAG}] ${BASE}${REMOTE !== '' ? ' (배포된 주소)' : ' (로컬)'}`)

const { server, log, waitReady } = startServer({ tag: TAG, port: PORT, remote: REMOTE, base: BASE })

let exitCode = 1
/** `catch` 에서도 네 사람의 화면을 봐야 해서 `try` 밖에 둔다 */
let A, P, O, C
try {
  if (!(await waitReady())) throw new Error('서버가 뜨지 않았습니다\n' + log().slice(-1500))

  const chromium = await loadChromium(TAG)
  const browser = await chromium.launch({ executablePath: findChromium() })
  const ctx = () => browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const [adminCtx, partnerCtx, otherCtx, customerCtx] = await Promise.all([ctx(), ctx(), ctx(), ctx()])
  ;[A, P, O, C] = await Promise.all([
    adminCtx.newPage(),
    partnerCtx.newPage(),
    otherCtx.newPage(),
    customerCtx.newPage(),
  ])

  // ── 준비: 파트너 둘과 고객 하나. 둘째 파트너는 "남의 거래는 안 보인다"를 재기 위해 있다 ──
  at('가입')
  await Promise.all([signUp(P, 'partner', PARTNER), signUp(O, 'partner', OTHER), signUp(C, 'customer', CUSTOMER)])
  step('파트너 둘과 고객 하나가 동시에 가입한다', true)

  at('업체 정보 제출')
  await Promise.all([submitPartnerProfile(P, PARTNER), submitPartnerProfile(O, OTHER)])
  at('관리자 로그인')
  await login(A, { path: '/login/admin', id: 'admin', password: ADMIN_PASSWORD })
  at('업체 승인')
  await approvePartner(A, PARTNER.company)
  await approvePartner(A, OTHER.company)
  step('관리자가 업체 둘을 승인한다', true)

  // ── 1. 고객이 접수한다 — 위저드 네 걸음을 실제로 누른다 ────────────────────
  at('접수 화면 열기')
  await open(C, '/request')
  // 커튼·블라인드로 고른다. 안전 질문(잠김·긴급)도 범위 검토도 붙지 않는 분야라
  // **이 봇이 재려는 것이 거래의 줄이지 검토의 줄이 아니기 때문이다.**
  at('1걸음: 작업 분야 고르기')
  await C.locator('button[role="checkbox"][aria-label="커튼·블라인드"]').click()
  at('1걸음 → 2걸음')
  await advance(C, '작업 내용')
  at('2걸음: 작업 설명 적기')
  await C.locator('textarea').first().fill(ORDER.description)
  // 29-30: 접수 사진 한 장. 저장소가 없으면 접수 뒤 업로드가 실패해 주문 화면으로 못 가므로 있을 때만 붙인다.
  if (HAS_STORE) {
    at('2걸음: 현장 사진 붙이기')
    await C.locator('input[type=file][multiple]').setInputFiles({
      name: 'site.png',
      mimeType: 'image/png',
      buffer: PNG,
    })
  }
  step(
    '안전 질문이 없는 분야에는 안전 질문이 안 붙는다',
    (await C.locator('.safety-question').count()) === 0,
    '커튼 설치에 잠김·긴급 질문이 붙었다',
  )
  at('2걸음 → 3걸음')
  await advance(C, '방문 정보')
  at('3걸음: 시·도 고르기')
  await pick(C, '시도', ORDER.city)
  at('3걸음: 시·군·구 고르기')
  await pick(C, '시군구', ORDER.district)
  at('3걸음: 주소와 연락처와 일정 적기')
  await C.getByLabel('상세주소').fill(ORDER.address)
  await C.getByLabel('연락처').fill(ORDER.phone)
  await C.getByLabel('희망 방문일').fill(ORDER.date)
  at('3걸음 → 4걸음')
  await advance(C, '최종 확인')
  at('4걸음: 개인정보 동의')
  await C.locator('.check-line button[role="checkbox"]').last().click()
  at('4걸음: 접수 누르기')
  await C.getByRole('button', { name: /작업 요청 접수/ }).click()
  await C.waitForURL(/\/mypage\//, { timeout: 45_000 })
  const orderId = (C.url().match(/\/mypage\/([^/?#]+)/) ?? [])[1] ?? ''
  step('고객이 위저드 네 걸음으로 접수한다', orderId !== '', '접수 뒤 주문 주소로 가지 않았다')
  if (orderId === '') throw new Error('주문 번호를 얻지 못해 더 갈 수 없습니다')

  // ── 1-2. 접수 사진이 실제로 오르내린다 (29-30) ───────────────────────────
  // `page.request` 는 그 창의 쿠키를 쓴다 — <img src> 가 가는 길과 같다(Authorization 헤더 없음).
  let photoUrl = ''
  if (HAS_STORE) {
    at('접수 사진이 주문 상세에 보인다')
    await C.locator('.photo-grid img')
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => {})
    photoUrl =
      (await C.locator('.photo-grid a')
        .first()
        .getAttribute('href')
        .catch(() => null)) ?? ''
    step('접수한 사진이 고객 주문 상세에 보인다', photoUrl.startsWith('/api/photos/'), '접수 사진이 주문 상세에 없다')
    const mine = await C.request.get(BASE + photoUrl)
    step(
      '사진 바이트가 쿠키만으로 내려온다 (HttpOnly 세션 · <img> 의 길)',
      mine.status() === 200 && (mine.headers()['content-type'] ?? '').startsWith('image/png'),
      `status=${mine.status()} type=${mine.headers()['content-type']}`,
    )
  }

  // ── 2. 거래방식이 확정되기 전에는 파트너에게 일감이 없다 ────────────────────
  await open(P, '/partner/jobs')
  step(
    '거래방식 확정 전에는 일감 목록에 없다',
    !(await body(P)).includes(ORDER.description.slice(0, 20)),
    '아직 중개로 확정하지 않은 요청이 파트너에게 보인다',
  )

  // ── 3. 관리자가 중개로 확정한다 ──────────────────────────────────────────
  at('관리자 거래방식 확정')
  await open(A, `/admin/orders/${orderId}`)
  await A.locator('.admin-review textarea').fill('거래 감사 봇 — 커튼 설치, 위험 요소 없음. 중개로 진행합니다.')
  await A.getByRole('button', { name: /거래방식 확정/ }).click()
  await A.locator('.admin-review .inline-notice').waitFor({ timeout: 20_000 })
  step(
    '관리자가 중개로 확정하면 화면이 되돌릴 수 없다고 말한다',
    (await body(A)).includes('중간에 거래방식을 변경할 수 없습니다'),
    '확정 뒤에도 되돌릴 수 있는 것처럼 보인다',
  )

  at('파트너 일감 목록')
  await open(P, '/partner/jobs')
  step(
    '중개로 확정하면 파트너 일감에 뜬다',
    (await body(P)).includes(ORDER.description.slice(0, 20)),
    '중개로 확정했는데 파트너 일감에 없다',
  )

  // ── 4. 낙찰 전에는 상세주소와 연락처가 파트너에게 안 보인다 ─────────────────
  at('파트너가 일감을 연다(낙찰 전)')
  await open(P, `/partner/jobs/${orderId}`)
  const beforeAward = await body(P)
  step(
    '낙찰 전 파트너에게 상세주소가 안 보인다',
    !beforeAward.includes(ORDER.address),
    `파트너 화면에 상세주소가 그대로 있다: ${ORDER.address}`,
  )
  step(
    '낙찰 전 파트너에게 연락처가 안 보인다',
    !beforeAward.includes(ORDER.phone),
    '파트너 화면에 고객 연락처가 그대로 있다',
  )
  step(
    '가려 뒀다는 사실을 화면이 말한다',
    beforeAward.includes('파트너 선택 후 공개'),
    '주소를 가리기만 하고 왜 없는지는 말하지 않는다',
  )
  if (photoUrl !== '') {
    const peek = await P.request.get(BASE + photoUrl)
    step('낙찰 전 파트너는 사진 바이트도 못 받는다 (403)', peek.status() === 403, `status=${peek.status()}`)
  }

  // ── 5. 견적을 낸다 ──────────────────────────────────────────────────────
  at('파트너 견적 작성')
  await P.getByRole('button', { name: /견적 제안하기/ }).click()
  const editor = P.locator('form.bid-editor')
  await editor.waitFor({ timeout: 20_000 })
  await editor.getByLabel('인건비').fill('300000')
  await editor.getByLabel('자재비').fill('120000')
  await editor.getByLabel('출장비').fill('30000')
  await editor.getByLabel('할인').fill('0')
  await editor.getByLabel('포함 항목').fill('커튼 레일 설치, 기존 제품 철거와 뒷정리')
  await editor.getByLabel('제외 항목').fill('커튼 원단 구매')
  await editor.getByLabel('고객에게 전달할 설명').fill('현장에서 창 폭을 확인한 뒤 레일을 재단해 설치합니다.')
  await editor.getByLabel('방문 가능일').fill(ORDER.date)
  await editor.getByRole('button', { name: /^견적 제출$/ }).click()
  await editor.waitFor({ state: 'detached', timeout: 20_000 })
  step(
    '파트너가 낸 견적이 VAT 포함 총액으로 보인다',
    (await body(P)).includes('495,000'),
    '공급가 450,000 에 VAT 를 더한 495,000 원이 화면에 없다',
  )

  // ── 6. 남의 거래는 남의 것이다 ──────────────────────────────────────────
  at('다른 파트너가 남의 주문을 열어 본다')
  await open(O, `/partner/jobs/${orderId}`)
  const otherBody = await body(O)
  step(
    '다른 파트너는 남이 낸 견적 금액을 못 본다',
    !otherBody.includes('495,000'),
    '경쟁 파트너에게 남의 견적 금액이 보인다',
  )
  step(
    '다른 파트너에게도 상세주소는 안 보인다',
    !otherBody.includes(ORDER.address),
    '낙찰과 무관한 파트너에게 상세주소가 보인다',
  )
  if (photoUrl !== '') {
    const peek = await O.request.get(BASE + photoUrl)
    step('다른 파트너도 사진 바이트를 못 받는다 (403)', peek.status() === 403, `status=${peek.status()}`)
  }

  // ── 7. 고객이 낙찰한다 ──────────────────────────────────────────────────
  at('고객이 파트너를 고른다')
  await open(C, `/mypage/${orderId}`)
  await C.getByRole('button', { name: /이 파트너 선택하기/ })
    .first()
    .click()
  const dialog = C.locator('[role="dialog"]')
  await dialog.waitFor({ timeout: 20_000 })
  await dialog.locator('button[role="checkbox"]').click()
  await dialog.getByRole('button', { name: /선택 확정/ }).click()
  await dialog.waitFor({ state: 'detached', timeout: 20_000 })
  step(
    '낙찰하면 고객 화면이 선택한 파트너라고 말한다',
    (await body(C)).includes('선택한 파트너입니다'),
    '낙찰했는데 어느 파트너를 골랐는지 화면이 말하지 않는다',
  )

  at('낙찰 뒤 파트너가 다시 연다')
  await open(P, `/partner/jobs/${orderId}`)
  const afterAward = await body(P)
  step(
    '낙찰되면 그 파트너에게만 상세주소가 열린다',
    afterAward.includes(ORDER.address),
    '낙찰됐는데도 방문할 주소를 모른다',
  )
  step('낙찰되면 고객 연락처도 함께 열린다', afterAward.includes(ORDER.phone), '낙찰됐는데 고객에게 연락할 방법이 없다')
  if (photoUrl !== '') {
    const opened = await P.request.get(BASE + photoUrl)
    step('낙찰되면 선택된 파트너에게 접수 사진이 열린다 (200)', opened.status() === 200, `status=${opened.status()}`)
    const still = await O.request.get(BASE + photoUrl)
    step('낙찰 뒤에도 남에게는 사진이 안 열린다 (403)', still.status() === 403, `status=${still.status()}`)
  }

  at('낙찰 뒤 다른 파트너가 다시 연다')
  await open(O, `/partner/jobs/${orderId}`)
  step(
    '낙찰 뒤에도 남에게는 주소가 안 열린다',
    !(await body(O)).includes(ORDER.address),
    '낙찰되지 않은 파트너에게 주소가 열렸다',
  )

  // ── 7-2. 주문 상담 — 둘이 실제로 말을 주고받는다 ─────────────────────────
  //
  // 29-25 에서 이 자리가 **운영에서 통째로 안 열렸다.** 첫 장을 여는 커서가 `Number.MAX_SAFE_INTEGER`
  // 였는데 `messages.seq` 는 Postgres 에서 `integer` 다. 화면으로 한 번도 안 걸어 봐서 몰랐다.
  at('고객이 상담을 건다')
  await open(C, `/mypage/${orderId}`)
  const composer = C.locator('form.chat-composer')
  await composer.waitFor({ timeout: 20_000 })
  step('주문 상담이 열린다', !(await body(C)).includes('out of range'), '대화방이 저장소 오류를 그대로 내보인다')
  // 29-30: 스트림(SSE)이 실제로 열리면 화면이 "자동 연결 중"이라고 적는다. 29-29 까지는 서버가 503 이라
  // 늘 "다시 연결 중"이었고, 화면은 10초 폴링으로만 돌았다.
  const live = await C.locator('.chat-panel', { hasText: '자동 연결 중' })
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('상담이 실시간 스트림(SSE)으로 연결된다', live, '스트림이 열리지 않아 폴링으로만 돈다')
  await composer.getByLabel('상담 메시지').fill(CHAT.fromCustomer)
  await composer.getByRole('button', { name: /보내기/ }).click()
  await C.locator('.chat-message', { hasText: CHAT.fromCustomer }).waitFor({ timeout: 20_000 })

  at('파트너가 답한다')
  await open(P, `/partner/jobs/${orderId}`)
  const partnerChat = P.locator('form.chat-composer')
  await partnerChat.waitFor({ timeout: 20_000 })
  // 대화는 열리자마자 차 있지 않다 — 화면이 따로 불러온다. 그려질 때까지 기다려 준다
  const arrived = await P.locator('.chat-message', { hasText: CHAT.fromCustomer })
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('고객이 한 말이 파트너 화면에 도착한다', arrived, '보낸 말이 상대에게 가지 않는다')
  await partnerChat.getByLabel('상담 메시지').fill(CHAT.fromPartner)
  await partnerChat.getByRole('button', { name: /보내기/ }).click()
  await P.locator('.chat-message', { hasText: CHAT.fromPartner }).waitFor({ timeout: 20_000 })

  at('다른 파트너가 남의 상담을 엿본다')
  await open(O, `/partner/jobs/${orderId}`)
  await O.waitForTimeout(3000)
  step(
    '다른 파트너는 남의 상담 내용을 못 본다',
    !(await body(O)).includes(CHAT.fromCustomer),
    '경쟁 파트너에게 고객의 말이 보인다',
  )

  // ── 8. 수수료가 정해지기 전에는 계약서가 나갈 수 없다 ─────────────────────
  at('수수료 확정 전 파트너 화면')
  step(
    '수수료 확정 전 파트너에게 기다리라고 말한다',
    (
      (await P.locator('.next-action h3')
        .textContent()
        .catch(() => '')) ?? ''
    ).includes('계약 준비 중'),
    '수수료가 없는데도 계약서를 발행하라고 한다',
  )

  at('관리자 수수료 확정')
  await open(A, `/admin/orders/${orderId}`)
  await A.locator('.trade-panel').waitFor({ timeout: 20_000 })
  await tradeDo(A, '수수료 조건 확정', async (m) => {
    await m.getByLabel('합의한 수수료율').fill('10')
    await m.locator('textarea').fill('거래 감사 봇 — 파트너와 합의한 10% 를 기록합니다.')
  })
  step(
    '확정한 수수료율이 화면에 남는다',
    (await body(A)).includes('확정 수수료율 10%'),
    '수수료를 확정했는데 화면이 몇 %인지 말하지 않는다',
  )

  // ── 9. 계약서 — 예약금 0원으로 발행한다(결제사가 없으므로) ──────────────────
  at('파트너 계약서 발행')
  await open(P, `/partner/jobs/${orderId}`)
  await P.locator('.trade-panel').waitFor({ timeout: 20_000 })
  await tradeDo(P, '계약서 발행', async (m) => {
    await m.getByLabel('예약금').fill('0')
    await m
      .locator('textarea')
      .fill(
        '계약 당사자는 고객과 파트너입니다. 결제는 플랫폼이 대리 수령하며 증빙은 파트너가 발급합니다. 방문 3일 전까지 무상 취소, 이후 출장비를 청구합니다. 시공 후 1년간 무상 A/S 합니다.',
      )
  })
  step(
    '계약서에 총액과 잔금이 함께 적힌다',
    (await body(P)).includes('495,000') && (await body(P)).includes('완료 확인 후 잔금'),
    '계약서에 고객이 낼 금액이 분명하지 않다',
  )

  at('고객 계약 동의')
  await open(C, `/mypage/${orderId}`)
  await C.locator('.trade-panel').waitFor({ timeout: 20_000 })
  await tradeDo(C, '계약에 동의', tickAll)
  step(
    '고객이 동의하면 계약 확정으로 바뀐다',
    (await body(C)).includes('계약 확정'),
    '동의했는데 계약이 확정으로 넘어가지 않았다',
  )

  // ── 10. 작업 — 시작하고, 사진을 남기고, 완료를 요청한다 ─────────────────────
  at('방문 전 작업 시작 시도')
  await open(P, `/partner/jobs/${orderId}`)
  await P.locator('.trade-panel').waitFor({ timeout: 20_000 })
  await tab(P, '작업')
  const tooEarly = await tradeTry(P, '작업 시작', tickAll)
  step(
    '방문 시각 전에는 작업을 시작할 수 없고, 화면이 그 이유를 말한다',
    !tooEarly.ok && tooEarly.why.includes('방문'),
    tooEarly.ok
      ? '아직 오지 않은 방문인데 작업이 시작됐다'
      : `거절은 했는데 이유가 방문 시각이 아니다: ${tooEarly.why}`,
  )

  at('방문 시각으로 시계를 민다')
  await skipToVisit(orderId)
  await open(P, `/partner/jobs/${orderId}`)
  await P.locator('.trade-panel').waitFor({ timeout: 20_000 })
  await tab(P, '작업')
  await tradeDo(P, '작업 시작', tickAll)

  at('증빙 사진 올리기')
  await P.locator('.upload-evidence input[type=file]').setInputFiles({
    name: 'before.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  let uploaded = false
  let storeNote = ''
  for (const until = Date.now() + 15_000; Date.now() < until;) {
    if ((await P.locator('.trade-photos img').count()) > 0) {
      uploaded = true
      break
    }
    const t = (
      (await P.locator('[data-sonner-toast]')
        .first()
        .textContent()
        .catch(() => '')) ?? ''
    ).trim()
    if (t !== '' && !t.includes('저장했습니다')) {
      storeNote = t
      break
    }
    await P.waitForTimeout(250)
  }
  if (uploaded) {
    await P.locator('.upload-evidence input[type=file]').setInputFiles({
      name: 'after.png',
      mimeType: 'image/png',
      buffer: PNG,
    })
    await P.locator('.trade-photos img').nth(1).waitFor({ timeout: 20_000 })
    step('증빙 사진이 올라간다', true)
    const evidenceUrl = (await P.locator('.trade-photos a').first().getAttribute('href')) ?? ''
    const ev = await P.request.get(BASE + evidenceUrl)
    step(
      '증빙 사진 바이트가 파트너에게 내려온다 (200)',
      ev.status() === 200,
      `status=${ev.status()} url=${evidenceUrl}`,
    )
  } else {
    // 저장소를 안 준 자리다. 없는 것 자체는 결함이 아니고, **말없이 실패하는 것**이 결함이다.
    step(
      '사진 저장소가 없으면 화면이 그렇게 말한다',
      storeNote.includes('사진 저장소'),
      `사진이 안 올라갔는데 이유를 말하지 않는다: ${storeNote || '(토스트도 없다)'}`,
    )
    await seedEvidencePhotos(orderId)
    await open(P, `/partner/jobs/${orderId}`)
    await P.locator('.trade-panel').waitFor({ timeout: 20_000 })
    await tab(P, '작업')
  }

  at('파트너 완료 요청')
  await tradeDo(P, '작업 완료 요청', async (m) => {
    await m.locator('textarea').fill('커튼 레일을 설치하고 작동을 확인했습니다. 기존 제품과 포장재는 수거했습니다.')
    await m.locator('fieldset', { hasText: '작업 전 사진' }).locator('button[role="checkbox"]').first().click()
    await m.locator('fieldset', { hasText: '작업 후 사진' }).locator('button[role="checkbox"]').last().click()
  })

  at('고객 완료 확인')
  await open(C, `/mypage/${orderId}`)
  await C.locator('.trade-panel').waitFor({ timeout: 20_000 })
  await tab(C, '작업')
  await tradeDo(C, '작업 완료 확인', async (m) => {
    await m.locator('textarea').fill('설치 상태와 작동을 직접 확인했습니다. 마무리도 깨끗합니다.')
  })
  step('고객이 확인하면 작업 완료로 바뀐다', (await body(C)).includes('완료 확인'), '완료를 확인했는데 화면이 그대로다')

  // ── 10-2. 후기가 업체 찾기에 숫자로 닿는다 (29-26) ─────────────────────────
  // 평점은 `AVG(rating)` 이다. Postgres 는 그것을 문자열로 주고 화면은 `rating.toFixed(1)` 을 한다 —
  // 후기가 하나라도 생기는 순간 업체 찾기와 업체 페이지가 통째로 넘어지던 자리다.
  at('고객 후기')
  await open(C, `/mypage/${orderId}`)
  const reviewForm = C.locator('article', { hasText: '작업 후기' })
  await reviewForm.getByRole('button', { name: '후기 등록' }).waitFor({ timeout: 20_000 })
  await reviewForm
    .locator('textarea')
    .fill('약속한 시간에 오셔서 깔끔하게 설치해 주셨습니다. 다음에도 부탁드리고 싶어요.')
  await reviewForm.getByRole('button', { name: '후기 등록' }).click()
  await reviewForm
    .getByRole('button', { name: '후기 등록' })
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => {})
  step(
    '완료한 고객이 후기를 남길 수 있다',
    (await body(C)).includes('깔끔하게 설치해 주셨습니다'),
    '후기를 등록했는데 화면에 없다',
  )

  at('업체 찾기')
  await open(C, '/companies')
  await C.locator('[data-company-list], [data-company-empty]').first().waitFor({ timeout: 20_000 })
  const companyCard = C.locator('[data-company-card]', { hasText: PARTNER.company })
  const cardText = ((await companyCard.count()) ? await companyCard.first().textContent() : '') ?? ''
  step(
    '후기가 생긴 업체가 업체 찾기에 평점과 함께 나온다',
    /후기 1건 · 평점 5\.0/.test(cardText),
    `카드가 이렇게 그려졌다: ${cardText.trim().slice(0, 120) || '(카드가 없다)'} — 본문 머리: ${(await body(C)).slice(0, 160)}`,
  )

  at('업체 페이지')
  if (await companyCard.count()) {
    await companyCard.first().getByRole('link').click()
    await C.waitForURL(/\/companies\/[^/?#]+/, { timeout: 20_000 }).catch(() => {})
    await C.locator('.rating')
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => {})
  }
  const companyBody = await body(C)
  step(
    '업체 페이지가 평점을 숫자로 그린다',
    companyBody.includes('5.0 / 5 · 후기 1건'),
    `업체 페이지 본문 머리: ${companyBody.slice(0, 200)}`,
  )
  // 거래 화면으로 돌아온다 — 아래 걸음들은 거래 패널의 탭을 누른다
  await open(C, `/mypage/${orderId}`)
  await C.locator('.trade-panel').waitFor({ timeout: 20_000 })

  // ── 11. 결제사가 없으면, 없다고 말한다 ────────────────────────────────────
  at('결제 탭')
  await tab(C, '결제')
  const payBody = await body(C)
  step(
    '결제사가 없으면 화면이 없다고 분명히 말한다',
    payBody.includes('결제사 연결 준비 중입니다'),
    '카드 결제가 안 되는 이유를 화면이 말하지 않는다',
  )
  const balance = C.getByRole('button', { name: /잔금 .* 결제/ })
  step(
    '못 하는 결제 버튼은 눌리지 않는다',
    (await balance.count()) > 0 && (await balance.first().isDisabled()),
    '결제사가 없는데 잔금 결제 버튼이 살아 있다',
  )

  // ── 12. 정산 — 받은 돈이 없으면 나갈 돈도 없다 ────────────────────────────
  at('관리자 정산')
  await open(A, `/admin/orders/${orderId}`)
  await A.locator('.trade-panel').waitFor({ timeout: 20_000 })
  await tab(A, '정산')
  const early = await tradeTry(A, '정산 승인', async (m) => {
    await m.locator('textarea').fill('거래 감사 봇 — 완료 확인과 결제 내역을 대조했습니다.')
  })
  step(
    '받은 돈이 확인되지 않으면 정산이 승인되지 않는다',
    !early.ok && early.why.includes('결제'),
    early.ok ? '한 푼도 안 받았는데 파트너에게 줄 돈이 확정됐다' : `거절은 했는데 이유가 결제가 아니다: ${early.why}`,
  )
  step(
    '송금이 자동이 아니라는 사실을 화면이 말한다',
    (await body(A)).includes('은행 자동 송금은 연결되지 않았습니다'),
    '관리자가 누르면 돈이 나가는 것처럼 보인다',
  )

  console.log('\n  — 접수부터 정산까지 한 바퀴 —')
  exitCode = finish()
} catch (e) {
  console.error(`[${TAG}] 실행 중 오류:`, e)
  await dump([
    ['admin', A],
    ['partner', P],
    ['other', O],
    ['customer', C],
  ]).catch(() => {})
  const tail = log().slice(-1500)
  if (tail !== '') console.error('\n--- 서버 로그 ---\n' + tail)
  exitCode = 1
} finally {
  server?.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
}
process.exit(exitCode)
