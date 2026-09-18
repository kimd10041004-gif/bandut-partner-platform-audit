'use client'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import type { Partner } from '@/lib/model'

/**
 * 처음 온 사람에게 다음 한 걸음을 알려 준다 (29-24).
 *
 * ## 왜 "본 적 있음" 표시를 쓰지 않나
 *
 * 흔한 방법은 처음 로그인할 때 안내를 띄우고 `localStorage`에 봤다고 적는 것이다. 그 방법은 두 번
 * 틀린다. 브라우저를 바꾸면 다 본 사람에게 다시 뜨고, 안내만 닫고 아무것도 안 한 사람에게는 다시
 * 뜨지 않는다.
 *
 * 그래서 **서버가 아는 사실**로만 판단한다. 고객은 접수한 요청이 하나도 없을 때, 파트너는 승인
 * 전일 때 나온다. 첫 걸음을 실제로 떼면 **스스로 사라진다** — 닫는 버튼이 없는 이유다.
 *
 * ## 남은 걸음만 보여 준다
 *
 * 파트너는 제출 → 서류 → 승인의 세 걸음이고, 지금 어디인지에 따라 끝난 것에 표시가 붙는다.
 * "무엇을 하면 되는가"와 "왜 아직 못 하는가"가 같은 자리에 있어야 한다.
 */

interface Step {
  title: string
  detail: string
  done?: boolean
}

function Guide({
  title,
  lead,
  steps,
  action,
}: {
  title: string
  lead: string
  steps: Step[]
  action?: [string, string]
}) {
  return (
    <section className="panel welcome-card" data-welcome>
      <span className="eyebrow">GETTING STARTED</span>
      <h2>{title}</h2>
      <p className="muted">{lead}</p>
      <ol className="welcome-steps">
        {steps.map((s, i) => (
          <li key={s.title} data-welcome-step={s.done === true ? 'done' : 'todo'}>
            <span className="welcome-step-mark">{s.done === true ? <Check size={14} /> : i + 1}</span>
            <div>
              <strong>{s.title}</strong>
              <span>{s.detail}</span>
            </div>
          </li>
        ))}
      </ol>
      {action && (
        <Link className="btn primary" href={action[1]} data-welcome-go>
          {action[0]} <ArrowRight size={16} />
        </Link>
      )}
    </section>
  )
}

/** 고객 — 아직 접수한 요청이 없을 때만 */
export function CustomerWelcome() {
  return (
    <Guide
      title="처음 오셨네요. 이렇게 시작합니다"
      lead="접수하셔도 지금 결제되는 금액은 없습니다. 견적을 받아 보고 결정하세요."
      steps={[
        { title: '수리할 곳을 알려 주세요', detail: '분야와 사진, 방문 주소와 희망 일정을 받습니다.' },
        { title: '견적을 비교하세요', detail: '승인된 업체들이 금액과 포함·제외 범위를 보내 드립니다.' },
        { title: '업체를 고르시면 시작합니다', detail: '고르신 뒤에야 연락처와 상세 주소가 그 업체에 전달됩니다.' },
      ]}
      action={['수리 요청하기', '/request']}
    />
  )
}

/** 파트너 — 승인 전일 때만. 어디까지 왔는지가 걸음에 표시된다 */
export function PartnerWelcome({ partner }: { partner: Partner | null }) {
  const submitted = partner !== null
  const business = partner?.partner_type === 'business'
  const pending = partner?.status === 'PENDING'
  return (
    <Guide
      title={pending ? '승인 검토 중입니다' : submitted ? '승인까지 남은 걸음입니다' : '파트너 활동을 준비해 주세요'}
      lead={
        submitted
          ? '운영자가 제출하신 내용을 확인하고 있습니다. 승인되면 일감과 견적 제출이 열립니다.'
          : '업체 정보를 먼저 등록하시면 운영자 확인 뒤에 일감을 보실 수 있습니다.'
      }
      steps={[
        {
          title: '업체 정보 등록',
          detail: '업체명·대표자·연락처와 전문 공종, 활동 지역을 제출합니다.',
          done: submitted,
        },
        {
          title: business ? '사업자 확인 서류 제출' : '활동 유형 선택',
          detail: business
            ? '사업자등록증과 출입국사실증명서를 올려 주세요. 둘 다 있어야 승인됩니다.'
            : '개인으로 활동하시면 확인 서류를 따로 내지 않으셔도 됩니다.',
          done: submitted && !business,
        },
        {
          title: '운영자 승인',
          detail: pending
            ? '검토 중입니다. 승인되면 알림으로 알려 드립니다.'
            : '승인 뒤에 일감과 견적 제출이 열립니다.',
        },
      ]}
      action={['파트너 정보 확인', '/partner/profile']}
    />
  )
}
