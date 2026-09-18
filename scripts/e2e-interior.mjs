/**
 * 공간 스튜디오 연기 검사 (29-8).
 *
 * ## 왜 브라우저를 쓰나
 *
 * 다른 검사와 달리 이건 **실제로 열어 본다.** 이유가 있다.
 *
 * 스튜디오를 들여올 때 파일을 정적으로 크롤해 받았는데, `materials.js`가 텍스처 이름을 코드 안에서
 * 조립한다:
 *
 *     ['oak','linen'].map(name => new URL(`./assets/${name}.png`, import.meta.url))
 *
 * 따옴표 속 경로를 찾는 방식으로는 이게 안 잡힌다. 그래서 두 장이 빠진 채로 들어왔고, `/interior/`는
 * **200이었다.** HTML도 멀쩡했다. 브라우저로 열어 네트워크를 보고서야 404 두 건이 드러났다.
 *
 * 그 부류를 사람 눈에 맡기지 않는다. 여기서 연다.
 *
 * 환경: PLAYWRIGHT_CORE_PATH(선택) playwright-core index.mjs 경로.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.INTERIOR_E2E_PORT ?? 3213)
const BASE = `http://127.0.0.1:${PORT}`
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

async function loadChromium() {
  try {
    return (await import('playwright-core')).chromium
  } catch {
    const alt = process.env.PLAYWRIGHT_CORE_PATH
    if (alt && existsSync(alt)) return (await import(pathToFileURL(alt).href)).chromium
    console.error('[e2e:interior] playwright-core를 찾을 수 없습니다. PLAYWRIGHT_CORE_PATH를 지정하세요.')
    process.exit(1)
  }
}

function findChromium() {
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

async function waitReady(deadlineMs = 60_000) {
  const until = Date.now() + deadlineMs
  while (Date.now() < until) {
    try {
      const r = await fetch(BASE + '/interior', { redirect: 'follow' })
      if (r.ok) return true
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))

let exitCode = 1
try {
  if (!(await waitReady())) throw new Error('서버가 뜨지 않았습니다\n' + serverLog.slice(-1500))

  const chromium = await loadChromium()
  const browser = await chromium.launch({ executablePath: findChromium() })
  const page = await browser.newPage()

  const httpErrors = []
  const consoleErrors = []
  page.on('response', (r) => {
    if (r.status() >= 400) httpErrors.push(`HTTP ${r.status()} ${r.url()}`)
  })
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    const t = m.text()
    // CSP 위반은 콘솔로만 온다. 놓치면 화면이 조용히 죽는다.
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(t)) consoleErrors.push('CSP: ' + t)
  })

  await page.goto(BASE + '/interior/', { waitUntil: 'networkidle', timeout: 45_000 })
  await page.waitForTimeout(2000)

  step('/interior/ 가 스튜디오를 연다', (await page.title()).includes('공간 스튜디오'), await page.title())
  step('3D 캔버스가 그려졌다', (await page.locator('canvas').count()) > 0)
  step('단계 안내가 보인다 (방 크기)', (await page.locator('text=방 크기').count()) > 0)
  step('플랫폼으로 돌아가는 링크가 있다', (await page.locator('a[href="/"]').count()) > 0)

  // 이 라운드의 요점. 200 은 "주소가 있다"까지만 말한다.
  step('화면이 부르는 것이 하나도 4xx·5xx 가 아니다', httpErrors.length === 0, httpErrors.slice(0, 6).join(' | '))
  step('CSP 가 스튜디오를 막지 않는다', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '))

  await browser.close()

  console.log(`\n[e2e:interior] ${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.log(' - ' + f)
  exitCode = failures.length > 0 ? 1 : 0
} catch (e) {
  console.error('[e2e:interior] 실행 중 오류:', e)
  console.error('\n--- 서버 로그 ---\n' + serverLog.slice(-1500))
  exitCode = 1
} finally {
  server.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  process.exit(exitCode)
}
