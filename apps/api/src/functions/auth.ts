import { app } from '@azure/functions';
import { pool } from '../lib/db.js';
import { fail, handler, jsonBody } from '../lib/http.js';
import { signAccessToken } from '../lib/auth.js';
import { hashPassword, verifyPassword, newResetToken, hashResetToken } from '../lib/passwords.js';
import { sendMail } from '../lib/mail.js';

const RESET_TTL_MS = 24 * 60 * 60 * 1000; // 24h; long enough to open an email from a ship, short enough to be safe

/** Email + password sign-in. Returns a long-lived access token (inspectors can be offline for days). */
export const loginHandler = handler(async (req) => {
  const { email, password } = await jsonBody<{ email: string; password: string }>(req);
  const row = (await pool.query(
    `select id, password_hash, is_active from users where lower(email) = lower($1)`, [email ?? ''])).rows[0];
  // Same error for "no such user" and "wrong password" so login can't be used to discover which emails exist.
  if (!row || !row.password_hash || !(await verifyPassword(password ?? '', row.password_hash))) {
    throw fail('UNAUTHORIZED', 'Incorrect email or password');
  }
  if (!row.is_active) throw fail('FORBIDDEN', 'Your access has been removed.');
  return { token: await signAccessToken(row.id) };
});
app.http('auth-login', { route: 'auth/login', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler: loginHandler });

/** Starts a reset: always looks like success, so this can't be used to discover which emails are registered. */
export const requestResetHandler = handler(async (req) => {
  const { email } = await jsonBody<{ email: string }>(req);
  const user = (await pool.query(`select id, name from users where lower(email) = lower($1) and is_active`, [email ?? ''])).rows[0];
  if (user) {
    const { raw, hash } = newResetToken();
    await pool.query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)`,
      [user.id, hash, new Date(Date.now() + RESET_TTL_MS)]);
    const link = `${process.env.APP_URL ?? ''}/reset-password?token=${raw}`;
    await sendMail([email], 'Reset your Ozellar Inspection password',
      `Hi ${user.name || ''},\n\nOpen this link to set a new password (valid 24 hours):\n${link}\n\nIf you didn't request this, you can ignore this email.`);
  }
  return { ok: true };
});
app.http('auth-request-reset', { route: 'auth/request-reset', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler: requestResetHandler });

/** Completes a reset (also used for a brand-new user's first "set your password" link). */
export const resetPasswordHandler = handler(async (req) => {
  const { token, password } = await jsonBody<{ token: string; password: string }>(req);
  if (!password || password.length < 8) throw fail('VALIDATION', 'Password must be at least 8 characters');
  const hash = hashResetToken(token ?? '');
  const row = (await pool.query(
    `select id, user_id from password_reset_tokens
      where token_hash = $1 and used_at is null and expires_at > now()`, [hash])).rows[0];
  if (!row) throw fail('VALIDATION', 'This link is invalid or has expired. Ask your admin to send a new one.');

  await pool.query(`update users set password_hash = $1 where id = $2`, [await hashPassword(password), row.user_id]);
  await pool.query(`update password_reset_tokens set used_at = now() where id = $1`, [row.id]);
  return { token: await signAccessToken(row.user_id) };
});
app.http('auth-reset-password', { route: 'auth/reset-password', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler: resetPasswordHandler });
