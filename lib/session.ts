/**
 * 브라우저 쪽 세션 (29-6 → 29-29).
 *
 * ## 29-29: 토큰은 이제 브라우저 스크립트가 들지 않는다
 *
 * 29-6 부터 토큰을 localStorage 에 두고 `Authorization` 헤더로 보냈다. 그 방식은 두 가지를 못 했다 —
 * `<img src>` 와 `EventSource` 는 헤더를 못 실어 **현장 사진이 깨지고 상담 실시간 연결이 401** 이었다.
 * 그리고 XSS 한 건이면 토큰이 통째로 나갔다.
 *
 * 이제 서버가 로그인 응답에 **HttpOnly 쿠키**를 내린다(`server/session.ts`). 브라우저가 같은 출처의 모든 요청 —
 * fetch·이미지·SSE — 에 알아서 싣고, 스크립트는 읽을 수 없다. 그래서 이 파일은 더 이상 토큰을 저장하지 않는다.
 * 남은 일은 하나, 29-6~29-28 사이에 저장된 옛 토큰을 지우는 것이다(그 토큰은 서버에서 여전히 유효하므로 남겨
 * 두면 XSS 노출면이 그대로다).
 *
 * `authHeader()` 는 빈 객체를 돌려준다 — 부르는 자리를 남겨 둔 것은 옛 SPA(서버 모드)의 Bearer 흐름과 대칭을
 * 유지하기 위해서다. 쿠키가 없거나 폐기됐으면 서버가 401 을 주고, 화면은 그것을 "로그인 필요"로 그린다.
 */
const LEGACY_KEY = 'bandut.session.token'

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** 옛 저장소에 남은 토큰을 지운다 — 있으면 true */
export function dropLegacyToken(): boolean {
  try {
    const s = storage()
    if (s === null || s.getItem(LEGACY_KEY) === null) return false
    s.removeItem(LEGACY_KEY)
    return true
  } catch {
    return false
  }
}

/** 29-29 이전 호출자를 위한 이름 — 이제 지우는 일만 한다 */
export function clearToken(): void {
  dropLegacyToken()
}

/** 요청에 붙일 헤더 — 세션은 쿠키가 나르므로 **아무것도 붙이지 않는다** */
export function authHeader(): Record<string, string> {
  dropLegacyToken()
  return {}
}
