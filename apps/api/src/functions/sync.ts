import { app } from '@azure/functions';
import {
  can, PUSHABLE_ENTITIES,
  type Inspection, type Mutation, type MutationResult, type PullResponse, type PushRequest, type SyncEntity, type User,
} from '@ozellar/shared';
import { requireUser } from '../lib/auth.js';
import { photoBlobPath } from '../lib/blob.js';
import { pool, tx, type Tx } from '../lib/db.js';
import { camel, fail, handler, HttpError, jsonBody, snake } from '../lib/http.js';

/* ------------------------------------------------------------------ PULL */

interface EntityDef {
  table: string;
  idCol: string;                // primary key column
  /** SQL fragment joined to `t` so that `vis_vessel` is the vessel that controls visibility (null = visible to all) */
  visJoin: string;
  visExpr: string | null;
  hidden?: string[];            // columns never sent to clients
}

const ENTITIES: Record<SyncEntity, EntityDef> = {
  vessels:             { table: 'vessels', idCol: 'id', visJoin: '', visExpr: 't.id' },
  inspections:         { table: 'inspections', idCol: 'id', visJoin: '', visExpr: 't.vessel_id' },
  inspectionSections:  { table: 'inspection_sections', idCol: 'id', visJoin: 'join inspections i on i.id = t.inspection_id', visExpr: 'i.vessel_id' },
  inspectionQuestions: { table: 'inspection_questions', idCol: 'id',
                         visJoin: 'join inspection_sections s on s.id = t.inspection_section_id join inspections i on i.id = s.inspection_id', visExpr: 'i.vessel_id' },
  responses:           { table: 'responses', idCol: 'id', visJoin: 'join inspections i on i.id = t.inspection_id', visExpr: 'i.vessel_id' },
  findings:            { table: 'findings', idCol: 'id', visJoin: 'join inspections i on i.id = t.inspection_id', visExpr: 'i.vessel_id' },
  photos:              { table: 'photos', idCol: 'id', visJoin: 'left join inspections i on i.id = t.inspection_id', visExpr: 'coalesce(i.vessel_id, t.vessel_id)' },
  approvals:           { table: 'approvals', idCol: 'inspection_id', visJoin: 'join inspections i on i.id = t.inspection_id', visExpr: 'i.vessel_id' },
  templateSections:    { table: 'template_sections', idCol: 'id', visJoin: '', visExpr: null },
  templateQuestions:   { table: 'template_questions', idCol: 'id', visJoin: '', visExpr: null },
  users:               { table: 'users', idCol: 'id', visJoin: '', visExpr: null, hidden: ['entra_oid', 'password_hash'] },
};

export const syncPullHandler = handler(async (req): Promise<PullResponse> => {
    const user = await requireUser(req);
    const cursor = Number(req.query.get('cursor') ?? 0) || 0;
    const limit = Math.min(Number(req.query.get('limit') ?? 500) || 500, 1000);
    const seesAll = user.role === 'admin' || user.role === 'director';

    // 1) One ordered list of (entity, id, row_version) across all tables → a single safe cursor.
    const parts = (Object.entries(ENTITIES) as [SyncEntity, EntityDef][]).map(([name, d]) =>
      `select '${name}' as entity, t.${d.idCol}::text as id, t.row_version
         from ${d.table} t ${d.visJoin}
        where t.row_version > $1 ${!seesAll && d.visExpr ? `and ${d.visExpr} = any($3::uuid[])` : ''}`);
    const idx = await pool.query(
      `${parts.join(' union all ')} order by row_version limit $2`,
      seesAll ? [cursor, limit] : [cursor, limit, user.vesselIds]);

    // 2) Fetch the full rows per entity.
    const byEntity = new Map<SyncEntity, string[]>();
    for (const r of idx.rows) {
      const list = byEntity.get(r.entity) ?? [];
      list.push(r.id);
      byEntity.set(r.entity, list);
    }
    const changes: PullResponse['changes'] = {};
    for (const [entity, ids] of byEntity) {
      const d = ENTITIES[entity];
      const rows = (await pool.query(`select * from ${d.table} where ${d.idCol}::text = any($1)`, [ids])).rows;
      changes[entity] = rows.map((row) => {
        for (const h of d.hidden ?? []) delete row[h];
        const c = camel<Record<string, unknown>>(row);
        return { ...c, id: String(row[d.idCol]), rowVersion: Number(row.row_version) } as never;
      });
    }
    const last = idx.rows.at(-1);
    return { changes, nextCursor: last ? Number(last.row_version) : cursor, hasMore: idx.rows.length === limit };
  });
app.http('sync-pull', {
  route: 'sync/pull', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  handler: syncPullHandler,
});

/* ------------------------------------------------------------------ PUSH */

/** Columns a client may write, per entity (camelCase). Everything else is ignored. */
const WRITABLE: Partial<Record<SyncEntity, string[]>> = {
  inspections: ['vesselId', 'vesselName', 'imo', 'vesselType', 'inspectionType', 'port', 'startDate', 'completionDate',
    'sailFromDate', 'sailFromPort', 'sailToDate', 'sailToPort', 'remoteFromDate', 'remoteToDate',
    'inspector', 'company', 'summary', 'conclusion', 'coverPhotoId'],
  inspectionSections: ['inspectionId', 'templateSr', 'zone', 'name', 'position', 'photoOnly', 'isCustom'],
  inspectionQuestions: ['inspectionSectionId', 'qid', 'ref', 'text', 'position'],
  responses: ['inspectionId', 'inspectionQuestionId', 'applicable', 'answer', 'remarks', 'correctiveAction', 'preventiveAction'],
  findings: ['inspectionId', 'inspectionSectionId', 'text', 'answer', 'correctiveAction', 'preventiveAction', 'position'],
  photos: ['inspectionId', 'target', 'inspectionSectionId', 'responseId', 'findingId', 'vesselId', 'isDefect', 'position',
    'contentType', 'sizeBytes', 'width', 'height'],
};
const SOFT_DELETE: Partial<Record<SyncEntity, true>> = { inspections: true, inspectionSections: true, findings: true, photos: true };

/** Finds the inspection a mutation belongs to (locked FOR UPDATE, so approvals and edits can't interleave). */
async function owningInspection(c: Tx, m: Mutation): Promise<{ id: string; vesselId: string | null; status: Inspection['status'] } | null> {
  const d = m.data ?? {};
  let inspectionId: string | null = null;
  if (m.entity === 'inspections') inspectionId = m.entityId;
  else if (typeof d.inspectionId === 'string') inspectionId = d.inspectionId;
  else if (m.entity === 'inspectionQuestions') {
    const sid = (d.inspectionSectionId as string) ??
      (await c.query(`select inspection_section_id from inspection_questions where id = $1`, [m.entityId])).rows[0]?.inspection_section_id;
    inspectionId = sid ? (await c.query(`select inspection_id from inspection_sections where id = $1`, [sid])).rows[0]?.inspection_id ?? null : null;
  } else {
    const table = ENTITIES[m.entity].table;
    inspectionId = (await c.query(`select inspection_id from ${table} where id = $1`, [m.entityId])).rows[0]?.inspection_id ?? null;
  }
  if (!inspectionId) return null;
  const i = (await c.query(`select id, vessel_id, status from inspections where id = $1 for update`, [inspectionId])).rows[0];
  return i ? { id: i.id, vesselId: i.vessel_id, status: i.status } : null;
}

async function applyMutation(c: Tx, user: User, m: Mutation): Promise<number> {
  if (!PUSHABLE_ENTITIES.includes(m.entity)) throw fail('VALIDATION', `${m.entity} can’t be changed through sync`);
  const def = ENTITIES[m.entity];
  const d = m.data ?? {};
  const insp = await owningInspection(c, m);

  // --- permission & lock checks (shared rules) ---
  if (m.entity === 'inspections' && !insp) {
    if (m.op === 'delete') throw fail('NOT_FOUND', 'Inspection not found');
    if (!can(user, 'inspection.create', { vesselId: (d.vesselId as string) ?? null })) throw fail('FORBIDDEN', 'You can’t create inspections for this vessel');
  } else if (m.entity === 'photos' && !insp && d.vesselId) {
    if (!can(user, 'vessels.manage')) throw fail('FORBIDDEN', 'Only an Admin can change vessel photos');
  } else {
    if (!insp) throw fail('NOT_FOUND', 'Inspection not synced yet');
    const action = m.entity === 'inspections' && m.op === 'delete' ? 'inspection.delete' : 'inspection.edit';
    if (!can(user, action, { inspection: insp })) {
      throw fail(insp.status === 'in_progress' || insp.status === 'returned' ? 'FORBIDDEN' : 'LOCKED',
        insp.status === 'in_progress' || insp.status === 'returned' ? 'Not allowed' : 'This inspection is waiting for approval or approved — changes are locked');
    }
    if (m.entity === 'inspectionSections' && d.isCustom === true && !can(user, 'inspection.addSection'))
      throw fail('FORBIDDEN', 'Only an Admin can add sections');
  }

  // --- delete ---
  if (m.op === 'delete') {
    if (!SOFT_DELETE[m.entity]) throw fail('VALIDATION', `${m.entity} can’t be deleted`);
    const r = await c.query(`update ${def.table} set deleted_at = now() where id = $1 returning row_version`, [m.entityId]);
    if (!r.rows[0]) throw fail('NOT_FOUND', 'Not found');
    return Number(r.rows[0].row_version);
  }

  // --- upsert (whitelisted columns only). Partial updates are normal (phones send only changed fields),
  //     so UPDATE when the row exists and INSERT otherwise — never rely on ON CONFLICT with partial data.
  const cols = (WRITABLE[m.entity] ?? []).filter((k) => k in d);
  const exists = (await c.query(`select 1 from ${def.table} where id = $1`, [m.entityId])).rows.length > 0;

  if (exists) {
    const sets = cols.map((k, i) => `${snake(k)} = $${i + 2}`);
    const vals: unknown[] = [m.entityId, ...cols.map((k) => d[k])];
    if (m.entity === 'responses' || m.entity === 'findings') { sets.push(`updated_by = $${vals.length + 1}`); vals.push(user.id); }
    if (!sets.length) {
      return Number((await c.query(`select row_version from ${def.table} where id = $1`, [m.entityId])).rows[0].row_version);
    }
    const r = await c.query(`update ${def.table} set ${sets.join(', ')} where id = $1 returning row_version`, vals);
    return Number(r.rows[0].row_version);
  }

  const insertCols = ['id', ...cols.map(snake)];
  const values: unknown[] = [m.entityId, ...cols.map((k) => d[k])];
  const extra: Record<string, unknown> = {};
  if (m.entity === 'inspections') extra.created_by = user.id;
  if (m.entity === 'photos') {
    extra.created_by = user.id;
    extra.blob_path = photoBlobPath({ id: m.entityId, inspectionId: d.inspectionId as string, vesselId: d.vesselId as string });
  }
  if (m.entity === 'responses' || m.entity === 'findings') extra.updated_by = user.id;
  for (const [k, v] of Object.entries(extra)) { insertCols.push(k); values.push(v); }
  const r = await c.query(
    `insert into ${def.table} (${insertCols.join(',')}) values (${insertCols.map((_, i) => `$${i + 1}`).join(',')}) returning row_version`,
    values);
  return Number(r.rows[0].row_version);
}

export const syncPushHandler = handler(async (req, ctx) => {
    const user = await requireUser(req);
    const body = await jsonBody<PushRequest>(req);
    if (!Array.isArray(body.mutations) || body.mutations.length > 200) throw fail('VALIDATION', 'Send 1–200 mutations per request');

    const results: MutationResult[] = [];
    for (const m of body.mutations) {
      try {
        const rowVersion = await tx(async (c) => {
          const fresh = await c.query(
            `insert into sync_mutations (id, user_id, device_id) values ($1,$2,$3) on conflict (id) do nothing returning id`,
            [m.id, user.id, body.deviceId ?? '']);
          if (!fresh.rows[0]) { // already applied earlier (phone retried) → idempotent success
            const def = ENTITIES[m.entity];
            return Number((await c.query(`select row_version from ${def.table} where ${def.idCol} = $1`, [m.entityId])).rows[0]?.row_version ?? 0);
          }
          return applyMutation(c, user, m);
        });
        results.push({ id: m.id, ok: true, rowVersion });
      } catch (e) {
        const err = e instanceof HttpError ? e : null;
        if (!err) ctx.error('sync push mutation failed', m.id, e);
        let serverRow: unknown;
        const def = ENTITIES[m.entity];
        if (def) serverRow = (await pool.query(`select * from ${def.table} where ${def.idCol} = $1`, [m.entityId]).catch(() => ({ rows: [] }))).rows[0];
        results.push({
          id: m.id, ok: false,
          code: err && (['FORBIDDEN', 'LOCKED', 'VALIDATION', 'NOT_FOUND', 'CONFLICT'] as const).includes(err.code as 'FORBIDDEN')
            ? (err.code as 'FORBIDDEN' | 'LOCKED' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT') : 'VALIDATION',
          message: err?.message ?? 'Could not apply change',
          serverRow: serverRow ? camel(serverRow as Record<string, unknown>) : undefined,
        });
      }
    }
    return { results };
  });
app.http('sync-push', {
  route: 'sync/push', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: syncPushHandler,
});
