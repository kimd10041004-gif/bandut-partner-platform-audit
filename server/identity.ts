/**
 * 우리 세션 → v17 `User` 어댑터 (29-2).
 *
 * v17은 신원을 **딱 한 곳**에서 만든다(`app/api/[...path]/route.ts`): ChatGPT 헤더에서 이메일·이름·아이디를
 * 읽어 `marketplace(db).identity(id, email, name)`에 넘기고, 그 아래 모든 서비스가 그 `User`를 첫 인자로 받는다.
 * 우리는 그 한 곳만 우리 세션으로 바꾼다 — v17의 `app/chatgpt-auth.ts`는 반입하지 않는다(참고_v17_대조 §3-1).
 *
 * 왜 이 파일이 따로 있나: 신원을 만드는 자리가 **하나여야** 등급·정지·역할 규칙이 갈라지지 않는다. v17이 그렇게
 * 만들어져 있고, 우리 쪽 규칙(OTP·잠금·관리자 등급)은 이미 `api/auth.ts` 하나에 있다. 이 파일은 그
 * 둘 사이의 유일한 다리다.
 */
import type { AuthSession } from './domain/auth'
import type { Role, User } from '../lib/model'

/** 우리 역할 → v17 역할. 1:1이다 */
export function roleOf(session: AuthSession): Role {
  return session.role === 'admin' ? 'ADMIN' : session.role === 'partner' ? 'PARTNER' : 'CUSTOMER'
}

/**
 * v17 `users` 행이 없으면 만들고, 있으면 읽어 온다.
 *
 * v17의 `identity()`는 **가입만으로는 절대 ADMIN을 주지 않는다**("Public sign-in never grants administration").
 * 그 규칙은 로그인이 ChatGPT 헤더 하나였기 때문이다 — 헤더는 관리자인지 아닌지 말해 주지 못한다.
 *
 * 우리는 다르다. 관리자 로그인은 `ADMIN_PASSWORD`와 등급(owner·manager·viewer)을 거쳐야만 세션이 나온다
 * (28-89-A). 즉 **우리 세션이 말하는 admin은 이미 인증된 admin**이다. 그래서 여기서는 세션의 역할을 그대로
 * 반영한다 — 다만 그 판단은 오직 세션에서만 오고, 요청 본문이나 헤더에서는 절대 오지 않는다.
 *
 * PARTNER 승격은 여전히 v17이 한다(`registerPartner`). 여기서 올리지 않는다 — 파트너는 신청·승인을 거쳐야 한다.
 */
export async function identityOf(
  svc: { identity(id: string, email: string, name: string): Promise<User> },
  db: { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } },
  session: AuthSession,
): Promise<User> {
  const email = emailOf(session)
  const user = await svc.identity(session.accountId, email, session.name)
  if (session.role === 'admin' && user.role !== 'ADMIN') {
    // 우리 관리자 로그인을 통과한 세션이다 — v17 표의 역할을 맞춘다.
    await db.prepare('UPDATE users SET role=? WHERE id=?').bind('ADMIN', session.accountId).run()
    return { ...user, role: 'ADMIN' }
  }
  return user
}

/**
 * v17 `users.email`은 NOT NULL이고 화면 표시에도 쓰인다. 우리 계정은 이메일이 없을 수 있어(전화·아이디 가입)
 * 계정 ID로 안정적인 값을 만든다 — 사람에게 보내는 주소가 아니라 **표 안의 식별자**다.
 */
export function emailOf(session: AuthSession): string {
  return session.accountId.includes('@') ? session.accountId : `${session.accountId}@accounts.local`
}
