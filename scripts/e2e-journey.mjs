#!/usr/bin/env node
/* 실사용 여정 E2E (28-19-03): "정말 다 작동돼?"를 매 라운드 증명하는 공식 도구.
 *
 * UI만 눌러서(도메인 직접 호출 없이) 전 여정을 수행:
 *   고객 위저드 등록 → 파트너 입찰 → 고객 수락 → 방문 예약 → 시공 →
 *   추가 작업 승인 요청 → 미결정 완료 차단 확인 → 고객 승인 → 완료 → 정산 →
 *   리뷰 → 관리자 관제 → 새로고침 영속성 + 모바일(390px) 가로 스크롤 점검.
 * 실패 시 비정상 종료(1). 준비물 없으면 2.
 *
 * 사용: npm run build && npm run e2e
 * 환경: PLAYWRIGHT_CORE_PATH / CHROMIUM_PATH (visual-check와 동일)
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.E2E_PORT ?? 4341)
const OUT = process.env.VISUAL_OUT ?? 'visual-out'

async function loadChromium() {
  try {
    return (await import('playwright-core')).chromium
  } catch {
    const alt = process.env.PLAYWRIGHT_CORE_PATH
    if (alt && existsSync(alt)) return (await import(pathToFileURL(alt).href)).chromium
    console.error('[e2e] playwright-core를 찾을 수 없습니다. PLAYWRIGHT_CORE_PATH를 지정하세요.')
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
  return undefined
}

let failures = 0
const step = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}

async function goApp(page, hash) {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
  await page.waitForTimeout(250)
}

/**
 * 28-64-01: dist 신선도 가드 — 이 게이트는 `dist`를 검사하므로, 소스가 그보다 새로우면
 * 지금 코드가 아니라 옛 빌드에 초록을 준다. `npm run build`를 잊은 실행을 통과시키지 않는다.
 */
/** 28-92: 지역은 시·도 → 시·군·구 두 select 다 (전국 17 시·도) */
async function pickRegion(page, city, district, prefix = '') {
  await page.selectOption(`select[aria-label="${prefix}시·도"]`, city)
  await page.selectOption(`select[aria-label="${prefix}시·군·구"]`, district)
}

/** 28-93: 위저드 1단계의 안전 질문(분야가 정한다)에 전부 "아니요" — 긴급·잠김 아님 */
async function answerSafetyNo(page) {
  for (const q of await page.$$('[data-safety-q]')) await (await q.$('button:has-text("아니요")')).click()
}

/**
 * 28-93: 관리자 현황 "접수 검토 필요"에서 설명이 맞는 행을 검토 완료한다 — 확인 항목 전부 체크 + 사유.
 * 관리자 세션이 이미 있어야 한다. 끝나면 관리자 콘솔 현황 탭에 남는다.
 */
async function adminReview(page, url, description) {
  await page.goto(url + 'admin')
  await page.waitForTimeout(300)
  await page.click('.tabs button:has-text("현황")')
  await page.waitForTimeout(150)
  const row = page.locator('.ops-card [data-ops="review"] [data-review]', { hasText: description })
  if ((await row.count()) !== 1) return false
  for (const box of await row.locator('input[type="checkbox"]').all()) await box.check()
  await row.locator('input[aria-label="검토 사유"]').fill('고객 통화로 현장·범위 확인')
  await row.locator('button:has-text("검토 완료")').click()
  await page.waitForTimeout(150)
  return (await row.count()) === 0
}

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
    console.error('[e2e] dist가 없습니다. 먼저 npm run build 하세요.')
    process.exit(2)
  }
  assertDistFresh('e2e')
  const chromium = await loadChromium()
  mkdirSync(OUT, { recursive: true })
  // 28-48-04: e2e용 작은 PNG 2장(64×48 단색) — 캔버스 리사이즈 경로를 실제로 태운다
  function pngFile(name, color) {
    const w = 64,
      h = 48
    const raw = Buffer.alloc((w * 3 + 1) * h)
    for (let y = 0; y < h; y++) {
      raw[y * (w * 3 + 1)] = 0
      for (let x = 0; x < w; x++) {
        const o = y * (w * 3 + 1) + 1 + x * 3
        raw[o] = color[0]
        raw[o + 1] = color[1]
        raw[o + 2] = color[2]
      }
    }
    const crc = (buf) => {
      let c = ~0
      for (const b of buf) {
        c ^= b
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
      }
      return ~c >>> 0
    }
    const chunk = (type, data) => {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(data.length)
      const td = Buffer.concat([Buffer.from(type), data])
      const cc = Buffer.alloc(4)
      cc.writeUInt32BE(crc(td))
      return Buffer.concat([len, td, cc])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(w, 0)
    ihdr.writeUInt32BE(h, 4)
    ihdr[8] = 8
    ihdr[9] = 2
    ihdr[10] = 0
    ihdr[11] = 0
    ihdr[12] = 0
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
    const p = join(OUT, name)
    writeFileSync(p, png)
    return p
  }
  const PHOTO1 = pngFile('e2e-photo-1.png', [200, 80, 60])
  const PHOTO2 = pngFile('e2e-photo-2.png', [60, 120, 200])
  // --host 127.0.0.1: vite preview의 기본 host는 localhost인데, 러너처럼 IPv6가 켜진 환경에서는
  // localhost가 ::1로 먼저 풀려 IPv4 루프백에만 붙는 이 스크립트의 fetch와 어긋난다.
  // stdio 캡처: 예전에는 'ignore'라 기동 실패가 "기동 실패" 한 줄로만 남아 원인을 알 수 없었다.
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let serverLog = ''
  let serverExit = null
  server.stdout.on('data', (b) => {
    serverLog += b.toString()
  })
  server.stderr.on('data', (b) => {
    serverLog += b.toString()
  })
  server.on('exit', (code, signal) => {
    serverExit = `code=${code} signal=${signal}`
  })
  try {
    const url = `http://127.0.0.1:${PORT}/`
    const deadline = Date.now() + 30000
    for (;;) {
      try {
        const res = await fetch(url)
        if (res.ok) break
      } catch {}
      if (serverExit !== null) {
        throw new Error(`프리뷰 서버가 먼저 종료됨(${serverExit})\n--- vite 출력 ---\n${serverLog.trim() || '(없음)'}`)
      }
      if (Date.now() > deadline) {
        throw new Error(`프리뷰 서버 기동 실패(30초, ${url})\n--- vite 출력 ---\n${serverLog.trim() || '(없음)'}`)
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    const browser = await chromium.launch({ executablePath: findChromium() })
    try {
      // 28-55-04: 명시적 컨텍스트 — 두 번째 탭(page.context().newPage())이 같은 localStorage를 공유해야 한다
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
      const page = await ctx.newPage()
      const text = () => page.evaluate(() => document.body.innerText)
      await page.goto(url)
      await page.waitForSelector('.app-header')

      // 1) 고객: 위저드 등록
      step('랜딩이 메인', !!(await page.$('.landing')))
      // 28-37-02: 푸터 약관 — 로그인 없이 공개
      await page.click('.land-footer button:has-text("이용약관")')
      step('랜딩 푸터 이용약관 열기(공개 문서)', (await text()).includes('제1조'))
      await page.click('.land-footer button:has-text("이용약관")')
      // 28-92: 홈이 곧 요청 폼이다 — 히어로의 분야 카드가 접수의 첫 클릭이다(참고 v12)
      step(
        '히어로 요청 폼: 그룹 5개 + 분야 카드 20장 (28-92)',
        (await page.locator('[data-hero-form] .cat-groups button').count()) === 6 &&
          (await page.locator('[data-hero-form] .cat-card').count()) === 20,
      )
      await page.click('[data-hero-form] .cat-groups button:has-text("문·창·가구")')
      step(
        '히어로 그룹 탭 "문·창·가구" → 그 그룹 5장 + 분야를 모르겠어요',
        (await page.locator('[data-hero-form] .cat-card').count()) === 6 &&
          (await page.locator('[data-hero-form] .cat-card[data-category="전기·조명"]').count()) === 0,
      )
      await page.click('[data-hero-form] .cat-groups button:has-text("전체")')
      await page.click('[data-hero-form] .cat-card[data-category="주방·욕실 공사"]')

      // 0.5) 고객 가입 + OTP 인증 (28-30): 랜딩은 공개, 앱 기능은 로그인 게이트 뒤
      await page.waitForSelector('.card:has-text("고객 로그인")')
      await page.click('button:has-text("처음이신가요? 회원가입")')
      await page.fill('input[placeholder="예: 김반듯"]', '정지훈')
      await page.fill('input[placeholder="010-0000-0000"]', '010-1234-5678')
      await page.fill('input[type="password"]', 'password1')
      // 28-37-03: 필수 약관 미동의 → 거부 → 전체 동의 후 가입
      await page.click('button:has-text("가입하고 인증번호 받기")')
      await page.waitForTimeout(100)
      step('필수 약관 미동의 → 가입 거부', (await text()).includes('필수 약관'))
      await page.check('input[aria-label="전체 동의"]')
      await page.click('button:has-text("가입하고 인증번호 받기")')
      const custOtp = await page.$eval('.otp-code', (el) => el.textContent.trim())
      await page.fill('input[aria-label="인증번호"]', custOtp)
      await page.click('button:has-text("인증하고 시작하기")')
      await page.waitForSelector('.wizard-steps')
      step('고객 가입 + OTP 인증 + 자동 로그인', (await text()).includes('정지훈님'))
      step(
        '히어로에서 고른 분야가 로그인 뒤 위저드에 선택되어 있다 (28-92)',
        (await page.locator('.card .cat-card.active').first().innerText()).includes('주방·욕실 공사'),
      )
      // 28-93: 분야를 하나 더 고른다(급배수) — 첫 항목(주방·욕실)이 주 분야로 남는다
      await page.click('.cat-card[data-category="급배수·누수·설비"]')
      step(
        '위저드: 분야 두 개 선택 → 선택 목록에 "주방·욕실 공사 + 급배수·누수·설비" (28-93)',
        (await page.locator('[data-picked-categories]').innerText()).includes('주방·욕실 공사 + 급배수·누수·설비'),
      )
      await pickRegion(page, '서울', '관악구')
      // 28-94: 상세 주소는 필수(5자), 연락처는 계정 번호로 채워져 있다
      step(
        '위저드: 연락처가 계정 번호로 채워져 있다 (28-94)',
        (await page.locator('input[aria-label="요청 연락처"]').inputValue()) === '01012345678',
      )
      await page.fill('input[placeholder="예: 거실 도배 시공, 방 2개 포함"]', '욕실 실리콘 재시공')
      await page.click('button:has-text("다음")')
      step('상세 주소 없이 다음 → "상세 주소를 5자 이상"', (await text()).includes('상세 주소를 5자 이상'))
      await page.fill('input[aria-label="상세 주소"]', '화곡로 12길 34, 101동 202호')
      // 28-93: 안전 질문 — 답하지 않으면 다음으로 못 간다, "예"면 안내 확인이 필요하다
      step(
        '위저드: 긴급 증상 질문이 보인다(주방·욕실=범위 검토 분야)',
        (await page.$('[data-safety-q="urgent"]')) !== null,
      )
      await page.click('button:has-text("다음")')
      step('안전 질문 미답 → "안전 질문에 답해 주세요"', (await text()).includes('안전 질문에 답해 주세요'))
      await page.click('[data-safety-q="urgent"] button:has-text("예")')
      await page.click('button:has-text("다음")')
      step(
        '"예"인데 안내 확인 없음 → "안전 안내 확인이 필요합니다" + 안내문 노출',
        (await text()).includes('안전 안내 확인이 필요합니다') && (await page.$('[data-safety-ack]')) !== null,
      )
      await answerSafetyNo(page)
      step('"아니요"로 바꾸면 안내 확인 칸이 사라진다', (await page.$('[data-safety-ack]')) === null)
      // 28-48-02: 현장 사진 2장 첨부(브라우저 리사이즈) → 미리보기
      await page.setInputFiles('input[aria-label="현장 사진"]', [PHOTO1, PHOTO2])
      await page.waitForTimeout(400)
      step('위저드 현장 사진 2장 첨부 → 미리보기', (await page.locator('.photo-thumb').count()) === 2)
      // 28-26-02: 카테고리 질문(욕실 시드) 답변 — 선택형 필 클릭
      await page.click('.q-item button:has-text("곰팡이 있음")')
      await page.click('button:has-text("다음")')
      await page.waitForSelector('text=언제 방문하면')
      step(
        '위저드 입찰 마감일 기본값 자동 채움(28-43-03)',
        (await page.locator('input[aria-label="입찰 마감일"]').inputValue()) !== '',
      )
      await page.click('button:has-text("다음")')
      await page.click('.budget-option:has-text("30~50만원")')
      await page.click('button:has-text("다음")')
      step(
        '등록 확인: 분야 묶음 + "관리자가 안전·작업 범위를 먼저 확인" 안내 (28-93)',
        (await text()).includes('[주방·욕실 공사 + 급배수·누수·설비]') &&
          (await page.$('[data-review-notice]')) !== null,
      )
      await page.click('button:has-text("입찰 시작하기")')
      await page.waitForTimeout(200)
      step('고객 요청 등록 (검토 대기 안내)', (await text()).includes('파트너에게 공개됩니다'))
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      step(
        '고객 홈: 입찰 마감 D-day 표시 + "접수 확인 중" 배지',
        (await page.locator('.card', { hasText: '욕실 실리콘 재시공' }).locator('.dday').count()) >= 1 &&
          (await page.locator('.card', { hasText: '욕실 실리콘 재시공' }).locator('[data-review-hold]').count()) === 1,
      )

      // 2) 파트너: 가입(사업자번호) + 인증 + 입찰
      await goApp(page, '#/partner')
      await page.waitForSelector('.card:has-text("파트너 로그인")')
      await page.click('button:has-text("처음이신가요? 회원가입")')
      await page.fill('input[placeholder="예: 반듯설비"]', '반듯설비')
      await page.fill('input[placeholder="010-0000-0000"]', '010-9999-8888')
      await page.fill('input[type="password"]', 'password1')
      await page.check('input[aria-label="전체 동의"]')
      // 28-36-02/04: 파트너 유형 "사업자" 선택 → 잘못된 사업자번호는 조회 실패로 거부 → 올바른 번호로 통과
      await page.click('.partner-type button:has-text("사업자")')
      await page.fill('input[placeholder="000-00-00000"]', '123-45-67890')
      await page.click('button:has-text("가입하고 인증번호 받기")')
      await page.waitForTimeout(100)
      step('사업자 정보 조회 실패(검증번호 불일치) → 가입 거부', (await text()).includes('사업자 정보 조회에 실패'))
      await page.fill('input[placeholder="000-00-00000"]', '123-45-67891')
      await page.click('button:has-text("가입하고 인증번호 받기")')
      const partOtp = await page.$eval('.otp-code', (el) => el.textContent.trim())
      await page.fill('input[aria-label="인증번호"]', partOtp)
      await page.click('button:has-text("인증하고 시작하기")')
      await page.waitForTimeout(200)
      step('파트너 가입(사업자 유형·조회 통과) + 인증 + 로그인', (await text()).includes('반듯설비님'))
      // 28-93: 관리자 검토 전에는 파트너에게 없는 일감이다
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      step(
        '검토 전: 파트너 일감 목록에 없다 (28-93)',
        (await page.locator('.card h3', { hasText: '욕실 실리콘 재시공' }).count()) === 0 &&
          !(await text()).includes('욕실 실리콘 재시공'),
      )
      await goApp(page, '#/admin')
      await page.waitForSelector('.card:has-text("관리자 로그인")')
      await page.fill('input[placeholder="admin"]', 'admin')
      await page.fill('input[type="password"]', 'bandut1234!')
      await page.click('.card:has-text("관리자 로그인") button:has-text("로그인")')
      await page.waitForTimeout(200)
      // 28-44-02: 현황 탭 "조치 필요"에서 바로 승인
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(150)
      step(
        '관리자 현황 조치 필요: 승인 대기 파트너 1건',
        (await page.locator('.ops-card [data-ops="approval"] .list-row').count()) === 1,
      )
      // 28-93: 접수 검토 — 플래그·답변 표시, 확인 항목 없이는 거절, 채우면 완료
      const reviewRow = page.locator('.ops-card [data-ops="review"] [data-review]', { hasText: '욕실 실리콘 재시공' })
      step(
        '관리자 현황: 접수 검토 필요 1건 — 작업 범위 검토 플래그 + 안전 답변(긴급 아니요)',
        (await reviewRow.count()) === 1 &&
          (await reviewRow.locator('[data-review-flag="WORK_SCOPE_REVIEW"]').count()) === 1 &&
          (await reviewRow.innerText()).includes('긴급 아니요'),
      )
      await reviewRow.locator('button:has-text("검토 완료")').click()
      await page.waitForTimeout(150)
      step('확인 항목 없이 검토 완료 → 거절(사유 5자)', (await text()).includes('검토 사유를 5자 이상'))
      step('검토 완료 (28-93)', await adminReview(page, url, '욕실 실리콘 재시공'))
      step(
        '검토 완료 → 접수 검토 필요 0건 (승인 대기는 그대로 1건)',
        (await page.$('.ops-card [data-ops="review"]')) === null &&
          (await page.locator('.ops-card [data-ops="approval"] .list-row').count()) === 1,
      )
      // 2.5) 파트너 승인 게이트 (28-34): 승인 전 입찰 차단 → 관리자 승인 → 입찰
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      const jobCard = page.locator('.card', { has: page.locator('h3', { hasText: '욕실 실리콘 재시공' }) })
      step(
        '검토 뒤 파트너 일감 카드: 분야 묶음 제목 (28-93)',
        (await page
          .locator('.card h3', { hasText: '[주방·욕실 공사 + 급배수·누수·설비] 욕실 실리콘 재시공' })
          .count()) === 1,
      )
      // 28-94: 낙찰 전에는 사진·주소·연락처가 없고 이름은 가려진다
      const jobText = await jobCard.innerText()
      step(
        '낙찰 전 파트너 일감 카드: 사진 0장 · 주소·연락처 없음 · 이름 정*훈 (28-94)',
        (await jobCard.locator('.photo-thumb').count()) === 0 &&
          !jobText.includes('화곡로') &&
          !jobText.includes('1234') &&
          jobText.includes('정*훈') &&
          !jobText.includes('정지훈') &&
          (await jobCard.locator('[data-private-note]').count()) === 1,
      )
      step(
        '승인 전 파트너 입찰 차단(배너 + 버튼 비활성)',
        (await page.$('.approval-banner.pending')) !== null &&
          (await page.$('.card:has-text("욕실 실리콘 재시공") button:has-text("이 일감에 입찰")[disabled]')) !== null,
      )
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(150)
      await page.click('.ops-card [data-ops="approval"] button:has-text("승인")')
      await page.waitForTimeout(150)
      step('조치 필요 카드에서 승인 → 승인 대기 0건', (await page.$('.ops-card [data-ops="approval"]')) === null)
      await page.click('.tabs button:has-text("회원")')
      await page.waitForTimeout(150)
      step(
        '관리자 파트너 승인',
        (await page.$('.member-row:has-text("반듯설비") .pay-tag.paid:has-text("승인")')) !== null,
      )
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("이 일감에 입찰")')
      await page.click('button:has-text("입찰 제안하기")')
      await page.waitForTimeout(200)
      step('파트너 입찰 제출', (await text()).includes('내 제안'))
      step(
        '카테고리 질문 답변이 일감 카드에 노출',
        (await page.$('.qa-line')) !== null && (await text()).includes('곰팡이 있음'),
      )

      // 3) 고객: 수락
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      // 28-35-02: 알림 벨 — 견적 도착 알림 미읽음 → 패널 열기 → 읽음 처리
      const bellCount = await page.$eval('.bell-count', (el) => Number(el.textContent)).catch(() => 0)
      step('고객 알림 벨 미읽음(견적 도착)', bellCount >= 1)
      await page.click('button.bell')
      await page.waitForTimeout(150)
      step(
        '알림 패널: 견적 도착 항목 + 읽음 처리로 뱃지 소멸',
        (await text()).includes('견적이 도착했습니다') && (await page.$('.bell-count')) === null,
      )
      await page.click('.notif-panel button:has-text("닫기")')
      await page.click('.tabs button:has-text("견적함")')
      await page.waitForTimeout(150)
      // 28-31-02: 수락 전 업체 상세 확인 (시안 3 "업체 상세")
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("업체 정보 보기")')
      await page.waitForTimeout(150)
      step(
        '견적함 업체 상세(프로필·지표) 노출',
        (await page.$('.partner-card')) !== null && (await text()).includes('반듯설비'),
      )
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("견적 수락")')
      await page.waitForTimeout(200)
      step('고객 견적 수락', (await text()).includes('결정한 요청'))

      // 3.5) 거래 채팅 (28-27): 고객 전송 → 파트너 뱃지·답장 → 고객 확인
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForSelector('.chat-input input')
      step('고객 거래 상세: 현장 사진 썸네일 2장', (await page.locator('.photo-thumb').count()) === 2)
      await page.fill('.chat-input input', '주차 가능한가요?')
      await page.click('.chat-input button:has-text("전송")')
      await page.waitForTimeout(200)
      step('고객 채팅 전송(말풍선)', (await page.$('.bubble.me')) !== null)
      // 28-54-02: 입력 상한 500자 — 501자를 넣어도 카운터가 500/500에서 멈춘다(도메인 거부는 vitest)
      await page.fill('.chat-input input', 'x'.repeat(501))
      await page.waitForTimeout(100)
      step(
        '채팅 입력 500자 상한(카운터 500/500)',
        (await page.locator('.chat-input').locator('xpath=..').locator('[data-chat-count]').innerText()).trim() ===
          '500/500',
      )
      await page.fill('.chat-input input', '')
      // 28-95: 예약금 카드는 계약 동의 뒤에 열린다 — 낙찰 직후에는 없다
      step(
        '계약 전: 예약금 결제 카드 없음, 계약서 대기 안내 (28-95)',
        (await page.$('.card:has-text("예약금 결제")')) === null && (await page.$('[data-contract-wait]')) !== null,
      )
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      step('파트너 안 읽은 채팅 뱃지', (await page.$('.chat-unread')) !== null)
      // 28-94: 낙찰 뒤 내 작업에서 주소·연락처·현장 사진이 열린다
      const workCard = page.locator('.card', { has: page.locator('h3', { hasText: '욕실 실리콘 재시공' }) })
      const workText = await workCard.innerText()
      step(
        '낙찰 뒤 파트너 내 작업: 방문지 주소 + 연락처 + 현장 사진 2장 + 실명 (28-94)',
        workText.includes('화곡로 12길 34, 101동 202호') &&
          workText.includes('010-1234-5678') &&
          workText.includes('정지훈') &&
          (await workCard.locator('.photo-thumb').count()) === 2,
      )
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("채팅 열기")')
      await page.waitForSelector('.chat-input input')
      step('파트너가 고객 메시지 수신', (await text()).includes('주차 가능한가요?'))
      await page.fill('.chat-input input', '네 가능합니다')
      await page.click('.chat-input button:has-text("전송")')
      await page.waitForTimeout(200)
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      step('고객이 파트너 답장 확인', (await text()).includes('네 가능합니다'))

      // 4) 파트너: 계약서(예약금·조건·일정) → 고객 동의 → 예약금 → 시공 (28-95, 참고 v12 contracts)
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("일정")')
      await page.waitForTimeout(150)
      const sel = page.locator('.form select')
      await sel.nth(1).selectOption('14')
      await sel.nth(2).selectOption('16')
      await page.click('button:has-text("계약서 보내기")')
      await page.waitForTimeout(150)
      step('계약 조건 없이 보내기 → 거절', (await text()).includes('계약 조건을 적어'))
      await page.fill('input[aria-label="계약 조건"]', '자재 포함, 시공 후 1년 보증')
      await page.fill('input[aria-label="계약 예약금"]', '30000')
      await page.click('button:has-text("계약서 보내기")')
      await page.waitForTimeout(200)
      step(
        '계약서 v1 발송 (28-95)',
        (await page.locator('[data-schedule-msg]').innerText()).includes('계약서 v1') &&
          (await page.locator('[data-contract-fee]').innerText()).includes('v1 고객 확인 대기'),
      )
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      step(
        '내 작업: 계약서 v1 고객 확인 대기 표시',
        (await page.locator('[data-contract-hint]').innerText()).includes('v1'),
      )
      // 고객: 계약서 확인 → 수정 요청 → v2 → 동의
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      step(
        '고객 거래 상세: 계약서 v1 카드(총액·예약금 30,000원·수수료 3%·14:00~16:00·조건)',
        (await page.locator('[data-contract]').innerText()).includes('30,000') &&
          (await page.locator('[data-contract]').innerText()).includes('3%') &&
          (await page.locator('[data-contract]').innerText()).includes('14:00~16:00') &&
          (await page.locator('[data-contract]').innerText()).includes('1년 보증'),
      )
      step('확인 체크 전에는 동의 버튼 비활성', (await page.$('button:has-text("계약 동의")[disabled]')) !== null)
      await page.click('button:has-text("수정 요청")')
      await page.waitForTimeout(150)
      step('수정 요청 → 계약서 카드 사라짐 (파트너에게 알림)', (await page.$('[data-contract]')) === null)
      await goApp(page, '#/partner')
      await page.click('button.bell')
      await page.waitForTimeout(150)
      step(
        '파트너 알림: 계약서 v1 수정 요청',
        (await page.locator('.notif-panel').innerText()).includes('v1 수정을 요청'),
      )
      await page.click('.notif-panel button:has-text("닫기")')
      await page.click('.tabs button:has-text("일정")')
      await page.waitForTimeout(150)
      await page.locator('.form select').nth(1).selectOption('14')
      await page.locator('.form select').nth(2).selectOption('16')
      await page.fill('input[aria-label="계약 조건"]', '자재 포함, 시공 후 1년 보증, 추가 작업은 별도 승인')
      await page.fill('input[aria-label="계약 예약금"]', '30000')
      await page.click('button:has-text("계약서 보내기")')
      await page.waitForTimeout(200)
      step('계약서 v2 발송', (await page.locator('[data-schedule-msg]').innerText()).includes('계약서 v2'))
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      await page.check('input[aria-label="계약 내용 확인"]')
      await page.click('button:has-text("계약 동의")')
      await page.waitForTimeout(200)
      step(
        '계약 v2 동의 → 방문 예정 14:00 + 계약 동의됨 카드 + 예약금 결제 카드(계약 v2 30,000원)',
        (await text()).includes('14:00') &&
          (await page.$('.card:has-text("계약 v2 동의됨")')) !== null &&
          (await page.locator('[data-contract-accepted]').innerText()).includes('1년 보증, 추가 작업은 별도 승인') &&
          (await page.locator('.card', { hasText: '예약금 결제' }).innerText()).includes('계약 v2') &&
          (await page.locator('.card', { hasText: '예약금 결제' }).innerText()).includes('30,000'),
      )
      // 3.6) 예약금 결제 (28-28 → 28-95: 계약의 금액)
      await page.click('.card:has-text("예약금 결제") button:has-text("결제하기")')
      await page.waitForTimeout(200)
      step('예약금 결제(계약 30,000원) → 영수증', (await text()).includes('30,000') && (await text()).includes('RCT-'))
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("일정")')
      await page.waitForTimeout(150)
      step('파트너 일정: 방문 예약(14~16시) 슬롯', (await text()).includes('14:00'))
      // 28-56: 휴무일(D+2) → 고객이 그 날로 변경 시 거부 → D+1로 변경 → 파트너 알림 → 새로고침 후 D-1 리마인더
      const dayOff = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
      await page.fill('.form input[type="date"]', dayOff)
      await page.click('[data-dayoff-toggle]')
      await page.waitForTimeout(150)
      step('파트너 휴무일 설정(D+2)', (await page.locator('[data-dayoff-toggle]').innerText()).includes('휴무 해제'))
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      await page.click('[data-reschedule]')
      await page.fill('input[aria-label="변경 날짜"]', dayOff)
      await page.click('button:has-text("변경 저장")')
      await page.waitForTimeout(150)
      step('휴무일로 변경 → 거부 안내', (await page.locator('[data-reschedule-error]').innerText()).includes('휴무일'))
      await page.fill('input[aria-label="변경 날짜"]', tomorrow)
      await page.selectOption('select[aria-label="변경 시작"]', '10')
      await page.selectOption('select[aria-label="변경 종료"]', '12')
      await page.click('button:has-text("변경 저장")')
      await page.waitForTimeout(200)
      step(
        '방문일 변경(D+1 10~12시) → 예약 표시 + 변경 1회',
        (await text()).includes(`예약 ${tomorrow} 10:00`) && (await page.$('[data-reschedule-count="1"]')) !== null,
      )
      await page.reload()
      await page.waitForTimeout(400)
      await page.click('button.bell')
      await page.waitForTimeout(150)
      step(
        '새로고침(기동 sweep) → 고객 알림 "내일 방문 예정"',
        (await page.locator('.notif-panel').innerText()).includes('내일 방문 예정'),
      )
      await page.click('.notif-panel button:has-text("닫기")')
      await goApp(page, '#/partner')
      await page.waitForTimeout(250)
      await page.click('button.bell')
      await page.waitForTimeout(150)
      // 28-95: 파트너는 일정을 단독으로 바꾸지 못한다 — 제안하고 고객이 결정한다
      await page.click('.notif-panel button:has-text("닫기")')
      await page.click('.tabs button:has-text("일정")')
      await page.waitForTimeout(150)
      const dPlus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
      await page.fill('.form input[type="date"]', dPlus3)
      await page.locator('.form select').nth(1).selectOption('9')
      await page.locator('.form select').nth(2).selectOption('11')
      await page.fill('input[aria-label="일정 변경 사유"]', '앞 현장 지연')
      await page.click('button:has-text("일정 변경 제안")')
      await page.waitForTimeout(200)
      step(
        '파트너 일정 변경 제안(D+3 9~11) → 승인 대기 (28-95)',
        (await page.locator('[data-schedule-msg]').innerText()).includes('일정 변경을 제안') &&
          (await page.locator('[data-schedule-pending]').innerText()).includes(dPlus3),
      )
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      step(
        '고객 거래 상세: 일정 변경 제안 카드(D+3 · 사유)',
        (await page.locator('[data-schedule-change]').innerText()).includes(dPlus3) &&
          (await page.locator('[data-schedule-change]').innerText()).includes('앞 현장 지연'),
      )
      await page.click('button:has-text("거절 (기존 일정 유지)")')
      await page.waitForTimeout(200)
      step(
        '제안 거절 → 기존 일정(D+1 10:00) 유지, 제안 카드 사라짐',
        (await text()).includes(`예약 ${tomorrow} 10:00`) && (await page.$('[data-schedule-change]')) === null,
      )
      await goApp(page, '#/partner')
      await page.waitForTimeout(250)
      await page.click('button.bell')
      await page.waitForTimeout(150)
      step(
        '파트너 알림: 고객이 방문 일정을 변경 + 내일 방문 예정 + 일정 변경 거절',
        (await page.locator('.notif-panel').innerText()).includes('일정 변경을 거절') &&
          (await page.locator('.notif-panel').innerText()).includes('고객이 방문 일정을 변경') &&
          (await page.locator('.notif-panel').innerText()).includes('내일 방문 예정'),
      )
      await page.click('.notif-panel button:has-text("닫기")')
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("→ 시공 중")')
      await page.waitForTimeout(200)
      step('시공 시작', (await page.$('.card:has-text("욕실 실리콘 재시공") .chip.st-in_progress')) !== null)
      // 28-49-03: 시공 중 완료 사진 1장 첨부(브라우저 리사이즈) → [data-completion] 썸네일
      await page.setInputFiles('.card:has-text("욕실 실리콘 재시공") input[aria-label="완료 사진"]', [PHOTO1])
      await page.waitForTimeout(400)
      step(
        '파트너 완료 사진 1장 첨부(시공 중)',
        (await page.locator('.card:has-text("욕실 실리콘 재시공") [data-completion] .photo-thumb').count()) === 1,
      )

      // 5) 추가 작업: 공급가 → VAT 미리보기 → 요청 → 완료 차단 (28-96)
      await page.fill('.card:has-text("욕실 실리콘 재시공") input[placeholder="예: 50000"]', '70000')
      step(
        '추가 작업 공급가 70,000 → VAT 7,000 · 합계 77,000 미리보기 (28-96)',
        (await page.locator('.card:has-text("욕실 실리콘 재시공") [data-extra-preview]').innerText()).includes(
          '77,000',
        ),
      )
      await page.fill('.card:has-text("욕실 실리콘 재시공") input[placeholder="예: 곰팡이 제거"]', '곰팡이 제거 추가')
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("고객에게 승인 요청")')
      await page.waitForTimeout(200)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("→ 작업 완료")')
      await page.waitForTimeout(200)
      step('미결정 추가 작업 → 완료 차단', (await text()).includes('결정하지 않은 추가 작업'))

      // 6) 고객 승인 → 최종 금액
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      step(
        '고객 승인 요청 카드: 공급가 70,000 + VAT 7,000 표기 (28-96)',
        (await page.locator('[data-extra-vat]').innerText()).includes('70,000') &&
          (await page.locator('[data-extra-vat]').innerText()).includes('7,000'),
      )
      await page.click('button:has-text("승인하기")')
      await page.waitForTimeout(200)
      step('고객 승인 → 최종 금액 +77,000 (VAT 포함)', (await text()).includes('77,000'))

      // 7) 완료 → 정산 → 리뷰 (28-96: 계약 작업은 전/후 사진이 있어야 완료)
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("→ 작업 완료")')
      await page.waitForTimeout(200)
      step('작업 전 사진 없이 완료 → 차단 (28-96)', (await text()).includes('작업 전 사진과 완료 사진'))
      await page.setInputFiles('.card:has-text("욕실 실리콘 재시공") input[aria-label="작업 전 사진"]', [PHOTO2])
      await page.waitForTimeout(400)
      step(
        '파트너 작업 전 사진 1장 첨부',
        (await page.locator('.card:has-text("욕실 실리콘 재시공") [data-before] .photo-thumb').count()) === 1,
      )
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("→ 작업 완료")')
      await page.waitForTimeout(200)
      // 28-28: 고객 결제 전에는 정산이 도메인 규칙으로 차단된다
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("→ 정산 완료")')
      await page.waitForTimeout(200)
      step('결제 전 정산 차단', (await text()).includes('고객 결제 완료 후'))
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForSelector('.card:has-text("최종 결제")')
      step(
        '고객 거래 상세: 작업 전 1장 + 시공 완료 사진 1장(최종 결제 전)',
        (await page.locator('[data-completion] .photo-thumb').count()) === 1 &&
          (await page.locator('[data-before] .photo-thumb').count()) === 1,
      )
      await page.click('.card:has-text("최종 결제") button:has-text("결제하기")')
      await page.waitForTimeout(200)
      step(
        '고객 최종 결제(예약금 차감) → 영수증',
        (await text()).includes('최종 결제') && (await text()).includes('322,000'), // 275,000 + 77,000 − 계약 예약금 30,000
      )
      // 28-97: 영수증에 주문번호(= 결제사 멱등 키)가 남는다
      step(
        '영수증 주문번호 BD-…-final-…',
        /^BD-REQ-\d{4}-final-\d{4}$/.test((await page.locator('[data-order-id]').last().innerText()).trim()),
      )
      // 28-97: 부분 환불 → 정산·지급 보류 → 처리 → 수수료·지급액 재산정 (총액 352,000 · 3%)
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("정산 감독")')
      await page.waitForTimeout(200)
      const settleRow = page.locator('[data-settlement]').first()
      const settleText = async () => (await settleRow.innerText()).replace(/\s+/g, ' ')
      step(
        '관리자 정산 내역: 총액 352,000 − 환불 0 − 수수료 10,560 = 341,440',
        (await settleText()).includes('총액 352,000원 − 환불 0원 − 수수료 10,560원 (3%) = 341,440원'),
      )
      await settleRow.locator('input[aria-label="환불 금액"]').fill('22000')
      await settleRow.locator('input[aria-label="환불 사유"]').fill('타일 파손 보상')
      await settleRow.locator('[data-add-refund]').click()
      await page.waitForTimeout(200)
      step('부분 환불 등록 → 환불 대기 22,000', (await settleText()).includes('환불 대기 22,000원'))
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("→ 정산 완료")')
      await page.waitForTimeout(200)
      step('환불 대기 중에는 정산 확정 차단', (await text()).includes('환불 대기 중인 거래는 정산할 수 없습니다'))
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(200)
      await page.click('.ops-card [data-ops="refund"] button:has-text("환불 완료")')
      await page.waitForTimeout(200)
      step('관리자 환불 완료 처리', (await text()).includes('환불 완료'))
      await page.click('.tabs button:has-text("정산 감독")')
      await page.waitForTimeout(200)
      step(
        '환불 반영 재산정: 수수료 9,900 · 지급액 320,100',
        (await settleText()).includes('총액 352,000원 − 환불 22,000원 − 수수료 9,900원 (3%) = 320,100원'),
      )
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("→ 정산 완료")')
      await page.waitForTimeout(200)
      step('완료 → 정산', (await page.$('.card:has-text("욕실 실리콘 재시공") .chip.st-settled')) !== null)
      // 7.5) 정산 지급 (28-38): 계좌 미등록 → 관리자 지급 거부 → 파트너 계좌 등록 → 지급 완료 → 파트너 확인
      //
      // 28-91: 시연 이력이 사라져 지급 대기는 이번 여정의 1건뿐이다. 행은 요청 id로 집는다(개수에 기대지 않는다).
      const myReqId = await page.evaluate(() => {
        const snap = JSON.parse(localStorage.getItem('banded-platform-v1'))
        return (snap.store.requests.find((r) => r.description.includes('욕실 실리콘 재시공')) ?? {}).id
      })
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(150)
      step(
        '관리자 현황 조치 필요: 지급 대기 1건(이번 여정 — 시연 이력 없음, 28-91)',
        (await page.locator('.ops-card [data-ops="payout"] .list-row').count()) === 1 && typeof myReqId === 'string',
      )
      step(
        '관리자 저장 용량 카드: 사진 4장(현장 2 + 작업 전 1 + 완료 1, 28-96)',
        /사진 4장/.test(await page.locator('[data-storage]').innerText()),
      )
      step(
        '저장 용량 내역: 알림·채팅 건수 표시',
        /알림 \d+건 .*채팅 \d+건/.test(
          (await page.locator('[data-storage-breakdown]').innerText()).replace(/\s+/g, ' '),
        ),
      )
      await page.click('.tabs button:has-text("정산 감독")')
      await page.waitForTimeout(150)
      step(
        '관리자 지급 대기 4건(계좌 미등록 표시)',
        (await page.$$('.pending-payout-row')).length === 1 && (await text()).includes('계좌 미등록'),
      )
      await page.click(`.pending-payout-row:has-text("${myReqId}") button:has-text("지급 완료")`)
      await page.waitForTimeout(150)
      step('계좌 미등록 파트너 지급 거부', (await text()).includes('정산 계좌가 등록되지 않은'))
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("정산")')
      await page.waitForTimeout(150)
      step(
        '파트너 정산 탭: 계좌 등록 배너 + 지급 대기',
        (await page.$('[data-payout-banner]')) !== null && (await text()).includes('지급 대기'),
      )
      await page.fill('input[aria-label="계좌번호"]', '123456-78-901234')
      // 28-90: 예금주는 가입한 이름과 같아야 한다 — 다른 이름은 거부된다
      await page.fill('input[aria-label="예금주"]', '김파트너')
      await page.click('button:has-text("계좌 저장")')
      await page.waitForTimeout(150)
      step('예금주가 가입 이름과 다르면 거부 (28-90)', (await text()).includes('가입한 이름과 같아야'))
      await page.fill('input[aria-label="예금주"]', '반듯설비')
      await page.click('button:has-text("계좌 저장")')
      await page.waitForTimeout(150)
      const accLabel = await page.$eval('[data-payout-account]', (el) => el.textContent.trim())
      step(
        '정산 계좌 저장 + 마스킹 표기',
        accLabel.includes('국민은행') &&
          accLabel.includes('123********234') &&
          (await page.$('[data-payout-banner]')) === null,
      )
      step(
        '저장 직후는 인증 대기 (28-90)',
        (await page.getAttribute('[data-payout-verified]', 'data-payout-verified')) === 'no',
      )
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("정산 감독")')
      await page.waitForTimeout(150)
      // 28-90: 인증 전에는 지급 버튼이 있어도 도메인이 거부한다 — 화면이 아니라 규칙이 막는다
      await page.click(`.pending-payout-row:has-text("${myReqId}") button:has-text("지급 완료")`)
      await page.waitForTimeout(150)
      step('미인증 계좌 지급 거부 (28-90)', (await text()).includes('인증되지 않은 정산 계좌'))
      await page.click(`.pending-payout-row:has-text("${myReqId}") [data-verify-payout]`)
      await page.waitForTimeout(200)
      step(
        '관리자 계좌 인증 → 인증됨 표시',
        (await page.locator(`.pending-payout-row:has-text("${myReqId}")`).innerText()).includes('인증됨'),
      )
      await page.click(`.pending-payout-row:has-text("${myReqId}") button:has-text("지급 완료")`)
      await page.waitForTimeout(150)
      step(
        '관리자 지급 완료 → 지급 대기 0건 · 지급 완료 1건',
        (await page.$$('.pending-payout-row')).length === 0 && (await page.$$('.paid-payout-row')).length === 1,
      )
      // 28-47-02: 월별 원장 + CSV 다운로드(BOM·헤더·행 수 검증)
      const ledgerRowsOnScreen = await page.$$('.ledger-row')
      step(
        '관리자 월별 원장: 결제·수수료·지급 행 표시',
        ledgerRowsOnScreen.length >= 4 &&
          (await page.locator('[data-ledger-summary]').innerText()).includes('플랫폼 수수료'),
      )
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-ledger]')])
      const csvText = await (async () => {
        const st = await dl.createReadStream()
        const chunks = []
        for await (const c of st) chunks.push(c)
        return Buffer.concat(chunks).toString('utf8')
      })()
      step(
        '원장 CSV: BOM + 한글 헤더 + 행 수 일치',
        csvText.startsWith('\uFEFF날짜,구분,요청,상대방,금액,참조,메모') &&
          csvText.trim().split('\r\n').length === ledgerRowsOnScreen.length + 1 &&
          dl.suggestedFilename().startsWith('ledger-'),
      )
      // 28-57-01/02: 운영 기록 카드 — 지급 완료·파트너 승인 기록 + CSV
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(150)
      const auditText = await page.locator('[data-audit-log]').innerText()
      step(
        '관리자 현황 운영 기록: 지급 완료 + 파트너 승인 기록',
        auditText.includes('지급 완료') &&
          auditText.includes('파트너 승인') &&
          (await page.locator('.audit-row[data-audit-actor="admin"]').count()) >= 2,
      )
      const [dlA] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-audit]')])
      const csvA = await (async () => {
        const st = await dlA.createReadStream()
        const chunks = []
        for await (const c of st) chunks.push(c)
        return Buffer.concat(chunks).toString('utf8')
      })()
      step(
        '운영 기록 CSV: BOM + 헤더 + 지급 완료 행',
        csvA.startsWith('\uFEFF시각,주체,행위자,행위,대상,상세') &&
          /관리자,[^,]*,지급 완료,/.test(csvA) &&
          dlA.suggestedFilename().startsWith('audit-'),
      )
      // 28-57-03: 요청 관리 검색·상태 필터, 회원 검색
      await page.click('.tabs button:has-text("요청 관리")')
      await page.waitForTimeout(150)
      await page.fill('input[aria-label="요청 검색"]', '실리콘')
      await page.waitForTimeout(100)
      const reqRows = await page.$$('tr.rowlink')
      step('요청 관리 검색 "실리콘" → 1행', reqRows.length === 1 && (await reqRows[0].textContent()).includes('실리콘'))
      await page.fill('input[aria-label="요청 검색"]', '')
      await page.selectOption('select[aria-label="상태 필터"]', 'cancelled')
      await page.waitForTimeout(100)
      step(
        '요청 관리 상태 필터 "취소" → 0행 + 빈 안내',
        (await page.$$('tr.rowlink')).length === 0 && (await page.$('[data-requests-empty]')) !== null,
      )
      await page.selectOption('select[aria-label="상태 필터"]', 'settled')
      await page.waitForTimeout(100)
      step('요청 관리 상태 필터 "정산 완료" → 1행(이번 여정뿐, 28-91)', (await page.$$('tr.rowlink')).length === 1)
      await page.selectOption('select[aria-label="상태 필터"]', 'all')
      await page.click('.tabs button:has-text("회원")')
      await page.waitForTimeout(150)
      await page.fill('input[aria-label="회원 검색"]', '010-1234')
      await page.waitForTimeout(100)
      const memRows = await page.$$('tr.member-row')
      step(
        '회원 검색 "010-1234" → 고객 1행',
        memRows.length === 1 && (await memRows[0].textContent()).includes('010-1234-5678'),
      )
      await page.fill('input[aria-label="회원 검색"]', '없는사람')
      await page.waitForTimeout(100)
      step(
        '회원 검색 결과 없음 안내',
        (await page.$$('tr.member-row')).length === 0 && (await text()).includes('검색 결과가 없습니다'),
      )
      await page.fill('input[aria-label="회원 검색"]', '')
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("정산")')
      await page.waitForTimeout(150)
      step(
        '파트너 작업별 지급 상태: 지급 완료',
        (await page.locator('.payout-row', { hasText: '지급 완료' }).count()) === 1,
      )
      // 28-47-03: 내 정산 내역 CSV
      const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-settlement]')])
      const csv2 = await (async () => {
        const st = await dl2.createReadStream()
        const chunks = []
        for await (const c of st) chunks.push(c)
        return Buffer.concat(chunks).toString('utf8')
      })()
      step(
        '파트너 정산 CSV: 헤더 + 지급 완료 행',
        csv2.startsWith('\uFEFF요청,완료일,총액,수수료,지급액,정산 확정,지급일,계좌') &&
          csv2.includes(',Y,') &&
          dl2.suggestedFilename().startsWith('settlement-'),
      )
      // 28-68-04c: 파일로 나가는 계좌 표기는 예금주까지 마스킹된다 — 28-67-01을 실사용 여정이 지킨다
      // 28-90: 예금주 = 가입 이름(반듯설비)이라 마스킹본은 '반***' 이다. 상호 그대로가 파일에 남으면 안 된다
      step(
        '파트너 정산 CSV: 계좌 열이 마스킹본(예금주 실명 없음)',
        /\(반\*+\)/.test(csv2) && !/\(반듯설비\)/.test(csv2),
      )
      step(
        '파트너 알림: 정산금 지급 완료',
        Number(await page.$eval('.bell-count', (el) => el.textContent.trim()).catch(() => '0')) >= 1,
      )
      // 28-58-01: 전체 백업은 파트너에게 노출되지 않는다(관리자 전용으로 이전)
      await page.click('.tabs button:has-text("대시보드")')
      await page.waitForTimeout(150)
      step(
        '파트너 대시보드에 전체 백업 없음',
        !(await text()).includes('데이터 백업') && (await page.$('input[type=file]')) === null,
      )
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForSelector('.star-pick')
      await page.click('.star-pick button:nth-child(5)')
      await page.click('button:has-text("리뷰 등록")')
      await page.waitForTimeout(200)
      step('리뷰 등록 → 타임라인', (await text()).includes('리뷰 작성 (★5)'))

      // 7.5) 분쟁 접수 → 파트너 답변 → 관리자 해결 → 고객 확인 (28-22-05 → 28-90: A/S 와 분쟁이 하나다)
      await page.fill('input[placeholder*="들떠요"]', '실리콘 일부가 다시 들떴어요')
      await page.click('[data-file-claim]')
      await page.waitForTimeout(200)
      step(
        '고객 분쟁 접수 (완료 뒤 하자도 같은 통로)',
        (await text()).includes('접수됨') && (await text()).includes('정산·지급 보류'),
      )
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      await page.fill(
        '.card:has-text("욕실 실리콘 재시공") input[aria-label="분쟁 답변"]',
        '내일 오전 재방문하겠습니다',
      )
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("답변 저장")')
      await page.waitForTimeout(200)
      step(
        '파트너 분쟁 답변 저장',
        (await text()).includes('내 답변') && (await text()).includes('내일 오전 재방문하겠습니다'),
      )
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      step(
        '고객 거래 상세: 파트너 답변 표시',
        (await page.locator('[data-claim-reply]').innerText()).includes('내일 오전 재방문'),
      )
      await goApp(page, '#/admin')
      // 관리자 세션 유지 확인 (28-30 로그인은 2.5 단계에서 수행)
      step('관리자 로그인(시드 계정) 세션 유지', (await text()).includes('관리자님'))
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(150)
      step(
        '관리자 현황 조치 필요: 미해결 분쟁 1건',
        (await page.locator('.ops-card [data-ops="claims"] .list-row').count()) === 1,
      )
      await page.click('.tabs button:has-text("분쟁")')
      await page.waitForTimeout(150)
      step(
        '관리자 분쟁 탭: 파트너 답변 표시',
        (await page.locator('[data-claim-reply]').innerText()).includes('재방문하겠습니다'),
      )
      await page.fill('input[placeholder*="재방문"]', '재방문 후 실리콘 재시공 완료')
      await page.click('button:has-text("해결 처리")')
      await page.waitForTimeout(200)
      step('관리자 해결 처리', (await text()).includes('해결 이력'))
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      step('고객이 해결 결과 확인', (await text()).includes('재방문 후 실리콘 재시공 완료'))
      // 28-53-03: 리뷰 답글 → 고객 업체 카드
      await goApp(page, '#/partner')
      await page.click('.tabs button:has-text("마이")')
      await page.waitForTimeout(150)
      await page.fill('input[aria-label="리뷰 답글"]', '이용해 주셔서 감사합니다')
      await page.click('button:has-text("답글 저장")')
      await page.waitForTimeout(200)
      step(
        '파트너 리뷰 답글 저장',
        (await text()).includes('내 답글') && (await text()).includes('이용해 주셔서 감사합니다'),
      )
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.card:has-text("욕실 실리콘 재시공") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      step(
        '고객 거래 상세 업체 카드: 리뷰 답글',
        (await page.locator('[data-review-reply]').first().innerText()).includes('감사합니다'),
      )

      // 8) 관리자 관제 + 영속성
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("리뷰")')
      await page.waitForTimeout(150)
      step('관리자 리뷰 관제', (await text()).includes('★'))
      await page.reload()
      await page.waitForSelector('.app-header')
      // 새로고침 시 현재 해시 앱(#/admin) 유지가 곧 딥링크 영속 — 데이터 영속은 고객 홈에서 확인
      step('새로고침 후 앱 유지(#/admin)', (await page.$('.app-badge')) !== null)
      await goApp(page, '#/')
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.waitForSelector('.tabs button')
      step('새로고침 후 데이터 영속(localStorage)', (await text()).includes('욕실 실리콘 재시공'))
      step('내 요청만 표시(계정 미연결 시드 숨김)', !(await text()).includes('물이 새요'))

      // 8.4) 계정 관리 (28-33): 마이 탭 비밀번호 변경 → 로그아웃 → 새 비밀번호로 로그인
      await page.click('.tabs button:has-text("마이")')
      await page.waitForTimeout(150)
      await page.fill('input[aria-label="현재 비밀번호"]', 'password1')
      await page.fill('input[aria-label="새 비밀번호"]', 'newpass123')
      await page.fill('input[aria-label="새 비밀번호 확인"]', 'newpass123')
      await page.click('button:has-text("비밀번호 변경")')
      await page.waitForTimeout(150)
      step('고객 마이페이지 비밀번호 변경', (await text()).includes('비밀번호를 변경했습니다'))
      // 28-37-03: 마이페이지 마케팅 수신 철회 (가입 시 전체 동의 → 수신 중)
      step(
        '마이페이지 동의 내역: 마케팅 수신 중',
        (await page.locator('[data-consent="marketing"]').innerText()).includes('수신 중'),
      )
      await page.uncheck('input[aria-label="마케팅 수신 동의"]')
      await page.waitForTimeout(100)
      step(
        '마케팅 수신 철회 → 철회 표시',
        (await page.locator('[data-consent="marketing"]').innerText()).includes('철회'),
      )
      await page.click('.auth-status button:has-text("로그아웃")')
      await page.waitForSelector('.card:has-text("고객 로그인")')
      // 28-51-02: 5회 오답 → 잠금 → 맞는 비밀번호도 거부 → 저장소 평문 없음 → 잠금 해제 시각을 과거로 조정 후 새로고침 → 정상 로그인
      await page.fill('input[placeholder="010-0000-0000"]', '010-1234-5678')
      for (let i = 0; i < 5; i += 1) {
        await page.fill('input[type="password"]', `wrong-pass-${i}`)
        await page.click('.card:has-text("고객 로그인") button:has-text("로그인")')
        await page.waitForTimeout(80)
      }
      step('로그인 5회 실패 → 15분 잠금 안내', (await text()).includes('잠겼습니다'))
      await page.fill('input[type="password"]', 'newpass123')
      await page.click('.card:has-text("고객 로그인") button:has-text("로그인")')
      await page.waitForTimeout(150)
      step('잠금 중에는 맞는 비밀번호도 거부', (await text()).includes('잠겨 있습니다'))
      const authRaw = await page.evaluate(() => localStorage.getItem('banded-auth-v1') ?? '')
      step(
        '저장소에 평문 비밀번호 없음 + 해시 존재',
        !authRaw.includes('newpass123') &&
          !authRaw.includes('password1') &&
          authRaw.includes('"passwordHash":"s256$') &&
          /"admins":\[\{[^\]]*"grade":"owner"[^\]]*"passwordHash":"s256\$/.test(authRaw) &&
          !authRaw.includes('adminPasswordHash'),
      )
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('banded-auth-v1'))
        s.loginFails = (s.loginFails ?? []).map(([k, v]) => [k, { ...v, lockedUntil: 1 }])
        localStorage.setItem('banded-auth-v1', JSON.stringify(s))
      })
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.waitForSelector('.card:has-text("고객 로그인")')
      await page.fill('input[placeholder="010-0000-0000"]', '010-1234-5678')
      await page.fill('input[type="password"]', 'newpass123')
      await page.click('.card:has-text("고객 로그인") button:has-text("로그인")')
      await page.waitForTimeout(200)
      step('잠금 해제 후 새 비밀번호로 재로그인', (await text()).includes('정지훈님'))
      await page.screenshot({ path: join(OUT, 'e2e-final.png'), fullPage: true })

      // 8.5) 운영 설정 반영 (28-21-04): 관리자가 조작 → 고객 웹 즉시 반영
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(150)
      await page.fill('textarea >> nth=0', '우리 동네 집수리 전문가')
      await page.click('button:has-text("문구 저장")')
      await page.waitForTimeout(150)
      step('관리자 문구 저장', (await text()).includes('저장했습니다'))
      await page.click('.toggle-row:has-text("도배") input')
      await page.waitForTimeout(200)
      await goApp(page, '#/')
      await page.waitForSelector('.landing')
      const landingTxt = await text()
      step('고객 랜딩에 새 문구 반영', landingTxt.includes('우리 동네 집수리 전문가'))
      const catLabels = await page.$$eval('.cat-card', (els) => els.map((e) => e.textContent.trim()))
      step('비활성 카테고리(도배·도장·필름) 숨김', !catLabels.some((l) => l.startsWith('도배')))
      step('FAQ 섹션 노출', landingTxt.includes('자주 묻는 질문'))
      step('표준 가격 섹션(시드 패키지) 노출', landingTxt.includes('표준 가격') && landingTxt.includes('90,000원'))
      const sectionOrder = () =>
        page.$$eval('[data-landing-section]', (els) => els.map((e) => e.getAttribute('data-landing-section')))
      step(
        '첫 화면 기본 배치: 여섯 섹션 기본 순서 (28-89-B)',
        (await sectionOrder()).join(',') === 'categories,steps,services,packages,faq,cta',
      )

      // 28-89-B: 관리자가 **코드 없이** 첫 화면 배치를 바꾼다 — FAQ 를 맨 위로, 4단계는 숨기고, FAQ 제목을 고친다
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(150)
      step(
        '관리자 설정: 첫 화면 배치 카드 (28-89-B)',
        (await page.$('[data-layout-card]')) !== null && (await page.$$('[data-layout-row]')).length === 6,
      )
      step('바꾸기 전에는 배치 저장 비활성', await page.$eval('[data-layout-save]', (el) => el.disabled))
      for (let i = 0; i < 4; i += 1) await page.click('[data-layout-row="faq"] [data-layout-up]')
      await page.click('[data-layout-row="steps"] [data-layout-toggle]')
      await page.fill('[data-layout-row="faq"] [data-layout-title]', '궁금한 것들')
      step(
        '배치를 바꾸면 저장 활성 + 숨긴 행 표시',
        (await page.$eval('[data-layout-save]', (el) => el.disabled)) === false &&
          (await page.$('[data-layout-row="steps"][data-layout-visible="0"]')) !== null,
      )
      await page.click('[data-layout-save]')
      await page.waitForTimeout(150)
      step('배치 저장 안내', (await text()).includes('첫 화면 배치를 저장했습니다'))
      await goApp(page, '#/')
      await page.waitForSelector('.landing')
      const movedOrder = await sectionOrder()
      step(
        '고객 첫 화면: FAQ 가 맨 위, 4단계는 없음 (28-89-B)',
        movedOrder[0] === 'faq' && !movedOrder.includes('steps') && movedOrder.length === 5,
      )
      step(
        '고객 첫 화면: 고친 FAQ 제목 반영',
        (await text()).includes('궁금한 것들') && !(await text()).includes('자주 묻는 질문'),
      )
      // 뒤 단계가 기본 배치를 전제하므로 되돌린다 — "기본 배치로" 도 실제 경로다
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(150)
      await page.click('[data-layout-reset]')
      await page.click('[data-layout-save]')
      await page.waitForTimeout(150)
      await goApp(page, '#/')
      await page.waitForSelector('.landing')
      step(
        '기본 배치로 되돌리기 → 기본 순서·기본 제목 복귀',
        (await sectionOrder()).join(',') === 'categories,steps,services,packages,faq,cta' &&
          (await text()).includes('자주 묻는 질문'),
      )

      // 8.6) 가격 패키지 (28-25-04): 관리자 등록 → 랜딩 노출 → 숨김 → 사라짐
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(150)
      await page.fill('input[placeholder="예: 형광등 교체"]', '형광등 교체')
      await page.selectOption('.form select', '전기·조명')
      await page.fill('input[placeholder="예: 30000"]', '30000')
      await page.click('button:has-text("패키지 등록")')
      await page.waitForTimeout(150)
      await goApp(page, '#/')
      await page.waitForSelector('.landing')
      step('관리자 패키지 등록 → 랜딩 노출', (await text()).includes('형광등 교체'))
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(150)
      await page.click('.pkg-row:has-text("형광등 교체") button:has-text("숨김")')
      await page.waitForTimeout(150)
      await goApp(page, '#/')
      await page.waitForSelector('.landing')
      step('패키지 숨김 → 랜딩에서 제거', !(await text()).includes('형광등 교체'))

      // 9) 모바일 점검
      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      await mobile.goto(url)
      await mobile.waitForSelector('.app-header')
      const hscroll = await mobile.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      )
      step('모바일(390px) 가로 스크롤 없음', !hscroll)
      const brandH = await mobile.$eval('.app-header h1', (el) => el.getBoundingClientRect().height)
      step('모바일 헤더 제목 한 줄(줄바꿈 없음)', brandH < 32)
      await mobile.goto(url + '#/partner')
      await mobile.waitForTimeout(300)
      step('파트너 딥링크(#/partner) 직행 + 뱃지', (await mobile.$('.app-badge')) !== null)

      // 10) 역할별 경로 주소 (28-29-01): /partner·/admin 직접 진입
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      step(
        '경로 주소 /partner → 파트너 센터',
        (await page.$eval('.app-badge', (el) => el.textContent).catch(() => '')) === '파트너',
      )
      await page.goto(url + 'admin/')
      await page.waitForTimeout(300)
      step(
        '경로 주소 /admin/ (끝 슬래시) → 관리자 콘솔',
        (await page.$eval('.app-badge', (el) => el.textContent).catch(() => '')) === '관리자',
      )

      // 28-91: 시연 시드가 사라졌다 — 뒤 단계(파트너2 입찰 · 맞춤 토글)가 쓰던 열린 일감 둘을 고객이 직접 올린다.
      //   '욕실 천장에서 물이 새요'(누수·서울 강서구)는 파트너1 프로필(욕실·누수·서울)에 맞고,
      //   '거실 콘센트 교체 3곳'(전기·서울 마포구)은 분야가 달라 맞춤 토글에서 빠진다.
      const postRequest = async (category, region, description) => {
        await page.goto(url)
        await page.waitForTimeout(300)
        if (await page.$('.landing')) await page.click('[data-browse]')
        await page.click('.tabs button:has-text("수리 요청")')
        await page.waitForSelector('.wizard-steps')
        await page.click(`.cat-card[data-category="${category}"]`)
        await pickRegion(page, ...region.split(' '))
        await page.fill('input[aria-label="상세 주소"]', '테스트로 1길 1, 1층') // 28-94
        await page.fill('input[placeholder="예: 거실 도배 시공, 방 2개 포함"]', description)
        await answerSafetyNo(page) // 28-93
        await page.click('button:has-text("다음")')
        await page.waitForSelector('text=언제 방문하면')
        await page.click('button:has-text("다음")')
        await page.click('.budget-option:has-text("30~50만원")')
        await page.click('button:has-text("다음")')
        await page.click('button:has-text("입찰 시작하기")')
        await page.waitForTimeout(200)
      }
      await postRequest('급배수·누수·설비', '서울 강서구', '욕실 천장에서 물이 새요')
      await postRequest('전기·조명', '서울 마포구', '거실 콘센트 교체 3곳')
      step('고객이 열린 일감 2건을 더 올린다 (28-91: 시연 시드 대신)', (await text()).includes('요청을 등록했습니다'))
      // 28-93: 둘 다 범위 검토 분야라 관리자 검토를 거쳐야 파트너에게 보인다
      step(
        '관리자 검토 2건 (28-93)',
        (await adminReview(page, url, '욕실 천장에서 물이 새요')) &&
          (await adminReview(page, url, '거실 콘센트 교체 3곳')),
      )

      // 10.4) 파트너 범위 분리 (28-41): 두 번째 파트너는 첫 파트너의 작업·정산·알림을 보지 못한다
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      await page.click('.auth-status button:has-text("로그아웃")')
      await page.waitForSelector('.card:has-text("파트너 로그인")')
      await page.click('button:has-text("처음이신가요? 회원가입")')
      await page.fill('input[placeholder="예: 반듯설비"]', '둘째설비')
      await page.fill('input[placeholder="010-0000-0000"]', '010-7777-6666')
      await page.fill('input[type="password"]', 'password1')
      await page.check('input[aria-label="전체 동의"]')
      await page.click('.partner-type button:has-text("개인")')
      await page.click('button:has-text("가입하고 인증번호 받기")')
      await page.fill('input[aria-label="인증번호"]', await page.$eval('.otp-code', (el) => el.textContent.trim()))
      await page.click('button:has-text("인증하고 시작하기")')
      await page.waitForTimeout(200)
      step('파트너2 가입·로그인', (await text()).includes('둘째설비님'))
      step('파트너2 대시보드: 알림 없음(파트너1 알림 미노출)', (await page.$('.bell-count')) === null)
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      step('파트너2 내 작업: 파트너1 작업(욕실 실리콘) 미노출', !(await text()).includes('욕실 실리콘 재시공'))
      await page.click('.tabs button:has-text("정산")')
      await page.waitForTimeout(150)
      step('파트너2 정산: 작업별 지급 상태 0건', (await text()).includes('작업별 지급 상태 (0건)'))
      await page.click('.tabs button:has-text("마이")')
      await page.waitForTimeout(150)
      step(
        '파트너2 마이: 파트너1 리뷰·프로필 미노출',
        !(await text()).includes('반듯설비') && (await text()).includes('총 입찰 0'),
      )
      await page.goto(url + 'admin')
      await page.waitForTimeout(300)
      await page.click('.tabs button:has-text("회원")')
      await page.waitForTimeout(150)
      await page.click('.member-row:has-text("둘째설비") button:has-text("승인")')
      await page.waitForTimeout(150)
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("욕실 천장에서 물이 새요") button:has-text("이 일감에 입찰")')
      await page.click('button:has-text("입찰 제안하기")')
      await page.waitForTimeout(200)
      step(
        '파트너2 열린 일감 입찰(파트너2 id로 견적)',
        (await text()).includes('입찰을 제안했습니다') ||
          (await page.$('.card:has-text("욕실 천장에서 물이 새요") .chip.st-estimated')) !== null,
      )
      await page.click('.auth-status button:has-text("로그아웃")')
      await page.waitForSelector('.card:has-text("파트너 로그인")')
      await page.fill('input[placeholder="010-0000-0000"]', '010-9999-8888')
      await page.fill('input[type="password"]', 'password1')
      await page.click('.card:has-text("파트너 로그인") button:has-text("로그인")')
      await page.waitForTimeout(200)
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      step(
        '파트너1 일감: 파트너2가 입찰한 건도 노출 + 입찰 1건 표시(28-42-03)',
        (
          await page.locator('.card', { has: page.locator('h3', { hasText: '욕실 천장에서 물이 새요' }) }).innerText()
        ).includes('입찰 1건'),
      )
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      step('파트너1 내 작업 유지(욕실 실리콘)', (await text()).includes('욕실 실리콘 재시공'))

      // 10.44) 지역·분야 매칭 (28-46): 파트너1 프로필(욕실·서울) → 일감 탭 맞춤 토글 → 새 서울 욕실 요청 알림
      await page.click('.tabs button:has-text("마이")')
      await page.waitForTimeout(150)
      await page.click('.specialty-pick .cat-card[data-category="주방·욕실 공사"]')
      await page.click('.specialty-pick .cat-card[data-category="급배수·누수·설비"]') // 서울 누수 건이 맞춤으로 잡히게
      await page.fill('input[aria-label="서비스 지역"]', '서울')
      await page.click('button:has-text("저장")')
      await page.waitForTimeout(150)
      step(
        '파트너1 프로필: 전문 분야 욕실·누수 + 지역 서울 저장',
        (await text()).includes('프로필을 저장했습니다') && (await text()).includes('전문 분야: 주방·욕실 공사'),
      )
      // 28-61-03: 파트너 열람권 — 내 입찰·낙찰 범위만
      const [dlPd] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-partnerdata]')])
      const pdText = await (async () => {
        const st = await dlPd.createReadStream()
        const chunks = []
        for await (const c of st) chunks.push(c)
        return Buffer.concat(chunks).toString('utf8')
      })()
      const pd = JSON.parse(pdText)
      step(
        '파트너 내 데이터 JSON: 내 일감만',
        dlPd.suggestedFilename().startsWith('my-partner-data-') &&
          pd.requests.length > 0 &&
          pd.estimates.length === pd.requests.length,
      )
      step(
        '파트너 내 데이터: 고객 이름·요청 내용 없음',
        !pdText.includes('정지훈') &&
          pd.requests.every((r) => r.customerName === undefined && r.description === undefined),
      )
      step('파트너 내 데이터: 철회 이력 항목 존재', Array.isArray(pd.withdrawnBids))
      // 28-68-04c: 열람권 JSON에 예금주 실명이 없고 마스킹 계좌가 있다 — EXPORT_PAYOUT_KEYS를 되돌리면 여기서 깨진다
      step(
        '파트너 내 데이터: 예금주 실명 없음 + 마스킹 계좌 있음 (28-67-01)',
        !pdText.includes('(반듯설비)') &&
          pd.jobs.some((j) => j.payout && /\(반\*+\)$/.test(j.payout.accountMasked) && j.payout.account === undefined),
      )
      // 28-63-03: 남은 토글도 같은 부품 규칙(role=group + aria-pressed)을 따른다
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(200)
      const workGroup = await page.$eval('[role="group"][aria-label="작업 상태 필터"]', (g) => ({
        pressed: [...g.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed')),
      }))
      step(
        '파트너 작업 필터: role=group + 선택 1개만 aria-pressed',
        workGroup.pressed.filter((p) => p === 'true').length === 1 && workGroup.pressed.length >= 3,
      )
      await page.click('.tabs button:has-text("정산")')
      await page.waitForTimeout(200)
      const setGroup = await page.$eval('[role="group"][aria-label="정산 상태 필터"]', (g) =>
        [...g.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed')),
      )
      step('파트너 정산 필터: 선택 1개만 aria-pressed', setGroup.filter((p) => p === 'true').length === 1)

      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      // 입찰 폼의 일감 select에는 전체 후보가 들어 있으므로 카드 제목(h3)으로만 판정한다
      step(
        '일감 탭: "내 지역·분야만" 기본 켜짐 → 맞춤 태그 건만',
        (await page.isChecked('input[aria-label="내 지역·분야만"]')) &&
          (await page.locator('.card [data-matched]').count()) >= 1 &&
          (await page.locator('.card h3', { hasText: '거실 콘센트 교체' }).count()) === 0,
      )
      await page.uncheck('input[aria-label="내 지역·분야만"]')
      await page.waitForTimeout(100)
      step(
        '토글 해제 → 전체 일감(전기 건 표시)',
        (await page.locator('.card h3', { hasText: '거실 콘센트 교체' }).count()) === 1,
      )
      const bellBefore = Number(await page.$eval('.bell-count', (el) => el.textContent.trim()).catch(() => '0'))
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("수리 요청")')
      await page.waitForSelector('.wizard-steps')
      await page.click('.cat-card[data-category="주방·욕실 공사"]')
      await pickRegion(page, '서울', '동작구')
      await page.fill('input[aria-label="상세 주소"]', '테스트로 2길 2, 2층') // 28-94
      await page.fill('input[placeholder="예: 거실 도배 시공, 방 2개 포함"]', '세면대 교체')
      await answerSafetyNo(page) // 28-93
      await page.click('.q-item button:has-text("곰팡이 있음")')
      await page.click('button:has-text("다음")')
      await page.waitForSelector('text=언제 방문하면')
      await page.click('button:has-text("다음")')
      await page.click('.budget-option:has-text("30~50만원")')
      await page.click('button:has-text("다음")')
      await page.click('button:has-text("입찰 시작하기")')
      await page.waitForTimeout(200)
      // 28-93: 검토 전에는 알림도 가지 않는다 — 검토 완료가 알림을 보낸다
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      const bellHeld = Number(await page.$eval('.bell-count', (el) => el.textContent.trim()).catch(() => '0'))
      step('검토 전: 파트너1 새 일감 알림 없음 (28-93)', bellHeld === bellBefore)
      step('관리자 검토 (세면대 교체)', await adminReview(page, url, '세면대 교체'))
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      const bellAfter = Number(await page.$eval('.bell-count', (el) => el.textContent.trim()).catch(() => '0'))
      step('검토 완료 → 파트너1 새 일감 알림 +1', bellAfter === bellBefore + 1)
      await page.click('button.bell')
      await page.waitForTimeout(150)
      step(
        '알림 패널: 내 지역·분야 새 일감',
        (await page.locator('.notif-panel').innerText()).includes('내 지역·분야 새 일감'),
      )
      await page.click('.notif-panel button:has-text("닫기")')

      // 28-50: 파트너 낙찰 철회 → 재오픈 (세면대 교체 건): 입찰 → 고객 수락 → 파트너 철회(사유) → 일감 재노출 → 재입찰 → 고객 배너·파트너 카드 경고
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("세면대 교체") button:has-text("이 일감에 입찰")')
      await page.click('button:has-text("입찰 제안하기")')
      await page.waitForTimeout(200)
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("견적함")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("세면대 교체") button:has-text("견적 수락")')
      await page.waitForTimeout(200)
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("세면대 교체") button:has-text("낙찰 철회")')
      await page.fill('input[aria-label="철회 사유"]', '일정 충돌')
      await page.click('.card:has-text("세면대 교체") button:has-text("철회 확정")')
      await page.waitForTimeout(200)
      step(
        '파트너 낙찰 철회(사유) → 내 작업에서 제거',
        (await page.locator('.card h3', { hasText: '세면대 교체' }).count()) === 0,
      )
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      step(
        '철회 건 일감 탭에 다시 입찰 가능(입찰 0건)',
        (await page.locator('.card:has-text("세면대 교체") button:has-text("이 일감에 입찰")').count()) === 1 &&
          (await page.locator('.card', { has: page.locator('h3', { hasText: '세면대 교체' }) }).innerText()).includes(
            '입찰 0건',
          ),
      )
      await page.click('.card:has-text("세면대 교체") button:has-text("이 일감에 입찰")')
      await page.click('button:has-text("입찰 제안하기")')
      await page.waitForTimeout(200)
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("세면대 교체") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      step('고객 거래 상세: 재오픈 배너', (await page.$('[data-reopen-banner]')) !== null)
      await page.click('.tabs button:has-text("견적함")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("세면대 교체") button:has-text("업체 정보 보기")')
      await page.waitForTimeout(150)
      step(
        '고객 견적함 업체 카드: 낙찰 후 취소 1회 (90일)',
        (await page.locator('.card:has-text("세면대 교체") [data-cancel-count="1"]').count()) >= 1,
      )
      await page.click('.card:has-text("세면대 교체") button:has-text("업체 정보 접기")')

      // 28-52: 낙찰 전 수정 — 고객 요청 수정 → 파트너 견적 수정(1차) → 견적함 태그·금액 → 파트너 입찰 철회 → 일감 재노출
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("세면대 교체") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(200)
      await page.click('[data-edit-request]')
      await page.fill('input[aria-label="수정 내용"]', '세면대 교체 + 수전')
      await pickRegion(page, '서울', '서초구', '수정 ') // 28-92: 수정도 시·도 → 시·군·구 select (서울이어야 파트너1 맞춤에 남는다)
      await page.click('button:has-text("수정 저장")')
      await page.waitForTimeout(200)
      step(
        '고객 요청 수정 → 상세 반영 + 수정됨 1회',
        (await text()).includes('세면대 교체 + 수전') &&
          (await text()).includes('서울 서초구') &&
          (await page.$('[data-edit-count="1"]')) !== null,
      )
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("세면대 교체 + 수전") button:has-text("제안 수정")')
      await page.fill('label:has-text("인건비") input', '130000')
      await page.click('button:has-text("입찰 제안하기")')
      await page.waitForTimeout(200)
      step(
        '파트너 견적 수정 → 카드에 1차 수정',
        (
          await page.locator('.card', { has: page.locator('h3', { hasText: '세면대 교체 + 수전' }) }).innerText()
        ).includes('1차 수정'),
      )
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("견적함")')
      await page.waitForTimeout(150)
      step(
        '고객 견적함: 1차 수정 태그 + 금액 253,000원 반영',
        (await page.$('.card:has-text("세면대 교체 + 수전") [data-revision="1"]')) !== null &&
          (await page.locator('.card:has-text("세면대 교체 + 수전")').innerText()).includes('253,000'),
      )
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("세면대 교체 + 수전") button:has-text("입찰 철회")')
      await page.waitForTimeout(200)
      step(
        '파트너 입찰 철회 → 다시 입찰 가능(입찰 0건)',
        (await page.locator('.card:has-text("세면대 교체 + 수전") button:has-text("이 일감에 입찰")').count()) === 1 &&
          (
            await page.locator('.card', { has: page.locator('h3', { hasText: '세면대 교체 + 수전' }) }).innerText()
          ).includes('입찰 0건'),
      )
      // 28-62-02: 철회 직후 내 데이터에 그 이력이 담긴다
      await page.click('.tabs button:has-text("마이")')
      await page.waitForTimeout(200)
      const [dlPd2] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-partnerdata]')])
      const pd2 = JSON.parse(
        await (async () => {
          const st = await dlPd2.createReadStream()
          const chunks = []
          for await (const c of st) chunks.push(c)
          return Buffer.concat(chunks).toString('utf8')
        })(),
      )
      step(
        '파트너 내 데이터: 철회한 견적도 내 이력',
        pd2.withdrawnBids.length >= 1 &&
          pd2.withdrawnBids.every(
            (w) => typeof w.requestId === 'string' && typeof w.at === 'string' && typeof w.beforeDeadline === 'boolean',
          ),
      )
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)

      // 10.45) 다중 입찰 (28-42): 고객 새 요청 → 파트너1·2 입찰 → 고객 비교·저가 선택 → 낙찰/미낙찰
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("수리 요청")')
      await page.waitForSelector('.wizard-steps')
      await page.click('.cat-card[data-category="주방·욕실 공사"]')
      await pickRegion(page, '서울', '관악구')
      await page.fill('input[aria-label="상세 주소"]', '테스트로 3길 3, 3층') // 28-94
      await page.fill('input[placeholder="예: 거실 도배 시공, 방 2개 포함"]', '주방 수전 교체')
      await answerSafetyNo(page) // 28-93
      await page.click('.q-item button:has-text("곰팡이 있음")')
      await page.click('button:has-text("다음")')
      await page.waitForSelector('text=언제 방문하면')
      await page.click('button:has-text("다음")')
      await page.click('.budget-option:has-text("30~50만원")')
      await page.click('button:has-text("다음")')
      await page.click('button:has-text("입찰 시작하기")')
      await page.waitForTimeout(200)
      step('관리자 검토 (주방 수전 교체, 28-93)', await adminReview(page, url, '주방 수전 교체'))
      // 파트너1(로그인 상태) 입찰 — 기본 금액
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("주방 수전 교체") button:has-text("이 일감에 입찰")')
      await page.click('button:has-text("입찰 제안하기")')
      await page.waitForTimeout(200)
      // 파트너2 로그인 → 할인 견적으로 입찰
      await page.click('.auth-status button:has-text("로그아웃")')
      await page.waitForSelector('.card:has-text("파트너 로그인")')
      await page.fill('input[placeholder="010-0000-0000"]', '010-7777-6666')
      await page.fill('input[type="password"]', 'password1')
      await page.click('.card:has-text("파트너 로그인") button:has-text("로그인")')
      await page.waitForTimeout(200)
      await page.click('.tabs button:has-text("마이")')
      await page.waitForTimeout(150)
      const p2Id = (await page.$eval('.chip.st-accepted', (el) => el.textContent.trim())).replace('파트너', '').trim()
      await page.click('.tabs button:has-text("일감·입찰")')
      await page.waitForTimeout(150)
      step(
        '파트너2 일감: 파트너1 입찰 건에 "입찰 1건 · 아직 입찰 가능"',
        (await page.locator('.card', { has: page.locator('h3', { hasText: '주방 수전 교체' }) }).innerText()).includes(
          '아직 입찰 가능',
        ),
      )
      await page.click('.card:has-text("주방 수전 교체") button:has-text("이 일감에 입찰")')
      await page.getByLabel(/할인/).fill('30000')
      await page.click('button:has-text("입찰 제안하기")')
      await page.waitForTimeout(200)
      step(
        '파트너2 입찰 → 입찰 2건',
        (await page.locator('.card', { has: page.locator('h3', { hasText: '주방 수전 교체' }) }).innerText()).includes(
          '입찰 2건',
        ),
      )
      // 고객 견적함: 2건 비교, 최저가(파트너2) 선택
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("견적함")')
      await page.waitForTimeout(150)
      const cmpCard = page.locator('.card', { hasText: '주방 수전 교체' })
      step(
        '고객 견적함: 견적 2건 비교(최저가 = 파트너2)',
        (await cmpCard.locator('.bid-card').count()) === 2 &&
          (await cmpCard.locator('.bid-card').first().getAttribute('data-bid')) === p2Id &&
          (await cmpCard.innerText()).includes('최저가'),
      )
      await cmpCard.locator(`.bid-card[data-bid="${p2Id}"] button:has-text("이 견적 수락")`).click()
      await page.waitForTimeout(200)
      step(
        '저가 견적 수락 → 결정한 요청',
        (await page.locator('.card', { hasText: '결정한 요청' }).innerText()).includes('주방 수전 교체'),
      )
      // 28-95: 파트너2가 계약서를 보내고 고객이 동의해야 예약금 카드가 열린다
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      await page.click('.tabs button:has-text("일정")')
      await page.waitForTimeout(150)
      await page.locator('.form select').nth(1).selectOption('10')
      await page.locator('.form select').nth(2).selectOption('12')
      await page.fill('input[aria-label="계약 조건"]', '수전 자재 포함')
      await page.click('button:has-text("계약서 보내기")')
      await page.waitForTimeout(200)
      step(
        '파트너2 계약서 v1 발송 (주방 수전)',
        (await page.locator('[data-schedule-msg]').innerText()).includes('계약서 v1'),
      )
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("주방 수전 교체") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(150)
      await page.check('input[aria-label="계약 내용 확인"]')
      await page.click('button:has-text("계약 동의")')
      await page.waitForTimeout(200)
      step('주방 수전 계약 동의 → 방문 예정 10:00', (await text()).includes('10:00'))
      // 28-45-04: 예약금 결제(이후 취소 → 환불 경로 검증용) — 계약의 예약금(비워서 낙찰가 10%)
      await page.click('.card:has-text("예약금 결제") button:has-text("결제하기")')
      await page.waitForTimeout(200)
      step('주방 수전 예약금 결제', (await page.locator('.card', { hasText: '영수증' }).count()) === 1)
      // 파트너2(낙찰) 내 작업 / 파트너1(미낙찰) 내 작업 + 알림
      await page.goto(url + 'partner')
      await page.waitForTimeout(300)
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      step(
        '파트너2 내 작업: 주방 수전 낙찰 → 계약 동의로 방문 예정 (28-95)',
        (await page
          .locator('.card', { has: page.locator('h3', { hasText: '주방 수전 교체' }) })
          .locator('.chip.st-scheduled')
          .count()) === 1,
      )
      await page.click('.auth-status button:has-text("로그아웃")')
      await page.waitForSelector('.card:has-text("파트너 로그인")')
      await page.fill('input[placeholder="010-0000-0000"]', '010-9999-8888')
      await page.fill('input[type="password"]', 'password1')
      await page.click('.card:has-text("파트너 로그인") button:has-text("로그인")')
      await page.waitForTimeout(200)
      step(
        '파트너1 알림: 미낙찰(파트너별 알림)',
        Number(await page.$eval('.bell-count', (el) => el.textContent.trim()).catch(() => '0')) >= 1,
      )
      await page.click('.tabs button:has-text("내 작업")')
      await page.waitForTimeout(150)
      await page.click('.filter-group button:has-text("종결")')
      await page.waitForTimeout(100)
      step(
        '파트너1 내 작업: 주방 수전 미낙찰(타 파트너 낙찰)',
        (await page
          .locator('.card', { has: page.locator('h3', { hasText: '주방 수전 교체' }) })
          .locator('.chip.st-lost')
          .count()) === 1,
      )
      await page.goto(url + 'admin/')
      await page.waitForTimeout(300)

      // 10.5) 관리자 회원 관리 (28-33): 파트너 정지 → 파트너 로그인 거부
      await page.click('.tabs button:has-text("회원")')
      await page.waitForTimeout(150)
      step('관리자 회원 목록(고객 1·파트너 2 = 3건)', (await page.$$('.member-row')).length === 3)
      await page.click('.member-row:has-text("반듯설비") button:has-text("정지")')
      await page.waitForTimeout(150)
      await page.goto(url + 'partner')
      await page.waitForSelector('.card:has-text("파트너 로그인")')
      await page.fill('input[placeholder="010-0000-0000"]', '010-9999-8888')
      await page.fill('input[type="password"]', 'password1')
      await page.click('.card:has-text("파트너 로그인") button:has-text("로그인")')
      await page.waitForTimeout(200)
      step('정지된 파트너 로그인 거부', (await text()).includes('정지된 계정'))
      await page.goto(url + 'admin')
      await page.waitForTimeout(300)

      // 11) 로그아웃 → 게이트 복귀 (28-30)
      await page.click('.auth-status button:has-text("로그아웃")')
      await page.waitForTimeout(200)
      step('로그아웃 → 로그인 게이트 복귀', (await page.$('.card:has-text("관리자 로그인")')) !== null)

      // 12) 회원 탈퇴·파기 (28-39): 고객 탈퇴(비밀번호 오류 → 거부, 정상 → 게이트 안내) → 관리자 탈퇴 표시 → 파기 → 같은 번호 재가입
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.tabs button:has-text("마이")')
      await page.waitForTimeout(150)
      // 28-60-03: 데이터 주체 열람권 — 본인 거래만 담긴 JSON·CSV
      const myCount = Number(await page.$eval('[data-mydata-count]', (el) => el.getAttribute('data-mydata-count')))
      step(
        '고객 마이: 내 데이터 내보내기 카드',
        myCount > 0 && (await text()).includes('다른 회원의 데이터는 포함되지 않습니다'),
      )
      const [dlMy] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-mydata]')])
      const myJson = await (async () => {
        const st = await dlMy.createReadStream()
        const chunks = []
        for await (const c of st) chunks.push(c)
        return Buffer.concat(chunks).toString('utf8')
      })()
      const myData = JSON.parse(myJson)
      step(
        '내 데이터 JSON: 본인 거래만',
        dlMy.suggestedFilename().startsWith('my-data-') &&
          myData.requests.length === myCount &&
          myData.requests.every((r) => r.customerId === myData.customerId),
      )
      step(
        '내 데이터 JSON: 다른 고객 데이터 없음',
        !myJson.includes('둘째설비') && myData.chats.every((m) => myData.requests.some((r) => r.id === m.requestId)),
      )
      const [dlMyCsv] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-mydata-csv]')])
      const myCsv = await (async () => {
        const st = await dlMyCsv.createReadStream()
        const chunks = []
        for await (const c of st) chunks.push(c)
        return Buffer.concat(chunks).toString('utf8')
      })()
      step(
        '내 거래 CSV: 헤더 + 행 수 일치',
        myCsv.startsWith('\uFEFF요청,등록일,분야,지역,상태,견적,결제액') &&
          myCsv.trim().split('\r\n').length === myCount + 1 &&
          dlMyCsv.suggestedFilename().startsWith('my-transactions-'),
      )
      // 28-42-03 + 28-40: 진행 중 거래(주방 수전 낙찰)가 있으면 탈퇴 차단 → 고객이 요청 취소 → 탈퇴 가능
      await page.fill('input[aria-label="탈퇴 비밀번호"]', 'newpass123')
      await page.check('input[aria-label="탈퇴 안내 확인"]')
      await page.click('button:has-text("회원 탈퇴")')
      await page.waitForTimeout(150)
      step('탈퇴: 진행 중 거래 있음 → 차단', (await text()).includes('진행 중인 거래'))
      await page.click('.tabs button:has-text("홈")')
      await page.waitForTimeout(150)
      await page.click('.card:has-text("주방 수전 교체") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(150)
      await page.click('button:has-text("요청 취소")')
      await page.click('button:has-text("취소 확정")')
      await page.waitForTimeout(150)
      step('고객 요청 취소 → 취소 상태', (await page.$('.chip.st-cancelled')) !== null)
      // 28-45: 예약금 결제 건 취소 → 환불 대기 → 관리자 환불 완료 → 고객 환불 완료 표시
      step('취소 → 예약금 환불 대기 표시', (await page.$('[data-refund-status="pending"]')) !== null)
      await page.goto(url + 'admin')
      await page.waitForSelector('.card:has-text("관리자 로그인")')
      await page.fill('input[placeholder="admin"]', 'admin')
      await page.fill('input[type="password"]', 'bandut1234!')
      await page.click('.card:has-text("관리자 로그인") button:has-text("로그인")')
      await page.waitForTimeout(200)
      step(
        '관리자 현황 조치 필요: 환불 대기 1건',
        (await page.locator('.ops-card [data-ops="refund"] .list-row').count()) === 1,
      )
      await page.click('.ops-card [data-ops="refund"] button:has-text("환불 완료")')
      await page.waitForTimeout(150)
      step(
        '관리자 환불 완료 → 환불 대기 0건',
        (await page.$('.ops-card [data-ops="refund"]')) === null && (await text()).includes('환불 완료 —'),
      )
      step('운영 기록: 환불 완료 최신 행', (await page.locator('.audit-row').first().innerText()).includes('환불 완료'))
      await page.click('.auth-status button:has-text("로그아웃")')
      await page.waitForTimeout(150)
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.click('.card:has-text("주방 수전 교체") button:has-text("거래 상세 보기")')
      await page.waitForTimeout(150)
      step('고객 거래 상세: 예약금 환불 완료', (await page.$('[data-refund-status="done"]')) !== null)
      await page.click('.tabs button:has-text("마이")')
      await page.waitForTimeout(150)
      await page.fill('input[aria-label="탈퇴 비밀번호"]', 'wrong-password')
      await page.check('input[aria-label="탈퇴 안내 확인"]')
      await page.click('button:has-text("회원 탈퇴")')
      await page.waitForTimeout(150)
      step('탈퇴: 비밀번호 오류 → 거부', (await text()).includes('비밀번호가 일치하지'))
      await page.fill('input[aria-label="탈퇴 비밀번호"]', 'newpass123')
      await page.click('button:has-text("회원 탈퇴")')
      await page.waitForTimeout(200)
      step(
        '탈퇴 완료 → 로그인 게이트 + 안내',
        (await page.$('[data-gate-notice]')) !== null && (await text()).includes('탈퇴가 완료'),
      )
      await page.fill('input[placeholder="010-0000-0000"]', '010-1234-5678')
      await page.fill('input[type="password"]', 'newpass123')
      await page.click('.card:has-text("고객 로그인") button:has-text("로그인")')
      await page.waitForTimeout(150)
      step('탈퇴 계정 로그인 거부', (await text()).includes('일치하지 않습니다'))
      await page.goto(url + 'admin')
      await page.waitForSelector('.card:has-text("관리자 로그인")')
      await page.fill('input[placeholder="admin"]', 'admin')
      await page.fill('input[type="password"]', 'bandut1234!')
      await page.click('.card:has-text("관리자 로그인") button:has-text("로그인")')
      await page.waitForTimeout(200)
      await page.click('.tabs button:has-text("회원")')
      await page.waitForTimeout(150)
      // 28-62-02: 낙찰 전 입찰 철회가 파트너 행에 남는다 (탈퇴 필터를 걸기 전에 확인)
      const bwEl = await page.$('[data-member-bid-withdrawals]')
      step(
        '관리자 회원: 입찰 철회 횟수 표기',
        bwEl !== null &&
          Number(await bwEl.getAttribute('data-member-bid-withdrawals')) >= 1 &&
          (await bwEl.textContent()).includes('입찰 철회'),
      )
      await page.click('.filter-group button:has-text("탈퇴")')
      await page.waitForTimeout(100)
      const wdRow = page.locator('.member-row', { hasText: '탈퇴 회원' })
      step(
        '관리자 회원 탭: 탈퇴 회원 1건(식별 정보 파기됨)',
        (await wdRow.count()) === 1 && (await wdRow.innerText()).includes('파기됨'),
      )
      await wdRow.locator('button:has-text("파기")').click()
      await page.waitForTimeout(150)
      step(
        '탈퇴 기록 파기 → 목록에서 제거',
        (await page.locator('.member-row', { hasText: '탈퇴 회원' }).count()) === 0,
      )
      await page.goto(url)
      await page.waitForTimeout(300)
      if (await page.$('.landing')) await page.click('[data-browse]')
      await page.waitForSelector('.card:has-text("고객 로그인")')
      await page.click('button:has-text("처음이신가요? 회원가입")')
      await page.fill('input[placeholder="예: 김반듯"]', '정지훈')
      await page.fill('input[placeholder="010-0000-0000"]', '010-1234-5678')
      await page.fill('input[type="password"]', 'password1')
      await page.check('input[aria-label="전체 동의"]')
      await page.click('button:has-text("가입하고 인증번호 받기")')
      await page.waitForTimeout(150)
      step('같은 휴대폰으로 재가입 허용(OTP 발급)', (await page.$('.otp-code')) !== null)

      // 28-49-01: 저장 실패 가시화 — localStorage를 가득 채워 다음 저장을 실패시키고 배너 확인, 정리 후 해제
      await page.evaluate(() => {
        const fill = (chunk) => {
          const big = 'x'.repeat(chunk)
          for (let i = 0; i < 4096; i++) {
            try {
              localStorage.setItem(`__junk${chunk}_${i}`, big)
            } catch {
              return
            }
          }
        }
        fill(256 * 1024)
        fill(16 * 1024)
        fill(1024)
      })
      await goApp(page, '#/admin')
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(150)
      // 같은 키를 같은 크기로 덮어쓰면 통과할 수 있으므로 공지 문구를 8KB 늘려 스냅샷을 키운다
      await page.fill('input[placeholder="예: 추석 연휴 기간 방문 일정 안내"]', '공지 '.repeat(2000))
      await page.click('button:has-text("문구 저장")')
      await page.waitForTimeout(200)
      step(
        '저장 실패 배너(용량 초과) 표시',
        (await page.$('[data-save-error]')) !== null && (await text()).includes('저장 공간이 부족'),
      )
      await page.evaluate(() => {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('__junk'))
          .forEach((k) => localStorage.removeItem(k))
      })
      await page.click('button:has-text("문구 저장")')
      await page.waitForTimeout(200)
      step('정리 후 저장 성공 → 배너 해제', (await page.$('[data-save-error]')) === null)
      // 28-90: 복원 대조용 설정값은 공지 배너다(보증 일수는 A/S 와 함께 없앴다)
      await page.fill('input[placeholder="예: 추석 연휴 기간 방문 일정 안내"]', '공지 60')
      await page.click('button:has-text("문구 저장")')
      await page.waitForTimeout(150)
      step('관리자 공지 배너 저장', (await text()).includes('홈페이지 문구를 저장했습니다'))
      // 28-54-01: 알림을 전부 읽음·40일 전으로 조정 → 현황 진입 sweep이 정리 → 알림 0건
      const notifBefore = await page.evaluate(
        () => JSON.parse(localStorage.getItem('banded-platform-v1')).notifications.length,
      )
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('banded-platform-v1'))
        const old = new Date(Date.now() - 40 * 86400000).toISOString()
        s.notifications = s.notifications.map((n) => ({ ...n, read: true, createdAt: old }))
        localStorage.setItem('banded-platform-v1', JSON.stringify(s))
      })
      await page.goto(url + 'admin')
      await page.waitForTimeout(300)
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(200)
      step(
        `알림 보관 정책: 읽은 알림 40일 경과 ${notifBefore}건 → sweep 후 0건`,
        notifBefore > 0 &&
          /알림 0건/.test((await page.locator('[data-storage-breakdown]').innerText()).replace(/\s+/g, ' ')),
      )

      // 28-55: 다중 탭 동기화 — 같은 컨텍스트의 두 번째 탭(저장소 공유)
      const tab2 = await page.context().newPage()
      await tab2.setViewportSize({ width: 1280, height: 1000 })
      await tab2.goto(url)
      await tab2.waitForSelector('.landing')
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(150)
      await page.fill('input[placeholder="예: 추석 연휴 기간 방문 일정 안내"]', '탭 동기화 공지 테스트')
      await page.click('button:has-text("문구 저장")')
      await tab2.waitForTimeout(600)
      step(
        '다른 탭 저장 → 랜딩 공지 배너 즉시 반영(새로고침 없음)',
        (await tab2.locator('body').innerText()).includes('탭 동기화 공지 테스트') &&
          (await tab2.$('[data-sync-notice]')) !== null,
      )
      await tab2.goto(url + 'admin')
      await tab2.waitForTimeout(400)
      step('두 번째 탭 관리자 세션 공유', (await tab2.locator('body').innerText()).includes('관리자님'))
      await page.click('.auth-status button:has-text("로그아웃")')
      await tab2.waitForTimeout(600)
      step('다른 탭 로그아웃 → 이 탭도 게이트', (await tab2.$('.card:has-text("관리자 로그인")')) !== null)
      await tab2.close()
      // 뒤따르는 세션 만료 단계의 전제(관리자 로그인 상태) 복원
      await page.waitForSelector('.card:has-text("관리자 로그인")')
      await page.fill('input[placeholder="admin"]', 'admin')
      await page.fill('input[type="password"]', 'bandut1234!')
      await page.click('.card:has-text("관리자 로그인") button:has-text("로그인")')
      await page.waitForTimeout(250)
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(150)

      // 28-58-01/02: 관리자 전용 데이터 백업 — 내보내기 + 확인 문구 전 복원 잠금
      step(
        '관리자 설정: 데이터 백업 카드',
        (await page.$('[data-export-backup]')) !== null &&
          (await text()).includes('운영 기록(감사 로그)은 복원되지 않고'),
      )
      step(
        '확인 문구 전에는 복원 파일 선택 비활성',
        await page.$eval('[data-import-backup] input[type=file]', (el) => el.disabled),
      )
      // 28-60-01: 기본은 가명본 — 내려받은 파일에 고객 이름·요청 내용이 없다
      step(
        '백업 기본 모드: 가명본',
        (await page.$eval('[data-backup-mode="pseudonymous"]', (el) => el.className)).includes('active') &&
          (await page.locator('[data-backup-mode-note]').innerText()).includes('가명'),
      )
      const [dlP] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-backup]')])
      const pseudoText = await (async () => {
        const st = await dlP.createReadStream()
        const chunks = []
        for await (const c of st) chunks.push(c)
        return Buffer.concat(chunks).toString('utf8')
      })()
      const pseudo = JSON.parse(pseudoText)
      step(
        '가명본 파일: 고객 이름·채팅 없음',
        dlP.suggestedFilename().includes('pseudonymous') &&
          !pseudoText.includes('정지훈') &&
          pseudo.pseudonymous === true &&
          pseudo.chats.length === 0,
      )
      // '욕실 실리콘 재시공'은 기본 패키지 이름과 같은 문자열이라 원문 대조가 아니라 필드로 확인한다
      step(
        '가명본 파일: 요청 내용·사진·답변 제거',
        pseudo.store.requests.every(
          (r) => r.description.startsWith('[가명 처리]') && r.photos === undefined && r.answers === undefined,
        ) && pseudo.notifications.every((n) => n.text === '[가명 처리]'),
      )
      // 28-61-02: 허용 목록 — 감사 로그 상세·파트너 상호·customerId까지 사라진다
      const pseudoPath = `/tmp/e2e-${dlP.suggestedFilename()}`
      await dlP.saveAs(pseudoPath)
      step(
        '가명본: 감사 로그 상세·행위자 제거',
        pseudo.auditLog.length > 0 &&
          pseudo.auditLog.every((e) => e.detail === undefined && e.by === undefined && e.target === undefined) &&
          pseudo.auditLog.some((e) => e.action === '지급 완료'),
      )
      step(
        '가명본: 파트너 상호·소개 가명화',
        (pseudo.profiles ?? []).every(([, p]) => p.name.startsWith('파트너 ') && p.intro === '') &&
          !pseudoText.includes('반듯설비'),
      )
      step(
        '가명본: customerId도 가명 키',
        pseudo.store.requests.every((r) => r.customerId === undefined || r.customerId.startsWith('고객 ')),
      )
      // 28-62-01: 통째로 통과하던 컬렉션의 자유 서술도 사라진다
      step(
        '가명본: 견적 메모·환불/철회 사유 제거',
        (pseudo.estimates ?? []).every(([, b]) => b.estimate.memo === undefined) &&
          (pseudo.refunds ?? []).every((r) => r.reason === undefined) &&
          (pseudo.partnerCancels ?? []).every((c) => c.reason === undefined),
      )
      step(
        '가명본: 설정 자유 서술 제거(운영 지표만)',
        pseudo.settings !== undefined &&
          pseudo.settings.notice === undefined &&
          pseudo.settings.terms === undefined &&
          pseudo.settings.disabledCategories !== undefined,
      )
      // 28-62-03: 토글 그룹이 선택 상태를 알린다
      step(
        '백업 모드 토글: role=group + aria-pressed',
        (await page.$eval('[data-backup-mode="pseudonymous"]', (el) =>
          el.closest('[role="group"]')?.getAttribute('aria-label'),
        )) === '백업 모드' &&
          (await page.$eval('[data-backup-mode="pseudonymous"]', (el) => el.getAttribute('aria-pressed'))) === 'true' &&
          (await page.$eval('[data-backup-mode="full"]', (el) => el.getAttribute('aria-pressed'))) === 'false',
      )
      step(
        '가명본에도 운영 지표는 남는다',
        JSON.parse(pseudoText).store.requests.length > 0 &&
          JSON.parse(pseudoText).store.requests[0].customerName.startsWith('고객 '),
      )
      await page.click('[data-backup-mode="full"]')
      await page.waitForTimeout(120)
      const [dlB] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-backup]')])
      step('백업 내보내기 파일명 banded-backup-', dlB.suggestedFilename().startsWith('banded-backup-'))
      // 28-59-01: 반출은 운영 기록에 남는다
      const backupPath = `/tmp/e2e-${dlB.suggestedFilename()}`
      await dlB.saveAs(backupPath)
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(200)
      const exportRow = (await page.locator('.audit-row').first().innerText()).replace(/\s+/g, ' ')
      step(
        '운영 기록: 백업 내보내기(원본) + 행위자 표시',
        exportRow.includes('백업 내보내기') && exportRow.includes('원본') && (await page.$('[data-audit-by]')) !== null,
      )
      step(
        '운영 기록 행위자 = 로그인한 관리자 계정',
        (await page.$eval('[data-audit-by]', (el) => el.textContent.trim())).length > 0,
      )
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(150)
      await page.fill('input[aria-label="복원 확인"]', '복원')
      await page.waitForTimeout(120)
      step(
        '확인 문구 입력 → 복원 파일 선택 활성',
        (await page.$eval('[data-import-backup] input[type=file]', (el) => el.disabled)) === false,
      )
      // 28-59-03: 복원 → 직전 상태 파일 자동 저장 + 되돌리기
      step('복원 전에는 되돌리기 버튼 없음', (await page.$('[data-undo-restore]')) === null)
      await page.fill('input[placeholder="예: 추석 연휴 기간 방문 일정 안내"]', '공지 45')
      await page.click('button:has-text("문구 저장")')
      await page.waitForTimeout(150)
      // 28-61-01: 가명본을 올리면 거부되고 상태가 바뀌지 않는다(직전 상태 백업도 만들지 않는다)
      await page.setInputFiles('[data-import-backup] input[type=file]', pseudoPath)
      await page.waitForTimeout(400)
      step(
        '가명본 복원 거부',
        (await page.locator('[data-backup-error]').innerText()).includes('가명 처리된 백업은 복원할 수 없습니다'),
      )
      const noticeValue = () => page.$eval('input[placeholder="예: 추석 연휴 기간 방문 일정 안내"]', (el) => el.value)
      step(
        '가명본 거부 후 상태 불변(공지 45 유지)',
        (await noticeValue()) === '공지 45' && (await page.$('[data-undo-restore]')) === null,
      )
      const [dlPrev] = await Promise.all([
        page.waitForEvent('download'),
        page.setInputFiles('[data-import-backup] input[type=file]', backupPath),
      ])
      await page.waitForTimeout(400)
      step('복원 직전 상태 자동 내려받기', dlPrev.suggestedFilename().startsWith('banded-before-restore-'))
      step(
        '복원 완료 안내 + 되돌리기 버튼',
        (await page.locator('[data-backup-msg]').innerText()).includes('운영 기록') &&
          (await page.$('[data-undo-restore]')) !== null,
      )
      step('복원으로 공지 되돌아감(45 아님)', (await noticeValue()) !== '공지 45')
      await page.click('[data-undo-restore]')
      await page.waitForTimeout(300)
      step(
        '되돌리기 → 직전 상태(공지 45) 복귀 + 버튼 사라짐',
        (await noticeValue()) === '공지 45' && (await page.$('[data-undo-restore]')) === null,
      )
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(200)
      const undoLog = await page.locator('[data-audit-log]').innerText()
      step(
        '운영 기록: 복원 되돌리기 + 백업 복원 보존',
        undoLog.includes('복원 되돌리기') && undoLog.includes('백업 복원'),
      )
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(150)

      // 28-58-03: 로그인 실패 5회 → 잠금이 감사 로그에 남는다(대상은 마스킹, 관리자 세션은 유지)
      for (let i = 0; i < 5; i += 1) {
        await page.goto(url)
        await page.waitForTimeout(250)
        if (await page.$('.landing')) await page.click('[data-browse]')
        await page.waitForSelector('.card:has-text("고객 로그인")')
        await page.fill('input[placeholder="010-0000-0000"]', '010-0000-0001')
        await page.fill('input[type="password"]', 'wrong-password')
        await page.click('.card:has-text("고객 로그인") button:has-text("로그인")')
        await page.waitForTimeout(120)
      }
      step(
        '로그인 5회 실패 → 잠금 안내',
        (await text()).includes('잠겼습니다') || (await text()).includes('잠겨 있습니다'),
      )
      await page.goto(url + 'admin')
      await page.waitForTimeout(300)
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(200)
      const auditAll = await page.locator('[data-audit-log]').innerText()
      step(
        '운영 기록: 로그인 실패·잠금 기록 + 대상 마스킹',
        auditAll.includes('로그인 잠금') &&
          auditAll.includes('010****0001') &&
          !auditAll.includes('01000000001') &&
          !auditAll.includes('wrong-password'),
      )
      // 28-58-04: 주체 필터·검색·더 보기
      await page.click('[data-audit-filter="system"]')
      await page.waitForTimeout(120)
      const sysRows = await page.$$('.audit-row')
      const sysOnly = await page.$$('.audit-row[data-audit-actor="system"]')
      step('운영 기록 주체 필터: 시스템만', sysRows.length > 0 && sysRows.length === sysOnly.length)
      step(
        '운영 기록 토글: 선택 상태 aria-pressed',
        (await page.$eval('[data-audit-filter="system"]', (el) => el.getAttribute('aria-pressed'))) === 'true' &&
          (await page.$eval('[data-audit-filter="all"]', (el) => el.getAttribute('aria-pressed'))) === 'false' &&
          (await page.$eval('[data-audit-filter="all"]', (el) =>
            el.closest('[role="group"]')?.getAttribute('aria-label'),
          )) === '운영 기록 주체 필터',
      )
      // 28-59-02: 연속 실패 4건이 한 줄(×4)로 접힌다 — 무차별 시도가 로그를 밀어내지 못한다
      const failRows = await page.$$eval('.audit-row', (els) =>
        els
          .map((el) => el.innerText.replace(/\s+/g, ' '))
          .filter((t) => t.includes('로그인 실패') && t.includes('010****0001')),
      )
      step('로그인 실패 4회가 한 줄 ×4로 접힘', failRows.length === 1 && /×\s*4/.test(failRows[0]))
      step('접힌 기록에 첫 시각~마지막 시각 표기', /\d{2}:\d{2} ~ \d{2}:\d{2}/.test(failRows[0]))
      await page.fill('input[aria-label="기록 검색"]', '로그인 잠금')
      await page.waitForTimeout(120)
      const lockRows = await page.$$eval('.audit-row', (els) => els.map((el) => el.textContent))
      step(
        '운영 기록 검색 "로그인 잠금" → 잠금 행만',
        lockRows.length > 0 && lockRows.every((t) => t.includes('로그인 잠금')),
      )
      await page.fill('input[aria-label="기록 검색"]', '없는행위')
      await page.waitForTimeout(120)
      step(
        '운영 기록 검색 결과 없음 안내',
        (await page.$$('.audit-row')).length === 0 &&
          (await page.locator('[data-audit-log]').innerText()).includes('조건에 맞는 기록이 없습니다'),
      )
      await page.fill('input[aria-label="기록 검색"]', '')
      await page.click('[data-audit-filter="all"]')
      await page.waitForTimeout(120)
      step(
        '저장 용량 내역: 운영 기록 세그먼트',
        (await page.$('[data-storage-audit]')) !== null &&
          /기록 \d+건/.test((await page.locator('[data-storage-breakdown]').innerText()).replace(/\s+/g, ' ')),
      )

      // 28-51-03: 관리자 세션 만료 시각을 과거로 조정 → 새로고침 → 게이트 + 만료 안내
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('banded-auth-v1'))
        s.sessions = s.sessions.map(([r, se]) =>
          r === 'admin' ? [r, { ...se, expiresAt: '2000-01-01T00:00:00.000Z' }] : [r, se],
        )
        localStorage.setItem('banded-auth-v1', JSON.stringify(s))
      })
      await page.goto(url + 'admin')
      await page.waitForTimeout(300)
      step(
        '만료된 관리자 세션 → 로그인 게이트 + 만료 안내',
        (await page.$('.card:has-text("관리자 로그인")')) !== null && (await text()).includes('세션이 만료'),
      )

      // 28-91: 시연 데이터 카드(28-80~28-82)는 시드와 함께 사라졌다 — 다시 로그인해 28-89-A(등급) 단계로 간다
      await page.fill('input[placeholder="admin"]', 'admin')
      await page.fill('input[type="password"]', 'bandut1234!')
      await page.click('.card:has-text("관리자 로그인") button:has-text("로그인")')
      await page.waitForTimeout(400)
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(250)

      // 28-89-A: 관리자 등급. 소유자가 열람 관리자를 만들고, 그 계정으로 들어가면 관리자 화면이 읽기 전용이다.
      step('소유자 세션 표시(등급 태그)', (await page.$('[data-session-grade="owner"]')) !== null)
      await page.click('.tabs button:has-text("회원")')
      await page.waitForTimeout(250)
      step(
        '회원 탭: 관리자 계정 카드 — 기본 소유자 admin 1행 (28-89-A)',
        (await page.$$('[data-admin-row]')).length === 1 &&
          (await page.$('[data-admin-row="admin"] [data-admin-grade="owner"]')) !== null,
      )
      await page.fill('input[aria-label="새 관리자 아이디"]', 'Viewer1')
      await page.fill('input[aria-label="새 관리자 이름"]', '열람이')
      await page.selectOption('select[aria-label="새 관리자 등급"]', 'viewer')
      await page.fill('input[aria-label="새 관리자 비밀번호"]', 'viewer-pass-1')
      await page.click('[data-admin-add]')
      await page.waitForTimeout(250)
      step(
        '열람 관리자 추가 → 2행 + 소문자 정규화',
        (await page.$$('[data-admin-row]')).length === 2 &&
          (await page.$('[data-admin-row="viewer1"] [data-admin-grade="viewer"]')) !== null,
      )
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(200)
      step(
        '운영 기록에 관리자 추가가 남는다',
        (await page.locator('[data-audit-log]').innerText()).includes('관리자 추가'),
      )
      await page.click('.auth-status button:has-text("로그아웃")')
      await page.waitForTimeout(200)
      await page.fill('input[placeholder="admin"]', 'viewer1')
      await page.fill('input[type="password"]', 'viewer-pass-1')
      await page.click('.card:has-text("관리자 로그인") button:has-text("로그인")')
      await page.waitForTimeout(400)
      step(
        '열람 관리자 로그인 → 이름·등급 태그',
        (await text()).includes('열람이님') && (await page.$('[data-session-grade="viewer"]')) !== null,
      )
      step(
        '열람 등급: 읽기 전용 배너 + 셸 표시 (28-89-A)',
        (await page.$('[data-admin-readonly]')) !== null && (await page.$('[data-admin-grade="viewer"]')) !== null,
      )
      await page.click('.tabs button:has-text("회원")')
      await page.waitForTimeout(250)
      step(
        '열람 등급: 관리자 목록은 보이지만 추가 폼·제거 버튼이 없다',
        (await page.$$('[data-admin-row]')).length === 2 &&
          (await page.$('[data-admin-add]')) === null &&
          (await page.$('[data-admin-remove]')) === null,
      )
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(250)
      step(
        '열람 등급: 배치 저장·되돌리기 비활성 + 등급 안내',
        (await page.$eval('[data-layout-save]', (el) => el.disabled)) &&
          (await page.$eval('[data-layout-reset]', (el) => el.disabled)) &&
          (await page.locator('[data-grade-note]').first().innerText()).includes('매니저 이상'),
      )
      step('열람 등급: 백업 내보내기·되돌리기 비활성', await page.$eval('[data-export-backup]', (el) => el.disabled))

      // #244 리뷰: 첫 판은 CSS `pointer-events: none` 하나로 막았다 — 그것은 **마우스만** 막는다.
      //   Tab 으로 옮겨 Enter/Space 를 누르면 그대로 실행됐고, 로컬 모드에는 막아 줄 서버가 없다.
      //   그래서 여기서는 **키보드로** 눌러 본다.
      const catToggle = 'label.toggle input[aria-label="전기·조명 노출"]'
      const catBefore = await page.$eval(catToggle, (el) => el.checked)
      await page.focus(catToggle)
      await page.keyboard.press('Space')
      await page.waitForTimeout(200)
      const disabledCats = () =>
        page.evaluate(() =>
          (JSON.parse(localStorage.getItem('banded-platform-v1') ?? '{}').settings?.disabledCategories ?? []).join(','),
        )
      const catsAfterKey = await disabledCats()
      // 이 스크립트의 step 은 인자 둘만 쓴다(세 번째를 받지 않는다) — 실패했을 때 볼 값은 로그로 남긴다
      if (catsAfterKey.includes('전기')) console.log(`  ↳ 카테고리가 바뀌었다: disabled=[${catsAfterKey}]`)
      step(
        '열람 등급: 키보드(Space)로도 카테고리 노출이 바뀌지 않는다 (#244 리뷰)',
        (await page.$eval(catToggle, (el) => el.checked)) === catBefore && !catsAfterKey.includes('전기'),
      )
      await page.click('.tabs button:has-text("회원")')
      await page.waitForTimeout(250)
      const suspendedCount = () =>
        page.evaluate(() => (localStorage.getItem('banded-auth-v1') ?? '').split('"suspended":true').length - 1)
      const suspBefore = await suspendedCount()
      const suspendBtn = await page.$('.member-row button:has-text("정지")')
      step('열람 등급 화면에도 정지 버튼은 그려진다 — 눌리지 않을 뿐이다', suspendBtn !== null)
      await suspendBtn.focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(250)
      // 수정 전: 여기서 계정이 실제로 정지됐다(로컬 모드라 서버 403도 없다)
      const suspAfter = await suspendedCount()
      if (suspAfter !== suspBefore) console.log(`  ↳ 정지 계정 수가 ${suspBefore} → ${suspAfter} 로 늘었다`)
      step('열람 등급: 키보드(Enter)로도 계정을 정지시킬 수 없다 (#244 리뷰)', suspAfter === suspBefore)
      // 보기 위한 조작은 그대로 된다 — 막기만 하고 못 쓰게 만들면 열람 등급이 쓸모없다
      await page.keyboard.press('Tab')
      await page.click('.tabs button:has-text("현황")')
      await page.waitForTimeout(200)
      step('열람 등급: 탭 이동·기록 열람은 그대로 된다', (await page.$('[data-audit-log]')) !== null)
      await page.click('.tabs button:has-text("설정")')
      await page.waitForTimeout(200)
      await page.click('.auth-status button:has-text("로그아웃")')
      await page.waitForTimeout(200)
      await page.fill('input[placeholder="admin"]', 'admin')
      await page.fill('input[type="password"]', 'bandut1234!')
      await page.click('.card:has-text("관리자 로그인") button:has-text("로그인")')
      await page.waitForTimeout(400)
      await page.click('.tabs button:has-text("회원")')
      await page.waitForTimeout(250)
      await page.click('[data-admin-row="viewer1"] [data-admin-remove]')
      await page.waitForTimeout(250)
      step('소유자가 열람 관리자 제거 → 1행', (await page.$$('[data-admin-row]')).length === 1)
      await mobile.screenshot({ path: join(OUT, 'e2e-mobile.png'), fullPage: false })
      await mobile.close()
    } finally {
      await browser.close()
    }
  } finally {
    try {
      process.kill(-server.pid)
    } catch {
      server.kill()
    }
  }
  console.log(failures === 0 ? 'E2E-JOURNEY OK' : `E2E-JOURNEY FAIL: ${failures}건`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[e2e]', err)
  process.exit(1)
})
