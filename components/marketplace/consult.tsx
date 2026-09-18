'use client'
/**
 * 거래 전 상담 (29-16, 명세 7절).
 *
 * ## 거래 메시지와 다른 자리다
 *
 * 기존 채팅(`orders/:id/chat`)은 주문에 매여 있다. 여기는 주문이 없다 — 아직 요청하지 않은 손님이
 * 업체에 먼저 물어보는 자리다. 표도 화면도 따로 두고, 기존 거래 메시지는 손대지 않는다.
 *
 * ## 다시 눌러도 한 번만 간다
 *
 * 보내기 버튼을 다시 누르는 일은 흔하다. 화면이 메시지 ID 를 만들어 함께 보내고, 서버가 같은 ID 를
 * 두 번째로 받으면 조용히 넘긴다. 그래서 재시도가 대화를 더럽히지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, Send } from 'lucide-react'
import { api } from '@/lib/client'
import { PageHeading, useAccount } from './shell'

interface ConsultMessage {
  seq: number
  id: string
  sender_id: string
  sender_name: string
  body: string
  created_at: string
}
interface Room {
  id: string
  partner_id: string
  company: string
  customer_id: string
  customer_name: string
  case_id: string | null
  updated_at: string
  unread: number
}

/** 업체 상세에 붙는 "상담하기" 단추 — 고객만 보인다 */
export function ConsultButton({ companyId }: { companyId: string }) {
  const { user } = useAccount()
  const [error, setError] = useState('')
  const [roomId, setRoomId] = useState('')
  const [busy, setBusy] = useState(false)

  if (user === null)
    return (
      <p className="small muted" data-consult-login>
        상담을 시작하시려면{' '}
        <Link className="inline-link" href="/login?role=customer">
          로그인
        </Link>
        이 필요합니다.
      </p>
    )
  if (user.role !== 'CUSTOMER') return null

  return (
    <p className="small muted">
      {roomId === '' ? (
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          data-consult-open
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              const r = await api<{ id: string }>(`company/${encodeURIComponent(companyId)}/consult`, { caseId: null })
              setRoomId(r.id)
            } catch (e) {
              setError((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <MessageSquare size={16} /> 상담하기
        </button>
      ) : (
        <Link className="inline-link" href={`/consult/${encodeURIComponent(roomId)}`} data-consult-go>
          상담방으로 가기
        </Link>
      )}
      {error !== '' && (
        <span className="error" role="alert" data-consult-error>
          {' '}
          {error}
        </span>
      )}
    </p>
  )
}

/** 내 상담 목록 — 고객이면 내가 연 방, 업체면 우리에게 온 방 */
export function ConsultList() {
  const [rows, setRows] = useState<Room[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<Room[]>('consultations')
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="workspace">
      <PageHeading eyebrow="CONSULT" title="상담" description="작업을 요청하기 전에 나눈 대화입니다." />
      {error !== '' && (
        <p className="error" role="alert" data-consult-list-error>
          {error}
        </p>
      )}
      {error === '' && rows.length === 0 && (
        <p className="small muted" data-consult-empty>
          아직 상담이 없습니다. 업체 페이지에서 상담을 시작해 보세요.
        </p>
      )}
      <ul className="card-list" data-consult-list>
        {rows.map((r) => (
          <li key={r.id} className="panel">
            <Link className="inline-link" href={`/consult/${encodeURIComponent(r.id)}`}>
              <strong>{r.company}</strong>
            </Link>
            <p className="small muted">
              {r.updated_at.slice(0, 16).replace('T', ' ')}
              {r.unread > 0 && <strong data-consult-unread={r.id}> · 안 읽음 {r.unread}</strong>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 상담방 하나 */
export function ConsultRoom({ id }: { id: string }) {
  const { user } = useAccount()
  const [messages, setMessages] = useState<ConsultMessage[]>([])
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 보내는 중인 메시지의 ID. 재시도해도 같은 값을 쓴다 — 그래야 서버가 중복을 알아본다 */
  const pending = useRef('')

  const load = useCallback(() => {
    api<{ messages: ConsultMessage[] }>(`consultations/${encodeURIComponent(id)}`)
      .then((d) => {
        setMessages(d.messages)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
  }, [id])
  useEffect(load, [load])

  return (
    <div className="workspace">
      <PageHeading eyebrow="CONSULT" title="상담" description="작업 요청 전에 편하게 물어보세요." />
      {error !== '' && (
        <p className="error" role="alert" data-room-error>
          {error}
        </p>
      )}
      <ul className="card-list" data-room-messages>
        {messages.map((m) => (
          <li key={m.id} className="panel" data-room-message={m.id}>
            <p className="small muted">
              {m.sender_name}
              {user !== null && m.sender_id === user.id ? ' (나)' : ''} · {m.created_at.slice(0, 16).replace('T', ' ')}
            </p>
            <p>{m.body}</p>
          </li>
        ))}
      </ul>
      <form
        className="panel field-stack"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          if (pending.current === '') pending.current = crypto.randomUUID()
          try {
            await api(`consultations/${encodeURIComponent(id)}/messages`, { id: pending.current, body: body.trim() })
            pending.current = ''
            setBody('')
            load()
          } catch (err) {
            // ID 를 비우지 않는다 — 다시 눌렀을 때 같은 ID 로 가야 중복이 안 생긴다
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <label className="field">
          보낼 말
          <textarea
            required
            minLength={1}
            maxLength={2000}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            data-room-input
          />
        </label>
        <button className="btn primary" disabled={busy} data-room-send>
          <Send size={16} /> {busy ? '보내는 중…' : '보내기'}
        </button>
        <p className="small muted">
          여기서 나눈 이야기는 정식 견적이나 계약이 아닙니다. 금액 확정은 작업 요청 뒤 견적에서 합니다.
        </p>
      </form>
    </div>
  )
}
