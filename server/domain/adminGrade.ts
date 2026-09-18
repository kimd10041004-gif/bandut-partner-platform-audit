/**
 * 관리자 등급과 권한 (28-89-A).
 *
 * 28-88까지 관리자는 **계정 하나**(`admin`)였다 — 누가 들어오든 전부 할 수 있었다.
 * 운영에 사람이 둘 이상 붙는 순간 그것은 "실수로 파기"와 "권한 없이 지급"이 같은 비밀번호 뒤에 있다는 뜻이다.
 *
 * 세 등급이다. 더 잘게 쪼개면 사장님이 매번 표를 봐야 한다.
 *
 * | 등급 | 뜻 |
 * |---|---|
 * | `owner`   | 사장님. 전부 + **관리자 계정 관리·복원·파기·시연 삭제** |
 * | `manager` | 운영 담당. 승인·정지·환불·지급·분쟁·리뷰·설정·홈페이지 배치 |
 * | `viewer`  | 열람. 현황·목록·기록을 **보기만** 한다 |
 *
 * ## 어디서 막는가 — 정직하게
 *
 * - **도메인(`AuthService`)**: 관리자 계정 관리는 `owner`만. 서버·로컬 모두 같은 코드.
 * - **서버(`api/auth.ts`)**: 관리자 op마다 필요한 등급을 본다(`ADMIN_OP_ACTION`).
 * - **서버(`api/snapshot.ts`)**: `viewer` 세션은 스냅샷을 **쓸 수 없다**(403).
 * - **화면**: 등급에 맞지 않는 버튼은 비활성. `viewer`는 관리자 화면 전체가 읽기 전용.
 *
 * **막지 못하는 것**: 서버 모드의 스냅샷 쓰기는 통째 쓰기라(28-72), `manager`와 `owner`를
 * **서버가 구별하지 못한다** — 매니저가 화면을 우회해 직접 PUT 하면 파기·복원도 막지 못한다.
 * 그것은 엔티티 단위 API가 생겨야 막힌다(계속 이월). 여기서 그 이상을 주장하지 않는다.
 */
export type AdminGrade = 'owner' | 'manager' | 'viewer'

export const ADMIN_GRADES: readonly AdminGrade[] = ['owner', 'manager', 'viewer']

export const ADMIN_GRADE_LABEL: Record<AdminGrade, string> = {
  owner: '소유자',
  manager: '매니저',
  viewer: '열람',
}

/** 관리자가 하는 일의 종류 — 버튼·op 가 이 이름으로 묻는다 */
export type AdminAction =
  | 'view' // 현황·목록·기록 열람
  | 'operate' // 승인·거절·정지·환불·지급·분쟁·리뷰·요청 상태
  | 'editSettings' // 문구·FAQ·패키지·질문·카테고리·홈페이지 배치
  | 'exportBackup' // 백업 내려받기
  | 'destructive' // 복원·파기·시연 삭제·보관함 비우기
  | 'manageAdmins' // 관리자 계정 추가·등급·제거·비밀번호 초기화

const RANK: Record<AdminGrade, number> = { viewer: 0, manager: 1, owner: 2 }

/** 행위마다 필요한 최소 등급 */
export const ADMIN_MIN_GRADE: Record<AdminAction, AdminGrade> = {
  view: 'viewer',
  operate: 'manager',
  editSettings: 'manager',
  exportBackup: 'manager',
  destructive: 'owner',
  manageAdmins: 'owner',
}

/** 등급이 없으면(구 세션·비관리자) 아무것도 못 한다 — 열람도 */
export function canAdmin(grade: AdminGrade | undefined, action: AdminAction): boolean {
  if (grade === undefined) return false
  return RANK[grade] >= RANK[ADMIN_MIN_GRADE[action]]
}

export function isAdminGrade(v: unknown): v is AdminGrade {
  return v === 'owner' || v === 'manager' || v === 'viewer'
}

/** 관리자 아이디 규칙 — 영문 소문자·숫자·`-`·`_`, 3~20자 */
export const ADMIN_ID_RE = /^[a-z0-9][a-z0-9_-]{2,19}$/
