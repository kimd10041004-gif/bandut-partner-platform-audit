import { MAX_PHOTO_BYTES } from '../domain/platform'
import { DomainError } from '../../server/domain/errors'
import type { RequestPhoto } from '../domain/types'

/**
 * 사진 처리 오류 (28-66-04) — 사용자에게 그대로 보여주는 메시지다.
 *
 * 28-66까지 이 파일은 맨 `new Error(...)`를 던졌다. `errors.test.ts`의 발견 범위가
 * `src/domain/*.ts`로 한정돼 있어서, `errors.ts`가 약속한 "상속하지 않으면 테스트가 잡는다"가
 * 여기서는 성립하지 않았다. 이제 도메인 계열이라 `isKnownError`가 참이고,
 * 넓어진 발견 테스트의 대상이기도 하다.
 */
export class ImageError extends DomainError {
  constructor(message: string) {
    super(message)
    this.name = 'ImageError'
  }
}

/** 브라우저 리사이즈 (28-48-02): 긴 변 maxEdge 이하, JPEG 품질을 낮춰 가며 MAX_PHOTO_BYTES 이하로 맞춘다 */
export async function resizeImageFile(file: File, maxEdge = 960): Promise<RequestPhoto> {
  const bitmap = await loadImage(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageError('이미지 처리를 지원하지 않는 브라우저입니다')
  ctx.drawImage(bitmap, 0, 0, width, height)
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    const bytes = Math.ceil(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)
    if (bytes <= MAX_PHOTO_BYTES) {
      return {
        id: `PH-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        dataUrl,
        width,
        height,
        bytes,
      }
    }
  }
  throw new ImageError('사진이 너무 큽니다 — 더 작은 사진을 선택해 주세요')
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    // 28-67-04: 3곳 중 마지막 하나. 손상된 이미지 파일을 고르는 **가장 흔한 실패 경로**인데
    //   맨 Error라 호출부의 isKnownError가 거짓이었다.
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImageError('이미지 파일을 읽을 수 없습니다'))
    }
    img.src = url
  })
}
