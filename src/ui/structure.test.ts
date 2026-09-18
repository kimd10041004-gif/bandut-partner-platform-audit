import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'

/**
 * 저장소 구조 규칙의 자동 검사 (28-76 리뷰).
 *
 * `UI_가이드.md` 3절은 "**공용으로 두 번 쓰이는 UI 조각은 `ui/`로 승격**한다"고 적어 두었지만,
 * 적어 둔 것뿐이라 28-76이 공용 부품(OverwrittenBox)을 `features/common/`이라는 새 자리에 두는 것을
 * 아무것도 막지 못했다. 문서에 적는 것과 막는 것은 다르다 — 규칙을 테스트로 옮긴다.
 *
 * 검사: `features/` 안의 모듈을 `features/`의 서로 다른 파일 둘 이상이 가져다 쓰면 실패한다.
 * 그런 조각은 이미 화면 전용이 아니므로 `ui/`에 있어야 한다.
 */
const FEATURES = 'src/features'
const UI = 'src/ui'
const SRC = 'src'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

function resolveImport(from: string, spec: string): string | undefined {
  const base = normalize(join(dirname(from), spec))
  for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
    if (existsSync(base + ext)) return base + ext
  }
  return existsSync(base) ? base : undefined
}

describe('저장소 구조', () => {
  it('features 안의 조각을 두 화면 이상이 쓰면 ui/로 승격되어 있다', () => {
    const files = walk(FEATURES)
    const importers = new Map<string, Set<string>>()
    for (const file of files) {
      const src = readFileSync(file, 'utf-8')
      for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
        const target = resolveImport(file, m[1] as string)
        if (target === undefined || !target.startsWith(FEATURES)) continue
        const set = importers.get(target) ?? new Set<string>()
        set.add(file)
        importers.set(target, set)
      }
    }
    const shared = [...importers]
      .filter(([, from]) => from.size >= 2)
      .map(([target, from]) => `${target} ← ${[...from].sort().join(', ')}`)
      .sort()
    expect(shared, `공용으로 두 번 이상 쓰이는 조각은 src/ui/로 옮기세요 (UI_가이드.md 3절)`).toEqual([])
  })

  /**
   * 28-77-04: 규칙의 **반대 방향**. `UI_가이드.md` 3절은 두 문장이다 — "공용으로 두 번 쓰이는 조각은
   * `ui/`로 승격한다"와 **"화면 전용 조각은 해당 feature 파일 안에 둔다"**. 28-76은 앞 문장만 검사해,
   * 한 화면만 쓰는 조각이 `ui/`에 쌓이는 반대쪽 표류를 그대로 두었다.
   *
   * `App.tsx`가 화면들을 가져다 붙이는 것은 셸의 조립이라 규칙 밖이다 — 그래서 **대상**은 `ui/`만이다.
   * 다만 **사용처**는 `src/` 전체를 센다(28-78-04): 소비자 목록을 네 곳으로 하드코딩해 두면, `src/` 아래
   * 새 디렉터리에서만 쓰이는 조각이 "한 곳에서만 쓰인다"로 오탐되어 규칙이 아니라 목록이 CI를 좌우한다.
   */
  it('ui/의 조각은 실제로 두 곳 이상에서 쓰인다 (화면 전용은 feature 안에)', () => {
    const consumers = new Map<string, Set<string>>()
    for (const file of walk(SRC)) {
      // 28-78-04: 규칙은 전역이므로 검사도 src 전체다
      const src = readFileSync(file, 'utf-8')
      for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
        const target = resolveImport(file, m[1] as string)
        if (target === undefined || !target.startsWith(UI) || target === file) continue
        const set = consumers.get(target) ?? new Set<string>()
        set.add(file)
        consumers.set(target, set)
      }
    }
    const lonely = walk(UI)
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => (consumers.get(f)?.size ?? 0) < 2)
      .sort()
    expect(lonely, '한 곳에서만 쓰이는 조각은 그 feature 파일 안에 두세요 (UI_가이드.md 3절)').toEqual([])
  })

  it('features/common 같은 새 공용 디렉터리를 만들지 않는다', () => {
    expect(existsSync(join(FEATURES, 'common'))).toBe(false)
  })
})
