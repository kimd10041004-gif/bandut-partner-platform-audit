# UI 관리 가이드 (28-11 기초)

이 문서는 "어디를 고치면 되는가"의 단일 기준이다. UI 작업은 아래 세 지점에서만 일어난다.
"우리 디자인이 무엇인가"(아이덴티티·매핑·레시피·모션)는 `docs/DESIGN_SYSTEM.md`가 답한다 (28-13).

## 1. 폴더 구조 (종합 틀)

```
src/
├─ app/                 앱 계층
│  ├─ PlatformContext.tsx   플랫폼 상태 공급 (usePlatform 훅)
│  └─ bootstrap.ts          저장소 감지·시드·초기화
├─ ui/                  공용 UI 계층 (재사용 컴포넌트·상수)
│  ├─ icons.tsx             Icon + ICON 경로 세트
│  ├─ primitives.tsx        Card · Stat · Timeline · Stars · StatusChip · WorkStepper · EmptyState · Dday
│  ├─ OverwrittenBox.tsx    덮인 변경 보관함 (관리자 설정 · 파트너/고객 마이페이지 공용)
│  ├─ ApprovalBanner.tsx    파트너 승인 상태 배너 (대시보드 · 일감 공용)
│  ├─ constants.ts          STATUS_LABEL · CATEGORIES · PARTNER_ID
│  └─ format.ts             krw · isKnownError
├─ features/            화면 계층 (탭 1개 = 파일 1개)
│  ├─ landing/              퍼블릭 홈페이지 (28-16-01): Landing — 앱 최초 진입 화면
│  ├─ (파트너) Dashboard.tsx · Jobs.tsx · Work.tsx · Schedule.tsx · Settlement.tsx · MyProfile.tsx
│  ├─ customer/             고객 화면 (28-14-02): CustomerHome · CustomerRequest · CustomerEstimates
│  └─ admin/                관리자 화면 (28-14-03): AdminOverview · AdminRequests · AdminSettlement · AdminReviews · AdminClaims · AdminSettings
├─ styles/              스타일 계층
│  ├─ tokens.css            디자인 토큰 (색·타입 스케일·형태) ← 브랜드 변경은 여기만
│  ├─ base.css              리셋·바디·레이아웃
│  └─ components.css        컴포넌트별 스타일 (섹션 주석 단위)
├─ domain/              비즈니스 로직 (UI와 완전 분리, 전량 테스트됨)
└─ App.tsx              셸: 헤더 + TABS 배열 + 활성 화면 렌더
```

## 2. 자주 하는 작업별 위치

| 하고 싶은 것 | 고치는 곳 |
|---|---|
| 브랜드 색·상태 색·글자 크기·라운드 변경 | `styles/tokens.css` (한 파일) — 리브랜딩=팔레트 계층, 용도 변경=시맨틱 계층 (28-13 2계층) |
| UI 변경 후 시각 검증 | `npm run build && npm run visual-check` (배경·브랜드색 실측 + 전 탭 스크린샷) |
| 전 여정 실사용 검증 | `npm run build && npm run e2e` — 고객→파트너→관리자 22단계 + 모바일 점검 (28-19-03) |
| 커밋 전 품질 게이트 | `npm run check` = typecheck → vitest → node --test → build (28-13-05) |
| 카드/지표 타일 추가 | `ui/primitives.tsx`의 `Card`/`Stat` 부품 사용 — 원시 `<div className="card">` 반복 금지 (28-13-02) |
| 여백·전환 시간 변경 | tokens.css `--sp-*`(4/8/12/16/20/24px)·`--dur-*` 토큰 (28-13-01) — 컴포넌트 고유 미세값만 px 잔류 |
| 버튼/카드/칩/표 등 공용 룩 변경 | `styles/components.css` 해당 섹션 |
| 상태 한국어 라벨 변경 | `ui/constants.ts` STATUS_LABEL |
| 아이콘 추가 | `ui/icons.tsx` ICON에 path 추가 |
| 특정 탭 화면 수정 | `features/<탭>.tsx` 한 파일 |
| **새 탭 추가** | ① `features/<앱 폴더>/새화면.tsx` 생성(usePlatform 훅 사용) ② `App.tsx`의 `APPS`에서 해당 앱 `tabs` 배열에 한 줄 추가 — 끝 |
| **새 앱(목적자) 추가** | ① `features/<앱>/` 폴더에 화면 생성 ② `App.tsx`의 `APPS` 배열에 항목 1개(hash+badge+tabs) 추가 — 해시 라우팅·탭바·오류 격리는 자동 (28-20-01) |
| 플랫폼 데이터 접근 | 컴포넌트 안에서 `const { platform, refresh } = usePlatform()` — 프롭 전달 금지 |
| 시드 데이터 변경 | `app/bootstrap.ts` |

## 2.5 코드 vs 운영 설정 — 유지보수 경계 (28-21-05)

| 바꾸고 싶은 것 | 어디서 |
|---|---|
| 히어로·서브 문구, 공지 배너, FAQ, 노출 카테고리 | **관리자 콘솔 → 설정 탭** (코드 수정 불필요, 즉시 반영) |
| 색·여백·모션·부품 룩, 새 화면/탭/앱 | 코드 (tokens.css·components.css·features/) |
| 수수료율·상태 전이 등 정책 | 도메인 코드 (테스트 필수) — 운영 설정으로 노출하지 않음 |

## 3. 규칙

- **features는 domain을 직접 수정하지 않는다** — 반드시 `platform.*` 메서드 경유 (변경 후 `refresh()` 호출).
- **공용으로 두 번 쓰이는 UI 조각은 `ui/`로 승격**한다. 화면 전용 조각은 해당 feature 파일 안에 둔다.
  이 규칙은 `src/ui/structure.test.ts`가 **검사한다** — `features/` 안의 조각을 `features/`의 서로 다른
  파일 둘 이상이 가져다 쓰면 테스트가 실패하고, 어떤 조각을 누가 쓰는지 이름을 대 준다 (28-76 리뷰).
- **색·크기 하드코딩 금지** — tokens.css 변수 사용. 여백·전환 시간도 `--sp-*`/`--dur-*` 스케일 우선(스케일 밖 미세값만 px 허용).
- 오류 표시는 `isKnownError()`로 판별된 도메인 오류만 메시지로 노출, 나머지는 rethrow.
- 도메인(domain/)은 UI 없이 테스트된다 — UI 라운드에서 domain을 건드리지 않으면 테스트 전체가 회귀 안전망.
- 예상외 오류는 `app/ErrorBoundary.tsx`가 탭 단위로 격리한다 — 화면 코드는 도메인 오류만 `isKnownError()`로 처리하면 된다 (28-13-03).

## 결제와 상용 전환 (28-29)

현재 결제는 **도메인 규칙까지 상용 수준, 실행만 시뮬레이션**이다:

- 규칙(그대로 유지됨): 예약금은 낙찰(accepted)에서만·낙찰가 10%(최소 1만원)·중복 불가 / 최종 결제는 완료(completed)에서만·최종 금액−예약금 / **최종 결제 없이는 정산 불가**(`settle()`이 거부).
- 실행(교체 지점): `PlatformService.payDeposit()` / `payFinal()`의 몸통. 상용 전환 시 이 두 호출부(고객 거래 상세의 "결제하기" 버튼)가 **토스페이먼츠 결제창**을 띄우고, **서버의 승인 콜백**(결제 승인 API 검증 후)이 같은 `recordPayment()` 레코드를 만든다. UI·정산·영수증·타임라인은 수정 없이 동작한다.
- 상용화 잔여(별도 인프라 필요): ① PG 가맹 계약 + 서버(결제 승인·웹훅 검증) ② 회원/인증(고객·파트너 계정 분리) ③ 공유 DB(현재 localStorage 스냅샷 → 서버 저장소로 이관 — `PlatformSnapshot` 스키마가 그대로 이관 단위).

## 역할별 주소 (28-30)

세 목적자는 각자 대표 주소로 바로 진입한다 (Vercel rewrite + 부트 시 경로→해시 번역):

| 대상 | 주소 | 화면 |
|---|---|---|
| 고객 | `/` | 홈페이지(랜딩) → 수리 요청·견적함 |
| 파트너 | `/partner` | 파트너 센터 (대시보드~마이, 6탭) |
| 관리자 | `/admin` | 관리자 콘솔 (현황~설정, 6탭) |

끝 슬래시(`/partner/`)도 동작. 내부 이동은 해시(`#/partner`) 방식을 유지한다 — 리로드 없는 전환.

## 로그인·인증 (28-31)

- **랜딩(홈페이지)은 공개**, 앱 기능은 역할별 로그인 게이트 뒤: 고객(수리 요청·견적함·거래 상세), 파트너 센터, 관리자 콘솔.
- **고객·파트너 가입**: 이름 / 휴대폰(010, 10~11자리) / 비밀번호(8자 이상) / 파트너는 사업자등록번호(10자리) → **6자리 OTP 인증** 후 로그인 가능(미인증 로그인 거부). 같은 브라우저에서 역할별 세션 독립(고객+파트너+관리자 동시 시연 가능).
- **관리자**: 가입 없음. 문은 `/login/admin` 한 자리뿐이다(29-10). 아이디는 `admin`, 비밀번호는 `ADMIN_PASSWORD` 환경변수로만 둔다 — 값은 이 저장소에 적지 않는다. 옛 SPA(로컬 모드)의 시연용 시드 비밀번호는 서버가 거부한다.
- **상용 전환 교체 지점**: ① OTP — 현재 `register()`가 코드를 반환해 화면 표시(시연) → 서버가 SMS 발송, `verifyOtp()`는 서버 검증 호출로 교체. ② 비밀번호 — 현재 데모 저장 → 서버 해시(bcrypt)로 대체. ③ 세션 — localStorage → 서버 세션/JWT. 규칙(형식 검증·미인증 거부·역할 분리)은 그대로 유지된다.

## 계정 관리 (28-34)

- **마이페이지**: 고객 "마이" 탭 / 파트너 "마이" 탭 상단 — 내 정보(이름·휴대폰·가입일·인증, 파트너는 사업자등록번호) + 비밀번호 변경(현재 확인·8자·동일 금지).
- **관리자 "회원" 탭**: 고객·파트너 계정 테이블(역할 필·인증·가입일·상태) + **정지/해제** — 정지 시 해당 역할의 활성 세션 즉시 종료, 이후 로그인 거부("정지된 계정입니다"). 관리자 비밀번호도 `changePassword('admin', …)`로 교체 가능(시드 비밀번호 교체 권장).

## 파트너 승인 (28-35, 시안 4)

- 파트너는 가입 시 **승인 대기**(`approval: 'pending'`). 대시보드·일감 탭 상단에 상태 배너, **입찰 폼·버튼 비활성**. 관리자 "회원" 탭에서 **승인** 또는 **거절(사유 필수)** — 거절된 파트너는 로그인해 사유를 볼 수 있으나 입찰은 불가. 고객 계정은 승인 대상이 아니다.

## 알림 센터 (28-36)

- 도메인 액션이 역할별 `AppNotification`을 생성(견적 도착·낙찰/미낙찰·방문 확정·추가 작업 요청/결정·작업 완료·예약금/최종 결제·리뷰·분쟁 접수/처리). 헤더 벨에 미읽음 수, 패널을 열면 전부 읽음 처리. 채팅은 별도 뱃지(28-28) 유지.
- 상용 전환 시 같은 이벤트를 서버 푸시/카카오 알림톡으로 확장 — 생성 지점은 `PlatformService.notify()` 단일 경계.

## 파트너 유형·사업자 조회 (28-37)

- 파트너 가입 시 **사업자 / 개인** 유형 필 선택(필수). **사업자**는 사업자등록번호(10자리)를 입력하고 **사업자 정보 조회**를 통과해야 가입된다(실패 시 "사업자 정보 조회에 실패했습니다"). **개인**은 번호 없이 가입.
- 조회 검증: 국세청 사업자등록번호 검증번호 규칙(가중치 1·3·7·1·3·7·1·3·5 + 9번째 자리×5의 십의 자리, 마지막 자리 = 10−합 mod 10). 같은 숫자 반복 번호 거부. 통과한 계정은 `bizVerified: true`.
- 표기: 관리자 "회원" 탭 **유형** 컬럼(사업자/개인 태그) + **사업자 조회** 컬럼(통과/미조회/해당 없음), 마이페이지 "파트너 유형"·"사업자 정보 조회" 행.
- 상용 전환 교체 지점: `verifyBusiness(bizNo)` 한 함수 — 국세청 사업자등록정보 진위확인 API(휴·폐업 상태 포함) 호출로 교체하면 UI·검증 흐름은 그대로 유지된다.

## 약관·개인정보 동의 (28-38)

- 가입 폼에 **전체 동의 / [필수] 이용약관 / [필수] 개인정보 수집·이용 / [선택] 마케팅 수신** 체크박스 + "보기"(본문 인라인). 필수 미동의 시 `register()`가 거부("필수 약관에 동의해 주세요"). 동의 일시는 `Account.consent { termsAt, privacyAt, marketing, marketingAt? }`에 기록.
- **마이페이지 "동의 내역"**: 필수 동의일 표시, 마케팅 수신 토글(`setMarketingOptIn`) — 철회 일시 기록.
- **약관 본문은 운영 설정**(`SiteSettings.terms/privacy`): 관리자 "설정" 탭에서 편집·기본값 복원, 빈 본문 거부. 랜딩 **푸터**(이용약관 · 개인정보처리방침)에서 로그인 없이 열람.
- 기본 본문은 시연용 초안 — 상용 개통 전 법무 검토본으로 교체하고, 통신판매업 신고번호·사업자 정보를 푸터에 표기한다.

## 정산 계좌·지급 (28-39)

- 파트너 "정산" 탭 상단 **정산 계좌** 카드: 은행·계좌번호(숫자 10~14자리)·예금주 등록/수정, 마스킹 표기(앞 3·뒤 3자리). **28-90:** 예금주는 가입한 이름과 같아야 저장된다(공백 무시), 계좌를 바꾸면 인증이 풀린다(`data-payout-verified="yes|no"` + 인증됨/인증 대기 태그). 미등록 시 배너("정산 계좌를 등록해야 지급됩니다"). **작업별 지급 상태** 표(미정산 / 확정·지급 대기 / 지급 완료·지급일).
- 관리자 "정산 감독" 탭 **지급 대기**(정산 확정 & 미지급) → "지급 완료" 버튼: `markPayout()`은 정산 확정 전·계좌 미등록·중복 지급을 거부하고 `CompletedJob.payout { paidAt, amount, account }`를 남기며 파트너에게 알림("정산금 지급 완료"). **지급 완료** 목록에 지급일·금액·계좌.
- 돈의 경로: 고객 예약금·최종 결제(28-29) → 정산 확정(settle, 최종 결제 필수) → 지급 완료(payout, 계좌 필수). 상용 전환 시 "지급 완료" 버튼이 펌뱅킹/PG 지급 API 호출 결과로 대체되며, 도메인 규칙은 그대로 유지된다.

## 회원 탈퇴·파기 (28-40)

- 마이페이지 하단 **회원 탈퇴** 카드: 안내(즉시 파기 항목 / 법정 보관 항목·기간) + 비밀번호 확인 + 동의 체크 → `withdraw()`. 탈퇴 즉시 이름→"탈퇴 회원", 휴대폰·비밀번호·사업자번호·정산 계좌 제거, `withdrawnAt` 기록, 세션 종료, 게이트에 1회 안내. 같은 휴대폰으로 재가입 가능, 탈퇴 계정은 로그인 불가.
- **차단 규칙**: 고객은 진행 중 거래(수락~시공 중, 완료 후 미결제)가 있으면, 파트너는 진행 중 작업 또는 지급 대기 정산이 있으면 탈퇴 불가. 고객 탈퇴 시 `anonymizeCustomer()`로 요청 표시명을 비식별화(거래·결제 기록은 보존).
- 관리자 "회원" 탭: **탈퇴** 필터·태그(탈퇴일)·휴대폰 "파기됨", **파기** 버튼(`purgeAccount`, 탈퇴 계정만) — 전자상거래법 보관 기간(거래 5년·분쟁 3년) 경과 후 실행. 상용 전환 시 보관 기간 만료 자동 파기 배치로 확장.

## 의존성·보안 위생 (28-41)

- 개발 의존성 메이저 업그레이드: vite 6→**7**, vitest 2→**4**, @vitejs/plugin-react 4→**5** — `npm audit`(전체) 0건. 런타임 의존성은 react/react-dom뿐(원래 0건). `npm run audit`(`--audit-level=high`)를 검증 절차에 포함.
- 배포 응답 헤더(`vercel.json` `headers`): `X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy`(camera·microphone·geolocation 차단) · `Content-Security-Policy`(self + inline style, 이미지 self/data, **Pretendard 폰트 CDN `cdn.jsdelivr.net`은 style/font-src에 허용** — 누락 시 폰트가 차단되므로 폰트를 셀프 호스팅으로 옮기기 전까지 유지). `vite preview`는 이 헤더를 적용하지 않으므로 프로덕션 확인은 `curl -I https://bandut-partner-platform.vercel.app`로 한다.
- 라운드 폴더는 감사 아카이브이며 배포 대상은 `vercel.json`이 가리키는 최신 폴더 하나뿐 — 과거 폴더의 Dependabot 알림은 아카이브로 간주한다(README 정책, `.github/dependabot.yml`은 최신 폴더만 등록).

## 파트너 범위 분리 (28-42)

- 견적·슬롯·작업의 `partnerId`는 **로그인한 파트너 계정 id**(`AuthSession.accountId`, `usePartnerId()`). 시드 이력만 데모 파트너 `P-001`(`PlatformService.SEED_PARTNER_ID`).
- `PlatformService` 파트너 범위 조회: `partnerOf(requestId)` / `partnerRequests` / `bidStats(partnerId)` / `statusCounts(partnerId)` / `settlements(filter, partnerId)` / `unsettledPayout` / `monthlyReport` / `monthSummary` / `completedJobsOf` / `reviewStats` / `allReviews` / `upcomingSlots(from, n, partnerId)` / `partnerHasOpenWork(partnerId)` — 인자 생략 시 전체(관리자·랜딩). 파트너 알림도 계정 범위(요청의 견적 파트너).
- 프로필은 파트너별(`profiles` Map, 구 스냅샷의 단일 `profile`은 P-001로 이전). 고객 업체 카드(`PartnerCard requestId`)는 그 요청의 견적 파트너를 보여준다.
- 파트너 센터 6탭 전부 범위 적용: 일감 탭은 "입찰 가능(requested) + 내 입찰"만(타 파트너 견적 건 제외). 관리자 지급 처리는 `job.partnerId`로 계정을 찾아 계좌를 쓴다. 다중 입찰 비교(요청 1건에 견적 여러 개)는 28-43.

## 다중 입찰 (28-43)

- 견적은 **요청 × 파트너**로 저장(`bids`), 파트너별 1건(재제출은 교체). `bidsFor(requestId)`(금액순) / `bidOf` / `bidCount`. 스냅샷 `estimates`는 같은 requestId 항목이 여러 개 — 구 스냅샷(1건)은 그대로 읽힌다.
- 고객 견적함은 요청별로 받은 견적 전부를 **금액 오름차순 카드**(`.bid-card`, 최저가 태그·최저가 대비 차액)로 보여주고 "이 견적 수락"(`acceptBid`) / "전체 거절". 수락 시 `acceptedPartnerId` 기록, 낙찰 파트너 알림 + 나머지 입찰자 **각자** 미낙찰 알림(알림 `accountId` 범위).
- 일정·완료·결제·타임라인·정산은 **낙찰 견적**(`primaryBid`) 기준. 낙찰 전 다중 입찰 상태에서는 대표 견적이 없다(`getEstimate` undefined) — 구 데이터처럼 입찰이 1건이면 그 견적으로 폴백. `transitionRequest(…, 'accepted')`는 입찰 1건일 때만 하위 호환.
- 파트너 일감 탭은 낙찰 전 요청 전부(타 파트너가 먼저 견적해도 입찰 가능) + "입찰 n건 · 내 입찰 완료/아직 입찰 가능". 내 작업 탭은 내 입찰 건 중 결정된 건이며, 타 파트너에게 낙찰된 건은 `statusFor()`로 **미낙찰**(종결 필터)로 표시. `bidStats/statusCounts(partnerId)`도 같은 규칙.

## 입찰 마감 (28-44)

- 모든 요청에 마감일: 위저드 미입력 시 `defaultBidDeadline(희망일, 오늘)` = min(희망일−1, 오늘+3) ≥ 오늘. 과거 마감일은 `addRequest`가 거부. **마감 당일까지 입찰 가능**, 다음날부터 `submitEstimate`가 "입찰이 마감되었습니다"로 거부(`bidClosed`).
- `sweepDeadlines(today)` — 부트·고객 홈 진입 시 호출되는 멱등 정리: 마감 지난 낙찰 전 요청에 고객 알림 1회(견적 0건 → 연장/취소, n건 → 비교 선택), `deadlineNotifiedFor`로 중복 방지. `extendDeadline(requestId, 날짜)`는 낙찰 전·오늘 이후·현재 마감 이후만, 연장 시 플래그 초기화.
- 파트너 일감: 마감 지난 건은 "입찰 마감 — 고객 결정 대기" 태그 + 버튼 없음, 입찰 폼 후보 제외, 정렬 "마감 임박순". 고객 홈·거래 상세에 D-day, 마감 후 견적 0건이면 거래 상세에 **마감 연장** 폼.
- 시간은 도메인 메서드에 `today` 인자로 주입(테스트 결정성) — 상용 전환 시 `sweepDeadlines`를 서버 배치(일 1회)로 옮기면 된다.

## 운영 큐 (28-45)

- 관리자 "현황" 탭 최상단 **조치 필요** 카드(`.ops-card`, `data-ops` 그룹): 승인 대기 파트너(인증 완료·미승인, 바로 **승인**) · 입찰 마감 경과(견적 수·경과일) · 방문일 경과 시공 미시작 · 결제 지연(완료 후 미결제, 경과일·금액) · 미해결 분쟁 · 지급 대기(바로 **지급 완료**, 계좌 없거나 미인증이면 오류). 전부 0건이면 "오늘 처리할 항목이 없습니다".
- 도메인 `opsQueue(today)`가 목록·건수를 오래된 순으로 제공. `sweepPaymentReminders(today)`: 완료 후 **3일** 지나도 최종 결제가 없으면 고객·관리자 알림 1회(`paymentReminderFor` 멱등). `sweepDeadlines`는 견적 0건 마감 경과를 관리자에게도 알린다. 두 정리는 부트·고객 홈·관리자 현황 진입 시 호출.
- 상용 전환: 두 sweep을 서버 일일 배치로, 조치 필요 카드는 운영 백오피스 첫 화면으로 유지.

## 취소·환불 (28-46)

- 예약금이 결제된 요청을 취소하면 `Refund`(pending)가 자동 생성된다: 방문 전 취소 = 전액, 방문일 경과 후 취소 = `afterVisit`(실비 차감 협의). 고객·관리자 알림. 최종 결제 후에는 취소 불가(전이 규칙).
- 관리자 현황 "조치 필요" **환불 대기** 그룹에서 `settleRefund(refundId, { deduction, reason })` — 방문 전 건은 차감 불가, 차감은 예약금 이하·사유 필수. 완료 시 고객 알림(+차감분 파트너 알림). 정산 감독 결제 현황에 취소 건 "환불" 열.
- 고객 거래 상세 **예약금 환불** 카드(`data-refund-status`): 환불 대기/완료·금액·차감·사유·처리일. 환불 대기 중인 고객은 탈퇴 불가(`openTransactionCount`).
- 상용 전환: `settleRefund`가 PG 부분/전액 취소 API 결과로 대체된다.

## 지역·분야 매칭 (28-47)

> 28-92: 분야는 카탈로그 20개, 지역은 17 시·도 select다. 매칭 규칙(분야 일치 AND 지역 토큰 포함)은 그대로다.

- `profileMatch(profile, request)`: 전문 분야(쉼표 구분 카테고리)에 요청 카테고리가 있고, 서비스 지역 토큰 중 하나가 요청 지역 문자열에 포함되면 매칭(지역 비면 전국, 분야 비면 매칭 없음). `parseTokens`로 파싱. `updateProfile`은 분야 토큰이 카테고리 목록에 있는지 검증. 기본 프로필의 분야·지역은 비움(화면은 "집수리 전반/서울 전역" 폴백).
- `addRequest`는 매칭 프로필 보유 파트너 전원에게 "내 지역·분야 새 일감" 알림(계정 범위). `matchedRequests(partnerId, today)`는 낙찰 전·마감 전 매칭 요청.
- 마이 탭 프로필: 전문 분야 **카테고리 필 다중 선택**(저장은 쉼표 문자열), 지역은 쉼표 입력. 일감 탭 "내 지역·분야만" 토글(분야 설정 시 기본 켜짐, 미설정 시 비활성) + "맞춤" 태그. 대시보드 "맞춤 일감 n건 / 전체 m".
- 상용 전환: 지역은 행정구역 코드 테이블로, 알림은 푸시로 교체 — 규칙은 `profileMatch` 한 함수.

## 운영 리포트 (28-48)

- `ledger(month?)`: 결제(예약금·최종, +)·환불(완료 건만, −)·파트너 지급(−)·플랫폼 수수료(정산 확정 작업, 완료일 기준)를 날짜순 건별 행으로. `ledgerMonths()`(최신순), `ledgerSummary(month?)`(입금·출금·수수료·순액·행 수), `partnerLedger(partnerId)`(내 완료 작업 총액·수수료·지급액·지급일·계좌).
- `domain/csv.ts` `toCsv(headers, rows)`: UTF-8 BOM + CRLF + RFC 4180 이스케이프(쉼표·따옴표·줄바꿈). `ui/download.ts` `downloadText`는 백업(JSON)·CSV 공용.
- 관리자 정산 감독 **월별 원장** 카드: 월 선택 → 요약 + 건별 표 + "CSV 내보내기"(`ledger-YYYY-MM.csv`). 파트너 정산 탭 "내 정산 내역 CSV"(`settlement-<partnerId>.csv`).
- 상용 전환: 같은 행 구조를 서버가 생성해 서명된 URL로 제공하면 UI는 그대로.

## 요청 사진 (28-49)

- `RepairRequest.photos?: RequestPhoto[]` — `{ id, dataUrl(JPEG/PNG data URL), width, height, bytes }`. 규칙(`validatePhotos`): 최대 `MAX_PHOTOS = 3`장, 장당 `MAX_PHOTO_BYTES = 200KB`, data URL·MIME·치수 검증, id 중복 거부 — `addRequest` 입력과 스냅샷 복원 모두. `addPhoto/removePhoto`는 낙찰 전만.
- `ui/image.ts` `resizeImageFile(file)`: 캔버스로 긴 변 960px 이하, JPEG 품질 0.8→0.35까지 낮춰 200KB 이하로. 위저드 1단계 "현장 사진" 파일 입력(`aria-label`) + `PhotoStrip` 미리보기/삭제, 4단계 확인 썸네일.
- `ui/PhotoStrip.tsx`(`.photo-thumb`, 클릭 확대): 파트너 일감·내 작업 카드, 고객 거래 상세, 관리자 요청 상세.
- 저장소 예산: 요청당 최대 600KB — localStorage(약 5MB)에서 수십 건 규모. 상용 전환 시 data URL 대신 오브젝트 스토리지 URL로 교체(타입은 `dataUrl` → `url`만 바꾸면 됨).

## 저장 용량·완료 사진 (28-50)

- `save()`는 boolean을 반환하고 실패를 `lastSaveError`에 기록·`onSaveError`로 통지한다(용량 초과는 안내 문구로 치환). `PlatformProvider`가 이를 받아 `saveError`로 노출, 앱 셸 `SaveErrorBanner`(`[data-save-error]`, role=alert)가 헤더 아래에 띄우고 다음 저장 성공 시 사라진다.
- `storageUsage()` → `{ chars, photoChars, photoCount, limit, ratio }`(직렬화 스냅샷 문자 수, localStorage는 UTF-16 문자 단위). 한도 `STORAGE_SOFT_LIMIT = 4M`(`PlatformOptions.storageLimit`). 사진을 늘리는 쓰기(`addRequest`·`addPhoto`·`setCompletionPhotos`)는 변경 전에 `assertRoom`으로 거부.
- `prunePhotos(today, retentionDays = PHOTO_RETENTION_DAYS(90))`: 정산 완료(완료일)·취소(환불 생성일, 없으면 요청 생성일) 후 보관 기간 경과 건의 현장·완료 사진 제거(멱등). 관리자 현황 진입 시 다른 sweep과 함께 실행 + **저장 용량 카드**(`[data-storage]`, 막대·사진 장수·"오래된 사진 정리" `[data-prune-photos]`).
- `RepairRequest.completionPhotos`: `setCompletionPhotos(requestId, partnerId, photos)` — 낙찰 파트너만, 시공 중~작업 완료(최종 결제 전). 파트너 내 작업 카드 "완료 사진" 입력(`aria-label`) + `PhotoStrip completion`(`[data-completion]`), 고객 거래 상세·관리자 거래 상세에 "시공 완료 사진".
- 상용 전환: 저장소가 서버로 가면 `storageUsage`는 사용자별 쿼터 API로, `prunePhotos`는 배치 작업으로 — 규칙(보관 90일·3장·200KB)은 도메인 상수 그대로.

## 파트너 철회·재오픈 (28-51)

- `PartnerCancel { id, requestId, partnerId, reason, date }`(스냅샷 `partnerCancels`). `withdrawAward(requestId, partnerId, reason, today)`: 낙찰 파트너만, `accepted`/`scheduled`에서만, 사유 필수. 그 파트너 입찰 제거·슬롯 해제·체크리스트 초기화·낙찰 해제 → 다른 입찰이 남으면 `estimated`, 없으면 `requested`로 재오픈(`store.reopen`, 전이표 밖 관리 전이) + 마감 오늘 기준 재설정. 예약금이 있으면 전액 환불 대기(사유 "파트너 철회"). 고객·관리자·다른 입찰자 알림.
- `paymentFor`는 환불이 걸린 결제를 제외한 최신 건(재낙찰 후 예약금 재결제 허용), `refundFor`는 최신 환불.
- `partnerCancels(partnerId?)`, `partnerCancelCount(partnerId, 90일, today)`, `partnerSummary().cancelCount` → 고객 `PartnerCard` "낙찰 후 취소 n회 (90일)"(`[data-cancel-count]`), 관리자 회원 탭 파트너 행. `opsQueue.frequentCancellers`(90일 내 2회 이상) → 현황 조치 필요 `data-ops="cancels"`.
- 파트너 내 작업 카드(낙찰·방문 예정) "낙찰 철회" → 사유(`aria-label="철회 사유"`) + "철회 확정". 고객 거래 상세 재오픈 배너(`[data-reopen-banner]`).
- 상용 전환: 철회 페널티(수수료·노출 순위)는 `partnerCancelCount`를 입력으로 하는 정책 함수 하나로 추가.

## 계정 보안 (28-52)

- `domain/hash.ts`: 의존성 없는 동기 SHA-256(`sha256Hex`, 알려진 벡터 테스트) + 솔트·반복 해시 `hashPassword(pw, salt, 2000)` → `s256$<iter>$<salt>$<hex>`, `verifyPassword`(전량 비교). `Account.passwordHash`, 관리자 `adminPasswordHash`. 구 스냅샷의 평문(`password`/`adminPassword`)은 로드 시 해시로 마이그레이션 후 저장. 뷰(`AccountView`)는 해시 제외, 탈퇴 시 빈 해시.
- 로그인 잠금: `LOGIN_MAX_FAILS = 5`, `LOGIN_LOCK_MS = 15분`, 키 = 역할+식별자(스냅샷 `loginFails`). 실패 메시지에 남은 시도, 잠금 중엔 맞는 비밀번호도 "N분 후 다시 시도". `lockRemainingMs`. 성공·해제 시 초기화. 관리자 동일.
- OTP: `{ code, issuedAt, attempts }`, `OTP_TTL_MS = 5분`(만료 → 재가입 안내), `OTP_MAX_ATTEMPTS = 5`(초과 → 폐기). 구 문자열 OTP는 로드 시각 기준으로 마이그레이션. `verifyOtp(..., now)`.
- 세션: `AuthSession.issuedAt/expiresAt`(`SESSION_TTL_MS` 고객·파트너 24h, 관리자 8h). `sessionFor(role, now)`가 만료 세션을 제거하고 게이트 안내("세션이 만료되어 다시 로그인해 주세요")를 남긴다 — 고객·파트너·관리자 게이트 모두 `[data-gate-notice]`. 마이페이지 "로그인 유지 … 까지"(`[data-session-expiry]`). 구 세션은 로드 시각부터 TTL.
- 상용 전환: 해시는 서버 bcrypt/argon2, 잠금·OTP·세션은 서버 정책으로 — 상수·메시지·게이트 동작은 그대로 재사용.

## 낙찰 전 수정 (28-53)

- `updateRequest(requestId, patch, today)`: 낙찰 전만. `description`·`region`·`desiredDate`(오늘 이후)·`desiredTime`·`budget`·`budgetRange`·`answers` — 카테고리는 불가. 희망일이 현재 마감 이하로 앞당겨지면 마감을 `defaultBidDeadline`으로 재계산. `store.update`가 `editedAt`·`editCount` 기록. 입찰자 전원 계정 범위 알림.
- `submitEstimate` 재제출: `StoredEstimate.revision`(1차부터)·`submittedAt`, 고객 알림 "견적이 수정되었습니다 (n차) — … (이전 X원)". 스냅샷 복원 시 breakdown은 재계산하되 차수·시각은 유지.
- `withdrawBid(requestId, partnerId, today)`: 낙찰 전·마감 전·내 입찰만. 남은 입찰이 없으면 `store.reopen(id, 'requested')`(estimated→requested 허용). 고객 알림(남은 견적 n건). 신뢰 지표(`partnerCancels`)에는 기록하지 않는다.
- 화면: 고객 거래 상세 "요청 수정"(`[data-edit-request]`) 인라인 폼(`aria-label` 수정 내용/지역/희망일/시간대) + "수정됨 n회"(`[data-edit-count]`). 파트너 일감 카드 "제안 수정"(기존) + "입찰 철회"(`[data-withdraw-bid]`), "내 입찰 완료 (n차 수정)". 고객 견적함 "n차 수정" 태그(`[data-revision]`).

## 파트너 응답 (28-54 → 28-90)

- ~~`SiteSettings.warrantyDays` · `warrantyStatus()` · `fileClaim('as')`~~ — **28-90에서 삭제.** A/S 와 분쟁은 하나(아래 "분쟁" 절). 보증 기간 카드·`[data-warranty]` 배지도 없다.
- `Claim.partnerReply/repliedDate`, `replyClaim(claimId, partnerId, text, date)`: 낙찰 파트너만, 미해결만, 덮어쓰기, 고객·관리자 알림. `opsQueue.unansweredClaims`(`CLAIM_REPLY_SLA_DAYS = 2` 경과·답변 없음) → 현황 `data-ops="unanswered"`. 파트너 내 작업 카드 `ClaimReplyBox`(`aria-label="분쟁 답변"`), 고객 거래 상세·관리자 **분쟁** 탭 `[data-claim-reply]`.
- `Review.reply/repliedDate`, `replyReview(requestId, partnerId, text, date)`: 그 작업의 파트너만, 수정 가능, 고객 알림. 파트너 마이 탭 `ReviewReplyForm`(`aria-label="리뷰 답글"`), 고객 업체 카드·관리자 리뷰 탭 `[data-review-reply]`.
- 상용 전환: 답변 SLA는 알림 배치로.

## 데이터 위생 (28-55)

- 알림: `pruneNotifications(now)` — 읽은 알림 `NOTIFICATION_READ_RETENTION_DAYS = 30`일, 안 읽은 알림 90일 경과 제거, 그래도 `NOTIFICATION_CAP = 500` 초과면 오래된 것부터(읽은 것 우선) 제거. 멱등, 제거 수 반환. 앱 기동(`initPlatform`)과 관리자 현황 sweep에서 실행.
- 채팅: `sendMessage`는 `CHAT_MAX_TEXT = 500`자·요청당 `CHAT_MAX_PER_REQUEST = 300`건 초과 거부. `pruneChats(today, 180)` — 거래 종료일(`terminalDate`: 정산 완료일/취소 환불 생성일) + `CHAT_RETENTION_DAYS` 경과 요청의 채팅·읽음 기록 제거. `ChatBox` 입력 `maxLength` + 글자 수(`[data-chat-count]`).
- 저장 용량: `storageUsage()`에 `notificationChars/Count`, `chatChars/Count`, `otherChars`(합 = 전체). 관리자 카드 내역 막대(`[data-storage-breakdown]`: 사진·알림·채팅·기타) + "오래된 알림 정리"(`[data-prune-notifications]`)·"오래된 채팅 정리"(`[data-prune-chats]`), 결과 `[data-prune-msg]`.
- 상용 전환: 세 정책(사진 90일·알림 30/90일·채팅 180일)은 서버 배치의 보관 규칙으로 그대로 옮긴다.

## 다중 탭 동기화 (28-56)

- 스냅샷 `rev`(저장마다 +1)·`savedAt`. `save()`는 `<key>:rev` 키에도 리비전을 써서 다른 탭이 큰 JSON을 파싱하지 않고 변경을 감지한다. 쓰기 전에 저장소 리비전이 메모리와 다르면 `conflictCount += 1`·`onConflict`(마지막 쓰기 우선 — 사용자의 방금 행동 보존). `syncFromStorage()`: 리비전이 다르면 스냅샷 재적용 후 true, `lastSyncAt`. `revision` getter.
- `AuthSnapshot.rev` + `AuthService.syncFromStorage()`: 다른 탭의 로그인·로그아웃·잠금·세션 만료 반영.
- `PlatformProvider`: `storage` 이벤트(`banded-*` 키)·`focus`·`visibilitychange`에서 두 서비스를 동기화하고 화면 갱신, 1회성 안내 `SyncNoticeBanner`(`[data-sync-notice]`, 4초). 충돌 시 "다른 탭의 변경과 겹쳤습니다" 배너. 관리자 저장 용량 카드에 리비전·탭 충돌 횟수(`[data-conflicts]`).
- 상용 전환: 리비전은 서버의 낙관적 잠금(ETag/version)으로, storage 이벤트는 SSE/WebSocket 푸시로 바뀐다 — 동기화 진입점(`syncFromStorage`)은 그대로.

## 일정 변경·휴무 (28-57)

- `rescheduleVisit(requestId, { date, startHour, endHour }, by, today)`: `scheduled`에서만. 형식 검증 → 지난 날짜·같은 일정·파트너 휴무일 거부 → 자기 슬롯을 제외한 `addSlot` 충돌 검사 → 슬롯 교체(id 유지) → `store.markRescheduled`(`rescheduleCount/rescheduledAt`) → 상대방 알림("고객이/파트너가 방문 일정을 변경 — 이전 → 새"). 고객 거래 상세 "방문일 변경"(`[data-reschedule]`, `aria-label` 변경 날짜/시작/종료, 오류 `[data-reschedule-error]`) + "일정 변경 n회"(`[data-reschedule-count]`). 파트너 일정 탭은 방문 예정 건을 같은 폼에서 선택하면 버튼이 "일정 변경".
- 휴무일: `daysOff`(스냅샷, 날짜 검증·중복 제거·정렬), `setDaysOff/toggleDayOff/daysOffOf/isDayOff`. `scheduleVisit`·`rescheduleVisit`가 휴무일 거부. 일정 탭 "YYYY-MM-DD 휴무 설정/해제"(`[data-dayoff-toggle]`), 캘린더 셀 `.dayoff`(`[data-dayoff]`).
- `sweepVisitReminders(today)`: 내일 슬롯(요청 scheduled)에 고객·파트너 "내일 방문 예정" 1회(슬롯 `remindedFor` 멱등, 일정 변경 시 새 슬롯이라 재알림). 앱 기동·관리자 sweep.
- 상용 전환: 리마인더는 서버 스케줄러 + 푸시/SMS로, 휴무일은 파트너 캘린더 연동(구글 캘린더 등)으로 — 규칙은 `isDayOff`·`addSlot` 한 곳.

## 운영 감사 로그·검색 (28-58)

- `AuditEntry { id: AUD-00001, at, actor: 'admin'|'system', action, target, detail? }` — 스냅샷 `auditLog/auditSeq`(검증: actor 두 값만). 관리자 행위(`markPayout` 지급 완료·`settleRefund` 환불 완료·`reviewClaim` 검토 시작·`resolveClaim` 해결 처리·`updateSettings` 설정 변경(바뀐 키)·패키지 등록/수정/삭제·질문 등록/삭제)는 같은 `save()` 안에서 `record()`로 기록. 시스템 정리(`sweepDeadlines` 마감 정리·`sweepPaymentReminders` 결제 리마인더·`sweepVisitReminders` 방문 리마인더·`prunePhotos` 사진 정리·`pruneNotifications` 알림 정리·`pruneChats` 채팅 정리)는 n>0일 때만 `actor: 'system', target: String(n)`.
- 인증 서비스 행위(파트너 승인/거절·기록 파기·계정 정지/해제)는 UI가 `platform.audit(actor, action, target, detail?)`로 기록(즉시 저장). `auditLog(limit?)` 최신순. `pruneAuditLog(now)`: `AUDIT_RETENTION_DAYS = 180` 경과 제거 후 `AUDIT_CAP = 1000` 초과분은 오래된 것부터 — 앱 기동·관리자 sweep.
- 관리자 현황 "운영 기록" 카드(`[data-audit-log]`, `.audit-row[data-audit-actor]`, 최근 20건) + "운영 기록 CSV"(`[data-export-audit]`, `audit-YYYY-MM-DD.csv`, 헤더 시각·주체·행위·대상·상세).
- 요청 관리: 검색(`aria-label="요청 검색"`: ID·고객·내용·지역·분야)·상태 필터(`aria-label="상태 필터"`)·50건 페이지 "더 보기"(`[data-requests-more]`), 결과 없음 `[data-requests-empty]`. 회원 관리: 검색(`aria-label="회원 검색"`: 이름·아이디·휴대폰/사업자번호 숫자 일치).
- 상용 전환: 감사 로그는 서버 append-only 테이블(관리자 ID·IP 추가)로, 검색은 서버 쿼리로 — 기록 지점(`record`)과 행위 이름은 그대로.

## 백업 권한·감사 무결성 (28-59)

- **백업은 관리자 전용**: 28-58까지 파트너 대시보드(`Dashboard.tsx`)에 있던 전체 백업 내보내기·가져오기를 제거하고 관리자 설정 탭 `BackupCard`로 옮겼다. 파트너 화면에는 플랫폼 전체를 읽고 쓰는 진입점이 없다(파트너용 내보내기는 "내 정산 내역 CSV" 28-47-03). 내보내기 `[data-export-backup]`(`banded-backup-YYYY-MM-DD.json`), 복원은 확인 문구 "복원"을 입력해야 파일 선택이 열린다(`[data-import-backup]`, 결과 `[data-backup-msg]`/`[data-backup-error]`).
- **감사 무결성**: `restoreBackup(json)` — 현재 감사 로그를 보존한 채 스냅샷을 적용하고, 가져온 로그는 반영하지 않으며, `관리자 · 백업 복원`(보존 n건 · 무시 m건) 기록을 남긴 뒤 저장한다. 반환 `{ kept, ignored }`. `importSnapshot`/`applySnapshot`(다중 탭 `syncFromStorage`·기동 로드)의 의미는 그대로다 — 감사 로그는 "이 브라우저에서 실제로 일어난 일"만 담는다.
- **보안 이벤트**: `AuthService.onSecurityEvent`(`platform.onSaveError`·`onConflict`와 같은 할당형 훅). 발화는 로그인 실패·로그인 잠금(`recordFail`), OTP 시도 초과, 비밀번호 변경, 회원 탈퇴. 대상은 계정 ID 또는 `maskPhone()`으로 마스킹한 번호(`고객 010****5678`)이며 원문 번호·비밀번호·OTP는 남기지 않는다. 훅이 던져도 인증 흐름은 막히지 않는다. `PlatformProvider`가 `platform.audit('system', …)`로 잇는다.
- **운영 기록 조회**: 주체 필터(`[data-audit-filter="all|admin|system"]`) + 검색(`aria-label="기록 검색"`, 행위·대상·상세) + 20건 단위 "더 보기"(`[data-audit-more]`), CSV는 필터 결과 기준. 저장 용량 내역에 `기록` 세그먼트(`storageUsage().auditChars/auditCount`, `[data-storage-audit]`) — 상한 1000건의 실제 무게가 보인다.
- 상용 전환: 백업·복원은 서버 관리자 권한(RBAC)과 감사 대상 API로, 감사 로그는 append-only 테이블로 옮긴다. 보안 이벤트 훅은 그대로 서버 인증 이벤트 스트림에 붙인다.

## 감사 로그 신뢰성·복원 안전망 (28-60)

- **반출 기록**: `exportBackup()` — `백업 내보내기`(대상 `rev N`, 상세 `요청 n건 · kKB`)를 남기고 JSON을 돌려준다. 기록의 `rev`는 저장 전 리비전이라 **내려준 파일의 rev와 일치**한다. 관리자 백업 카드가 이 메서드를 쓴다(`[data-export-backup]`).
- **로그 잠식 방지**(`AuditEntry.count`/`firstAt`): `record()`가 `AUDIT_COLLAPSE_MS = 5분` 창 안의 같은 주체·행위·대상 반복을 마지막 줄에 접는다 — `at`은 마지막 발생, `firstAt`은 첫 발생, `count`는 횟수(2 이상). 화면은 `행위 ×n`(`[data-audit-count]`)과 `첫시각 ~ 시각`으로, CSV는 `첫 시각`·`횟수` 열로 보인다.
- **가치 순 폐기**: `pruneAuditLog()`가 상한(1000건) 초과 시 **시스템 기록을 오래된 것부터 먼저** 버리고, 그래도 넘칠 때만 관리자 행위 기록을 버린다. 존재하지 않는 번호로 무차별 로그인해도 관리자 운영 기록은 밀려나지 않는다.
- **복원 안전망**: 복원 직전 상태를 `banded-before-restore-YYYY-MM-DD.json`으로 자동 내려받고, 같은 세션 동안 `canUndoRestore`/`undoRestore()`로 되돌릴 수 있다(`[data-undo-restore]`). 되돌리기도 `복원 되돌리기`로 기록되고, 되돌리기 지점은 한 번 쓰면 사라진다(연쇄 되돌리기 없음). 되돌리기 지점은 메모리에만 둬 저장 용량을 늘리지 않는다.
- **복원 후 폼 재동기화**: 복원·되돌리기는 설정을 통째로 바꾸므로 `BackupCard`가 `onRestored`로 부모 `AdminSettings`의 폼 상태(히어로 문구·공지·약관)를 저장된 값으로 다시 채운다 — 마운트 때 잡아둔 값이 남아 있는 문제를 없앴다.
- 상용 전환: 반출·복원·되돌리기는 서버 감사 API로, 접기는 서버 집계(rate aggregation)로, 되돌리기 지점은 스냅샷 버전으로 옮긴다.

## 개인정보·행위자 식별 (28-61)

- **가명 처리 백업**(`BackupMode = 'full' | 'pseudonymous'`, 기본 가명본): `exportBackup(mode)`. 가명본은 고객 이름을 `고객 A`류로 치환(같은 고객은 같은 가명), 지역은 시·구까지만, 요청 내용은 `[가명 처리] <분야> 요청`으로 바꾸고 사진·답변·채팅을 제거하며, **알림 문구도 지운다**(`reqLabel`이 요청 내용을 담기 때문 — 실측에서 이 경로로 새는 것을 발견해 막았다). 리뷰·A/S 본문도 치환. 상태·일정·금액 등 운영 지표는 그대로 남아 분석·이관에 쓸 수 있다. 되돌릴 수 없는 변환이라 **복원용이 아니다**. 관리자 카드에서 모드를 고르고(`[data-backup-mode="pseudonymous|full"]`), 어느 모드로 내보냈는지가 운영 기록에 남는다.
- **행위자 식별**(`AuditEntry.by`): `platform.actorId`를 `PlatformProvider`가 관리자 세션(`accountId`)에서 채우고, 관리자 기록에만 붙는다(시스템 기록에는 없음). 접기 조건에 행위자가 포함돼 **다른 관리자의 같은 행위는 접히지 않는다**. 화면은 주체 아래 계정 ID(`[data-audit-by]`), CSV는 `주체` 다음 `행위자` 열, 검색은 행위자도 대상으로 한다.
- **데이터 주체 열람권**(28-60-03): 고객 마이페이지 "내 데이터 내보내기" — `exportCustomerData(customerId)`가 본인 요청 id 집합으로만 걸러 요청·견적·방문·결제·환불·리뷰·A/S·대화를 JSON(`my-data-*.json`)으로, `customerDataRows`가 거래 요약 CSV(`my-transactions-*.csv`)로 준다. 다른 고객 데이터는 어떤 경로로도 섞이지 않으며, 내보내기는 `내 데이터 내보내기`로 기록된다(주체는 시스템).
- 내려받기 파일명은 ASCII로 통일했다 — 한글 파일명은 브라우저·OS에 따라 변형될 수 있다.
- 상용 전환: 가명 처리는 서버 배치의 비식별 파이프라인으로, 행위자는 관리자 계정 테이블·RBAC로, 열람권은 인증된 본인 API로 옮긴다.

## 가명본 안전장치·열람권 대칭 (28-62)

- **가명본은 복원할 수 없다**: `PlatformSnapshot.pseudonymous`를 타입·검증에 정식 편입하고, `restoreBackup`이 **상태를 건드리기 전에** 거부한다(`PlatformService.isPseudonymousBackup(json)`). 관리자 카드는 같은 함수로 미리 걸러 직전 상태 백업조차 만들지 않고 `[data-backup-error]`로 알린다. 가명 처리는 단방향이라 복원하면 원본을 되돌릴 수 없기 때문이다.
- **가명 처리를 허용 목록으로 뒤집었다**: `PSEUDONYMOUS_*_KEYS` 상수가 **내보낼 필드를 고르고 나머지는 버린다**. 28-61까지의 "지울 것 열거" 방식은 필드가 늘 때마다 샜다(알림 문구 → 감사 로그 상세 → 클레임 처리 내용 → 파트너 상호 → 지급 계좌 예금주). 자유 서술 필드는 목록에 넣지 않는다. 고객·파트너는 각각 `고객 A`·`파트너 A` 계열로 가명화하고 `customerId`도 가명 키로 바꾼다. 지역은 시·구까지. 구조 식별자(`requestId`·`partnerId`)와 운영 지표(상태·일정·금액·`specialties`)는 유지한다.
- **자체 검사**(`assertNoRealNames`): 가명본을 만든 뒤 스냅샷에 실제로 있는 사람·업체 이름이 결과에 남아 있으면 `PlatformError`로 **내보내기를 실패시킨다**. 이 검사가 지급 계좌 표기(`payout.account`의 예금주)라는 다섯 번째 경로를 실제로 잡아냈다. 두 글자 미만 이름은 오탐이라 제외한다.
- **파트너 열람권**(`exportPartnerData`): 내가 입찰했거나 낙찰받은 요청 범위만 — 일감 요약·내 견적·방문·완료 작업·리뷰·A/S 답변. **고객 이름·요청 내용은 담지 않는다**. 파트너 마이 탭 카드(`[data-export-partnerdata]`), 파일명 `my-partner-data-*.json`. 고객 카드(28-61)와 같은 모양이며 두 경로 모두 `내 데이터 내보내기`로 기록된다.
- 상용 전환: 허용 목록과 자체 검사는 서버 비식별 파이프라인의 스키마 화이트리스트·검증 단계로 그대로 옮긴다.

## 허용 목록 완성·입찰 이력·토글 접근성 (28-63)

- **가명 처리 허용 목록을 전 컬렉션으로 확장**했다. 28-62는 여섯 컬렉션에만 목록을 걸고 `estimates`·`slots`·`payments`·`refunds`·`partnerCancels`·`packages`·`questions`·`settings`를 통째로 통과시켰고, 그 안에 자유 서술이 셋 있었다 — `Estimate.memo`(파트너 메모), `Refund.reason`(차감 사유), `PartnerCancel.reason`(철회 사유). 이제 각 컬렉션이 `PSEUDONYMOUS_*_KEYS`를 거치고 자유 서술은 목록에 없다. `settings`는 운영 지표(`disabledCategories`·`warrantyDays`)만 남는다. `daysOff`는 날짜 배열이라 그대로 둔다.
- **안전망을 두 겹으로**: 값 대조 `assertNoRealNames`(아는 이름) + **구조 대조 `assertPseudonymousShape`** — 결과의 각 컬렉션에 허용 목록 밖 키가 하나라도 있으면 `PlatformError`로 실패시킨다. **새 필드가 생기면 기본이 "제외"이고, 내보내려면 목록에 이름을 적어야 한다.** 컬렉션을 통째로 넘기는 실수가 구조적으로 성립하지 않는다.
- **낙찰 전 입찰 철회 이력**(`BidWithdrawal { id: BW-0001, requestId, partnerId, at, beforeDeadline }`): `withdrawBid`가 맵에서 지우기 전에 남긴다. `bidWithdrawals(partnerId?)` 최신순, `bidWithdrawalCount(partnerId, sinceDays, today)`는 28-51의 `partnerCancelCount`와 같은 90일 창. 관리자 회원 목록에 "입찰 철회 n회"(`[data-member-bid-withdrawals]`), 파트너 열람권에 `withdrawnBids` 포함(철회한 요청도 내 범위로 들어온다). 가명본에서도 허용 목록을 거친다.
- **파트너 열람권 비유출 검사**: `exportPartnerData` 결과에 본인 상호를 제외한 고객·타 파트너 이름이 남으면 실패시킨다 — 가명본에만 있던 안전망을 대칭으로 걸었다.
- **토글 그룹 부품화**(`ToggleGroup` in `src/ui/primitives.tsx`): `role="group"` + `aria-label`, 각 버튼 `aria-pressed`. 8곳(고객 결제 수단·요청 질문 보기·희망 시간대·관리자 회원 역할/운영 기록 주체/백업 모드·파트너 작업 상태/정산 상태)에 적용. 모양은 `.filter-group` 그대로라 시각 회귀가 없고, 옵션이 `data-*`를 실어 나르므로 기존 e2e 선택자도 그대로다.
- 상용 전환: 허용 목록·구조 대조는 서버 비식별 파이프라인의 스키마 검증으로, 철회 이력은 파트너 신뢰 점수의 입력으로 옮긴다.

## 배포 확인 개통 (28-64)

- **마지막 구간을 기계가 본다**: 게이트 4종(`check`·`e2e`·`visual-check`·`audit`)은 모두 개발 컨테이너 안에서 끝나
  실제 라이브 주소가 그 빌드를 서빙하는지는 63라운드 동안 확인된 적이 없었다.
  저장소 루트 `.github/workflows/deploy-check.yml`이 그 구간을 잇는다 — GitHub Actions는 개발 환경의
  네트워크 제약 밖에서 돌기 때문에 라이브 주소를 직접 받을 수 있다.
- 워크플로는 main 푸시·수동 실행·하루 1회(cron)에 돌며, ① HTTP 200 ② `index.html`이 참조하는 실제 서빙 번들에
  **현재 라운드 문자열**이 있는지를 확인하고 다르면 실패한다. 기대 라운드는 `vercel.json`의 `outputDirectory`에서
  읽으므로 **라운드마다 이 파일을 고칠 필요가 없다**. `workflow_dispatch`의 `expect_round` 입력으로
  일부러 틀린 값을 넣어 "틀리면 잡는지"를 시험할 수 있다.
- 로컬 `visual-check`(서빙 번들 = 로컬 dist 대조)와 같은 발상을 프로덕션에 적용한 것이며, 결과가 커밋 체크로 남아
  다음 라운드부터 배포 여부를 **사실로** 보고할 수 있다.
- **자체 검사 이름 출처 확장**(28-63-02): `platform.extraNames`에 계정 서비스가 아는 이름을 주입한다
  (`PlatformProvider`가 `auth.listAccounts()`로 채운다). 스냅샷에는 요청을 낸 고객·프로필을 쓴 파트너 이름만
  있어 "아는 이름의 범위"가 좁았던 것을 넓혔다. 비어 있어도 기존 동작 그대로다.
- **토글 부품 통일**(28-63-03): `filter-group` 인라인 구현이 0곳이 됐다. 선택 해제가 필요한 그룹(위저드 질문 보기)은
  `ToggleGroup`의 `deselectable` 옵션으로 흡수했고, 해제 그룹만 빈 문자열을 다루도록 **판별 유니온**으로 타입을 갈랐다 —
  일반 필터 호출부는 `''`를 신경 쓰지 않는다.

## 시연 데이터와 공개 지표 — 없음 (28-79~28-88 → 28-91)

28-91에서 **둘 다 지웠다** (참고 v12 대조 1단계, `docs/rounds/28-90/참고_v12_대조.md`).

- 첫 방문은 **빈 상태**다. `seedPlatform`·`RepairRequest.seeded`·`clearSeedData`·관리자 설정의 시연 데이터 카드·
  `excludeSeeded` 옵션·`public*` 대응물(`publicPartnerSummary`·`publicReviews`)이 전부 사라졌다. 고객 견적함의 업체
  카드는 `partnerSummary`·`allReviews`를 그대로 쓴다 — 시드가 없으니 고객·운영자·파트너가 같은 값을 본다.
- 랜딩 히어로에 **숫자 블록이 없다**. `publicStats`·`api/publicStats.ts`·`/api/public-stats`·`usePublicStats`·
  `showPublicStats`·`[data-hero-stats]`·`.hero-stats`가 사라졌다. 실적을 내걸려면 참고 v12의 파트너 포트폴리오·리뷰
  (28-99 계획)처럼 **사람이 쓴 것**을 보여 준다.
- `src/ui/customerSurfaces.test.ts`(28-82~28-88의 시드 가드)와 그 픽스처도 지웠다 — 지킬 규칙이 사라졌다.
- 남은 것: `PlatformService.LEGACY_PARTNER_ID`(`P-001`)는 28-41 이전 스냅샷의 **단일 프로필을 옮겨 붙이는 id**다.
  옛 스냅샷에 `seeded: true`가 남아 있어도 읽을 때 그냥 지나간다(검증 대상이 아닌 여분 필드).
- 서버 e2e의 익명 방문자 절(28-85-05)도 함께 사라졌다. `/api/snapshot`은 여전히 세션 없이는 401이다.

## 관리자 등급·접근 권한 (28-89-A)

- **표 한 장이 근거다**: `src/domain/adminGrade.ts`. 등급(`owner`·`manager`·`viewer`) × 행위
  (`view`·`operate`·`editSettings`·`exportBackup`·`destructive`·`manageAdmins`) → `canAdmin(grade, action)`.
  도메인·서버·화면이 **같은 함수**를 쓴다. 권한을 바꿀 일이 생기면 `ADMIN_MIN_GRADE`만 고친다.
- **새 관리자 버튼을 만들 때**: `const can = useAdminCan()` → `disabled={!can('operate')}`,
  안내는 `title={gradeHint('operate')}`("매니저 이상만 할 수 있습니다"). 비가역 조작(복원·파기·시연 삭제·
  보관함 비우기)은 반드시 `'destructive'`(소유자)로 묶는다.
- **열람 등급은 화면 전체가 읽기 전용**이다: `AdminGradeShell`(App.tsx)이 `.admin-readonly`로 감싸
  버튼을 비활성처럼 만든다(`pointer-events: none`). 필터·링크 버튼과 `[data-viewer-ok]`는 예외다 —
  **보기 위한 조작까지 막으면 열람 등급이 쓸모없어진다.** 새 "보기용" 버튼에는 `data-viewer-ok`를 붙인다.
- **등급이 없는 세션**(28-89 이전에 발급된 토큰)은 `canAdmin(undefined, …)`가 전부 `false`다.
  화면은 "다시 로그인하면 등급이 실립니다"라고 말한다 — 조용히 아무것도 안 되는 것이 가장 나쁘다.
- **관리자 계정 관리**는 회원 탭 첫 카드(`AdminAccountsCard`). 아이디는 소문자·숫자·`-`·`_` 3~20자로
  정규화된다. 마지막 소유자는 내리거나 지울 수 없고, 자기 자신은 지울 수 없다.
- **서버가 막는 것과 못 막는 것**을 화면 문구에 반영한다: 서버는 열람의 쓰기·매니저의 관리자 관리·
  매니저의 `purgeAccount`를 403으로 막지만, 스냅샷은 통째 쓰기라 **매니저와 소유자를 `PUT`에서 구별하지
  못한다.** UI가 "소유자만"이라고 적은 것이 서버 강제와 같지 않은 자리다 — 새 파괴적 조작을 만들 때
  이 차이를 알고 만든다.

## 첫 화면 배치 편집기 (28-89-B)

- **배치는 코드가 아니라 데이터다**: `settings.landing = { sections: [{id, visible}] × 6, titles }`.
  섹션 id는 `categories · steps · services · packages · faq · cta`이고 **히어로·푸터는 고정**이다.
- **관리자 통로**: 설정 탭 > "첫 화면 배치" 카드(`LayoutCard`). ↑↓로 순서, 체크로 노출,
  입력으로 제목(60자). "배치 저장"을 눌러야 반영되고, "기본 배치로"가 되돌린다. 매니저 이상.
- **랜딩 쪽**: `Landing.tsx`의 `renderSection(id)` 하나가 여섯 섹션을 그리고, 본문은
  `settings.landing.sections.filter(visible).map(renderSection)`이다. 각 섹션에 `data-landing-section`이
  붙어 e2e·렌더 테스트가 순서를 읽는다. 제목은 `landingTitle(layout, id)` — 덮어쓴 것이 없으면 기본 제목.
- **섹션을 새로 추가할 때**: ① `LANDING_SECTION_IDS`에 id 추가 ② `LANDING_DEFAULT_TITLE`·
  `LANDING_SECTION_LABEL`에 항목 추가 ③ `renderSection`에 `case` 추가. `normalizeLanding`이 구 배치에
  **빠진 섹션을 기본 순서로 뒤에 붙이므로** 이미 저장된 배치가 새 섹션을 숨기지 않는다.
- **검증은 도메인이 한다**(`updateSettings`): 여섯 섹션 정확히 한 번, 최소 하나 노출, 제목 60자.
  잘못된 배치는 **조용히 고치지 않고 거부**한다 — 관리자가 실수한 것은 관리자에게 말해야 한다.

## 참고 v12 대조 정리 (28-90)

대조표·이후 라운드 순서는 `docs/rounds/28-90/참고_v12_대조.md`.

- **분쟁 하나**: `Claim.kind` 없음. 고객 거래 상세 "문제 접수 (분쟁)" 카드 → 버튼 하나(`[data-file-claim]`, "문제 신고"), 안내 "해결 전까지 정산·지급 보류". `fileClaim(requestId, { detail })`는 낙찰 이후 상태에서만. `hasOpenClaim(requestId)`가 참이면 `settle()`·`markPayout()`이 거절하고, `resolveClaim()` 뒤 풀린다. 관리자 탭 이름 **분쟁**, 정산 탭 지급 대기 행 `data-payout-held="dispute"` + "분쟁 보류" 태그.
- **다크 모드 없음**: `tokens.css`는 라이트 토큰만, 헤더 테마 토글·`sun`/`moon` 아이콘·`visual-check`의 다크 픽셀 검사 삭제. 새 색은 `:root` 한 곳에만 둔다.
- **정산 계좌 인증**: `AuthService.verifyPayoutAccount(accountId, adminId)`(파트너만, 계좌 있어야, 보안 이벤트 `정산 계좌 인증`). 서버 op `verifyPayoutAccount`는 `operate`(매니저 이상). 관리자 정산 탭 계좌 칸에 **계좌 인증** 버튼(`[data-verify-payout]`) 또는 인증됨 태그. `markPayout`은 `verified === false`면 `인증되지 않은 정산 계좌입니다 …`.
- **포맷 게이트**: `.prettierrc`(120열·세미콜론 없음·홑따옴표·후행 쉼표). `npm run format`으로 맞추고, `npm run check`가 `format:check`로 시작한다. 긴 문자열(약관 본문·사용자 문구)은 prettier가 건드리지 않으니 그것만 180자를 넘길 수 있다.
- **문서 위치**: 라운드 문서는 `docs/rounds/28-N/`, 디자인 시스템·시안 분석은 `docs/`. 루트에는 `README.md`·`UI_가이드.md`·상태 JSON만.

## 서비스 카탈로그 · 전국 시·도 · 홈=요청 폼 (28-92)

- **분야 20개**(`src/domain/catalog.ts` `CATALOG`, 참고 v12): 5 그룹(`SERVICE_GROUPS`) + "분야를 모르겠어요"(그룹 밖, 마지막).
  식별자는 라벨(한국어)이고 코드(`PLUMBING` …)는 나란히 둔다. `RepairCategory`·`ALL_CATEGORIES`·`CATALOG`·그룹이
  같은 집합인지 `catalog.test`가 지킨다 — 분야를 더할 때는 넷을 함께 고친다.
- **옛 라벨**(도배·욕실·누수 등 13개)은 `LEGACY_CATEGORY_MAP`으로 스냅샷을 읽을 때 옮긴다(`migrateLegacyCategories`):
  요청은 못 옮기면 "분야를 모르겠어요", 패키지·질문·비활성 목록·전문 분야는 못 옮기는 항목을 버린다. `addRequest`·
  `updateProfile`도 입력을 `normalizeCategory`로 옮기고 목록 밖은 거절한다.
- **`CategoryPicker`**(`src/ui`): 그룹 탭(`.cat-groups`, `aria-pressed`) + 카드(`.cat-card[data-category=<라벨>]`,
  `<strong>라벨</strong><small>안내</small>`). `compact`면 28-18의 칩, `multi`면 다중 선택. 홈 히어로·랜딩 카테고리 섹션·
  위저드·파트너 프로필이 쓴다. **e2e는 `data-category`로 집는다** — `has-text("욕실")`은 "생활·상업 시설 설치"의 안내
  문구(욕실 소품)에도 걸린다.
- **지역**: `DISTRICTS`(17 시·도 → 시·군·구, 세종은 세종시 하나). `RegionSelect`(`aria-label="시·도"`/`"시·군·구"`,
  수정 폼은 `"수정 시·도"`/`"수정 시·군·구"`)가 `"시·도 시·군·구"` 한 문자열을 올린다. 시·도만 고른 상태는 빈 문자열.
  자유 입력 칸은 없다. 파트너 프로필의 서비스 지역은 여전히 토큰 문자열(`서울, 경기 고양시`)이다 — 요청 지역에
  토큰이 **포함**되면 매칭(28-47).
- **홈 히어로**의 오른쪽은 요청 폼 카드(`[data-hero-form]`)다: 그룹 탭 6 + 분야 카드 20. 카드를 누르면 `onPostJob(분야)` →
  로그인 게이트를 지나 위저드에 그 분야가 선택되어 있다(`setDraftCategory`).

## 분야 묶음 · 안전 질문 · 접수 검토 (28-93)

- **요청의 분야는 묶음**이다: `categoriesOf(r)`(구 데이터는 `[category]`)로 읽고, 제목은 `[A + B] 설명`으로 그린다
  (고객 홈·파트너 일감·입찰 폼·관리자 검토 행·알림 문구 `reqLabel`). 첫 항목이 주 분야(`category`)라 옛 코드는 그대로 돈다.
  `profileMatch`는 하나라도 겹치면 맞고, `questionsFor(배열)`은 분야 순서대로 합친다.
- **안전 질문**은 도메인(`src/domain/safety.ts`)이 정한다 — 화면은 `safetyQuestions(categories)`가 켠 질문만
  `[data-safety-q="lock|urgent"]`로 그리고, "예"면 `[data-safety-ack]`(체크 `aria-label="안전 안내 확인"`)을 연다. 다음 단계로
  갈 때 `assessSafety`를 그대로 돌려 같은 문구로 막는다(규칙 한 곳). 규칙을 바꿀 때는 `safety.ts`·`safety.test.ts`만 고친다.
- **검토 보류**(`heldForReview(r)`: `reviewStatus==='MANUAL_REVIEW'`이고 `review` 없음)는 파트너에게 **없는 일감**이다 —
  일감 목록·입찰 폼 후보·`matchedRequests`·새 일감 알림에서 빠지고 `submitEstimate`가 거절한다. 고객 홈에는
  `[data-review-hold]` 배지(`.review-hold`, `--st-amber`). 관리자 현황 조치 필요의 `[data-ops="review"]` 행에서
  체크(연락·안전 안내·[신원]·[범위]) + 사유(`aria-label="검토 사유"`) → "검토 완료"가 공개·알림·운영 기록을 한 번에 한다.
- **e2e**: 위저드 접수는 `answerSafetyNo(page)`(모든 안전 질문에 "아니요"), 파트너 입찰 전에는 `adminReview(page, url, 설명)`
  (관리자 세션 필요). 범위 검토 분야(대부분)는 검토 없이 파트너에게 보이지 않으니, 새 단계를 더할 때 이 둘을 빼먹으면 바로 멈춘다.
- 가명본에 중첩 객체를 실을 때는 `PSEUDONYMOUS_REQUEST_SPEC.nested`처럼 **중첩 허용 목록을 선언**해야 한다(28-65-01 가드).

## 상세 주소·연락처 · 낙찰 전 파트너 가림 (28-94)

- 파트너 화면에 요청을 그릴 때는 **`requestForPartner(r, partnerId)`를 먼저 지난다** — 낙찰 파트너(`acceptedPartnerId`)가 아니면
  `PARTNER_PRIVATE_KEYS`(`address`·`phone`·`photos`)가 없고 `customerName`이 `maskName`으로 가려진 사본이다. 일감·입찰(`Jobs`)·
  내 작업(`Work`)·대시보드가 쓴다. 파트너에게 요청을 보여 주는 새 화면을 만들면 `platform.store.get()`을 그대로 그리지 말 것.
- 위저드는 상세 주소(`aria-label="상세 주소"`, 5자 이상 필수)와 연락처(`aria-label="요청 연락처"`, 계정 번호로 채움)를 받는다.
  규칙은 도메인(`normalizeAddress`·`normalizeRequestPhone`)과 같다. e2e 접수는 주소를 채워야 다음으로 간다.
- 낙찰 전 파트너 카드에는 사진 띠 대신 `[data-private-note]`, 낙찰 뒤 내 작업 카드에는 `[data-private-details]`(방문지·연락처).
- 반출: 주소·연락처는 **본인 반출**(`exportCustomerData`)에만. 가명본·파트너 반출은 허용 목록 방식이라 넣지 않는 한 나가지 않는다.
  본인 반출의 실명 검사는 본인 이름과 본인 번호(숫자만 대조)를 제외한다.
- 연락처 표시는 `fmtPhone`(`src/ui/format.ts`) 하나로 한다.

## 계약서 · 일정 변경 제안 (28-95)

- **낙찰 → 계약서 → 동의 → 방문 예정**이 기본 경로다. 파트너 일정 탭의 "계약서 보내기"(`proposeContract`)와 고객 거래 상세의
  `[data-contract]` 카드("계약 내용 확인" 체크 → "계약 동의"/"수정 요청", `decideContract`). 동의가 슬롯을 만들고 `scheduled`로
  보낸다. `scheduleVisit`(직접 예약)은 계약서가 오간 요청에서 던지므로 새 화면에서 부르지 말 것.
- **예약금 카드**는 동의된 계약(`acceptedContract`)이 있을 때만 그린다 — 금액은 `depositAmountFor`. 계약 전 낙찰 건은
  `[data-contract-wait]` 안내. 수수료 표시는 `commissionBpsFor(requestId) / 100`%로(3% 하드코딩 금지).
- **파트너 일정 변경은 제안**(`proposeSchedule`, 사유 필수)이고 고객이 `[data-schedule-change]` 카드에서 결정한다(`decideSchedule`).
  `rescheduleVisit(…, 'partner')`는 던진다. 고객 직접 변경(`'customer'`)은 28-56 그대로.
- 관리자 거래 상세의 `[data-commission-form]`은 낙찰·계약 동의 전에만 보인다(`setCommissionTerms`). 정하면 제안 중인 계약은
  superseded — 파트너가 다시 보내야 한다.
- e2e: 계약 흐름은 `일정 탭 select(1)/(2) 시각 → 계약 조건/예약금 → 계약서 보내기 → 고객 체크 → 계약 동의` 순서다. 낙찰 뒤 예약금을
  바로 내는 단계는 더 이상 없다.

## 결제 멱등 키 · 정산 = 총액 − 환불 − 수수료 (28-97)

- 결제 버튼은 이제 **주문**을 만든다. 금액은 화면이 아니라 도메인이 정하고(`preparePayment`), 승인은 주문번호로만 기록된다
  (`confirmPayment`). 화면에서 금액을 계산해 넘기지 말 것 — 준비와 승인 사이에 거래가 바뀌면 도메인이 그 주문을 실패로 닫는다.
- 결제로 보이는 것은 `status === 'done'`뿐이다. 결제 여부를 화면에서 판단할 때 `paymentsFor`를 그냥 세지 말고 상태를 볼 것
  (`paymentFor`는 이미 승인된 것만 돌려준다). 준비 중·실패 주문은 영수증에 태그(`[data-payment-status]`)로만 보인다.
- 주문번호(`[data-order-id]`)는 고객·운영자가 결제사와 대조할 때 쓰는 값이라 화면에 남긴다.
- 지급액은 어디서도 `total - platformFee`로 다시 계산하지 않는다 — `platform.settlementFor(requestId).payable`
  (= 총액 − 환불 − 수수료) 하나를 쓴다. 환불이 걸리면 이 값이 바뀐다.
- 부분 환불은 관리자 정산 감독의 정산 내역 카드에서 등록하고(`[data-add-refund]`), 처리는 기존 현황의 환불 대기 카드에서 한다
  — 등록과 처리를 한 화면에 몰지 않는다(등록은 정산 맥락, 처리는 운영 큐 맥락).

## 추가 공사 공급가+VAT · 작업 전/후 사진 (28-96)

- 추가 작업은 `requestExtraWork({ supply, memo })`로 부른다 — VAT는 도메인(`PlatformService.vatOf`)이 계산한다. 화면은 `supply`가 있는
  행에만 `(공급가 + VAT)`를 덧붙이고, 없는 행(구 데이터)은 `amount`만 보여 준다.
- 사진은 세 묶음이다: 현장(`photos`, 고객) · 작업 전(`beforePhotos`, `[data-before]`) · 완료(`completionPhotos`, `[data-completion]`).
  파트너 화면은 `JobPhotos kind=…` 하나로 그린다(`aria-label="작업 전 사진"`/`"완료 사진"`). 새 사진 묶음을 더하면 `storageUsage`·
  `prunePhotos`·`photoCount`·검증에 함께 넣을 것.
- 계약 경로 작업의 완료 버튼은 도메인이 막는다("작업 전 사진과 완료 사진을 각각 1장 이상") — 화면에서 버튼을 숨기지 말고 문구를 보여 준다.

