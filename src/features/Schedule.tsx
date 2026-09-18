import { useState } from 'react'
import { todayUTC } from '../domain/platform'
import { slotsOn } from '../domain/schedule'
import { parseHourInput, parseWonInput } from '../domain/money'
import { usePlatform, usePartnerId } from '../app/PlatformContext'
import { isKnownError } from '../ui/format'

/** 예약 가능 시간대 (28-19-02): 오입력 방지를 위해 select — 검증은 도메인(parseHourInput) 그대로 */
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]

export default function Schedule() {
  const { platform, refresh } = usePlatform()
  const partnerId = usePartnerId()
  // 28-41-03: 내 낙찰 건만 예약 후보, 내 슬롯만 표시
  const candidates = platform.store.list('accepted').filter((r) => platform.partnerOf(r.id) === partnerId)
  // 28-56-01: 방문 예정 건은 같은 폼으로 일정 변경
  const scheduled = platform.store.list('scheduled').filter((r) => platform.partnerOf(r.id) === partnerId)
  const all = [...candidates, ...scheduled]
  const [selectedId, setSelectedId] = useState('')
  const requestId = all.some((c) => c.id === selectedId) ? selectedId : (all[0]?.id ?? '')
  const isReschedule = scheduled.some((c) => c.id === requestId)
  const [date, setDate] = useState(todayUTC())
  const [start, setStart] = useState('9')
  const [end, setEnd] = useState('12')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [filterByDate, setFilterByDate] = useState(false)
  // 28-95: 낙찰 건은 계약서(예약금·조건·일정)를 보내고, 방문 예정 건은 일정 변경을 제안한다 — 고객이 결정한다
  const [deposit, setDeposit] = useState('')
  const [terms, setTerms] = useState('')
  const [reason, setReason] = useState('')
  const proposed = requestId ? platform.proposedContract(requestId) : undefined
  const pendingChange = requestId ? platform.proposedScheduleChange(requestId) : undefined
  const bidTotal = requestId ? (platform.bidOf(requestId, partnerId)?.breakdown.total ?? 0) : 0
  const depositDefault = Math.max(10_000, Math.floor(bidTotal / 10))

  const submit = () => {
    setError('')
    setMessage('')
    if (!requestId) {
      // #257 리뷰: 후보는 낙찰(계약서)·방문 예정(일정 변경 제안) 둘이다 — 문구도 그 둘을 말한다
      setError('보낼 작업이 없습니다 — 낙찰 상태(계약서)나 방문 예정 상태(일정 변경 제안)의 작업이 있어야 합니다')
      return
    }
    try {
      const input = { date, startHour: parseHourInput(start), endHour: parseHourInput(end) }
      if (isReschedule) {
        const c = platform.proposeSchedule(requestId, partnerId, { ...input, reason })
        setMessage(`일정 변경을 제안했습니다 (${c.id}) — 고객이 승인하면 바뀝니다`)
        setReason('')
      } else {
        const c = platform.proposeContract(requestId, partnerId, {
          ...input,
          deposit: deposit.trim() === '' ? depositDefault : parseWonInput(deposit),
          terms,
        })
        setMessage(`계약서 v${c.version}을 보냈습니다 — 고객이 동의하면 방문 일정이 확정됩니다`)
      }
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  const slots = platform.scheduleSlots.filter((s) => s.partnerId === partnerId)
  const visible = filterByDate
    ? slotsOn(slots, partnerId, date)
    : [...slots].sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)

  // 28-24-02: 월 캘린더 — UTC 규약 유지, 날짜 클릭은 기존 날짜 필터와 연동
  const today = todayUTC()
  const [calMonth, setCalMonth] = useState(today.slice(0, 7))
  const cy = Number(calMonth.slice(0, 4))
  const cm = Number(calMonth.slice(5, 7))
  const moveMonth = (delta: number) => {
    const d = new Date(Date.UTC(cy, cm - 1 + delta, 1))
    setCalMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  const firstDow = new Date(Date.UTC(cy, cm - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(cy, cm, 0)).getUTCDate()
  const byDate = new Map<string, typeof slots>()
  for (const s of slots) {
    if (!s.date.startsWith(`${calMonth}-`)) continue
    const list = byDate.get(s.date) ?? []
    list.push(s)
    byDate.set(s.date, list)
  }
  const pickDay = (iso: string) => {
    setDate(iso)
    setFilterByDate(true)
  }

  return (
    <div>
      <div className="card cal-card">
        <div className="cal-head">
          <button className="cal-nav" onClick={() => moveMonth(-1)} aria-label="이전 달">
            ‹
          </button>
          <strong>
            {cy}년 {cm}월
          </strong>
          <button className="cal-nav" onClick={() => moveMonth(1)} aria-label="다음 달">
            ›
          </button>
        </div>
        <div className="cal-grid">
          {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}
          {Array.from({ length: firstDow }, (_, i) => (
            <div key={`blank-${i}`} className="cal-blank" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1
            const iso = `${calMonth}-${String(day).padStart(2, '0')}`
            const daySlots = (byDate.get(iso) ?? []).sort((a, b) => a.startHour - b.startHour)
            const off = platform.isDayOff(partnerId, iso)
            const cls = [
              'cal-cell',
              iso === today ? 'today' : '',
              filterByDate && iso === date ? 'selected' : '',
              off ? 'dayoff' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button key={iso} className={cls} onClick={() => pickDay(iso)} {...(off ? { 'data-dayoff': iso } : {})}>
                <span className="cal-day">{day}</span>
                {off && <span className="cal-slot cal-off">휴무</span>}
                {daySlots.slice(0, 2).map((s) => (
                  <span key={s.id} className="cal-slot">
                    {platform.store.get(s.requestId)?.category ?? '방문'}
                  </span>
                ))}
                {daySlots.length > 2 && <span className="cal-slot cal-more">+{daySlots.length - 2}</span>}
                {daySlots.length > 0 && <span className="cal-dot" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </div>
      <div className="form" style={{ marginBottom: 16 }}>
        <label>
          작업 선택 (낙찰 → 계약서 · 방문 예정 → 일정 변경 제안)
          <select value={requestId} onChange={(e) => setSelectedId(e.target.value)}>
            {all.length === 0 && <option value="">보낼 작업 없음</option>}
            {candidates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} · [{r.category}] {r.description}
              </option>
            ))}
            {scheduled.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} · [{r.category}] {r.description} (방문 예정 — 일정 변경)
              </option>
            ))}
          </select>
        </label>
        {!isReschedule && requestId && (
          <>
            <label>
              예약금 (원) — 비우면 낙찰가의 10%
              <input
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                inputMode="numeric"
                placeholder={String(depositDefault)}
                aria-label="계약 예약금"
              />
            </label>
            <label className="form-wide">
              계약 조건
              <input
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="예: 자재 포함, 시공 후 1년 보증, 추가 작업은 별도 승인"
                aria-label="계약 조건"
              />
            </label>
            <div className="meta form-wide" data-contract-fee>
              총액 {bidTotal.toLocaleString('ko-KR')}원 · 플랫폼 수수료 {platform.commissionBpsFor(requestId) / 100}%
              {proposed && ` · 계약서 v${proposed.version} 고객 확인 대기 중 (다시 보내면 새 버전)`}
            </div>
          </>
        )}
        {isReschedule && requestId && (
          <label className="form-wide">
            변경 사유
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 앞 현장이 지연되어 오후로 옮기고 싶습니다"
              aria-label="일정 변경 사유"
            />
            {pendingChange && (
              <span className="meta" data-schedule-pending>
                {pendingChange.date} {String(pendingChange.startHour).padStart(2, '0')}:00 제안이 고객 승인 대기 중
              </span>
            )}
          </label>
        )}
        <label>
          날짜
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          시작 시각
          <select value={start} onChange={(e) => setStart(e.target.value)}>
            {HOURS.map((h) => (
              <option key={h} value={String(h)}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        <label>
          종료 시각
          <select value={end} onChange={(e) => setEnd(e.target.value)}>
            {HOURS.map((h) => (
              <option key={h} value={String(h)}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        <button onClick={submit}>{isReschedule ? '일정 변경 제안' : '계약서 보내기'}</button>
        <button
          className="btn-secondary"
          data-dayoff-toggle
          onClick={() => {
            setError('')
            try {
              platform.toggleDayOff(partnerId, date)
              refresh()
            } catch (err) {
              if (isKnownError(err)) setError(err.message)
              else throw err
            }
          }}
        >
          {platform.isDayOff(partnerId, date) ? `${date} 휴무 해제` : `${date} 휴무 설정`}
        </button>
        <label style={{ flexDirection: 'row', alignItems: 'center', display: 'flex', gap: 6 }}>
          <input type="checkbox" checked={filterByDate} onChange={(e) => setFilterByDate(e.target.checked)} />
          선택한 날짜만 보기
        </label>
        {error && <div className="error">{error}</div>}
        {message && (
          <div className="meta" data-schedule-msg>
            {message}
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th>시간</th>
              <th>요청</th>
              <th>고객 / 공사</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="meta">
                  일정이 없습니다
                </td>
              </tr>
            )}
            {visible.map((s) => {
              const req = platform.store.get(s.requestId)
              return (
                <tr key={s.id}>
                  <td>{s.date}</td>
                  <td>
                    {String(s.startHour).padStart(2, '0')}:00~{String(s.endHour).padStart(2, '0')}:00
                  </td>
                  <td>{s.requestId}</td>
                  <td>{req ? `${req.customerName} · [${req.category}] ${req.description}` : '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
