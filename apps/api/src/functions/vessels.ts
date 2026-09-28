import { app } from '@azure/functions';
import { can, inspectionDueInfo, VESSEL_PARTICULAR_KEYS } from '@ozellar/shared';
import { requireUser } from '../lib/auth.js';
import { pool } from '../lib/db.js';
import { camel, fail, handler, jsonBody } from '../lib/http.js';

export const vesselsListHandler = handler(async (req) => {
    const user = await requireUser(req);
    const all = user.role === 'admin' || user.role === 'director';
    const r = await pool.query(
      `select * from vessels where deleted_at is null ${all ? '' : 'and id = any($1)'} order by lower(name)`,
      all ? [] : [user.vesselIds]);
    return r.rows.map((row) => camel(row));
  });
app.http('vessels-list', {
  route: 'vessels', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  handler: vesselsListHandler,
});

export const vesselsUpsertHandler = handler(async (req) => {
    const user = await requireUser(req);
    if (!can(user, 'vessels.manage')) throw fail('FORBIDDEN', 'Only an Admin can manage vessels');
    const b = await jsonBody<{ id: string; name: string; imo?: string; vesselType?: string; particulars?: Record<string, string> }>(req);
    if (!b.id || !b.name?.trim()) throw fail('VALIDATION', 'Vessel id and name are required');
    const particulars = Object.fromEntries(
      Object.entries(b.particulars ?? {}).filter(([k]) => (VESSEL_PARTICULAR_KEYS as readonly string[]).includes(k)));
    const r = await pool.query(
      `insert into vessels (id, name, imo, vessel_type, particulars) values ($1,$2,$3,$4,$5)
       on conflict (id) do update set name = excluded.name, imo = excluded.imo,
         vessel_type = excluded.vessel_type, particulars = excluded.particulars
       returning *`,
      [b.id, b.name.trim(), b.imo ?? '', b.vesselType ?? '', particulars]);
    return camel(r.rows[0]);
  });
app.http('vessels-upsert', {
  route: 'vessels/{id?}', methods: ['POST', 'PATCH', 'OPTIONS'], authLevel: 'anonymous',
  handler: vesselsUpsertHandler,
});

export const vesselsDeleteHandler = handler(async (req) => {
    const user = await requireUser(req);
    if (!can(user, 'vessels.manage')) throw fail('FORBIDDEN', 'Only an Admin can manage vessels');
    await pool.query(`update vessels set deleted_at = now() where id = $1`, [req.params.id]);
    return { ok: true };
  });
app.http('vessels-delete', {
  route: 'vessels/{id}', methods: ['DELETE'], authLevel: 'anonymous',
  handler: vesselsDeleteHandler,
});

export const fleetStatusHandler = handler(async (req) => {
    const user = await requireUser(req);
    const all = user.role === 'admin' || user.role === 'director';
    const r = await pool.query(
      `select v.id, v.name,
              (select json_build_object('id', i.id, 'startDate', i.start_date, 'completionDate', i.completion_date,
                                        'inspectionType', i.inspection_type, 'port', i.port)
                 from inspections i
                where i.vessel_id = v.id and i.status = 'approved' and i.deleted_at is null
                order by coalesce(i.completion_date, i.start_date) desc nulls last limit 1) as last
         from vessels v
        where v.deleted_at is null ${all ? '' : 'and v.id = any($1)'}
        order by lower(v.name)`, all ? [] : [user.vesselIds]);
    return r.rows.map((row) => ({ vesselId: row.id, name: row.name, last: row.last, due: inspectionDueInfo(row.last) }));
  });
app.http('fleet-status', {
  route: 'fleet-status', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  handler: fleetStatusHandler,
});
