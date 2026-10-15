import { app, type HttpRequest } from '@azure/functions';
import {
  applyApproval, canActOnApproval, canSeeVessel, personLabel, ROLE_LABELS,
  type Approval, type Command, type User,
} from '@ozellar/shared';
import { requireUser } from '../lib/auth.js';
import { pool, tx, type Tx } from '../lib/db.js';
import { camel, fail, handler, jsonBody } from '../lib/http.js';
import { sendMail } from '../lib/mail.js';
import {
  createNotifications,
  getDirectors,
  getTechManagers,
  getVesselManagers,
} from '../lib/notifications.js';

async function loadUser(c: Tx, id: string | null | undefined): Promise<User | null> {
  if (!id) return null;
  const u = (await c.query(`select id, email, name, designation, role, is_active from users where id = $1`, [id])).rows[0];
  if (!u) return null;
  const v = await c.query(
    `select distinct uv.vessel_id::text from user_vessels uv
       join vessels v on v.id = uv.vessel_id and v.deleted_at is null and v.registration_status = 'registered'
      where uv.user_id = $1`, [id]);
  return { id: u.id, email: u.email, name: u.name, designation: u.designation, role: u.role, isActive: u.is_active,
           vesselIds: v.rows.map((r: { vessel_id: string }) => r.vessel_id) };
}

/** Runs one approval command atomically, then emails (email failure never rolls back). */
async function run(req: HttpRequest, build: (body: Record<string, string>) => Command, targetKey?: 'approverId' | 'nextApproverId') {
  const actor = await requireUser(req);
  const inspectionId = req.params.id;
  const body = req.method === 'POST' ? await jsonBody<Record<string, string>>(req).catch(() => ({})) : {};
  const cmd = build(body);

  const result = await tx(async (c) => {
    const insp = (await c.query(
      `select id, vessel_id, vessel_name, start_date, status, summary, conclusion, created_by, report_category from inspections
        where id = $1 and deleted_at is null for update`, [inspectionId])).rows[0];
    if (!insp) throw fail('NOT_FOUND', 'Inspection not found');
    if (!canSeeVessel(actor, insp.vessel_id) && insp.created_by !== actor.id) throw fail('FORBIDDEN', 'Not your vessel');
    if (insp.report_category && insp.report_category !== 'inspection') {
      if (actor.role === 'admin' && (cmd.type === 'approve' || cmd.type === 'reopen')) {
        const nextStatus = cmd.type === 'approve' ? 'approved' : 'in_progress';
        await c.query(`update inspections set status = $2 where id = $1`, [inspectionId, nextStatus]);
        if (insp.report_category === 'take_over' && cmd.type === 'approve') {
          if (insp.vessel_id) {
            await c.query(`update vessels set registration_status = 'registered' where id = $1`, [insp.vessel_id]);
          } else if (insp.vessel_name) {
            await c.query(`update vessels set registration_status = 'registered' where lower(name) = lower($1)`, [insp.vessel_name]);
          }
        }
        await c.query(
          `insert into approvals (inspection_id, stage, submitted_by, submitted_at, director_user_id, approved_at)
           values ($1, $2, $3, now(), $4, case when $2 = 'approved' then now() else null end)
           on conflict (inspection_id) do update set stage = excluded.stage, director_user_id = excluded.director_user_id, approved_at = excluded.approved_at`,
          [inspectionId, nextStatus, insp.created_by, actor.id]
        );
        const actionLabel = cmd.type === 'approve' ? 'approved' : 'reopened';
        const eventComment = (cmd as { comment?: string }).comment?.trim() || (cmd.type === 'approve' ? (insp.report_category === 'take_over' ? 'Take Over report approved & vessel registered' : 'Pre Purchase report approved') : 'Report reopened by Administrator');
        await c.query(
          `insert into approval_events (inspection_id, action, level, actor_user_id, actor_name, actor_designation, actor_role, target_user_id, comment)
           values ($1, $2, 'Administrator', $3, $4, $5, $6, null, $7)`,
          [inspectionId, actionLabel, actor.id, actor.name || actor.email, actor.designation || 'Administrator', actor.role, eventComment]
        );
        return {
          r: {
            status: nextStatus as any,
            approval: { stage: nextStatus, submittedBy: insp.created_by, submittedAt: new Date().toISOString(), tmUserId: null, directorUserId: actor.id, approvedAt: cmd.type === 'approve' ? new Date().toISOString() : null, returnedBy: null, returnComment: null } as any,
            event: { action: actionLabel as any, level: 'Administrator' as any, targetUserId: null, comment: eventComment },
            notify: []
          },
          insp,
          recipients: []
        };
      }
      throw fail('VALIDATION', 'Pre Purchase / Take Over reports are reviewed and approved directly by an Administrator.');
    }

    if (cmd.type === 'submit' && !cmd.photoOnly) {
      const pendingRes = await c.query(
        `select count(*) as count
           from inspection_questions iq
           join inspection_sections s on s.id = iq.inspection_section_id
           left join responses r on r.inspection_question_id = iq.id and r.inspection_id = $1
          where s.inspection_id = $1
            and s.photo_only = false
            and s.deleted_at is null
            and (r.id is null or (r.answer is null and (r.applicable is null or r.applicable = true)))`,
        [inspectionId]);
      const pendingCount = Number(pendingRes.rows[0]?.count ?? 0);
      if (pendingCount > 0) {
        throw fail('VALIDATION', `All checklist questions must be answered or marked N/A before submitting (${pendingCount} remaining).`);
      }
    }

    const apprRow = (await c.query(`select * from approvals where inspection_id = $1`, [inspectionId])).rows[0];
    const approval = apprRow ? camel<Approval>(apprRow) : null;
    const target = targetKey ? await loadUser(c, (cmd as Record<string, unknown>)[targetKey] as string) : null;

    const r = applyApproval(cmd, {
      actor,
      inspection: { id: insp.id, vesselId: insp.vessel_id, status: insp.status, summary: insp.summary, conclusion: insp.conclusion },
      approval, target,
    });

    await c.query(`update inspections set status = $2 where id = $1`, [inspectionId, r.status]);
    const a = r.approval;
    await c.query(
      `insert into approvals (inspection_id, stage, submitted_by, submitted_at, tm_user_id, director_user_id, approved_at, returned_by, return_comment)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (inspection_id) do update set stage = excluded.stage, submitted_by = excluded.submitted_by,
         submitted_at = excluded.submitted_at, tm_user_id = excluded.tm_user_id, director_user_id = excluded.director_user_id,
         approved_at = excluded.approved_at, returned_by = excluded.returned_by, return_comment = excluded.return_comment`,
      [inspectionId, a.stage, a.submittedBy, a.submittedAt, a.tmUserId, a.directorUserId, a.approvedAt ?? null, a.returnedBy ?? null, a.returnComment ?? null]);
    await c.query(
      `insert into approval_events (inspection_id, action, level, actor_user_id, actor_name, actor_designation, actor_role, target_user_id, comment)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [inspectionId, r.event.action, r.event.level, actor.id, actor.name, actor.designation, actor.role, r.event.targetUserId, r.event.comment]);
    // Notify users based on the approval action
    let targetNotifyUserIds = [...r.notify];
    if (r.event.action === 'submitted') {
      const dirs = await getDirectors(c);
      const tms = await getTechManagers(c, insp.vessel_id);
      targetNotifyUserIds = [...targetNotifyUserIds, ...dirs, ...tms];
    } else if (r.event.action === 'approved') {
      const dirs = await getDirectors(c);
      const vms = await getVesselManagers(c, insp.vessel_id);
      const tms = await getTechManagers(c, insp.vessel_id);
      if (a.directorUserId) targetNotifyUserIds.push(a.directorUserId);
      if (a.submittedBy) targetNotifyUserIds.push(a.submittedBy);
      targetNotifyUserIds = [...targetNotifyUserIds, ...dirs, ...tms, ...vms];
    } else if (r.event.action === 'rejected') {
      const vms = await getVesselManagers(c, insp.vessel_id);
      if (a.submittedBy) targetNotifyUserIds.push(a.submittedBy);
      targetNotifyUserIds = [...targetNotifyUserIds, ...vms];
    }

    const notifType =
      r.event.action === 'submitted' ? 'inspection_submitted'
      : r.event.action === 'approved' ? 'inspection_approved'
      : 'inspection_returned';

    const notifTitle =
      r.event.action === 'submitted' ? 'Inspection Submitted for Review'
      : r.event.action === 'approved' ? (r.status === 'approved' ? 'Inspection Approved' : 'Technical Review Completed — Director Approval Needed')
      : 'Inspection Returned for Correction';

    const notifMsg =
      r.event.action === 'submitted' ? `${insp.vessel_name}: Inspection submitted for review by ${actor.name || actor.email}`
      : r.event.action === 'approved' ? (r.status === 'approved' ? `${insp.vessel_name}: Inspection officially approved by ${actor.name || actor.email}` : `${insp.vessel_name}: Reviewed and endorsed by ${actor.name || actor.email}. Ready for final Director approval.`)
      : `${insp.vessel_name}: Returned by ${actor.name || actor.email}${r.event.comment ? ` — "${r.event.comment}"` : ''}`;

    await createNotifications(c, {
      userIds: targetNotifyUserIds,
      excludeUserId: actor.id,
      inspectionId,
      type: notifType,
      title: notifTitle,
      message: notifMsg,
      link: `/inspections/${inspectionId}/report`,
    });

    const recipients = (await c.query(`select email from users where id = any($1::uuid[])`, [targetNotifyUserIds])).rows.map((x: { email: string }) => x.email);
    return { r, insp, recipients };
  });

  const { r, insp, recipients } = result;
  const what = `${insp.vessel_name} — inspection of ${insp.start_date ?? ''}`;
  const by = `${personLabel(actor)}, ${ROLE_LABELS[actor.role]}`;
  const subject = ({
    submitted: `Approval needed: ${what}`,
    approved: r.status === 'approved' ? `Approved: ${what}` : `Final approval needed: ${what}`,
    rejected: `Rejected: ${what}`,
    reopened: `Reopened: ${what}`,
  } as Record<string, string>)[r.event.action] ?? 'Inspection update';
  void sendMail(recipients, subject, `${subject}\nBy: ${by}${r.event.comment ? `\nComment: ${r.event.comment}` : ''}`);
  return { status: r.status, approval: r.approval };
}

export const approvalSubmitHandler = handler((req) => run(req, (b) => ({ type: 'submit', approverId: b.approverId, comment: b.comment, photoOnly: !!b.photoOnly }), 'approverId'));
app.http('approval-submit', {
  route: 'inspections/{id}/submit', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: approvalSubmitHandler,
});
export const approvalApproveHandler = handler((req) => run(req, (b) => ({ type: 'approve', nextApproverId: b.nextApproverId, comment: b.comment }), 'nextApproverId'));
app.http('approval-approve', {
  route: 'inspections/{id}/approve', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: approvalApproveHandler,
});
export const approvalRejectHandler = handler((req) => run(req, (b) => ({ type: 'reject', comment: b.comment })));
app.http('approval-reject', {
  route: 'inspections/{id}/reject', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: approvalRejectHandler,
});
export const approvalReopenHandler = handler((req) => run(req, () => ({ type: 'reopen' })));
app.http('approval-reopen', {
  route: 'inspections/{id}/reopen', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: approvalReopenHandler,
});

export const approvalHistoryHandler = handler(async (req) => {
    const user = await requireUser(req);
    const insp = (await pool.query(`select vessel_id, created_by from inspections where id = $1`, [req.params.id])).rows[0];
    if (!insp || (!canSeeVessel(user, insp.vessel_id) && insp.created_by !== user.id)) throw fail('NOT_FOUND', 'Inspection not found');
    const a = (await pool.query(`select * from approvals where inspection_id = $1`, [req.params.id])).rows[0];
    const ev = await pool.query(`select * from approval_events where inspection_id = $1 order by created_at`, [req.params.id]);
    return { approval: a ? camel(a) : null, history: ev.rows.map((row) => camel(row)) };
  });
app.http('approval-history', {
  route: 'inspections/{id}/approval', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  handler: approvalHistoryHandler,
});

/** Home notices: waiting for me / rejected back to me. */
export const approvalInboxHandler = handler(async (req) => {
    const user = await requireUser(req);
    const r = await pool.query(
      `select i.id, i.vessel_id, i.vessel_name, i.start_date, i.status, a.*
         from inspections i join approvals a on a.inspection_id = i.id
        where i.deleted_at is null and i.status in ('pending_tm','pending_director','returned')
          and (i.report_category is null or i.report_category = 'inspection')`);
    const waiting = [], returned = [];
    for (const row of r.rows) {
      const approval = camel<Approval>(row);
      if (canActOnApproval(user, row.status, approval) && canSeeVessel(user, row.vessel_id)) waiting.push(camel(row));
      else if (row.status === 'returned' && approval.submittedBy === user.id) returned.push(camel(row));
    }
    return { waiting, returned };
  });
app.http('approval-inbox', {
  route: 'approvals/inbox', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  handler: approvalInboxHandler,
});
