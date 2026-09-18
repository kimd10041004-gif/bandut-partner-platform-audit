import type { StorageLike } from '../domain/platform'
import type { AuthRole } from '../../server/domain/auth'

export const SESSION_STORAGE_KEY = 'banded-session-v1'

/**
 * 세션 토큰 보관 (28-70). 역할별로 하나 — 브라우저의 역할별 세션 모델(고객·파트너·관리자 동시 로그인)과 같다.
 * 토큰은 `HttpAuthClient`(op 호출)와 `HttpSnapshotPort`(스냅샷 복제)가 매 요청 때 읽는다.
 * 저장소가 없으면(사생활 보호 모드) 메모리에만 — 새로고침하면 로그아웃이다.
 *
 * **매 접근 때 저장소를 다시 읽는다 (28-71).** 토큰은 브라우저(탭 전체)의 것인데 인스턴스는 탭마다 하나다. 탭1이 로그아웃해
 * 토큰을 지웠는데 탭2가 메모리의 낡은 토큰으로 `me`를 부르면 세션이 되살아나 탭1까지 다시 로그인된다(서버 모드 e2e에서
 * 실제로 났다). 도메인의 `syncFromStorage`와 같은 이유로, 읽기 전에 저장소를 본다.
 */
export class TokenStore {
  private tokens: Partial<Record<AuthRole, string>> = {}

  constructor(private readonly storage: StorageLike | undefined) {
    this.load()
  }

  private load(): void {
    if (!this.storage) return
    try {
      const raw = this.storage.getItem(SESSION_STORAGE_KEY)
      if (raw === null) {
        this.tokens = {}
        return
      }
      const o = JSON.parse(raw) as Record<string, unknown>
      const next: Partial<Record<AuthRole, string>> = {}
      for (const role of ['customer', 'partner', 'admin'] as const) {
        const t = o[role]
        if (typeof t === 'string' && t !== '') next[role] = t
      }
      this.tokens = next
    } catch {
      this.tokens = {}
    }
  }

  private persist(): void {
    if (!this.storage) return
    try {
      this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.tokens))
    } catch {
      // 저장 불가 — 메모리에는 있다
    }
  }

  for(role: AuthRole): string | null {
    this.load()
    return this.tokens[role] ?? null
  }

  /** 아무 역할의 토큰 — 스냅샷 복제용(스냅샷은 마켓플레이스 전체라 역할과 무관하다) */
  any(): string | null {
    this.load()
    return this.tokens.admin ?? this.tokens.partner ?? this.tokens.customer ?? null
  }

  roles(): AuthRole[] {
    this.load()
    return (['customer', 'partner', 'admin'] as const).filter((r) => this.tokens[r] !== undefined)
  }

  set(role: AuthRole, token: string): void {
    this.load()
    this.tokens[role] = token
    this.persist()
  }

  clear(role: AuthRole): void {
    this.load()
    delete this.tokens[role]
    this.persist()
  }
}
