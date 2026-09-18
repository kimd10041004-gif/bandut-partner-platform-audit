/**
 * 글줄 배치 검사 (29-16-1).
 *
 * ## 왜 이 검사가 생겼나
 *
 * `/companies` 는 200 이었고 HTML 도 맞았다. `e2e:next` 가 문자열로 확인한 것도 전부 통과했다.
 * 그런데 사장님이 브라우저로 열어 보니 돋보기 아이콘이 **혼자 한 줄을 차지하고** 문장을 아래로
 * 밀어내고 있었다.
 *
 * 원인은 Tailwind preflight 다. `svg { display: block }` 이라서, 문단 안에 그냥 놓인 아이콘은
 * 인라인이 아니라 블록이 된다. 단추(`.btn`)나 링크(`.inline-link`)는 inline-flex 라 멀쩡했고,
 * 그래서 이 부류만 조용히 어긋났다.
 *
 * HTML 문자열로는 절대 잡히지 않는다. 그래서 여기서 **실제로 재 본다.**
 *
 * ## 재는 규칙 하나
 *
 * 문단 안에 아이콘과 글자가 같이 있으면, 둘은 **세로로 겹쳐야 한다** — 즉 같은 줄에 있어야 한다.
 * 겹치지 않으면 아이콘이 자기 줄을 차지한 것이다.
 *
 * 환경: PLAYWRIGHT_CORE_PATH(선택) playwright-core index.mjs 경로,
 *       CHROMIUM_PATH(선택) 크로뮴 실행 파일 경로.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.LAYOUT_E2E_PORT ?? 3214)
const BASE = `http://127.0.0.1:${PORT}`
/** 우리가 만든 화면만 잰다. v17 원본 화면은 고치지 않기로 한 자리라 여기서 재지 않는다(29-1 규칙). */
const PAGES = ['/companies', '/consult', '/password/reset']
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
    console.error('[e2e:layout] playwright-core를 찾을 수 없습니다. PLAYWRIGHT_CORE_PATH를 지정하세요.')
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
      console.error(`[e2e:layout] 서버가 먼저 종료됐습니다(code ${serverExited}) — 포트 ${PORT}를 확인하세요`)
      return false
    }
    try {
      const r = await fetch(BASE + '/companies', { signal: AbortSignal.timeout(3000) })
      if (r.ok) return serverExited === null
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/**
 * 문단 안에서 아이콘과 글자가 같은 줄에 있는지 본다.
 *
 * 글자 쪽 위치는 Range 로 잰다. 문단 전체 사각형을 쓰면 두 줄짜리 문단에서도 아이콘과 겹쳐 보여
 * 어긋난 것을 놓친다.
 */
const PROBE = () => {
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
    const overlap = Math.min(s.bottom, t.bottom) - Math.max(s.top, t.top)
    if (overlap <= 0) bad.push((p.textContent ?? '').trim().slice(0, 40))
  }
  return bad
}

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
server.on('exit', (code) => (serverExited = code))

let exitCode = 1
try {
  if (!(await waitReady())) throw new Error('서버가 뜨지 않았습니다\n' + serverLog.slice(-1500))

  const chromium = await loadChromium()
  const browser = await chromium.launch({ executablePath: findChromium() })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45_000 })
    const bad = await page.evaluate(PROBE)
    step(`${path} — 아이콘이 글줄을 밀어내지 않는다`, bad.length === 0, bad.join(' | '))
  }

  // 좁은 화면에서도 같은 규칙이 선다. 휴대폰에서 아이콘 한 줄, 글자 한 줄이 되면 더 답답하다.
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45_000 })
    const bad = await page.evaluate(PROBE)
    step(`${path} (390px) — 아이콘이 글줄을 밀어내지 않는다`, bad.length === 0, bad.join(' | '))
  }

  await browser.close()

  console.log(`\n[e2e:layout] ${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.log(' - ' + f)
  exitCode = failures.length > 0 ? 1 : 0
} catch (e) {
  console.error('[e2e:layout] 실행 중 오류:', e)
  console.error('\n--- 서버 로그 ---\n' + serverLog.slice(-1500))
  exitCode = 1
} finally {
  server.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  process.exit(exitCode)
}
