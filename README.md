# 반듯집수리 파트너 플랫폼

집수리 요청 → 파트너 입찰 → 낙찰 → 방문 일정 → 시공 → 결제 → 정산 → 리뷰·A/S까지의 흐름을
고객·파트너·관리자 세 역할로 나눠 담은 웹 앱.

## 접속 주소 (29-28 기준)

| | 주소 |
|---|---|
| 운영 (도메인, 29-28) | https://www.bandeutjipsuri.co.kr — 루트 `bandeutjipsuri.co.kr` 은 www 로 넘긴다 |
| 운영 (Vercel 기본 주소) | https://bandut-partner-platform.vercel.app — 도메인을 붙여도 그대로 산다. 배포 확인(deploy-check)은 이 주소를 본다 |
| 프리뷰 (`round-29-5`) | https://bandut-partner-platform-git-r-fe6a07-kimd10041004-gifs-projects.vercel.app |

역할별 문은 **로그인 화면부터 갈린다.** 관리자 문은 한 자리뿐이다(29-10).

| 역할 | 로그인 | 첫 화면 |
|---|---|---|
| 고객 | `/login` (또는 `/login/customer`) | `/` · `/mypage` |
| 파트너 | `/login/partner` | `/partner` |
| 관리자 | `/login/admin` | `/admin` |

관리자 화면은 왼쪽 메뉴로 전부 닿는다 — 주소를 외워야 하는 화면은 두지 않는다
(`lib/adminRoutes.test.ts` 가 그것을 지킨다). 저장소 진단은 **사이트 운영 → 저장소 진단**
(`/admin/diagnostics`) 이다.

**계정 값은 이 저장소에 적지 않는다.** 관리자 비밀번호는 `ADMIN_PASSWORD`, 가입 코드는
`SIGNUP_CODE` 환경변수로만 둔다. 둘 다 Vercel 환경변수에서 설정하고, 서버는 시연용 값을 거부한다.
서버 모드 가입은 가입 코드를 아는 사람만 할 수 있다 — 가입이 곧 마켓플레이스 전체 권한이다
(`docs/rounds/28-68/서버_연결.md` 전제).

**메일 발송 (29-27)** — 이메일 인증과 이메일로 비밀번호 찾기는 `MAIL_PROVIDER`(지금은 `resend` 하나)·
`MAIL_API_KEY`·`MAIL_SENDER`(보내는 주소, 예: `반듯집수리 <no-reply@도메인>`) 셋을 Vercel 환경변수에 넣어야
운영에서 열린다(`server/authSafety.ts`의 `mailConfigured`). 셋이 없으면 운영은 그 두 기능을 503 으로 막고 휴대폰
길을 안내한다. 로컬·CI 는 문자와 같이 인증번호를 화면에 보여 준다. 키는 `server/mail.ts` 만 읽고 어디에도 적지 않는다.
발송에는 상한이 있다 — 같은 주소로는 60초에 한 통, 한 IP 는 10분에 다섯 요청(`server/rateLimit.ts`), 발송사가 8초 안에
답하지 않으면 끊고 되돌린다.

**세션·비밀번호 (29-29)** — 로그인하면 서버가 `bandut_session` **HttpOnly 쿠키**를 내린다(`server/session.ts`). 브라우저
스크립트는 토큰을 들지 않고, 같은 출처의 fetch·이미지·SSE 에 브라우저가 알아서 싣는다. 쓰기 요청의 쿠키는 `Origin` 이
우리 호스트와 같을 때만 믿는다(CSRF). `Authorization: Bearer` 는 그대로 받는다(옛 SPA·봇·테스트). 비밀번호는 서버에서
**scrypt**(`server/passwordHasher.ts`)로 저장하고, 옛 `s256$` 해시는 로그인에 성공하는 순간 바뀐다.

**사진·상담 스트림 (29-30)** — 29-5 부터 `needsBucket()` 이 저장소와 무관하게 503 으로 막아 두던 사진 올리기·내려주기와
상담 실시간 스트림(SSE)이 실제 라우트가 됐다. 사진은 29-23 의 파일 저장소 포트(`server/storage.ts`: Vercel Blob 또는
`LOCAL_STORAGE_DIR`) 위에서 `lib/media.ts` 가 다룬다 — 접수 사진(고객), 증빙 사진(고객·선택된 파트너), 작업사례 사진(승인된
파트너, 게시된 사례는 로그인 없이 공개). 바이트는 `cleanImage` 로 EXIF 를 벗겨 넣고, 표에는 `object_key` 만 남는다. 권한은 도메인의
`photoPermission`·`assetPermission` 이 정한다. 저장소가 없으면 여전히 503 으로 말한다. 운영에서는 `BLOB_STORE_ID` 가 있어야 한다.

**업체 페이지 (29-31)** — 업체가 편집기에서 꾸민 것(커버·로고·강조 색·영역 순서·대표 사례)을 손님 화면이 실제로 읽어
그린다. 29-15 부터 저장·공개는 됐지만 읽는 화면이 없었다. `components/marketplace/company-showcase.tsx` 가
`company/:id/page` 공개본 순서대로 블록을 늘어놓는다 — v17 업체 상세(`community.tsx`)는 한 줄도 고치지 않고 한
조각으로 들어간다. 커버·로고는 편집기에서 고르거나 그 자리에서 올린다(29-30 의 작업사례 사진 라우트). 꾸민 적이
없는 업체는 예전 화면 그대로다.

> **주의** — `home-repair-landing` 저장소(및 그 Vercel 프로젝트)는 **완전히 다른 사업**이다. 건드리지 않는다.

## 저장소 구조

```
app/                Next.js 앱 (29-3~). [...slug]/page.tsx 가 모든 화면의 주소표다
app/api/            API 라우트: auth · payments · [...path](마켓플레이스) — server/handlers/ 를 감싼다
components/         화면 (marketplace/ 가 v17 이식본, ui/ 가 공용 부품)
lib/                브라우저 쪽 도메인·클라이언트 (auth-client.ts · model.ts · marketplace/)
server/             서버 코드 (풀·트랜잭션 · 세션 토큰 · handlers/ · dbFingerprint · dbProbe) — tsconfig.api.json이 검사한다
db/                 Postgres 스키마 (schema.sql · marketplace.pg.sql · schema.generated.ts)
tests/              DB·HTTP 통합 검사 (DATABASE_URL 이 있어야 돈다)
scripts/            게이트 스크립트 (e2e-next · e2e-layout · e2e-journey · e2e-server · visual-check · api-server)
public/             브랜드 에셋
src/                옛 SPA 스택 (Vite). 아직 남아 있고 삭제 예정이다 — 새 화면은 여기에 만들지 않는다
docs/rounds/N-M/    라운드 문서 (수정사항.md · 검증결과.md · 감사결과.md)
docs/               DESIGN_SYSTEM.md(디자인 토큰·컴포넌트 규약) · 참고자료·기획시안·상세시안 분석
UI_가이드.md        화면별 UI 규약
```

**코드는 저장소에 하나뿐이다.** 28-66 이전에는 라운드마다 소스 트리 전체를 `28-N/`으로 복사했는데,
락파일 65개 중 63개가 사본이었고 그중 40개(구 버전)가 **취약점 알림 200건**을 만들어
살아 있는 코드의 보안 신호를 통째로 덮고 있었다. 지금은 락파일이 하나다.

과거 라운드의 코드는 커밋 `2c27089`(재구성 직전)에 전부 남아 있다:

```bash
git show 2c27089:28-30/src/domain/platform.ts   # 어느 라운드의 어느 파일이든
```

## 개발

```bash
npm ci
npm run dev          # Next 개발 서버
npm run check        # format:check → typecheck → vitest → vite build → next build  (커밋 전 이것부터)
npm run e2e          # 실사용 여정 (Playwright, dist 필요)
npm run visual-check # 서빙 번들·테마 확인 (dist 필요)
npm audit --audit-level=high
```

브라우저 게이트는 넷이다. 앞의 둘이 Next 화면을 본다.

```bash
npm run e2e:next     # Next 라우트·API 연기 검사 (next build 필요)
npm run e2e:layout   # 아이콘이 글줄을 밀어내지 않는지 (1280px·390px)
npm run e2e:interior # 공간 스튜디오
npm run e2e          # 옛 SPA 실사용 여정
```

DB가 필요한 검사는 `npm run check` 에서 통째로 건너뛴다(`DATABASE_URL` 이 없다). CI의 `server`
작업이 Postgres를 띄우고 전부 돌린다. 로컬에서 돌리려면 `DATABASE_URL` 을 주면 된다.

```bash
npm run test:contract   # 포트 계약 (Local·Memory·Http). CONTRACT_API_URL이 있으면 Http도
npm run test:pg         # 결제·거래 도메인 Postgres 포트
npm run test:mp         # 마켓플레이스 API·세션
npm run test:reset      # 비밀번호 복구
npm run test:journey    # 가입 → 재로그인 → 업체 제출 → 승인 → 권한
npm run test:probe      # 데이터 분리 표식 (diagnostic_probes)
npm run db:pg-schema    # db/schema.generated.ts 재생성 — schema.sql 을 고치면 반드시
npm run api:dev [포트]  # server/handlers/ 를 감싼 최소 서버 — DATABASE_URL·ADMIN_PASSWORD·SIGNUP_CODE 필요
npm run e2e:server      # 서버 모드 e2e (Postgres 필요). DB를 비우고 시작한다 — 이름에 test가 있는 DB만
```

서버 계층까지 로컬에서 보려면 Postgres가 있어야 한다:

```bash
psql "$DATABASE_URL" -f db/schema.sql
DATABASE_URL=… ADMIN_PASSWORD=ci-admin-pass-1 SIGNUP_CODE=ci-signup-code-1 npm run api:dev 3101 &
CONTRACT_API_URL=http://127.0.0.1:3101/api/snapshot SIGNUP_CODE=ci-signup-code-1 npm run test:contract
VITE_AUTH_MODE=server npx vite build && DATABASE_URL=… ADMIN_PASSWORD=ci-admin-pass-1 SIGNUP_CODE=ci-signup-code-1 npm run e2e:server
```

`e2e`·`visual-check`는 `npm run check`가 만든 `dist`를 본다. 두 스크립트에 **신선도 가드**가 있어
`src/`가 `dist`보다 새로우면 실행을 거부한다 — 옛 빌드에 초록을 주지 않기 위해서다.

브라우저 게이트는 `playwright-core`가 필요하다. 없으면 `PLAYWRIGHT_CORE_PATH`로 경로를 알려 주거나
`npm i --no-save playwright@1.49.1` 한다(CI가 하는 것과 같다).

## CI 게이트

| 워크플로 | 언제 | 무엇을 |
|---|---|---|
| `.github/workflows/gates.yml` `gates` | push(main) · 모든 PR | `check`(`format:check` → 타입 → 단위 → 빌드) · `npm audit --audit-level=high` · `e2e` · `visual-check` — **넷 다 차단(blocking)** |
| `.github/workflows/gates.yml` `server` | push(main) · 모든 PR | `postgres:16` 컨테이너 + `db/schema.sql` + `api-server.mjs` + 계약 테스트 **세 구현**. `CONTRACT_REQUIRE_HTTP=1`이라 HTTP 어댑터가 빠지면 실패 |
| `.github/workflows/deploy-check.yml` | push(main) · 수동 | 라이브 번들에 이번 라운드 문자열이 들어갔는지 최대 12회 재시도하며 확인 |

`continue-on-error`는 쓰지 않는다 — 무시해도 되는 빨간불을 만들지 않는 것이 요점이다.
28-65에서 일부러 타입 오류를 넣어 20초 만에 차단되는 것을 확인했다.

## 라운드 절차 (원바이원)

GPT 역할이 최신 라운드를 감사하고, Claude 역할이 다음 라운드에서 그것을 고친다.

1. `docs/rounds/28-N/감사결과.md`를 쓴다 — 항목마다 **파일·줄 번호·실제 코드 인용**과 "어떤 입력에서 무엇이 잘못되는가".
2. `main`에서 `round-28-(N+1)` 브랜치를 딴다. **스크래치 복사도, 폴더 복제도 하지 않는다** — 루트에서 바로 고친다.
3. 감사 항목을 **전부** 다룬다. 이번 라운드에서 제외하는 것은 이유와 함께 문서에 남긴다 — 조용히 빠뜨리지 않는다.
4. 항목마다 **회귀 테스트**를 붙인다. 테스트 없는 수정은 인정하지 않는다.
   새 테스트가 **수정 전 코드에서 실패하는 것을 먼저 확인**한다(그러지 않으면 공허한 테스트가 된다 — 실제로 몇 번 그랬다).
5. 메타데이터를 올린다 — 아래 "라운드 번호" 참고.
6. `docs/rounds/28-(N+1)/수정사항.md`·`검증결과.md`를 쓴다. **숫자는 명령 출력을 그대로 인용한다.** 손으로 세지 않는다.
7. 게이트 4종(`check`는 `format:check`부터 시작한다)을 돌리고, 푸시 → PR → CI 초록 확인 → 병합.
8. 병합 후 `deploy-check`이 라이브 번들에서 새 라운드를 확인하는 것을 읽는다. **그 전에는 "배포됐다"고 적지 않는다.**

### 라운드 번호는 `package.json`의 `version` minor가 단일 출처다

`28.76.0` → `28-76`. 두 워크플로가 같은 곳을 읽는다. 라운드를 올릴 때 함께 맞출 것:

```
package.json           "version": "28.(N+1).0"  +  "description"의 예시 번호
package-lock.json      npm install --package-lock-only 로 루트 버전을 같이 맞춘다 (28-91: Copilot이 28.89↔28.90 불일치를 짚었다)
src/App.tsx            <span className="round">28-(N+1)</span>
docs/rounds/28-(N+1)/  문서 폴더 생성
_원바이원_감사대기_상태.json   "watchingRound": N+1
```

`gates.yml`의 "라운드 확인" 단계가 **셋을 함께 검사**한다(문서 폴더 존재 · `App.tsx` 표기 · version).
어긋난 채로는 CI를 통과하지 못한다.

`vercel.json`에는 라운드가 없다 — `outputDirectory: dist`로 고정이다. **여기를 라운드 경로로 고치면 배포가 깨진다.**

## 의존성

`.github/dependabot.yml`은 루트 하나(`directory: /`)를 본다. 락파일이 하나뿐이라 알림도 하나의 출처에서 나온다.
`npm audit --audit-level=high` **0건 유지**가 기준이고, CI가 매 PR에서 차단한다.

## 서버

**서버 저장 계층과 계정·세션 API는 있고, 프로덕션 DB는 아직 안 붙었다.** 배포된 앱은 **로컬 모드**
(`VITE_AUTH_MODE` 미설정)라 상태가 방문자 브라우저의 `localStorage`에 있다(`banded-platform-v1`, `banded-auth-v1`).
서버 모드로 켜는 절차(Neon → 스키마 → `ADMIN_PASSWORD` → `VITE_AUTH_MODE=server` → 재배포)는 `docs/rounds/28-68/서버_연결.md`.

- 28-67 — 경계: `src/domain/ports.ts`의 `SnapshotPort`와 `src/domain/replicator.ts`(write-behind 복제기).
- 28-68 — 반대편: `db/schema.sql`, `api/snapshot.ts`, `src/domain/ports/httpPort.ts`. CI가 진짜 Postgres 16에 대고 검증한다.
- 28-69 — 붙여도 안 깨지게: **rev를 저장소가 발급**한다(기기별 카운터로는 두 기기가 conflict 없이 덮어썼다),
  복제기의 타이머 둘(디바운스·백오프)과 끈적한 `stop()`, 거부(`rejected`)는 재시도하지 않는다.
- 28-70 — 계정·세션: `api/auth.ts`가 **클라이언트와 같은 `AuthService`**를 Postgres 행 위에서 돌리고 세션 토큰을
  발급한다(서버에는 sha256만). `/api/snapshot`은 세션 토큰으로만 열린다(`WORKSPACE_SECRET` 없앰). 클라이언트의
  `AuthService`는 서버 모드에서 거울이고 변경은 `authActions`로. 탭 복귀는 `head`로 rev만 확인하고(28-69-01),
  복제 커서는 탭 사이에 공유된다(28-69-02). CI `server` job이 서버 모드로 빌드해 기기 셋 e2e를 돈다.
- 28-71 — 켤 수 있게: 가입 코드(`SIGNUP_CODE`, 가입이 곧 전체 권한이므로), 손상 리셋 뒤 낡은 커서 무효화(빈 로컬이 서버를 덮지
  않는다), e2e truncate 가드, 세션 정리, IP 실패 제한, 503 일반 문구. 켜기 전제는 `docs/rounds/28-68/서버_연결.md`.
- 28-72 — 두 번째 사용자부터: 로그인이 첫 접촉(accept)을 기다린다(두 번째 파트너의 프로필 시드가 사라졌다), 잠금 키에 요청 IP
  (관리자 잠금 DoS 차단), 가입 코드 12자·오류 가중치, `verifyOtp`도 가입 코드, e2e 가드 단어 경계, 기기 D e2e.
- 28-73 — 고친 것이 정말 고쳐졌는가: `sync()`가 **자기 일**이 끝나는 Promise를 돌려준다(진행 중 동기화가 있으면 로그인이 남의
  sync를 기다리고 끝났다), 잠금 2단(계정당 30회 — IP를 바꿔도 무한히 시도할 수 없다), conflict로 **덮이는 본문 보관**
  (`banded-platform-v1:overwritten`, 관리자 백업 카드에서 내려받기), `검증결과.md` §7 세 라운드를 실제 deploy-check 로그로,
  요청 IP를 못 믿을 때 경고.
- 28-74 — 보관함이 저장을 막지 않게: 덮인 변경 보관함을 **용량 회계 안으로**(`externalChars` — 카드·가드가 합계로 본다)
  + 예산(한도의 1/4, 넘치면 오래된 것부터), 보관함 **전체 목록 UI**(항목마다 내려받기 · 비우기), 보관함 계약 테스트,
  계정 잠금의 **최근 성공 IP 면제**(관리자 DoS를 되살리지 않으면서 무차별 대입은 계속 막는다).
- 28-75 — 보관함이 진 의무를 지게: 보관 예산이 **남은 자리**를 넘지 않는다(보관이 그 기기의 저장을 막는 일이
  구조적으로 사라진다 — 비울 화면이 관리자에게만 있으므로 중요하다), 탈퇴가 `trustedIps`·`loginFails`의
  **전화번호 키까지** 버리고 `pruneTrustedIps`가 30일로 쓸어낸다(파기 약속을 지킨다), 프록시 헤더를 못 믿으면
  잠금 **범위 없이** 간다(면제도 기록도 없다), "보관했습니다"는 **보관했을 때만** 말한다.
- 28-76 — 보관함은 그 자리의 사람 것이다: 예산이 **받아들일 원격 본문**까지 센다, **부팅 때 한 번**
  보관함을 예산에 맞춘다(28-74에 막힌 기기를 실제로 푸는 유일한 조치), 신뢰 IP 스윕에 **시간 게이트**
  (로그인마다 전체 계정을 훑지 않는다 — 무차별 대입이 CPU를 계정 수만큼 먹었다),
  보관함을 **역할 무관 부품**으로(`OverwrittenBox` — 관리자·파트너·고객이 같은 것을 쓴다).
- 28-77 — 게이트가 실제로 남게: 신뢰 IP 스윕이 **정리 결과를 저장**한다(하지 않으면 다음 부팅이 같은 일을 다시
  한다), 실패·신뢰 IP 키를 **가명(솔트 + sha256 앞 32자)으로** 잡는다(스냅샷에 전화번호 원문이 남지 않는다 —
  솔트가 없는 구 스냅샷은 두 지도를 버리고 다시 시작한다), 감사 로그 라벨은 마스킹본으로 따로 만든다.
- 28-78 — 시연 데이터 복구: 첫 방문 시드가 `고객 결제 완료 후 정산할 수 있습니다`로 **오래 죽어 있던** 것을
  복구했다(`payFinal` 한 줄 누락 — 부팅이 통째로 실패해 라이브가 빈 화면이었다). 용량이 모자라면 보관함이
  **양보한다**(`trimExternal` — 새로고침 전까지 아무것도 풀리지 않는 자리가 사라졌다), 보관함 정리도 운영 기록에 남는다.
- 28-79 — 시연 지표를 내걸지 않는다: 복구한 시드가 랜딩에 "누적 요청 6 · 완료된 수리 3 · 낙찰률 100%"로 걸린 것을
  막았다. `RepairRequest.seeded` 표식(**저장되는 필드** — 시드가 만든 요청에만 붙는다)과 `hasRealActivity()`,
  정리 정책을 부팅·런타임 한 기준으로, 감사 로그 행위명은 도메인이 정한다(`recordStashTrim`).
- 28-80 — 공개 지표에서 시드를 뺀다: 28-79는 지표를 **켜고 끄기만** 해서, 실제 요청이 1건 생긴 순간 여전히
  "누적 7 · 완료 3 · 낙찰률 100%"가 나갔다(뒤의 둘은 전부 시드). `publicStats()`가 **시드를 빼고** 세고 랜딩은
  그것만 쓴다. 관리자 설정에 **시연 데이터 지우기**(요청과 그 위성 레코드를 함께 — 고아를 남기지 않는다),
  런타임 보관함 정리가 **실제 지운 건수**를 기록한다(늘 1이었다).
- 28-81 — 지표는 서버 모드에서만: 로컬 모드의 `publicStats()`는 플랫폼이 아니라 **그 브라우저**의 값이라
  (저장소가 localStorage) 방문자마다 다른 "누적 실적"을 봤다. `showPublicStats(AUTH_MODE, stats)`가
  **서버 모드 + 끝낸 수리 1건 이상**일 때만 내걸게 한다. 시연 삭제에 확인 문구·삭제 직전 상태 파일·지운
  요청 번호 기록, 낙찰률 루프를 `bidStats(_, {excludeSeeded})` 하나로, 호출자가 사라진
  `hasRealActivity()` 제거, `chatReads` 키를 만드는 곳을 하나로.
- 28-82 — 고객에게 보이는 모든 숫자: 랜딩만 고치는 방식이 끝나지 않는다는 것을 인정하고 **고객 화면을
  전수조사**했다(`docs/rounds/28-82/고객화면_조사.md`). 집계는 셋뿐이고 그중 둘이 새고 있었다 — 견적함의 업체 카드가
  시드로 만든 "완료 3건 · 낙찰률 100%"를 구매 결정의 근거로 내밀었다. `publicPartnerSummary()` ·
  `publicReviews()`로 고객 경로를 나누고, `customerSurfaces.test.ts`가 규칙을 지킨다. 히어로 지표는
  이제 **실제로 렌더해서**(`react-dom/server`) 숫자까지 단언한다, 삭제 직전 파일이 원본임을 파일명·안내에
  드러내고, `CHAT_VIEWERS`를 `ChatSender`에 타입으로 묶었다.
- 28-83 — 가드가 자기 자신을 지키게: 28-82의 가드는 **금지 API 목록이 손으로 적힌 전부**여서, 시드에
  민감한 집계가 새로 생기면 조용히 통과했다(28-78-04가 이름 붙인 "목록이 CI를 좌우한다"가 파일 목록이
  아니라 API 목록에서 되풀이). 이제 도메인에서 유도해 **하한**으로 검사하고, 유도가 덜 잡는 것까지
  개수로 확인한다. 도달 범위를 `src` 전체(도메인 제외)로 넓히고, 랜딩의 **기본값 경로를 실행하는**
  테스트를 더했다(28-82는 늘 `authMode`를 넘겨 그 경로가 0건이었다).
- 28-84 — 유도의 양 끝을 근거 위에: 28-83은 "목록 대신 유도"를 옳게 시작했지만 **유도의 양 끝이 아직
  손으로 적힌 경로**였다. 읽는 곳이 `platform.ts` 한 파일이라 다른 도메인 파일에 집계가 생기면 검사가
  빈 배열로 통과했고(→ `src/domain` 전체), 출발하는 곳이 디렉터리 두 개라 랜딩을 렌더하는 `App.tsx`부터가
  시야 밖이었다(→ `App.tsx`의 고객 라우팅에서 유도, App은 잎으로만). 가드는 호출 형태 대신 **식별자**를
  보고(구조 분해 우회 차단), 원자료 직접 계산은 못 잡는다는 **한계를 문서에 적었다**. 그리고 랜딩
  기본값 경로를 **서버 모드에서도** 렌더한다 — 28-83의 단언은 부정형뿐이라 서버 모드만 죽이는 한 줄이
  타입·테스트 486건·빌드를 전부 통과했다.
- 28-85 — 가드의 구멍과 익명 방문자: 28-84의 두 수정이 각각 새 우회로를 열었다. `hidden` 판정이
  수식어가 아니라 **이름까지** 봐서 `privateNotesSummary` 같은 공개 집계가 조용히 빠졌고(고객 화면이
  불러도 초록), 거짓 경보를 막으려 넣은 문자열 제거가 `platform['partnerSummary']()` 와 템플릿
  리터럴을 **둘 다** 통과시켰다. 셋 다 고치고, 랜딩 진입점도 라우팅에서 유도한다(`'Landing'` 이라는
  마지막 손 이름 제거). 문서의 한계 서술도 사실에 맞게 고쳤다 — 적어 둔 한계가 실제보다 좁으면
  가드의 침묵이 안전으로 읽힌다. 그리고 **네 라운드째 이월하던 익명 방문자 문제를 닫았다**:
  세션 없는 `/api/public-stats`가 집계 다섯 개만 내보내고, `/api/snapshot`은 세션 게이트 그대로다.
- 28-86 — 가드가 타입을 본다: 텍스트 스캐너가 **세 라운드 연속으로** 새 구멍을 만들었다.
  28-85의 것은 특히 나빴다 — JSX 본문의 아포스트로피(`It's`) 하나가 같은 줄의 집계 호출을 통째로
  가렸고, 앞선 우회들과 달리 **실수로 일어난다**. 정규식을 버리고 TypeScript 컴파일러 API로 간다:
  수신자의 **타입**이 `PlatformService`인지 검사하므로 속성·대괄호·구조 분해가 같은 것이 되고,
  주석·문자열·JSX는 애초에 후보가 아니라 `guard-ok` 면제 장치도 없앴다. 그리고 인증 없는 공개
  엔드포인트에 **rev 캐시**를 넣었다 — 28-85는 요청마다 최대 4MB를 파싱하면서 그 위험을
  "유출 가치가 낮다"고 잘못 적었다. 비용은 유출이 아니라 자원 소모다. 공개 집계 요청에는
  5초 타임아웃을 붙였다(무응답이 실패로도 처리되지 않아 지표가 영영 안 뜨던 경로).
- 28-87 — 가드의 남은 구멍 · 공개 경로가 로그인을 굶지 않게 · **서버 모드 전환 준비**:
  28-86의 타입 가드도 정적으로 뚫렸다 — 수신자의 **심볼 이름**을 봐서, `Pick<PlatformService, …>`로
  좁혀 받거나 스프레드로 통째 복사하면 조용히 통과했다. 이름 대신 **선언 소유**를 본다(이 속성이
  `PlatformService` 클래스 본문에 선언돼 있는가) — 가공된 타입을 따라가고 거짓 경보도 줄었다.
  그리고 그것을 확인하던 테스트가 **자기 이름이 말하는 것을 확인하지 않았다**(관리자 화면에는
  속성 접근밖에 없어서 나머지 두 경로를 한 번도 안 태웠다) — 픽스처에 다섯 형태를 심어 정확 비교한다.
  공개 지표 경로는 `select rev`가 매 요청 나가 **커넥션 3개짜리 풀을 로그인과 나눠 쓰고 있었다**:
  5초 TTL + 단일 비행으로 워크스페이스당 5초에 최대 하나만 잡는다.
  **그리고 프로덕션이 28-68 이후 스무 라운드 동안 로컬 모드였다는 사실을 기계가 말하게 했다** —
  모드가 서빙 번들에 리터럴로 박히고 `deploy-check`가 그것을 읽어 보고한다(로컬이면 경고, 표식이
  없으면 실패). `npm run preflight:server`와 `docs/rounds/28-87/서버_모드_전환.md`로 켤 준비를 갖췄다.
  **켜지는 않았다 — 실제 사용자 데이터가 걸린 판단이라 사장님 몫이다.**
- 28-88 — 한 프로세스에서만 참인 가정을 걷어낸다: 28-87 감사 넷 중 둘이 **같은 뿌리**에서 나왔다 —
  Vercel에서 `api/`의 파일은 각각 별도 함수라 **모듈 전역 상태가 함수마다 따로**다. 그래서 28-87이
  적은 "풀 `max: 3`을 로그인과 나눠 쓴다"는 프로덕션에 없는 공유였고, "쓴 쪽이 캐시를 버린다"는
  **다른 함수의 캐시**라 읽는 쪽에 닿지 않았다. 무효화를 정교하게 만드는 대신 **TTL을 없앴다** —
  매 요청 rev 한 번을 읽고 바뀔 때만 본문을 가져오면, 낡은 값이 굳는 창도 프로세스 밖 가정도 없다.
  공개 경로는 DB 오류에 500 대신 **503으로 접고**(인증 경로와 같은 수준), 모드 표식 검사는
  `deploy-check`(배포 뒤)에서 `visual-check`(**병합 전**)로 앞당겼다.
  그리고 같은 뿌리의 다른 가지를 찾아 **전수조사**했다: `server/rateLimit.ts`는 28-70에 이미 정확히
  적혀 있었다 — 한 번 알았다가 잊는 것이 문제였다. `server/serverlessState.test.ts`가 이제
  `api/`·`server/`의 모듈 전역 가변 상태를 유도로 찾아 **인스턴스 경계를 적었는지** 검사한다
  (주석이 참인지까지는 검사하지 못한다 — 그 한계를 문서에 적었다).

- 29-1 — **참고본 v17로 갈아타기 1단계**(`docs/참고_v17_대조.md`): v17의 서버 계층(`lib/`)을 그대로 들여오고, 그
  도메인이 쓰는 작은 `Database` 포트를 Postgres로 구현했다(`server/pgPort.ts`). SQLite 마이그레이션을 Postgres
  스키마로 옮기는 변환기(`scripts/pg-schema.mjs` → `db/marketplace.pg.sql`, 표 30·외래키 29·트리거 17)를 두고,
  v17의 통합 테스트 141개를 고치지 않은 채 통과시킨 뒤 같은 도메인을 진짜 Postgres에서 한 번 더 태운다
  (`npm run test:pg`). 화면·배포는 이 라운드에서 바뀌지 않는다.
- 29-2 — **v17 도메인을 우리 세션으로 HTTP에 올린다**: v17은 전체 API가 파일 하나이고 신원을 만드는 자리도 한
  곳뿐이라(`getChatGPTUser` → `svc.identity`), 그 자리만 우리 세션으로 바꾸면 로그인이 교체된다. v17의
  `chatgpt-auth.ts`는 들이지 않고 `server/identity.ts`가 우리 `AuthSession`을 v17 `User`로 옮긴다. 경로 표는
  `server/marketplaceApi.ts`에 원본 그대로 두고 바깥 결합만 갈았다(D1 → `pgDatabase`, R2 → 아직 없으니 사진
  경로는 503, Cloudflare `env` 제거). 인가는 어댑터가 아니라 도메인이 한다 — `role(u, 'ADMIN')`이 그대로 산다.
  화면은 바뀌지 않는다(`src/`에서 바뀐 줄은 라운드 표기 하나). 검증은 `npm run test:mp` 9건이 실제 Postgres에
  대고 주문 한 바퀴와 거부 경로를 돈다. 앱 셸·화면 전환은 29-3이다 — React 18/19가 한 저장소에 못 있어
  쪼갤 수 없는 덩어리라, 서버를 먼저 증명해 두고 그때 화면만 깨지게 한다.
- 29-3 — **Next.js 앱 셸이 선다**: v17 화면(`components/` 79개)과 디자인을 원본 그대로 들이고, 우리 핸들러를
  v17이 부르는 자리(`/api/*`)에 붙였다. 프레임워크 교체로 고친 것은 어댑터 한 파일이고 API 핸들러 본체는
  그대로다 — 28-68부터 순수 함수로 유지해 온 값이다. 타입 검사는 프로젝트 셋으로 나눴다(Next가 루트
  tsconfig를 정규화해 서로를 덮어쓴다). Next 16.2.6이 critical 11건을 물어 16.3.4로 올렸다. **라이브는
  안 바뀐다.** 29-2에 적었던 "React 두 개는 공존 못 한다"는 판단은 틀렸고, 정정을 대조 문서에 달았다.
- 29-4 — **전환 준비**: 새 셸이 자기 라운드·인증 모드를 HTML로 말하게 하고(`next.config.ts` → `app/layout.tsx`,
  v17 원본 중 계측을 위해 손댄 유일한 파일), 배포 확인이 옛 SPA와 새 셸을 **둘 다** 판정하게 했다. 그래서
  다음 라운드는 `vercel.json`만 바꾸면 된다. 라이브는 여전히 SPA다 — 전환은 라이브 환경변수 확인이 필요해
  29-5로 뒀다.
- 28-97 — 결제 멱등 키 · 정산 = 총액 − 환불 − 수수료(참고 v12 대조 "더할 것" 7번): 결제가 **주문(ready) → 승인(done) |
  실패**의 수명주기를 갖는다. 주문번호(`BD-<요청>-<종류>-<번호>`)가 곧 멱등 키라 같은 주문의 승인은 몇 번을 보내도 결제
  한 건이다(`preparePayment`/`confirmPayment`/`failPayment`). 관리자는 완료 거래에 **부분 환불**을 걸 수 있고, 처리되면
  수수료가 (총액 − 환불) 기준으로 다시 산정된다 — 지급액 = 총액 − 환불 − 수수료(`settlementFor`). 결제사(토스페이먼츠)
  어댑터 `server/toss.ts`와 `api/payments.ts`가 붙었지만 키가 없으면 켜지지 않는다(지금 프로덕션은 기록 결제).
  남은 연결점은 `docs/rounds/28-97/결제_연동.md`.
- 28-96 — 추가 공사 공급가+VAT · 작업 전/후 사진(참고 v12 대조 "더할 것" 6번): 추가 작업은 공급가를 받아 VAT 10%를 얹어
  기록하고(`supply`·`vat`·`amount`, 구 데이터는 `amount`만), 작업 전 사진(`beforePhotos`, 방문 예정부터)이 생겼다. 계약 경로(28-95)
  작업은 전/후 사진이 각 1장 이상 있어야 완료된다(`completeJob`). 파트너 내 작업·고객·관리자 상세에 전/후 띠와 공급가·VAT 표기.
- 28-95 — 계약서 · 일정 변경 제안·수락(참고 v12 대조 "더할 것" 5번): 낙찰 뒤 파트너가 **계약서**(예약금·조건·방문 일정, 관리자가 정한
  주문별 수수료 bps)를 보내고 고객이 동의해야 방문이 확정된다(`proposeContract`/`decideContract`, 버전·superseded). 예약금은 계약의
  금액, 수수료는 계약의 bps로 정산한다. 파트너의 일정 변경은 **제안 → 고객 승인**(`proposeSchedule`/`decideSchedule`)이고 단독 변경은
  막힌다. 파트너 일정 탭·고객 거래 상세·관리자 거래 상세가 바뀌었다.
- 28-94 — 상세 주소·연락처 접수 · 낙찰 전 파트너 가림(참고 v12 대조 "더할 것" 4번): 요청에 `address`(5~200자)·`phone`(010)을
  싣고, 파트너에게 보이는 요청은 `requestForPartner`를 지난다 — 낙찰 파트너가 아니면 주소·연락처·현장 사진이 빠지고 이름은
  `정*훈`으로 가려진다(일감·입찰, 내 작업의 미낙찰 행, 대시보드). 본인 반출에는 담고 파트너 반출·가명본에는 없다. 본인 반출의
  자체 검사가 본인 번호를 실명으로 오인하던 것을 e2e가 잡았다.
- 28-93 — 여러 분야 동시 선택 · 안전 질문 · 관리자 접수 검토(참고 v12 대조 "더할 것" 3-2): 요청이 분야 묶음
  (`categories`, 첫 항목이 주 분야)을 싣고, 분야가 정하는 안전 질문 둘(문 잠김·긴급 증상)을 접수 전에 묻는다
  (`src/domain/safety.ts`, 참고안 `questions()`/`safety()` 규칙 그대로 — 미답·안내 확인·설명 대조). 잠김·긴급·"분야를 모르겠어요"·
  범위 검토 분야는 `MANUAL_REVIEW`로 **관리자가 현황 카드에서 검토를 끝내야 파트너에게 보이고 입찰이 열린다**
  (`reviewRequest`, `heldForReview`). 가명본은 `safety`를 중첩 허용 목록으로 선언했다(e2e가 잡았다). 직영/중개 라우팅은
  중개뿐이라 접었다.
- 28-92 — 홈=요청 폼 · 서비스 카탈로그 · 전국 시·도(참고 v12 대조 "더할 것" 1번): 카테고리 13개(부위 이름)를
  참고안의 **5 그룹 / 19 분야 + "분야를 모르겠어요"** 로 바꿨다(`src/domain/catalog.ts`, 식별자는 라벨, 코드는 나란히).
  옛 라벨은 스냅샷을 읽을 때 옮기고(`migrateLegacyCategories`), `addRequest`가 분야를 처음으로 검증한다. 지역은 자유
  입력 대신 **17 시·도 → 시·군·구** 두 select(`RegionSelect`)로, 저장 형식(`"서울 강서구"`)은 그대로라 매칭·가명본 축약이
  맞는다. 홈 히어로의 사진 자리에 **요청 폼 카드**(그룹 탭 + 분야 카드 20장, `CategoryPicker`)가 들어가 분야를 고르는
  순간 접수가 시작된다. 여러 분야 동시 선택·안전 질문은 28-93에서.
- 28-91 — 시연 데이터·공개 지표 제거(참고 v12 대조 1단계): 28-78~28-88 열한 라운드가 시연 시드를 되살리고,
  가리고, 빼고, 지우는 통로를 만들고, 그 규칙을 지키는 가드를 네 번 고쳐 쓴 끝에 — 참고 시안처럼 **빈 상태에서
  시작**하기로 했다. `seedPlatform`·`seeded`·`clearSeedData`·`excludeSeeded`·`public*`·`publicStats`·
  `api/publicStats.ts`·랜딩 히어로 숫자·시드 가드(`customerSurfaces.test.ts`)를 전부 지웠다(코드 −1.4k줄).
  e2e 여정은 파트너2 입찰·맞춤 토글이 쓰던 시드 일감 둘을 **고객이 직접 올리는** 단계로 바꿨고, 지급 대기·정산
  완료 개수 단언은 시드 3건이 빠진 값이다.
- 28-90 — 참고 v12 대조 정리 라운드: 사용자가 이 플랫폼을 다른 스택으로 "최적화해 다시 만든" 시안을 주고
  **쓸데없는 것은 빼고 그 방향으로 더하자**고 했다. 대조표와 이후 라운드 순서는
  `docs/rounds/28-90/참고_v12_대조.md`. 이번에 뺀 것: **A/S 와 분쟁을 분쟁 하나로**(열린 분쟁은 `settle`·
  `markPayout`을 거절한다 — 보증 기간·`kind`·`warrantyStatus` 삭제), **다크 모드 제거**, 루트의 라운드 폴더
  89개를 `docs/rounds/`로. 더한 것: 정산 계좌는 **예금주가 가입한 이름과 같아야** 저장되고, **관리자가 인증한
  계좌만** 지급된다(`verifyPayoutAccount` op, 매니저 이상). 정리: prettier 도입(`npm run check`의 첫 단계가
  `format:check`, 첫 적용 86 파일), 테스트 다섯 곳의 메모리 저장소 복붙을 `src/testFixtures/memoryStorage.ts`
  하나로. 시연 데이터·공개 지표 제거는 e2e 얽힘 때문에 28-91로 넘겼다.
- 28-89 — 관리자 등급과 첫 화면 배치를 사람 손에 준다: 28-88까지 관리자는 계정 **하나**였고, 랜딩의
  섹션 순서는 28-17부터 **코드에 박혀** 있었다. 이제 관리자는 소유자·매니저·열람 세 등급이고
  (`src/domain/adminGrade.ts`의 표 하나가 도메인·서버·화면의 근거다), 첫 화면의 섹션 **순서·노출·제목**은
  관리자 설정에서 바꾸는 데이터다(`settings.landing`). 등급은 세션에 실려 `sessions.grade`로 서버까지 가고,
  열람 세션의 `PUT /api/snapshot`은 403, 매니저의 관리자 관리·파기 op도 403이다. 등급을 바꾸면 그 사람의
  서버 세션이 폐기된다 — 옛 등급이 토큰에 남지 않게. **막지 못하는 것을 같이 적는다**: 스냅샷은 통째 쓰기라
  서버가 매니저와 소유자를 `PUT`에서 구별하지 못한다(엔티티 단위 API가 생겨야 막힌다 — 계속 이월).
  28-88 감사 3건도 함께: 대기열이 찼을 때의 빈 응답이 `public, max-age=60`을 달고 나가 **CDN이 "실적 없음"을
  60초 퍼뜨릴 수 있었고**(→ `no-store` + `degraded: true`), `pg`의 쿼리 타임아웃이 **무한**이라 멈춘 쿼리
  하나가 공개 경로를 얼렸으며(→ 8초 쿼리 상한 + 4초 대기 상한), 서버리스 가드가 **파일 밖의 변형**을 놓쳤다
  (→ 저장소 전체에서 찾는다). 28-88-05가 "28-87의 두 결함 다 멈췄을 것"이라고 적은 것은 과장이라
  그 문서에 정정을 달았다 — 한 결함은 이미 "서버리스"라는 단어 때문에 통과했을 것이다.

로컬 모드의 `initReplicator()` 원격은 `MemoryRemotePort`, 서버 모드는 `HttpSnapshotPort`(세션 토큰). 스냅샷은
마켓플레이스 전체라 워크스페이스는 하나이고, "사용자별 분리"는 인증까지만 가능하다(인가는 엔티티 단위 API의 일) —
`docs/rounds/28-68/서버_연결.md`.
