import { useState } from 'react'
import { PARTNER_TYPE_LABEL } from '../../../server/domain/auth'
import { usePlatform, useAdminCan, useAdminGrade, gradeHint } from '../../app/PlatformContext'
import { ADMIN_GRADES, ADMIN_GRADE_LABEL, type AdminGrade } from '../../../server/domain/adminGrade'
import { isKnownError } from '../../ui/format'
import { ICON } from '../../ui/icons'
import { Card, Stat, ToggleGroup } from '../../ui/primitives'

const fmtPhone = (p: string) => (p.length === 11 ? `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}` : p)
const fmtBiz = (b: string) => (b.length === 10 ? `${b.slice(0, 3)}-${b.slice(3, 5)}-${b.slice(5)}` : b)

/** 회원 관리 (28-33-03, 시안 4 "파트너 승인/관리"): 계정 목록 + 정지/해제 */
export default function AdminMembers() {
  const { platform, auth, authActions, refresh } = usePlatform()
  const can = useAdminCan()
  const [error, setError] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'customer' | 'partner' | 'withdrawn'>('all')
  // 28-57-03: 이름·휴대폰·아이디·사업자번호 검색 (숫자만 입력해도 휴대폰 일치)
  const [query, setQuery] = useState('')
  const accounts = auth.listAccounts()
  const q = query.trim().toLowerCase()
  const digits = q.replace(/\D/g, '')
  const matches = (a: (typeof accounts)[number]) =>
    q === '' ||
    a.name.toLowerCase().includes(q) ||
    a.id.toLowerCase().includes(q) ||
    (digits !== '' && ((a.phone ?? '').includes(digits) || (a.bizNo ?? '').includes(digits)))
  const visible = accounts.filter(
    (a) =>
      (roleFilter === 'all' ||
        (roleFilter === 'withdrawn' ? !!a.withdrawnAt : a.role === roleFilter && !a.withdrawnAt)) &&
      matches(a),
  )
  const customers = accounts.filter((a) => a.role === 'customer').length
  const partners = accounts.filter((a) => a.role === 'partner').length
  const suspended = accounts.filter((a) => a.suspended).length
  const withdrawn = accounts.filter((a) => a.withdrawnAt).length
  const pendingPartners = accounts.filter(
    (a) => a.role === 'partner' && (a.approval ?? 'pending') !== 'approved' && a.approval !== 'rejected',
  ).length
  const [rejectFor, setRejectFor] = useState('')
  const [reason, setReason] = useState('')

  // 28-70: 변경은 authActions로(async) — 서버 모드에서는 /api/auth가 같은 규칙을 적용하고 거울을 갱신한다
  const approve = async (id: string) => {
    setError('')
    try {
      await authActions.approvePartner(id)
      platform.audit('admin', '파트너 승인', id, accounts.find((a) => a.id === id)?.name)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }
  const reject = async (id: string) => {
    setError('')
    try {
      await authActions.rejectPartner(id, reason)
      platform.audit('admin', '파트너 거절', id, reason)
      setRejectFor('')
      setReason('')
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  // 28-39-03: 탈퇴 계정 기록 파기 — 법정 보관 기간 경과 후
  const purge = async (id: string) => {
    setError('')
    try {
      await authActions.purgeAccount(id)
      platform.audit('admin', '기록 파기', id)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  const toggle = async (id: string, next: boolean) => {
    setError('')
    try {
      await authActions.setSuspended(id, next)
      platform.audit('admin', next ? '계정 정지' : '정지 해제', id, accounts.find((a) => a.id === id)?.name)
      refresh()
    } catch (err) {
      if (isKnownError(err)) setError(err.message)
      else throw err
    }
  }

  return (
    <div>
      <AdminAccountsCard />
      <div className="stat-grid">
        <Stat tone="blue" icon={ICON.user} label="고객 회원">
          {customers}
          <small>명</small>
        </Stat>
        <Stat tone="green" icon={ICON.work} label="파트너 회원">
          {partners}
          <small>곳</small>
        </Stat>
        <Stat tone="amber" icon={ICON.sliders} label="승인 대기 파트너">
          {pendingPartners}
          <small>곳</small>
        </Stat>
        <Stat tone="brand" icon={ICON.sliders} label="정지 계정">
          {suspended}
          <small>건</small>
        </Stat>
        <Stat tone="blue" icon={ICON.user} label="탈퇴(보관 중)">
          {withdrawn}
          <small>건</small>
        </Stat>
      </div>
      <Card title={`회원 목록 (${visible.length}명)`}>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <ToggleGroup
            label="회원 역할 필터"
            value={roleFilter}
            options={(['all', 'customer', 'partner', 'withdrawn'] as const).map((k) => ({
              value: k,
              label: k === 'all' ? '전체' : k === 'customer' ? '고객' : k === 'partner' ? '파트너' : '탈퇴',
            }))}
            onChange={setRoleFilter}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·휴대폰·아이디·사업자번호"
            aria-label="회원 검색"
            style={{ maxWidth: 260 }}
          />
        </div>
        {error && (
          <div className="error" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}
        <div className="table-wrap" style={{ boxShadow: 'none', border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>역할</th>
                <th>이름</th>
                <th>휴대폰</th>
                <th>유형</th>
                <th>사업자번호</th>
                <th>사업자 조회</th>
                <th>인증</th>
                <th>가입일</th>
                <th>승인</th>
                <th>상태</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={11} className="meta">
                    {q === '' ? '가입한 회원이 없습니다' : '검색 결과가 없습니다'}
                  </td>
                </tr>
              )}
              {visible.map((a) => (
                <tr key={a.id} className="member-row">
                  <td>
                    <span className="svc-tag">{a.role === 'partner' ? '파트너' : '고객'}</span>
                  </td>
                  <td>
                    {a.name}
                    {a.role === 'partner' && !a.withdrawnAt && <div className="meta">{a.id}</div>}
                    {a.role === 'partner' && platform.partnerCancelCount(a.id) > 0 && (
                      <div className="meta cancel-warn" data-member-cancels={platform.partnerCancelCount(a.id)}>
                        낙찰 철회 {platform.partnerCancelCount(a.id)}회 (90일)
                      </div>
                    )}
                    {a.role === 'partner' && platform.bidWithdrawalCount(a.id) > 0 && (
                      <div className="meta" data-member-bid-withdrawals={platform.bidWithdrawalCount(a.id)}>
                        입찰 철회 {platform.bidWithdrawalCount(a.id)}회 (90일)
                      </div>
                    )}
                  </td>
                  <td>{a.phone ? fmtPhone(a.phone) : <span className="meta">파기됨</span>}</td>
                  <td>
                    {a.role === 'partner' && a.partnerType ? (
                      <span className={`svc-tag ${a.partnerType === 'business' ? 'biz' : 'indiv'}`}>
                        {PARTNER_TYPE_LABEL[a.partnerType]}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{a.bizNo ? fmtBiz(a.bizNo) : '—'}</td>
                  <td>
                    {a.role !== 'partner' ? (
                      '—'
                    ) : a.partnerType === 'individual' ? (
                      <span className="meta">해당 없음</span>
                    ) : a.bizVerified ? (
                      <span className="pay-tag paid">통과</span>
                    ) : (
                      <span className="pay-tag waiting">미조회</span>
                    )}
                  </td>
                  <td>{a.verified ? '완료' : <span className="pay-tag waiting">미완료</span>}</td>
                  <td>{a.createdAt.slice(0, 10)}</td>
                  <td>
                    {a.role !== 'partner' ? (
                      '—'
                    ) : a.approval === 'approved' ? (
                      <span className="pay-tag paid">승인</span>
                    ) : a.approval === 'rejected' ? (
                      <span className="claim-tag dispute" title={a.rejectReason}>
                        거절
                      </span>
                    ) : (
                      <span className="pay-tag waiting">대기</span>
                    )}
                  </td>
                  <td>
                    {a.withdrawnAt ? (
                      <span className="svc-tag indiv" title={a.withdrawnAt}>
                        탈퇴 · {a.withdrawnAt.slice(0, 10)}
                      </span>
                    ) : a.suspended ? (
                      <span className="claim-tag dispute">정지</span>
                    ) : (
                      <span className="pay-tag paid">정상</span>
                    )}
                  </td>
                  <td>
                    {a.withdrawnAt && (
                      <button
                        className="btn-danger"
                        onClick={() => void purge(a.id)}
                        disabled={!can('destructive')}
                        title={
                          can('destructive')
                            ? '법정 보관 기간(거래 5년·분쟁 3년) 경과 후 파기'
                            : gradeHint('destructive')
                        }
                      >
                        파기
                      </button>
                    )}
                    {!a.withdrawnAt && a.role === 'partner' && a.approval !== 'approved' && (
                      <button onClick={() => void approve(a.id)} style={{ marginRight: 6 }}>
                        승인
                      </button>
                    )}
                    {!a.withdrawnAt && a.role === 'partner' && a.approval !== 'rejected' && (
                      <button
                        className="btn-secondary"
                        style={{ marginRight: 6 }}
                        onClick={() => {
                          setRejectFor(rejectFor === a.id ? '' : a.id)
                          setReason('')
                        }}
                      >
                        거절
                      </button>
                    )}
                    {!a.withdrawnAt &&
                      (a.suspended ? (
                        <button className="btn-secondary" onClick={() => void toggle(a.id, false)}>
                          해제
                        </button>
                      ) : (
                        <button className="btn-danger" onClick={() => void toggle(a.id, true)}>
                          정지
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rejectFor && (
          <div className="form" style={{ marginTop: 10 }}>
            <label className="form-wide">
              거절 사유 ({accounts.find((a) => a.id === rejectFor)?.name})
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="예: 사업자등록번호 조회 불일치"
                aria-label="거절 사유"
              />
            </label>
            <button className="btn-danger" onClick={() => void reject(rejectFor)}>
              거절 확정
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}

/**
 * 관리자 계정·등급 (28-89-A) — 소유자만 만지고, 다른 등급은 목록만 본다.
 *
 * 28-88까지 관리자는 `admin` 하나였다. 운영에 사람이 둘 이상 붙는 순간 "실수로 파기"와
 * "권한 없이 지급"이 같은 비밀번호 뒤에 있게 된다. 등급 표는 `adminGrade.ts`에 있다.
 */
function AdminAccountsCard() {
  const { auth, authActions, refresh } = usePlatform()
  const can = useAdminCan()
  const grade = useAdminGrade()
  const me = auth.sessionFor('admin')?.accountId
  const manage = can('manageAdmins')
  const admins = auth.listAdmins()
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [newGrade, setNewGrade] = useState<AdminGrade>('manager')
  const [password, setPassword] = useState('')
  const [resetFor, setResetFor] = useState('')
  const [resetPw, setResetPw] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr('')
    setMsg('')
    try {
      await fn()
      setMsg(ok)
      refresh()
    } catch (e) {
      if (isKnownError(e)) setErr(e.message)
      else throw e
    }
  }

  return (
    <Card title={`관리자 계정 (${admins.length}명)`} className="form">
      <div className="meta form-wide">
        소유자는 전부, 매니저는 승인·지급·설정, 열람은 보기만 합니다. 마지막 소유자는 내리거나 지울 수 없습니다.
        {!manage && (
          <>
            {' '}
            — <b>{gradeHint('manageAdmins')}</b> (내 등급: {grade ? ADMIN_GRADE_LABEL[grade] : '없음'})
          </>
        )}
      </div>
      <div className="form-wide" data-admin-list>
        {admins.map((a) => (
          <div key={a.id} className="layout-row" data-admin-row={a.id}>
            <span className={`grade-tag ${a.grade}`} data-admin-grade={a.grade}>
              {ADMIN_GRADE_LABEL[a.grade]}
            </span>
            <div>
              <div className="layout-name">
                {a.name}{' '}
                <span className="meta">
                  ({a.id}
                  {a.id === me ? ' · 나' : ''})
                </span>
              </div>
              {manage && a.id !== me && (
                <div className="row" style={{ justifyContent: 'flex-start', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <select
                    value={a.grade}
                    onChange={(e) =>
                      void run(
                        () => authActions.setAdminGrade(a.id, e.target.value as AdminGrade),
                        `${a.id}의 등급을 바꿨습니다`,
                      )
                    }
                    aria-label={`${a.id} 등급`}
                    data-admin-grade-select
                  >
                    {ADMIN_GRADES.map((g) => (
                      <option key={g} value={g}>
                        {ADMIN_GRADE_LABEL[g]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setResetFor(resetFor === a.id ? '' : a.id)
                      setResetPw('')
                    }}
                  >
                    비밀번호 초기화
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => void run(() => authActions.removeAdmin(a.id), `${a.id}를 제거했습니다`)}
                    data-admin-remove
                  >
                    제거
                  </button>
                </div>
              )}
              {resetFor === a.id && (
                <div className="row" style={{ justifyContent: 'flex-start', gap: 6, marginTop: 4 }}>
                  <input
                    type="password"
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                    placeholder="새 비밀번호 (8자 이상)"
                    aria-label={`${a.id} 새 비밀번호`}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void run(
                        () => authActions.resetAdminPassword(a.id, resetPw).then(() => setResetFor('')),
                        `${a.id}의 비밀번호를 초기화했습니다 — 그 계정의 세션은 끊깁니다`,
                      )
                    }
                  >
                    초기화
                  </button>
                </div>
              )}
            </div>
            <span className="meta">{a.createdBy === 'seed' ? '기본' : `by ${a.createdBy}`}</span>
          </div>
        ))}
      </div>
      {manage && (
        <>
          <label>
            아이디
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="영문 소문자·숫자 3~20자"
              aria-label="새 관리자 아이디"
              autoComplete="off"
            />
          </label>
          <label>
            이름
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="표시 이름"
              aria-label="새 관리자 이름"
            />
          </label>
          <label>
            등급
            <select
              value={newGrade}
              onChange={(e) => setNewGrade(e.target.value as AdminGrade)}
              aria-label="새 관리자 등급"
            >
              {ADMIN_GRADES.map((g) => (
                <option key={g} value={g}>
                  {ADMIN_GRADE_LABEL[g]}
                </option>
              ))}
            </select>
          </label>
          <label>
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8자 이상"
              aria-label="새 관리자 비밀번호"
              autoComplete="new-password"
            />
          </label>
          <button
            data-admin-add
            onClick={() =>
              void run(async () => {
                await authActions.addAdmin({ id, name, grade: newGrade, password })
                setId('')
                setName('')
                setPassword('')
              }, `관리자 ${id.trim().toLowerCase()}를 추가했습니다`)
            }
          >
            관리자 추가
          </button>
        </>
      )}
      {err && <div className="error form-wide">{err}</div>}
      {msg && (
        <div className="meta form-wide" data-admin-msg>
          {msg}
        </div>
      )}
    </Card>
  )
}
