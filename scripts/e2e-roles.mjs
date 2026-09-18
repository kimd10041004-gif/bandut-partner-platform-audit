/**
 * 세 역할을 **동시에** 앉혀 놓고 감사한다 (29-22).
 *
 * ## 왜 동시인가
 *
 * `e2e:signup`(29-18)은 한 사람이 차례로 움직인다. 그것으로는 못 보는 것이 둘 있다.
 *
 * **하나. 관리자 화면을 아무도 열어 본 적이 없다.** 지금까지 봇이 연 관리자 화면은 승인 목록
 * 하나뿐이었다. 나머지 열네 장은 코드를 읽어 "게이트가 걸려 있다"고 확인했을 뿐이다. 읽은 것은
 * 잰 것이 아니다 — 29-20 에서 로그인 성공 판정이 `/login/admin` 주소에도 맞아 **실패한 로그인이
 * 통과로 찍힌** 적이 있다. 그때도 코드는 맞아 보였다.
 *
 * **둘. 막혀야 할 문을 남이 밀어 본 적이 없다.** 파트너나 고객이 관리자 주소를 직접 치면
 * 어떻게 되는지를 아무도 재지 않았다. 혼자 도는 검사는 이 종류의 구멍을 구조적으로 못 본다.
 *
 * 그래서 관리자·파트너·고객 창을 한 브라우저에 셋 띄우고 같은 시각에 움직인다. 빨라지는 것은
 * 덤이고, 목적은 **같은 주소를 세 사람이 동시에 열었을 때 서로 다른 답을 받는가**이다.
 *
 * ## 재는 것
 *
 *   A. 관리자 화면 열다섯 장이 각각 자기 내용을 그린다
 *   B. 같은 열다섯 장을 파트너가 열면 전부 거절된다
 *   C. 같은 열다섯 장을 고객이 열면 전부 거절된다
 *   D. 파트너 자기 화면은 열린다
 *   E. 고객 자기 화면은 열린다
 *   F. 고객이 업체에 상담을 걸고 **실제로 말을 주고받는다** — 파트너 창에 그 말이 도착한다
 *   G. 사업자 파트너는 서류 둘을 내야 승인된다 (29-23)
 *
 * ## 쓰는 것과 안 쓰는 것
 *
 * 계정을 실제로 만들고 메시지를 실제로 보낸다. 그래서 **이름에 test 가 든 DB 에서만** 돌고,
 * 운영 주소로 향하면 아무것도 하지 않고 멈춘다(`scripts/bot-kit.mjs`).
 *
 * 환경: DATABASE_URL(이름에 test 필수) · ADMIN_PASSWORD,
 *       PLAYWRIGHT_CORE_PATH(선택) · CHROMIUM_PATH(선택) · BASE_URL(선택, 프리뷰만).
 */
import {
  refuseUnlessSafeTarget,
  loadChromium,
  findChromium,
  startServer,
  reporter,
  openPage,
  reloadPage,
  settle,
} from './bot-kit.mjs'

const TAG = 'e2e:roles'
const PORT = Number(process.env.ROLES_E2E_PORT ?? 3216)
const REMOTE = (process.env.BASE_URL ?? '').replace(/\/$/, '')
const BASE = REMOTE !== '' ? REMOTE : `http://127.0.0.1:${PORT}`
const DB = process.env.DATABASE_URL ?? ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''

const { step, finish } = reporter(TAG)

/** 관리자 셸이 내거는 열다섯 장. `components/marketplace/shell.tsx` 의 차림표와 같아야 한다 */
const ADMIN_PATHS = [
  '/admin',
  '/admin/dashboard',
  '/admin/orders',
  '/admin/partners',
  '/admin/audit-logs',
  '/admin/settlements',
  '/admin/disputes',
  '/admin/content',
  '/admin/settings',
  '/admin/reviews',
  '/admin/editor',
  '/admin/diagnostics',
  '/admin/messages',
  '/admin/search',
  '/admin/schedule',
]

/** 파트너가 들어갈 수 있어야 하는 자리 */
const PARTNER_PATHS = ['/partner', '/partner/jobs', '/partner/work', '/partner/bids', '/partner/profile', '/consult']
/** 고객이 들어갈 수 있어야 하는 자리 */
const CUSTOMER_PATHS = ['/mypage', '/profile', '/request', '/companies', '/consult']

/** 셸이 "너 여기 아니다"라고 할 때 내거는 두 문구 (`Access` in shell.tsx) */
const REFUSALS = ['이 계정의 이용 공간이 아닙니다', '로그인이 필요합니다']

/** 1×1 PNG — 커버로 올릴 가장 작은 진짜 PNG (29-31) */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const STAMP = Date.now().toString().slice(-7)
const PARTNER = {
  name: `역할봇설비${STAMP.slice(-3)}`,
  phone: `010${STAMP}1`.slice(0, 11),
  password: 'roles-bot-pass-1!',
  company: `역할봇설비 ${STAMP.slice(-4)}`,
}
const CUSTOMER = {
  name: `역할봇고객${STAMP.slice(-3)}`,
  phone: `010${STAMP}2`.slice(0, 11),
  password: 'roles-bot-pass-2!',
}
const CHAT = {
  fromCustomer: `고객이 보낸 말 ${STAMP}`,
  fromPartner: `업체가 보낸 답 ${STAMP}`,
}

// 29-30: 상담 스트림(SSE)이 늘 열려 있어 networkidle 은 오지 않는다 — bot-kit 의 openPage 가 상한을 두고 기다린다
const open = (page, path) => openPage(page, BASE + path)

async function errorText(page, sel) {
  try {
    await page.waitForSelector(sel, { timeout: 8000 })
    return ((await page.textContent(sel)) ?? '').trim()
  } catch {
    return ''
  }
}

async function login(page, { path = '/login', id, password }) {
  await open(page, path)
  await page.fill('[data-login-id]', id)
  await page.fill('[data-login-password]', password)
  await page.click('[data-login-submit]')
}

/**
 * 가입 한 사람. 인증번호까지 끝내고 로그인된 상태로 둔다.
 *
 * 인증번호 칸과 오류 문구 중 **먼저 오는 것**을 받는다 — 29-20-3 에서 이유를 말하지 않는 실패
 * 하나 때문에 두 번을 헛돌았다.
 */
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
  if (issued === null) {
    throw new Error('화면에 인증번호가 없습니다 — 프리뷰라면 AUTH_DEV_OTP=on 이 들어갔는지 보라')
  }
  await page.fill('[data-otp-input]', issued[1])
  await page.click('[data-otp-submit]')
  await page.waitForTimeout(2000)
}

/**
 * 한 사람이 주소 한 묶음을 걸어 본다.
 *
 * `expect` 가 `'open'` 이면 자기 내용이 떠야 하고, `'refused'` 면 셸이 막아야 한다.
 * 돌려주는 것은 실패한 주소 목록이라, 실패가 **어느 주소인지 이름으로** 말한다.
 */
async function walk(page, paths, expect, label) {
  const bad = []
  for (const path of paths) {
    let body = ''
    try {
      await open(page, path)
      body = (await page.textContent('body').catch(() => '')) ?? ''
    } catch (e) {
      bad.push(`${path} (열다가 죽었다: ${(e.message ?? '').slice(0, 60)})`)
      continue
    }
    const refused = REFUSALS.some((r) => body.includes(r))
    if (expect === 'refused' && !refused) bad.push(`${path} (막히지 않았다)`)
    if (expect === 'open') {
      if (refused) bad.push(`${path} (막혔다)`)
      else if ((await page.locator('h1').count()) === 0) bad.push(`${path} (제목이 없다 — 빈 껍데기)`)
    }
  }
  step(label, bad.length === 0, bad.join(' · '))
  return bad
}

const refusal = refuseUnlessSafeTarget({ remote: REMOTE, db: DB, adminPassword: ADMIN_PASSWORD })
if (refusal !== null) {
  console.error(`[${TAG}] 돌리지 않습니다 — ${refusal}`)
  process.exit(1)
}

console.log(`[${TAG}] ${BASE}${REMOTE !== '' ? ' (배포된 주소)' : ' (로컬)'}`)

const { server, log, waitReady } = startServer({ tag: TAG, port: PORT, remote: REMOTE, base: BASE })

let exitCode = 1
try {
  if (!(await waitReady())) throw new Error('서버가 뜨지 않았습니다\n' + log().slice(-1500))

  const chromium = await loadChromium(TAG)
  const browser = await chromium.launch({ executablePath: findChromium() })
  const ctx = () => browser.newContext({ viewport: { width: 1280, height: 900 } })
  const [adminCtx, partnerCtx, customerCtx] = await Promise.all([ctx(), ctx(), ctx()])
  const [A, P, C] = await Promise.all([adminCtx.newPage(), partnerCtx.newPage(), customerCtx.newPage()])

  // ── 준비: 두 계정을 만들고 파트너를 승인해 둔다 ────────────────────────────
  //
  // 가입 둘은 서로 상관이 없으므로 **같이** 한다. 이 자체가 첫 동시 검사다 — 두 사람이 같은
  // 순간에 가입해도 서로의 인증번호나 세션을 밟지 않아야 한다.
  await Promise.all([signUp(P, 'partner', PARTNER), signUp(C, 'customer', CUSTOMER)])
  step('두 사람이 동시에 가입해도 각자 자기 계정으로 들어간다', true)

  await open(P, '/partner/profile')
  await P.getByLabel('업체명').fill(PARTNER.company)
  await P.getByLabel('대표자').fill('역할봇대표')
  await P.getByLabel('연락처').fill(PARTNER.phone)
  await P.getByLabel('활동 지역').fill('부산·울산')
  await P.locator('form button[role="checkbox"]').first().click()
  // 29-23: 사업자로 낸다 — 서류 게이트를 실제로 지나가야 한다
  await P.click('[data-partner-type="business"]')
  await P.getByRole('button', { name: /파트너 정보 제출/ }).click()
  await P.waitForTimeout(2500)

  await login(A, { path: '/login/admin', id: 'admin', password: ADMIN_PASSWORD })
  await A.waitForURL((u) => /\/admin/.test(u.pathname) && !/\/login/.test(u.pathname), { timeout: 20_000 }).catch(
    () => {},
  )
  // `/login/admin` 도 `/admin` 을 포함한다 — 로그인 화면을 벗어났는지까지 본다(29-18의 함정).
  const adminIn = /\/admin/.test(new URL(A.url()).pathname) && !/\/login/.test(new URL(A.url()).pathname)
  step(
    '관리자로 로그인된다',
    adminIn,
    adminIn
      ? ''
      : `${await errorText(A, '[data-login-error]')} — 저장된 비밀번호가 ADMIN_PASSWORD 와 다를 수 있습니다` +
          ' (auth_state 행이 처음 만들어질 때만 심어집니다)',
  )
  if (!adminIn) throw new Error('관리자로 로그인하지 못해 감사를 진행할 수 없습니다')

  await open(A, '/admin/partners')
  const card = A.locator('article.panel', { hasText: PARTNER.company })
  const listed = await card
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('승인 대기 목록에 그 업체가 보인다', listed)
  if (!listed) throw new Error('승인 목록에 업체가 없어 감사를 진행할 수 없습니다')
  // 29-23: 서류가 없으면 승인이 거절돼야 한다. 이 줄이 없으면 아래 "승인된다"가 공짜로 통과한다.
  const missingShown = await card
    .locator('[data-doc-missing]')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  step('서류를 안 냈으면 승인 화면이 그것을 먼저 말한다', missingShown)

  // 29-24: 승인 전 파트너는 빈 화면 대신 남은 걸음을 본다
  await open(P, '/partner')
  const partnerSteps = await P.locator('[data-welcome-step]').count()
  step('승인 전 파트너에게 남은 걸음이 보인다', partnerSteps === 3, `걸음 ${partnerSteps}개`)

  await card.locator('textarea').fill('역할 감사 봇 — 별도 확인 기록')
  await card.locator('button[role="checkbox"]').click()
  await card.getByRole('button', { name: /파트너 승인/ }).click()
  await A.waitForTimeout(2000)
  await reloadPage(A)
  const stillPending = await A.locator('article.panel', { hasText: PARTNER.company })
    .getByRole('button', { name: /파트너 승인/ })
    .count()
  step('서류 없이는 승인되지 않는다', stillPending === 1, '서류가 없는데 승인이 통과했다')

  // 파트너가 서류 둘을 올린다
  await open(P, '/partner/profile')
  for (const [kind, name] of [
    ['BUSINESS_LICENSE', 'business.pdf'],
    ['TRAVEL_RECORD', 'travel.pdf'],
  ]) {
    await P.setInputFiles(`[data-doc-upload="${kind}"]`, {
      name,
      mimeType: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.4 ${kind} ${STAMP}`),
    })
    await P.waitForTimeout(1500)
  }
  const uploaded = await P.locator('[data-doc-row]').count()
  step('서류 둘이 올라가 목록에 남는다', uploaded === 2, `목록에 ${uploaded}장`)

  // 다시 승인한다 — 이번에는 통과해야 한다
  await open(A, '/admin/partners')
  const card2 = A.locator('article.panel', { hasText: PARTNER.company })
  await card2.waitFor({ state: 'visible', timeout: 20_000 })
  const seen = await card2
    .locator('[data-doc-open="BUSINESS_LICENSE"]')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  step('운영자 화면에 그 서류가 보인다', seen)
  await card2.locator('textarea').fill('역할 감사 봇 — 서류 확인 완료')
  await card2.locator('button[role="checkbox"]').click()
  await card2.getByRole('button', { name: /파트너 승인/ }).click()
  await A.waitForTimeout(2500)

  // 29-23: 로그인 안 한 사람이 /admin 에 오면 관리자 문으로 보낸다. 공개 로그인 화면은 그대로다.
  const anon = await (await ctx()).newPage()
  await open(anon, '/admin/orders')
  const doorHref = await anon.getAttribute('[data-login-door]', 'href').catch(() => null)
  step('로그인 안 한 관리자를 관리자 문으로 보낸다', doorHref === '/login/admin', `안내가 가리키는 곳: ${doorHref}`)
  await open(anon, '/mypage')
  const customerDoor = await anon.getAttribute('[data-login-door]', 'href').catch(() => null)
  step('고객 화면은 그대로 고객 문으로 보낸다', customerDoor === '/login', `안내가 가리키는 곳: ${customerDoor}`)
  await open(anon, '/login')
  step(
    '공개 로그인 화면에는 여전히 관리자 선택지가 없다',
    (await anon.locator('[data-login-role="admin"]').count()) === 0,
  )
  await anon.close()

  // ── 최초 안내와 탈퇴 문 (29-24) ──────────────────────────────────────────
  // 고객은 아직 접수한 것이 없다 — 처음 온 사람이 보는 화면이 바로 이 상태다
  await open(C, '/mypage')
  const welcomed = await C.locator('[data-welcome]').count()
  step('처음 온 고객에게 다음 걸음이 보인다', welcomed === 1, `안내 카드 ${welcomed}개`)
  const goes = await C.locator('[data-welcome-go]')
    .getAttribute('href')
    .catch(() => null)
  step('안내가 가리키는 곳이 접수 화면이다', goes === '/request', `가리킨 곳: ${goes}`)

  // 승인된 뒤에는 안내가 스스로 걷힌다 — 닫는 버튼이 없는 것이 설계다
  await open(P, '/partner')
  const leftover = await P.locator('[data-welcome]').count()
  step('승인된 파트너에게는 안내가 남지 않는다', leftover === 0, `안내 카드 ${leftover}개가 남았다`)

  // 탈퇴 문 — 이 고객은 아직 주문이 없으니 열려 있어야 한다
  await open(C, '/profile')
  const exitCard = await C.locator('[data-account-exit]').count()
  step('고객 계정 화면에 탈퇴 자리가 있다', exitCard === 1)
  const canExit = await C.locator('[data-exit-open]')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  step('거래가 없으면 탈퇴가 열려 있다', canExit, '탈퇴 버튼이 나오지 않았다')

  // 관리자 화면에는 탈퇴가 없다 — 관리자는 소유자가 제거한다(28-89)
  await open(A, '/profile')
  step('관리자 화면에는 탈퇴 자리가 없다', (await A.locator('[data-account-exit]').count()) === 0)

  // ── 동시 감사: 셋이 같은 시각에 움직인다 ──────────────────────────────────
  console.log('\n  — 세 역할 동시 감사 —')
  await Promise.all([
    walk(A, ADMIN_PATHS, 'open', `관리자: 관리자 화면 ${ADMIN_PATHS.length}장이 모두 자기 내용을 그린다`),
    walk(P, ADMIN_PATHS, 'refused', `파트너: 관리자 화면 ${ADMIN_PATHS.length}장이 모두 막힌다`),
    walk(C, ADMIN_PATHS, 'refused', `고객: 관리자 화면 ${ADMIN_PATHS.length}장이 모두 막힌다`),
  ])
  await Promise.all([
    walk(P, PARTNER_PATHS, 'open', `파트너: 자기 화면 ${PARTNER_PATHS.length}장이 열린다`),
    walk(C, CUSTOMER_PATHS, 'open', `고객: 자기 화면 ${CUSTOMER_PATHS.length}장이 열린다`),
  ])

  // ── 실제 채팅: 고객이 업체에 말을 걸고 업체가 답한다 ──────────────────────
  console.log('\n  — 실제 채팅 —')
  await open(C, '/companies')
  const companyLink = C.locator(`a:has-text("${PARTNER.company}")`).first()
  const found = await companyLink
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('승인된 업체가 업체 찾기에 보인다', found)
  if (!found) throw new Error('업체를 찾지 못해 상담을 시작할 수 없습니다')
  // 29-31: 이 주소로 다시 와서 업체가 꾸민 것이 보이는지 본다
  const companyHref = (await companyLink.getAttribute('href')) ?? ''
  await companyLink.click()
  await C.waitForLoadState('load')
  await settle(C)

  await C.click('[data-consult-open]')
  const consultErr = await errorText(C, '[data-consult-error]')
  const goLink = await C.waitForSelector('[data-consult-go]', { timeout: 20_000 }).catch(() => null)
  step('고객이 상담방을 연다', goLink !== null, consultErr)
  if (goLink === null) throw new Error('상담방이 열리지 않아 채팅을 진행할 수 없습니다')
  await goLink.click()
  await C.waitForSelector('[data-room-input]', { timeout: 20_000 })

  await C.fill('[data-room-input]', CHAT.fromCustomer)
  await C.click('[data-room-send]')
  const mine = await C.locator(`[data-room-message]:has-text("${CHAT.fromCustomer}")`)
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('보낸 말이 고객 화면에 남는다', mine, await errorText(C, '[data-room-error]'))

  // 파트너 창은 이 동안 다른 곳에 있었다. 자기 상담 목록으로 가면 그 방이 있어야 한다.
  await open(P, '/consult')
  const room = P.locator('[data-consult-open], [data-consult-list] a').first()
  const hasRoom = await room
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step(
    '업체 쪽 상담 목록에 그 방이 도착한다',
    hasRoom,
    hasRoom ? '' : ((await P.textContent('body').catch(() => '')) ?? '').trim().slice(0, 200),
  )
  if (!hasRoom) throw new Error('업체 쪽에 방이 없어 답장을 진행할 수 없습니다')
  await room.click()
  await P.waitForSelector('[data-room-messages]', { timeout: 20_000 })

  const gotIt = await P.locator(`[data-room-message]:has-text("${CHAT.fromCustomer}")`)
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('고객이 보낸 말이 업체 화면에 그대로 있다', gotIt, gotIt ? '' : '방은 열렸는데 그 말이 없다')

  await P.fill('[data-room-input]', CHAT.fromPartner)
  await P.click('[data-room-send]')
  const replied = await P.locator(`[data-room-message]:has-text("${CHAT.fromPartner}")`)
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('업체가 답장을 보낸다', replied, await errorText(P, '[data-room-error]'))

  await reloadPage(C)
  const heard = await C.locator(`[data-room-message]:has-text("${CHAT.fromPartner}")`)
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('업체의 답이 고객 화면에 도착한다', heard, heard ? '' : '새로고침했는데도 답이 없다')

  // 남이 남의 상담방을 열지 못한다. 주소를 그대로 들고 가 본다.
  const roomUrl = new URL(C.url()).pathname
  await open(A, roomUrl)
  const adminBody = (await A.textContent('body').catch(() => '')) ?? ''
  step(
    '관리자도 남의 상담방 내용을 그냥 보지는 못한다',
    !adminBody.includes(CHAT.fromCustomer),
    '관리자 화면에 고객의 말이 그대로 보인다',
  )

  // ── 업체가 꾸민 페이지가 손님에게 보인다 (29-31) ──────────────────────────
  //
  // 29-15 부터 편집기는 커버·로고·강조 색을 저장해 왔지만 그것을 읽는 손님 화면이 없었다. 저장되는 것과
  // 보이는 것은 다르다 — 그 사이를 화면으로 걸어서 잰다.
  console.log('\n  — 업체 페이지 꾸미기 —')
  await open(P, '/partner/company/editor')
  await P.locator('[data-page-editor]').waitFor({ timeout: 20_000 })
  await P.setInputFiles('[data-photo-upload="cover"]', { name: 'cover.png', mimeType: 'image/png', buffer: PNG })
  const coverPicked = await P.locator('[data-photo-pick="cover"] button[aria-pressed="true"]')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('올린 사진이 커버로 골라진다', coverPicked, await errorText(P, '[data-editor-error]'))

  await P.click('[data-editor-save]')
  await P.locator('[data-editor-notice]').waitFor({ timeout: 20_000 })
  await P.click('[data-editor-publish]')
  const published = await P.locator('[data-editor-notice]:has-text("공개했습니다")')
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('공개까지 간다', published, await errorText(P, '[data-editor-error]'))

  await open(C, companyHref)
  // 29-32: `visible` 만으로는 모자라다. CSS 가 높이를 주기 때문에 이미지가 403 으로 깨져도 요소는
  // "보이는" 상태가 된다 — 29-31 이 바로 그래서 커버가 안 나오는 걸 못 잡았다. 브라우저가 그림을
  // 실제로 받았는지는 `naturalWidth` 가 말해 준다(못 받으면 0).
  const cover = C.locator('[data-company-cover]').first()
  const coverSeen = await cover
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step('손님 업체 화면에 커버 자리가 있다', coverSeen, '공개했는데 손님 화면에 커버 요소가 없다')

  const coverLoaded = coverSeen
    ? await cover
        .evaluate(
          (img) =>
            new Promise((done) => {
              const el = /** @type {HTMLImageElement} */ (img)
              if (el.complete) return done(el.naturalWidth)
              el.addEventListener('load', () => done(el.naturalWidth), { once: true })
              el.addEventListener('error', () => done(0), { once: true })
              setTimeout(() => done(el.naturalWidth), 10_000)
            }),
        )
        .catch(() => 0)
    : 0
  step(
    '그 커버 그림이 실제로 내려온다 (naturalWidth > 0)',
    coverLoaded > 0,
    `naturalWidth=${coverLoaded} — 요소는 있는데 그림을 못 받았다`,
  )

  // 꾸민 순서대로 블록이 늘어선다 — 기본값은 소개 → 사례 → 질문이다
  const order = await C.locator('[data-showcase-section]').evaluateAll((ns) =>
    ns.map((n) => n.getAttribute('data-showcase-section')),
  )
  step(
    '공개본의 영역 순서대로 그린다',
    order.join(',') === 'intro,portfolio,qna',
    `순서: ${order.join(',') || '(없음)'}`,
  )

  await browser.close()
  exitCode = finish()
} catch (e) {
  console.error(`[${TAG}] 실행 중 오류:`, e)
  const tail = log().slice(-1500)
  if (tail !== '') console.error('\n--- 서버 로그 ---\n' + tail)
  exitCode = 1
} finally {
  server?.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  process.exit(exitCode)
}
