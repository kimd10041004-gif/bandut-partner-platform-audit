/**
 * **인증 모드 결정은 여기 한 곳이다** (28-87-05).
 *
 * `vite.config.ts`(앱 빌드)와 `vitest.config.ts`(테스트)가 같은 값을 써야 한다 —
 * 두 곳에 따로 적으면 조용히 어긋난다(28-81-03이 도메인에서 배운 것을 빌드 설정에도 적용한다).
 *
 * 왜 `import.meta.env` 대신 `define`인가: `define`은 **번들에 리터럴로 박힌다.**
 * 그래야 배포 확인이 서빙 번들만 보고 "이 배포는 어느 모드인가"를 말할 수 있다.
 * 28-68 이후 열아홉 라운드 동안 프로덕션이 로컬 모드였는데 아무 기계도 그 사실을 말하지 않았다.
 */
export function authModeOf(env: Record<string, string | undefined>): 'local' | 'server' {
  return env['VITE_AUTH_MODE'] === 'server' ? 'server' : 'local'
}
