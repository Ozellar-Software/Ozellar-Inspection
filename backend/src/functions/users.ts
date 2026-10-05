import { app } from '@azure/functions';
import { can, DESIGNATION_PRESETS, type Role } from '@ozellar/shared';
import { requireUser } from '../lib/auth.js';
import { pool, tx } from '../lib/db.js';
import { camel, fail, handler, jsonBody } from '../lib/http.js';
import { hashPassword, newResetToken } from '../lib/passwords.js';
import { sendMail } from '../lib/mail.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a week to set a first password, longer than a forgot-password link

const ROLES: Role[] = ['admin', 'director', 'techManager', 'vesselManager'];

async function handleGet(req: any, me: any) {
    
    if (req.params.id) {
      const r = await pool.query(
        `select u.id, u.email, u.name, u.designation, u.role, u.is_active, u.created_at, u.updated_at,
                (u.password_hash is not null) as has_password,
                coalesce(array_agg(uv.vessel_id) filter (where uv.vessel_id is not null), '{}') as vessel_ids
           from users u left join user_vessels uv on uv.user_id = u.id
          where u.id = $1
          group by u.id`, [req.params.id]);
      if (!r.rows.length) throw fail('NOT_FOUND', 'User not found');
      return camel(r.rows[0]);
    }

    const r = await pool.query(
      `select u.id, u.email, u.name, u.designation, u.role, u.is_active, u.created_at, u.updated_at,
              (u.password_hash is not null) as has_password,
              coalesce(array_agg(uv.vessel_id) filter (where uv.vessel_id is not null), '{}') as vessel_ids
         from users u left join user_vessels uv on uv.user_id = u.id
        group by u.id order by lower(u.name), lower(u.email)`);
    return r.rows.map((row) => camel(row));
  }

async function handleUpsert(req: any, me: any) {
    const b = await jsonBody<{ email: string; name?: string; designation?: string; role: Role; vesselIds?: string[]; isActive?: boolean; password?: string }>(req);
    const email = (b.email ?? '').trim().toLowerCase();
    if (!email.includes('@')) throw fail('VALIDATION', 'Enter a valid email');
    if (!ROLES.includes(b.role)) throw fail('VALIDATION', 'Choose a role');
    const needsVessels = b.role === 'techManager' || b.role === 'vesselManager';
    // Strip legacy "ves-timestamp" IDs - only allow proper UUIDs
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const safeVesselIds = (b.vesselIds ?? []).filter(id => UUID_RE.test(id));
    if (needsVessels && !safeVesselIds.length) throw fail('VALIDATION', 'Pick at least one vessel. (Tip: refresh your browser if vessel list looks empty)');

    let pwdHash: string | null = null;
    if (b.password && b.password.trim()) {
      if (b.password.trim().length < 6) throw fail('VALIDATION', 'Password must be at least 6 characters');
      pwdHash = await hashPassword(b.password.trim());
    }

    // Check if it's an existing user by doing a preliminary check, or we can check inside tx.
    // Actually, we can check if req.params.id is provided, but Upsert checks email conflict.
    // If we require password for ALL creations, we should do it here or inside the transaction.
    const isEditing = Boolean(req.params.id);
    
    const existing = await pool.query('select id from users where lower(email) = $1', [email]);
    if (!isEditing && existing.rows.length > 0) {
      throw fail('CONFLICT', 'A user with this email address already exists.');
    }
    if (isEditing && existing.rows.length > 0 && existing.rows[0].id !== req.params.id) {
      throw fail('CONFLICT', 'Another user is already using this email address.');
    }

    if (!isEditing && !pwdHash) {
      throw fail('VALIDATION', 'Enterprise policy requires setting an initial password for all new users.');
    }

    const { row: u, isNew } = await tx(async (c) => {
      const r = (await c.query(
        `insert into users (email, name, designation, role, is_active, password_hash)
         values ($1,$2,$3,$4,coalesce($5,true),$6)
         on conflict ((lower(email))) do update set
           name = excluded.name,
           designation = excluded.designation,
           role = excluded.role,
           is_active = excluded.is_active,
           password_hash = coalesce(excluded.password_hash, users.password_hash)
         returning *, (xmax = 0) as is_new`,
        [email, b.name ?? '', b.designation ?? '', b.role, b.isActive ?? true, pwdHash])).rows[0];
      await c.query(`delete from user_vessels where user_id = $1`, [r.id]);
      if (needsVessels) {
        await c.query(`insert into user_vessels (user_id, vessel_id) select $1, unnest($2::uuid[])`, [r.id, safeVesselIds]);
      }
      await c.query(
        `insert into audit_log (actor_user_id, entity, entity_id, action, details) values ($1,'user',$2,'upsert',$3)`,
        [me.id, r.id, JSON.stringify({ role: b.role, vesselIds: safeVesselIds })]);
      return { row: r, isNew: r.is_new as boolean };
    });

    const out = { ...u } as Record<string, unknown>;
    delete out.is_new;
    delete out.password_hash;
    return camel(out);
  }

export const usersHandler = handler(async (req) => {
  const me = await requireUser(req);
  if (!can(me, 'users.manage')) throw fail('FORBIDDEN', 'Admins only');
  if (req.method === 'GET') return await handleGet(req, me);
  return await handleUpsert(req, me);
});
app.http('users-api', {
  route: 'users/{id?}', methods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'], authLevel: 'anonymous',
  handler: usersHandler,
});

export const userSetPasswordHandler = handler(async (req) => {
  const me = await requireUser(req);
  if (!can(me, 'users.manage')) throw fail('FORBIDDEN', 'Admins only');
  const userId = req.params.id;
  const b = await jsonBody<{ password: string }>(req);
  if (!b.password || b.password.trim().length < 6) throw fail('VALIDATION', 'Password must be at least 6 characters');
  const hash = await hashPassword(b.password.trim());
  const res = await pool.query(`update users set password_hash = $1 where id = $2 returning id`, [hash, userId]);
  if (!res.rows[0]) throw fail('NOT_FOUND', 'User not found');
  await pool.query(`insert into audit_log (actor_user_id, entity, entity_id, action, details) values ($1,'user',$2,'set_password','{}')`,
    [me.id, userId]);
  return { ok: true };
});
app.http('user-set-password', {
  route: 'users/{id}/password', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: userSetPasswordHandler,
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
    if (level === 'tm') {
      const vesselId = req.query.get('vesselId');
      let r = null;
      if (inspectionId) {
        r = await pool.query(
          `select u.id, u.email, u.name, u.designation, u.role
             from users u join user_vessels uv on uv.user_id = u.id
             join inspections i on i.vessel_id = uv.vessel_id
            where i.id = $1 and u.role = 'techManager' and u.is_active order by lower(u.name)`, [inspectionId]);
      }
      if ((!r || !r.rows.length) && vesselId) {
        r = await pool.query(
          `select u.id, u.email, u.name, u.designation, u.role
             from users u join user_vessels uv on uv.user_id = u.id
            where uv.vessel_id = $1 and u.role = 'techManager' and u.is_active order by lower(u.name)`, [vesselId]);
      }
      if (r) return r.rows.map((row) => camel(row));
    }
    throw fail('VALIDATION', 'level must be tm (with inspectionId or vesselId) or director');
  });
app.http('approvers', {
  route: 'approvers', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  handler: approversHandler,
});
