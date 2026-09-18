import { readFileSync } from 'node:fs'
import pg from 'pg'

/**
 * 계정·세션 표를 **모든 테스트 파일보다 먼저, 한 번만** 세운다 (29-24).
 *
 * ## 두 가지를 한꺼번에 고친다
 *
 * **하나. 순서 의존.** `tests/marketplace.http.test.ts` 는 `public.sessions` 를 쓰면서 그것을 남이
 * 만들어 주기를 기다리고 있었다. 빈 DB 에 그 파일만 돌리면 열두 줄이 `relation "sessions" does not
 * exist` 로 죽는다. CI 는 작업 절차에서 `psql -f db/schema.sql` 을 먼저 돌려 그 의존을 가려 왔다.
 *
 * **둘. 돌다가 스키마를 건드리지 않는다.** 이것을 각 파일의 `beforeAll` 에서 부르면 검사가 **도는
 * 도중에** DDL 이 실행된다. `db/schema.sql` 의 `alter table ... add column if not exists` 는 바꿀
 * 것이 없어도 그 표에 배타 잠금을 잡는다. 다른 파일이 같은 표를 읽고 쓰는 중이라 겹칠 이유를
 * 만들지 않는 편이 낫다 — 실제로 그것 때문에 실패한 것을 본 적은 없고, 미리 피하는 것이다.
 *
 * `globalSetup` 은 어떤 테스트 파일도 시작하기 전에 한 번 돈다. 그래서 DDL 과 검사가 시간상 겹치지
 * 않는다. 문장은 전부 멱등이라 이미 선 DB 에 다시 돌려도 같다.
 *
 * `DATABASE_URL` 이 없으면 아무것도 하지 않는다 — DB 없이 도는 단위 테스트를 막지 않는다.
 */
export default async function setup(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (url === undefined || url === '') return
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    await c.query(readFileSync('db/schema.sql', 'utf8'))
  } finally {
    await c.end()
  }
}
