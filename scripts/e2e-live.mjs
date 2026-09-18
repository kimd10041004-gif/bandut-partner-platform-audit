/**
 * 실사용 여러 갈래를 걸어 본다 (29-25).
 *
 * ## 왜 또 봇인가
 *
 * 앞의 봇 넷은 **성공하는 길**을 데스크톱 폭에서 곧게 걷는다. 실제 사용자는 그렇게 쓰지 않는다.
 * 휴대폰으로 열고, 비밀번호를 틀리고, 새로고침하고, 접수했다가 취소한다.
 *
 * 그리고 29-25 가 고친 **운영 대시보드**는 아직 아무 봇도 화면으로 본 적이 없다. 지표가 통째로
 * 죽어 있던 자리인데, 숫자가 실제로 그려지는지를 사람 눈 대신 여기서 잰다.
 *
 * ## 네 갈래
 *
 * **가. 휴대폰 폭(390×844)** — 접수 위저드가 좁은 화면에서도 끝까지 간다.
 * **나. 새로고침과 뒤로 가기** — 화면을 다시 그려도 내 것이 그대로 있다.
 * **다. 거절** — 틀린 비밀번호, 중복 가입, 로그인 없이 남의 주소. 셋 다 **이유를 말해야** 한다.
 * **라. 운영 대시보드** — 숫자와 날짜별 접수가 실제로 그려진다(29-25-01 의 화면 증거).
 * **마. 취소** — 사유 없이는 못 지우고, 지우면 화면이 취소라고 말한다.
 */
import {
  loadChromium,
  findChromium,
  startServer,
  reporter,
  refuseUnlessSafeTarget,
  openPage,
  reloadPage,
  settle,
} from './bot-kit.mjs'

const TAG = 'e2e:live'
const PORT = Number(process.env.E2E_LIVE_PORT ?? 3240)
const REMOTE = process.env.E2E_BASE ?? ''
const BASE = REMOTE !== '' ? REMOTE.replace(/\/$/, '') : `http://127.0.0.1:${PORT}`
const DB = process.env.DATABASE_URL ?? ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''

const { step, finish } = reporter(TAG)

/** 휴대폰 한 대 — 가장 흔한 폭이다 */
const PHONE_VIEWPORT = { width: 390, height: 844 }

const STAMP = Date.now().toString().slice(-7)
const CUSTOMER = {
  name: `실사용고객${STAMP.slice(-3)}`,
  phone: `010${STAMP}8`.slice(0, 11),
  password: 'live-bot-pass-1!',
}
const ORDER = {
  description: `실사용 감사 봇이 휴대폰으로 넣은 요청입니다 ${STAMP}. 안방 커튼 교체가 필요합니다.`,
  city: '서울',
  district: '은평구',
  address: `실사용로 ${STAMP.slice(-3)} 202동 302호`,
  phone: '01077778888',
  date: new Date(Date.now() + 9 * 3600_000 + 7 * 86400_000).toISOString().slice(0, 10),
}
/** 오늘의 한국 날짜 — 대시보드의 날짜별 표가 이 날로 묶어야 한다 */
const TODAY_KST = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

// 29-30: 상담 스트림(SSE)이 늘 열려 있어 networkidle 은 오지 않는다 — bot-kit 의 openPage 가 상한을 두고 기다린다
const open = (page, path) => openPage(page, BASE + path)
const body = async (page) => (await page.textContent('body').catch(() => '')) ?? ''

let where = '시작 전'
const at = (name) => {
  where = name
}

async function dump(pages) {
  console.error(`\n[${TAG}] 넘어진 자리: ${where}`)
  for (const [who, page] of pages) {
    if (page === undefined) continue
    const text = (await body(page)).replace(/\s+/g, ' ').trim()
    console.error(`  ${who} ${page.url()}`)
    console.error(`    ${text.slice(0, 300)}`)
    await page.screenshot({ path: `/tmp/live-fail-${who}.png` }).catch(() => {})
  }
}

/** 가입 한 사람. 인증번호는 화면에 뜬다(문자 미연결 상태의 개발 편의) */
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
  const otp = await page
    .waitForSelector('[data-otp-input]', { timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  if (!otp) {
    const why = ((await page.textContent('[data-signup-error]').catch(() => '')) ?? '').trim()
    throw new Error(`${role} 가입이 거절됐습니다: ${why || '(오류 문구도 인증번호 칸도 없다)'}`)
  }
  const issued = ((await page.textContent('[data-otp-issued]').catch(() => '')) ?? '').match(/(\d{4,8})/)
  if (issued === null) throw new Error('화면에 인증번호가 없습니다')
  await page.fill('[data-otp-input]', issued[1])
  await page.click('[data-otp-submit]')
  await page.waitForTimeout(2000)
}

/** 위저드의 다음 걸음. 안 넘어가면 화면이 말한 이유를 들고 던진다 */
async function advance(page, name) {
  await page.getByRole('button', { name }).click()
  const current = page.locator('.steps [aria-current="step"]')
  await current
    .filter({ hasText: name })
    .waitFor({ timeout: 8000 })
    .catch(async () => {
      const why = (
        (await page
          .locator('.error')
          .first()
          .textContent()
          .catch(() => '')) ?? ''
      ).trim()
      throw new Error(`위저드가 '${name}' 로 넘어가지 않았다 — 화면의 이유: ${why || '(없다)'}`)
    })
}

/** 라딕스 Select 하나를 고른다 */
async function pick(page, label, option) {
  await page.locator(`[aria-label="${label}"]`).click()
  await page.getByRole('option', { name: option, exact: true }).first().click()
  await page.waitForTimeout(400)
}

const refusal = refuseUnlessSafeTarget({ remote: REMOTE, db: DB, adminPassword: ADMIN_PASSWORD })
if (refusal !== null) {
  console.error(`[${TAG}] 돌리지 않습니다 — ${refusal}`)
  process.exit(1)
}

console.log(`[${TAG}] ${BASE}${REMOTE !== '' ? ' (배포된 주소)' : ' (로컬)'}`)

const { server, log, waitReady } = startServer({ tag: TAG, port: PORT, remote: REMOTE, base: BASE })

let exitCode = 1
/** `catch` 에서도 화면을 봐야 해서 `try` 밖에 둔다 */
let M, A, G
try {
  if (!(await waitReady())) throw new Error('서버가 뜨지 않았습니다\n' + log().slice(-1500))

  const chromium = await loadChromium(TAG)
  const browser = await chromium.launch({ executablePath: findChromium() })
  /** 휴대폰 한 대, 데스크톱 관리자 한 명, 그리고 로그인하지 않은 손님 한 명 */
  const phoneCtx = await browser.newContext({ viewport: PHONE_VIEWPORT, isMobile: true, hasTouch: true })
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  ;[M, A, G] = await Promise.all([phoneCtx.newPage(), adminCtx.newPage(), guestCtx.newPage()])

  // ── 가. 휴대폰 폭에서 가입하고 접수한다 ──────────────────────────────────
  at('휴대폰 가입')
  await signUp(M, 'customer', CUSTOMER)
  step('휴대폰 폭에서 가입이 끝난다', !(await body(M)).includes('인증번호'), '인증 화면에서 못 빠져나왔다')

  at('휴대폰 접수 화면')
  await open(M, '/request')
  const wizard = M.locator('.request-card')
  await wizard.waitFor({ timeout: 30_000 })
  const box = await wizard.boundingBox()
  step(
    '접수 화면이 휴대폰 폭을 넘지 않는다',
    box !== null && box.width <= PHONE_VIEWPORT.width,
    `카드 폭 ${Math.round(box?.width ?? 0)}px 가 화면 ${PHONE_VIEWPORT.width}px 보다 넓다`,
  )
  const scrollsSideways = await M.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  step('휴대폰에서 옆으로 밀리지 않는다', !scrollsSideways, '가로 스크롤이 생겼다')

  at('휴대폰 위저드 네 걸음')
  await M.locator('button[role="checkbox"][aria-label="커튼·블라인드"]').click()
  await advance(M, '작업 내용')
  await M.locator('textarea').first().fill(ORDER.description)
  await advance(M, '방문 정보')
  await pick(M, '시도', ORDER.city)
  await pick(M, '시군구', ORDER.district)
  await M.getByLabel('상세주소').fill(ORDER.address)
  await M.getByLabel('연락처').fill(ORDER.phone)
  await M.getByLabel('희망 방문일').fill(ORDER.date)
  await advance(M, '최종 확인')
  await M.locator('.check-line button[role="checkbox"]').last().click()
  await M.getByRole('button', { name: /작업 요청 접수/ }).click()
  await M.waitForURL(/\/mypage\//, { timeout: 45_000 })
  const orderId = (M.url().match(/\/mypage\/([^/?#]+)/) ?? [])[1] ?? ''
  step('휴대폰으로 접수가 끝난다', orderId !== '', '접수 뒤 주문 주소로 가지 않았다')
  if (orderId === '') throw new Error('주문 번호를 얻지 못해 더 갈 수 없습니다')

  // ── 나. 새로고침하고, 뒤로 갔다 돌아온다 ────────────────────────────────
  at('새로고침')
  await reloadPage(M)
  await M.waitForTimeout(1500)
  const afterReload = await body(M)
  step(
    '새로고침해도 로그인이 풀리지 않는다',
    !afterReload.includes('로그인이 필요합니다') && !M.url().includes('/login'),
    '새로고침 한 번에 로그인 화면으로 튕겼다',
  )
  step('새로고침해도 접수 내용이 그대로 있다', afterReload.includes(ORDER.address), '내가 적은 주소가 사라졌다')

  at('뒤로 갔다 돌아오기')
  await open(M, '/mypage')
  step('내 요청 목록에 방금 접수한 것이 있다', (await body(M)).includes(ORDER.description.slice(0, 20)), '목록에 없다')
  await M.goBack({ waitUntil: 'load' })
  await M.goForward({ waitUntil: 'load' })
  await settle(M)
  await M.waitForTimeout(1500)
  step(
    '뒤로·앞으로 가도 화면이 깨지지 않는다',
    (await body(M)).includes(ORDER.description.slice(0, 20)),
    '브라우저 뒤로 가기 뒤에 목록이 비었다',
  )

  // ── 다. 거절되는 길 ────────────────────────────────────────────────────
  at('비밀번호 틀리기')
  await open(G, '/login')
  await G.fill('[data-login-id]', CUSTOMER.phone)
  await G.fill('[data-login-password]', 'definitely-not-the-password')
  await G.click('[data-login-submit]')
  await G.waitForTimeout(2500)
  const loginBody = await body(G)
  step(
    '비밀번호가 틀리면 이유와 남은 시도를 알려 준다',
    loginBody.includes('일치하지 않습니다') && /남은 시도/.test(loginBody),
    `거절 문구가 기대와 다르다: ${loginBody.slice(0, 120)}`,
  )
  step('틀린 로그인으로는 안으로 들어가지 못한다', G.url().includes('/login'), '비밀번호가 틀렸는데 통과했다')

  at('같은 번호로 다시 가입')
  await open(G, '/signup/customer')
  await G.click('[data-signup-role="customer"]')
  await G.fill('[data-signup-name]', '중복 가입 시도')
  await G.fill('[data-signup-phone]', CUSTOMER.phone)
  await G.fill('[data-signup-password]', 'another-pass-1!')
  const guestBoxes = G.locator('button[role="checkbox"]')
  for (let i = 0; i < Math.min(await guestBoxes.count(), 2); i += 1) {
    if ((await guestBoxes.nth(i).getAttribute('data-state')) !== 'checked') await guestBoxes.nth(i).click()
  }
  await G.click('[data-signup-submit]')
  await G.waitForTimeout(2500)
  const dupError = ((await G.textContent('[data-signup-error]').catch(() => '')) ?? '').trim()
  step(
    '이미 쓰는 번호로는 다시 가입할 수 없고, 화면이 그렇게 말한다',
    dupError !== '' && (await G.locator('[data-otp-input]').count()) === 0,
    dupError === '' ? '중복 가입이 그냥 통과했다' : `거절은 했는데 이유가 없다: ${dupError}`,
  )

  at('로그인 없이 남의 주소 열기')
  await open(G, `/mypage/${orderId}`)
  await G.waitForTimeout(2000)
  const guestOnOrder = await body(G)
  step(
    '로그인하지 않으면 남의 주문 내용이 보이지 않는다',
    !guestOnOrder.includes(ORDER.address) && !guestOnOrder.includes(ORDER.phone),
    '로그인 없이도 상세주소·연락처가 보인다',
  )
  step(
    '왜 못 보는지 화면이 말한다',
    /로그인|권한|확인할 수 없/.test(guestOnOrder),
    '빈 화면만 주고 이유를 말하지 않는다',
  )

  // ── 라. 운영 대시보드 — 29-25-01 이 죽여 놨던 자리 ────────────────────────
  at('관리자 로그인')
  await open(A, '/login/admin')
  await A.fill('[data-login-id]', 'admin')
  await A.fill('[data-login-password]', ADMIN_PASSWORD)
  await A.click('[data-login-submit]')
  await A.waitForTimeout(2500)

  at('운영 대시보드')
  await open(A, '/admin')
  await A.locator('.stat-grid').waitFor({ timeout: 30_000 })
  const dashBody = await body(A)
  step(
    '운영 대시보드가 오류 없이 열린다',
    !/syntax error|out of range|불러오지 못/.test(dashBody),
    `대시보드가 저장소 오류를 내보인다: ${dashBody.slice(0, 200)}`,
  )
  const firstMetric = ((await A.locator('.metric-value').first().textContent()) ?? '').trim()
  step(
    '전체 접수 숫자가 실제로 그려진다',
    /^[1-9]/.test(firstMetric),
    `접수가 한 건 있는데 화면의 값이 '${firstMetric}' 이다`,
  )
  step(
    '최근 30일 접수 그래프가 그려진다',
    (await A.locator('.metrics-chart').count()) > 0,
    '날짜별 집계가 비어 그래프가 없다 — 29-25-01 이 죽여 놨던 자리다',
  )
  await A.locator('details', { hasText: '최근 30일 접수' })
    .first()
    .click()
    .catch(() => {})
  await A.waitForTimeout(500)
  step(
    '날짜별 표가 오늘(한국 날짜)로 묶는다',
    (await body(A)).includes(TODAY_KST),
    `오늘 한국 날짜 ${TODAY_KST} 가 표에 없다 — UTC 로 묶였을 수 있다`,
  )

  // ── 마. 취소 — 사유 없이는 못 지운다 ───────────────────────────────────
  at('취소 사유 없이 눌러 보기')
  await open(M, `/mypage/${orderId}`)
  await M.getByRole('button', { name: '요청 취소' }).first().click()
  const alert = M.locator('[role="alertdialog"]')
  await alert.waitFor({ timeout: 20_000 })
  const confirm = alert.getByRole('button', { name: '요청 취소' })
  step('취소 사유를 안 적으면 확정 버튼이 눌리지 않는다', await confirm.isDisabled(), '사유 없이도 취소가 눌린다')

  at('사유를 적고 취소')
  await alert.locator('textarea').fill('실사용 감사 봇 — 일정이 맞지 않아 취소합니다.')
  await confirm.click()
  await alert.waitFor({ state: 'detached', timeout: 30_000 })
  await M.waitForTimeout(2500)
  step('취소하면 화면이 취소라고 말한다', (await body(M)).includes('취소'), '취소했는데 상태가 그대로다')

  at('취소 뒤 목록')
  await open(M, '/mypage')
  step(
    '취소한 요청도 내 목록에는 기록으로 남는다',
    (await body(M)).includes(ORDER.description.slice(0, 20)),
    '취소했더니 기록까지 사라졌다',
  )

  // ── 바. 이메일로 비밀번호를 찾는다 (29-27) ─────────────────────────────
  // 휴대폰(M)은 로그인된 채로 둔다. 다른 창(G)에서 이메일로 비밀번호를 바꾸면 **M 의 세션이 죽어야 한다** —
  // 비밀번호를 도둑맞아 바꾸는 것이라면 도둑의 세션이 살아 있는 복구는 복구가 아니다.
  const EMAIL = `live-${STAMP}@example.test`
  const NEW_PASSWORD = 'live-bot-new-pass-2!'
  at('내 계정에서 이메일 등록')
  await open(M, '/profile')
  const security = M.locator('[data-account-security]')
  await security.waitFor({ timeout: 20_000 })
  await security.locator('[data-email-input]').fill(EMAIL)
  await security.locator('[data-email-save]').click()
  await security.locator('[data-email-otp]').waitFor({ timeout: 20_000 })
  const emailCode = (
    (await security
      .locator('[data-email-issued]')
      .textContent()
      .catch(() => '')) ?? ''
  ).match(/(\d{6})/)
  step('이메일을 등록하면 인증번호가 발급된다', emailCode !== null, '인증번호 안내가 없다')

  at('이메일 인증')
  await security.locator('[data-email-otp]').fill(emailCode?.[1] ?? '000000')
  await security.locator('[data-email-verify]').click()
  await security
    .locator('[data-email-status="verified"]')
    .waitFor({ timeout: 20_000 })
    .catch(() => {})
  step(
    '인증번호가 맞으면 인증됨으로 바뀐다',
    (await security.locator('[data-email-status="verified"]').count()) > 0,
    `인증 뒤 상태: ${
      (
        (await security
          .locator('[data-email-status]')
          .textContent()
          .catch(() => '')) ?? ''
      ).trim() || '(상태 표시가 없다)'
    }`,
  )

  at('이메일로 비밀번호 찾기')
  await open(G, '/password/reset?role=customer')
  await G.click('[data-reset-channel="email"]')
  await G.fill('[data-reset-email]', EMAIL)
  await G.click('[data-reset-request]')
  await G.locator('[data-reset-otp]').waitFor({ timeout: 20_000 })
  const resetCode = (
    (await G.locator('[data-reset-issued]')
      .textContent()
      .catch(() => '')) ?? ''
  ).match(/(\d{6})/)
  step('인증된 이메일로 요청하면 인증번호가 나온다', resetCode !== null, '인증번호 안내가 없다')
  await G.fill('[data-reset-otp]', resetCode?.[1] ?? '000000')
  await G.fill('[data-reset-password]', NEW_PASSWORD)
  await G.click('[data-reset-submit]')
  await G.waitForURL(/\/login/, { timeout: 20_000 }).catch(() => {})
  step(
    '새 비밀번호를 정하면 로그인 화면으로 간다',
    G.url().includes('/login'),
    `주소: ${G.url()} · 화면: ${
      (
        (await G.locator('[data-reset-error]')
          .textContent()
          .catch(() => '')) ?? ''
      ).trim() || '(오류 문구 없음)'
    }`,
  )

  at('예전 세션 확인')
  await open(M, '/mypage')
  await M.waitForTimeout(2000)
  const afterReset = await body(M)
  step(
    '비밀번호를 바꾸면 켜 두었던 휴대폰 세션이 풀린다',
    M.url().includes('/login') || /로그인/.test(afterReset),
    '비밀번호를 바꿨는데 예전 기기가 그대로 로그인돼 있다',
  )

  at('새 비밀번호로 로그인')
  await open(G, '/login')
  await G.fill('[data-login-id]', CUSTOMER.phone)
  await G.fill('[data-login-password]', NEW_PASSWORD)
  await G.click('[data-login-submit]')
  await G.waitForURL(/\/mypage/, { timeout: 20_000 }).catch(() => {})
  step(
    '새 비밀번호로 들어온다',
    G.url().includes('/mypage'),
    `주소: ${G.url()} · ${(
      (await G.locator('[data-login-error]')
        .textContent()
        .catch(() => '')) ?? ''
    ).trim()}`,
  )

  console.log('\n  — 휴대폰·거절·대시보드·취소·이메일 복구 —')
  exitCode = finish()
} catch (e) {
  console.error(`[${TAG}] 실행 중 오류:`, e)
  await dump([
    ['phone', M],
    ['admin', A],
    ['guest', G],
  ]).catch(() => {})
  const tail = log().slice(-1500)
  if (tail !== '') console.error('\n--- 서버 로그 ---\n' + tail)
  exitCode = 1
} finally {
  server?.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
}
process.exit(exitCode)
