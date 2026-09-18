import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { cspHeader, newNonce, interiorCspHeader, INTERIOR_IMPORTMAP_SHA256 } from './csp'

/**
 * 29-5: 전환 라운드에서 이 정책이 Next의 인라인 스크립트를 막지 않으면서도 약해지지 않아야 한다.
 * 프레임워크 없이 문자열만 보는 회귀 — 정책이 조용히 느슨해지면 여기서 걸린다.
 */
describe('콘텐츠 보안 정책 (29-5)', () => {
  it('script-src에 이 응답의 nonce가 들어간다', () => {
    expect(cspHeader('abc123')).toContain("script-src 'self' 'nonce-abc123'")
  })

  it("script-src를 'unsafe-inline'으로 열지 않는다 — 28-41의 정책을 약하게 만들지 않는다", () => {
    const scriptSrc = cspHeader(newNonce())
      .split('; ')
      .find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toBeDefined()
    expect(scriptSrc).not.toContain('unsafe-inline')
  })

  it("style-src의 'unsafe-inline'은 그대로 둔다 — 28-41부터 있던 인라인 스타일 속성 때문이다", () => {
    expect(cspHeader('n')).toContain("style-src 'self' 'unsafe-inline'")
  })

  it('28-41이 세운 나머지 방어가 남아 있다', () => {
    const csp = cspHeader('n')
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(csp).toContain(d)
    }
  })

  it('nonce는 요청마다 다르다 — 같으면 재사용이 가능해져 의미가 없다', () => {
    expect(newNonce()).not.toBe(newNonce())
  })
})

/**
 * 29-8: 공간 스튜디오는 `public/`의 정적 파일이라 nonce를 심을 수 없다. 해시로 간다.
 *
 * 해시를 상수로 적어 두면 파일이 바뀌었을 때 **화면이 조용히 죽는다** — 브라우저가 임포트맵을
 * 막고, 서버는 200을 준다. 그래서 여기서 실제 파일에서 다시 계산해 맞춰 본다.
 */
describe('공간 스튜디오 정책 (29-8)', () => {
  const html = readFileSync(join('public', 'interior', 'index.html'), 'utf-8')

  function inlineScripts(doc: string): string[] {
    return [...doc.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
  }

  it('인라인 스크립트는 임포트맵 하나뿐이다 — 늘어나면 해시 하나로는 못 덮는다', () => {
    expect(inlineScripts(html)).toHaveLength(1)
  })

  it('적어 둔 해시가 실제 파일의 임포트맵과 맞는다', () => {
    const body = inlineScripts(html)[0]!
    const hash = 'sha256-' + createHash('sha256').update(body, 'utf-8').digest('base64')
    expect(hash).toBe(INTERIOR_IMPORTMAP_SHA256)
    expect(interiorCspHeader()).toContain(`'${INTERIOR_IMPORTMAP_SHA256}'`)
  })

  it("'unsafe-inline'으로 도망가지 않았다", () => {
    expect(interiorCspHeader()).not.toContain('unsafe-inline script')
    const scriptSrc = interiorCspHeader()
      .split('; ')
      .find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toBeDefined()
    expect(scriptSrc).not.toContain('unsafe-inline')
  })

  it("'strict-dynamic'은 쓰지 않는다 — 그것이 이 앱의 <script src>를 전부 막는다", () => {
    expect(interiorCspHeader()).not.toContain('strict-dynamic')
  })

  it('28-41이 세운 나머지 방어는 여기에도 있다', () => {
    const csp = interiorCspHeader()
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'"]) {
      expect(csp).toContain(d)
    }
  })

  it('시안 호스트가 주입한 스크립트를 들여오지 않았다', () => {
    expect(html).not.toContain('cdn-cgi')
    expect(html).not.toContain('__CF')
  })
})
