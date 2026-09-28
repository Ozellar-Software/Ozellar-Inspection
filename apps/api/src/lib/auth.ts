import type { HttpRequest } from '@azure/functions';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { User } from '@ozellar/shared';
import { pool } from './db.js';
import { fail } from './http.js';

const tenant = process.env.ENTRA_TENANT_ID ?? '';
// Overridable only so automated tests can run a local key server; production uses the Microsoft defaults.
const issuer = process.env.ENTRA_ISSUER ?? `https://login.microsoftonline.com/${tenant}/v2.0`;
const jwks = createRemoteJWKSet(new URL(process.env.ENTRA_JWKS_URL ?? `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`));

/** Validates the Entra access token and returns the app user (role + assigned vessels). */
export async function requireUser(req: HttpRequest): Promise<User> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw fail('UNAUTHORIZED', 'Sign in required');

  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: process.env.API_AUDIENCE,
    });
    claims = payload as Record<string, unknown>;
  } catch {
    throw fail('UNAUTHORIZED', 'Invalid or expired sign-in');
  }

  const oid = String(claims.oid ?? '');
  const email = String(claims.preferred_username ?? claims.email ?? '').toLowerCase();

  // First sign-in: link the Entra account to the user row an Admin created by email.
  let row = (await pool.query(
    `select id, email, name, designation, role, is_active from users where entra_oid = $1`, [oid])).rows[0];
  if (!row && email) {
    row = (await pool.query(
      `update users set entra_oid = $1 where lower(email) = $2 and entra_oid is null
       returning id, email, name, designation, role, is_active`, [oid, email])).rows[0];
  }
  if (!row) throw fail('FORBIDDEN', 'You don’t have access yet. Ask your admin to add you.');
  if (!row.is_active) throw fail('FORBIDDEN', 'Your access has been removed.');

  const vessels = await pool.query(`select vessel_id from user_vessels where user_id = $1`, [row.id]);
  return {
    id: row.id, email: row.email, name: row.name, designation: row.designation,
    role: row.role, isActive: row.is_active,
    vesselIds: vessels.rows.map((v: { vessel_id: string }) => v.vessel_id),
  };
}
