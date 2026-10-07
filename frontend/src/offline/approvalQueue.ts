import { api } from '../api/client';
import { db, getMeta, setMeta } from './db';

export interface PendingApprovalAction {
  id: string;
  inspectionId: string;
  path: 'submit' | 'approve' | 'reject' | 'reopen';
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
}

const QUEUE_META_KEY = 'oz_pending_approvals';

export async function getPendingApprovalActions(): Promise<PendingApprovalAction[]> {
  return await getMeta<PendingApprovalAction[]>(QUEUE_META_KEY, []);
}

export async function hasPendingApproval(inspectionId: string): Promise<boolean> {
  const queue = await getPendingApprovalActions();
  return queue.some((a) => a.inspectionId === inspectionId);
}

export async function queueApprovalAction(
  inspectionId: string,
  path: 'submit' | 'approve' | 'reject' | 'reopen',
  body: Record<string, unknown>
): Promise<void> {
  const queue = await getPendingApprovalActions();
  queue.push({
    id: crypto.randomUUID(),
    inspectionId,
    path,
    body,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  await setMeta(QUEUE_META_KEY, queue);
}

let isProcessing = false;

/** Sends all queued offline approval transitions (submit, approve, reject) to the API when online. */
export async function processApprovalQueue(): Promise<void> {
  if (isProcessing || !navigator.onLine) return;
  isProcessing = true;

  try {
    const queue = await getPendingApprovalActions();
    if (!queue.length) return;

    const remaining: PendingApprovalAction[] = [];

    for (const item of queue) {
      try {
        const res = await api<{ status: string }>(`/inspections/${item.inspectionId}/${item.path}`, {
          method: 'POST',
          body: item.body,
        });
        if (res?.status) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.inspections.update(item.inspectionId, { status: res.status as any });
        }
      } catch (err: unknown) {
        console.warn(`[ApprovalQueue] Failed processing ${item.path} for ${item.inspectionId}:`, err);
        const msg = err instanceof Error ? err.message : String(err);
        const isTerminal = msg.includes('already') || msg.includes('INVALID_STATE');
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
