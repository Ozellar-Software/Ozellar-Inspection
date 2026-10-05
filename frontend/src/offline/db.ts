import Dexie, { type Table } from 'dexie';
import type {
  Approval, Finding, Inspection, InspectionQuestion, InspectionSection, Mutation, Photo, Response, SyncEntity, User, Vessel,
} from '@ozellar/shared';

type Synced<T> = T & { rowVersion?: number; deletedAt?: string | null };

export interface PhotoQueueItem {
  photoId: string;
  inspectionId: string | null;
  vesselId: string | null;
  blob: Blob;                      // compressed JPEG kept locally until uploaded
  status: 'pending' | 'uploading' | 'uploaded' | 'committed';
  attempts: number;
  lastError?: string;
}

/**
 * Local database — the UI reads ONLY from here, so screens work the same online and offline.
 * Table names match SyncEntity so pulled rows can be applied generically.
 */
export class VirDB extends Dexie {
  vessels!: Table<Synced<Vessel>, string>;
  inspections!: Table<Synced<Inspection>, string>;
  inspectionSections!: Table<Synced<InspectionSection>, string>;
  inspectionQuestions!: Table<Synced<InspectionQuestion>, string>;
  responses!: Table<Synced<Response>, string>;
  findings!: Table<Synced<Finding>, string>;
  photos!: Table<Synced<Photo>, string>;
  approvals!: Table<Synced<Approval> & { id: string }, string>;
  templateSections!: Table<Record<string, unknown> & { id: string }, string>;
  templateQuestions!: Table<Record<string, unknown> & { id: string }, string>;
  users!: Table<Synced<User>, string>;
  outbox!: Table<Mutation & { attempts: number }, string>;
  photoQueue!: Table<PhotoQueueItem, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('ozellar-vir');
    this.version(1).stores({
      vessels: 'id, name',
      inspections: 'id, vesselId, status, updatedAt',
      inspectionSections: 'id, inspectionId',
      inspectionQuestions: 'id, inspectionSectionId',
      responses: 'id, inspectionId, inspectionQuestionId',
      findings: 'id, inspectionId, inspectionSectionId',
      photos: 'id, inspectionId, inspectionSectionId, responseId, findingId, vesselId',
      approvals: 'id, stage',
      templateSections: 'id, sr',
      templateQuestions: 'id, sectionId',
      users: 'id, role',
      outbox: 'id, createdAt',
      photoQueue: 'photoId, status',
      meta: 'key',
    });
  }

  table_(entity: SyncEntity): Table<Record<string, unknown> & { id: string }, string> {
    return (this as unknown as Record<string, Table<Record<string, unknown> & { id: string }, string>>)[entity];
  }
}

export const db = new VirDB();

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  return ((await db.meta.get(key))?.value as T) ?? fallback;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Clears all tables in the database (used on user sign-out to prevent data bleeding between accounts). */
export async function clearAllData(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

// Auto-purge corrupted legacy vessel IDs (ves-timestamp format) on startup
const UUID_RE_DB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
db.on('ready', async () => {
  const all = await db.vessels.toArray();
  const bad = all.filter(v => !UUID_RE_DB.test(v.id)).map(v => v.id);
  if (bad.length) {
    console.warn('[DB] Purging', bad.length, 'corrupted vessel(s):', bad);
    await db.vessels.bulkDelete(bad);
  }
  const cursor = await getMeta<number>('cursor', 0);
  if (cursor > 100_000_000) {
    console.warn('[DB] Resetting legacy timestamp cursor', cursor, 'to 0');
    await setMeta('cursor', 0);
  }
  // Purge any soft-deleted template sections from local Dexie
  const allSecs = await db.templateSections.toArray();
  const deadSecs = allSecs.filter(s => !!(s as any).deletedAt).map(s => s.id);
  if (deadSecs.length) {
    console.warn('[DB] Purging', deadSecs.length, 'deleted template section(s)');
    await db.templateSections.bulkDelete(deadSecs);
  }
});

