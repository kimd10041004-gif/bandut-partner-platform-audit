import { defineConfig } from 'vitest/config'
import { authModeOf } from './build/authMode'

export default defineConfig({
  // 28-87-05: 앱 빌드와 같은 곳에서 결정한다 — 두 곳에 적으면 조용히 어긋난다
  define: { __AUTH_MODE__: JSON.stringify(authModeOf(process.env)) },
  test: {
    // 28-64-01: .tsx 테스트가 수집되지 않아 '조용히 사라지던' 구멍을 막는다
    // 29-1: v17 이식 — 도메인(lib/marketplace)과 통합 테스트(tests/)가 함께 돈다
    include: [
      'src/**/*.test.{ts,tsx}',
      'server/**/*.test.ts',
      'lib/**/*.test.ts',
      'tests/**/*.test.ts',
      // 29-28: 봇 안전장치(운영 호스트 목록)도 단언으로 묶는다
      'scripts/**/*.test.mjs',
    ],
    environment: 'node',
    // 29-24: 계정·세션 표를 파일들이 시작하기 전에 한 번만 세운다 (tests/support/globalSetup.ts)
    globalSetup: ['./tests/support/globalSetup.ts'],
  },
})
