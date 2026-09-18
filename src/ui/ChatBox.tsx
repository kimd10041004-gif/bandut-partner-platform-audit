import { useEffect, useRef, useState } from 'react'
import type { ChatSender } from '../domain/types'
import { usePlatform } from '../app/PlatformContext'
import { CHAT_MAX_TEXT } from '../domain/platform'
import { isKnownError } from './format'

/** 거래 채팅 말풍선 (28-27-02/03, 당근 문법): 내 메시지 우측 브랜드, 상대 좌측 플랫.
 *  열람 시 읽음 처리(markRead)까지 담당 — 고객 상세와 파트너 내 작업이 공유한다. */
export default function ChatBox({ requestId, viewer }: { requestId: string; viewer: ChatSender }) {
  const { platform, refresh } = usePlatform()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const messages = platform.chatFor(requestId)

  useEffect(() => {
    platform.markRead(requestId, viewer)
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [platform, requestId, viewer, messages.length])

  const send = () => {
    setError('')
    try {
      platform.sendMessage(requestId, viewer, draft)
      setDraft('')
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  return (
    <div className="chat-box">
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && <div className="meta">첫 메시지를 보내보세요.</div>}
        {messages.map((m) => (
          <div key={m.id} className={`msg-row ${m.sender === viewer ? 'me' : ''}`}>
            <span className={`bubble ${m.sender === viewer ? 'me' : 'other'}`}>{m.text}</span>
            <span className="msg-time">{m.sentAt.slice(11, 16)}</span>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
          placeholder="메시지 보내기"
          aria-label="메시지 입력"
          maxLength={CHAT_MAX_TEXT}
        />
        <button onClick={send}>전송</button>
      </div>
      <div className="meta chat-count" data-chat-count>
        {draft.length}/{CHAT_MAX_TEXT}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  )
}
