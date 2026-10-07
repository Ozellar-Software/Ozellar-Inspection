import type { PullResponse, PushResponse, SyncEntity } from '@ozellar/shared';
import { api } from '../api/client';
import { db, getMeta, setMeta } from './db';
import { processPhotoQueue, prefetchInspectionPhotos } from './photoQueue';
import { processApprovalQueue, hasPendingApproval } from './approvalQueue';

type Listener = (s: SyncStatus) => void;
export interface SyncStatus { state: 'idle' | 'syncing' | 'offline' | 'error'; lastSyncAt: string | null; pending: number; message?: string }

let status: SyncStatus = { state: 'idle', lastSyncAt: null, pending: 0 };
const listeners = new Set<Listener>();
export const onSyncStatus = (l: Listener) => { listeners.add(l); l(status); return () => listeners.delete(l); };
const emit = (s: Partial<SyncStatus>) => { status = { ...status, ...s }; listeners.forEach((l) => l(status)); };

async function deviceId(): Promise<string> {
  let id = await getMeta<string | null>('deviceId', null);
  if (!id) { id = crypto.randomUUID(); await setMeta('deviceId', id); }
  return id;
}

/** Send queued local changes (oldest first, 100 per request). Rejected ones are rolled back to the server copy. */
async function push(): Promise<void> {
  const dev = await deviceId();
  for (;;) {
    const batch = await db.outbox.orderBy('createdAt').limit(100).toArray();
    if (!batch.length) return;
    const res = await api<PushResponse>('/sync/push', { body: { deviceId: dev, mutations: batch } });
    for (const r of res.results) {
      const m = batch.find((x) => x.id === r.id)!;
      if (r.ok) {
        await db.outbox.delete(r.id);
        const table = db.table_(m.entity);
        const row = await table.get(m.entityId);
        if (row) await table.put({ ...row, rowVersion: r.rowVersion });
      } else {
        await db.outbox.delete(r.id);
        if (r.serverRow) {
          const table = db.table_(m.entity);
          const localRow = (await table.get(m.entityId)) ?? { id: m.entityId };
          await table.put({ ...localRow, ...(r.serverRow as Record<string, unknown>), id: m.entityId });
        }
        emit({ message: r.message });
      }
    }
  }
}

/** Pull everything changed since the last cursor; skip rows that still have local unsent changes. */
async function pull(): Promise<void> {
  let cursor = await getMeta<number>('cursor', 0);
  if (cursor > 100_000_000) {
    cursor = 0;
    await setMeta('cursor', 0);
  }

  // Auto-heal: If local DB has 0 inspections but cursor is ahead, reset cursor to 0 to pull full list
  const localCount = await db.inspections.count();
  if (localCount === 0 && cursor > 0) {
    console.log('[Sync] Local inspections empty with cursor > 0; resetting cursor to 0 for full initial sync');
    cursor = 0;
    await setMeta('cursor', 0);
  }

  for (;;) {
    const res = await api<PullResponse>(`/sync/pull?cursor=${cursor}&limit=500`);
    const pendingOutbox = await db.outbox.toArray();
    const pendingIds = new Set(pendingOutbox.map((m) => m.entityId));
    for (const [entity, rows] of Object.entries(res.changes) as [SyncEntity, Array<Record<string, unknown> & { id: string }>][]) {
      const table = db.table_(entity);
      if (entity === 'inspections') {
        const safeRows = [];
        for (const r of rows) {
          if (pendingIds.has(r.id)) continue;
          if (await hasPendingApproval(r.id)) {
            const local = await db.inspections.get(r.id);
            if (local?.status) {
              safeRows.push({ ...r, status: local.status });
              continue;
            }
          }
          safeRows.push(r);
        }
        await table.bulkPut(safeRows);
      } else {
        await table.bulkPut(rows.filter((r) => !pendingIds.has(r.id)));
      }
    }

    if (res.changes.photos && res.changes.photos.length > 0) {
      const inspIds = new Set<string>();
      for (const p of res.changes.photos) {
        if (p.inspectionId && typeof p.inspectionId === 'string') inspIds.add(p.inspectionId);
      }
      for (const inspId of inspIds) {
        void prefetchInspectionPhotos(inspId);
      }
    }

    cursor = res.nextCursor;
    await setMeta('cursor', cursor);

    // Reconcile and purge local inspections deleted from server only on the final batch
    if (!res.hasMore) {
      if (res.activeInspectionIds && res.activeInspectionIds.length > 0) {
        // Protect any inspections that have pending local mutations in outbox
        const protectedInspectionIds = new Set<string>();
        for (const m of pendingOutbox) {
          if (m.entity === 'inspections') protectedInspectionIds.add(m.entityId);
          if (typeof m.data?.inspectionId === 'string') protectedInspectionIds.add(m.data.inspectionId);
        }

        const serverSet = new Set(res.activeInspectionIds);
        const localInspections = await db.inspections.toArray();
        const toDelete = localInspections
          .filter((i) => !serverSet.has(i.id) && !protectedInspectionIds.has(i.id))
          .map((i) => i.id);

        if (toDelete.length) {
          console.warn('[Sync] Purging', toDelete.length, 'inspection(s) deleted on server:', toDelete);
          await db.inspections.bulkDelete(toDelete);
          for (const inspId of toDelete) {
            const secs = await db.inspectionSections.where('inspectionId').equals(inspId).toArray();
            const secIds = secs.map((s) => s.id);
            await db.inspectionSections.bulkDelete(secIds);
            for (const sId of secIds) {
              await db.inspectionQuestions.where('inspectionSectionId').equals(sId).delete();
            }
            await db.responses.where('inspectionId').equals(inspId).delete();
            await db.findings.where('inspectionId').equals(inspId).delete();
            await db.photos.where('inspectionId').equals(inspId).delete();
          }
        }
      }
      return;
    }
  }
}

let running: Promise<void> | null = null;
export function syncNow(): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!navigator.onLine) { emit({ state: 'offline', pending: await db.outbox.count() }); return; }
    emit({ state: 'syncing' });
    try {
      await push();
      await pull();
      emit({ state: 'idle', lastSyncAt: new Date().toISOString(), pending: await db.outbox.count() });
      // Process photo uploads and queued offline approvals in background
      void processPhotoQueue();
      void processApprovalQueue();
    } catch (e) {
      emit({ state: 'error', message: (e as Error).message, pending: await db.outbox.count() });
    }
  })().finally(() => { running = null; });
  return running;
}

/** Start on app launch: sync now, every 60 s while open, and whenever the connection returns. */
export function startSyncLoop(): () => void {
  void syncNow();
  const t = setInterval(() => void syncNow(), 60_000);
  const on = () => void syncNow();
  window.addEventListener('online', on);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') on(); });
  return () => { clearInterval(t); window.removeEventListener('online', on); };
}
