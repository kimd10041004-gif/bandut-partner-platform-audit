import { useState } from 'react'
import type { NotificationRole } from '../../domain/types'
import { usePlatform } from '../../app/PlatformContext'
import { Icon, ICON } from '../../ui/icons'

/** 헤더 알림 벨 (28-35-02): 미읽음 뱃지 + 패널(열면 읽음 처리). 로그인된 역할에만 표시 */
export default function NotificationBell({ role }: { role: NotificationRole }) {
  const { platform, auth, refresh } = usePlatform()
  const [open, setOpen] = useState(false)
  const session = auth.sessionFor(role)
  if (!session) return null
  // 고객은 계정 스코프(내 요청 알림만), 파트너·관리자는 역할 스코프
  // 28-41-01: 고객·파트너 모두 계정 범위, 관리자는 전체
  const scope = role === 'admin' ? undefined : session.accountId
  const unread = platform.unreadNotificationCount(role, scope)
  const items = platform.notificationsFor(role, scope).slice(0, 20)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      platform.markAllNotificationsRead(role, scope)
      refresh()
    }
  }

  return (
    <span className="bell-wrap">
      <button className="bell" onClick={toggle} aria-label={`알림 ${unread}건`} aria-expanded={open}>
        <Icon d={ICON.bell} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="알림">
          <div className="notif-head">
            <strong>알림</strong>
            <button className="quiet-btn" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
          {items.length === 0 && (
            <div className="meta" style={{ padding: '8px 0' }}>
              아직 알림이 없습니다.
            </div>
          )}
          {items.map((n) => (
            <div key={n.id} className="notif-row">
              <div className="notif-text">{n.text}</div>
              <div className="meta">
                {n.createdAt.slice(0, 10)} {n.createdAt.slice(11, 16)}
              </div>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
