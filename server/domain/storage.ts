/**
 * 키-값 저장소의 최소 모양 (29-5).
 *
 * 28-31부터 `AuthService`는 이 인터페이스 하나만 알고 저장소를 몰랐다 — 브라우저의 `localStorage`도,
 * 서버의 `auth_state` 행을 감싼 어댑터(`server/authState.ts`)도 같은 세 함수로 들어왔다. 그 덕에 로그인
 * 규칙은 한 코드로 양쪽에서 돌았다.
 *
 * 29-5에서 옛 SPA와 스냅샷 스택을 지우면서 원래 자리(`src/domain/platform.ts`)가 사라졌다. 남은 것은
 * 이 네 줄뿐이라 `platform.ts`를 살릴 이유가 없어 여기로 옮겼다 — 옮긴 것은 자리이고, 계약은 그대로다.
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
