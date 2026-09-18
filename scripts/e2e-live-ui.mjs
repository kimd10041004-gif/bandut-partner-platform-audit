/**
 * 배포된 주소를 브라우저로 연다 (29-19).
 *
 * ## 왜 이 검사가 생겼나
 *
 * `deploy-check` 는 배포된 주소를 **HTTP 로** 잰다. 상태 코드와 HTML 문자열이다. 29-16-1 이
 * 정확히 그 틈에서 나왔다 — `/companies` 는 200 이었고 HTML 도 맞았는데, 브라우저로 열면 아이콘이
 * 혼자 한 줄을 차지하고 문장을 밀어내고 있었다.
 *
 * `e2e:layout` 과 `e2e:next` 는 브라우저를 쓰지만 **로컬에 띄운 서버**를 본다. 배포된 인스턴스가
 * 아니다. 그래서 배포 자체가 어긋나면(빌드 산출물, 환경변수, CSP, 자산 경로) 아무도 못 잡는다.
 *
 * 이 검사가 그 둘 사이를 잇는다 — **배포된 주소를, 브라우저로.**
 *
 * ## 로그인하지 않는다
 *
 * 비밀번호는 Vercel 환경변수에만 있고 이 저장소에도 CI 에도 없다. 그것을 가져오지
 * 않고 확인할 수 있는 것만 본다. 쓰기도 하지 않는다 — 배포된 DB 에 아무것도 남기지 않는다.
 *
 * 29-21 이후로는 가입 코드가 없다. 대신 동의 없는 가입이 넘어가지 않는 것으로 "막혀야 할 것이 막힌다"를
 * 확인되고, 그것이 여기서 재고 싶은 것이다.
 *
 * ## 어디서 도나
 *
 * 개발 컨테이너에서는 못 돈다 — 나가는 연결이 정책으로 막혀 있다(`connect_rejected`).
 * GitHub Actions 러너는 그 밖에 있어 배포 주소를 직접 받는다. 그래서 `workflow_dispatch` 로 돈다.
 *
 * 환경: BASE_URL(필수) · PLAYWRIGHT_CORE_PATH(선택) · CHROMIUM_PATH(선택).
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE = (process.env.BASE_URL ?? '').replace(/\/$/, '')
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

if (!/^https?:\/\//.test(BASE)) {
  console.error('[e2e:live-ui] BASE_URL 이 필요합니다 (예: https://...vercel.app)')
  process.exit(1)
}

async function loadChromium() {
  try {
    return (await import('playwright-core')).chromium
  } catch {
    const alt = process.env.PLAYWRIGHT_CORE_PATH
    if (alt && existsSync(alt)) return (await import(pathToFileURL(alt).href)).chromium
    console.error('[e2e:live-ui] playwright-core를 찾을 수 없습니다.')
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
  return undefined
}

/**
 * 문단 안에서 아이콘과 글자가 같은 줄에 있는지 본다 (29-16-1 과 같은 자).
 *
 * 글자 쪽 위치는 Range 로 잰다. 문단 전체 사각형을 쓰면 두 줄짜리 문단에서도 겹쳐 보인다.
 */
const LINE_PROBE = () => {
  const bad = []
  for (const p of document.querySelectorAll('p, li, label, span.small')) {
    const svg = p.querySelector(':scope > svg')
    if (svg === null) continue
    const text = [...p.childNodes].find(
      (n) => (n.nodeType === 3 && n.textContent.trim() !== '') || (n.nodeType === 1 && n !== svg),
    )
    if (text === undefined) continue
    const range = document.createRange()
    range.selectNodeContents(text)
    const t = range.getBoundingClientRect()
    const s = svg.getBoundingClientRect()
    if (t.height === 0 || s.height === 0) continue
    if (Math.min(s.bottom, t.bottom) - Math.max(s.top, t.top) <= 0) bad.push((p.textContent ?? '').trim().slice(0, 40))
  }
  return bad
}

/** 로그인 없이 열리는 화면만 — 배포된 DB 에 아무것도 남기지 않는다 */
const PUBLIC_PAGES = ['/', '/companies', '/consult', '/password/reset', '/services', '/notices', '/request']

const chromium = await loadChromium()
const browser = await chromium.launch({ executablePath: findChromium() })
let exitCode = 1
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  /**
   * 자산이 조용히 빠지는 것을 잡는다 — 배포에서만 생기는 부류다(29-8 에서 텍스처 두 장이 그랬다).
   *
   * **API 응답은 세지 않는다** (29-19-2). 처음에는 4xx 를 전부 셌는데, 로그인하지 않고 도는
   * 검사라 정상 동작이 그대로 잡혔다.
   *
   *   401 /api/me · 401 /api/consultations   로그인하지 않았으니 맞는 답이다
   *   503 /api/auth                          인증번호 전달 불가 — 서버가 옳게 막은 것이다
   *
   * 앱이 제대로 거절하는 것을 "깨졌다"고 부르면, 고칠 것이 없는데 빨간불이 선다. 여기서 찾는
   * 것은 **있어야 할 파일이 없는 것**이다. API 의 상태 코드는 다른 검사가 본다.
   */
  const broken = []
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (u.origin !== new URL(BASE).origin) return
    if (u.pathname.startsWith('/api/')) return
    if (r.status() >= 400) broken.push(`${r.status()} ${u.pathname}`)
  })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))

  console.log(`[e2e:live-ui] ${BASE}`)

  for (const path of PUBLIC_PAGES) {
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => null)
    step(`${path} 가 열린다`, res !== null && res.ok(), res === null ? '응답 없음' : `HTTP ${res.status()}`)
    const bad = await page.evaluate(LINE_PROBE)
    step(`${path} — 아이콘이 글줄을 밀어내지 않는다`, bad.length === 0, bad.join(' | '))
  }

  // 좁은 화면. 휴대폰에서 아이콘 한 줄, 글자 한 줄이 되면 더 답답하다.
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/', '/companies', '/request']) {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60_000 })
    const bad = await page.evaluate(LINE_PROBE)
    step(`${path} (390px) — 아이콘이 글줄을 밀어내지 않는다`, bad.length === 0, bad.join(' | '))
  }
  await page.setViewportSize({ width: 1280, height: 900 })

  // 29-10: 공개 로그인 화면은 관리자를 고르게 하지 않는다. 관리자 문은 /login/admin 한 자리다.
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 60_000 })
  step('공개 로그인 화면에 관리자 선택지가 없다', (await page.locator('[data-login-role="admin"]').count()) === 0)
  await page.goto(BASE + '/login/admin', { waitUntil: 'networkidle', timeout: 60_000 })
  step('관리자 로그인 화면은 따로 열린다', (await page.locator('[data-login-id]').count()) === 1)

  // 29-21: 가입 코드 칸은 없앴다. 이 검사는 쓰지 않으므로 **동의 없이 낸 가입**이 거절되는지로 잰다 —
  // 계정을 만들지 않으면서도 "서버가 거절할 것을 거절한다"를 확인할 수 있는 길이다.
  await page.goto(BASE + '/signup/partner', { waitUntil: 'networkidle', timeout: 60_000 })
  step('가입 화면에 가입 코드 칸이 없다', (await page.locator('[data-signup-code]').count()) === 0)
  await page.fill('[data-signup-name]', '점검봇')
  await page.fill('[data-signup-phone]', '01000000000')
  await page.fill('[data-signup-password]', 'live-check-pass-1')
  await page.click('[data-signup-submit]') // 동의 없이
  const stillOnForm = (await page.locator('[data-signup-password]').count()) === 1
  step('필수 동의 없이는 가입이 넘어가지 않는다', stillOnForm, '동의 없이 다음 화면으로 갔다')

  // 관리자 전용 화면은 로그인 없이 내용을 내주지 않는다
  await page.goto(BASE + '/admin/diagnostics', { waitUntil: 'networkidle', timeout: 60_000 })
  const diag = await page.textContent('body')
  step('진단 화면은 로그인 없이 내용을 내주지 않는다', !/접속 호스트|지금 붙은 곳/.test(diag ?? ''))

  step('깨진 자산이 없다', broken.length === 0, [...new Set(broken)].join(' | '))
  step('화면 오류가 없다', pageErrors.length === 0, [...new Set(pageErrors)].join(' | '))

  console.log(`\n[e2e:live-ui] ${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.log(' - ' + f)
  exitCode = failures.length > 0 ? 1 : 0
} catch (e) {
  console.error('[e2e:live-ui] 실행 중 오류:', e)
} finally {
  await browser.close().catch(() => {})
  process.exit(exitCode)
}
