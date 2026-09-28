import { app } from '@azure/functions';
import { can, DESIGNATION_PRESETS, type Role } from '@ozellar/shared';
import { requireUser } from '../lib/auth.js';
import { pool, tx } from '../lib/db.js';
import { camel, fail, handler, jsonBody } from '../lib/http.js';

const ROLES: Role[] = ['admin', 'director', 'techManager', 'vesselManager'];

export const usersListHandler = handler(async (req) => {
    const me = await requireUser(req);
    if (!can(me, 'users.manage')) throw fail('FORBIDDEN', 'Admins only');
    const r = await pool.query(
      `select u.*, coalesce(array_agg(uv.vessel_id) filter (where uv.vessel_id is not null), '{}') as vessel_ids
         from users u left join user_vessels uv on uv.user_id = u.id
        group by u.id order by lower(u.name), lower(u.email)`);
    return r.rows.map((row) => camel(row));
  });
app.http('users-list', {
  route: 'users', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  handler: usersListHandler,
});

export const usersUpsertHandler = handler(async (req) => {
    const me = await requireUser(req);
    if (!can(me, 'users.manage')) throw fail('FORBIDDEN', 'Admins only');
    const b = await jsonBody<{ email: string; name?: string; designation?: string; role: Role; vesselIds?: string[]; isActive?: boolean }>(req);
    const email = (b.email ?? '').trim().toLowerCase();
    if (!email.includes('@')) throw fail('VALIDATION', 'Enter a valid email');
    if (!ROLES.includes(b.role)) throw fail('VALIDATION', 'Choose a role');
    const needsVessels = b.role === 'techManager' || b.role === 'vesselManager';
    if (needsVessels && !(b.vesselIds?.length)) throw fail('VALIDATION', 'Pick at least one vessel');

    return tx(async (c) => {
      const u = (await c.query(
        `insert into users (email, name, designation, role, is_active) values ($1,$2,$3,$4,coalesce($5,true))
         on conflict ((lower(email))) do update set name = excluded.name, designation = excluded.designation,
           role = excluded.role, is_active = excluded.is_active
         returning *`,
        [email, b.name ?? '', b.designation ?? '', b.role, b.isActive ?? true])).rows[0];
      await c.query(`delete from user_vessels where user_id = $1`, [u.id]);
      if (needsVessels) {
        await c.query(`insert into user_vessels (user_id, vessel_id) select $1, unnest($2::uuid[])`, [u.id, b.vesselIds]);
      }
      await c.query(`insert into audit_log (actor_user_id, entity, entity_id, action, details) values ($1,'user',$2,'upsert',$3)`,
        [me.id, u.id, { role: b.role, vesselIds: b.vesselIds ?? [] }]);
      return camel(u);
    });
  });
app.http('users-upsert', {
  route: 'users/{id?}', methods: ['POST', 'PATCH', 'OPTIONS'], authLevel: 'anonymous',
  handler: usersUpsertHandler,
});

export const designationsHandler = handler(async (req) => {
    await requireUser(req);
    const used = await pool.query(`select distinct designation from users where designation <> ''`);
    const all = new Map<string, string>();
    for (const d of [...DESIGNATION_PRESETS, ...used.rows.map((r: { designation: string }) => r.designation)]) {
      if (!all.has(d.toLowerCase())) all.set(d.toLowerCase(), d);
    }
    return [...all.values()];
  });
app.http('designations', {
  route: 'designations', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  handler: designationsHandler,
});

/** Who can the caller send this inspection to? level=tm → Tech Managers with the vessel; level=director → Directors. */
export const approversHandler = handler(async (req) => {
    await requireUser(req);
    const level = req.query.get('level');
    const inspectionId = req.query.get('inspectionId');
    if (level === 'director') {
      const r = await pool.query(`select id, email, name, designation, role from users where role = 'director' and is_active order by lower(name)`);
      return r.rows.map((row) => camel(row));
    }
    if (level === 'tm' && inspectionId) {
      const r = await pool.query(
        `select u.id, u.email, u.name, u.designation, u.role
           from users u join user_vessels uv on uv.user_id = u.id
           join inspections i on i.vessel_id = uv.vessel_id
          where i.id = $1 and u.role = 'techManager' and u.is_active order by lower(u.name)`, [inspectionId]);
      return r.rows.map((row) => camel(row));
    }
    throw fail('VALIDATION', 'level must be tm (with inspectionId) or director');
  });
app.http('approvers', {
  route: 'approvers', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  handler: approversHandler,
});
