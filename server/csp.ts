/**
 * 콘텐츠 보안 정책 (29-5) — 28-41이 세운 헤더를 Next 위에서 **약하게 만들지 않고** 잇는다.
 *
 * ## 왜 정책을 손대야 하는가
 *
 * 옛 SPA는 번들 하나만 내려 줘서 `script-src 'self'`로 충분했다. Next의 App Router는 스트리밍
 * 데이터를 인라인 `<script>`로 심는다(빌드된 HTML에 2개). 그래서 vercel.json의 정책을 그대로 두고
 * 배포만 옮겼다면 그 스크립트가 전부 차단되어 화면이 하이드레이트되지 않았을 것이다.
 *
 * 쉬운 길은 `'unsafe-inline'`이지만 그건 정책을 버리는 것이다. 요청마다 nonce를 만들어 응답 헤더와
 * 인라인 스크립트에 같은 값을 쓰면, 허용되는 것은 **이 응답이 만든 스크립트뿐**이다. 주입된
 * 스크립트는 nonce를 모른다. (로컬에서 한 응답의 헤더 nonce와 본문 nonce가 같은 것을 확인했다.)
 *
 * ## 왜 정책이 `middleware.ts`가 아니라 여기 있는가
 *
 * Next의 미들웨어 자리는 저장소 루트의 `middleware.ts`이고, 29-5에서 실제로 거기에 뒀다. 다만 그
 * 파일은 `next/server`를 부르므로 **Next 빌드 안에서만** 성립한다. 정책 문자열까지 거기 두면
 * 단위 테스트가 프레임워크를 띄워야 그 내용을 볼 수 있다.
 *
 * (배포가 아직 옛 SPA였던 동안에는 더 급한 이유도 있었다 — Vercel이 `framework: null` 배포에서도
 * 루트의 `middleware.ts`를 엣지 미들웨어로 빌드하려 들어 프리뷰가 깨졌다. 그래서 그 라운드에는
 * 루트에 아무것도 두지 않고 정책만 여기 뒀다.)
 *
 * 지금 루트 `middleware.ts`는 이 두 함수를 부르는 얇은 껍데기다:
 *
 * ```ts
 * import { NextResponse, type NextRequest } from 'next/server'
 * import { newNonce, cspHeader } from './server/csp'
 *
 * export function middleware(request: NextRequest) {
 *   const nonce = newNonce()
 *   const headers = new Headers(request.headers)
 *   headers.set('x-nonce', nonce)
 *   const response = NextResponse.next({ request: { headers } })
 *   response.headers.set('Content-Security-Policy', cspHeader(nonce))
 *   return response
 * }
 * ```
 *
 * 정책 문자열을 Next에서 떼어 둔 덕에 **단위 테스트가 프레임워크 없이** 내용을 볼 수 있다
 * (`server/csp.test.ts`). nonce가 실제로 인라인 스크립트에 가 닿는지는 `e2e:next`가 본다.
 */

/** 요청 하나짜리 nonce. 추측 가능하면 의미가 없으므로 난수에서 만든다. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64')
}

/**
 * 이 응답의 정책. `style-src`의 `'unsafe-inline'`은 28-41부터 있던 것이다(인라인 스타일 속성).
 * 스크립트 쪽은 그보다 강한 nonce로 간다 — 그 차이가 이 파일의 요점이다.
 */
export function cspHeader(nonce: string): string {
  return [
    "default-src 'self'",
    // 29-29: 토스 결제 SDK — 스크립트는 strict-dynamic 이 이미 통과시키지만, SDK 가 여는 결제창(iframe)과
    // SDK 의 XHR 은 따로 열어야 한다. 결제가 꺼져 있는 동안은 아무 일도 없고, 켜는 날 여기서 막히지 않는다.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.tosspayments.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://*.tosspayments.com",
    'frame-src https://*.tosspayments.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

/**
 * 공간 스튜디오(`/interior/`)의 정책 (29-8).
 *
 * 이 앱은 `public/`에 있는 **정적 파일**이라 미들웨어가 본문에 nonce를 심을 수 없다. 그리고 위
 * 정책의 `'strict-dynamic'`은 nonce 없는 `<script src>`를 전부 막는다 — 그대로 두면 스튜디오는
 * 한 줄도 실행되지 않는다.
 *
 * 그래서 이 경로만 다른 정책을 준다. `'unsafe-inline'`으로 도망가지 않는다:
 *
 * - 바깥 스크립트는 `'self'`로 허용한다(`app.js` · `three` · `lucide` 전부 우리 도메인이다).
 * - 인라인은 딱 하나, 임포트맵이다. 그 내용의 sha256만 허용한다.
 *
 * 해시가 실제 파일과 맞는지는 `server/csp.test.ts`가 파일에서 다시 계산해 확인한다. 스튜디오
 * 파일이 바뀌면 게이트가 먼저 잡는다 — 배포된 뒤 화면이 죽는 것이 아니라.
 */
export const INTERIOR_IMPORTMAP_SHA256 = 'sha256-XueHYN4etha2FC3MTdxDLKyvr/69mYQU3Cch5vfvlXk='

export function interiorCspHeader(): string {
  return [
    "default-src 'self'",
    `script-src 'self' '${INTERIOR_IMPORTMAP_SHA256}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // 3D를 내보낼 때 GLTF·OBJ를 blob:으로 만들어 내려받게 한다.
    "img-src 'self' data: blob:",
    "connect-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}
