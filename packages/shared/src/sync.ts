/** Sync protocol contracts (see docs/08-offline-sync.md). */

export type SyncEntity =
  | 'vessels'
  | 'inspections'
  | 'inspectionSections'
  | 'inspectionQuestions'
  | 'responses'
  | 'findings'
  | 'photos'
  | 'approvals'
  | 'templateSections'
  | 'templateQuestions'
  | 'users';

/** Entities a client may change through /sync/push. Approvals go through /inspections/{id}/submit|approve|reject. */
export const PUSHABLE_ENTITIES: readonly SyncEntity[] = [
  'inspections', 'inspectionSections', 'inspectionQuestions', 'responses', 'findings', 'photos',
] as const;

export interface Mutation {
  /** uuid generated on the device; the server ignores duplicates (idempotent). */
  id: string;
  entity: SyncEntity;
  entityId: string;
  op: 'upsert' | 'delete';
  data?: Record<string, unknown>;
  /** row_version the device last saw; lets the server detect stale edits. */
  baseVersion?: number | null;
  createdAt: string;
}

export interface PushRequest { deviceId: string; mutations: Mutation[] }

export type MutationResult =
  | { id: string; ok: true; rowVersion: number }
  | { id: string; ok: false; code: 'FORBIDDEN' | 'LOCKED' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT'; message: string; serverRow?: unknown };

export interface PushResponse { results: MutationResult[] }

export interface PullResponse {
  changes: Partial<Record<SyncEntity, Array<Record<string, unknown> & { id: string; rowVersion: number; deletedAt?: string | null }>>>;
  nextCursor: number;
  hasMore: boolean;
}
