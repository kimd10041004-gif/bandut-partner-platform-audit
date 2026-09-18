'use client'
/**
 * 업체 공개 Q&A (29-14, 명세 7절).
 *
 * ## 왜 별도 파일인가
 *
 * 업체 상세 화면은 v17 원본(`community.tsx`)이다. 29-1부터 그 파일은 고치지 않는다 — 시안과
 * 대조할 수 있어야 하기 때문이다. 그래서 이 조각을 그 아래에 얹는 방식으로 붙인다
 * (`app/[...slug]/page.tsx`).
 *
 * ## 누가 무엇을 하는가
 *
 * | | 읽기 | 쓰기 |
 * |---|---|---|
 * | 로그인 안 함 | 공개 질문 | 로그인하라고 안내만 |
 * | 고객 | 공개 질문 | 질문 작성 |
 * | 그 업체 | 공개 질문 | 답변 |
 * | 다른 업체 | 공개 질문 | 아무것도 — 서버가 403 |
 *
 * 화면에서 버튼을 감추는 것은 편의일 뿐이다. 판단은 서버가 한다(`lib/community.ts`).
 *
 * 질문자 이름은 서버가 이미 가려서 보낸다("김OO"). 여기서 되돌릴 방법이 없다.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageCircleQuestion } from 'lucide-react'
import { api } from '@/lib/client'
import { PageHeading, useAccount } from './shell'

interface Question {
  id: string
  partner_id: string
  case_id: string | null
  body: string
  answer: string | null
  answered_at: string | null
  created_at: string
  asker: string
}

export function CompanyQuestions({ companyId }: { companyId: string }) {
  const { user } = useAccount()
  const [rows, setRows] = useState<Question[]>([])
  const [body, setBody] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<Question[]>(`company/${encodeURIComponent(companyId)}/questions`)
      .then((d) => {
        setRows(d)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
  }, [companyId])

  useEffect(load, [load])

  const isCustomer = user?.role === 'CUSTOMER'
  const isThisCompany = user?.role === 'PARTNER' && user.id === companyId

  return (
    <section className="workspace" data-qna>
      <PageHeading
        eyebrow="Q&A"
        title="공개 질문"
        description="다른 분들이 물어본 내용과 업체의 답변입니다. 궁금한 점을 남기면 업체가 답합니다."
      />

      {error !== '' && (
        <p className="error" role="alert" data-qna-error>
          {error}
        </p>
      )}

      {rows.length === 0 && error === '' && (
        <p className="small muted" data-qna-empty>
          아직 올라온 질문이 없습니다. 첫 질문을 남겨 보세요.
        </p>
      )}

      <ul className="card-list" data-qna-list>
        {rows.map((q) => (
          <li key={q.id} className="panel" data-qna-item={q.id}>
            <p className="small muted icon-line">
              <MessageCircleQuestion size={15} />
              <span>
                {q.asker} · {q.created_at.slice(0, 10)}
              </span>
            </p>
            <p>{q.body}</p>
            {q.answer !== null ? (
              <p className="inline-notice" data-qna-answer>
                <strong>업체 답변</strong> {q.answer}
              </p>
            ) : (
              <p className="small muted" data-qna-waiting>
                아직 답변이 등록되지 않았습니다.
              </p>
            )}
            {isThisCompany && q.answer === null && (
              <form
                className="field-stack"
                onSubmit={async (e) => {
                  e.preventDefault()
                  setBusy(true)
                  setError('')
                  try {
                    await api(`questions/${encodeURIComponent(q.id)}/answer`, { answer: (answers[q.id] ?? '').trim() })
                    setAnswers((a) => ({ ...a, [q.id]: '' }))
                    load()
                  } catch (err) {
                    setError((err as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <label className="field">
                  답변
                  <textarea
                    required
                    minLength={5}
                    rows={3}
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    data-qna-answer-input
                  />
                </label>
                <button className="btn primary" disabled={busy} data-qna-answer-submit>
                  답변 등록
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {isCustomer && (
        <form
          className="panel field-stack"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError('')
            try {
              await api(`company/${encodeURIComponent(companyId)}/questions`, { body: body.trim(), caseId: null })
              setBody('')
              load()
            } catch (err) {
              setError((err as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="field">
            궁금한 점
            <textarea
              required
              minLength={5}
              maxLength={1000}
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="예: 20평 아파트 도배는 보통 며칠 걸리나요?"
              data-qna-input
            />
          </label>
          <p className="small muted">이 질문과 답변은 누구나 볼 수 있습니다. 개인정보는 적지 마세요.</p>
          <button className="btn primary" disabled={busy} data-qna-submit>
            질문 남기기
          </button>
        </form>
      )}

      {user === null && (
        <p className="small muted" data-qna-login>
          질문을 남기시려면{' '}
          <Link className="inline-link" href="/login?role=customer">
            로그인
          </Link>
          이 필요합니다. 읽는 것은 로그인 없이도 됩니다.
        </p>
      )}
    </section>
  )
}
