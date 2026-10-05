import type { NotificationType } from '@ozellar/shared';
import { pool, type Tx } from './db.js';
import { sendMail } from './mail.js';

type DbConn = Tx | typeof pool;

export async function getVesselManagers(c: DbConn, vesselId: string | null | undefined): Promise<string[]> {
  if (!vesselId) return [];
  const r = await c.query(
    `select u.id from user_vessels uv join users u on u.id = uv.user_id where uv.vessel_id = $1 and u.role = 'vesselManager' and u.is_active = true`,
    [vesselId]
  );
  return r.rows.map((row: { id: string }) => row.id);
}

export async function getTechManagers(c: DbConn, vesselId: string | null | undefined): Promise<string[]> {
  if (!vesselId) return [];
  const r = await c.query(
    `select u.id from user_vessels uv join users u on u.id = uv.user_id where uv.vessel_id = $1 and u.role = 'techManager' and u.is_active = true`,
    [vesselId]
  );
  return r.rows.map((row: { id: string }) => row.id);
}

export async function getDirectors(c: DbConn): Promise<string[]> {
  const r = await c.query(`select id from users where role = 'director' and is_active = true`);
  return r.rows.map((row: { id: string }) => row.id);
}

export async function getAdmins(c: DbConn): Promise<string[]> {
  const r = await c.query(`select id from users where role = 'admin' and is_active = true`);
  return r.rows.map((row: { id: string }) => row.id);
}

export interface CreateNotificationParams {
  userIds: string[];
  inspectionId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  excludeUserId?: string | null;
}

/**
 * Creates in-app notifications for specified users and sends background email notification.
 * Never throws — notifications must not disrupt the primary transaction.
 */
export async function createNotifications(c: DbConn, params: CreateNotificationParams): Promise<void> {
  try {
    const targetUserIds = Array.from(new Set(params.userIds))
      .filter((id) => id && id !== params.excludeUserId);

    if (targetUserIds.length === 0) return;

    const link = params.link ?? '';

    for (const uid of targetUserIds) {
      await c.query(
        `insert into notifications (id, user_id, inspection_id, type, title, message, link, read, created_at)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, now())`,
        [uid, params.inspectionId ?? null, params.type, params.title, params.message, link]
      );
    }

    // Also send email in background if recipients have emails configured
    const emailRows = (await c.query(`select email from users where id = any($1) and is_active = true`, [targetUserIds])).rows;
    const emails = emailRows.map((r: { email: string }) => r.email).filter(Boolean);

    if (emails.length > 0) {
      const appUrl = process.env.APP_URL ?? 'https://inspection.ozellar.com';
      const fullLink = link.startsWith('http') ? link : `${appUrl}${link}`;
      const emailBody = `${params.title}\n\n${params.message}\n\nView details: ${fullLink}`;
      void sendMail(emails, params.title, emailBody);
    }
  } catch (err) {
    console.error('Failed to create notifications:', err);
  }
}
