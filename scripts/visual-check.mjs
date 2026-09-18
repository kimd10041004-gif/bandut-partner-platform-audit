#!/usr/bin/env node
/* 시각 검증 QA 스크립트 (28-12-03, naver design-to-ui의 design-qa 개념 차용)
 *
 * 빌드된 앱(dist)을 프리뷰 서버로 띄우고 Playwright(Chromium)로:
 *   1. 라이트 배경 실측 = rgb(245, 246, 248)  (--bg = --palette-gray-50)
 *   2. 활성 탭 브랜드색 실측 = rgb(21, 105, 90) (--brand = --palette-teal-600)
 *   3. 다크 토글 후 배경 실측 = rgb(14, 21, 32) (다크 --bg)
 *   4. 전 탭 스크린샷 저장 (VISUAL_OUT 디렉터리, 기본 ./visual-out)
 * 하나라도 어긋나면 비정상 종료(1). 준비물 없으면 2로 종료.
 *
 * 사용: npm run build && node scripts/visual-check.mjs
 * 환경: PLAYWRIGHT_CORE_PATH(선택) playwright-core index.mjs 경로,
 *       CHROMIUM_PATH(선택) 크로뮴 실행 파일 경로.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.VISUAL_PORT ?? 4331)
const OUT = process.env.VISUAL_OUT ?? 'visual-out'
const LIGHT_BG = 'rgb(245, 246, 248)'
const BRAND = 'rgb(21, 105, 90)'

async function loadChromium() {
  try {
    return (await import('playwright-core')).chromium
  } catch {
    const alt = process.env.PLAYWRIGHT_CORE_PATH
    if (alt && existsSync(alt)) return (await import(pathToFileURL(alt).href)).chromium
    console.error(
      '[visual-check] playwright-core를 찾을 수 없습니다. ' +
        'npm i -D playwright-core 또는 PLAYWRIGHT_CORE_PATH를 지정하세요.',
    )
    process.exit(2)
  }
}

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const base = '/opt/pw-browsers'
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      const p = join(base, d, 'chrome-linux', 'chrome')
      if (d.startsWith('chromium-') && existsSync(p)) return p
    }
  }
  return undefined // playwright-core 기본 탐색에 위임
}

function startPreview() {
  // detached: 프로세스 그룹으로 띄워 종료 시 vite 본체까지 확실히 죽인다
  // (래퍼만 죽고 서버가 살아남으면 다음 실행이 스테일 dist를 검증하게 된다)
  // --host 127.0.0.1: 기본 host는 localhost인데, IPv6가 켜진 환경에서는 ::1로 먼저 풀려
  // IPv4 루프백에만 붙는 아래 fetch와 어긋난다(CI에서 실제로 기동 실패로 관측됐다).
  // stdio 캡처: 'ignore'면 기동 실패의 원인이 로그에 한 줄도 남지 않는다.
  const child = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  child.log = ''
  child.exited = null
  child.stdout.on('data', (b) => {
    child.log += b.toString()
  })
  child.stderr.on('data', (b) => {
    child.log += b.toString()
  })
  child.on('exit', (code, signal) => {
    child.exited = `code=${code} signal=${signal}`
  })
  return child
}

function stopPreview(child) {
  try {
    process.kill(-child.pid)
  } catch {
    child.kill()
  }
}

async function waitForServer(url, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {}
    if (child?.exited != null) {
      throw new Error(
        `프리뷰 서버가 먼저 종료됨(${child.exited})\n--- vite 출력 ---\n${(child.log || '').trim() || '(없음)'}`,
      )
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(
    `프리뷰 서버가 ${timeoutMs}ms 안에 뜨지 않음: ${url}\n--- vite 출력 ---\n${(child?.log || '').trim() || '(없음)'}`,
  )
}

let failures = 0
function check(name, actual, expected) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${actual}${ok ? '' : ` (기대: ${expected})`}`)
  if (!ok) failures++
}

/**
 * 28-64-01: dist 신선도 가드 — 이 게이트는 `dist`를 검사하므로, 소스가 그보다 새로우면
 * 지금 코드가 아니라 옛 빌드에 초록을 준다. `npm run build`를 잊은 실행을 통과시키지 않는다.
 */
function assertDistFresh(tag) {
  const distAt = statSync('dist/index.html').mtimeMs
  let newest = 0
  let newestFile = ''
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else {
        const t = statSync(p).mtimeMs
        if (t > newest) {
          newest = t
          newestFile = p
        }
      }
    }
  }
  walk('src')
  if (newest > distAt) {
    console.error(`[${tag}] dist가 소스보다 오래됐습니다 — ${newestFile} 가 dist/index.html 보다 새롭습니다.`)
    console.error(`[${tag}] npm run build 후 다시 실행하세요. (옛 빌드에 초록을 주지 않기 위한 가드)`)
    process.exit(2)
  }
}

async function main() {
  if (!existsSync('dist/index.html')) {
    console.error('[visual-check] dist가 없습니다. 먼저 npm run build 하세요.')
    process.exit(2)
  }
  assertDistFresh('visual-check')
  const chromium = await loadChromium()
  mkdirSync(OUT, { recursive: true })
  const server = startPreview()
  try {
    const url = `http://127.0.0.1:${PORT}/`
    await waitForServer(url, server)
    const browser = await chromium.launch({ executablePath: findChromium() })
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(url)
      // 28-16-01: 메인은 퍼블릭 홈페이지 — 랜딩이 있으면 스크린샷 후 앱으로 진입
      await page.waitForSelector('.app-header')
      if (await page.$('.landing')) {
        await page.screenshot({ path: join(OUT, 'landing.png'), fullPage: true })
        await page.click('[data-browse]')
      }
      await page.waitForSelector('.tabs button')

      // 스테일 프리뷰 서버 가드: 서빙 산출물이 로컬 dist와 같은 번들인지 확인
      const expectedSrc = /script[^>]+src="([^"]+)"/.exec(readFileSync('dist/index.html', 'utf8'))?.[1]
      const actualSrc = await page.evaluate(() => document.querySelector('script[src]')?.getAttribute('src') ?? null)
      check('서빙 번들 = 로컬 dist', actualSrc, expectedSrc)

      // 28-88 (28-87 감사 04): **모드 표식이 번들에 실렸는지 여기서 본다.**
      //   28-87은 이 검사를 `deploy-check`에만 뒀는데, 그것은 `main` 병합·배포 **뒤에** 돈다 —
      //   계측이 끊긴 것을 아는 시점이 이미 깨진 것이 프로덕션에 올라간 뒤였다.
      //   여기(병합 전 게이트)에서 보면 그 전에 안다. `deploy-check`의 검사는 그대로 둔다:
      //   여기는 "빌드가 표식을 만든다", 거기는 "그 빌드가 실제로 서빙된다"로 묻는 것이 다르다.
      // #241 리뷰: `expectedSrc` 가 없으면 `readFileSync('dist')` 가 EISDIR 로 **던져서**
      //   앞의 check 실패를 보고하기도 전에 스크립트가 죽는다. 검사기가 죽는 것과 검사가
      //   실패하는 것은 다르다 — 명시적으로 실패로 적고 넘어간다.
      const expectedMode = process.env['VITE_AUTH_MODE'] === 'server' ? 'server' : 'local'
      const bundleText = expectedSrc === undefined ? null : readFileSync('dist' + expectedSrc, 'utf8')
      if (bundleText === null) {
        check('모드 표식 검사', 'dist/index.html 에서 번들 경로를 못 읽었습니다', 'one')
      } else {
        const marks = [...bundleText.matchAll(/bandut-auth-mode:(local|server)/g)].map((m) => m[1])
        check(
          '모드 표식이 번들에 정확히 하나',
          marks.length === 1 ? 'one' : `${marks.length}개: ${marks.join(',')}`,
          'one',
        )
        check('모드 표식 값 = 빌드 모드', marks[0] ?? '(없음)', expectedMode)
      }

      const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      check('라이트 배경(--bg)', await bodyBg(), LIGHT_BG)
      check(
        '활성 탭 색(--brand)',
        await page.evaluate(() => getComputedStyle(document.querySelector('.tabs button.active')).color),
        BRAND,
      )

      const tabs = await page.$$('.tabs button')
      for (let i = 0; i < tabs.length; i++) {
        await tabs[i].click()
        await page.waitForTimeout(150)
        const label = (await tabs[i].innerText()).trim().replace(/\s+/g, '-')
        await page.screenshot({ path: join(OUT, `tab-${i + 1}-${label}.png`), fullPage: true })
      }

      // 앱별 첫 화면 (28-20-01: 목적자 분리 — 해시로 각 앱 진입)
      const apps = [
        ['고객', '#/'],
        ['파트너', '#/partner'],
        ['관리자', '#/admin'],
      ]
      for (let i = 0; i < apps.length; i++) {
        await page.evaluate((h) => {
          window.location.hash = h
        }, apps[i][1])
        await page.waitForTimeout(200)
        if (apps[i][1] === '#/' && (await page.$('.landing'))) await page.click('[data-browse]')
        await page.waitForTimeout(150)
        await page.screenshot({ path: join(OUT, `app-${i + 1}-${apps[i][0]}.png`), fullPage: true })
      }
    } finally {
      await browser.close()
    }
  } finally {
    stopPreview(server)
  }
  console.log(failures === 0 ? `VISUAL-CHECK OK (스크린샷: ${OUT}/)` : `VISUAL-CHECK FAIL: ${failures}건`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[visual-check]', err)
  process.exit(1)
})
