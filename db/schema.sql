-- 서버 저장소 (28-68 → 28-70)
--
-- 부분 저장 개념이 없는 현재 모델 그대로 — 워크스페이스 하나당 스냅샷 한 행이다.
-- `SnapshotPort`(src/domain/ports.ts)의 계약을 그대로 옮긴 것이고,
-- 낙관적 동시성(`expectedRev`)이 SQL의 `where rev = $expected` 한 줄이 된다.
--
-- 적용: psql "$DATABASE_URL" -f db/schema.sql   (멱등하다 — 여러 번 돌려도 된다)

create table if not exists snapshots (
  -- 워크스페이스 식별자. 스냅샷은 마켓플레이스 전체라 프로덕션에서는 **하나('main')**다 (28-69 정정).
  -- 여러 값이 있는 것은 CI 계약 테스트가 격리된 행을 쓰기 위해서다. 테넌트 경계가 아니다.
  workspace_id text        primary key,
  -- 저장소가 발급하는 리비전 (28-68-01). 쓰기마다 +1, 기기 간 변경 감지의 기준
  rev          bigint      not null,
  -- 직렬화된 스냅샷 본문 (JSON 문자열). jsonb가 아니라 text인 이유:
  -- 도메인이 만든 바이트를 그대로 되돌려줘야 rev와 본문이 정확히 짝이 맞는다.
  body         text        not null,
  updated_at   timestamptz not null default now()
);
-- 28-70: 통째 쓰기의 책임 귀속 — 누가 이 rev를 썼는가 (계정 ID). 인가는 못 해도 귀속은 한다
alter table snapshots add column if not exists updated_by text;

-- 28-70: 계정 상태. 클라이언트의 `banded-auth-v1`과 **같은 JSON**(AuthService 스냅샷, sessions 제외).
-- 서버가 같은 AuthService로 이 행을 읽고 규칙을 적용한 뒤 다시 쓴다 — 가입 검증·해시·잠금·OTP·승인 규칙이
-- 클라이언트와 한 코드다. 한 워크스페이스에 한 행. 트랜잭션 + `for update`로 op를 직렬화한다.
create table if not exists auth_state (
  workspace_id text        primary key,
  rev          bigint      not null,
  body         text        not null,
  updated_at   timestamptz not null default now()
);

-- 28-70: 세션. 토큰 원문은 저장하지 않는다 — sha256 hex만. 만료·폐기 가능.
create table if not exists sessions (
  token_hash   text        primary key,
  workspace_id text        not null,
  account_id   text        not null,
  role         text        not null check (role in ('customer', 'partner', 'admin')),
  name         text        not null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index if not exists sessions_account on sessions (workspace_id, account_id);

-- 28-89-A: 관리자 세션의 등급. 서버가 관리자 op 와 스냅샷 쓰기를 열 때 본다(열람 등급은 쓰기 403).
-- 고객·파트너 세션은 null. 등급이 바뀌거나 관리자가 제거되면 그 계정의 세션은 폐기된다(api/auth.ts).
alter table sessions add column if not exists grade text check (grade in ('owner', 'manager', 'viewer'));

-- 29-17: 데이터 분리 표식. 주소가 다르다는 것과 **데이터가 다르다**는 것은 다른 말이라,
-- 프리뷰에서 남긴 표식이 운영에는 없다는 것을 사람이 두 화면으로 확인한다.
-- 운영에는 쓰지 않는다(핸들러가 VERCEL_ENV=production 을 거부한다). 지우는 코드도 두지 않는다.
create table if not exists diagnostic_probes (
  id         text        primary key,
  deploy_env text        not null,
  created_at timestamptz not null default now()
);
