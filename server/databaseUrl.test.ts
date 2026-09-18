import { describe, it, expect } from 'vitest'
import { resolveDatabaseUrl } from './databaseUrl'

const PROD = 'postgres://prod/db'
const PREVIEW = 'postgres://preview/db'

describe('어느 DB에 붙는가 (29-5)', () => {
  it('프리뷰에 전용 값이 있으면 그것을 쓴다 — 운영 데이터에 테스트 계정을 만들지 않는다', () => {
    const env = { VERCEL_ENV: 'preview', DATABASE_URL: PROD, DATABASE_URL_PREVIEW: PREVIEW }
    expect(resolveDatabaseUrl(env as NodeJS.ProcessEnv)).toBe(PREVIEW)
  })

  it('운영에서는 프리뷰 값이 있어도 절대 쓰지 않는다', () => {
    const env = { VERCEL_ENV: 'production', DATABASE_URL: PROD, DATABASE_URL_PREVIEW: PREVIEW }
    expect(resolveDatabaseUrl(env as NodeJS.ProcessEnv)).toBe(PROD)
  })

  it('프리뷰라도 전용 값이 없으면 평소대로 — 분리 전과 같이 동작한다', () => {
    const env = { VERCEL_ENV: 'preview', DATABASE_URL: PROD }
    expect(resolveDatabaseUrl(env as NodeJS.ProcessEnv)).toBe(PROD)
  })

  it('빈 문자열은 설정되지 않은 것으로 본다 — 빈 값으로 조용히 붙으려 하지 않는다', () => {
    const env = { VERCEL_ENV: 'preview', DATABASE_URL: PROD, DATABASE_URL_PREVIEW: '' }
    expect(resolveDatabaseUrl(env as NodeJS.ProcessEnv)).toBe(PROD)
  })

  it('로컬·CI(VERCEL_ENV 없음)는 게이트가 보는 것과 운영이 보는 것이 같다', () => {
    const env = { DATABASE_URL: PROD, DATABASE_URL_PREVIEW: PREVIEW }
    expect(resolveDatabaseUrl(env as NodeJS.ProcessEnv)).toBe(PROD)
  })

  it('둘 다 없으면 undefined — 부르는 쪽이 503으로 답한다', () => {
    expect(resolveDatabaseUrl({} as NodeJS.ProcessEnv)).toBeUndefined()
  })
})
