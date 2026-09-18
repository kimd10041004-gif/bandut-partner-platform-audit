# 반듯집수리 파트너 — 디자인 시스템 정의 (28-13 신설)

이 문서는 **"우리 디자인이 무엇인가"** 를 정의하는 단일 참조점이다 (naver design-to-ui의
project-design-system 개념 차용). "어디를 고치나"는 `UI_가이드.md`가 답한다.
구조는 bear2u Design Prompt Generator의 프레임워크(Identity → Emotion → Component
Specs → Micro-interactions)를 차용했다.

---

## 1. Identity (아이덴티티)

- **서비스**: 반듯집수리 파트너 — 집수리 시공 파트너(업체)용 업무 플랫폼.
- **사용자**: 현장 파트너. 이동 중·현장에서 모바일로 확인, 사무실에서 데스크톱 정산.
- **성격**: 신뢰(견적·정산은 돈 문제) + 밀도(한 화면에서 업무 처리) + 절제된 세련됨.
- **금지 (28-18 강화)**: **그라데이션 전면 금지**, 색 아이콘 칩 나열, 가짜 아이콘(이니셜 마크), ✓ 텍스트 장식, 그림자 과다 — 당근 문법(플랫 서피스 + 헤어라인 + 타이포 우선, 강조색은 CTA에만)을 따른다.

## 2. Emotion (감정 목표)

| 화면 | 목표 감정 | 수단 |
|---|---|---|
| (고객) 홈 | 진행 상황이 투명하게 보이는 안심 | 히어로 + 요청별 스텝퍼, 상태 칩 |
| (고객) 견적함 | 결정에 필요한 정보가 전부 | 공급가·부가세·합계 분해, 파트너 메시지 |
| (관리자) 현황 | 플랫폼이 건강한지 한눈에 | 수수료 수익 대형 표기, 상태 분포 |
| (파트너) 대시보드 | "오늘 할 일이 한눈에" + 환영감 | 히어로 인사말(업체명·날짜), 대형 지표 타이포 |
| 일감/입찰 | 기회를 놓치지 않는 긴장감 | D-day 강조색, 상태 칩, 검색·필터 즉답 |
| 일정 | 충돌 없는 안정감 | 슬롯 충돌 즉시 오류, 오늘 일정 우선 노출 |
| 정산 | 투명함 | 수수료·VAT 분해 표기, 정수 원 단위 |

## 3. 토큰 구조 (seed-design 2계층, `src/styles/tokens.css`)

**규칙: 컴포넌트 CSS는 시맨틱 계층만 참조한다. 팔레트 직접 참조 금지.**

- **1계층 팔레트** `--palette-*`: 원색 스케일. 리브랜딩은 이 계층만 교체.
- **2계층 시맨틱**: 용도 이름. (28-12~28-89의 다크 오버라이드는 28-90에서 제거 — 라이트 단일.)

### 팔레트 → 시맨틱 매핑 표 (라이트 기준)

| 시맨틱 | 팔레트 | 값 | 용도 |
|---|---|---|---|
| `--brand` | `--palette-teal-600` | #15695a | 주 브랜드, 주요 버튼, 활성 탭 |
| `--brand-strong` | `--palette-teal-700` | #0e5347 | 버튼 hover/press |
| `--brand-soft` | `--palette-teal-100` | #e3f1ed | 브랜드 배경 칩 |
| `--navy-900/800/700` | `--palette-navy-*` | #0a1f36… | 헤더, 섹션 제목 |
| `--bg` | `--palette-gray-50` | #f5f6f8 | 페이지 배경 |
| `--card` | `--palette-gray-0` | #ffffff | 카드/표 배경 |
| `--surface-2` | `--palette-gray-25` | #fafbfc | 보조 서피스(표 헤더) |
| `--ink` / `--ink-2` | `--palette-gray-900/700` | #17212e… | 본문/보조 텍스트 |
| `--muted` | `--palette-gray-500` | #6b7787 | 메타 텍스트 |
| `--line` / `--line-strong` | `--palette-gray-200/300` | #e5e9ef… | 구분선/입력 테두리 |
| `--st-blue(-bg)` | `--palette-blue-600/100` | #2360d8… | 진행 전 상태(요청/견적) |
| `--st-green(-bg)` | `--palette-green-700/100` | #177245… | 긍정 상태(수락/완료) |
| `--st-amber(-bg)` | `--palette-amber-700/100` | #a85b0a… | 주의 상태(진행 중, D-day 임박) |
| `--st-red(-bg)` | `--palette-red-700/100` | #b32424… | 부정 상태(유찰/취소/오류) |
| `--st-gray(-bg)` | `--palette-slate-500/100` | #66707d… | 종결 상태(정산/취소) |

파생 토큰(팔레트 비참조): `--brand-glow`(포커스 링), `--shadow-1/2`, `--tabs-bg`,
`--field-bg`, `--danger-border` — 값 정의는 tokens.css 참조.

### 시안 상태 가이드 매핑

시안의 상태 색 규칙 → 칩 클래스: `st-requested/estimated`=blue, `st-accepted/completed`=green,
`st-scheduled`=brand, `st-in_progress`=amber, `st-lost`=red, `st-settled/cancelled`=gray.

## 4. 타이포그래피

- **폰트**: Pretendard (한국 서비스 표준, Inter 회피). 숫자는 `tabular-nums` 권장.
- **스케일** (tokens.css): caption 12 / body 13.5 / title 15 / head 18 / display 23px.
- **간격 스케일** (28-13-01): `--sp-1..6` = 4/8/12/16/20/24px. 여백은 스케일 우선, 컴포넌트 고유 미세값(홀수 px)만 잔류.
- **예외적 대형**: 대시보드 히어로 인사말 `clamp(22px, 4.6vw, 30px)` — 스케일 밖 유일 허용.
- 자간: 제목류 -0.02em~-0.03em (대형일수록 좁게).

## 5. Component Specs (컴포넌트 인벤토리·레시피)

| 컴포넌트 | 클래스/파일 | 레시피 |
|---|---|---|
| 지표 타일 | `Stat` 부품 (`.stat`) | 라벨(캡션·muted) + display 숫자(ink), accent만 브랜드 — 아이콘 없음 (28-18-02) |
| 카드 | `Card` 부품 (`.card`) | `--card` 배경 + 보더 1px, 그림자 없음, hover=보더 강조 (28-18-05) |
| 상태 칩 | `.chip.st-*` | 상태색 bg/fg + 점 마커, caption 굵게 |
| 배지 | `.badge` | gray-bg 칩 (수량 표기) |
| 버튼 | `button` | brand 배경, hover=strong, press 스케일 0.98 |
| 필터 그룹 | `.filter-group` | 카드형 토글, active=brand 채움 |
| 폼 | `.form` | 2열 그리드(560px 이하 1열), label=caption |
| 표 | `.table-wrap table` | 헤더=surface-2, 행 hover 하이라이트 |
| 툴바 | `.toolbar` | 검색 input + 카테고리 select |
| 빈 상태 | `.empty` | 아이콘 + 안내 문구 (0건과 "검색 결과 없음" 구분) |
| 히어로 | `.hero` | 날짜(caption·muted) + 인사말(대형·ink) |
| 탭바 | `.tabs` | 데스크톱 상단/모바일 하단 고정, `--tabs-bg` 블러 |
| 앱 뱃지·전환 링크 | `.app-badge` / `.quiet-link` / `.entry-links` | 파트너·관리자 헤더 뱃지 + 고객 홈 복귀, 랜딩 하단 사업자 진입 (28-20-02) |
| 거래 타임라인 | `Timeline` 부품 (`.timeline`) | 세로 도트+연결선, done=브랜드 채움 (28-15-03) |
| 히어로 XL(홈) | `.hero-xl` | 배경 장식 없음 — 초대형 잉크 타이포 clamp(32~54px), CTA만 브랜드 (28-18-01) |
| 카테고리 칩 | `.cat-card` | 텍스트 필(pill), hover=잉크 보더, 선택=브랜드 (28-18-03) |
| 위저드 스텝 | `.wz-step` | 알약 스텝퍼: now=브랜드, done=green (28-16-02) |
| 별점 | `Stars` 부품 (`.stars`) + `.star-pick` | amber 채움/line 흐림, 선택은 24px 버튼 (28-17) |
| 리스트 행 | `.list-row` | 제목 14/600 + 보조 12.8 muted + 우측 값, 헤어라인 구분 (28-18-04) |
| 토글 스위치 | `.toggle` | 40×23 알약, on=브랜드 (28-21-02) |
| 공지 배너 | `.notice-band` | 브랜드 소프트 배경, 운영 설정 notice 노출 (28-21-03) |
| FAQ 아코디언 | `.faq-item` | details/summary, Q. 접두는 브랜드 (28-21-03) |
| 접수 태그·상태 | `.claim-tag.as/dispute` · `.claim-status.open/in_review/resolved` | A/S=blue·분쟁=red / amber→blue→green (28-22) |
| 추가 작업 상태 | `.extra-status.pending/approved/rejected` | amber/green/red 배경 알약 (28-15-01) |

새 컴포넌트는 이 표에 행 추가 + `src/ui/primitives.tsx` 또는 feature 파일에 구현.

## 5.5 브랜드 이미지 (28-23-04)

- 에셋은 `public/brand/`에 **웹 최적화본만** 커밋(원본 금지, 총 500KB 이하 유지): logo-mark/favicon(심볼), hero-main, svc-care/iot/bnb(장면 크롭 — 텍스트 포함 원본 상단은 사용하지 않는다).
- 사용 규칙: 라운드 처리(`--radius`) + `object-fit: cover` + 보더 1px, 카드 상단 이미지는 4:3. 이미지 위 오버레이 금지.

## 6. Micro-interactions (모션 규칙)

- 전환 시간은 모션 토큰으로만: `--dur-press`(0.12s)/`--dur-fast`(0.15s)/`--dur-base`(0.18s)/`--dur-slow`(0.2s), ease. 이동은 1~2px 이내(리프트), 스케일은 0.98(프레스)만.
- hover: 그림자 승격(shadow-1→2) + 테두리 강조. focus: `--brand-glow` 3px 링.
- 스피너·스켈레톤·페이지 전환 애니메이션은 도입하지 않음(로컬 데이터라 불필요).

## 7. 다크 모드 — 없음 (28-90)

28-12에 넣었던 이중 정의(`[data-theme='dark']` + `prefers-color-scheme`)는 참고 v12 대조에서 **제거**했다.
라이트 단일 테마이고, 배경 실측 기준은 rgb(245,246,248). 새 색은 `tokens.css`의 `:root` 한 곳에만 둔다.
`scripts/visual-check.mjs`는 라이트 배경 픽셀만 검증한다.

## 8. 품질 게이트 (design-qa 차용)

- `node scripts/visual-check.mjs` — 주요 탭 스크린샷 + 라이트 배경 픽셀 검증.
  라운드 검증(검증결과.md)의 공식 도구. 실패 시 비정상 종료.
- 토큰 변경 시: 팔레트만 바꿨는지(리브랜딩) / 시맨틱만 바꿨는지(용도 변경) 명시할 것.
