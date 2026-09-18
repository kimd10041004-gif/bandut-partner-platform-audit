/**
 * 열람 등급 화면의 **실제** 차단 (28-89 리뷰, #244).
 *
 * 첫 판은 `.admin-readonly button { pointer-events: none }` **CSS 하나**로 막았다.
 * 그런데 `pointer-events: none`은 **포커스와 키보드를 막지 않는다** — Tab으로 옮겨 가서 Enter를 누르면
 * 버튼의 `onClick`이 그대로 돈다. 즉 화면의 차단이 마우스에게만 참이었다.
 *
 * 서버 모드에서는 그 클릭이 403으로 끝나지만(`api/auth.ts`·`api/snapshot.ts`), **로컬 모드에서는
 * 서버가 없다** — 그 자리에서 계정이 정지되고 스냅샷이 저장된다. 프로덕션이 지금 로컬 모드이므로
 * (docs/rounds/28-87/서버_모드_전환.md) 이것은 지금 라이브에서 참인 구멍이다.
 *
 * 그래서 이벤트를 **캡처 단계에서** 막는다. CSS는 이제 "막는 장치"가 아니라 "막혔다는 표시"다.
 *
 * **여전히 화면의 차단일 뿐이다** — 콘솔로 도메인 메서드를 부르는 것은 막지 못한다.
 * 실제 경계는 도메인(`assertOwner`)과 서버(등급 검사)이고, 로컬 모드에는 그 서버가 없다.
 * `adminGrade.ts`에 적은 한계가 여기에도 그대로 적용된다.
 */

/** 열람 등급도 눌러야 하는 것 — 보기 위한 조작까지 막으면 열람 등급이 쓸모없어진다 */
const VIEWER_OK = '.filter-group button, .link-btn, [data-viewer-ok]'

/** 값을 **바꾸는** 입력들. 검색·필터 텍스트 입력은 여기 없다(열람 등급도 검색한다) */
const MUTATING_INPUT_TYPES = ['checkbox', 'radio', 'file']

/**
 * 이 요소를 누르는 것이 상태를 바꾸는 조작인가 — 그렇다면 열람 등급에게 막는다.
 * 대상: `button` · `select` · 체크박스/라디오/파일 입력 · 그것을 감싼 `label`.
 */
export function isBlockedForViewer(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof Element)) return false
  const control = target.closest('button, select, input, label')
  if (control === null) return false
  if (control.closest(VIEWER_OK) !== null) return false
  if (control instanceof HTMLInputElement) return MUTATING_INPUT_TYPES.includes(control.type)
  if (control instanceof HTMLLabelElement) {
    // `<label class="toggle"><input type="checkbox">` — 라벨을 눌러도 입력이 바뀐다
    const input = control.querySelector('input')
    return input !== null && MUTATING_INPUT_TYPES.includes(input.type)
  }
  return control instanceof HTMLButtonElement || control instanceof HTMLSelectElement
}

/** 버튼·체크박스를 키보드로 누르는 키 — 이것이 곧 `click`이 된다 */
export function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar'
}
