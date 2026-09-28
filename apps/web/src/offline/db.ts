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
