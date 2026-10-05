import { app } from '@azure/functions';
import type { AppNotification, NotificationType } from '@ozellar/shared';
import { requireUser } from '../lib/auth.js';
import { pool } from '../lib/db.js';
import { camel, fail, handler, jsonBody } from '../lib/http.js';
import {
  createNotifications,
  getAdmins,
  getDirectors,
  getTechManagers,
  getVesselManagers,
} from '../lib/notifications.js';

export const notificationsListHandler = handler(async (req) => {
  const user = await requireUser(req);
  const rows = (await pool.query(
    `select id, user_id, inspection_id, type, title, message, link, read, created_at
       from notifications
      where user_id = $1
      order by created_at desc
      limit 60`,
    [user.id]
  )).rows;

  const countRow = (await pool.query(
    `select count(*) as count from notifications where user_id = $1 and read = false`,
    [user.id]
  )).rows[0];

  const unreadCount = Number(countRow?.count ?? 0);
  const notifications: AppNotification[] = rows.map((r) => camel<AppNotification>(r));

  return { notifications, unreadCount };
});
app.http('notifications-list', {
  route: 'notifications',
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: notificationsListHandler,
});

export const notificationsReadHandler = handler(async (req) => {
  const user = await requireUser(req);
  const b = await jsonBody<{ id?: string; all?: boolean }>(req).catch(() => ({ all: true, id: undefined }));

  if (b.all) {
    await pool.query(`update notifications set read = true where user_id = $1 and read = false`, [user.id]);
  } else if (b.id) {
    await pool.query(`update notifications set read = true where id = $1 and user_id = $2`, [b.id, user.id]);
  }

  return { ok: true };
});
app.http('notifications-read', {
  route: 'notifications/read',
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: notificationsReadHandler,
});

export const notificationsTriggerHandler = handler(async (req) => {
  const user = await requireUser(req);
  const b = await jsonBody<{
    inspectionId: string;
    type: NotificationType;
    sectionId?: string;
    sectionName?: string;
  }>(req);

  if (!b.inspectionId) throw fail('VALIDATION', 'inspectionId is required');

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.inspectionId);
  if (!isUuid) {
    return { ok: false, reason: 'Inspection ID is not a valid UUID (e.g. demo mode)' };
  }

  const insp = (await pool.query(
    `select id, vessel_id, vessel_name, inspection_type, start_date from inspections where id = $1 and deleted_at is null`,
    [b.inspectionId]
  )).rows[0];
  if (!insp) throw fail('NOT_FOUND', 'Inspection not found');

  const vesselName = insp.vessel_name || 'Vessel';
  const vesselId = insp.vessel_id;

  if (b.type === 'inspection_created') {
    const [tms, dirs, admins] = await Promise.all([
      getTechManagers(pool, vesselId),
      getDirectors(pool),
      getAdmins(pool),
    ]);
    const targetIds = [...tms, ...dirs, ...admins];

    await createNotifications(pool, {
      userIds: targetIds,
      excludeUserId: user.id,
      inspectionId: insp.id,
      type: 'inspection_created',
      title: 'New Inspection Initiated',
      message: `${vesselName}: ${insp.inspection_type || ''} inspection started by ${user.name || user.email}`,
      link: `/inspections/${insp.id}`,
    });
  } else if (b.type === 'section_completed') {
    const [tms, dirs] = await Promise.all([
      getTechManagers(pool, vesselId),
      getDirectors(pool),
    ]);
    const targetIds = [...tms, ...dirs];

    const sectionTitle = b.sectionName ? `"${b.sectionName}"` : 'A section';

    await createNotifications(pool, {
      userIds: targetIds,
      excludeUserId: user.id,
      inspectionId: insp.id,
      type: 'section_completed',
      title: 'Section Completed',
      message: `${vesselName}: ${sectionTitle} has been completed by ${user.name || user.email}`,
      link: b.sectionId ? `/inspections/${insp.id}/sections/${b.sectionId}` : `/inspections/${insp.id}`,
    });
  }

  return { ok: true };
});
app.http('notifications-trigger', {
  route: 'notifications/trigger',
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: notificationsTriggerHandler,
});
