import type { PullResponse, PushResponse, SyncEntity } from '@ozellar/shared';
import { api } from '../api/client';
import { getCachedUser } from '../auth/session';
import { db, getMeta, setMeta } from './db';
import { processPhotoQueue, prefetchInspectionPhotos, evictPhotoCache } from './photoQueue';
import { processApprovalQueue, hasPendingApproval } from './approvalQueue';
import { processUserEditQueue } from './userEditQueue';


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
  const user = getCachedUser();
  const cursorKey = user?.id ? `cursor_${user.id}` : 'cursor';
  let cursor = await getMeta<number>(cursorKey, 0);
  if (cursor > 100_000_000) {
    cursor = 0;
    await setMeta(cursorKey, 0);
  }

  // Auto-heal: If local DB has 0 inspections or 0 vessels but cursor is ahead, reset cursor to 0 to pull full list
  const localInspCount = await db.inspections.count();
  const localVesselCount = await db.vessels.count();
  if ((localInspCount === 0 || localVesselCount === 0) && cursor > 0) {
    console.log('[Sync] Local inspections/vessels empty with cursor > 0; resetting cursor to 0 for full initial sync');
    cursor = 0;
    await setMeta(cursorKey, 0);
  }

  for (;;) {
    const res = await api<PullResponse>(`/sync/pull?cursor=${cursor}&limit=500`);
    const pendingOutbox = await db.outbox.toArray();
    const pendingIds = new Set(pendingOutbox.map((m) => m.entityId));
    for (const [entity, rows] of Object.entries(res.changes) as [SyncEntity, Array<Record<string, unknown> & { id: string }>][]) {
      const table = db.table_(entity);
      if (!table) continue;
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
        const rowsToPut = rows.filter((r) => !pendingIds.has(r.id));
        await table.bulkPut(rowsToPut);

        // Evict photo caches for any server-deleted photos to prevent ghost thumbnails
        if (entity === 'photos') {
          const deletedPhotoIds = rowsToPut
            .filter((r) => !!r.deletedAt)
            .map((r) => r.id);
          for (const photoId of deletedPhotoIds) {
            void evictPhotoCache(photoId);
          }
        }
      }
    }

    if (res.changes.inspections && res.changes.inspections.length > 0) {
      for (const i of res.changes.inspections) {
        if (i.deletedAt) {
          try {
            await db.notifications.filter((n) => n.inspectionId === i.id).delete();
          } catch {
            // safe fallback
          }
        }
      }
    }

    if (res.changes.photos && res.changes.photos.length > 0) {
      const inspIds = new Set<string>();
      for (const p of res.changes.photos) {
        if (p.inspectionId && typeof p.inspectionId === 'string' && !p.deletedAt) inspIds.add(p.inspectionId);
      }
      for (const inspId of inspIds) {
        void prefetchInspectionPhotos(inspId);
      }
    }

    cursor = res.nextCursor;
    await setMeta(cursorKey, cursor);

    if (!res.hasMore) {
      // Reconcile server-deleted or unassigned inspections once full pull finishes
      if (Array.isArray(res.activeInspectionIds)) {
        const activeSet = new Set(res.activeInspectionIds);
        const allLocal = await db.inspections.toArray();
        const nowIso = new Date().toISOString();
        for (const loc of allLocal) {
          if (!activeSet.has(loc.id) && !pendingIds.has(loc.id)) {
            if (!loc.deletedAt) {
              await db.inspections.update(loc.id, { deletedAt: nowIso });
              try {
                await db.notifications.filter((n) => n.inspectionId === loc.id).delete();
              } catch {
                // safe fallback
              }
            }
          } else if (activeSet.has(loc.id) && loc.deletedAt && !pendingIds.has(loc.id)) {
            // Self-healing: if inspection was mistakenly marked deleted locally, resurrect it! But never
            // while its own delete mutation is still sitting in the outbox (not yet confirmed by the
            // server) — otherwise a delete that just hasn't round-tripped yet gets silently undone.
            await db.inspections.update(loc.id, { deletedAt: null });
          }
        }

        // Self-healing: ensure any vessels attached to active inspections are not marked deleted locally
        // (skipping ones with a pending delete mutation of their own, for the same race-condition reason).
        const activeInsps = await db.inspections.filter((i) => !i.deletedAt).toArray();
        const activeVesselIds = new Set(activeInsps.map((i) => i.vesselId).filter(Boolean) as string[]);
        for (const vId of activeVesselIds) {
          if (pendingIds.has(vId)) continue;
          const v = await db.vessels.get(vId);
          if (v && v.deletedAt) {
            await db.vessels.update(vId, { deletedAt: null });
          }
        }

        // Clean up any unregistered vessels whose inspections are no longer active
        const unregisteredVessels = await db.vessels.filter((v) => (v as any).registrationStatus === 'unregistered' && !v.deletedAt).toArray();
        for (const uv of unregisteredVessels) {
          if (!activeVesselIds.has(uv.id) && !pendingIds.has(uv.id)) {
            await db.vessels.update(uv.id, { deletedAt: nowIso });
          }
        }
      }
      return;
    }
  }
}

let running: Promise<void> | null = null;
let rerunRequested = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function syncNow(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (running) {
    rerunRequested = true;
    return running;
  }
  running = (async () => {
    if (!navigator.onLine) {
      emit({ state: 'offline', pending: await db.outbox.count() });
      return;
    }
    emit({ state: 'syncing', pending: await db.outbox.count() });
    try {
      // Kick off photo uploads in background immediately without waiting for pull()
      void processPhotoQueue();
      do {
        rerunRequested = false;
        await push();
        await processApprovalQueue();
        await processUserEditQueue();
        await pull();
      } while (rerunRequested && navigator.onLine);
      emit({ state: 'idle', lastSyncAt: new Date().toISOString(), pending: await db.outbox.count(), message: undefined });
    } catch (e) {
      const pending = await db.outbox.count();
      if (!navigator.onLine) {
        emit({ state: 'offline', pending });
      } else {
        emit({ state: 'error', message: (e as Error).message, pending });
      }
    } finally {
      // Ensure photo uploads run even if text sync threw a 504 error
      if (navigator.onLine) void processPhotoQueue();
    }
  })().finally(() => { running = null; });
  return running;
}

/** Called after any localWrite / localDelete / createInspection to update pending count and debounce sync. */
export function scheduleSync(delayMs = 500): void {
  void db.outbox.count().then((pending) => {
    if (!navigator.onLine) {
      emit({ state: 'offline', pending });
      return;
    }
    emit({ pending });
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void syncNow();
    }, delayMs);
  });
}

/** Start on app launch: sync now, every 60 s while open, and whenever connection state changes. */
export function startSyncLoop(): () => void {
  void syncNow();
  const t = setInterval(() => void syncNow(), 20_000);
  // Independent photo retry every 2 minutes — covers cases where syncNow runs but photo uploads fail or skip
  const photoTimer = setInterval(() => {
    if (navigator.onLine) void processPhotoQueue();
  }, 2 * 60_000);
  const onOnline = () => { void syncNow(); void processPhotoQueue(); };
  const onOffline = () => {
    void db.outbox.count().then((pending) => emit({ state: 'offline', pending }));
  };
  const onVis = () => {
    if (document.visibilityState === 'visible') {
      void syncNow();
      if (navigator.onLine) void processPhotoQueue();
    }
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVis);
  return () => {
    clearInterval(t);
    clearInterval(photoTimer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVis);
  };
}

