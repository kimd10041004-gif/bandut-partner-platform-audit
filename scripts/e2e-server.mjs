/**
 * 서버 모드 e2e (28-70) — `VITE_AUTH_MODE=server`로 빌드한 dist를 `api-server.mjs --static dist`가 같은 origin에서
 * 서빙하고(Vercel과 같은 구성), 진짜 Postgres 위에서 **기기 셋**(브라우저 컨텍스트 = 기기)이 계정·세션·스냅샷을 주고받는다.
 *
 * 이것이 검증하는 것은 gates job의 로컬 모드 e2e(194단계)가 볼 수 없는 것들이다:
 *  - 가입·OTP·로그인이 /api/auth를 거치고, 토큰이 새로고침을 넘어 세션을 복원한다
 *  - 보기만 하는 기기가 탭 복귀 때 남의 변경을 본다 (28-69-01, head)
 *  - 같은 기기의 두 탭이 서로를 conflict로 만들지 않는다 (28-69-02, 커서)
 *  - 관리자는 ADMIN_PASSWORD로만 들어오고(시연 비밀번호 거부), 승인이 파트너 기기에 도달한다
 *  - 로그아웃한 토큰은 죽는다. 잠금 규칙은 서버에서도 같은 도메인 규칙이다
 *
 * 사용: DATABASE_URL=... ADMIN_PASSWORD=... node scripts/e2e-server.mjs   (dist는 서버 모드로 빌드돼 있어야 한다)
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

// 라운드 표기는 package.json version이 단일 출처다(README) — 여기 박아 두면 라운드마다 깨진다 (28-71).
// 29-1: major까지 읽는다. 예전엔 `28-`이 문자열로 박혀 있어 29.1.0이 `28-1`로 나왔다.
const ROUND = JSON.parse(readFileSync('package.json', 'utf8')).version.split('.').slice(0, 2).join('-')
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { createHash } from 'node:crypto'

const PORT = Number(process.env.E2E_SERVER_PORT ?? 4351)
const DATABASE_URL = process.env.DATABASE_URL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!DATABASE_URL || !ADMIN_PASSWORD) {
  console.error('[e2e:server] DATABASE_URL·ADMIN_PASSWORD가 필요합니다')
  process.exit(2)
}
// 28-70-03a: 이 e2e는 DB를 **비우고** 시작한다. 테스트 DB로 보이지 않으면(이름에 test 없음) 명시적 허용 없이는 돌지 않는다
{
  let dbName = ''
  try {
    dbName = new URL(DATABASE_URL).pathname.replace(/^\//, '')
  } catch {
    dbName = ''
  }
  // 28-71-03a: 단어 경계 — `bandut_latest`·`contest`는 테스트 DB가 아니다
  if (!/(^|[^a-z])test([^a-z]|$)/i.test(dbName) && process.env.E2E_ALLOW_TRUNCATE !== '1') {
    console.error(
      `[e2e:server] 이 DB(${dbName || '?'})는 테스트 DB로 보이지 않습니다 — truncate를 하지 않습니다. E2E_ALLOW_TRUNCATE=1로만 강제할 수 있습니다`,
    )
    process.exit(2)
  }
}

async function loadChromium() {
  try {
    return (await import('playwright-core')).chromium
  } catch {
    const alt = process.env.PLAYWRIGHT_CORE_PATH
    if (alt && existsSync(alt)) return (await import(pathToFileURL(alt).href)).chromium
    console.error('[e2e:server] playwright-core를 찾을 수 없습니다. PLAYWRIGHT_CORE_PATH를 지정하세요.')
    process.exit(2)
  }
}
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME ?? '', '.cache', 'ms-playwright')
  if (existsSync(join(base, 'chromium'))) return join(base, 'chromium')
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      const p = join(base, d, 'chrome-linux', 'chrome')
      if (d.startsWith('chromium-') && existsSync(p)) return p
    }
  }
  return undefined
}

let passed = 0
let failed = 0
const failures = []
function step(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    failures.push(name)
    console.log(`  ✗ ${name}`)
    if (detail !== undefined) console.log(`      ↳ ${String(detail).replace(/\s+/g, ' ').slice(0, 600)}`)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!existsSync('dist/index.html')) {
    console.error('[e2e:server] dist가 없습니다. 먼저 VITE_AUTH_MODE=server npm run build 하세요.')
    process.exit(2)
  }
  // 서버 모드로 빌드됐는가 — 로컬 모드 dist에 초록을 주지 않는다
  const bundles = readdirSync('dist/assets').filter((f) => f.endsWith('.js'))
  const bundleText = bundles.map((f) => readFileSync(join('dist/assets', f), 'utf8')).join('\n')
  if (!bundleText.includes('data-auth-mode')) {
    console.error('[e2e:server] dist에 인증 모드 표기가 없습니다 — 이 라운드의 빌드가 아닙니다')
    process.exit(2)
  }
  const db = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  const q = async (sql, params = []) => (await db.query(sql, params)).rows
  // 이 e2e가 DB를 소유한다 — 깨끗한 상태에서 시작한다(계약 테스트가 남긴 행은 지운다)
  await q('truncate snapshots, auth_state, sessions')

  const server = spawn('node', ['scripts/api-server.mjs', String(PORT), '--static', 'dist'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, DATABASE_URL, ADMIN_PASSWORD },
  })
  let serverLog = ''
  server.stdout.on('data', (b) => {
    serverLog += b.toString()
  })
  server.stderr.on('data', (b) => {
    serverLog += b.toString()
  })
  const url = `http://127.0.0.1:${PORT}`
  const deadline = Date.now() + 60000
  for (;;) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) break
    } catch {}
    if (Date.now() > deadline) {
      console.error(`API 서버 기동 실패\n${serverLog}`)
      process.exit(2)
    }
    await sleep(250)
  }
  const chromium = await loadChromium()
  const browser = await chromium.launch({ executablePath: findChromium() })
  try {
    const t0 = Date.now()
    const trace = (page, tag) => {
      // E2E_TRACE=1: API 왕복을 시간순으로 찍는다 — CI에서 실패 원인을 좁힐 때
      if (!process.env.E2E_TRACE) return page
      page.on('response', (r) => {
        if (r.url().includes('/api/'))
          console.log(
            `    [${((Date.now() - t0) / 1000).toFixed(1)}s ${tag}] ${r.request().method()} ${r.url().replace(url, '')} ${r.status()}`,
          )
      })
      return page
    }
    let tagSeq = 0
    const mk = async (tag = `ctx${(tagSeq += 1)}`) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
      const page = trace(await ctx.newPage(), tag)
      return { ctx, page }
    }
    const text = (page) => page.evaluate(() => document.body.innerText)
    /**
     * 화면에 문구가 나타날 때까지 기다린다 (28-74). 고정 sleep 뒤에 읽으면 첫 요청처럼 느린 경우
     * (풀 생성·첫 쿼리) 아직 안 온 응답을 "실패"로 읽는다 — 실제로 CI가 아니라 로컬에서 한 번 그렇게 났다.
     */
    const waitForText = async (page, needle, ms = 10000) => {
      const until = Date.now() + ms
      for (;;) {
        if ((await text(page)).includes(needle)) return true
        if (Date.now() >= until) return false
        await sleep(200)
      }
    }
    /**
     * 28-76 CI: 조건이 참이 될 때까지 기다린다 — 단언 앞의 **고정 sleep을 없애기 위한** 짝.
     * 28-74가 `waitForText`를 넣고 바로 다음 단계의 `sleep(300)`은 남겨 두었는데, 그것이 28-76 CI에서 터졌다.
     * 같은 모양이 파일에 여섯 곳 있었다 — 하나만 고치면 다음 라운드가 또 같은 자리에서 넘어진다.
     */
    const waitFor = async (fn, ms = 10000) => {
      const until = Date.now() + ms
      for (;;) {
        if (await fn()) return true
        if (Date.now() >= until) return false
        await sleep(200)
      }
    }
    const focus = async (page) => {
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('focus'))
      })
      await sleep(600)
    }
    const tokenOf = (page, role) =>
      page.evaluate((r) => JSON.parse(localStorage.getItem('banded-session-v1') ?? '{}')[r] ?? null, role)

    // ── 기기 A: 파트너 ───────────────────────────────────────────────────────
    const A = await mk('A')
    await A.page.goto(`${url}/#/partner`)
    await A.page.waitForSelector('.card:has-text("파트너 로그인")')
    step(
      `서버 모드 빌드 표기 (data-auth-mode=server, ${ROUND})`,
      (await A.page.getAttribute('.round', 'data-auth-mode')) === 'server' &&
        (await A.page.textContent('.round')) === ROUND,
    )
    step(
      '서버 모드에는 시연 데이터가 없다 — 관리자 시연 계정 안내도 없다',
      !(await text(A.page)).includes('시연용 관리자 계정'),
    )
    await A.page.click('button:has-text("처음이신가요? 회원가입")')
    await A.page.fill('input[placeholder="예: 반듯설비"]', '반듯설비')
    await A.page.fill('input[placeholder="010-0000-0000"]', '010-9999-8888')
    await A.page.fill('input[type="password"]', 'password1')
    await A.page.check('input[aria-label="전체 동의"]')
    await A.page.click('.partner-type button:has-text("사업자")')
    await A.page.fill('input[placeholder="000-00-00000"]', '123-45-67891')
    // 29-21: 가입 코드는 없앴다. 사업자 번호 검증이 그 자리의 첫 거절이다
    await A.page.fill('input[placeholder="000-00-00000"]', '123-45-67890')
    await A.page.click('button:has-text("가입하고 인증번호 받기")')
    const bizRejected = await waitForText(A.page, '사업자 정보 조회에 실패')
    step(
      'A: 서버가 같은 도메인 규칙으로 거부한다 (사업자 정보 조회 실패)',
      bizRejected,
      (await text(A.page)).slice(0, 200),
    )
    await A.page.fill('input[placeholder="000-00-00000"]', '123-45-67891')
    await A.page.click('button:has-text("가입하고 인증번호 받기")')
    await A.page.waitForSelector('.otp-code')
    const partOtp = await A.page.$eval('.otp-code', (el) => el.textContent.trim())
    await A.page.fill('input[aria-label="인증번호"]', partOtp)
    await A.page.click('button:has-text("인증하고 시작하기")')
    await A.page.waitForSelector('.auth-status:has-text("반듯설비님")')
    step(
      'A: 파트너 가입·OTP·로그인이 /api/auth를 거친다',
      (await q('select count(*)::int as n from sessions where role = $1 and revoked_at is null', ['partner']))[0].n ===
        1,
    )
    const authRow = (await q('select body from auth_state where workspace_id = $1', ['main']))[0]
    step(
      'A: 계정은 서버 행(auth_state)에 있고 해시는 scrypt$ 형식이다 (29-29)',
      !!authRow && authRow.body.includes('"phone":"01099998888"') && authRow.body.includes('"passwordHash":"scrypt$'),
    )
    const partnerToken = await tokenOf(A.page, 'partner')
    // 28-70-04a: 이전 단언(token_hash = 원문 행 0개)은 항상 참이었다 — 진짜 단언은 sha256(토큰) 행이 정확히 1개
    const tokenHash = createHash('sha256')
      .update(partnerToken ?? '')
      .digest('hex')
    step(
      'A: 토큰이 브라우저에 있고 서버에는 sha256(토큰) 행만 있다',
      typeof partnerToken === 'string' &&
        partnerToken.length > 30 &&
        (await q('select count(*)::int as n from sessions where token_hash = $1', [tokenHash]))[0].n === 1,
    )
    await A.page.reload()
    await A.page.waitForSelector('.auth-status:has-text("반듯설비님")', { timeout: 10000 })
    step('A: 새로고침 뒤에도 로그인 유지 (토큰 → me → 거울 복원)', true)
    await sleep(2500)
    const snap1 = (await q('select rev, updated_by from snapshots where workspace_id = $1', ['main']))[0]
    step('A: 스냅샷이 서버에 있고 updated_by가 파트너 계정이다', !!snap1 && snap1.updated_by === 'AC-0001')
    const partnerId = snap1?.updated_by

    // ── 기기 B: 고객 ─────────────────────────────────────────────────────────
    const B = await mk('B')
    await B.page.goto(`${url}/`)
    await B.page.waitForSelector('.app-header')
    step('B: 서버 모드 랜딩', !!(await B.page.$('.landing')))
    await B.page.click('.hero-cta button:first-child')
    await B.page.waitForSelector('.card:has-text("고객 로그인")')
    await B.page.click('button:has-text("처음이신가요? 회원가입")')
    await B.page.fill('input[placeholder="예: 김반듯"]', '정지훈')
    await B.page.fill('input[placeholder="010-0000-0000"]', '010-1234-5678')
    await B.page.fill('input[type="password"]', 'password1')
    await B.page.check('input[aria-label="전체 동의"]')
    await B.page.click('button:has-text("가입하고 인증번호 받기")')
    await B.page.waitForSelector('.otp-code')
    const custOtp = await B.page.$eval('.otp-code', (el) => el.textContent.trim())
    await B.page.fill('input[aria-label="인증번호"]', custOtp)
    await B.page.click('button:has-text("인증하고 시작하기")')
    await B.page.waitForSelector('.wizard-steps')
    step('B: 고객 가입·OTP·로그인 (다른 기기)', (await text(B.page)).includes('정지훈님'))
    await sleep(1500) // 첫 접촉: 원격(A의 스냅샷)을 받아들인다 — 그 뒤에 요청을 넣어야 덮이지 않는다
    step(
      'B: 새 기기 합류 — "덮였습니다"가 아니라 "받아들였습니다"만 (반영 안 된 로컬 변경이 없었다)',
      !(await text(B.page)).includes('덮였습니다'),
    )
    await B.page.click('.cat-card[data-category="주방·욕실 공사"]')
    await B.page.selectOption('select[aria-label="시·도"]', '서울') // 28-92: 지역은 select 둘
    await B.page.selectOption('select[aria-label="시·군·구"]', '관악구')
    await B.page.fill('input[aria-label="상세 주소"]', '서버로 1길 1, 1층') // 28-94
    await B.page.fill('input[placeholder="예: 거실 도배 시공, 방 2개 포함"]', '욕실 실리콘 재시공 (서버 e2e)')
    await B.page.click('[data-safety-q="urgent"] button:has-text("아니요")') // 28-93: 안전 질문
    await B.page.click('.q-item button:has-text("곰팡이 있음")')
    await B.page.click('button:has-text("다음")')
    await B.page.waitForSelector('text=언제 방문하면')
    await B.page.click('button:has-text("다음")')
    await B.page.click('.budget-option:has-text("30~50만원")')
    await B.page.click('button:has-text("다음")')
    await B.page.click('button:has-text("입찰 시작하기")')
    const reqSaved = await waitForText(B.page, '요청을 등록했습니다')
    step('B: 고객 요청 등록', reqSaved, (await text(B.page)).slice(0, 200))
    let snap2 = null
    for (let i = 0; i < 40; i += 1) {
      snap2 = (await q('select rev, updated_by, body from snapshots where workspace_id = $1', ['main']))[0]
      if (snap2 && snap2.body.includes('욕실 실리콘 재시공 (서버 e2e)')) break
      await sleep(250)
    }
    step(
      'B: 요청이 서버 스냅샷에 밀어 올라갔다 (디바운스 뒤, updated_by = 고객)',
      !!snap2 && snap2.body.includes('욕실 실리콘 재시공 (서버 e2e)') && snap2.updated_by !== partnerId,
    )

    // ── A: 탭 복귀 → 남의 변경을 본다 (28-69-01) ──────────────────────────────
    // 28-91: 28-85-05의 익명 방문자 절(공개 집계 /api/public-stats)은 공개 지표와 함께 사라졌다.
    await focus(A.page)
    await A.page.click('.tabs button:has-text("일감·입찰")')
    // 28-93: 관리자 검토 전이라 파트너 화면에는 없는 일감이다 — "받아들였다"는 이 기기의 거울(localStorage)로 본다
    const mirrorHas = (page) =>
      waitFor(async () =>
        (await page.evaluate(() => localStorage.getItem('banded-platform-v1') ?? '')).includes(
          '욕실 실리콘 재시공 (서버 e2e)',
        ),
      )
    const aMirror = await mirrorHas(A.page)
    const aText = await text(A.page)
    step(
      'A-1: 보기만 하던 기기가 탭 복귀(head)에서 고객 요청을 받아들인다 (28-69-01) — 거울에 있다',
      aMirror,
      aText.slice(0, 200),
    )
    step('A-1: 검토 전이라 파트너 일감 목록에는 없다 (28-93)', !aText.includes('욕실 실리콘 재시공 (서버 e2e)'))
    step('A-1: 안내는 "받아들였습니다" — 덮인 로컬 변경이 없으니 "덮였습니다"가 아니다', !aText.includes('덮였습니다'))
    step('A: 승인 전 입찰 차단 배너 (거울의 approval=pending)', (await A.page.$('.approval-banner.pending')) !== null)

    // ── 28-70-02: 손상 리셋 — 빈 로컬이 낡은 커서를 들고 서버를 덮지 않는다 ─────────
    const revBeforeReset = Number((await q('select rev from snapshots where workspace_id = $1', ['main']))[0].rev)
    await A.page.evaluate(() => {
      localStorage.setItem('banded-platform-v1', '{손상된 JSON')
    }) // :rev와 커서는 남는다
    await A.page.reload()
    await A.page.waitForSelector('.auth-status:has-text("반듯설비님")', { timeout: 10000 })
    await sleep(2500)
    await A.page.click('.tabs button:has-text("일감·입찰")')
    const resetMirror = await mirrorHas(A.page)
    const afterReset = (await q('select rev, body from snapshots where workspace_id = $1', ['main']))[0]
    step(
      'A: 손상 리셋 뒤 서버 스냅샷이 빈 본문으로 덮이지 않았다 (28-70-02)',
      Number(afterReset.rev) === revBeforeReset && afterReset.body.includes('욕실 실리콘 재시공 (서버 e2e)'),
    )
    step('A: 리셋된 브라우저는 새 기기처럼 원격을 받아들였다 (거울에 있다)', resetMirror)

    // ── 28-70-03b: 세션 정리 — 30일 지난 만료·폐기 세션은 로그인 때 사라진다 ─────────
    await q(
      "insert into sessions (token_hash, workspace_id, account_id, role, name, issued_at, expires_at) values (repeat('0', 64), 'main', 'AC-9999', 'customer', '옛날', now() - interval '40 days', now() - interval '39 days')",
    )
    await q(
      "insert into sessions (token_hash, workspace_id, account_id, role, name, issued_at, expires_at, revoked_at) values (repeat('1', 64), 'main', 'AC-9999', 'customer', '옛날', now() - interval '40 days', now() + interval '1 day', now() - interval '31 days')",
    )

    // ── 기기 C: 관리자 ───────────────────────────────────────────────────────
    const C = await mk('C')
    await C.page.goto(`${url}/#/admin`)
    await C.page.waitForSelector('.card:has-text("관리자 로그인")')
    await C.page.fill('input[placeholder="admin"]', 'admin')
    await C.page.fill('input[type="password"]', 'bandut1234!')
    await C.page.click('.card:has-text("관리자 로그인") button:has-text("로그인")')
    const demoRejected = await waitForText(C.page, '관리자 계정 정보가 일치하지 않습니다')
    step(
      'C: 시연 비밀번호(bandut1234!)로는 관리자 로그인 불가 — ADMIN_PASSWORD만',
      demoRejected,
      (await text(C.page)).slice(0, 200),
    )
    await C.page.fill('input[type="password"]', ADMIN_PASSWORD)
    await C.page.click('.card:has-text("관리자 로그인") button:has-text("로그인")')
    await C.page.waitForSelector('.auth-status:has-text("관리자님")')
    step(
      'C: 로그인 성공이 30일 지난 만료·폐기 세션을 지웠다 (28-70-03b)',
      (await q("select count(*)::int as n from sessions where account_id = 'AC-9999'"))[0].n === 0,
    )
    await C.page.click('.tabs button:has-text("회원")')
    await waitForText(C.page, '반듯설비')
    const cText = await text(C.page)
    step(
      'C: 관리자 회원 목록에 다른 기기에서 가입한 둘이 있다 (서버 거울, complete)',
      cText.includes('반듯설비') && cText.includes('정지훈'),
    )
    await C.page.click('.tabs button:has-text("현황")')
    const opsRow = await waitFor(
      async () => (await C.page.locator('.ops-card [data-ops="approval"] .list-row').count()) === 1,
    )
    step('C: 조치 필요 — 승인 대기 파트너 1건', opsRow)
    await C.page.click('.ops-card [data-ops="approval"] button:has-text("승인")')
    const approvedOnServer = await waitFor(async () =>
      (await q('select body from auth_state where workspace_id = $1', ['main']))[0].body.includes(
        '"approval":"approved"',
      ),
    )
    step('C: 승인 → 서버 auth_state에 approved', approvedOnServer)

    // ── 28-93: 접수 검토 — 다른 기기(B)의 요청이 C의 거울에 와 있고, 검토 완료가 서버까지 올라간다 ──
    const reviewRow = C.page.locator('.ops-card [data-ops="review"] [data-review]', {
      hasText: '욕실 실리콘 재시공 (서버 e2e)',
    })
    const reviewSeen = await waitFor(async () => (await reviewRow.count()) === 1)
    step('C: 접수 검토 필요 1건 — B가 올린 요청(작업 범위 검토)', reviewSeen)
    for (const box of await reviewRow.locator('input[type="checkbox"]').all()) await box.check()
    await reviewRow.locator('input[aria-label="검토 사유"]').fill('고객 통화로 현장·범위 확인')
    await reviewRow.locator('button:has-text("검토 완료")').click()
    const reviewOnServer = await waitFor(async () =>
      /"review":\s*\{/.test((await q('select body from snapshots where workspace_id = $1', ['main']))[0].body),
    )
    step(
      'C: 검토 완료 → 서버 스냅샷에 review 기록 (파트너에게 공개)',
      reviewOnServer,
      (await text(C.page)).slice(0, 400),
    )

    // ── 28-89-A: 관리자 등급이 서버에서 실제로 막히는가 ─────────────────────────
    step(
      'C: 소유자 세션의 등급 태그 + sessions.grade = owner',
      (await C.page.$('[data-session-grade="owner"]')) !== null &&
        (
          await q(
            "select count(*)::int as n from sessions where role = 'admin' and revoked_at is null and grade = 'owner'",
          )
        )[0].n === 1,
    )
    await C.page.click('.tabs button:has-text("회원")')
    await C.page.fill('input[aria-label="새 관리자 아이디"]', 'viewer1')
    await C.page.fill('input[aria-label="새 관리자 이름"]', '열람이')
    await C.page.selectOption('select[aria-label="새 관리자 등급"]', 'viewer')
    await C.page.fill('input[aria-label="새 관리자 비밀번호"]', 'viewer-pass-1')
    await C.page.click('[data-admin-add]')
    const viewerOnServer = await waitFor(async () =>
      (await q('select body from auth_state where workspace_id = $1', ['main']))[0].body.includes('"id":"viewer1"'),
    )
    step(
      'C: 열람 관리자 추가 → 서버 auth_state 에 있고 해시는 scrypt$ (28-89-A · 29-29)',
      viewerOnServer &&
        /"id":"viewer1"[^}]*"passwordHash":"scrypt\$/.test(
          (await q('select body from auth_state where workspace_id = $1', ['main']))[0].body,
        ),
    )
    // 열람 관리자로 직접 로그인해 토큰을 얻고, 그 토큰으로 API 를 친다 — 화면이 아니라 서버가 막는지 본다
    const viewerLogin = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'login', args: ['admin', 'viewer1', 'viewer-pass-1'] }),
    })
    const viewerBody = await viewerLogin.json()
    const viewerToken = viewerBody?.token ?? null
    step(
      'viewer1: 서버 로그인 200 + 세션 등급 viewer',
      viewerLogin.status === 200 && viewerBody?.result?.grade === 'viewer',
      `status=${viewerLogin.status} body=${JSON.stringify(viewerBody).slice(0, 200)}`,
    )
    const vh = { 'content-type': 'application/json', authorization: `Bearer ${viewerToken}` }
    const vList = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers: vh,
      body: JSON.stringify({ op: 'listAccounts', args: [] }),
    })
    const vApprove = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers: vh,
      body: JSON.stringify({ op: 'setSuspended', args: [partnerId, true] }),
    })
    const vAdd = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers: vh,
      body: JSON.stringify({ op: 'addAdmin', args: ['hacker1', 'x', 'owner', 'hacker-pass-1'] }),
    })
    step(
      'viewer1: 목록은 200, 정지·관리자 추가는 403 — 서버가 막는다 (28-89-A)',
      vList.status === 200 && vApprove.status === 403 && vAdd.status === 403,
      `list ${vList.status} suspend ${vApprove.status} add ${vAdd.status}`,
    )
    const snapNow = (await q('select rev, body from snapshots where workspace_id = $1', ['main']))[0]
    const vPut = await fetch(`${url}/api/snapshot?workspace=main`, {
      method: 'PUT',
      headers: vh,
      body: JSON.stringify({ body: snapNow.body, expectedRev: Number(snapNow.rev) }),
    })
    const snapAfterPut = (await q('select rev from snapshots where workspace_id = $1', ['main']))[0]
    step(
      'viewer1: 스냅샷 PUT 은 403 이고 rev 가 그대로다 (28-89-A)',
      vPut.status === 403 && Number(snapAfterPut.rev) === Number(snapNow.rev),
      `put ${vPut.status} rev ${snapNow.rev} → ${snapAfterPut.rev}`,
    )
    const vGet = await fetch(`${url}/api/snapshot?workspace=main`, { headers: vh })
    step('viewer1: 스냅샷 GET 은 200 — 보기는 된다', vGet.status === 200)
    // 등급을 매니저로 올리면 그 토큰은 폐기된다 — 옛 등급이 토큰에 남지 않는다
    const promote = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenOf(C.page, 'admin')}` },
      body: JSON.stringify({ op: 'setAdminGrade', args: ['viewer1', 'manager'] }),
    })
    const vAfterPromote = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers: vh,
      body: JSON.stringify({ op: 'me', args: [] }),
    })
    step(
      '소유자가 등급 변경 → 바뀐 관리자의 옛 토큰은 401 (28-89-A)',
      promote.status === 200 && vAfterPromote.status === 401,
      `promote ${promote.status} old-token ${vAfterPromote.status}`,
    )
    const mgrLogin = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'login', args: ['admin', 'viewer1', 'viewer-pass-1'] }),
    })
    const mgrBody = await mgrLogin.json()
    const mh = { 'content-type': 'application/json', authorization: `Bearer ${mgrBody?.token ?? ''}` }
    const mAdd = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers: mh,
      body: JSON.stringify({ op: 'addAdmin', args: ['hacker1', 'x', 'owner', 'hacker-pass-1'] }),
    })
    const mPurge = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers: mh,
      body: JSON.stringify({ op: 'purgeAccount', args: [partnerId] }),
    })
    step(
      '매니저로 재로그인: 등급 manager, 관리자 추가·파기는 여전히 403',
      mgrBody?.result?.grade === 'manager' && mAdd.status === 403 && mPurge.status === 403,
      `grade=${mgrBody?.result?.grade} add ${mAdd.status} purge ${mPurge.status}`,
    )
    await fetch(`${url}/api/auth`, { method: 'POST', headers: mh, body: JSON.stringify({ op: 'logout', args: [] }) })

    // ── 기기 D: 두 번째 파트너 — 원격이 있을 때 가입 (28-71-01) ─────────────────
    // B·C는 여기서 닫는다(뒤에서 쓰지 않는다). 살려 두면 C의 승인 감사 로그 저장이 스냅샷 push로 이어져
    // D의 첫 push와 409로 겹치고, 그때 D는 원격을 받아들이며 **방금 만든 프로필을 영구히 잃는다**
    // (통째 스냅샷 모델의 알려진 한계 — docs/rounds/28-72/수정사항.md에 기록). 이 단계가 보려는 것은 그 경합이 아니라
    // "로그인이 첫 접촉을 기다렸는가"이므로, 다른 기기를 조용히 시킨 뒤 확인한다.
    await B.ctx.close()
    await C.ctx.close()
    await sleep(2000) // 닫히기 전에 걸린 push가 있으면 마저 끝나게
    const D = await mk('D')
    await D.page.goto(`${url}/#/partner`)
    await D.page.waitForSelector('.card:has-text("파트너 로그인")')
    await D.page.click('button:has-text("처음이신가요? 회원가입")')
    await D.page.fill('input[placeholder="예: 반듯설비"]', '둘째설비')
    await D.page.fill('input[placeholder="010-0000-0000"]', '010-7777-6666')
    await D.page.fill('input[type="password"]', 'password1')
    await D.page.check('input[aria-label="전체 동의"]')
    await D.page.click('.partner-type button:has-text("개인")')
    await D.page.click('button:has-text("가입하고 인증번호 받기")')
    await D.page.waitForSelector('.otp-code')
    const dOtp = await D.page.$eval('.otp-code', (el) => el.textContent.trim())
    await D.page.fill('input[aria-label="인증번호"]', dOtp)
    await D.page.click('button:has-text("인증하고 시작하기")')
    await D.page.waitForSelector('.auth-status:has-text("둘째설비님")', { timeout: 10000 })
    const dId =
      (await q("select body from auth_state where workspace_id = 'main'"))[0].body.match(
        /"id":"(AC-\d+)","role":"partner","name":"둘째설비"/,
      )?.[1] ?? null
    step('D: 두 번째 파트너 가입·로그인 (원격이 비어 있지 않다)', dId !== null)
    // 28-71-01의 핵심: 로그인이 첫 접촉(accept)을 기다렸으므로, 그 직후의 프로필 시드가 **D의 로컬에 살아 있다**.
    // 수정 전에는 login()이 accept를 기다리지 않아 importSnapshot이 시드를 덮었다 — 이 단언이 그 회귀다.
    const dLocal = await D.page.evaluate(() => localStorage.getItem('banded-platform-v1') ?? '')
    step(
      'D: 로그인 직후의 프로필 시드가 첫 접촉 accept에 덮이지 않았다 — D 로컬 (28-71-01)',
      dId !== null && dLocal.includes(`"${dId}"`) && dLocal.includes('둘째설비'),
      `로컬에 ${dId} ${dLocal.includes(String(dId))}, 둘째설비 ${dLocal.includes('둘째설비')}`,
    )
    let dProfileOnServer = false
    let dDiag = ''
    for (let i = 0; i < 30; i += 1) {
      const row = (await q('select rev, updated_by, body from snapshots where workspace_id = $1', ['main']))[0]
      if (dId !== null && row.body.includes(`"${dId}"`) && row.body.includes('둘째설비')) {
        dProfileOnServer = true
        break
      }
      if (i === 29) {
        const local = await D.page.evaluate(() => localStorage.getItem('banded-platform-v1') ?? '')
        dDiag = `서버 rev ${row.rev} by ${row.updated_by}; 서버에 ${dId} ${row.body.includes(String(dId))}; D 로컬에 아직 ${local.includes(String(dId))}; D 배너 ${await D.page.evaluate(() => document.querySelector('[data-sync-notice]')?.getAttribute('data-replication') ?? 'none')}`
      }
      await sleep(500)
    }
    step('D: 그 시드가 서버 스냅샷까지 올라간다 (28-71-01)', dProfileOnServer, dDiag)
    step(
      'D: 다른 기기의 요청도 받아들였다',
      (await text(D.page)).includes('둘째설비님') &&
        (await D.page.evaluate(() => localStorage.getItem('banded-platform-v1') ?? '')).includes(
          '욕실 실리콘 재시공 (서버 e2e)',
        ),
    )

    // ── D: 덮이는 변경은 보관된다 (28-72-03) ────────────────────────────────
    // 통째 스냅샷은 병합할 수 없어 conflict 때 이 기기의 미반영 변경이 덮인다. 덮이는 것 자체는 모델의 성질이지만,
    // 28-72까지는 덮인 내용이 **어디에도 남지 않았다**. 여기서는 그 창을 일부러 만든다:
    // (1) D의 push를 막고 (2) D가 로컬 변경을 만들고 (3) 그 사이 남이 서버를 바꾸고 (4) 막은 것을 풀어 conflict를 낸다.
    await D.page.route('**/api/snapshot*', (route) =>
      route.request().method() === 'PUT' ? route.abort() : route.continue(),
    )
    await D.page.click('.tabs button:has-text("마이")')
    await D.page.waitForSelector('input[aria-label="서비스 지역"]')
    await D.page.fill('input[aria-label="서비스 지역"]', '고양, 파주')
    await D.page.click('.card:has-text("서비스 지역") button:has-text("저장")')
    await sleep(2500) // 디바운스 뒤 push가 시도되고 막힌다
    // 남이 서버를 바꿨다 — 본문은 유효한 JSON이어야 accept가 받아들인다(공백 하나로 다르게 만든다)
    await q(
      "update snapshots set rev = rev + 1, body = body || ' ', updated_by = 'other-device' where workspace_id = 'main'",
    )
    await D.page.unroute('**/api/snapshot*')
    await D.page.reload()
    await D.page.waitForSelector('.auth-status:has-text("둘째설비님")', { timeout: 10000 })
    let stashCount = 0
    for (let i = 0; i < 30; i += 1) {
      stashCount = await D.page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem('banded-platform-v1:overwritten') ?? '[]').length
        } catch {
          return 0
        }
      })
      if (stashCount > 0) break
      await sleep(500)
    }
    const dStash = await D.page.evaluate(() => localStorage.getItem('banded-platform-v1:overwritten') ?? '')
    step(
      'D: conflict로 덮인 이 기기의 변경이 보관함에 남는다 (28-72-03)',
      stashCount === 1 && dStash.includes('고양, 파주'),
      `보관 ${stashCount}건; 덮인 본문에 지역 ${dStash.includes('고양, 파주')}`,
    )

    // 28-75-04: 보관함은 **그 기기의 것**이다 — 관리자가 남의 기기 것을 꺼내 줄 수 없다.
    // 그래서 파트너가 자기 마이페이지에서 바로 꺼낼 수 있어야 한다. 28-74·28-75까지는 관리자 화면뿐이었다.
    await D.page.click('.tabs button:has-text("마이")')
    await D.page.waitForSelector('[data-overwritten-list]', { timeout: 10000 })
    const myCount = Number(await D.page.getAttribute('[data-overwritten-list]', 'data-overwritten-list'))
    const myDl = await D.page.locator('[data-export-overwritten]').count()
    step(
      'D: 파트너가 자기 마이페이지에서 보관함을 꺼낼 수 있다 (28-75-04)',
      myCount === stashCount && myDl === stashCount,
      `마이페이지 목록 ${myCount}건, 내려받기 ${myDl}개 (보관 ${stashCount}건)`,
    )

    // 28-73-04: 보관한 것을 **꺼낼 수 있어야** 한다. 관리자 화면도 같은 부품을 쓴다(28-75-04).
    await D.page.goto(`${url}/#/admin`)
    await D.page.waitForSelector('.card:has-text("관리자 로그인")')
    await D.page.fill('input[placeholder="admin"]', 'admin')
    await D.page.fill('input[type="password"]', ADMIN_PASSWORD)
    await D.page.click('.card:has-text("관리자 로그인") button:has-text("로그인")')
    await D.page.waitForSelector('.auth-status:has-text("관리자님")', { timeout: 10000 })
    await D.page.click('.tabs button:has-text("설정")')
    await D.page.waitForSelector('[data-overwritten-list]', { timeout: 10000 })
    const listCount = Number(await D.page.getAttribute('[data-overwritten-list]', 'data-overwritten-list'))
    const dlButtons = await D.page.locator('[data-export-overwritten]').count()
    step(
      'D: 관리자 설정에서 보관함 목록이 보이고 항목마다 내려받기가 있다 (28-73-04)',
      listCount === stashCount && dlButtons === stashCount,
      `목록 ${listCount}건, 내려받기 버튼 ${dlButtons}개 (보관 ${stashCount}건)`,
    )

    // 28-74 리뷰(Copilot): 목록을 **연 채로** 보관함이 늘어나면 화면이 따라와야 한다.
    // 초기화에서 한 번만 읽으면 여기서 1건에 멈춘다 — 방금 덮인 것이 목록에 없다는 뜻이라 가장 나쁜 순간이다.
    // 새로고침하면 마운트가 다시 되어 버그가 가려지므로 **reload 없이** 같은 화면에서 확인한다.
    await D.page.route('**/api/snapshot*', (route) =>
      route.request().method() === 'PUT' ? route.abort() : route.continue(),
    )
    // 28-90: 보증 일수 카드는 A/S 와 함께 없앴다 — 밀어 올릴 로컬 변경은 공지 배너로 만든다
    await D.page.fill('input[placeholder="예: 추석 연휴 기간 방문 일정 안내"]', '공지 77')
    await D.page.click('button:has-text("문구 저장")')
    // 28-76 CI: 이 단계의 **전제**는 "밀어 올리지 못한 로컬 변경이 있다"이다. 28-74는 그것을 `sleep(2500)`으로
    //   짐작했는데, 디바운스 push가 그 안에 시도되지 않으면 unroute 뒤에 그냥 성공해 버려 덮일 것이 없어진다
    //   (그러면 conflict도 보관도 일어나지 않는다 — CI가 그렇게 넘어졌다). 막힌 push는 배너에
    //   `data-replication="offline"`로 드러나므로, 짐작 대신 그것을 기다린다.
    const replState = () =>
      D.page.evaluate(() => document.querySelector('[data-sync-notice]')?.getAttribute('data-replication') ?? 'none')
    const pushBlocked = await waitFor(async () => (await replState()) === 'offline')
    await q(
      "update snapshots set rev = rev + 1, body = body || ' ', updated_by = 'other-device' where workspace_id = 'main'",
    )
    await D.page.unroute('**/api/snapshot*')
    await D.page.evaluate(() => window.dispatchEvent(new Event('focus'))) // 탭 복귀 = 동기화 계기
    let liveCount = listCount
    let liveStash = stashCount
    await waitFor(async () => {
      liveStash = await D.page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem('banded-platform-v1:overwritten') ?? '[]').length
        } catch {
          return 0
        }
      })
      liveCount = Number(await D.page.getAttribute('[data-overwritten-list]', 'data-overwritten-list'))
      return liveStash === 2 && liveCount === 2
    }, 15000)
    step(
      'D: 설정을 연 채로 보관함이 늘면 목록도 새로고침 없이 따라온다 (28-74 리뷰)',
      liveStash === 2 && liveCount === 2,
      `저장소 ${liveStash}건인데 화면 목록 ${liveCount}건; push 막힘 관측 ${pushBlocked}; 배너 ${await replState()}`,
    )

    // 28-77-03: 부팅 정리(28-75-02)는 **조용하지 않다.** 예산 밖 보관함을 심고 새로 고치면,
    //   화면이 "몇 건을 정리했다"고 한 번 말한다. 28-76까지는 지운 개수를 돌려주고도 버렸다.
    await D.page.evaluate(() => {
      const big = 'Y'.repeat(1_200_000) // 예산(1MB = 한도의 1/4)을 넘기는 한 건
      localStorage.setItem(
        'banded-platform-v1:overwritten',
        JSON.stringify([{ at: '2026-01-01T00:00:00.000Z', body: big }]),
      )
    })
    await D.page.reload()
    const trimNotice = await waitForText(D.page, '보관함 1건을 정리했습니다', 10000)
    const stashLeft = await D.page.evaluate(() => localStorage.getItem('banded-platform-v1:overwritten'))
    step(
      'D: 부팅 때 예산 밖 보관함을 정리하면 사용자에게 말한다 (28-77-03)',
      trimNotice && stashLeft === null,
      `안내 ${trimNotice}; 정리 뒤 보관함 ${stashLeft === null ? '없음' : `${stashLeft.length}자 남음`}`,
    )
    await D.ctx.close()

    // ── A: 승인이 도달한다, 두 탭이 서로를 conflict로 만들지 않는다 (28-69-02) ──
    await A.page.reload()
    await A.page.waitForSelector('.auth-status:has-text("반듯설비님")', { timeout: 10000 })
    await A.page.click('.tabs button:has-text("일감·입찰")')
    const bannerGone = await waitFor(async () => (await A.page.$('.approval-banner.pending')) === null)
    step('A: 새로고침 → 승인 상태가 거울에 도달 (배너 없음)', bannerGone)
    const A2 = trace(await A.ctx.newPage(), 'A2') // 같은 기기의 두 번째 탭 (같은 localStorage)
    await A2.goto(`${url}/#/partner`)
    await A2.waitForSelector('.auth-status:has-text("반듯설비님")', { timeout: 10000 })
    const revBefore = Number((await q('select rev from snapshots where workspace_id = $1', ['main']))[0].rev)
    await A.page.click('.card:has-text("욕실 실리콘 재시공 (서버 e2e)") button:has-text("이 일감에 입찰")')
    await A.page.click('button:has-text("입찰 제안하기")')
    await waitForText(A.page, '입찰 제안 완료')
    const bidText = await text(A.page)
    step('A 탭1: 승인 뒤 입찰 제출', bidText.includes('입찰 제안 완료'), bidText)
    await sleep(3000) // pushDelay 1.5s + 탭2 storage 이벤트 처리
    const revAfter = Number((await q('select rev from snapshots where workspace_id = $1', ['main']))[0].rev)
    const tab2Text = await text(A2)
    step(
      'A-2: 같은 기기의 탭2가 탭1의 push를 conflict로 만들지 않는다 — 서버 rev는 정확히 +1, 배너 없음 (28-69-02)',
      revAfter === revBefore + 1 && !tab2Text.includes('덮였습니다') && !tab2Text.includes('받아들였습니다'),
      `rev ${revBefore} → ${revAfter}; 탭2: ${tab2Text.slice(0, 200)}`,
    )
    await A2.click('.tabs button:has-text("일감·입찰")')
    await waitForText(A2, '입찰 1건')
    const a2Jobs = await text(A2)
    step(
      'A-2: 탭2도 입찰을 안다 (storage 동기화) — 서버 본문에도 파트너 입찰이 있다',
      a2Jobs.includes('입찰 1건') &&
        new RegExp(`"partnerId":\\s*"${partnerId}"`).test(
          (await q('select body from snapshots where workspace_id = $1', ['main']))[0].body,
        ),
      a2Jobs,
    )

    // ── 세션: 로그아웃·폐기·잠금 ─────────────────────────────────────────────
    const tokenBefore = await tokenOf(A.page, 'partner')
    const meOk = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenBefore}` },
      body: JSON.stringify({ op: 'me', args: [] }),
    })
    step('A: 로그아웃 전 me 200', meOk.status === 200)
    await A.page.click('.auth-status button:has-text("로그아웃")')
    await A.page.waitForSelector('.card:has-text("파트너 로그인")')
    // 화면이 로그인 카드로 돌아왔다고 서버의 폐기가 끝난 것은 아니다 — 토큰이 실제로 죽을 때까지 기다린다
    const me401 = async () =>
      (
        await fetch(`${url}/api/auth`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenBefore}` },
          body: JSON.stringify({ op: 'me', args: [] }),
        })
      ).status
    await waitFor(async () => (await me401()) === 401)
    const meAfterStatus = await me401()
    const snapAfter = await fetch(`${url}/api/snapshot?workspace=main`, {
      headers: { authorization: `Bearer ${tokenBefore}` },
    })
    step(
      'A: 로그아웃한 토큰은 죽는다 — me 401, snapshot 401',
      meAfterStatus === 401 && snapAfter.status === 401,
      `me ${meAfterStatus}, snapshot ${snapAfter.status}`,
    )
    step(
      'A: 로그아웃 뒤 배너에 "거부" 없음 (로그아웃 상태의 401은 문제가 아니다)',
      !(await text(A.page)).includes('거부됐습니다'),
    )
    step(
      '서버 sessions에 원문 토큰 없음 — token_hash 64자 hex뿐',
      (await q("select count(*)::int as n from sessions where token_hash !~ '^[0-9a-f]{64}$'"))[0].n === 0,
    )
    // 잠금 — 서버에서도 같은 도메인 규칙.
    // 시도마다 **응답을 기다린다**: 고정 sleep(250ms)이면 CI의 느린 왕복에서 5회째 응답 전에 읽어
    // 아직 없는 "잠겼습니다"를 찾는다(28-76 리뷰판 CI가 여기서 넘어졌다 — 서버 기록은 잠겨 있었다).
    // 실패 n회째의 안내가 `남은 시도 ${5 - n}회`이고 5회째가 잠금이라, 각 시도가 실제로 세어진 것도 함께 확인된다.
    let lockFail = ''
    for (let i = 1; i <= 5; i += 1) {
      await A.page.fill('input[placeholder="010-0000-0000"]', '010-9999-8888')
      await A.page.fill('input[type="password"]', 'wrong-pass-' + i)
      await A.page.click('.card:has-text("파트너 로그인") button:has-text("로그인")')
      const expected = i < 5 ? `남은 시도 ${5 - i}회` : '잠겼습니다'
      if (!(await waitForText(A.page, expected, 15000))) {
        lockFail = `${i}회째 응답을 기다리지 못했다 (기대: ${expected})`
        break
      }
    }
    step(
      'A: 비밀번호 5회 실패 → 서버가 잠근다 (같은 도메인 규칙)',
      lockFail === '' && (await text(A.page)).includes('잠겼습니다'),
      lockFail || (await text(A.page)).slice(0, 200),
    )
    step(
      'A: 잠금 기록이 서버 auth_state에 남는다',
      (await q('select body from auth_state where workspace_id = $1', ['main']))[0].body.includes('"lockedUntil"'),
    )

    // 28-74-03: 이 e2e의 api-server는 프록시 뒤가 아니라 x-forwarded-for가 없다 — 서버 로그의 경고가 그것이다.
    // 그런 요청의 IP는 `'unknown'`이고 모든 클라이언트가 공유한다. 그 값으로 신뢰 IP를 기록하면
    // 그 뒤 **누구나** 그 계정의 계정 잠금(30회)에서 면제된다. 믿을 수 없으면 기록도 면제도 없어야 한다.
    const authBody = (await q('select body from auth_state where workspace_id = $1', ['main']))[0].body
    const trustedRaw = (() => {
      try {
        return JSON.stringify(JSON.parse(authBody).trustedIps ?? [])
      } catch {
        return '?'
      }
    })()
    step(
      '프록시 헤더 없는 요청의 로그인은 신뢰 IP로 기록되지 않는다 (28-74-03)',
      !trustedRaw.includes('unknown'),
      `trustedIps = ${trustedRaw.slice(0, 200)}`,
    )
    // 28-72: 기기 D(둘째설비)의 세션은 살아 있어야 한다 — A의 계정만 센다
    step(
      'A: 잠금 뒤 A 계정의 활성 세션 0 (D의 세션은 그대로)',
      (await q('select count(*)::int as n from sessions where account_id = $1 and revoked_at is null', [partnerId]))[0]
        .n === 0 &&
        (await q("select count(*)::int as n from sessions where role = 'partner' and revoked_at is null"))[0].n === 1,
    )

    await A.ctx.close() // B·C는 D 블록 앞에서 닫았다
  } finally {
    await browser.close()
    await db.end()
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {}
  }
  console.log(`\n[e2e:server] ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log(failures.map((f) => ` - ${f}`).join('\n'))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
