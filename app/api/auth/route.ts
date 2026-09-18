/**
 * 우리 로그인 (29-3). 본체는 `api/auth.ts` 그대로다 — 이 파일은 Next.js 요청을 그 모양으로 옮기기만 한다.
 * v17의 `app/chatgpt-auth.ts`는 들이지 않았다(참고_v17_대조 §3-1).
 */
import { handleAuth } from '@/server/handlers/auth'
import { toApiRequest, toResponse } from '@/server/nextAdapter'
import { ensureSchemaFor } from '@/server/schemaBootstrap'
import { resolveDatabaseUrl } from '@/server/databaseUrl'

export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  await ensureSchemaFor(resolveDatabaseUrl(process.env))
  return toResponse(await handleAuth(await toApiRequest(req), process.env))
}
