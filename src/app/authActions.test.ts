import { describe, it, expect } from 'vitest'
import { createAuthActions } from './authActions'
import { AuthService } from '../../server/domain/auth'
import { TokenStore } from './session'
import type { HttpAuthClient, AuthCallResult } from '../domain/ports/httpAuth'
import { Replicator } from '../domain/replicator'
import type { SnapshotPort } from '../domain/ports'

const session = {
  role: 'partner' as const,
  name: '반듯설비',
  accountId: 'AC-0002',
  issuedAt: '2026-09-05T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
}
const tick = () => new Promise((r) => setTimeout(r, 0))

/** 서버 스텁 — 로그인은 항상 성공 */
function stubHttp(): HttpAuthClient {
  return {
    async call(op: string): Promise<AuthCallResult> {
      if (op === 'login')
        return { ok: true, result: session, token: 'tok', session, mirror: { accounts: [], complete: false } }
      return { ok: true, result: null }
    },
  } as unknown as HttpAuthClient
}

/**
 * 28-71-01: 로그인은 첫 접촉(onSession = 복제기 sync)이 끝나야 끝난다. 그렇지 않으면 AuthGate가 로그인 직후 넣는
 * 파트너 프로필 시드가 accept(원격 통째 교체)에 덮인다 — 두 번째 파트너부터 프로필이 없었다.
 */
describe('authActions.login은 onSession을 기다린다 (28-71-01)', () => {
  it('onSession이 끝나기 전에는 login이 resolve되지 않는다', async () => {
    let release: () => void = () => {}
    const onSession = () =>
      new Promise<void>((r) => {
        release = r
      })
    const auth = new AuthService(undefined, { mirror: true })
    const actions = createAuthActions(auth, stubHttp(), new TokenStore(undefined), onSession)
    let done = false
    const p = actions.login('partner', '010-9999-8888', 'password1').then(() => {
      done = true
    })
    await tick()
    await tick()
    expect(done).toBe(false) // 수정 전: true (onSession을 기다리지 않았다)
    release()
    await p
    expect(done).toBe(true)
    expect(auth.sessionFor('partner')?.accountId).toBe('AC-0002')
  })

  it('onSession이 던져도 로그인은 성공이다 — 복제 실패는 로그인 실패가 아니다', async () => {
    const auth = new AuthService(undefined, { mirror: true })
    const actions = createAuthActions(auth, stubHttp(), new TokenStore(undefined), async () => {
      throw new Error('원격 없음')
    })
    await expect(actions.login('partner', '010-9999-8888', 'password1')).resolves.toMatchObject({
      accountId: 'AC-0002',
    })
  })
})

/**
 * 28-72-04b: 위 테스트들은 `onSession`을 손으로 release하는 빈 Promise로 스텁했다 — **진짜 복제기를 태우지
 * 않았다.** 그래서 28-72-01(진행 중 sync가 있으면 `login`이 남의 sync를 기다리고 끝난다)을 못 봤다.
 * 이 테스트는 실제 `Replicator`와 실제 배선(`onSession = () => replication.sync({ checkRemote: true })`)을 쓴다.
 */
describe('login은 진짜 복제기의 첫 접촉을 기다린다 (28-72-01)', () => {
  it('다른 sync가 진행 중이어도 login은 원격을 받아들인 뒤에 resolve된다', async () => {
    let accepted = false
    let releaseWrite: () => void = () => {}
    let enteredWrite: () => void = () => {}
    const writeStarted = new Promise<void>((r) => {
      enteredWrite = r
    })
    // 이 기기가 먼저 밀어 올리는 중에(write) 남이 쓴다 — 서버 e2e에서 실제로 겹쳤던 창이다
    let remote: { rev: number; body: string } | null = null
    const port: SnapshotPort = {
      name: 'slow',
      async head() {
        await new Promise((r) => setTimeout(r, 0))
        return { ok: true, rev: remote === null ? null : remote.rev }
      },
      async read() {
        await new Promise((r) => setTimeout(r, 0))
        return { ok: true, record: remote }
      },
      async write() {
        enteredWrite()
        await new Promise<void>((r) => {
          releaseWrite = r
        })
        return { ok: true, rev: 1 }
      },
    }
    let rev = 1
    const replication = new Replicator(
      {
        name: 'src',
        revision: () => rev,
        body: () => '{"mine":1}',
        accept: () => {
          accepted = true
          rev += 1
        },
      },
      port,
      { schedule: null },
    )
    const auth = new AuthService(undefined, { mirror: true })
    const actions = createAuthActions(auth, stubHttp(), new TokenStore(undefined), () =>
      replication.sync({ checkRemote: true }),
    )

    const background = replication.sync({ pushLocal: true }) // 앱 시작·다른 탭이 만든 진행 중 동기화
    await writeStarted
    remote = { rev: 9, body: '{"others":1}' } // 내 push가 나가는 사이 남이 썼다
    let acceptedAtLogin: boolean | null = null
    const login = actions.login('partner', '010-9999-8888', 'password1').then(() => {
      acceptedAtLogin = accepted
    })
    releaseWrite()
    await login
    // 수정 전: false — 로그인이 끝난 뒤에 accept가 도착해 그 사이의 프로필 시드를 덮었다
    expect(acceptedAtLogin).toBe(true)
    await background
    await replication.idle()
  })
})
