import { describe, expect, it } from 'vitest'
import { readProbes } from './dbProbe'

/**
 * 조회 실패를 "없음"으로 접지 않는다 (29-17-1).
 *
 * 표식 확인은 **운영에 그 표식이 없다**를 근거로 분리를 판정한다. 실패가 빈 목록이 되면 그
 * 실패가 곧 "없음"이 되어, 같은 DB 를 보고 있어도 분리됐다고 말하게 된다. 판정을 뒤집는
 * 오류라서 여기서 따로 잰다. DB 는 필요 없다 — 던지는 가짜 하나면 된다.
 */
const throwing = (err: unknown) => ({
  query: () => Promise.reject(err),
})

describe('readProbes', () => {
  it('읽으면 목록과 error 없음을 준다', async () => {
    const db = { query: () => Promise.resolve({ rows: [{ id: 'p1', deploy_env: 'preview', created_at: 'T' }] }) }
    const out = await readProbes(db as never)
    expect(out.error).toBeNull()
    expect(out.probes).toEqual([{ id: 'p1', deployEnv: 'preview', createdAt: 'T' }])
  })

  it('빈 결과는 빈 목록이다 — 이때만 "없음"이라고 말할 수 있다', async () => {
    const out = await readProbes({ query: () => Promise.resolve({ rows: [] }) } as never)
    expect(out.probes).toEqual([])
    expect(out.error).toBeNull()
  })

  it('실패는 빈 목록이 아니라 null 이다 — 이 줄이 이 파일의 이유다', async () => {
    const out = await readProbes(
      throwing(Object.assign(new Error('relation does not exist'), { code: '42P01' })) as never,
    )
    expect(out.probes).toBeNull()
    expect(out.error).toContain('42P01')
  })

  it('코드가 없는 오류도 null 로 온다', async () => {
    const out = await readProbes(throwing(new Error('연결 끊김')) as never)
    expect(out.probes).toBeNull()
    expect(out.error).toBe('표식을 조회하지 못했습니다')
  })

  it('오류 원문을 싣지 않는다 — 무엇이 섞여 나올지 우리가 정하지 못한다', async () => {
    const out = await readProbes(throwing(new Error('postgres://user:secret@host/db 접속 실패')) as never)
    expect(out.error).not.toContain('secret')
    expect(out.error).not.toContain('postgres://')
  })
})
