/**
 * 가입 → 승인 → 권한, 브라우저로 한 바퀴 (29-18).
 *
 * ## 왜 이 검사가 생겼나
 *
 * 이 왕복을 검사하는 것이 이미 둘 있었다. `tests/signupJourney.http.test.ts` 는 **HTTP 로만**
 * 돌고, `e2e:next` 는 화면이 200 인지와 HTML 문자열만 본다. 둘 다 사람이 실제로 겪는 것 —
 * 폼을 채우고, 단추를 누르고, 다음 화면이 뜨는 것 — 을 재지 않는다.
 *
 * 29-16-1 이 그 틈에서 나왔다. `/companies` 는 200 이었고 HTML 도 맞았는데 브라우저로 열면
 * 아이콘이 글줄을 밀어내고 있었다. 화면은 열어 봐야 안다.
 *
 * 그래서 여기서는 **브라우저가 사람 대신 폼을 채운다.** 성공하는 길 하나만 보지 않고, 거절돼야
 * 하는 길도 함께 본다 — 막혀야 할 것이 안 막히는 것은 열려야 할 것이 안 열리는 것보다 나쁘다.
 *
 * ## 재는 것
 *
 *   1  가입 화면에 가입 코드 칸이 없다 (29-21)
 *   2  필수 동의를 안 하면 거절한다
 *   3  파트너 가입 → 인증번호 → 자동 로그인 → 파트너 정보 화면
 *   4  인증번호가 틀리면 거절한다 (3 안에서 먼저 확인한다)
 *   5  같은 번호로 다시 가입하면 거절한다
 *   6  승인 전에는 업체 찾기에 안 보인다
 *   7  업체 정보를 제출하면 검토 대기가 된다
 *   8  관리자가 승인한다
 *   9  승인 뒤 파트너로 다시 로그인하면 권한이 선다
 *  10  승인 뒤 업체 찾기에 보인다
 *  11  공개 로그인 화면에 관리자 선택지가 없다 (29-10)
 *
 * ## 쓰는 것과 안 쓰는 것
 *
 * 계정을 실제로 만든다. 그래서 **이름에 test 가 든 DB 에서만 돈다** — `e2e:server` 와 같은 규칙이다.
 * 지우지는 않는다. 매 실행이 새 휴대폰 번호를 쓰므로 쌓여도 서로 밟지 않는다.
 *
 * 환경: DATABASE_URL(이름에 test 필수) · ADMIN_PASSWORD,
 *       PLAYWRIGHT_CORE_PATH(선택) · CHROMIUM_PATH(선택).
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
// 29-22: 운영 주소 거부는 두 봇이 **한 벌**을 쓴다. 두 벌이 되면 언젠가 한쪽에만 호스트가
// 추가되고, 그날 다른 한쪽이 진짜 손님 데이터 옆에 봇 계정을 만든다.
import { refuseUnlessSafeTarget as safeTarget } from './bot-kit.mjs'

const PORT = Number(process.env.SIGNUP_E2E_PORT ?? 3215)
/**
 * 배포된 주소를 잴 수도 있다 (29-20).
 *
 * `BASE_URL` 이 있으면 서버를 띄우지 않고 그 주소를 그대로 연다. 개발 컨테이너에서는 나가는
 * 연결이 막혀 있어 못 쓰고, GitHub 러너에서만 돈다.
 */
const REMOTE = (process.env.BASE_URL ?? '').replace(/\/$/, '')
const BASE = REMOTE !== '' ? REMOTE : `http://127.0.0.1:${PORT}`
const DB = process.env.DATABASE_URL ?? ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''

let passed = 0
const failures = []

function step(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

/**
 * 계정을 실제로 만드는 검사다. 잘못된 곳을 가리키면 아무것도 하지 않는다.
 *
 * 로컬이면 DB 이름에 `test` 가 있어야 한다(`e2e:server` 와 같은 규칙).
 *
 * 배포된 주소를 잴 때는 **운영을 이름으로 막는다** (29-20). 프리뷰 주소는 브랜치 이름이 들어가
 * 길지만 운영은 `bot-kit.mjs` 의 `PRODUCTION_HOSTS` 셋뿐이다(29-28: 도메인 둘 추가). 실수로 그리로 향하면 진짜 손님
 * 데이터 옆에 봇 계정이 생긴다. 그런 일은 한 번도 일어나면 안 된다.
 */
async function loadChromium() {
  try {
    return (await import('playwright-core')).chromium
  } catch {
    const alt = process.env.PLAYWRIGHT_CORE_PATH
    if (alt && existsSync(alt)) return (await import(pathToFileURL(alt).href)).chromium
    console.error('[e2e:signup] playwright-core를 찾을 수 없습니다. PLAYWRIGHT_CORE_PATH를 지정하세요.')
    process.exit(1)
  }
}

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME ?? '', '.cache', 'ms-playwright')
  if (!existsSync(base)) return undefined
  for (const d of readdirSync(base)) {
    if (!d.startsWith('chromium-')) continue
    for (const exe of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
      const p = join(base, d, exe)
      if (existsSync(p)) return p
    }
  }
  const direct = join(base, 'chromium')
  return existsSync(direct) ? direct : undefined
}

let serverExited = null

async function waitReady(deadlineMs = 60_000) {
  // 지난 실행이 포트를 쥐고 있으면 남의 서버가 200을 준다 — 낡은 빌드를 재게 된다(29-5에서 겪었다).
  await new Promise((r) => setTimeout(r, 1500))
  const until = Date.now() + deadlineMs
  while (Date.now() < until) {
    if (serverExited !== null) {
      console.error(`[e2e:signup] 서버가 먼저 종료됐습니다(code ${serverExited}) — 포트 ${PORT}를 확인하세요`)
      return false
    }
    try {
      const r = await fetch(BASE + '/login', { signal: AbortSignal.timeout(3000) })
      if (r.ok) return serverExited === null
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/** 이 실행만의 번호. 매번 달라야 "이미 가입된 번호" 검사가 제 뜻대로 선다 */
const STAMP = Date.now().toString().slice(-7)
const PARTNER = {
  name: `봇파트너${STAMP.slice(-3)}`,
  phone: `010${STAMP}0`.slice(0, 11),
  password: 'bot-pass-2946!',
  company: `봇설비 ${STAMP.slice(-4)}`,
}

/** shadcn 체크박스는 input 이 아니라 role=checkbox 단추다 */
async function checkAll(page) {
  const boxes = page.locator('button[role="checkbox"]')
  const n = await boxes.count()
  for (let i = 0; i < Math.min(n, 2); i += 1) {
    if ((await boxes.nth(i).getAttribute('data-state')) !== 'checked') await boxes.nth(i).click()
  }
  return n
}

/** 가입 폼 한 장을 채운다. 동의 여부는 부르는 쪽이 정한다 */
async function fillSignup(page, { agree = true, phone = PARTNER.phone } = {}) {
  await page.goto(BASE + '/signup/partner', { waitUntil: 'networkidle', timeout: 45_000 })
  await page.click('[data-signup-role="partner"]')
  await page.fill('[data-signup-name]', PARTNER.name)
  await page.fill('[data-signup-phone]', phone)
  await page.fill('[data-signup-password]', PARTNER.password)
  if (agree) await checkAll(page)
  await page.click('[data-signup-submit]')
}

/** 화면에 뜬 오류 문구. 없으면 빈 문자열이라 "거절됐다"와 "그냥 통과했다"를 구분할 수 있다 */
async function errorText(page, sel) {
  try {
    await page.waitForSelector(sel, { timeout: 8000 })
    return ((await page.textContent(sel)) ?? '').trim()
  } catch {
    return ''
  }
}

async function login(page, { path = '/login/partner', id, password }) {
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45_000 })
  await page.fill('[data-login-id]', id)
  await page.fill('[data-login-password]', password)
  await page.click('[data-login-submit]')
}

const refusal = safeTarget({ remote: REMOTE, db: DB, adminPassword: ADMIN_PASSWORD })
if (refusal !== null) {
  console.error(`[e2e:signup] 돌리지 않습니다 — ${refusal}`)
  process.exit(1)
}

console.log(`[e2e:signup] ${BASE}${REMOTE !== '' ? ' (배포된 주소)' : ' (로컬)'}`)

// 배포된 주소를 잴 때는 띄울 서버가 없다.
const server =
  REMOTE !== ''
    ? null
    : spawn('npx', ['next', 'start', '-p', String(PORT)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      })
let serverLog = ''
if (server !== null) {
  server.stdout.on('data', (d) => (serverLog += d))
  server.stderr.on('data', (d) => (serverLog += d))
  server.on('exit', (code) => (serverExited = code))
}

let exitCode = 1
try {
  if (server !== null && !(await waitReady())) throw new Error('서버가 뜨지 않았습니다\n' + serverLog.slice(-1500))

  const chromium = await loadChromium()
  const browser = await chromium.launch({ executablePath: findChromium() })
  const partner = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await partner.newPage()
  const a = await admin.newPage()

  // 11. 공개 로그인 화면에 관리자 문을 내걸지 않는다 (29-10). 먼저 본다 — 로그인 전 상태라야 한다.
  await p.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 45_000 })
  step('공개 로그인 화면에 관리자 선택지가 없다', (await p.locator('[data-login-role="admin"]').count()) === 0)

  // 1. 가입 코드 칸이 없다 (29-21). 화면에서 사라졌는지는 화면을 열어 봐야 안다.
  await p.goto(BASE + '/signup/partner', { waitUntil: 'networkidle', timeout: 45_000 })
  step('가입 화면에 가입 코드 칸이 없다', (await p.locator('[data-signup-code]').count()) === 0)

  // 2. 필수 동의 없이는 가입할 수 없다
  await fillSignup(p, { agree: false })
  const noConsent = await errorText(p, '[data-signup-error]')
  step('필수 동의 없이는 가입할 수 없다', noConsent !== '', noConsent === '' ? '오류 문구가 없다' : noConsent)

  // 3. 제대로 채우면 인증번호 화면으로 간다.
  //
  // 29-20-3: 여기서 인증번호 칸만 기다리다 죽었다. 가입이 거절되면 화면에는 **오류 문구**가
  // 뜨는데 그것을 읽지 않아, 실패가 "Timeout 15000ms exceeded" 로만 남았다. 무엇이 틀렸는지
  // 아무도 모르는 실패다. 관리자 로그인 쪽은 29-18 에서 같은 이유로 고쳤는데 여기는 빠뜨렸다.
  //
  // 둘 중 먼저 오는 것을 받는다 — 인증번호 칸이면 나아가고, 오류 문구면 그대로 싣고 멈춘다.
  await fillSignup(p)
  const outcome = await Promise.race([
    p
      .waitForSelector('[data-otp-input]', { timeout: 20_000 })
      .then(() => ({ ok: true, text: '' }))
      .catch(() => null),
    p
      .waitForSelector('[data-signup-error]', { timeout: 20_000 })
      .then(async (h) => ({ ok: false, text: ((await h.textContent()) ?? '').trim() }))
      .catch(() => null),
  ])
  if (outcome === null || !outcome.ok) {
    step('가입 신청이 인증번호 화면으로 넘어간다', false, outcome?.text ?? '오류 문구도 인증번호 칸도 뜨지 않았다')
    throw new Error(`가입이 거절돼 다음 단계를 진행할 수 없습니다: ${outcome?.text ?? '(문구 없음)'}`)
  }
  const issued = ((await p.textContent('[data-otp-issued]').catch(() => '')) ?? '').match(/(\d{4,8})/)
  step(
    '가입 신청이 인증번호 화면으로 넘어간다',
    issued !== null,
    '인증번호 화면까지 갔지만 번호가 안 보인다 — 프리뷰에 AUTH_DEV_OTP=on 이 들어갔는지 보라',
  )
  if (issued === null) throw new Error('화면에 인증번호가 없어 다음 단계를 진행할 수 없습니다')

  // 4. 인증번호가 틀리면 거절한다
  await p.fill('[data-otp-input]', '000000')
  await p.click('[data-otp-submit]')
  const badOtp = await errorText(p, '[data-signup-error]')
  step('인증번호가 틀리면 거절한다', badOtp !== '', badOtp === '' ? '오류 문구가 없다' : badOtp)

  // 3-b. 맞는 번호를 넣으면 가입이 끝나고 파트너 정보 화면으로 간다
  await p.fill('[data-otp-input]', issued?.[1] ?? '')
  await p.click('[data-otp-submit]')
  await p.waitForURL(/\/partner\/profile/, { timeout: 20_000 }).catch(() => {})
  step('가입이 끝나면 파트너 정보 화면으로 간다', /\/partner\/profile/.test(p.url()), p.url())

  // 5. 같은 번호로 다시 가입하면 거절한다
  const dupPage = await (await browser.newContext()).newPage()
  await fillSignup(dupPage, {})
  const dup = await errorText(dupPage, '[data-signup-error]')
  step('같은 번호로 다시 가입하면 거절한다', dup !== '', dup === '' ? '오류 문구가 없다' : dup)
  await dupPage.close()

  // 6. 승인 전에는 업체 찾기에 안 보인다
  const before = await (await browser.newContext()).newPage()
  await before.goto(BASE + '/companies', { waitUntil: 'networkidle', timeout: 45_000 })
  step('승인 전에는 업체 찾기에 안 보인다', !(await before.content()).includes(PARTNER.company))

  // 7. 업체 정보를 제출한다
  await p.goto(BASE + '/partner/profile', { waitUntil: 'networkidle', timeout: 45_000 })
  await p.getByLabel('업체명').fill(PARTNER.company)
  await p.getByLabel('대표자').fill('봇대표')
  await p.getByLabel('연락처').fill(PARTNER.phone)
  await p.getByLabel('활동 지역').fill('부산·울산')
  await p.locator('form button[role="checkbox"]').first().click()
  await p.getByRole('button', { name: /파트너 정보 제출/ }).click()
  await p.waitForTimeout(2500)
  await p.reload({ waitUntil: 'networkidle' })
  const submitted = await p.content()
  step('업체 정보를 제출하면 화면에 남는다', submitted.includes(PARTNER.company), '업체명이 화면에 없다')

  // 7-b. 승인 전에는 일감 화면이 열리지 않는다. 이 줄이 없으면 아래 "열린다"가 공짜로 통과한다.
  await p.goto(BASE + '/partner/jobs', { waitUntil: 'networkidle', timeout: 45_000 })
  step('승인 전에는 일감 화면이 막혀 있다', (await p.content()).includes('승인 검토 중입니다'))

  // 8. 관리자가 승인한다.
  //
  // 주소로 재는 자리에 함정이 하나 있다 — 로그인 화면 주소가 `/login/admin` 이라 `/admin` 을
  // 그대로 포함한다. 처음에 그 둘을 구분하지 않아, **로그인이 실패한 채로 통과**가 찍혔다.
  // 그래서 로그인 화면을 벗어났는지를 함께 본다.
  await login(a, { path: '/login/admin', id: 'admin', password: ADMIN_PASSWORD })
  await a
    .waitForURL((u) => /\/admin/.test(u.pathname) && !/\/login/.test(u.pathname), { timeout: 20_000 })
    .catch(() => {})
  const adminIn = /\/admin/.test(new URL(a.url()).pathname) && !/\/login/.test(new URL(a.url()).pathname)
  const adminErr = adminIn ? '' : await errorText(a, '[data-login-error]')
  step(
    '관리자로 로그인된다',
    adminIn,
    adminErr === ''
      ? a.url()
      : `${adminErr} — 저장된 관리자 비밀번호가 ADMIN_PASSWORD 와 다를 수 있습니다.` +
          ' 비밀번호는 auth_state 행이 처음 만들어질 때만 심어집니다(server/authState.ts)',
  )
  if (!adminIn) throw new Error('관리자로 로그인하지 못해 승인 단계를 진행할 수 없습니다')

  // 목록은 하이드레이트 뒤에 fetch 로 온다 — networkidle 은 그 fetch 가 시작되기도 전에 끝날 수 있다.
  // 그래서 화면을 한 번 찍어 보는 대신 줄이 뜰 때까지 기다린다. 안 뜨면 그때 화면을 그대로 싣는다.
  await a.goto(BASE + '/admin/partners', { waitUntil: 'networkidle', timeout: 45_000 })
  const card = a.locator('article.panel', { hasText: PARTNER.company })
  const listed = await card
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  step(
    '승인 대기 목록에 그 업체가 보인다',
    listed,
    listed ? '' : ((await a.textContent('.workspace').catch(() => '')) ?? '').trim().slice(0, 200),
  )
  if (!listed) throw new Error('승인 목록에 업체가 없어 다음 단계를 진행할 수 없습니다')
  await card.locator('textarea').fill('봇 검사 — 별도 확인 기록')
  await card.locator('button[role="checkbox"]').click()
  await card.getByRole('button', { name: /파트너 승인/ }).click()
  await a.waitForTimeout(2500)
  await a.reload({ waitUntil: 'networkidle' })
  step('승인 뒤 대기 상태가 아니다', !/PENDING|검토 대기/.test(await card.textContent().catch(() => '')))

  // 9. 파트너가 다시 로그인하면 권한이 서 있다
  const back = await (await browser.newContext()).newPage()
  await login(back, { id: PARTNER.phone, password: PARTNER.password })
  await back
    .waitForURL((u) => /\/partner/.test(u.pathname) && !/\/login/.test(u.pathname), { timeout: 20_000 })
    .catch(() => {})
  // `/login/partner` 도 `/partner` 를 포함한다. 관리자 쪽과 같은 함정이다.
  const backIn = /\/partner/.test(new URL(back.url()).pathname) && !/\/login/.test(new URL(back.url()).pathname)
  step('승인 뒤 파트너로 다시 로그인된다', backIn, (await errorText(back, '[data-login-error]')) || back.url())

  await back.goto(BASE + '/partner/jobs', { waitUntil: 'networkidle', timeout: 45_000 })
  const jobs = await back.content()
  step(
    '승인 뒤 일감 화면이 열린다',
    !jobs.includes('승인 검토 중입니다') && !jobs.includes('파트너 활동을 준비해 주세요'),
  )

  // 10. 승인 뒤 업체 찾기에 보인다
  const after = await (await browser.newContext()).newPage()
  await after.goto(BASE + '/companies', { waitUntil: 'networkidle', timeout: 45_000 })
  step('승인 뒤 업체 찾기에 보인다', (await after.content()).includes(PARTNER.company))

  await browser.close()

  console.log(`\n[e2e:signup] ${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.log(' - ' + f)
  exitCode = failures.length > 0 ? 1 : 0
} catch (e) {
  console.error('[e2e:signup] 실행 중 오류:', e)
  console.error('\n--- 서버 로그 ---\n' + serverLog.slice(-1500))
  exitCode = 1
} finally {
  server?.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  process.exit(exitCode)
}
