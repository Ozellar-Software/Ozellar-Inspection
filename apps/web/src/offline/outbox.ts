import type { SyncEntity } from '@ozellar/shared';
import { db } from './db';

/**
 * Every local change goes through here: update the local row AND queue a mutation, atomically.
 * Send only the fields that changed — the server applies partial updates.
 */
export async function localWrite(entity: SyncEntity, id: string, changes: Record<string, unknown>): Promise<void> {
  const table = db.table_(entity);
  await db.transaction('rw', table, db.outbox, async () => {
    const current = (await table.get(id)) ?? { id };
    await table.put({ ...current, ...changes, id, updatedAt: new Date().toISOString() });
    await db.outbox.add({
      id: crypto.randomUUID(), entity, entityId: id, op: 'upsert', data: changes,
      baseVersion: (current as { rowVersion?: number }).rowVersion ?? null,
      createdAt: new Date().toISOString(), attempts: 0,
    });
  });
}

export async function localDelete(entity: SyncEntity, id: string): Promise<void> {
  const table = db.table_(entity);
  await db.transaction('rw', table, db.outbox, async () => {
    const current = await table.get(id);
    if (current) await table.put({ ...current, deletedAt: new Date().toISOString() });
    await db.outbox.add({
      id: crypto.randomUUID(), entity, entityId: id, op: 'delete',
      createdAt: new Date().toISOString(), attempts: 0,
    });
  });
}

export const pendingCount = () => db.outbox.count();
