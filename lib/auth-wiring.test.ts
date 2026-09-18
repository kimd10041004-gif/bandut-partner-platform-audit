import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 로그인이 우리 것인지, 화면이 실제로 있는 파일을 가리키는지 (29-6).
 *
 * ## 왜 이 가드가 생겼나
 *
 * 29-3이 v17 화면을 들여왔다. 서버 인증은 우리 것으로 바꿨지만 **로그인 화면은 v17 것이 그대로
 * 따라 들어왔다** — ChatGPT 로그인 버튼이 `/signin-with-chatgpt`로 보내는데 우리 앱에는 그 경로가
 * 없다. 그래서 새 셸에서는 **아무도 로그인할 수 없었다.** 타입 검사도, 단위 테스트도, e2e 도,
 * 경로 검사도 이것을 잡지 못했다 — 전부 "그 주소가 우리 것인가"를 묻지 않았기 때문이다.
 *
 * 같은 이유로 이미지도 깨져 있었다. v17 파일 이름을 그대로 들여왔는데 우리 `public/`에는 다른
 * 이름으로 들어 있었다. 화면은 200 을 주고 그 안의 이미지만 404 였다.
 *
 * 둘 다 **사람이 눈으로 봐야만 보이는 종류**였다. 그래서 기계에게 맡긴다.
 */

const DIRS = ['components', 'app', 'lib']

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name)
      if (e.isDirectory()) {
        walk(path)
        continue
      }
      if (/\.(ts|tsx|css)$/.test(e.name) && !e.name.endsWith('.test.ts')) out.push(path)
    }
  }
  for (const d of DIRS) walk(d)
  return out.sort()
}

/** 주석은 빼고 본다 — 이 가드를 설명하는 글이 스스로 위반으로 잡히면 안 된다 */
function code(file: string): string {
  return readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const FILES = sourceFiles()
const SOURCE = FILES.map(code).join('\n')

describe('로그인은 우리 것이다 (29-6)', () => {
  it('검사 대상이 실제로 있다 — 목록이 비면 아래 단언은 아무것도 안 본다', () => {
    expect(FILES.length).toBeGreaterThan(20)
  })

  it('ChatGPT 로그인·로그아웃 주소로 보내는 곳이 없다', () => {
    const offenders = FILES.filter((f) => /["']\/sign(in|out)-with-chatgpt/.test(code(f)))
    expect(offenders, '우리 앱에 없는 경로입니다 — /login·/signup 을 쓰세요').toEqual([])
  })

  it('우리 로그인·가입 화면이 라우터에 걸려 있다', () => {
    // 포매터가 공백을 넣을 수 있으므로 공백을 지우고 본다
    const router = code(join('app', '[...slug]', 'page.tsx')).replace(/\s+/g, '')
    for (const path of ['login', 'signup']) expect(router).toContain(`path==='${path}'`)
  })

  it('모든 API 호출이 인증 헤더를 붙인다 — 붙이지 않으면 언제나 로그인되지 않은 요청이다', () => {
    expect(readFileSync(join('lib', 'client.ts'), 'utf-8')).toContain('authHeader()')
  })
})

describe('화면이 가리키는 이미지가 실제로 있다 (29-6)', () => {
  it('src="/..." 로 적힌 파일이 전부 public/ 안에 있다', () => {
    const referenced = [...SOURCE.matchAll(/src="(\/[^"]*\.(?:png|jpg|jpeg|webp|svg))"/g)].map((m) => m[1]!)
    expect(referenced.length, '참조가 하나도 안 잡히면 이 단언은 무의미하다').toBeGreaterThan(0)
    const missing = [...new Set(referenced)].filter((p) => !existsSync(join('public', p)))
    expect(missing, 'public/ 에 없는 파일입니다 — 화면은 200 이어도 이미지가 404 가 됩니다').toEqual([])
  })

  /**
   * 29-7: `src="/…"` 만 보던 그물에 구멍이 있었다.
   *
   * `app/layout.tsx` 의 `metadata.icons` 는 `src=` 가 아니라 문자열이다. 그래서 위 단언이
   * 초록인데도 `/favicon.svg` 가 없어 **모든 화면의 탭 아이콘이 404** 였다. 화면 안을 보는
   * 배포 확인도 `<img src>` 만 세므로 이것을 못 본다 — 아이콘은 `<link rel="icon">` 이다.
   *
   * 그래서 확장자로 잡는다. 따옴표 안에 `/…` 로 적힌 정적 파일이면 `src=` 든 아니든 전부.
   */
  it("따옴표 안의 '/...' 정적 파일이 전부 public/ 안에 있다 — metadata.icons 같은 자리까지", () => {
    const referenced = [...SOURCE.matchAll(/['"](\/[^'"]*\.(?:png|jpg|jpeg|webp|svg|ico|avif))['"]/g)].map((m) => m[1]!)
    expect(referenced.length, '참조가 하나도 안 잡히면 이 단언은 무의미하다').toBeGreaterThan(0)
    const missing = [...new Set(referenced)].filter((p) => !existsSync(join('public', p)))
    expect(missing, 'public/ 에 없는 파일입니다').toEqual([])
  })

  /**
   * 29-9: 탭 아이콘이 화면마다 다르면 같은 사이트로 안 보인다.
   *
   * 공간 스튜디오는 시안에서 통째로 들여온 정적 앱이라 자기 `<link rel="icon">`을 들고 왔다 —
   * 903KB짜리, 글자까지 든 로고 PNG다. 16px 탭에서는 글자가 뭉개지고, 사이트 본체는 전혀 다른
   * 아이콘을 쓰고 있었다. 둘을 하나로 맞췄고, 다시 갈라지지 않게 여기서 본다.
   *
   * 크롤러도 받을 때 같은 자리를 고친다(`fetch-interior-app.yml`). 거기서 안 고치면 다음 실행에
   * 시안 것이 되살아난다 — Cloudflare 주입분에서 실제로 겪은 일이다.
   */
  it('탭 아이콘이 사이트 본체와 공간 스튜디오에서 같다', () => {
    const layout = readFileSync(join('app', 'layout.tsx'), 'utf-8')
    const studio = readFileSync(join('public', 'interior', 'index.html'), 'utf-8')

    // 29-10: icons 가 배열이 됐다(SVG 를 못 읽는 브라우저를 위한 PNG 예비). 첫 번째가 주 아이콘이다.
    const shell = /icons:\s*\{\s*icon:\s*\[\s*\{\s*url:\s*'([^']+)'/.exec(layout)?.[1]
    const interior = /<link rel="icon"[^>]*href="([^"]+)"/.exec(studio)?.[1]

    expect(shell, 'app/layout.tsx 의 metadata.icons 를 못 읽었습니다').toBeDefined()
    expect(interior, '스튜디오의 <link rel="icon"> 을 못 읽었습니다').toBeDefined()
    expect(interior, '탭 아이콘이 갈라졌습니다 — 같은 사이트로 안 보입니다').toBe(shell)
    expect(existsSync(join('public', shell!)), `${shell} 가 public/ 에 없습니다`).toBe(true)
  })
})
