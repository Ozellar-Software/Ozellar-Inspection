import { api } from '../api/client';
import { db, getMeta, setMeta } from './db';

export interface PendingUserEdit {
  id: string;
  userId: string;
  isNew: boolean;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
}

const QUEUE_META_KEY = 'oz_pending_user_edits';

export async function getPendingUserEdits(): Promise<PendingUserEdit[]> {
  return await getMeta<PendingUserEdit[]>(QUEUE_META_KEY, []);
}

export async function queueUserEdit(userId: string, isNew: boolean, payload: Record<string, unknown>): Promise<void> {
  const queue = await getPendingUserEdits();
  queue.push({
    id: crypto.randomUUID(),
    userId,
    isNew,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  await setMeta(QUEUE_META_KEY, queue);
}

let isProcessing = false;

/** Sends all queued offline user create/edit requests (incl. vessel assignment changes) to the API when online. */
export async function processUserEditQueue(): Promise<void> {
  if (isProcessing || !navigator.onLine) return;
  isProcessing = true;

  try {
    const queue = await getPendingUserEdits();
    if (!queue.length) return;

    const remaining: PendingUserEdit[] = [];

    for (const item of queue) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const saved: any = item.isNew
          ? await api('/users', { method: 'POST', body: item.payload })
          : await api(`/users/${item.userId}`, { method: 'PUT', body: item.payload });
        if (saved?.id) {
          await db.users.put({
            id: saved.id,
            email: saved.email,
            name: saved.name,
            designation: saved.designation,
            role: saved.role,
            vesselIds: saved.vesselIds ?? [],
            isActive: saved.isActive,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
        }
      } catch (err: unknown) {
        console.warn(`[UserEditQueue] Failed processing edit for ${item.userId}:`, err);
        const msg = err instanceof Error ? err.message : String(err);
        const isTerminal = msg.includes('already') || msg.includes('exists') || msg.includes('VALIDATION');
        if (!isTerminal && item.attempts < 6) {
          remaining.push({ ...item, attempts: item.attempts + 1 });
        }
      }
    }

    await setMeta(QUEUE_META_KEY, remaining);
  } finally {
    isProcessing = false;
  }
}
