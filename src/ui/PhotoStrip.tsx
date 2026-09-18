import { useState } from 'react'
import type { RequestPhoto } from '../domain/types'

/** 현장·완료 사진 썸네일 (28-48-03, 28-49-03): 클릭 시 인라인 확대. 편집 모드면 삭제 버튼. completion이면 [data-completion] */
export default function PhotoStrip({
  photos,
  onRemove,
  title,
  completion = false,
  before = false,
}: {
  photos: readonly RequestPhoto[] | undefined
  onRemove?: (id: string) => void
  title?: string
  completion?: boolean
  /** 28-96: 작업 전 사진이면 [data-before] */
  before?: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (!photos || photos.length === 0) return null
  const big = photos.find((p) => p.id === open)
  const alt = completion ? '시공 완료 사진' : '현장 사진'
  return (
    <div
      className="photo-strip"
      data-completion={completion ? 'true' : undefined}
      data-before={before ? 'true' : undefined}
    >
      {title && <div className="photo-title">{title}</div>}
      <div className="photo-thumbs">
        {photos.map((p) => (
          <div key={p.id} className="photo-thumb">
            <button
              type="button"
              className="photo-btn"
              onClick={() => setOpen(open === p.id ? null : p.id)}
              aria-label="사진 확대"
            >
              <img src={p.dataUrl} alt={alt} width={p.width} height={p.height} />
            </button>
            {onRemove && (
              <button type="button" className="photo-remove" onClick={() => onRemove(p.id)} aria-label="사진 삭제">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {big && (
        <div className="photo-big">
          <img src={big.dataUrl} alt={`${alt} 확대`} width={big.width} height={big.height} />
          <div className="meta">
            {big.width}×{big.height} · {Math.round(big.bytes / 1024)}KB
          </div>
        </div>
      )}
    </div>
  )
}
