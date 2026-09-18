/**
 * 서비스 카탈로그 (28-92, 참고 v12 `lib/catalog.ts` 대조).
 *
 * 28-16의 카테고리 13개는 "홈페이지 시안 그리드"였다 — 도배·장판·욕실처럼 **부위** 이름이라, 냉난방·가전 설치·
 * 리모델링·철거·청소처럼 실제로 들어오는 요청의 절반이 '기타'로 떨어졌다. 참고 시안은 접수 분야를 **5 그룹 / 19 분야 +
 * "분야를 모르겠어요"** 로 두고, 코드는 고정한 채 라벨만 사람이 읽게 했다.
 *
 * 여기서 **식별자는 라벨(한국어)** 이다 — 이 저장소의 데이터(요청·패키지·질문·전문 분야·비활성 목록)가 28-16부터
 * 라벨을 저장해 왔기 때문에, 코드로 바꾸면 스냅샷 전체를 옮겨야 한다. 대신 참고안의 코드를 `code`로 나란히 두어
 * 뒤 라운드(안전 검토 28-93, 라우팅)가 코드로 판단할 수 있게 한다. 옛 13개 라벨은 `LEGACY_CATEGORY_MAP`으로
 * 읽을 때 옮긴다(`normalizeCategory`).
 */
import { ALL_CATEGORIES, type RepairCategory } from './types'

export interface CatalogEntry {
  code: string
  label: RepairCategory
  /** 접수 안내 문구 — 무엇을 받는지 말하지, 무엇이든 된다고 보증하지 않는다 */
  desc: string
}

export const CATALOG: readonly CatalogEntry[] = [
  { code: 'PLUMBING', label: '급배수·누수·설비', desc: '수전·배수부터 배관 점검·교체까지' },
  { code: 'LOCK', label: '문·도어락', desc: '도어락, 손잡이, 문 수리·교체' },
  { code: 'ELECTRIC', label: '전기·조명', desc: '조명·스위치부터 전기 설비 개선까지' },
  { code: 'SCREEN', label: '방충망', desc: '방충망 교체·보수·설치' },
  { code: 'CURTAIN', label: '커튼·블라인드', desc: '일반·전동 제품 설치와 교체' },
  { code: 'FIXTURE', label: '생활·상업 시설 설치', desc: '선반, 수납, 욕실 소품, 각종 부착물' },
  { code: 'HVAC', label: '냉난방·환기', desc: '에어컨, 환기, 난방 관련 설치·개선' },
  { code: 'SMART_HOME', label: '스마트홈·보안', desc: '센서, 홈 IoT, 출입·보안 기기' },
  { code: 'APPLIANCE', label: '가전·기기 설치', desc: '가전 설치·이전·연결, 기기 교체' },
  { code: 'WALL_FINISH', label: '도배·도장·필름', desc: '벽지, 페인트, 인테리어 필름' },
  { code: 'FLOOR', label: '바닥·타일', desc: '장판, 마루, 타일 시공과 보수' },
  { code: 'CARPENTRY', label: '목공·가구', desc: '목공 보수, 가구 제작·설치·수정' },
  { code: 'WINDOW', label: '창호·유리', desc: '창호, 유리, 단열·기밀 개선' },
  { code: 'KITCHEN_BATH', label: '주방·욕실 공사', desc: '주방·욕실의 부분 교체부터 공간 개선까지' },
  { code: 'WATERPROOF', label: '방수·외부 보수', desc: '방수, 실리콘, 외부 누수·마감 보수' },
  { code: 'RENOVATION', label: '주거 리모델링', desc: '부분·전체 공사, 여러 공종을 함께 조율' },
  { code: 'COMMERCIAL', label: '매장·사무실 공사', desc: '상업공간 조성·변경·시설 개선' },
  { code: 'RESTORATION', label: '철거·원상복구', desc: '선택 철거, 임대공간 복구, 폐기물 처리 협의' },
  { code: 'MAINTENANCE', label: '청소·공간 관리', desc: '입주·이사 청소, 정기 시설 점검·관리' },
  { code: 'UNKNOWN', label: '분야를 모르겠어요', desc: '공간과 원하는 결과부터 상담' },
]

/** "분야를 모르겠어요" — 그룹 밖이고 늘 마지막이다 */
export const UNKNOWN_CATEGORY: RepairCategory = '분야를 모르겠어요'

export interface ServiceGroup {
  name: string
  labels: readonly RepairCategory[]
  description: string
}

export const SERVICE_GROUPS: readonly ServiceGroup[] = [
  {
    name: '설비·전기·기기',
    labels: ['급배수·누수·설비', '전기·조명', '냉난방·환기', '스마트홈·보안', '가전·기기 설치'],
    description: '물이 새는 곳부터 냉난방·전기·기기 설치까지',
  },
  {
    name: '문·창·가구',
    labels: ['문·도어락', '방충망', '커튼·블라인드', '목공·가구', '창호·유리'],
    description: '출입, 단열, 수납과 가구를 함께 개선',
  },
  {
    name: '인테리어·마감',
    labels: ['도배·도장·필름', '바닥·타일', '생활·상업 시설 설치'],
    description: '벽·바닥 마감과 생활·상업 시설 설치',
  },
  {
    name: '주거·상업공간 공사',
    labels: ['주방·욕실 공사', '주거 리모델링', '매장·사무실 공사'],
    description: '주방·욕실부터 주택, 매장, 사무실 공사까지',
  },
  {
    name: '복구·유지관리',
    labels: ['방수·외부 보수', '철거·원상복구', '청소·공간 관리'],
    description: '방수·원상복구와 청소·정기 관리',
  },
]

const BY_LABEL = new Map<string, CatalogEntry>(CATALOG.map((e) => [e.label, e]))

/** 라벨 → 카탈로그 항목. `ALL_CATEGORIES`의 모든 라벨이 여기 있다(`catalog.test`가 지킨다) — 없으면 UNKNOWN 항목 */
export function catalogEntry(label: RepairCategory): CatalogEntry {
  return BY_LABEL.get(label) ?? (CATALOG[CATALOG.length - 1] as CatalogEntry)
}

/** 라벨이 속한 그룹 이름 — "분야를 모르겠어요"는 그룹이 없다 */
export function groupOf(label: RepairCategory): string | undefined {
  return SERVICE_GROUPS.find((g) => g.labels.includes(label))?.name
}

/**
 * 28-16~28-91의 13개 라벨 → 28-92 라벨. 같은 이름은 그대로, 나뉘어 있던 것은 합친다(누수·수전·배수 → 급배수·누수·설비,
 * 장판·타일 → 바닥·타일). '기타'는 "분야를 모르겠어요"다 — 접수 뒤 상담으로 분야를 정하는 자리.
 */
export const LEGACY_CATEGORY_MAP: Readonly<Record<string, RepairCategory>> = {
  도배: '도배·도장·필름',
  장판: '바닥·타일',
  욕실: '주방·욕실 공사',
  '수전·배수': '급배수·누수·설비',
  타일: '바닥·타일',
  전기: '전기·조명',
  '문·도어락': '문·도어락',
  방충망: '방충망',
  목공: '목공·가구',
  스마트홈: '스마트홈·보안',
  누수: '급배수·누수·설비',
  창호: '창호·유리',
  기타: '분야를 모르겠어요',
}

/** 현재 라벨이면 그대로, 옛 라벨이면 옮겨서, 둘 다 아니면 undefined */
export function normalizeCategory(raw: unknown): RepairCategory | undefined {
  if (typeof raw !== 'string') return undefined
  const t = raw.trim()
  if ((ALL_CATEGORIES as readonly string[]).includes(t)) return t as RepairCategory
  return LEGACY_CATEGORY_MAP[t]
}

/**
 * 전국 17 시·도와 시·군·구 (28-92, 참고 v12 `lib/policy.ts`). 요청 지역은 `"시·도 시·군·구"` 한 문자열로 저장한다 —
 * 28-46의 매칭(`profileMatch`, 토큰 포함)과 28-64의 가명본 축약(시/도 + 시군구)이 그 모양을 이미 전제한다.
 */
export const DISTRICTS: Readonly<Record<string, readonly string[]>> = {
  서울: [
    '강남구',
    '강동구',
    '강북구',
    '강서구',
    '관악구',
    '광진구',
    '구로구',
    '금천구',
    '노원구',
    '도봉구',
    '동대문구',
    '동작구',
    '마포구',
    '서대문구',
    '서초구',
    '성동구',
    '성북구',
    '송파구',
    '양천구',
    '영등포구',
    '용산구',
    '은평구',
    '종로구',
    '중구',
    '중랑구',
  ],
  부산: [
    '강서구',
    '금정구',
    '기장군',
    '남구',
    '동구',
    '동래구',
    '부산진구',
    '북구',
    '사상구',
    '사하구',
    '서구',
    '수영구',
    '연제구',
    '영도구',
    '중구',
    '해운대구',
  ],
  대구: ['군위군', '남구', '달서구', '달성군', '동구', '북구', '서구', '수성구', '중구'],
  인천: ['강화군', '계양구', '남동구', '동구', '미추홀구', '부평구', '서구', '연수구', '옹진군', '중구'],
  광주: ['광산구', '남구', '동구', '북구', '서구'],
  대전: ['대덕구', '동구', '서구', '유성구', '중구'],
  울산: ['남구', '동구', '북구', '울주군', '중구'],
  세종: ['세종시'],
  경기: [
    '가평군',
    '고양시',
    '과천시',
    '광명시',
    '광주시',
    '구리시',
    '군포시',
    '김포시',
    '남양주시',
    '동두천시',
    '부천시',
    '성남시',
    '수원시',
    '시흥시',
    '안산시',
    '안성시',
    '안양시',
    '양주시',
    '양평군',
    '여주시',
    '연천군',
    '오산시',
    '용인시',
    '의왕시',
    '의정부시',
    '이천시',
    '파주시',
    '평택시',
    '포천시',
    '하남시',
    '화성시',
  ],
  강원: [
    '강릉시',
    '고성군',
    '동해시',
    '삼척시',
    '속초시',
    '양구군',
    '양양군',
    '영월군',
    '원주시',
    '인제군',
    '정선군',
    '철원군',
    '춘천시',
    '태백시',
    '평창군',
    '홍천군',
    '화천군',
    '횡성군',
  ],
  충북: ['괴산군', '단양군', '보은군', '영동군', '옥천군', '음성군', '제천시', '증평군', '진천군', '청주시', '충주시'],
  충남: [
    '계룡시',
    '공주시',
    '금산군',
    '논산시',
    '당진시',
    '보령시',
    '부여군',
    '서산시',
    '서천군',
    '아산시',
    '예산군',
    '천안시',
    '청양군',
    '태안군',
    '홍성군',
  ],
  전북: [
    '고창군',
    '군산시',
    '김제시',
    '남원시',
    '무주군',
    '부안군',
    '순창군',
    '완주군',
    '익산시',
    '임실군',
    '장수군',
    '전주시',
    '정읍시',
    '진안군',
  ],
  전남: [
    '강진군',
    '고흥군',
    '곡성군',
    '광양시',
    '구례군',
    '나주시',
    '담양군',
    '목포시',
    '무안군',
    '보성군',
    '순천시',
    '신안군',
    '여수시',
    '영광군',
    '영암군',
    '완도군',
    '장성군',
    '장흥군',
    '진도군',
    '함평군',
    '해남군',
    '화순군',
  ],
  경북: [
    '경산시',
    '경주시',
    '고령군',
    '구미시',
    '김천시',
    '문경시',
    '봉화군',
    '상주시',
    '성주군',
    '안동시',
    '영덕군',
    '영양군',
    '영주시',
    '영천시',
    '예천군',
    '울릉군',
    '울진군',
    '의성군',
    '청도군',
    '청송군',
    '칠곡군',
    '포항시',
  ],
  경남: [
    '거제시',
    '거창군',
    '고성군',
    '김해시',
    '남해군',
    '밀양시',
    '사천시',
    '산청군',
    '양산시',
    '의령군',
    '진주시',
    '창녕군',
    '창원시',
    '통영시',
    '하동군',
    '함안군',
    '함양군',
    '합천군',
  ],
  제주: ['서귀포시', '제주시'],
}

export const CITIES: readonly string[] = Object.keys(DISTRICTS)

export function formatRegion(city: string, district: string): string {
  return `${city} ${district}`
}

/** `"서울 강서구"` → `{ city, district }`. 목록 밖(자유 입력·옛 데이터)이면 undefined */
export function parseRegion(region: string): { city: string; district: string } | undefined {
  const [city, district, ...rest] = region.trim().split(/\s+/)
  if (city === undefined || district === undefined || rest.length > 0) return undefined
  const list = DISTRICTS[city]
  if (list === undefined || !list.includes(district)) return undefined
  return { city, district }
}
