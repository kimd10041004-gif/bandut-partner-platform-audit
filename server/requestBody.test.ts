import { describe, expect, it } from 'vitest'
import { wantsJsonBody } from './requestBody'

/**
 * 29-25: 사진 업로드가 "요청 내용을 확인해 주세요"를 받던 자리.
 *
 * 라우트가 모든 POST를 `JSON.parse` 하고 있었다. 사진은 바이트로 오므로 언제나 던졌고,
 * 사용자는 **자기 입력이 잘못됐다는 말**을 들었다. 실제 이유는 저장소 미연결(503)이었다.
 */
describe('POST 본문을 JSON으로 읽을 것인가', () => {
  it('JSON이면 읽는다', () => {
    expect(wantsJsonBody('application/json')).toBe(true)
    expect(wantsJsonBody('application/json; charset=utf-8')).toBe(true)
    expect(wantsJsonBody('APPLICATION/JSON')).toBe(true)
    expect(wantsJsonBody('application/merge-patch+json')).toBe(true)
  })

  it('타입이 없으면 예전대로 JSON으로 본다 — 빈 본문과 옛 호출이 여기로 온다', () => {
    expect(wantsJsonBody(undefined)).toBe(true)
    expect(wantsJsonBody('')).toBe(true)
    expect(wantsJsonBody('   ')).toBe(true)
  })

  it('사진 바이트는 손대지 않는다 — 글자로 읽으면 바이트가 깨진다', () => {
    expect(wantsJsonBody('image/png')).toBe(false)
    expect(wantsJsonBody('image/jpeg')).toBe(false)
    expect(wantsJsonBody('application/octet-stream')).toBe(false)
    expect(wantsJsonBody('multipart/form-data; boundary=x')).toBe(false)
  })
})
