#!/usr/bin/env node
/**
 * **서버 모드로 켜기 전에 확인하는 것들** (28-87-05).
 *
 * 프로덕션은 28-68 이후 스무 라운드 동안 **로컬 모드**로 배포돼 왔다. 서버 계정·세션
 * API가 전부 만들어져 있지만 라이브에서는 하나도 실행되지 않는다. 켜는 것은 사장님 결정이고,
 * 이 스크립트는 **켜기 전에 기계가 확인할 수 있는 것을 먼저 확인한다** — 켠 뒤에 알게 되면
 * 그때는 실제 사용자가 로그인하지 못하는 상태다.
 *
 * 쓰는 법:
 *   DATABASE_URL=... ADMIN_PASSWORD=... node scripts/server-mode-preflight.mjs
 *
 * 무엇을 확인하지 **않는가**: 브라우저에 남아 있는 기존 데이터가 서버로 옮겨졌는지.
 * 그것은 사람이 백업 내려받기 → 서버 모드 로그인 → 복원으로 해야 한다 (docs/rounds/28-87/서버_모드_전환.md).
 */
import { Client } from 'pg'

const checks = []
const add = (name, ok, detail) => checks.push({ name, ok, detail })

const env = process.env
for (const key of ['DATABASE_URL', 'ADMIN_PASSWORD']) {
  const v = env[key]
  add(
    `환경변수 ${key}`,
    typeof v === 'string' && v.length > 0,
    v ? '설정됨' : '없음 — 서버 모드에서 이 값이 없으면 인증이 동작하지 않는다',
  )
}
// 약한 비밀번호로 켜는 것은 켜지 않는 것보다 나쁘다 — 관리자 계정이 곧 전체 데이터다
const adminPw = env['ADMIN_PASSWORD'] ?? ''
add('ADMIN_PASSWORD 길이 12자 이상', adminPw.length >= 12, `${adminPw.length}자`)

if (env['DATABASE_URL']) {
  const client = new Client({ connectionString: env['DATABASE_URL'] })
  try {
    await client.connect()
    add('DB 연결', true, '성공')
    const { rows } = await client.query(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1)`,
      [['snapshots', 'auth_state', 'sessions']],
    )
    const found = new Set(rows.map((r) => r.table_name))
    for (const t of ['snapshots', 'auth_state', 'sessions']) {
      add(`테이블 ${t}`, found.has(t), found.has(t) ? '있음' : 'psql "$DATABASE_URL" -f db/schema.sql 을 적용하세요')
    }
    if (found.has('snapshots')) {
      const { rows: snap } = await client.query(
        `select workspace_id, rev, length(body) as bytes, updated_at from snapshots order by updated_at desc limit 5`,
      )
      add(
        'snapshots 행',
        true,
        snap.length === 0
          ? '비어 있음 (켠 뒤 첫 저장이 만든다)'
          : snap.map((r) => `${r.workspace_id} rev=${r.rev} ${Math.round(r.bytes / 1024)}KB`).join(' · '),
      )
      // 28-69 정정: 프로덕션 워크스페이스는 'main' 하나다. 여러 개면 CI 잔재이거나 설정이 어긋난 것이다.
      const others = snap.filter((r) => r.workspace_id !== 'main')
      add(
        '워크스페이스가 main 하나',
        others.length === 0,
        others.length === 0 ? 'main만 있음' : `main 외: ${others.map((r) => r.workspace_id).join(', ')}`,
      )
    }
  } catch (err) {
    add('DB 연결', false, String(err instanceof Error ? err.message : err))
  } finally {
    await client.end().catch(() => {})
  }
}

let failed = 0
console.log('\n서버 모드 프리플라이트\n' + '─'.repeat(60))
for (const c of checks) {
  if (!c.ok) failed += 1
  console.log(`${c.ok ? '✓' : '✗'} ${c.name.padEnd(30)} ${c.detail ?? ''}`)
}
console.log('─'.repeat(60))
if (failed > 0) {
  console.log(`${failed}건이 준비되지 않았습니다 — 켜기 전에 해결하세요.`)
  process.exit(1)
}
console.log('모두 통과. 남은 것은 사람이 할 일입니다 — docs/rounds/28-87/서버_모드_전환.md 의 절차를 따르세요.')
