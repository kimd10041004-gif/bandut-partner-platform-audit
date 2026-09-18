/** 브라우저 파일 다운로드 (28-47-02) — 백업(JSON)과 CSV가 공유. 상용 전환 시 서버 생성 파일 URL로 대체 가능 */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
