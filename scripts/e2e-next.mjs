/**
 * Next.js 앱 셸 연기 검사 (29-3).
 *
 * 이 라운드는 **셸을 세우기만** 한다 — 라이브는 아직 SPA다. 그래서 여기서 확인할 것은 세 가지뿐이다:
 * 화면이 뜨는가, v17 화면이 맞는가, 그 위에서 **우리 세션 게이트**가 살아 있는가.
 *
 * 브라우저를 쓰지 않는다. 서버가 내려 주는 HTML과 API 응답만 본다 — 화면별 상호작용은 배포를 전환하는
 * 29-4에서 여정으로 다시 쓴다.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PORT = Number(process.env.NEXT_E2E_PORT ?? 3211)
const BASE = `http://127.0.0.1:${PORT}`
let passed = 0
let exitCode = 1
const failures = []

function step(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name + (detail ? ` — ${detail}` : ''))
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * 29-5: **우리가 띄운 서버인지** 먼저 확인한다.
 *
 * 이 포트를 지난 실행의 서버가 아직 잡고 있으면 `next start`는 EADDRINUSE로 죽는데, 그 포트는
 * 여전히 200을 준다 — 그래서 준비 확인은 통과하고, 검사는 **낡은 빌드**를 재고 있게 된다.
 * 실제로 그렇게 CSP 검사가 거짓 실패를 냈다(방금 만든 헤더가 없다고 나왔다). 자식이 먼저 죽으면
 * 기다리지 않고 그 사실을 말한다.
 */
async function waitReady(deadlineMs = 60_000) {
  // 자식이 EADDRINUSE로 죽는 데 한 박자 걸린다. 그 전에 첫 요청을 보내면 **남의 서버**가 200을
  // 주고, 준비 확인이 통과해 버린다 — 그래서 먼저 자리를 잡을 시간을 준 뒤에 묻는다.
  await new Promise((r) => setTimeout(r, 1500))
  const died = () => {
    console.error(
      `[e2e:next] 서버가 먼저 종료됐습니다(code ${serverExited}) — 포트 ${PORT}를 다른 것이 잡고 있는지 확인하세요`,
    )
    return false
  }
  const until = Date.now() + deadlineMs
  while (Date.now() < until) {
    if (serverExited !== null) return died()
    try {
      const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(3000) })
      // 200을 받았어도 그것이 우리 자식인지 한 번 더 본다 (경합 구간)
      if (r.ok) return serverExited === null ? true : died()
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
})
let serverExited = null
server.on('exit', (code) => (serverExited = code ?? -1))
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))

try {
  if (!(await waitReady())) {
    console.error('[e2e:next] 서버가 뜨지 않았습니다\n' + serverLog)
    process.exit(1)
  }

  const home = await fetch(BASE + '/')
  const html = await home.text()
  step('앱 셸이 200을 준다', home.status === 200, `status=${home.status}`)
  step('v17 화면이다 — 문서 제목', html.includes('반듯집수리'), '제목을 찾지 못했다')
  step('한국어 문서로 내려온다', html.includes('lang="ko"'))

  // 29-4: 배포 확인이 라이브 HTML에서 읽을 표기. 이게 없으면 deploy-check를 새 셸 기준으로 못 바꾼다.
  const round = JSON.parse(readFileSync('package.json', 'utf8')).version.split('.').slice(0, 2).join('-')
  step(`라운드 표기가 HTML에 있다 (${round})`, html.includes(`>${round}<`), '표기를 찾지 못했다')
  step(
    '인증 모드 표식이 server 다 — 새 셸에는 로컬 모드가 없다',
    html.includes('bandut-auth-mode:server'),
    '표식을 찾지 못했다',
  )

  // 우리 세션 게이트: 토큰 없이 부르면 도메인에 닿기 전에 막힌다 (29-2에서 만든 자리)
  // 29-5: 정책 문자열 자체는 server/csp.test.ts 가 프레임워크 없이 본다. 여기서는 그 nonce가
  // **실제 인라인 스크립트에 가 닿는지** — 즉 화면이 하이드레이트될 수 있는지 — 를 본다.
  const csp = home.headers.get('content-security-policy') ?? ''
  const headerNonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1] ?? ''
  const bodyNonce = /nonce="([A-Za-z0-9+/=]+)"/.exec(html)?.[1] ?? ''
  step('응답에 콘텐츠 보안 정책이 붙는다', csp !== '', 'CSP 헤더가 없다 — middleware가 안 돌았다')
  step(
    '그 정책의 nonce가 이 응답의 인라인 스크립트와 같다 — 막히지 않는다',
    headerNonce !== '' && headerNonce === bodyNonce,
    `헤더 ${headerNonce || '(없음)'} · 본문 ${bodyNonce || '(없음)'}`,
  )
  step(
    "script-src를 'unsafe-inline'으로 열지 않았다 (28-41의 정책을 약하게 만들지 않는다)",
    !/script-src[^;]*'unsafe-inline'/.test(csp),
    csp,
  )

  // 29-6: 로그인 화면이 **우리 것**인지. 29-3 이식에서 v17 의 ChatGPT 로그인이 그대로 따라 들어와
  // /signin-with-chatgpt 404 로 아무도 로그인할 수 없었다. 화면이 실제로 서는지를 여기서 본다.
  const loginPage = await fetch(BASE + '/login')
  const loginHtml = await loginPage.text()
  step('로그인 화면이 열린다', loginPage.status === 200, `HTTP ${loginPage.status}`)
  step('그 화면에 우리 로그인 폼이 있다', loginHtml.includes('data-login-submit'), '폼을 찾지 못했다')
  step(
    '공개 로그인은 고객·파트너를 고른다',
    ['customer', 'partner'].every((r) => loginHtml.includes(`data-login-role="${r}"`)),
    '역할 선택이 빠졌다',
  )
  // 29-10: 공개 화면에 운영자 문을 내걸지 않는다. 관리자는 /login/admin 한 자리뿐이고
  // 그 주소는 화면 어디에서도 링크하지 않는다 — 아는 사람만 직접 친다.
  step(
    '공개 로그인에 관리자 선택이 없다',
    !loginHtml.includes('data-login-role="admin"'),
    '공개 화면이 관리자 역할을 내걸고 있다',
  )
  const adminLogin = await fetch(BASE + '/login/admin')
  const adminHtml = await adminLogin.text()
  step(
    '/login/admin 은 직접 치면 열린다',
    adminLogin.status === 200 && adminHtml.includes('data-login-submit'),
    `HTTP ${adminLogin.status}`,
  )
  step('관리자 화면이라고 말한다', adminHtml.includes('관리자 로그인'), '제목이 다르다')
  // 29-12: 역할이 주소에 남는다(명세 2절). 서버가 role 을 읽어 초기값으로 쓰는지 본다.
  const partnerByQuery = await (await fetch(BASE + '/login?role=partner')).text()
  step(
    '/login?role=partner 는 파트너를 고른 채로 연다',
    /data-login-role="partner"[^>]*checked|checked[^>]*data-login-role="partner"/.test(partnerByQuery),
    '파트너가 선택돼 있지 않다',
  )
  const badRole = await fetch(BASE + '/login?role=관리자아님')
  step(
    '알 수 없는 역할 값은 고객으로 본다 — 화면이 비거나 404 가 되지 않는다',
    badRole.status === 200,
    `HTTP ${badRole.status}`,
  )
  const loginCustomer = await fetch(BASE + '/login/customer')
  step('/login/customer 가 열린다', loginCustomer.status === 200, `HTTP ${loginCustomer.status}`)
  const signupByQuery = await (await fetch(BASE + '/signup?role=partner')).text()
  step(
    '/signup?role=partner 는 파트너 가입으로 연다',
    /data-signup-role="partner"[^>]*checked|checked[^>]*data-signup-role="partner"/.test(signupByQuery),
    '파트너가 선택돼 있지 않다',
  )

  // 29-12: 비밀번호 찾기
  const resetPage = await fetch(BASE + '/password/reset')
  const resetHtml = await resetPage.text()
  step('비밀번호 찾기 화면이 열린다', resetPage.status === 200, `HTTP ${resetPage.status}`)
  step('휴대폰 번호로 시작한다', resetHtml.includes('data-reset-phone'), '입력칸을 찾지 못했다')
  step('로그인 화면이 비밀번호 찾기로 보낸다', loginHtml.includes('data-reset-link'), '링크가 없다')

  const signupPage = await fetch(BASE + '/signup')
  const signupHtml = await signupPage.text()
  step('가입 화면이 열린다', signupPage.status === 200, `HTTP ${signupPage.status}`)
  step('가입 코드 칸이 없다 (29-21)', !signupHtml.includes('data-signup-code'), '가입 코드 칸이 아직 있다')
  step(
    'ChatGPT 로그인으로 보내지 않는다',
    !loginHtml.includes('signin-with-chatgpt') && !signupHtml.includes('signin-with-chatgpt'),
    '우리 앱에 없는 경로다',
  )

  // 29-13: 업체 찾기. 로그인 없이 열려야 한다 — 명세 4절
  const finder = await fetch(BASE + '/companies')
  const finderHtml = await finder.text()
  step('업체 찾기 화면이 열린다', finder.status === 200, `HTTP ${finder.status}`)
  step(
    '지역과 분야로 좁힐 수 있다',
    finderHtml.includes('data-company-region') && finderHtml.includes('data-company-work'),
  )
  const companiesApi = await fetch(BASE + '/api/companies')
  step(
    '업체 목록 API 가 로그인 없이 200 이다 — 둘러보는 사람에게 문을 닫지 않는다',
    companiesApi.status === 200,
    `HTTP ${companiesApi.status}`,
  )
  const companiesBody = await companiesApi.json()
  step('그 응답은 업체 배열이다', Array.isArray(companiesBody?.companies), JSON.stringify(companiesBody).slice(0, 120))

  // 29-14: 공개 Q&A. 읽는 것은 로그인 없이 — 명세 7절
  const qna = await fetch(BASE + '/api/company/none/questions')
  step('업체 질문 목록이 로그인 없이 200 이다', qna.status === 200, `HTTP ${qna.status}`)
  step('그 응답은 배열이다 — 없는 업체면 빈 배열', Array.isArray(await qna.json()))
  const askAnon = await fetch(BASE + '/api/company/none/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ body: '로그인 없이 질문해 봅니다', caseId: null }),
  })
  step('로그인 없이는 질문을 남길 수 없다 — 401', askAnon.status === 401, `HTTP ${askAnon.status}`)

  // 29-15: 업체 페이지 편집기. 공개본은 로그인 없이, 편집은 로그인해야 한다
  const publicPage = await fetch(BASE + '/api/company/none/page')
  step('공개본이 로그인 없이 200 이다', publicPage.status === 200, `HTTP ${publicPage.status}`)
  const publicPageBody = await publicPage.json()
  step(
    '공개한 적이 없으면 published=false 로 분명히 말한다',
    publicPageBody?.published === false,
    JSON.stringify(publicPageBody).slice(0, 120),
  )
  const draftAnon = await fetch(BASE + '/api/page')
  step('편집본은 로그인 없이 볼 수 없다 — 401', draftAnon.status === 401, `HTTP ${draftAnon.status}`)
  const editorPage = await fetch(BASE + '/partner/company/editor')
  step('편집기 화면이 열린다', editorPage.status === 200, `HTTP ${editorPage.status}`)

  // 29-16: 거래 전 상담. 대화는 참여자만 — 로그인 없이 열리지 않는다
  const consultList = await fetch(BASE + '/api/consultations')
  step('상담 목록은 로그인 없이 볼 수 없다 — 401', consultList.status === 401, `HTTP ${consultList.status}`)
  const consultOpen = await fetch(BASE + '/api/company/none/consult', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ caseId: null }),
  })
  step('로그인 없이는 상담을 열 수 없다 — 401', consultOpen.status === 401, `HTTP ${consultOpen.status}`)
  const consultPage = await fetch(BASE + '/consult')
  step('상담 목록 화면이 열린다', consultPage.status === 200, `HTTP ${consultPage.status}`)

  const me = await fetch(BASE + '/api/me')
  const meBody = await me.json()
  step('로그인 없이는 마켓플레이스 API가 401', me.status === 401, `status=${me.status}`)
  step('그 401은 우리 문구다', meBody?.error === '로그인이 필요합니다.', JSON.stringify(meBody))

  // 우리 로그인 경로가 catch-all에 먹히지 않는다 (정적 세그먼트가 이긴다)
  const auth = await fetch(BASE + '/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  step('/api/auth 가 마켓플레이스 catch-all에 먹히지 않는다', auth.status !== 404, `status=${auth.status}`)
  const authBody = await auth.json()
  step(
    '그 응답은 우리 auth 핸들러가 준 것이다',
    typeof authBody?.error === 'string' && authBody.error !== '지원하지 않는 요청입니다.',
    JSON.stringify(authBody),
  )

  // 29-30: 사진 경로는 이제 실제 라우트다. 로그인 없이(가짜 토큰) 부르면 401 — 저장소 유무보다 신원이 먼저다
  const photo = await fetch(BASE + '/api/photos/x', { headers: { authorization: 'Bearer none' } })
  step('사진 경로는 로그인 없이 401 로 분명히 답한다', photo.status === 401, `status=${photo.status}`)

  console.log(`\n[e2e:next] ${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.log(' - ' + f)
  if (failures.length > 0) console.error('\n--- 서버 로그 ---\n' + serverLog.slice(-2000))
  exitCode = failures.length > 0 ? 1 : 0
} catch (e) {
  console.error('[e2e:next] 실행 중 오류:', e)
  console.error('\n--- 서버 로그 ---\n' + serverLog.slice(-2000))
  exitCode = 1
} finally {
  // next start는 자식(next-server)을 따로 띄운다 — 부모만 죽이면 그 자식이 stdout 파이프를 잡고 있어
  // 이벤트 루프가 안 끝난다. 그래서 프로세스 그룹을 정리하고 명시적으로 나간다.
  server.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  process.exit(exitCode)
}
