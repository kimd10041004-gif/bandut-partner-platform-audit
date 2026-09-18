import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * **서버 코드의 모듈 전역 상태는 인스턴스마다 따로다** (28-88-05).
 *
 * ## 왜 이 가드가 생겼나
 *
 * `server/db.ts`는 이 사실을 처음부터 알고 적어 두었다 — "라우트마다 별도 함수로 묶인다". `server/rateLimit.ts`도 28-70-03c에서 정확히 적었다 — "서버리스 인스턴스마다
 * 따로 세므로 분산 공격은 못 막는다".
 *
 * **그런데 28-87이 그것을 잊었다.** 두 군데서:
 *   - 공개 경로의 동시성 상한을 "풀 `max: 3`을 `/api/snapshot`·`/api/auth`와 나눠 쓰니까"로
 *     정당화했다 — 함수가 따로라 나눠 쓰는 풀이 없다 (28-87 감사 01).
 *   - TTL이 만든 낡은 값을 스냅샷 핸들러가 캐시를 지워 막게 했다 — 다른 함수의 캐시라
 *     읽는 쪽에 닿지 않는다 (28-87 감사 02).
 *
 * 한 번 알았다가 잊는 것은 사람이 지키는 규칙의 성질이다. 그래서 **기계에게 맡긴다.**
 *
 * ## 이 가드가 하는 일과 **하지 않는 일**
 *
 * - *한다* — `server/`(핸들러 포함)의 **모듈 스코프 가변 상태**를 유도로 전부 찾고, 그 각각의 바로 위
 *   문서/주석에 **인스턴스 경계를 언급한 문장이 있는지** 본다.
 * - *하지 않는다* — 그 문장이 **참인지**는 검사하지 못한다. 주석은 코드가 아니다.
 *   이 가드가 막는 것은 "생각하지 않고 지나가는 것"이지 "틀리게 생각하는 것"이 아니다.
 *   **이 한계를 좁게 적지 않는다** — 28-86 감사 01이 그 실수를 지적했다.
 *
 * 그래도 값이 있다 — 다만 **정확히 하나에 대해서다** (28-89 정정, 28-88 감사 03). 28-87 감사 02
 * (다른 함수의 캐시를 지우려 한 것)는 `memo` 위에 "인스턴스마다 따로다"를 적는 순간 눈에 보였을
 * 것이다. 그러나 28-87 감사 01(풀 공유 오해)은 **멈추지 않았을 것이다** — `getPool` 위 주석에는
 * 28-87 이전부터 "서버리스에서 호출 간에 재사용된다"가 있었고, 그 단어 하나로 `MENTIONS`를
 * 통과한다. 28-88은 "둘 다 멈췄을 것"이라고 적었다 — 바로 위에 적은 한계 밖의 값을 주장한 것이다.
 *
 * ## 변형은 저장소 전체에서 찾는다 (28-89, 28-88 감사 03)
 *
 * `export const cache = new Map()`을 `a.ts`가 선언하고 `b.ts`가 `cache.set(...)`하면, `a.ts`만 보는
 * 유도는 "읽기 전용 표"로 판단해 건너뛴다. `export`의 뜻이 "다른 파일이 쓴다"인데 #243이 `export`를
 * 넓힌 자리에서 거짓 음성이 생겼다. 그래서 변형 여부는 `server/` **전체 소스**에서 찾는다.
 */

const DIRS = ['server']

/** 인스턴스 경계를 **언급했다**고 인정하는 표현들 (뜻이 아니라 언급 여부만 본다) */
const MENTIONS = ['인스턴스마다', '인스턴스별', '프로세스마다', '프로세스 메모리', '함수마다', '서버리스']

function sourceFiles(): string[] {
  const out: string[] = []
  // 29-5: 옛 `api/`가 `server/handlers/`로 들어오면서 대상이 한 겹 깊어졌다. 평평하게 읽던
  // 판을 그대로 두면 핸들러가 조용히 검사 밖으로 나간다 — 가드가 스스로 빠지는 그 모양이라
  // 하위 폴더까지 내려간다.
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue
      out.push(path)
    }
  }
  for (const dir of DIRS) walk(dir)
  return out.sort()
}

/**
 * 모듈 스코프의 **가변** 상태를 찾는다.
 *
 * - `let`/`var`로 선언한 것 — 값이 바뀔 수 있다. **`export` 접두사가 붙어도 같다**
 *   (#241 리뷰: 처음 판은 `^const`·`^let`만 봐서 `export const cache = new Map()`이 조용히 빠졌다 —
 *   가드가 스스로 빠지는 그 모양이다).
 * - `const`라도 `new Map`·`new Set`·배열 리터럴 중 **실제로 변형되는 것** — 참조는 고정이지만
 *   내용이 바뀐다. 변형은 그 이름에 대한 `.set(`·`.delete(`·`.clear(`·`.add(`·`.push(`·`.shift(`·
 *   `.pop(`·`.splice(` 호출로 유도한다.
 *
 * 원시값 `const`(`const MAX = 20`)는 대상이 아니다. 인스턴스마다 따로여도 같은 값이다.
 * **변형되지 않는 `Set`도 대상이 아니다** — `server/handlers/auth.ts`의 `PUBLIC_OPS`처럼 읽기 전용 표는
 * 사실상 상수다. 거짓 경보는 가드를 죽인다(28-85 감사 03이 `guard-ok`에서 배운 것).
 */
const MUTATORS = ['set(', 'delete(', 'clear(', 'add(', 'push(', 'shift(', 'pop(', 'splice(']

/** 모듈 스코프 선언 — `export` 접두사를 허용한다 (#241 리뷰) */
const LET_RE = /^(?:export )?(?:let|var) ([A-Za-z_$][\w$]*)/
const CONST_RE = /^(?:export )?const ([A-Za-z_$][\w$]*)(?::[^=]+)? = (?:new (?:Map|Set|WeakMap|WeakSet)\b|\[)/

export interface ModuleState {
  name: string
  line: number
  documented: boolean
}

/**
 * 소스 **문자열**에서 찾는다 — 파일을 읽지 않으므로 테스트가 이 함수를 직접 태울 수 있다.
 * (#241 리뷰: 파일에만 붙어 있으면 "무엇을 잡는가"를 확인하려고 진짜 파일을 심어야 한다.)
 */
export function moduleStateOfSource(src: string, corpus: readonly string[] = [src]): ModuleState[] {
  const lines = src.split('\n')
  const found: ModuleState[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string
    const letMatch = LET_RE.exec(line)
    const constMatch = letMatch === null ? CONST_RE.exec(line) : null
    const mutable = letMatch ?? constMatch
    if (mutable === null) continue
    const name = mutable[1] as string
    // `const` 컨테이너는 **실제로 변형될 때만** 상태다 (읽기 전용 표는 상수다)
    if (constMatch !== null && !MUTATORS.some((m) => corpus.some((text) => text.includes(`${name}.${m}`)))) continue
    // 바로 위에 붙은 주석 블록만 본다 — 빈 줄을 만나면 거기서 끊는다
    let doc = ''
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = (lines[j] as string).trim()
      if (prev === '') break
      if (!(prev.startsWith('*') || prev.startsWith('/*') || prev.startsWith('//') || prev.startsWith('*/'))) break
      doc = prev + '\n' + doc
    }
    found.push({ name, line: i + 1, documented: MENTIONS.some((m) => doc.includes(m)) })
  }
  return found
}

/** 저장소 전체 소스(테스트 제외) — 변형은 선언한 파일 밖에서 일어날 수 있다 (28-88 감사 03) */
const CORPUS: readonly string[] = sourceFiles().map((f) => readFileSync(f, 'utf-8'))

function moduleStateOf(file: string): ModuleState[] {
  return moduleStateOfSource(readFileSync(file, 'utf-8'), CORPUS)
}

describe('서버리스 가정 (28-88-05)', () => {
  it('server/의 모듈 전역 가변 상태는 인스턴스 경계를 문서에 적는다', () => {
    const undocumented = sourceFiles().flatMap((f) =>
      moduleStateOf(f)
        .filter((s) => !s.documented)
        .map((s) => `${f}:${s.line} ${s.name}`),
    )
    expect(
      undocumented,
      '이 상태는 서버리스에서 **인스턴스마다 따로** 존재합니다. 바로 위 주석에 그 사실과 그래서 무엇을 ' +
        '보장하지 못하는지를 적으세요 (server/rateLimit.ts가 좋은 예입니다)',
    ).toEqual([])
  })

  it('검사 대상이 실제로 있다 — 목록이 비면 위 테스트는 아무것도 안 본다 (28-78-04)', () => {
    const all = sourceFiles().flatMap((f) => moduleStateOf(f).map((s) => `${f}:${s.name}`))
    // 28-91 시점의 실제 목록 — 줄어들면(유도가 못 보게 되면) 여기서 걸린다
    // 29-16-3: `pool`(하나) → `pools`(주소별 Map). 이름이 바뀌면 여기서 걸리는 것이 맞다
    expect(all).toContain('server/db.ts:pools')
    expect(all).toContain('server/rateLimit.ts:fails')
    expect(all).toContain('server/handlers/auth.ts:warnedUntrustedIp')
    expect(all.length).toBeGreaterThanOrEqual(3) // 28-91: 옛 publicStats(memo·inflight·…)가 사라져 셋이 남았다
  })

  it('export 접두사가 붙어도 잡는다 (#241 리뷰)', () => {
    // 처음 판은 `^const`·`^let` 만 봐서 아래 둘이 조용히 빠졌다 — 가드가 스스로 빠지는 모양이다.
    const caught = moduleStateOfSource(
      ['export const cache = new Map()', 'cache.set(1, 2)', 'export let counter = 0'].join('\n'),
    ).map((s) => s.name)
    expect(caught, 'export 가 붙은 모듈 전역 상태를 놓쳤습니다').toEqual(['cache', 'counter'])
  })

  it('다른 파일에서 변형되는 export const도 잡는다 (28-88 감사 03)', () => {
    // 수정 전: 선언한 파일 안에서만 `.set(` 등을 찾아서, `b.ts`가 쓰는 `a.ts`의 Map 은 "읽기 전용 표"였다.
    const declaring = 'export const cache = new Map()'
    const elsewhere = "import { cache } from './a'\ncache.set(1, 2)"
    expect(
      moduleStateOfSource(declaring, [declaring, elsewhere]).map((s) => s.name),
      '파일 밖의 변형을 놓쳤습니다',
    ).toEqual(['cache'])
    // 아무 데서도 변형하지 않으면 여전히 상수다 — 거짓 경보로 번지지 않는다
    expect(moduleStateOfSource(declaring, [declaring, "import { cache } from './a'\nif (cache.has(1)) {}"])).toEqual([])
  })

  it('유도가 원시값 const를 상태로 착각하지 않는다 — 거짓 경보는 가드를 죽인다', () => {
    const all = sourceFiles().flatMap((f) => moduleStateOf(f).map((s) => s.name))
    for (const constant of ['WINDOW_MS', 'MAX_FAILS_PER_WINDOW', 'UNKNOWN_IP', 'CACHE_SECONDS', 'PUBLIC_MAX_WAITING']) {
      expect(all, `${constant}는 값이 바뀌지 않습니다`).not.toContain(constant)
    }
    // export 가 붙어도 읽기만 하는 표는 상수다 — 넓힌 정규식이 거짓 경보로 번지지 않는지 (#241 리뷰)
    expect(moduleStateOfSource('export const TABLE = new Set([1, 2])\nif (TABLE.has(1)) {}')).toEqual([])
  })
})
