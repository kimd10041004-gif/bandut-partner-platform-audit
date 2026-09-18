import { describe, it, expect } from 'vitest'
import { DomainError } from '../server/domain/errors'
import { isKnownError } from './ui/format'

/**
 * 28-65-03: **목록을 베끼지 않는** 테스트.
 *
 * 이전 테스트(`src/ui/format.test.ts`)는 `isKnownError`가 나열한 클래스를 그대로 다시 나열해
 * 참을 확인했다. 그래서 목록에서 빠진 클래스(`PlatformReopenError`)를 영원히 잡을 수 없었다 —
 * 코드가 하는 일을 되풀이할 뿐 해야 할 일을 확인하지 않는, 28-64-01과 같은 실패 형태다.
 *
 * 이 테스트는 도메인 모듈을 훑어 Error 하위 클래스를 **발견**한다. 새 오류를 추가하면
 * 아무것도 고치지 않아도 이 테스트의 대상이 된다.
 */
// 28-66-04: 범위를 `src/domain/*.ts`에서 **소스 전체**로 넓혔다.
// 예전 glob은 도메인 직속의 .ts만 봐서, `errors.ts`가 약속한 보증
// ("상속하지 않으면 이 테스트가 잡는다")이 `src/ui/`·`src/features/`·`.tsx`·하위 디렉터리에서
// 성립하지 않았다. 실제로 `src/ui/image.ts`가 맨 Error를 던지고 있었고 아무도 잡지 못했다.
//
// 테스트 파일은 제외한다 — eager glob이 이들을 import 하면 그 안의 describe/it가
// 이 파일에 함께 등록돼 테스트 수가 부풀고 실행이 느려진다(실제로 그렇게 만들었다가 고쳤다).
//
// `./main.tsx`만 제외한다 — 브라우저 진입점이라 import 하는 것만으로 `window`를 건드린다.
// 오류 클래스를 정의하지 않는 파일이고, **조용한 제외가 아니라 여기 한 줄로 드러나 있다.**
// 29-5: 로그인 도메인이 `server/domain/`으로 옮겨가면서 `AuthError`가 이 훑기 밖으로 나갔다.
// 옮긴 날 테스트 수가 690 → 688로 줄어 드러났다 — 가드가 조용히 좁아진 것이라 범위를 따라 넓힌다.
// (src/가 지워질 때 이 파일도 server/ 아래로 옮겨야 가드가 살아남는다.)
const modules = import.meta.glob(
  [
    './**/*.ts',
    './**/*.tsx',
    '../server/domain/**/*.ts',
    '!./**/*.test.ts',
    '!./**/*.test.tsx',
    '!../server/domain/**/*.test.ts',
    '!./main.tsx',
  ],
  { eager: true },
) as Record<string, Record<string, unknown>>

type Found = { module: string; name: string; ctor: Function }

function isErrorSubclass(v: unknown): v is Function {
  if (typeof v !== 'function') return false
  let proto: unknown = Object.getPrototypeOf(v)
  while (typeof proto === 'function') {
    if (proto === Error) return true
    proto = Object.getPrototypeOf(proto)
  }
  return false
}

const found: Found[] = []
for (const [path, mod] of Object.entries(modules)) {
  for (const [name, value] of Object.entries(mod)) {
    // 28-66-04: 이름이 아니라 동일성으로 거른다. 이름 비교는 재export(`as BaseError`)에 오탐한다.
    if (value === DomainError) continue
    if (isErrorSubclass(value)) found.push({ module: path, name, ctor: value })
  }
}

/**
 * 28-67-04: **소스 글자**를 훑는다.
 *
 * 위의 발견은 모듈이 *export한 클래스*를 본다. 그래서 `throw new Error(...)` 문장은
 * **원리적으로** 걸리지 않는다 — 실제로 `src/ui/image.ts`의 세 곳 중 하나가
 * 28-67에서 고쳐지지 않고 남았는데 이 파일은 초록이었다.
 * `errors.ts`의 보증 문단이 그 구분을 하지 않아 "실제보다 넓은 보증"이 그대로 재생산됐다
 * (28-64-01·28-65-03이 반복 지적한 형태다).
 *
 * 그래서 보증 문구를 좁히는 대신 **보증을 실제로 넓힌다**: 던지는 자리를 글자로 찾는다.
 */
const sources = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** `throw new Error(` · `reject(new Error(` — 사용자에게 갈 수 있는 자리에서 맨 Error를 만드는 형태 */
const BARE_ERROR = /(?:throw|reject\(|Promise\.reject\()\s*new\s+(?:Error|TypeError|RangeError)\s*\(/

/**
 * 주석을 지운다 — **이 규칙을 설명하는 문서가 스스로 위반으로 잡히지 않게.**
 * (실제로 `errors.ts`의 설명 문단이 걸려서 넣었다. 규칙을 적을 수 없는 규칙은 쓸모가 없다.)
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

describe('도메인 오류 (28-65-03)', () => {
  it('훑어서 발견한 오류 클래스가 있다 — 탐색 자체가 망가지면 이 테스트 전체가 공허해진다', () => {
    expect(found.length).toBeGreaterThanOrEqual(9)
  })

  it('소스 전체를 훑는다 — glob이 좁아지면 잡는다 (28-66-04)', () => {
    // 도메인만 보던 시절엔 10개 안팎이었다. 이 하한이 깨지면 범위가 다시 좁아진 것이다.
    expect(Object.keys(modules).length).toBeGreaterThan(30)
    const dirs = new Set(Object.keys(modules).map((p) => p.split('/')[1]))
    // 29-5: 'server'가 빠지면 로그인 도메인의 오류가 다시 훑기 밖으로 나간 것이다
    for (const d of ['domain', 'ui', 'app', 'features', 'server']) expect(dirs).toContain(d)
  })

  it.each(found.map((f) => [`${f.name} (${f.module})`, f] as const))(
    '%s 은(는) DomainError를 상속한다',
    (_label, f) => {
      expect(f.ctor.prototype instanceof DomainError).toBe(true)
    },
  )

  it.each(found.map((f) => [`${f.name} (${f.module})`, f] as const))(
    '%s 은(는) isKnownError로 참이다 — 사용자에게 메시지가 보인다',
    (_label, f) => {
      // 생성자 인자가 클래스마다 달라 인스턴스화하지 않고 프로토타입만 세운다
      expect(isKnownError(Object.create(f.ctor.prototype))).toBe(true)
    },
  )

  it('소스 글자 훑기가 실제로 파일을 읽었다 — 탐색이 망가지면 아래가 공허해진다 (28-67-04)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30)
    // 정규식이 실제로 이 형태를 잡는다는 것을 보인다(패턴이 오타면 아래가 조용히 통과한다)
    expect(BARE_ERROR.test("throw new Error('x')")).toBe(true)
    expect(BARE_ERROR.test("reject(new Error('x'))")).toBe(true)
    expect(BARE_ERROR.test("throw new PlatformError('x')")).toBe(false)
    // 주석 제거가 실제로 동작한다 — 규칙을 설명하는 문장이 위반으로 잡히면 안 된다
    expect(BARE_ERROR.test(stripComments('/** throw new Error( 를 금지한다 */'))).toBe(false)
    expect(BARE_ERROR.test(stripComments("// throw new Error('x')"))).toBe(false)
    expect(BARE_ERROR.test(stripComments("throw new Error('x')"))).toBe(true)
  })

  it('사용자에게 갈 수 있는 자리에서 맨 Error를 던지지 않는다 (28-67-04)', () => {
    /**
     * 예외는 **개발자 실수**를 던지는 자리뿐이다 — 사용자 조작으로는 도달할 수 없고,
     * 도달했다면 화면 전체가 교체되는 것이 맞다. 조용한 제외가 아니라 이유가 여기 적혀 있다.
     */
    const 개발자_실수만 = new Set([
      './app/PlatformContext.tsx', // usePlatform을 프로바이더 밖에서 부른 경우
      './domain/hash.ts', // hashPassword(iterations) 불변식 — 인자는 코드가 정한다
    ])
    const offenders = Object.entries(sources)
      .filter(([path]) => !개발자_실수만.has(path))
      .filter(([, text]) => BARE_ERROR.test(stripComments(text)))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('도메인 밖의 오류는 거짓이다 — 화면 전체가 교체되는 쪽으로 간다', () => {
    expect(isKnownError(new Error('평범한 오류'))).toBe(false)
    expect(isKnownError(new TypeError('타입'))).toBe(false)
    expect(isKnownError('문자열')).toBe(false)
    expect(isKnownError(undefined)).toBe(false)
  })
})
