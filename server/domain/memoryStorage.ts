/**
 * **메모리 저장소 픽스처** (28-90) — 테스트에서 `localStorage` 자리에 꽂는 `StorageLike`.
 *
 * 28-89까지 같은 여섯 줄이 `auth.test` · `platform.test` · `bootstrap.test`(두 번) ·
 * `ports.contract.test`에 다섯 벌 있었다. `data`를 노출해 테스트가 저장된 원문을 직접 볼 수 있다.
 * 앱 코드는 이 파일을 import 하지 않는다 — 검사기의 입력이지 화면 조각이 아니다.
 */
import type { StorageLike } from './storage'

export function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}
