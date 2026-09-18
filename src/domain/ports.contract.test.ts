import { describe, it, expect, beforeAll } from 'vitest'
import type { SnapshotPort, StorageLike } from './ports-testkit'
import { memoryStorage } from '../../server/domain/memoryStorage'
import { LocalSnapshotPort } from './ports/localPort'
import { MemoryRemotePort } from './ports/memoryRemotePort'
import { HttpSnapshotPort } from './ports/httpPort'
import { HttpAuthClient } from './ports/httpAuth'
import { Replicator, type ReplicationSource } from './replicator'

/**
 * 포트 계약 테스트 (28-67 → 28-69).
 *
 * **세 구현(Local·Memory·Http)이 같은 스위트를 통과해야 한다.** "로컬에서는 되는데 서버에서는
 * 다르게 동작한다"를 이 파일이 먼저 잡는다.
 *
 * 계약이 요구하는 것:
 *  - 빈 저장소는 read → `{ ok: true, record: null }`
 *  - **rev는 저장소가 발급한다** (28-68-01). write는 body만 주고 rev를 돌려받는다. 1부터 시작해 쓰기마다 +1.
 *  - expectedRev 불일치는 conflict이고 **그쪽 최신본을 함께 돌려준다**. 원격이 비어 있으면 `remote`는 **null**.
 *  - **read도 write도 던지지 않는다** (28-67-04). 닿을 수 없으면 `unavailable`.
 *  - 동시 writer 둘 중 하나만 성공
 *  - 같은 기대값을 든 writer 둘 — 두 번째는 conflict (28-68-01)
 *  - 200KB 한글 본문이 그대로 왕복한다 (28-68-03b — CI 서버의 청크 경계 UTF-8 깨짐을 잡는다)
 */

/** 읽기가 실패하는 저장소 — 사생활 보호 모드처럼 접근 자체가 막힌 상황 */
function brokenStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('저장소에 접근할 수 없습니다')
    },
    setItem: () => {
      throw new Error('저장소에 접근할 수 없습니다')
    },
    removeItem: () => {
      throw new Error('저장소에 접근할 수 없습니다')
    },
  }
}

/**
 * 계약 대상 구현들. 세 번째 원소는 **읽기를 실패하게 만드는 방법**이다 (28-67-04).
 * 실패를 주입할 수 없는 구현은 계약 대상이 될 수 없다(그 경로를 확인할 방법이 없으므로).
 */
const ports: Array<[string, () => SnapshotPort, () => SnapshotPort]> = [
  [
    'LocalSnapshotPort',
    () => new LocalSnapshotPort(memoryStorage(), 'contract-test-v1'),
    () => new LocalSnapshotPort(brokenStorage(), 'contract-test-v1'),
  ],
  [
    'MemoryRemotePort',
    () => new MemoryRemotePort(),
    () => {
      const p = new MemoryRemotePort()
      p.failFor(1)
      return p
    },
  ],
]

/**
 * HTTP 어댑터는 **진짜 서버가 떠 있을 때만** 계약 대상에 들어간다 (28-68).
 * `CONTRACT_API_URL`이 있으면 그 주소에 대고 같은 스위트를 돌린다. CI의 `server` job이
 * 진짜 Postgres(`services: postgres:16`)와 `scripts/api-server.mjs`를 띄우고 이 변수를 준다.
 *
 * 28-68-04b: "조용한 축소를 막는 장치"가 전부 이 변수 하나에 매달려 있어서, server job의 env 두 줄을
 * 지우면 여전히 초록이었다. 이제 `CONTRACT_REQUIRE_HTTP=1`이면 URL 부재가 **파일 전체 실패**다.
 */
const API_URL = import.meta.env['VITE_CONTRACT_API_URL'] ?? process.env['CONTRACT_API_URL']
/**
 * 28-70: 인증은 세션 토큰뿐이다(공유 시크릿 없음). 계약 테스트는 `/api/auth`에 **가입·인증·로그인**해서 토큰을 받는다 —
 * 그래서 HTTP 계약이 통과하면 인증 경로도 함께 통과한 것이다. 토큰은 beforeAll에서 채워지고 포트는 함수로 읽는다.
 */
const AUTH_URL = typeof API_URL === 'string' ? API_URL.replace(/\/api\/snapshot$/, '/api/auth') : ''
let API_TOKEN = ''
const tokenOf = () => (API_TOKEN === '' ? null : API_TOKEN)
const CONTRACT_PHONE = `010${String(Date.now() % 100_000_000).padStart(8, '0')}`
async function loginForContract(): Promise<string> {
  const http = new HttpAuthClient(AUTH_URL)
  const reg = await http.call(
    'register',
    [
      {
        role: 'customer',
        name: '계약 테스트',
        phone: CONTRACT_PHONE,
        password: 'contract-pass-1',
        agreeTerms: true,
        agreePrivacy: true,
      },
    ],
    null,
  )
  if (!reg.ok) throw new Error(`계약용 가입 실패: ${reg.error}`)
  const otp = (reg.result as { otp: string }).otp
  const ver = await http.call('verifyOtp', ['customer', CONTRACT_PHONE, otp], null)
  if (!ver.ok) throw new Error(`계약용 OTP 실패: ${ver.error}`)
  const login = await http.call('login', ['customer', CONTRACT_PHONE, 'contract-pass-1'], null)
  if (!login.ok || typeof login.token !== 'string')
    throw new Error(`계약용 로그인 실패: ${login.ok ? '토큰 없음' : login.error}`)
  return login.token
}
const REQUIRE_HTTP = (import.meta.env['VITE_CONTRACT_REQUIRE_HTTP'] ?? process.env['CONTRACT_REQUIRE_HTTP']) === '1'
if (REQUIRE_HTTP && !(typeof API_URL === 'string' && API_URL !== '')) {
  throw new Error('CONTRACT_REQUIRE_HTTP=1인데 CONTRACT_API_URL이 없다 — server job의 env를 지웠는가 (28-68-04b)')
}
if (typeof API_URL === 'string' && API_URL !== '') {
  let n = 0
  ports.push([
    'HttpSnapshotPort',
    () => new HttpSnapshotPort(API_URL, tokenOf, `contract-${Date.now().toString(36)}-${(n += 1)}`),
    // 닿을 수 없는 주소 — 포트가 던지지 않고 결과값으로 돌려주는지 본다
    () => new HttpSnapshotPort('http://127.0.0.1:1/api/snapshot', tokenOf, 'unreachable', 1_000),
  ])
}

beforeAll(async () => {
  if (typeof API_URL === 'string' && API_URL !== '') API_TOKEN = await loginForContract()
})

/** 한글(3바이트)로 64KB 청크 경계를 여러 번 넘기는 본문 — JSON 문자열로 감싸 스냅샷과 같은 모양 */
const KOREAN_200KB = JSON.stringify({ version: 1, 요청: '요청·견적·시공·정산'.repeat(20_000) }) // 22만 자 ≈ 600KB UTF-8

describe('계약 대상 (28-68)', () => {
  it('어떤 구현이 이 계약을 통과했는지 드러난다 — 조용한 축소를 막는다', () => {
    const names = ports.map(([n]) => n)
    expect(names).toContain('LocalSnapshotPort')
    expect(names).toContain('MemoryRemotePort')
    if (typeof API_URL === 'string' && API_URL !== '') expect(names).toContain('HttpSnapshotPort')
    console.log(`[계약 대상] ${names.join(', ')}`)
  })
})

describe.each(ports)('SnapshotPort 계약 — %s', (_name, make, makeUnreachable) => {
  it('빈 저장소는 ok이면서 record가 null이다', async () => {
    expect(await make().read()).toEqual({ ok: true, record: null })
  })

  it('head()는 rev만 준다 — 비었으면 null, 쓰면 그 rev (28-69-01)', async () => {
    const port = make()
    expect(await port.head()).toEqual({ ok: true, rev: null })
    await port.write('a', null)
    expect(await port.head()).toEqual({ ok: true, rev: 1 })
    await port.write('b', 1)
    expect(await port.head()).toEqual({ ok: true, rev: 2 })
  })

  it('닿을 수 없어도 head는 던지지 않는다 (28-69-01)', async () => {
    const res = await makeUnreachable().head()
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('unavailable')
  })

  it('첫 쓰기는 rev 1을 발급하고 read가 본문과 rev를 그대로 보존한다 (28-68-01)', async () => {
    const port = make()
    const body = JSON.stringify({ version: 1, 요청: [{ id: 'R-1' }] })
    expect(await port.write(body, null)).toEqual({ ok: true, rev: 1 })
    expect(await port.read()).toEqual({ ok: true, record: { rev: 1, body } })
  })

  it('연속 쓰기는 직전 rev를 기대해야 하고 rev는 1씩 오른다', async () => {
    const port = make()
    await port.write('a', null)
    expect(await port.write('b', 1)).toEqual({ ok: true, rev: 2 })
    expect(await port.write('c', 2)).toEqual({ ok: true, rev: 3 })
    expect(await port.read()).toEqual({ ok: true, record: { rev: 3, body: 'c' } })
  })

  it('expectedRev가 어긋나면 conflict이고 그쪽 최신본을 함께 돌려준다', async () => {
    const port = make()
    await port.write('먼저 쓴 값', null)
    const res = await port.write('나중에 쓴 값', null) // 이 writer는 아직 아무것도 없다고 믿고 있다
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('conflict')
    if (res.reason !== 'conflict') throw new Error('unreachable')
    expect(res.remote).toEqual({ rev: 1, body: '먼저 쓴 값' })
    expect(await port.read()).toEqual({ ok: true, record: { rev: 1, body: '먼저 쓴 값' } })
  })

  /**
   * 28-68-01. 두 기기가 각자 "마지막으로 본 rev = 1"을 들고 온다. 28-68의 계약(클라이언트 rev)에서는
   * 두 기기가 같은 로컬 카운터를 들고 오면 `where rev = $expected`가 양쪽 다 맞아 **둘 다 성공**했다.
   * 저장소가 rev를 발급하면 첫 쓰기가 rev를 2로 올리므로 두 번째는 반드시 conflict다.
   */
  it('같은 기대값을 든 writer 둘 — 두 번째는 conflict다 (28-68-01)', async () => {
    const port = make()
    const first = await port.write('기준', null)
    if (!first.ok) throw new Error('unreachable')
    const a = await port.write('A', first.rev)
    const b = await port.write('B', first.rev)
    expect(a).toEqual({ ok: true, rev: 2 })
    expect(b.ok).toBe(false)
    if (b.ok || b.reason !== 'conflict') throw new Error('unreachable')
    expect(b.remote).toEqual({ rev: 2, body: 'A' })
  })

  it('동시 writer 둘 중 하나만 성공한다', async () => {
    const port = make()
    await port.write('기준', null)
    const [a, b] = await Promise.all([port.write('A', 1), port.write('B', 1)])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    const winner = a.ok ? 'A' : 'B'
    expect(await port.read()).toEqual({ ok: true, record: { rev: 2, body: winner } })
  })

  it('원격이 비었는데 non-null rev를 기대하면 conflict의 remote가 null이다 (28-67-02c)', async () => {
    const res = await make().write('x', 2)
    expect(res.ok).toBe(false)
    if (res.ok || res.reason !== 'conflict') throw new Error('unreachable')
    expect(res.remote).toBeNull()
  })

  it('닿을 수 없어도 read는 던지지 않는다 — 실패도 결과값이다 (28-67-04)', async () => {
    const res = await makeUnreachable().read()
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('unavailable')
    if (res.reason !== 'unavailable') throw new Error('unreachable')
    expect(res.detail).not.toBe('')
    expect(await make().read()).toEqual({ ok: true, record: null })
  })

  it('닿을 수 없으면 write도 unavailable을 돌려준다 — 던지지 않는다 (28-67-04)', async () => {
    const res = await makeUnreachable().write('x', null)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('unavailable')
  })

  /**
   * 28-68-03b. CI 서버가 청크마다 `toString`해서 한글이 64KB 경계에서 U+FFFD로 깨졌는데,
   * 계약 테스트 본문이 전부 수십 바이트라 CI가 한 번도 못 잡았다. 이 케이스가 그것을 잡는다.
   */
  it('200KB 한글 본문이 그대로 왕복한다 (28-68-03b)', async () => {
    const port = make()
    expect(KOREAN_200KB.length).toBeGreaterThan(200_000)
    const w = await port.write(KOREAN_200KB, null)
    expect(w).toEqual({ ok: true, rev: 1 })
    const r = await port.read()
    if (!r.ok || r.record === null) throw new Error('unreachable')
    expect(r.record.body.length).toBe(KOREAN_200KB.length)
    expect(r.record.body).toBe(KOREAN_200KB)
    expect(r.record.body.includes('�')).toBe(false)
  })
})

describe('MemoryRemotePort — 주입한 실패·지연 (28-67)', () => {
  it('닿을 수 없으면 예외가 아니라 unavailable을 돌려준다', async () => {
    const port = new MemoryRemotePort()
    port.failFor(1)
    expect(await port.write('x', null)).toEqual({
      ok: false,
      reason: 'unavailable',
      detail: '원격 저장소에 닿을 수 없습니다',
    })
    expect(await port.read()).toEqual({ ok: true, record: null })
  })

  it('실패 뒤 재시도는 성공한다', async () => {
    const port = new MemoryRemotePort()
    port.failFor(2)
    expect((await port.write('x', null)).ok).toBe(false)
    expect((await port.write('x', null)).ok).toBe(false)
    expect(await port.write('x', null)).toEqual({ ok: true, rev: 1 })
  })

  it('다른 기기가 먼저 쓴 상황을 재현한다', async () => {
    const port = new MemoryRemotePort()
    port.seed({ rev: 7, body: '다른 기기의 최신본' })
    const res = await port.write('내 것', 1)
    expect(res.ok).toBe(false)
    if (res.ok || res.reason !== 'conflict') throw new Error('unreachable')
    expect(res.remote?.rev).toBe(7)
  })

  it('read 실패도 예외가 아니라 결과값이다 (28-67-04)', async () => {
    const port = new MemoryRemotePort()
    port.failFor(1)
    await expect(port.read()).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      detail: '원격 저장소에 닿을 수 없습니다',
    })
    await expect(port.read()).resolves.toEqual({ ok: true, record: null })
  })

  it('지연이 있어도 계약은 같다', async () => {
    const port = new MemoryRemotePort({ latencyMs: 5 })
    const started = Date.now()
    await port.write('x', null)
    expect(Date.now() - started).toBeGreaterThanOrEqual(4)
    expect(await port.read()).toEqual({ ok: true, record: { rev: 1, body: 'x' } })
  })
})

/**
 * 결제 API 는 **없다** (28-97 → 29-29). 화면이 쓰지 않는 `/api/payments` 가 로그인만 하면 임의 주문의 결제사 승인·조회를
 * 열어 두고 있었다(29-28 보안 감사 03). 라우트·핸들러를 지웠고, 정식 경로는 마켓플레이스의
 * `orders/:id/trade/payment-confirm` 하나다. 이 단언은 지운 것이 되살아나지 않게 붙잡는다.
 * `CONTRACT_API_URL`이 있을 때만 돈다(CI의 `server` job).
 */
describe.skipIf(!API_URL)('결제 API 는 없다 (29-29)', () => {
  const url = typeof API_URL === 'string' ? API_URL.replace(/\/api\/snapshot$/, '/api/payments') : ''

  it('/api/payments 는 세션이 있어도 404 다 — 지운 우회 표면이 되살아나지 않는다', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_TOKEN}` },
      body: JSON.stringify({ op: 'config' }),
    })
    expect(res.status).toBe(404)
    expect((await fetch(url, { method: 'GET' })).status).toBe(404)
  })
})

/**
 * API 자체의 규약 (28-68) — 포트를 거치지 않고 직접 부른다.
 * `CONTRACT_API_URL`이 있을 때만 돈다(CI의 `server` job이 준다).
 */
describe.skipIf(!API_URL)('스냅샷 API 인증·검증 (28-68 → 28-70 세션 토큰)', () => {
  const url = `${API_URL}?workspace=api-guard-test`
  const authed = () => ({ authorization: `Bearer ${API_TOKEN}`, 'content-type': 'application/json' })

  it('토큰이 없거나 틀리면 401이다 — 세션 없이는 아무것도 읽지 못한다', async () => {
    expect((await fetch(url)).status).toBe(401)
    expect((await fetch(url, { headers: { authorization: 'Bearer wrong-token' } })).status).toBe(401)
  })

  it('로그아웃(폐기)한 토큰은 401이다 — 같은 토큰을 다시 써도 (28-70)', async () => {
    const http = new HttpAuthClient(AUTH_URL)
    const login = await http.call('login', ['customer', CONTRACT_PHONE, 'contract-pass-1'], null)
    if (!login.ok || typeof login.token !== 'string') throw new Error('로그인 실패')
    const t = login.token
    expect((await fetch(url, { headers: { authorization: `Bearer ${t}` } })).status).toBe(200)
    const out = await http.call('logout', [], t)
    expect(out.ok).toBe(true)
    expect((await fetch(url, { headers: { authorization: `Bearer ${t}` } })).status).toBe(401)
    const me = await http.call('me', [], t)
    expect(me.ok).toBe(false)
    if (me.ok) throw new Error('unreachable')
    expect(me.status).toBe(401)
  })

  /** 29-21: 가입 코드를 없앴다 — 역할로 권한이 갈리므로 덧댄 자물쇠였다(`lib/service.ts`) */
  it('가입은 코드를 묻지 않는다 — 아무것도 더 주지 않아도 가입되고 인증된다 (29-21)', async () => {
    const http = new HttpAuthClient(AUTH_URL)
    const base = {
      role: 'customer',
      name: '코드 없는 가입',
      phone: `010${String((Date.now() + 7) % 100_000_000).padStart(8, '0')}`,
      password: 'contract-pass-1',
      agreeTerms: true,
      agreePrivacy: true,
    }
    // 수정 전: 400 '가입 코드가 올바르지 않습니다'
    const reg = await http.call('register', [base], null)
    expect(reg.ok).toBe(true)
    if (!reg.ok) throw new Error('unreachable')
    const otp = (reg.result as { otp: string }).otp
    // 수정 전: 400 — verifyOtp도 코드를 물었다(28-71-03b). 그것이 지키던 것은 29-21-C가 대신한다
    const ver = await http.call('verifyOtp', ['customer', base.phone, otp], null)
    expect(ver.ok).toBe(true)
  })

  it('503 본문에 DB 오류 원문이 없다 — workspace 파라미터는 auth가 받지 않는다 (28-70-03d·04b)', async () => {
    // `?workspace=`를 붙여도 계정 상태는 main이다 — 같은 토큰으로 me가 200이어야 한다
    const res = await fetch(`${AUTH_URL}?workspace=other`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_TOKEN}` },
      body: JSON.stringify({ op: 'me', args: [] }),
    })
    expect(res.status).toBe(200) // 수정 전: 401 (other 워크스페이스에서 세션을 찾았다)
  })

  it('head=1은 rev만 준다 (28-69-01)', async () => {
    const ws = `${API_URL}?workspace=head-test-${Date.now().toString(36)}`
    const h0 = (await (await fetch(`${ws}&head=1`, { headers: authed() })).json()) as { rev: unknown }
    expect(h0).toEqual({ rev: null })
    await fetch(ws, { method: 'PUT', headers: authed(), body: JSON.stringify({ body: 'x', expectedRev: null }) })
    const h1 = (await (await fetch(`${ws}&head=1`, { headers: authed() })).json()) as { rev: unknown }
    expect(h1).toEqual({ rev: 1 })
  })

  it('workspace 파라미터가 없으면 400이다', async () => {
    expect((await fetch(String(API_URL), { headers: authed() })).status).toBe(400)
  })

  it('본문 모양이 어긋나면 400이다 — 옛 계약의 rev 필드도 거부한다 (28-68-01)', async () => {
    for (const bad of [
      { expectedRev: null },
      { body: 1, expectedRev: null },
      { body: 'x', expectedRev: -1 },
      { rev: 1, body: 'x', expectedRev: null },
    ]) {
      const res = await fetch(url, { method: 'PUT', headers: authed(), body: JSON.stringify(bad) })
      expect(res.status).toBe(400)
    }
  })

  it('지원하지 않는 메서드는 405다', async () => {
    expect((await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${API_TOKEN}` } })).status).toBe(405)
  })

  it('인증된 GET은 no-store다 (28-68 기록)', async () => {
    const res = await fetch(url, { headers: authed() })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  /**
   * 28-68-03c. 인증 없이 상한을 넘는 본문을 흘린다 — 서버는 413으로 답하고 **살아 있어야** 한다.
   * 28-68의 CI 서버는 상한이 없어 큰 본문에 프로세스가 죽었다. 상한은 `MAX_BODY_BYTES`(≈12MB).
   */
  it('인증 없이 상한을 넘는 본문 → 413, 서버는 살아 있다 (28-68-03c)', async () => {
    const huge = 'x'.repeat(13 * 1024 * 1024)
    const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: huge }).catch(
      () => null,
    )
    // 서버가 연결을 끊으면 fetch가 reject할 수 있다 — 그것도 "받지 않았다"이므로 허용하되, 응답이 왔다면 413이어야 한다
    if (res !== null) expect(res.status).toBe(413)
    const health = await fetch(String(API_URL).replace(/\/api\/snapshot$/, '/healthz'))
    expect(health.status).toBe(200)
  })
})

/**
 * 28-69-04a: **복제기 × HttpSnapshotPort × Postgres** 합성 — 28-69의 주장("붙여도 안 깨진다")이 처음으로 CI에서 도는 곳.
 * 두 기기가 같은 워크스페이스를 두고 A push → B 합류(accept) → B push → A의 탭 복귀 sync가 head로 감지해 받아들인다.
 */
describe.skipIf(!API_URL)('복제기 × HTTP × Postgres 합성 (28-69-04a)', () => {
  function device(name: string): ReplicationSource & { rev: number; text: string; accepted: string[] } {
    return {
      name,
      rev: 0,
      text: '{}',
      accepted: [],
      revision() {
        return this.rev
      },
      body() {
        return this.text
      },
      accept(body: string) {
        this.accepted.push(body)
        this.text = body
        this.rev += 1
      },
    }
  }

  it('A push → B 합류 accept → B push → A focus sync가 head로 감지해 받아들인다', async () => {
    const ws = `compose-${Date.now().toString(36)}`
    const a = device('A')
    a.rev = 1
    a.text = '{"기기":"A","n":1}'
    const b = device('B')
    b.rev = 1
    b.text = '{"기기":"B","n":1}'
    const ra = new Replicator(a, new HttpSnapshotPort(String(API_URL), tokenOf, ws), { schedule: null })
    const rb = new Replicator(b, new HttpSnapshotPort(String(API_URL), tokenOf, ws), { schedule: null })
    await ra.sync()
    expect(ra.currentStatus().status).toBe('synced')
    await rb.sync()
    expect(rb.currentStatus().status).toBe('conflict')
    expect(b.accepted).toEqual(['{"기기":"A","n":1}'])
    b.rev += 1
    b.text = '{"기기":"B","n":2}'
    await rb.sync()
    expect(rb.currentStatus().status).toBe('synced')
    await ra.sync({ checkRemote: true })
    expect(a.accepted).toEqual(['{"기기":"B","n":2}'])
    expect(ra.currentStatus().status).toBe('conflict')
  })

  it('토큰이 없으면 왕복 없이 rejected 401이고, 재시도를 예약하지 않는다', async () => {
    const a = device('A')
    a.rev = 1
    a.text = '{"n":1}'
    const queue: number[] = []
    const rep = new Replicator(a, new HttpSnapshotPort(String(API_URL), () => null, 'no-token'), {
      schedule: (_fn, ms) => {
        queue.push(ms)
        return () => {}
      },
    })
    await rep.sync()
    expect(rep.currentStatus()).toEqual({ status: 'rejected', detail: '로그인이 필요합니다 (HTTP 401)' })
    expect(queue).toEqual([])
  })
})
