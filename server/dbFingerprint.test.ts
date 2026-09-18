import { describe, expect, it } from 'vitest'
import { dbFingerprint } from './dbFingerprint'
import { resolveDatabaseUrl } from './databaseUrl'

const PROD = 'postgres://u:secret@ep-prod-1.ap-northeast-2.aws.neon.tech/neondb?sslmode=require'
const PREV = 'postgres://u:secret@ep-preview-9.ap-northeast-2.aws.neon.tech/neondb?sslmode=require'
const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv

/** 실제로 쓰는 경로 그대로 — 고른 것과 보여 주는 것이 어긋나면 확인이 거짓말이 된다 */
const fingerprintOf = (e: NodeJS.ProcessEnv) => dbFingerprint(e, resolveDatabaseUrl(e))

describe('어느 DB를 보는지', () => {
  it('비밀번호를 내주지 않는다', () => {
    const f = fingerprintOf(env({ VERCEL_ENV: 'production', DATABASE_URL: PROD }))
    expect(JSON.stringify(f)).not.toContain('secret')
    expect(JSON.stringify(f)).not.toContain('sslmode')
    expect(f.host).toBe('ep-prod-1.ap-northeast-2.aws.neon.tech')
    expect(f.database).toBe('neondb')
  })

  it('전용 값을 쓰면 기본값과 다른 곳이라고 말한다', () => {
    const f = fingerprintOf(env({ VERCEL_ENV: 'preview', DATABASE_URL: PROD, DATABASE_URL_PREVIEW: PREV }))
    expect(f.usingPreviewUrl).toBe(true)
    expect(f.differentFromFallback).toBe(true)
    expect(f.host).toContain('ep-preview-9')
    expect(f.fallback?.host).toContain('ep-prod-1')
  })

  it('프리뷰인데 전용 값이 없으면 기본값 그대로다', () => {
    const f = fingerprintOf(env({ VERCEL_ENV: 'preview', DATABASE_URL: PROD }))
    expect(f.usingPreviewUrl).toBe(false)
    expect(f.differentFromFallback).toBe(false)
    expect(f.host).toContain('ep-prod-1')
  })

  it('전용 값이 있어도 기본값과 같은 곳이면 다르다고 하지 않는다', () => {
    const f = fingerprintOf(env({ VERCEL_ENV: 'preview', DATABASE_URL: PROD, DATABASE_URL_PREVIEW: PROD }))
    expect(f.differentFromFallback).toBe(false)
  })

  // 29-17-2. 이 줄이 이 파일의 이유다. 비교할 상대가 없는데 "다름"이라고 답하면, 아무것도 확인하지
  // 않고 갈라졌다고 믿게 된다. 없는 것과 다른 것은 다르다.
  it('비교할 기본값이 없으면 다르다고 말하지 않는다 — 없는 것과 다른 것은 다르다', () => {
    const f = fingerprintOf(env({ VERCEL_ENV: 'preview', DATABASE_URL_PREVIEW: PREV }))
    expect(f.usingPreviewUrl).toBe(true)
    expect(f.fallback).toBe(null)
    expect(f.differentFromFallback).toBe(null)
  })

  // 29-17-2. 프리뷰 배포가 보는 DATABASE_URL 은 Preview 환경에 걸린 값이다. 운영 환경의 값이 아니다
  // — 배포는 자기 환경의 변수만 받는다. 그래서 이 비교로 운영을 말하면 안 된다.
  it('비교 상대는 이 배포의 기본값이다 — 운영 값이 아니다', () => {
    const f = fingerprintOf(env({ VERCEL_ENV: 'preview', DATABASE_URL: PREV, DATABASE_URL_PREVIEW: PREV }))
    expect(f.fallback?.host).toContain('ep-preview-9')
    expect(f.differentFromFallback).toBe(false)
  })

  it('로컬·CI 도 같은 규칙으로 답한다', () => {
    expect(fingerprintOf(env({ DATABASE_URL: PROD })).deployEnv).toBe('(로컬·CI)')
    expect(fingerprintOf(env({ DATABASE_URL: PROD })).differentFromFallback).toBe(false)
    expect(fingerprintOf(env({})).differentFromFallback).toBe(null)
  })

  it('형식이 깨진 값을 되비추지 않는다', () => {
    const f = fingerprintOf(env({ DATABASE_URL: 'not a url' }))
    expect(f.host).toBe('(읽을 수 없는 형식)')
    expect(JSON.stringify(f)).not.toContain('not a url')
  })
})
