import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertSafeKey, storageConfigured, storageFor, storageKind, StorageUnavailable } from './storage'

/**
 * 저장소 포트 (29-23).
 *
 * 배포된 Vercel 백엔드는 여기서 잴 수 없다. 그래서 **잴 수 있는 것을 전부 잰다** —
 * 어느 백엔드를 고르는가, 키가 저장소 밖으로 나가는가, 로컬 백엔드가 계약을 지키는가.
 *
 * 키 검사가 이 파일에서 제일 중요하다. 로컬 백엔드는 키를 경로로 쓰므로 `../` 하나가
 * 저장소 바깥을 읽거나 덮는다. 그 줄이 없으면 나머지는 다 맞아도 소용이 없다.
 */
describe('저장소 고르기', () => {
  it('BLOB_STORE_ID 가 있으면 Vercel, LOCAL_STORAGE_DIR 이면 파일, 없으면 없다', () => {
    expect(storageKind({ BLOB_STORE_ID: 'store_x' } as NodeJS.ProcessEnv)).toBe('vercel-blob')
    expect(storageKind({ LOCAL_STORAGE_DIR: '/tmp/x' } as NodeJS.ProcessEnv)).toBe('local')
    expect(storageKind({} as NodeJS.ProcessEnv)).toBe('none')
    // 빈 문자열은 "설정했다"가 아니다 — 환경변수를 지우는 대신 비우는 일이 흔하다
    expect(storageKind({ BLOB_STORE_ID: '' } as NodeJS.ProcessEnv)).toBe('none')
    expect(storageConfigured({} as NodeJS.ProcessEnv)).toBe(false)
    expect(storageFor({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('둘 다 있으면 Vercel 이 이긴다 — 배포에서 로컬 디스크로 새지 않는다', () => {
    expect(storageKind({ BLOB_STORE_ID: 'store_x', LOCAL_STORAGE_DIR: '/tmp/x' } as NodeJS.ProcessEnv)).toBe(
      'vercel-blob',
    )
  })
})

describe('키가 저장소 밖으로 나가지 못한다', () => {
  it('경로를 벗어나는 키는 고치지 않고 거절한다', () => {
    for (const bad of [
      '../etc/passwd',
      'a/../../b',
      '/absolute/path',
      'a//b',
      '',
      'a'.repeat(500),
      'partner/../../secret',
    ]) {
      expect(() => assertSafeKey(bad), bad).toThrow(StorageUnavailable)
    }
  })

  it('평범한 키는 지나간다', () => {
    for (const ok of ['partner-docs/u1/business.pdf', 'a', 'A0/_-./x']) {
      expect(() => assertSafeKey(ok), ok).not.toThrow()
    }
  })
})

describe('로컬 백엔드가 계약을 지킨다', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bandut-storage-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('넣은 것이 그대로 나오고, 지우면 없다', async () => {
    const s = storageFor({ LOCAL_STORAGE_DIR: dir } as NodeJS.ProcessEnv)
    expect(s).not.toBeNull()
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
    const saved = await s!.put('partner-docs/u1/business.pdf', bytes, 'application/pdf')
    expect(saved).toEqual({ key: 'partner-docs/u1/business.pdf', contentType: 'application/pdf', size: 5 })

    const got = await s!.get('partner-docs/u1/business.pdf')
    expect(got?.contentType).toBe('application/pdf')
    expect(Array.from(got?.bytes ?? [])).toEqual(Array.from(bytes))

    await s!.remove('partner-docs/u1/business.pdf')
    expect(await s!.get('partner-docs/u1/business.pdf')).toBeNull()
  })

  it('없는 키는 던지지 않고 null 이다 — 없는 것과 깨진 것은 다르다', async () => {
    const s = storageFor({ LOCAL_STORAGE_DIR: dir } as NodeJS.ProcessEnv)
    expect(await s!.get('partner-docs/nobody/none.pdf')).toBeNull()
  })

  it('같은 키에 다시 넣으면 덮인다 — 서류를 다시 올릴 수 있어야 한다', async () => {
    const s = storageFor({ LOCAL_STORAGE_DIR: dir } as NodeJS.ProcessEnv)
    await s!.put('partner-docs/u2/travel.png', new Uint8Array([1]), 'image/png')
    await s!.put('partner-docs/u2/travel.png', new Uint8Array([2, 2]), 'image/png')
    const got = await s!.get('partner-docs/u2/travel.png')
    expect(Array.from(got?.bytes ?? [])).toEqual([2, 2])
  })

  it('나쁜 키로는 파일을 만들지 않는다 — 거절이 먼저다', async () => {
    const s = storageFor({ LOCAL_STORAGE_DIR: dir } as NodeJS.ProcessEnv)
    await expect(s!.put('../escaped.pdf', new Uint8Array([1]), 'application/pdf')).rejects.toThrow(StorageUnavailable)
    expect((await readdir(dir)).some((n) => n.includes('escaped'))).toBe(false)
  })
})
