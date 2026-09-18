import { NextResponse, type NextRequest } from 'next/server'
import { newNonce, cspHeader, interiorCspHeader } from './server/csp'

/**
 * 콘텐츠 보안 정책을 요청마다 붙인다 (29-5).
 *
 * 정책 문자열과 nonce 생성은 `server/csp.ts`에 있다 — 그 파일의 주석에 왜 나눠 뒀는지가 적혀 있다
 * (요약: 이 파일이 루트에 있으면 Vercel이 **옛 SPA 배포에서도** 엣지 미들웨어로 빌드하려다 깨진다.
 * 그래서 배포가 Next로 넘어가는 이 시점에야 루트에 둔다).
 *
 * nonce를 `x-nonce` 요청 헤더로 넘기면 Next가 자기 인라인 스크립트에 같은 값을 붙인다. 허용되는 것은
 * 이 응답이 만든 스크립트뿐이고, 주입된 스크립트는 nonce를 모른다.
 */
export function middleware(request: NextRequest) {
  // 29-8: 공간 스튜디오는 public/ 의 정적 파일이라 본문에 nonce 를 심을 수 없다. 그 경로만
  // 임포트맵 해시를 허용하는 정책으로 간다 (server/csp.ts 의 주석에 이유가 있다).
  if (request.nextUrl.pathname.startsWith('/interior')) {
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', interiorCspHeader())
    return response
  }

  const nonce = newNonce()
  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', cspHeader(nonce))
  return response
}

export const config = {
  // 정적 자산과 이미지 최적화는 문서가 아니라서 정책이 필요 없다
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
