import type { HttpRequest } from '@azure/functions';
import { jwtVerify, SignJWT } from 'jose';
import type { User } from '@ozellar/shared';
import { pool } from './db.js';
import { fail } from './http.js';

const secretEnv = process.env.JWT_SECRET ?? '';
if (!secretEnv) throw new Error('JWT_SECRET is not set');
const secret = new TextEncoder().encode(secretEnv);
const ISSUER = 'ozellar-vir-api';
// Offline-first: inspectors can be at sea without connectivity for a while, so tokens are long-lived.
const TOKEN_TTL = '30d';

/** Signs an access token for a user id (used by login and after a password reset). */
export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuer(ISSUER).setIssuedAt().setExpirationTime(TOKEN_TTL).sign(secret);
}

async function loadUser(id: string): Promise<User | null> {
  const row = (await pool.query(
    `select id, email, name, designation, role, is_active from users where id = $1`, [id])).rows[0];
  if (!row) return null;
  const vessels = await pool.query(`select vessel_id from user_vessels where user_id = $1`, [row.id]);
  return {
    id: row.id, email: row.email, name: row.name, designation: row.designation,
    role: row.role, isActive: row.is_active,
    vesselIds: vessels.rows.map((v: { vessel_id: string }) => v.vessel_id),
  };
}

/** Validates our own access token and returns the app user (role + assigned vessels). */
export async function requireUser(req: HttpRequest): Promise<User> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw fail('UNAUTHORIZED', 'Sign in required');

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    userId = String(payload.sub ?? '');
    if (!userId) throw new Error('no sub');
  } catch {
    throw fail('UNAUTHORIZED', 'Invalid or expired sign-in');
  }

  const user = await loadUser(userId);
  if (!user) throw fail('FORBIDDEN', 'You don’t have access yet. Ask your admin to add you.');
  if (!user.isActive) throw fail('FORBIDDEN', 'Your access has been removed.');
  return user;
}
