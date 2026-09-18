import { z } from 'zod';
import type { Database, User } from './model';
import { fail } from './errors';
import { defaultPresentation, presentationSchema, type SavedPresentation } from './presentation';

export function presentationService(db: Database) {
  const stmt = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  async function read(): Promise<SavedPresentation> {
    const row = await stmt("SELECT payload,revision,updated_at FROM site_presentation WHERE id='main'").first<{ payload: string; revision: number; updated_at: string }>();
    return row ? { data: presentationSchema.parse(JSON.parse(row.payload)), revision: row.revision, updatedAt: row.updated_at } : { data: defaultPresentation, revision: 0, updatedAt: null };
  }
  return { read, async save(user: User, raw: unknown): Promise<SavedPresentation> {
    if (user.suspended || user.role !== 'ADMIN') fail(403, '관리자만 화면을 수정할 수 있습니다.');
    const input = z.object({ data: presentationSchema, revision: z.number().int().nonnegative(), reason: z.string().trim().min(5).max(500) }).strict().parse(raw);
    const before = await read();
    if (before.revision !== input.revision) fail(409, '다른 관리자가 먼저 저장했습니다. 입력 내용을 확인하고 최신 설정을 불러와 주세요.');
    const saved = { data: input.data, revision: input.revision + 1, updatedAt: new Date().toISOString() };
    await db.batch([
      stmt("SELECT CASE WHEN COALESCE((SELECT revision FROM site_presentation WHERE id='main'),0)=? THEN 1 ELSE abs(-9223372036854775807 - (SELECT COUNT(*) FROM (SELECT 1) AS one)) END", input.revision),
      stmt("INSERT INTO site_presentation (id,payload,revision,updated_at) VALUES ('main',?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at", JSON.stringify(input.data), saved.revision, saved.updatedAt),
      stmt('INSERT INTO audit_logs (id,actor_id,role,order_id,action,before_state,after_state,reason,created_at) VALUES (?,?,?,NULL,?,?,?,?,?)', crypto.randomUUID(), user.id, user.role, 'PRESENTATION_SAVED', JSON.stringify(before), JSON.stringify(saved), input.reason, saved.updatedAt),
    ]);
    return saved;
  } };
}
