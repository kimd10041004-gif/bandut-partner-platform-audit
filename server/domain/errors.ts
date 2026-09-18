/**
 * 도메인 오류의 공통 기반 (28-65-03).
 *
 * 28-65까지 `isKnownError`(`src/ui/format.ts`)는 도메인 오류를 **손으로 나열**했다.
 * 저장소에 9개가 있는데 목록에는 8개만 있었고(`PlatformReopenError` 누락),
 * 같은 라운드에 새로 넣은 테스트는 그 목록을 그대로 베껴서 누락을 영원히 잡을 수 없었다
 * — 28-64-01(죽은 코드를 검사해 초록을 만들던 게이트)과 같은 실패 형태다.
 *
 * 이제 목록이 아니라 **상속**이 판정한다. 도메인 오류는 전부 이 클래스를 상속하고,
 * `isKnownError`는 `instanceof DomainError` 하나만 본다.
 *
 * 28-66-04 / 28-67-04: `src/errors.test.ts`가 무엇을 보증하는지 **정확히** 적는다.
 * 이 문단은 두 번 실제보다 넓었다 — 28-66은 범위를 `src/domain/*.ts`로 좁게 두고
 * "잡는다"고 적었고, 28-66-04의 수정도 두 가지를 뭉뚱그렸다. 보증은 **두 겹**이다:
 *
 *  1. **export한 오류 클래스** — 모듈을 eager로 훑어 `Error` 하위 클래스를 발견하고,
 *     각각이 `DomainError`를 상속하는지 확인한다. 범위는 `src/**`의 `.ts`·`.tsx`이고
 *     제외는 브라우저 진입점 `src/main.tsx` 하나뿐이며 glob 한 줄에 드러나 있다.
 *     이 겹은 `throw new Error(...)` **문장**은 원리적으로 보지 못한다 — 클래스가 아니라 문장이다.
 *  2. **던지는 문장** (28-67-04) — 그래서 소스를 **글자로** 훑어
 *     `throw new Error(` · `reject(new Error(` 형태를 따로 찾는다.
 *     28-67은 1번만 두고 "잡는다"고 적었는데, 바로 그때 `src/ui/image.ts`에
 *     맨 `Error`가 하나 남아 있었고 테스트는 초록이었다.
 *     예외는 개발자 실수를 던지는 자리 둘뿐이고 테스트 안에 이유와 함께 적혀 있다.
 *
 * 사용자에게 그대로 보여도 되는 메시지만 이 계열로 던진다는 뜻이기도 하다.
 * 호출부는 `catch { if (isKnownError(err)) setError(err.message); else throw err }` 형태라,
 * 이 계열이 아니면 ErrorBoundary로 올라가 화면 전체가 교체된다.
 */
export abstract class DomainError extends Error {}
