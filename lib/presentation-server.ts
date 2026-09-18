// 29-3: Cloudflare 바인딩(env.DB) → 우리 풀. 나머지는 v17 원본 그대로다 — 저장소가 없으면 null을 주고,
// 화면이 다시 시도 상태를 보여 준다는 계약도 그대로다.
import { getPool } from '../server/db'
import { ensureSchemaFor } from '../server/schemaBootstrap'
import { resolveDatabaseUrl } from '../server/databaseUrl'
import { pgDatabase } from '../server/pgPort'
import type { Database } from './model'
import { presentationService } from './presentation-service'

export async function loadPresentation() {
  try {
    await ensureSchemaFor(resolveDatabaseUrl(process.env))
    const db = pgDatabase(getPool(resolveDatabaseUrl(process.env) ?? '')) as Database
    return await presentationService(db).read()
  } catch {
    return null
  } // The client shows a retry state if storage is unavailable.
}
