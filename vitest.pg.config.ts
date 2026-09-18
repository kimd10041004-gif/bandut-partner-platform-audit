import { defineConfig } from 'vitest/config'
import { authModeOf } from './build/authMode'

/**
 * 통합 스위트를 **Postgres 로** 돌린다 (29-26). `npm run test:pg:suite`.
 *
 * `vitest.config.ts` 와 같은 파일들 중 `tests/*.integration.test.ts` 만 고르고, 하네스
 * (`tests/support/testDatabase.ts`)가 Postgres 를 고르도록 `TEST_DIALECT` 를 준다. `DATABASE_URL` 은
 * 밖에서 온다 — CI 의 server job 이 준다. 없으면 하네스가 SQLite 로 되돌아가므로 이 설정으로
 * 돌린 결과가 Postgres 것이라는 보장은 `DATABASE_URL` 이 있을 때만 성립한다.
 */
export default defineConfig({
  define: { __AUTH_MODE__: JSON.stringify(authModeOf(process.env)) },
  test: {
    include: ['tests/*.integration.test.ts'],
    environment: 'node',
    env: { TEST_DIALECT: 'postgres' },
    globalSetup: ['./tests/support/globalSetup.ts'],
  },
})
