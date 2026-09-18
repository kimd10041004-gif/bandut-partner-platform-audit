import type { Pool } from 'pg'
import { getPool } from './db'
import { BASE_SQL, MARKETPLACE_SQL } from '../db/schema.generated'

/**
 * **서버가 자기 스키마를 스스로 적용한다** (29-5).
 *
 * 28-68부터 배포 절차에 "psql로 스키마를 한 번 넣는다"가 사람 몫으로 남아 있었다. 그 한 단계가
 * 빠지면 라이브는 그럴듯하게 뜬 뒤 첫 요청에서 `relation "sessions" does not exist`로 죽는다 —
 * 실패가 배포가 아니라 사용자에게서 드러나는, 가장 나쁜 모양이다. DB만 붙이면 나머지는 서버가 한다.
 *
 * ## 안전한 이유
 *
 * - 두 SQL은 **다시 돌려도 되는 형태**다(29-5에서 표·인덱스·컬럼에 IF NOT EXISTS를, 외래키에
 *   duplicate_object 예외를 붙였다). 새 DB든 이미 찬 DB든 결과가 같다. 세 번 연속 적용해 확인했다.
 * - 인스턴스가 여럿이면 동시에 들어올 수 있으므로 **권고 잠금**으로 한 번에 하나만 통과시킨다.
 *   잠금은 트랜잭션과 함께 풀리므로 죽은 인스턴스가 잠금을 들고 사라지지 않는다.
 * - 한 프로세스에서는 약속 하나를 재사용한다. 28-88이 정리한 대로 이 상태는 **인스턴스마다 따로**이고,
 *   그래도 되는 종류다 — 여러 번 돌아도 결과가 같기 때문이다.
 *
 * ## 하지 않는 것
 *
 * 스키마를 **지우거나 바꾸지 않는다.** 만드는 문장만 있고, 이미 있으면 건너뛴다. 컬럼 삭제나 형 변경이
 * 필요한 날이 오면 그건 사람이 보는 마이그레이션이어야 한다 — 자동으로 할 일이 아니다.
 */

/**
 * `pg_advisory_xact_lock`에 쓸 열쇠. 이 저장소 전용으로 아무 값이나 고정하면 된다.
 * bigint 범위라 문자열로 넘긴다 — 리터럴로 쓰면 Next 쪽 타입 대상(ES2017)에서 걸린다.
 */
const LOCK_KEY = '8291047361002'

/**
 * 이미 적용했는지 기억하는 약속. 이 상태는 서버리스에서 **인스턴스마다 따로** 존재한다 —
 * 그래서 "전체에서 딱 한 번"은 보장하지 못하고, 인스턴스가 열 개면 열 번 돌 수 있다.
 * 그래도 되는 종류의 상태다: 적용 자체가 몇 번을 돌려도 결과가 같고(IF NOT EXISTS + 예외 처리),
 * 동시 실행은 `pg_advisory_xact_lock`이 DB 쪽에서 한 줄로 세운다. 이 변수가 막는 것은 정확성이
 * 아니라 **같은 인스턴스 안의 반복 왕복**뿐이다.
 */
let applied: Promise<void> | null = null

export async function ensureSchema(pool: Pool): Promise<void> {
  applied ??= apply(pool).catch((err) => {
    // 실패는 기억하지 않는다 — 다음 요청이 다시 시도할 수 있어야 한다
    applied = null
    throw err
  })
  return applied
}

/** 테스트가 프로세스 안에서 다시 재게 한다. 운영 경로에서는 부르지 않는다. */
export function resetSchemaMemo(): void {
  applied = null
}

async function apply(pool: Pool): Promise<void> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    // 먼저 잠근다 — 동시에 들어온 인스턴스는 여기서 기다렸다가, 이미 끝난 상태를 보게 된다
    await c.query('select pg_advisory_xact_lock($1)', [LOCK_KEY])
    await c.query(BASE_SQL)
    await c.query(MARKETPLACE_SQL)
    await c.query('commit')
  } catch (err) {
    try {
      await c.query('rollback')
    } catch {
      /* 이미 끊어졌으면 그대로 둔다 */
    }
    throw err
  } finally {
    c.release()
  }
}

/**
 * 요청 진입점이 부르는 얇은 겉면. 주소가 없으면 아무것도 하지 않는다 — 그 경우의 안내는
 * 각 핸들러가 이미 자기 문구로 한다(`/api/auth`의 503 등). 실패해도 여기서 막지 않는다:
 * DB가 정말 안 되는 상황이라면 핸들러가 같은 이유로 실패하면서 **자기 문구로** 말하는 편이 낫다.
 */
export async function ensureSchemaFor(databaseUrl: string | undefined): Promise<void> {
  if (databaseUrl === undefined || databaseUrl === '') return
  try {
    await ensureSchema(getPool(databaseUrl))
  } catch (err) {
    console.error('스키마 자동 적용 실패 — 핸들러의 오류 처리로 넘긴다', err)
  }
}
