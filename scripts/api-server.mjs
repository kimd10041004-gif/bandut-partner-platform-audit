/**
 * CI·로컬용 최소 API 서버 (28-68 → 28-70).
 *
 * `api/snapshot.ts`·`api/auth.ts`의 **핸들러 본체를 그대로** 부른다 — 로직을 다시 쓰지 않는다.
 * 그래야 CI가 검증하는 것과 Vercel이 서빙하는 것이 같은 코드다.
 * (Vercel 진입점은 같은 파일의 `default export`이고, 그것도 이 본체를 부른다.)
 *
 * TS를 그대로 실행할 수 없으므로 esbuild로 한 번 번들해서 import 한다 — Vercel이 하는 일과 같다.
 *
 * 사용:
 *   DATABASE_URL=... ADMIN_PASSWORD=... node scripts/api-server.mjs [포트] [--static dist]
 *
 * `--static <dir>`: 빌드 산출물을 같은 origin에서 서빙한다(`/partner`·`/admin` → index.html — vercel.json의
 * rewrite와 같은 모양). 서버 모드 e2e가 Vercel과 같은 "한 origin에 정적 + /api" 구성으로 돈다.
 */
import { createServer } from 'node:http'
import { mkdirSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'
import { build } from 'esbuild'

const argv = process.argv.slice(2)
const staticIdx = argv.indexOf('--static')
const STATIC_DIR = staticIdx >= 0 ? resolve(argv[staticIdx + 1] ?? 'dist') : null
// 28-85 부수 발견: `staticIdx`가 -1이면 `staticIdx + 1`이 0이라 **첫 위치 인자(포트)가 버려졌다**.
// `node scripts/api-server.mjs 3102` 가 조용히 3101로 떴다 — --static 없이 포트를 준 경우가 전부 그랬다.
const skip = staticIdx >= 0 ? staticIdx + 1 : -1
const positional = argv.filter((a, i) => a !== '--static' && i !== skip)
const PORT = Number(positional[0] ?? 3101)

// 저장소 안(node_modules/.cache)에 낸다 — tmpdir에 두면 번들이 `pg`를 해석하지 못한다
// (node의 모듈 해석은 파일 위치에서 위로 올라가며 node_modules를 찾는다).
const outDir = join('node_modules', '.cache', 'bandut-api')
mkdirSync(outDir, { recursive: true })
const outFile = join(process.cwd(), outDir, 'api.mjs')
// 엔트리 하나로 둘을 묶는다 — snapshot.ts와 auth.ts가 server/db.ts의 풀을 **같이** 쓰게(번들이 둘이면 풀도 둘)
const entry = join(process.cwd(), outDir, 'entry.ts')
const { writeFileSync } = await import('node:fs')
writeFileSync(
  entry,
  `export { handleSnapshot, closePool, MAX_BODY_BYTES } from '${resolve('server/handlers/snapshot.ts').replace(/\\/g, '/')}'\nexport { handleAuth } from '${resolve('server/handlers/auth.ts').replace(/\\/g, '/')}'\nexport { handleMarketplace } from '${resolve('server/marketplaceApi.ts').replace(/\\/g, '/')}'\nexport { getPool } from '${resolve('server/db.ts').replace(/\\/g, '/')}'\n`,
)
await build({
  entryPoints: [entry],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  // pg는 번들하지 않는다 — 네이티브 바인딩을 끌어들이지 않고 node_modules에서 그대로 쓴다
  external: ['pg'],
})
const { handleSnapshot, handleAuth, handleMarketplace, getPool, closePool, MAX_BODY_BYTES } = await import(
  `file://${outFile}`
)

/**
 * 본문 읽기 (28-68-03 정정).
 *  - `Buffer.concat` 뒤 **일괄** 디코드 — 28-68은 청크마다 `toString`해서 한글(3바이트)이
 *    64KB 청크 경계에 걸리면 앞뒤가 U+FFFD로 깨졌고, JSON.parse는 그것을 통과시켰다.
 *  - **인증·파싱 전에** 바이트 상한을 건다 — 28-68은 상한이 없어 토큰 없는 클라이언트가
 *    512MB를 흘리면 `RangeError`로 프로세스가 죽었다.
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        req.destroy()
        reject(Object.assign(new Error('본문이 너무 큽니다'), { code: 'E_TOO_LARGE' }))
        return
      }
      chunks.push(c)
    })
    // 29-30: 글자가 아니라 바이트로 준다 — 사진이 지나가는 자리라 utf8 로 읽으면 깨진다
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

function serveStatic(pathname, res) {
  if (STATIC_DIR === null) return false
  // vercel.json rewrite와 같은 모양: /partner·/admin → index.html
  let rel =
    pathname === '/' ||
    pathname === '/partner' ||
    pathname === '/partner/' ||
    pathname === '/admin' ||
    pathname === '/admin/'
      ? '/index.html'
      : pathname
  const file = resolve(STATIC_DIR, `.${rel}`)
  if (!file.startsWith(STATIC_DIR) || !existsSync(file) || !statSync(file).isFile()) return false
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
  return true
}

const server = createServer(async (req, res) => {
  const json = (status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
    if (url.pathname === '/healthz') return json(200, { ok: true })
    // 28-85 리뷰: 중첩 삼항 한 줄이었다 — 엔드포인트가 늘 때마다 나빠지므로 표로 편다(#232 리뷰).
    const ROUTES = {
      '/api/snapshot': handleSnapshot,
      '/api/auth': handleAuth,
    }
    // 29-2: v17 마켓플레이스는 경로 조각이 있다(/api/mp/orders/<id>/trade/<action>) —
    // 위의 ROUTES는 정확 경로 매칭이라 접두사 라우터가 따로 필요하다.
    const MP_PREFIX = '/api/mp/'
    const isMarketplace = url.pathname === '/api/mp' || url.pathname.startsWith(MP_PREFIX)
    const handler = isMarketplace ? handleMarketplace : (ROUTES[url.pathname] ?? null)
    if (handler === null) {
      if (serveStatic(url.pathname, res)) return
      return json(404, { error: 'not found' })
    }

    const headers = {}
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v
    const query = {}
    for (const [k, v] of url.searchParams) query[k] = v

    let raw
    try {
      raw = await readBody(req, MAX_BODY_BYTES)
    } catch (err) {
      if (err && err.code === 'E_TOO_LARGE') return json(413, { error: '본문이 너무 큽니다' })
      throw err
    }
    let body = null
    let bytes
    // 29-30: JSON 이 아닌 본문(사진)은 바이트 그대로 넘긴다 — Next 라우트(app/api/[...path]/route.ts)와 같은 규칙
    const type = (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    const isJson = type === '' || type === 'application/json' || type.endsWith('+json')
    if (!isJson) bytes = new Uint8Array(raw)
    else if (raw.length > 0) {
      try {
        body = JSON.parse(raw.toString('utf8'))
      } catch {
        return json(400, { error: '본문이 JSON이 아닙니다' })
      }
    }

    const abort = new AbortController()
    req.on('close', () => abort.abort())
    const req0 = { method: req.method ?? 'GET', headers, query, body, bytes, signal: abort.signal }
    const out = isMarketplace
      ? await handleMarketplace(
          { ...req0, path: url.pathname.slice(MP_PREFIX.length).split('/').filter(Boolean) },
          getPool(process.env.DATABASE_URL ?? ''),
          process.env,
        )
      : await handler(req0, process.env)
    // 29-30: 사진 바이트·SSE 는 핸들러가 만든 웹 Response 를 그대로 흘린다
    if (out.raw !== undefined) {
      res.writeHead(out.raw.status, Object.fromEntries(out.raw.headers))
      if (out.raw.body === null) return res.end()
      const { Readable } = await import('node:stream')
      return Readable.fromWeb(out.raw.body).pipe(res)
    }
    return json(out.status, out.body, out.headers ?? {})
  } catch (err) {
    // 어떤 요청도 프로세스를 죽이지 못한다
    console.error('api-server 요청 처리 실패:', err)
    if (!res.headersSent) return json(500, { error: '서버 오류' })
    res.end()
  }
})

// 127.0.0.1 명시 — 러너처럼 IPv6가 켜진 환경에서 localhost가 ::1로 풀려 어긋나는 것을 막는다
server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `api-server listening on http://127.0.0.1:${PORT}/api/{snapshot,auth}${STATIC_DIR ? ` + static ${STATIC_DIR}` : ''}`,
  )
})

async function shutdown() {
  server.close()
  await closePool()
  rmSync(outDir, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
