import { describe, expect, it } from 'vitest'
import {
  clearedSessionCookie,
  cookieOf,
  cookieSecure,
  cookieTrusted,
  sessionCookie,
  SESSION_COOKIE,
  tokenOf,
} from './session'

/**
 * 29-29: 세션 쿠키의 규칙 — DB 없이 보는 것들.
 */
const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv

describe('세션 쿠키 (29-29)', () => {
  it('쿠키 헤더에서 우리 이름만 꺼낸다 — 다른 쿠키·빈 값은 무시', () => {
    expect(cookieOf({ cookie: `a=1; ${SESSION_COOKIE}=tok.en_x; b=2` })).toBe('tok.en_x')
    expect(cookieOf({ cookie: `${SESSION_COOKIE}=` })).toBeNull()
    expect(cookieOf({ cookie: 'other=1' })).toBeNull()
    expect(cookieOf({})).toBeNull()
  })

  it('읽기 요청은 쿠키를 늘 믿는다 — 이미지·SSE 가 이 길로 온다', () => {
    expect(cookieTrusted({}, 'GET')).toBe(true)
    expect(cookieTrusted({}, 'HEAD')).toBe(true)
  })

  it('쓰기 요청은 같은 출처의 증거가 있을 때만 — 남의 사이트에서 낸 POST 에 실린 쿠키는 버린다 (CSRF)', () => {
    expect(
      cookieTrusted({ host: 'www.bandeutjipsuri.co.kr', origin: 'https://www.bandeutjipsuri.co.kr' }, 'POST'),
    ).toBe(true)
    expect(cookieTrusted({ host: 'www.bandeutjipsuri.co.kr', origin: 'https://evil.example' }, 'POST')).toBe(false)
    expect(cookieTrusted({ host: 'www.bandeutjipsuri.co.kr', origin: 'null' }, 'POST')).toBe(false)
    expect(cookieTrusted({ host: 'www.bandeutjipsuri.co.kr', 'sec-fetch-site': 'same-origin' }, 'POST')).toBe(true)
    expect(cookieTrusted({ host: 'www.bandeutjipsuri.co.kr', 'sec-fetch-site': 'cross-site' }, 'POST')).toBe(false)
    expect(cookieTrusted({ host: 'www.bandeutjipsuri.co.kr' }, 'POST')).toBe(false)
  })

  it('Bearer 가 있으면 그것이 먼저고, 없으면 (믿어도 될 때) 쿠키', () => {
    const h = { authorization: 'Bearer bbb', cookie: `${SESSION_COOKIE}=ccc`, host: 'h', origin: 'https://h' }
    expect(tokenOf(h, 'POST')).toBe('bbb')
    expect(tokenOf({ cookie: `${SESSION_COOKIE}=ccc` }, 'GET')).toBe('ccc')
    expect(tokenOf({ cookie: `${SESSION_COOKIE}=ccc`, host: 'h' }, 'POST')).toBeNull()
    expect(tokenOf({ cookie: `${SESSION_COOKIE}=ccc`, host: 'h', origin: 'https://h' }, 'POST')).toBe('ccc')
  })

  it('발급 쿠키는 HttpOnly·SameSite=Lax·Path=/ 이고 만료까지만 산다, Vercel 에서만 Secure', () => {
    const expires = new Date(Date.now() + 3_600_000).toISOString()
    const c = sessionCookie('tok', expires, true)
    expect(c).toMatch(
      new RegExp(`^${SESSION_COOKIE}=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=(3599|3600); Secure$`),
    )
    expect(sessionCookie('tok', expires, false)).not.toContain('Secure')
    expect(clearedSessionCookie(true)).toBe(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`)
    expect(cookieSecure(env({ VERCEL_ENV: 'production' }))).toBe(true)
    expect(cookieSecure(env({ VERCEL_ENV: 'preview' }))).toBe(true)
    expect(cookieSecure(env({}))).toBe(false)
  })
})
