import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * **관리자 화면은 주소를 외워야 닿는 곳이 없어야 한다** (29-17-3).
 *
 * ## 왜 이 가드가 생겼나
 *
 * `/admin/diagnostics` 를 만들어 놓고 왼쪽 메뉴에 넣지 않았다. 라우트는 살아 있는데 화면 어디에도
 * 그리로 가는 길이 없었다. 사장님이 그 화면을 열려면 우리가 채팅으로 주소를 불러 드려야 했고,
 * 실제로 그렇게 했다. **만들었지만 닿지 않는 화면은 만들지 않은 것과 같다.**
 *
 * ## 이 가드가 하는 일과 하지 않는 일
 *
 * - *한다* — `app/[...slug]/page.tsx` 가 처리하는 `admin/...` 경로를 전부 찾아, 그 각각이
 *   `components/marketplace/shell.tsx` 의 관리자 메뉴(`adminGroups`)에 링크로 있는지 본다.
 * - *하지 않는다* — 그 링크가 **보이는지**(권한·반응형·접힘)는 검사하지 못한다. 문자열 대조다.
 *   이 가드가 막는 것은 "메뉴에 넣는 걸 잊는 것"이지 "잘못 넣는 것"이 아니다.
 *
 * 메뉴에 일부러 안 넣는 화면이 생기면 `UNLISTED` 에 이유와 함께 적는다. 조용히 빠뜨리는 것과
 * 이유를 적고 빼는 것은 다르다.
 */

/** 메뉴에 일부러 두지 않는 경로 — 이유를 함께 적는다 */
const UNLISTED: Record<string, string> = {
  // 다른 이름의 같은 화면이다. /admin 이 메뉴에 있다
  'admin/dashboard': '/admin 과 같은 화면이라 메뉴에는 한 줄만 둔다',
}

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/** 라우터가 실제로 처리하는 admin 경로들 — 문자열 리터럴에서 그대로 걷는다 */
function routedAdminPaths(): string[] {
  const src = read('app/[...slug]/page.tsx')
  const found = new Set<string>()
  for (const m of src.matchAll(/'(admin(?:\/[a-z-]+)*)'/g)) found.add(m[1]!)
  return [...found].sort()
}

/** 관리자 메뉴가 거는 링크들 */
function linkedAdminPaths(): string[] {
  const src = read('components/marketplace/shell.tsx')
  const start = src.indexOf('const adminGroups=')
  expect(start).toBeGreaterThan(-1)
  const block = src.slice(start, src.indexOf('] as const;', start))
  const found = new Set<string>()
  for (const m of block.matchAll(/'\/(admin(?:\/[a-z-]+)*)'/g)) found.add(m[1]!)
  return [...found].sort()
}

describe('관리자 화면에 가는 길', () => {
  it('라우터가 처리하는 admin 경로를 적어도 하나는 찾는다 — 유도가 헛도는 것을 먼저 막는다', () => {
    expect(routedAdminPaths().length).toBeGreaterThan(5)
    expect(linkedAdminPaths().length).toBeGreaterThan(5)
  })

  // 이 줄이 이 파일의 이유다. /admin/diagnostics 가 메뉴 없이 살아 있었다.
  it('주소를 직접 쳐야만 닿는 관리자 화면이 없다', () => {
    const linked = new Set(linkedAdminPaths())
    const orphans = routedAdminPaths().filter((p) => !linked.has(p) && UNLISTED[p] === undefined)
    expect(orphans).toEqual([])
  })

  it('메뉴에서 뺀 경로는 이유가 적혀 있다', () => {
    for (const [path, why] of Object.entries(UNLISTED)) {
      expect(why.length).toBeGreaterThan(5)
      expect(routedAdminPaths()).toContain(path)
    }
  })
})
