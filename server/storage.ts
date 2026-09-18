/**
 * 파일 저장소 포트 (29-23).
 *
 * ## 왜 포트인가
 *
 * 29-5부터 파일을 다루는 경로는 전부 503 이었다 — "사진 저장소가 아직 연결되지 않았습니다".
 * 저장소가 없는 것을 조용히 비우지 않고 말한 것은 잘했지만, 그 말이 오래 갔다.
 *
 * 이제 붙인다. 다만 앱 코드가 Vercel 을 직접 알게 하지는 않는다. 이 파일 하나만 알고,
 * 나머지는 `put`·`get`·`remove` 세 마디만 쓴다. 이유는 둘이다.
 *
 * - **검사가 돌아야 한다.** 봇과 통합 테스트는 Vercel 에 붙을 수 없다. 로컬 백엔드가 있으면
 *   업로드부터 열람까지의 규칙을 실제로 잴 수 있다.
 * - **갈아탈 수 있어야 한다.** 저장소를 바꾸는 날 고칠 파일이 하나여야 한다.
 *
 * ## 인증 — 사장님이 하신 연결이 그대로 맞다
 *
 * `bandut-uploads` 는 **비공개** 저장소다. 비공개 저장소는 오래 사는 토큰을 만들지 않는다.
 * `@vercel/blob` 이 자격을 고르는 순서를 코드에서 확인했다(2.8.0):
 *
 * ```js
 * const oidcToken = manualOidcToken || await getVercelOidcToken();
 * if (oidcToken) {
 *   const blobStoreId = readEnv("BLOB_STORE_ID");
 *   if (blobStoreId) return { kind: "oidc", token: oidcToken, storeId: ... };
 * }
 * const readWrite = readEnv("BLOB_READ_WRITE_TOKEN");   // ← 없어도 된다
 * ```
 *
 * `BLOB_STORE_ID` 와 배포마다 발급되는 OIDC 로 읽기·쓰기가 된다. 문서는 읽기 예시만 보여 줘서
 * 쓰기도 되는지가 불분명했는데, 라이브러리 코드가 답했다. **사장님이 넣으실 값은 없다.**
 *
 * ## 비공개로만 올린다
 *
 * 여기 올라가는 것은 사업자등록증과 출입국사실증명서다. `access: 'private'` 를 인자로 받지
 * 않고 **고정**한다 — 부르는 쪽이 실수로 공개로 올릴 자리를 만들지 않는다.
 */

export interface StoredFile {
  /** 저장소 안의 자리. DB 에는 이것만 남는다 — 바이트는 남지 않는다 */
  key: string
  contentType: string
  size: number
}

export interface Storage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<StoredFile>
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>
  remove(key: string): Promise<void>
}

/** 저장소가 붙어 있지 않을 때 부르는 쪽이 보는 것 — 조용히 비우지 않는다 */
export class StorageUnavailable extends Error {
  constructor(message = '파일 저장소가 아직 연결되지 않았습니다.') {
    super(message)
  }
}

/**
 * 어느 백엔드를 쓸 것인가.
 *
 * - `BLOB_STORE_ID` 가 있으면 Vercel (배포된 자리)
 * - `LOCAL_STORAGE_DIR` 이 있으면 파일 시스템 (검사·개발)
 * - 둘 다 없으면 없는 것이다 — 부르는 쪽이 503 으로 말한다
 */
export function storageKind(env: NodeJS.ProcessEnv): 'vercel-blob' | 'local' | 'none' {
  if ((env['BLOB_STORE_ID'] ?? '') !== '') return 'vercel-blob'
  if ((env['LOCAL_STORAGE_DIR'] ?? '') !== '') return 'local'
  return 'none'
}

export function storageConfigured(env: NodeJS.ProcessEnv): boolean {
  return storageKind(env) !== 'none'
}

/**
 * 키가 저장소 밖으로 나가지 못하게 한다.
 *
 * 로컬 백엔드는 키를 경로로 쓴다. `../` 가 섞이면 저장소 바깥 파일을 읽거나 덮는다.
 * 값을 고쳐서 통과시키지 않고 **거절한다** — 조용히 고치면 무엇이 저장됐는지 아무도 모른다.
 */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}$/
export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) {
    throw new StorageUnavailable(`저장소 키가 올바르지 않습니다: ${key.slice(0, 40)}`)
  }
}

/** 파일 시스템 백엔드 — 검사와 개발용. 배포에서는 쓰지 않는다(서버리스는 디스크가 사라진다) */
function localStorage(dir: string): Storage {
  return {
    async put(key, bytes, contentType) {
      assertSafeKey(key)
      const { mkdir, writeFile } = await import('node:fs/promises')
      const { dirname, join } = await import('node:path')
      const file = join(dir, key)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, bytes)
      await writeFile(file + '.type', contentType)
      return { key, contentType, size: bytes.byteLength }
    },
    async get(key) {
      assertSafeKey(key)
      const { readFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const file = join(dir, key)
      try {
        const bytes = await readFile(file)
        const contentType = await readFile(file + '.type', 'utf8').catch(() => 'application/octet-stream')
        return { bytes: new Uint8Array(bytes), contentType }
      } catch {
        return null
      }
    },
    async remove(key) {
      assertSafeKey(key)
      const { rm } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const file = join(dir, key)
      await rm(file, { force: true })
      await rm(file + '.type', { force: true })
    },
  }
}

/**
 * Vercel Blob 백엔드.
 *
 * `put` 은 덮어쓰기를 허용한다(`allowOverwrite`) — 파트너가 서류를 다시 올리면 같은 자리에
 * 새 파일이 온다. 키에 파트너와 종류가 들어 있으므로 남의 것을 덮을 수는 없다.
 *
 * 읽기는 SDK 가 만든 비공개 URL 을 OIDC 로 받아 온다. 그 URL 은 브라우저에 주지 않는다 —
 * 바이트는 우리 서버를 거쳐 나가고, 누가 볼 수 있는지는 도메인이 정한다.
 */
function vercelBlob(): Storage {
  return {
    async put(key, bytes, contentType) {
      assertSafeKey(key)
      const { put } = await import('@vercel/blob')
      const r = await put(key, Buffer.from(bytes), {
        access: 'private',
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      })
      return { key: r.pathname, contentType, size: bytes.byteLength }
    },
    async get(key) {
      assertSafeKey(key)
      const { head, getDownloadUrl } = await import('@vercel/blob')
      const meta = await head(key).catch(() => null)
      if (meta === null) return null
      const res = await fetch(getDownloadUrl(meta.url), {
        headers: await blobAuthHeader(),
      })
      if (!res.ok) return null
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: meta.contentType ?? 'application/octet-stream',
      }
    },
    async remove(key) {
      assertSafeKey(key)
      const { del } = await import('@vercel/blob')
      await del(key).catch(() => {})
    },
  }
}

/** 비공개 blob 을 받을 때 쓰는 머리. OIDC 를 먼저 본다 — 토큰은 없어도 된다 */
async function blobAuthHeader(): Promise<Record<string, string>> {
  const rw = process.env['BLOB_READ_WRITE_TOKEN']
  if (rw !== undefined && rw !== '') return { authorization: `Bearer ${rw}` }
  const { getVercelOidcToken } = await import('@vercel/oidc')
  return { authorization: `Bearer ${await getVercelOidcToken()}` }
}

/** 환경을 보고 하나를 고른다. 없으면 `null` — 부르는 쪽이 503 으로 말한다 */
export function storageFor(env: NodeJS.ProcessEnv): Storage | null {
  const kind = storageKind(env)
  if (kind === 'vercel-blob') return vercelBlob()
  if (kind === 'local') return localStorage(env['LOCAL_STORAGE_DIR'] as string)
  return null
}
