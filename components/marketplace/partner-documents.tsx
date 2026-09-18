'use client'
import { useCallback, useEffect, useState } from 'react'
import { FileCheck2, Upload } from 'lucide-react'
import { api } from '@/lib/client'
import { Blank } from './shell'
import {
  ALLOWED_MIME,
  DOCUMENT_KINDS,
  DOCUMENT_LABELS,
  MAX_DOCUMENT_BYTES,
  type DocumentKind,
  type DocumentView,
} from '@/lib/partner-documents'

/**
 * 사업자 확인 서류 — 내는 쪽과 보는 쪽 (29-23).
 *
 * 새 파일로 둔 이유: `/partner/profile` 과 `/admin/partners` 는 v17 이식 화면이라, 거기에
 * 서류 코드를 섞으면 원본과 대조하기 어려워진다. 주소에서 나란히 붙인다 —
 * `ConsultButton` 을 업체 화면에 붙인 것과 같은 방식이다(29-16).
 *
 * ## 서류는 미리 그리지 않는다
 *
 * 목록에는 종류·크기·낸 시각만 있다. 실제 내용은 **누른 사람에게만** 나간다.
 * 신분 서류가 화면을 여는 것만으로 눈에 들어오지 않게 한다 — 관리자 화면이 어깨너머로
 * 보이는 자리일 수도 있다.
 */

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))}KB`
const day = (iso: string) => iso.slice(0, 10)

async function toBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i] as number)
  return btoa(bin)
}

/** 한 장을 받아 새 창으로 연다. 저장소 주소가 아니라 바이트를 받는다 */
async function openDocument(id: string, setError: (m: string) => void) {
  try {
    const f = await api<{ mime: string; base64: string; label: string }>(`partner-document/${id}`)
    const bin = atob(f.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }))
    window.open(url, '_blank', 'noopener')
    // 브라우저가 창을 연 뒤 되돌린다 — 남겨 두면 이 탭이 서류를 계속 쥐고 있다
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    setError((e as Error).message)
  }
}

function DocumentRows({ rows, onOpen }: { rows: DocumentView[]; onOpen: (id: string) => void }) {
  return (
    <ul className="doc-list" data-doc-list>
      {rows.map((d) => (
        <li key={d.id} data-doc-row={d.kind}>
          <span>
            <FileCheck2 size={16} /> {d.label}
          </span>
          <small className="muted">
            {kb(d.size)} · {day(d.created_at)} 제출 · {day(d.expires_at)} 파기 예정
          </small>
          <button type="button" className="btn secondary" data-doc-open={d.kind} onClick={() => onOpen(d.id)}>
            열어 보기
          </button>
        </li>
      ))}
    </ul>
  )
}

/** 파트너가 자기 서류를 내는 자리 — `/partner/profile` 아래에 붙는다 */
export function PartnerDocumentUpload() {
  const [rows, setRows] = useState<DocumentView[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<DocumentKind | ''>('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    api<DocumentView[]>('partner-documents')
      .then(setRows)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoaded(true))
  }, [])
  useEffect(load, [load])

  const send = async (kind: DocumentKind, file: File) => {
    setError('')
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError(`서류는 ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)}MB 이하만 올릴 수 있습니다.`)
      return
    }
    if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) {
      setError('PDF, JPG, PNG 만 올릴 수 있습니다.')
      return
    }
    setBusy(kind)
    try {
      await api('partner-documents', { kind, mime: file.type, base64: await toBase64(file) })
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const have = new Set(rows.map((r) => r.kind))

  return (
    <section className="panel field-stack" data-partner-documents>
      <h2>사업자 확인 서류</h2>
      <p className="small muted">
        사업자로 활동하시려면 두 가지가 필요합니다. 개인으로 활동하시면 내지 않으셔도 됩니다. 서류는 운영자만 볼 수
        있고, 제출일로부터 180일 뒤에 파기됩니다.
      </p>
      {error !== '' && (
        <p className="error" role="alert" data-doc-error>
          {error}
        </p>
      )}
      {DOCUMENT_KINDS.map((kind) => (
        <label className="field" key={kind}>
          {DOCUMENT_LABELS[kind]}
          {have.has(kind) && <span className="status"> 제출됨</span>}
          <input
            type="file"
            accept={ALLOWED_MIME.join(',')}
            disabled={busy !== ''}
            data-doc-upload={kind}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void send(kind, f)
              e.target.value = ''
            }}
          />
        </label>
      ))}
      {busy !== '' && (
        <p className="small muted">
          <Upload size={14} /> 올리는 중…
        </p>
      )}
      {loaded && rows.length === 0 ? (
        <Blank title="아직 낸 서류가 없습니다" description="사업자로 활동하시려면 위 두 가지를 올려 주세요." />
      ) : (
        <DocumentRows rows={rows} onOpen={(id) => void openDocument(id, setError)} />
      )}
    </section>
  )
}

/** 운영자가 한 파트너의 서류를 보는 자리 — 승인 카드 안에 붙는다 */
export function PartnerDocumentReview({ partnerId, partnerType }: { partnerId: string; partnerType: string }) {
  const [rows, setRows] = useState<DocumentView[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api<DocumentView[]>(`partner-documents/${encodeURIComponent(partnerId)}`)
      .then(setRows)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoaded(true))
  }, [partnerId])

  if (partnerType !== 'business') {
    return (
      <p className="small muted" data-doc-not-required>
        개인 파트너 — 확인 서류를 받지 않습니다.
      </p>
    )
  }

  const missing = DOCUMENT_KINDS.filter((k) => !rows.some((r) => r.kind === k))

  return (
    <div className="doc-review" data-doc-review>
      {error !== '' && (
        <p className="error" role="alert" data-doc-error>
          {error}
        </p>
      )}
      <DocumentRows rows={rows} onOpen={(id) => void openDocument(id, setError)} />
      {loaded && missing.length > 0 && (
        <p className="small" data-doc-missing role="status">
          아직 안 낸 서류: {missing.map((k) => DOCUMENT_LABELS[k]).join(' · ')} — 둘 다 있어야 승인할 수 있습니다.
        </p>
      )}
    </div>
  )
}
