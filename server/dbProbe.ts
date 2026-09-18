/**
 * 데이터가 정말 갈라져 있는지 사람이 확인할 수 있게 한다 (29-17).
 *
 * ## 왜 주소 비교로는 모자란가
 *
 * `dbFingerprint` 는 호스트와 DB 이름을 비교해 **접속 대상이 다른지**를 말한다. 그것은 분리의
 * 필요조건이지 충분조건이 아니다. 서로 다른 접속 주소가 같은 데이터를 가리킬 수 있다 —
 * 읽기 전용 복제본, 같은 클러스터의 별칭, 풀러와 직결 엔드포인트 같은 것들이 그렇다.
 * 그래서 주소만 보고 "분리됨"이라고 쓰면 안 된다.
 *
 * ## 표식 하나로 확인한다
 *
 * 프리뷰에서 표식을 하나 남기고, **운영 화면에서 그 표식이 보이지 않는 것**을 사람이 눈으로
 * 확인한다. 보이면 같은 데이터다. 안 보이면 갈라져 있다.
 *
 * 이 방식은 운영 자격 증명을 프리뷰로 가져오지 않는다 — 두 배포가 각자 자기 DB 만 읽는다.
 * 한쪽에서 양쪽을 보려면 운영 주소를 프리뷰에 넣어야 하는데, 그것이야말로 우리가 막으려는 일이다.
 *
 * ## 운영에는 쓰지 않는다
 *
 * 표식 쓰기는 `VERCEL_ENV === 'production'` 에서 거부한다(`handlers/auth.ts`). 운영 DB 에는
 * 이 표를 만들기만 하고 행을 넣지 않는다. 지우는 코드도 두지 않는다 — 사장님이 "기존 데이터
 * 삭제나 초기화는 하지 마세요"라고 하셨고, 표식은 몇 바이트짜리 행이라 지울 이유도 없다.
 */
import type { Queryable } from './db'

/** 화면에 보여 줄 표식 수. 사람이 눈으로 대조하는 용도라 많을 필요가 없다 */
export const PROBE_LIMIT = 10

export interface Probe {
  id: string
  deployEnv: string
  createdAt: string
}

/** 표식 하나를 남긴다. ID 는 호출한 쪽이 만들어 넘긴다 — 그래야 두 화면에서 같은 값을 찾는다 */
export async function writeProbe(db: Queryable, id: string, deployEnv: string): Promise<Probe> {
  const rows = await db.query<{ id: string; deploy_env: string; created_at: Date | string }>(
    'insert into diagnostic_probes (id, deploy_env) values ($1, $2) returning id, deploy_env, created_at',
    [id, deployEnv],
  )
  const r = rows.rows[0]
  if (r === undefined) throw new Error('표식을 남기지 못했습니다')
  return { id: r.id, deployEnv: r.deploy_env, createdAt: String(r.created_at) }
}

/** 이 배포가 보는 DB 에 실제로 있는 표식들. 없으면 빈 목록이다 */
export async function recentProbes(db: Queryable): Promise<Probe[]> {
  const rows = await db.query<{ id: string; deploy_env: string; created_at: Date | string }>(
    `select id, deploy_env, created_at from diagnostic_probes order by created_at desc limit ${PROBE_LIMIT}`,
  )
  return rows.rows.map((r) => ({ id: r.id, deployEnv: r.deploy_env, createdAt: String(r.created_at) }))
}

/**
 * 조회 결과. **실패를 "없음"으로 접지 않는다** (29-17-1).
 *
 * 표식 확인은 "운영에 그 표식이 없다"를 근거로 분리를 판정한다. 그런데 조회가 실패했을 때
 * 빈 목록을 돌려주면 그 실패가 곧바로 "없음"이 되어, 같은 DB 를 보고 있어도 분리됐다고
 * 말하게 된다. 판정을 뒤집는 종류의 오류다. 그래서 세 상태를 구분한다.
 *
 *   probes 가 배열   조회에 성공했다. 그 안이 비었으면 정말 없는 것이다
 *   probes 가 null   조회하지 못했다. 이 경우 화면은 분리 여부를 말하지 않는다
 */
export interface ProbeRead {
  probes: Probe[] | null
  /** 실패했을 때의 짧은 이유. 접속 정보를 담지 않으려고 원문 대신 코드를 쓴다 */
  error: string | null
}

/**
 * 실패해도 화면 전체를 죽이지 않되, 실패를 숨기지도 않는다.
 *
 * 오류 원문을 그대로 싣지 않는다 — 드라이버 메시지에 무엇이 섞여 나올지 우리가 정하지 못한다.
 * Postgres 오류 코드(`42P01` = 표 없음 같은 것)만 덧붙인다.
 */
export async function readProbes(db: Queryable): Promise<ProbeRead> {
  try {
    return { probes: await recentProbes(db), error: null }
  } catch (err) {
    const code = (err as { code?: unknown }).code
    const suffix = typeof code === 'string' && code !== '' ? ` (코드 ${code})` : ''
    return { probes: null, error: `표식을 조회하지 못했습니다${suffix}` }
  }
}
