/**
 * 봇 검사들이 함께 쓰는 바닥 (29-22).
 *
 * ## 왜 따로 뺐나
 *
 * 29-22 에서 두 번째 브라우저 봇(`e2e:roles`)을 만들면서, 첫 봇(`e2e:signup`)의 앞부분을
 * 그대로 베낄 뻔했다. 베끼면 안 되는 조각이 그 안에 하나 있다 — **운영 주소 거부**다.
 *
 * 두 벌이 되면 언젠가 한쪽에만 호스트가 추가된다. 그날 다른 한쪽은 진짜 손님 데이터 옆에
 * 봇 계정을 만든다. 한 번도 일어나면 안 되는 일이라 한 벌로 둔다.
 *
 * 브라우저 찾기와 서버 기동도 같이 왔다. 그쪽은 베껴도 사고가 나지는 않지만, 낡은 서버가
 * 포트를 쥐고 있을 때의 처리(29-5에서 겪었다) 같은 것이 한쪽에만 남는 것도 좋지 않다.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 운영 호스트. 봇이 이리로 향하면 **아무것도 하지 않고 멈춘다.**
 *
 * 프리뷰 주소는 브랜치 이름이 들어가 길지만 운영은 이 셋이다 — Vercel 기본 주소 하나와
 * 29-28 에서 연결한 도메인 둘(www 와 루트). 도메인이 붙어도 `.vercel.app` 주소는 그대로
 * 운영을 서빙하므로 셋 다 막는다.
 */
export const PRODUCTION_HOSTS = [
  'bandut-partner-platform.vercel.app',
  'www.bandeutjipsuri.co.kr',
  'bandeutjipsuri.co.kr',
]

/**
 * 계정을 만드는 검사가 안전한 곳을 가리키는가.
 *
 * - 배포된 주소면: 운영이 아니어야 하고 `vercel.app` 으로 끝나야 한다.
 * - 로컬이면: DB 이름에 `test` 가 있어야 한다(`e2e:server` 와 같은 규칙).
 *
 * 괜찮으면 `null`, 아니면 **사람이 읽는 이유**를 돌려준다.
 */
export function refuseUnlessSafeTarget({ remote, db, adminPassword }) {
  if ((adminPassword ?? '').length < 8) return 'ADMIN_PASSWORD 가 없거나 8자 미만입니다'

  if (remote !== '') {
    let host
    try {
      host = new URL(remote).host
    } catch {
      return `BASE_URL 형식을 읽을 수 없습니다: ${remote}`
    }
    if (PRODUCTION_HOSTS.includes(host)) return `운영 주소입니다: ${host} — 이 검사는 계정을 만듭니다`
    if (!/vercel\.app$/.test(host)) return `프리뷰 주소가 아닙니다: ${host}`
    return null
  }

  if ((db ?? '') === '') return 'DATABASE_URL 이 없습니다 (BASE_URL 도 없습니다)'
  let name
  try {
    name = new URL(db).pathname.replace(/^\//, '')
  } catch {
    return 'DATABASE_URL 형식을 읽을 수 없습니다'
  }
  if (!/test/i.test(name)) return `DB 이름에 test 가 없습니다: ${name} — 이 검사는 계정을 만듭니다`
  return null
}

export async function loadChromium(tag) {
  try {
    return (await import('playwright-core')).chromium
  } catch {
    const alt = process.env.PLAYWRIGHT_CORE_PATH
    if (alt && existsSync(alt)) return (await import(pathToFileURL(alt).href)).chromium
    console.error(`[${tag}] playwright-core를 찾을 수 없습니다. PLAYWRIGHT_CORE_PATH를 지정하세요.`)
    process.exit(1)
  }
}

export function findChromium() {
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

/**
 * 로컬이면 Next 서버를 띄운다. 배포된 주소를 잴 때는 띄울 것이 없으므로 `server` 가 `null` 이다.
 *
 * `waitReady` 는 1.5초를 먼저 쉰다 — 지난 실행이 포트를 쥐고 있으면 **남의 서버가 200 을 준다.**
 * 그러면 낡은 빌드를 재게 된다(29-5에서 겪었다).
 */
export function startServer({ tag, port, remote, base }) {
  if (remote !== '') return { server: null, log: () => '', waitReady: async () => true }

  let log = ''
  let exited = null
  const server = spawn('npx', ['next', 'start', '-p', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  server.stdout.on('data', (d) => (log += d))
  server.stderr.on('data', (d) => (log += d))
  server.on('exit', (code) => (exited = code))

  async function waitReady(deadlineMs = 60_000) {
    await new Promise((r) => setTimeout(r, 1500))
    const until = Date.now() + deadlineMs
    while (Date.now() < until) {
      if (exited !== null) {
        console.error(`[${tag}] 서버가 먼저 종료됐습니다(code ${exited}) — 포트 ${port}를 확인하세요`)
        return false
      }
      try {
        const r = await fetch(base + '/login', { signal: AbortSignal.timeout(3000) })
        if (r.ok) return exited === null
      } catch {
        /* 아직 안 떴다 */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }

  return { server, log: () => log, waitReady }
}

/**
 * 통과·실패를 세는 자리.
 *
 * 실패에 **이유를 함께** 싣도록 `detail` 을 받는다. 29-20-3 에서 이유 없는 실패 하나 때문에
 * 두 번을 헛돌았다 — "무엇이 틀렸는지 아무도 모르는 실패" 는 실패보다 나쁘다.
 */
/**
 * 페이지를 열고 **잠깐** 가라앉기를 기다린다 (29-30).
 *
 * 봇들은 `waitUntil: 'networkidle'` 로 열어 왔다. 29-30 부터 상담이 있는 화면은 SSE(`chat-stream`)를
 * 항상 열어 두므로 네트워크가 **절대 조용해지지 않는다** — 스트림이 28초에 닫히고 1초 뒤 다시 잇는 그 틈에야
 * networkidle 이 온다. 거래 봇이 61초에서 7분 반이 됐고 CI 는 15분 상한에 걸려 취소됐다.
 *
 * 그래서 `load` 까지 기다린 뒤 networkidle 을 **상한을 두고** 기다린다. 스트림이 없는 화면은 예전과 같이
 * 바로 조용해지고, 스트림이 있는 화면은 상한만큼만 기다린다 — 그 사이 자료 fetch 는 끝난다.
 */
export const SETTLE_MS = 4000
export async function settle(page, ms = SETTLE_MS) {
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {})
}
export async function openPage(page, url, timeout = 45_000) {
  await page.goto(url, { waitUntil: 'load', timeout })
  await settle(page)
}
export async function reloadPage(page) {
  await page.reload({ waitUntil: 'load' })
  await settle(page)
}

export function reporter(tag) {
  let passed = 0
  const failures = []
  return {
    step(name, ok, detail = '') {
      if (ok) {
        passed += 1
        console.log(`  ✓ ${name}`)
      } else {
        failures.push(`${name}${detail ? ' — ' + detail : ''}`)
        console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
      }
    },
    finish() {
      console.log(`\n[${tag}] ${passed} passed, ${failures.length} failed`)
      for (const f of failures) console.log(' - ' + f)
      return failures.length > 0 ? 1 : 0
    },
    get failures() {
      return failures
    },
  }
}
