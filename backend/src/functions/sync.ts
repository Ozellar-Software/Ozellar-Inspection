import { app } from '@azure/functions';
import {
  can, PUSHABLE_ENTITIES,
  type Inspection, type Mutation, type MutationResult, type PullResponse, type PushRequest, type SyncEntity, type User,
} from '@ozellar/shared';
import { requireUser } from '../lib/auth.js';
import { photoBlobPath } from '../lib/blob.js';
import { pool, tx, type Tx } from '../lib/db.js';
import { camel, fail, handler, HttpError, jsonBody, snake } from '../lib/http.js';
import {
  createNotifications,
  getAdmins,
  getDirectors,
  getTechManagers,
} from '../lib/notifications.js';

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
  approvalEvents:      { table: 'approval_events', idCol: 'id', visJoin: 'join inspections i on i.id = t.inspection_id', visExpr: 'i.vessel_id' },
  templateSections:    { table: 'template_sections', idCol: 'id', visJoin: '', visExpr: null },
  templateQuestions:   { table: 'template_questions', idCol: 'id', visJoin: '', visExpr: null },
  users:               { table: 'users', idCol: 'id', visJoin: '', visExpr: null, hidden: ['entra_oid'] },
};

export const syncPullHandler = handler(async (req): Promise<PullResponse> => {
    const user = await requireUser(req);
    let cursor = Number(req.query.get('cursor') ?? 0) || 0;
    // Auto-heal legacy timestamp cursor (Postgres row_version is integer sequence < 100,000,000)
    if (cursor > 100_000_000) cursor = 0;
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
      let rows: Array<Record<string, unknown>>;
      if (entity === 'users') {
        rows = (await pool.query(
          `select u.*, coalesce(array_agg(uv.vessel_id::text) filter (where uv.vessel_id is not null), '{}') as vessel_ids
             from users u left join user_vessels uv on uv.user_id = u.id
            where u.id::text = any($1)
            group by u.id`, [ids])).rows;
      } else {
        rows = (await pool.query(`select * from ${d.table} where ${d.idCol}::text = any($1)`, [ids])).rows;
      }
      changes[entity] = rows.map((row) => {
        for (const h of d.hidden ?? []) delete row[h];
        const c = camel<Record<string, unknown>>(row);
        if ('vesselTypes' in c && !Array.isArray(c.vesselTypes)) {
          c.vesselTypes = [];
        }
        if ('vesselIds' in c && !Array.isArray(c.vesselIds)) {
          c.vesselIds = [];
        }
        return { ...c, id: String(row[d.idCol]), rowVersion: Number(row.row_version) } as never;
      });
    }

    const activeInspRes = await pool.query(
      `select id::text from inspections where deleted_at is null ${!seesAll ? 'and vessel_id = any($1::uuid[])' : ''}`,
      seesAll ? [] : [user.vesselIds]
    );
    const activeInspectionIds = activeInspRes.rows.map((r: { id: string }) => r.id);

    const last = idx.rows.at(-1);
    return {
      changes,
      nextCursor: last ? Number(last.row_version) : cursor,
      hasMore: idx.rows.length === limit,
      activeInspectionIds,
    };
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
  inspectionSections: ['inspectionId', 'templateSr', 'zone', 'name', 'position', 'photoOnly', 'isCustom', 'vesselTypes'],
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

/**
 * Three-way non-destructive smart conflict merger.
 * Resolves concurrent updates on the same section or question without erasing observations.
 */
function mergeConcurrentConflict(
  entity: SyncEntity,
  cur: Record<string, unknown>,
  clientData: Record<string, unknown>,
  user: User
): { mergedData: Record<string, unknown>; conflicts: Record<string, unknown> } {
  const merged: Record<string, unknown> = { ...clientData };
  const conflicts: Record<string, unknown> = {};

  if (entity === 'responses') {
    // 1. Answer: Safety-first rule: If either recorded 'no' (deficiency), keep 'no'!
    const sAns = (cur.answer as string | null) ?? undefined;
    const cAns = (clientData.answer as string | null) ?? undefined;
    if (sAns && cAns && sAns !== cAns) {
      conflicts.answer = { server: sAns, client: cAns };
      merged.answer = (sAns === 'no' || cAns === 'no') ? 'no' : cAns;
    }

    // 2. Remarks: Non-destructive text merge
    const sRem = String(cur.remarks ?? '').trim();
    const cRem = String(clientData.remarks ?? '').trim();
    if (sRem && cRem && sRem !== cRem) {
      if (!sRem.includes(cRem) && !cRem.includes(sRem)) {
        conflicts.remarks = { server: sRem, client: cRem };
        merged.remarks = `${sRem}\n---\n[Merged note by ${user.name || user.email}]: ${cRem}`;
      } else {
        merged.remarks = sRem.length >= cRem.length ? sRem : cRem;
      }
    } else if (sRem && !cRem) {
      merged.remarks = sRem;
    }

    // 3. Corrective Action
    const sCa = String(cur.corrective_action ?? '').trim();
    const cCa = String(clientData.correctiveAction ?? '').trim();
    if (sCa && cCa && sCa !== cCa) {
      if (!sCa.includes(cCa) && !cCa.includes(sCa)) {
        conflicts.correctiveAction = { server: sCa, client: cCa };
        merged.correctiveAction = `${sCa}\n---\n[Action by ${user.name || user.email}]: ${cCa}`;
      } else {
        merged.correctiveAction = sCa.length >= cCa.length ? sCa : cCa;
      }
    } else if (sCa && !cCa) {
      merged.correctiveAction = sCa;
    }

    // 4. Preventive Action
    const sPa = String(cur.preventive_action ?? '').trim();
    const cPa = String(clientData.preventiveAction ?? '').trim();
    if (sPa && cPa && sPa !== cPa) {
      if (!sPa.includes(cPa) && !cPa.includes(sPa)) {
        conflicts.preventiveAction = { server: sPa, client: cPa };
        merged.preventiveAction = `${sPa}\n---\n[Action by ${user.name || user.email}]: ${cPa}`;
      } else {
        merged.preventiveAction = sPa.length >= cPa.length ? sPa : cPa;
      }
    } else if (sPa && !cPa) {
      merged.preventiveAction = sPa;
    }

    // 5. Applicable
    if (cur.applicable === false && clientData.applicable !== false) {
      if (!cAns) merged.applicable = false;
    }
  } else if (entity === 'findings') {
    const sTxt = String(cur.text ?? '').trim();
    const cTxt = String(clientData.text ?? '').trim();
    if (sTxt && cTxt && sTxt !== cTxt && !sTxt.includes(cTxt) && !cTxt.includes(sTxt)) {
      conflicts.text = { server: sTxt, client: cTxt };
      merged.text = `${sTxt}\n---\n[Note by ${user.name || user.email}]: ${cTxt}`;
    } else if (sTxt && !cTxt) {
      merged.text = sTxt;
    }

    const sCa = String(cur.corrective_action ?? '').trim();
    const cCa = String(clientData.correctiveAction ?? '').trim();
    if (sCa && cCa && sCa !== cCa && !sCa.includes(cCa)) {
      merged.correctiveAction = `${sCa}\n---\n[Action by ${user.name || user.email}]: ${cCa}`;
    }
  } else if (entity === 'inspections') {
    const sSum = String(cur.summary ?? '').trim();
    const cSum = String(clientData.summary ?? '').trim();
    if (sSum && cSum && sSum !== cSum && !sSum.includes(cSum) && !cSum.includes(sSum)) {
      conflicts.summary = { server: sSum, client: cSum };
      merged.summary = `${sSum}\n---\n[Update by ${user.name || user.email}]: ${cSum}`;
    }

    const sConc = String(cur.conclusion ?? '').trim();
    const cConc = String(clientData.conclusion ?? '').trim();
    if (sConc && cConc && sConc !== cConc && !sConc.includes(cConc) && !cConc.includes(sConc)) {
      conflicts.conclusion = { server: sConc, client: cConc };
      merged.conclusion = `${sConc}\n---\n[Update by ${user.name || user.email}]: ${cConc}`;
    }
  }

  return { mergedData: merged, conflicts };
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
    const isOfflineDataSync = (m.entity === 'responses' || m.entity === 'findings' || m.entity === 'photos' || m.entity === 'inspectionSections');
    const isPendingApproval = (insp.status === 'pending_tm' || insp.status === 'pending_director');
    const allowPendingSync = isPendingApproval && isOfflineDataSync && can(user, 'inspection.view', { inspection: insp });

    if (!can(user, action, { inspection: insp }) && !allowPendingSync) {
      throw fail(insp.status === 'in_progress' || insp.status === 'returned' ? 'FORBIDDEN' : 'LOCKED',
        insp.status === 'approved' ? 'This inspection has already been approved — changes are locked' : 'This inspection is waiting for approval');
    }
    if (m.entity === 'inspectionSections' && d.isCustom === true && !can(user, 'inspection.addSection', { inspection: insp }))
      throw fail('FORBIDDEN', 'You do not have permission to add sections');
  }

  // --- delete ---
  if (m.op === 'delete') {
    if (!SOFT_DELETE[m.entity]) throw fail('VALIDATION', `${m.entity} can’t be deleted`);
    const r = await c.query(`update ${def.table} set deleted_at = now() where id = $1 returning row_version`, [m.entityId]);
    if (!r.rows[0]) throw fail('NOT_FOUND', 'Not found');
    return Number(r.rows[0].row_version);
  }

  // --- upsert (whitelisted columns only) ---
  const existingRows = (await c.query(`select * from ${def.table} where ${def.idCol} = $1`, [m.entityId])).rows;
  const exists = existingRows.length > 0;
  const cur = existingRows[0] as Record<string, unknown> | undefined;

  const sanitizeVal = (k: string, v: unknown) => (k === 'vesselTypes' ? (Array.isArray(v) ? v : []) : v);

  if (exists && cur) {
    let payload = d;
    const isConcurrent = m.baseVersion != null && Number(cur.row_version) > Number(m.baseVersion);
    if (isConcurrent) {
      const { mergedData, conflicts } = mergeConcurrentConflict(m.entity, cur, d, user);
      payload = mergedData;
      if (Object.keys(conflicts).length > 0) {
        await c.query(
          `insert into audit_log (actor_user_id, entity, entity_id, action, details) values ($1, $2, $3, 'sync_conflict_resolved', $4)`,
          [user.id, m.entity, m.entityId, JSON.stringify({ baseVersion: m.baseVersion, serverRowVersion: cur.row_version, conflicts })]
        ).catch(() => {});
      }
    }

    const cols = (WRITABLE[m.entity] ?? []).filter((k) => k in payload);
    const sets = cols.map((k, i) => `${snake(k)} = $${i + 2}`);
    const vals: unknown[] = [m.entityId, ...cols.map((k) => sanitizeVal(k, payload[k]))];
    if (m.entity === 'responses' || m.entity === 'findings') { sets.push(`updated_by = $${vals.length + 1}`); vals.push(user.id); }
    if (!sets.length) {
      return Number(cur.row_version);
    }
    const r = await c.query(`update ${def.table} set ${sets.join(', ')} where ${def.idCol} = $1 returning row_version`, vals);
    return Number(r.rows[0].row_version);
  }

  const insertFields = (WRITABLE[m.entity] ?? []).filter((k) => k in d);
  const insertCols = ['id', ...insertFields.map(snake)];
  const values: unknown[] = [m.entityId, ...insertFields.map((k) => sanitizeVal(k, d[k]))];
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

  if (m.entity === 'inspections') {
    const vesselId = (d.vesselId as string) || null;
    const vesselName = (d.vesselName as string) || 'Vessel';
    const [tms, dirs, admins] = await Promise.all([
      getTechManagers(c, vesselId),
      getDirectors(c),
      getAdmins(c),
    ]);
    await createNotifications(c, {
      userIds: [...tms, ...dirs, ...admins],
      excludeUserId: user.id,
      inspectionId: m.entityId,
      type: 'inspection_created',
      title: 'New Inspection Initiated',
      message: `${vesselName}: ${(d.inspectionType as string) || ''} inspection started by ${user.name || user.email}`,
      link: `/inspections/${m.entityId}`,
    });
  }

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
