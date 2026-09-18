/**
 * POST 본문을 JSON으로 읽을 것인가 (29-25).
 *
 * ## 왜 판단이 따로 필요한가
 *
 * `/api/<path>` 한 자리로 두 종류가 들어온다. 대부분은 JSON이지만 **사진은 파일 바이트 그대로** 온다
 * (`fetch(..., { body: file, headers: { 'Content-Type': file.type } })` — `components/marketplace/request.tsx`,
 * `trade.tsx`의 증빙 업로드, 포트폴리오 사진).
 *
 * 라우트가 그 구분 없이 모든 POST에 `req.text()` → `JSON.parse`를 하고 있었다. PNG 바이트는 JSON이
 * 아니므로 언제나 던지고, 사용자는 **`요청 내용을 확인해 주세요.`** 를 받았다. 사진 저장소가 아직
 * 연결되지 않았다는 진짜 이유(503)는 그 뒤에 있어서 한 번도 화면에 닿지 못했다.
 *
 * 틀린 이유는 이유가 없는 것보다 나쁘다 — 사장님은 파일을 바꿔 가며 여러 번 시도하게 된다.
 *
 * ## 규칙
 *
 * `application/json`(과 `+json`)이면 읽어서 판다. 본문 타입이 아예 없으면 예전처럼 JSON으로 본다 —
 * 화면의 `api()`가 그렇게 부르는 자리가 있고, 빈 본문도 여기로 온다. 그 밖의 타입은 **손대지 않는다.**
 * 글자로 읽는 순간 바이트가 깨지기 때문에, 바이트를 다루는 쪽에 그대로 넘긴다.
 */

/** 이 본문 타입을 JSON으로 읽어야 하는가 */
export function wantsJsonBody(contentType: string | undefined): boolean {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return type === '' || type === 'application/json' || type.endsWith('+json')
}
