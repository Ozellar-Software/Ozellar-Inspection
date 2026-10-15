import type { SyncEntity } from '@ozellar/shared';
import { db } from './db';
import { evictPhotoCache } from './photoQueue';
import { scheduleSync } from './sync';

let lastOutboxStampMs = 0;

/** Guarantees strictly increasing ISO timestamps so IndexedDB orderBy('createdAt') always preserves causal dependency order. */
export function nextOutboxTimestamp(minBaseMs?: number): string {
  const now = Math.max(Date.now(), minBaseMs ?? 0);
  lastOutboxStampMs = now > lastOutboxStampMs ? now : lastOutboxStampMs + 1;
  return new Date(lastOutboxStampMs).toISOString();
}

/**
 * Every local change goes through here: update the local row AND queue a mutation, atomically.
 * Send only the fields that changed — the server applies partial updates.
 */
export async function localWrite(entity: SyncEntity, id: string, changes: Record<string, unknown>): Promise<void> {
  const table = db.table_(entity);
  await db.transaction('rw', table, db.outbox, async () => {
    const current = (await table.get(id)) ?? { id };
    const stamp = nextOutboxTimestamp();
    await table.put({ ...current, ...changes, id, updatedAt: stamp });
    await db.outbox.add({
      id: crypto.randomUUID(), entity, entityId: id, op: 'upsert', data: changes,
      baseVersion: (current as { rowVersion?: number }).rowVersion ?? null,
      createdAt: stamp, attempts: 0,
    });
  });
  scheduleSync();
}

export async function localDelete(entity: SyncEntity, id: string): Promise<void> {
  const table = db.table_(entity);
  let deletedRow: Record<string, unknown> | undefined;
  await db.transaction('rw', table, db.outbox, async () => {
    const current = await table.get(id);
    deletedRow = current as Record<string, unknown> | undefined;
    const stamp = nextOutboxTimestamp();
    if (current) await table.put({ ...current, deletedAt: stamp });
    await db.outbox.add({
      id: crypto.randomUUID(), entity, entityId: id, op: 'delete',
      baseVersion: (current as { rowVersion?: number } | undefined)?.rowVersion ?? null,
      createdAt: stamp, attempts: 0,
    });
  });

  // Immediately evict photo blobs/caches so deleted photos don't ghost-render or keep uploading
  if (entity === 'photos') {
    void evictPhotoCache(id);
  } else if (entity === 'vessels') {
    // A deleted vessel takes its inspection(s) — and their sections/findings/photos — with it, mirroring
    // the server-side cascade, so a deleted Take Over / Pre Purchase report never lingers in the UI.
    const deletedAt = new Date().toISOString();
    const vesselInspections = await db.inspections.where('vesselId').equals(id).toArray();
    for (const insp of vesselInspections) {
      if (insp.deletedAt) continue;
      await db.inspections.update(insp.id, { deletedAt });
      const sections = await db.inspectionSections.where('inspectionId').equals(insp.id).toArray();
      for (const s of sections) {
        const findings = await db.findings.where('inspectionSectionId').equals(s.id).toArray();
        for (const f of findings) if (!(f as any).deletedAt) await db.findings.update(f.id, { deletedAt } as any);
      }
      const inspPhotos = await db.photos.where('inspectionId').equals(insp.id).toArray();
      for (const p of inspPhotos) {
        if (!p.deletedAt) await db.photos.update(p.id, { deletedAt });
        void evictPhotoCache(p.id);
      }
      try {
        await db.notifications.filter((n) => n.inspectionId === insp.id).delete();
      } catch {
        // safe fallback
      }
    }
    const vesselPhotos = await db.photos.where('vesselId').equals(id).toArray();
    for (const p of vesselPhotos) {
      if (!p.inspectionId && !p.deletedAt) await db.photos.update(p.id, { deletedAt });
    }
  } else if (entity === 'inspections') {
    const inspPhotos = await db.photos.where('inspectionId').equals(id).toArray();
    const deletedAt = new Date().toISOString();
    for (const p of inspPhotos) {
      if (!p.deletedAt) await db.photos.update(p.id, { deletedAt });
      void evictPhotoCache(p.id);
    }
    try {
      await db.notifications.filter((n) => n.inspectionId === id).delete();
    } catch {
      // safe fallback
    }
    // Reverse cascade: a Pre Purchase / Take Over vessel only exists for its one report — deleting the
    // report directly takes the now-pointless unregistered vessel with it too.
    const vesselId = (deletedRow as { vesselId?: string | null; reportCategory?: string } | undefined)?.vesselId;
    const reportCategory = (deletedRow as { reportCategory?: string } | undefined)?.reportCategory;
    if (vesselId && reportCategory && reportCategory !== 'inspection') {
      const v = await db.vessels.get(vesselId);
      if (v && !v.deletedAt && (v as any).registrationStatus === 'unregistered') {
        await db.vessels.update(vesselId, { deletedAt });
      }
    }
  } else if (entity === 'findings') {
    const findingPhotos = await db.photos.where('findingId').equals(id).toArray();
    for (const p of findingPhotos) {
      if (!p.deletedAt) {
        await localDelete('photos', p.id);
      } else {
        void evictPhotoCache(p.id);
      }
    }
  } else if (entity === 'inspectionSections') {
    // Backend cascades photo deletion when a section is removed — mirror that locally
    const sectionPhotos = await db.photos.where('inspectionSectionId').equals(id).toArray();
    const deletedAt = new Date().toISOString();
    for (const p of sectionPhotos) {
      if (!p.deletedAt) await db.photos.update(p.id, { deletedAt });
      void evictPhotoCache(p.id);
    }
  }

  scheduleSync();
}

export const pendingCount = () => db.outbox.count();

