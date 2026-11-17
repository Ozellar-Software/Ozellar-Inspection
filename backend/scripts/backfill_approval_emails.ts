import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { sendMail } from '../src/lib/mail.js';

// ─── Environment Loader ───────────────────────────────────────────────────
function loadEnvironment() {
  const candidates = [
    path.resolve(process.cwd(), 'backend/.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/local.settings.json'),
    path.resolve(process.cwd(), 'local.settings.json'),
    '/opt/Ozellar-Inspection/backend/.env',
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      if (candidate.endsWith('.json')) {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (parsed.Values) {
          for (const [k, v] of Object.entries(parsed.Values)) {
            if (!process.env[k]) process.env[k] = String(v);
          }
        }
      } else {
        const lines = fs.readFileSync(candidate, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) process.env[key] = val;
          }
        }
      }
    } catch (err) {
      console.warn(`[Backfill] Warning: Failed parsing ${candidate}:`, (err as Error).message);
    }
  }

  // Default sender fallback if not set in environment or .env file
  if (!process.env.MAIL_SENDER && !process.env.GRAPH_MAIL_SENDER) {
    process.env.MAIL_SENDER = 'techdevops@ozellar.com';
  }
}

loadEnvironment();

const isLiveSend = process.argv.includes('--send') || process.argv.includes('--live') || (process.env.GRAPH_MAIL_ACTIVE ?? '').toLowerCase() === 'true';
if (isLiveSend) {
  process.env.GRAPH_MAIL_ACTIVE = 'true';
}

const pool = new pg.Pool({
  host: process.env.PG_HOST ?? 'localhost',
  database: process.env.PG_DB ?? (process.env.NODE_ENV === 'production' ? 'inspection' : 'vir'),
  user: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD ?? '',
  port: Number(process.env.PG_PORT ?? 5432),
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

function buildApprovalEmailHtml(params: {
  vesselName: string;
  imo?: string | null;
  statusLabel: string;
  stageName: string;
  submitterName: string;
  submitterRole: string;
  comment?: string | null;
  reportUrl: string;
  appUrl: string;
}): string {
  const { vesselName, imo, statusLabel, stageName, submitterName, submitterRole, comment, reportUrl, appUrl } = params;

  return `
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 620px; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <tr>
        <td style="background-color: #105935; padding: 20px 28px; border-bottom: 3px solid #f26b24;">
          <table width="100%" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 700;">Ozellar Vessel Inspection</h1>
                <p style="margin: 4px 0 0; color: #a7f3d0; font-size: 13px;">Official Statutory &amp; Technical Inspection Notification</p>
              </td>
              <td align="right">
                <span style="display: inline-block; background-color: rgba(255, 255, 255, 0.2); color: #ffffff; padding: 5px 12px; border-radius: 14px; font-size: 11px; font-weight: 600; text-transform: uppercase;">
                  ${statusLabel}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding: 28px;">
          <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 18px; font-weight: 700;">
            Approval Needed: ${vesselName} — ${stageName}
          </h2>
          <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 20px;">
            <tr>
              <td style="padding: 16px 20px;">
                <table width="100%" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="50%" style="padding-bottom: 10px;">
                      <span style="color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 600;">Vessel Name</span><br/>
                      <strong style="color: #0f172a; font-size: 15px;">${vesselName}</strong>
                    </td>
                    <td width="50%" style="padding-bottom: 10px;">
                      <span style="color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 600;">IMO Number</span><br/>
                      <strong style="color: #0f172a; font-size: 15px;">${imo ? `IMO ${imo}` : '-'}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td width="50%">
                      <span style="color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 600;">Submitted By</span><br/>
                      <span style="color: #1e293b; font-size: 14px; font-weight: 500;">${submitterName} (${submitterRole})</span>
                    </td>
                    <td width="50%">
                      <span style="color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 600;">Required Review Stage</span><br/>
                      <span style="color: #0f766e; font-size: 14px; font-weight: 700;">${stageName}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          ${comment ? `
            <div style="background-color: #fdfdfd; border-left: 4px solid #105935; padding: 12px 16px; margin-bottom: 24px; border-radius: 0 4px 4px 0;">
              <p style="margin: 0 0 4px; color: #64748b; font-size: 11px; font-weight: 600; text-transform: uppercase;">Submitter Remarks</p>
              <p style="margin: 0; color: #334155; font-size: 13.5px; line-height: 1.5; font-style: italic;">
                "${comment}"
              </p>
            </div>
          ` : ''}

          <!-- Action Button -->
          <div style="text-align: center; margin: 24px 0;">
            <a href="${reportUrl}" style="display: inline-block; background-color: #105935; color: #ffffff; text-decoration: none; padding: 13px 30px; font-size: 14px; font-weight: 700; border-radius: 6px; box-shadow: 0 2px 4px rgba(16, 89, 53, 0.2);">
              Open Inspection Report &rarr;
            </a>
          </div>

          <!-- Portal URL, Login & Action Flow Guide -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 18px 20px; margin-top: 24px;">
            <p style="margin: 0 0 12px; color: #0f172a; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;">
              Portal Login &amp; Action Flow Guide
            </p>
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="font-size: 13px; color: #334155; line-height: 1.5;">
              <tr>
                <td width="26" valign="top" style="padding-bottom: 10px;">
                  <span style="display: inline-block; width: 18px; height: 18px; line-height: 18px; background-color: #105935; color: #ffffff; text-align: center; border-radius: 50%; font-size: 10px; font-weight: 700;">1</span>
                </td>
                <td style="padding-bottom: 10px;">
                  <strong>Portal URL:</strong> <a href="${appUrl}" style="color: #105935; font-weight: 600; text-decoration: underline;">${appUrl}</a> (or click the button above).
                </td>
              </tr>
              <tr>
                <td width="26" valign="top" style="padding-bottom: 10px;">
                  <span style="display: inline-block; width: 18px; height: 18px; line-height: 18px; background-color: #105935; color: #ffffff; text-align: center; border-radius: 50%; font-size: 10px; font-weight: 700;">2</span>
                </td>
                <td style="padding-bottom: 10px;">
                  <strong>How to Log In:</strong> Sign in with your registered email and password. If you forgot your password, click <em>"Forgot Password"</em> on the login screen.
                </td>
              </tr>
              <tr>
                <td width="26" valign="top" style="padding-bottom: 10px;">
                  <span style="display: inline-block; width: 18px; height: 18px; line-height: 18px; background-color: #105935; color: #ffffff; text-align: center; border-radius: 50%; font-size: 10px; font-weight: 700;">3</span>
                </td>
                <td style="padding-bottom: 10px;">
                  <strong>Review Inspection:</strong> Review the vessel particulars, checklist questions, visual evidence photographs, and observations.
                </td>
              </tr>
              <tr>
                <td width="26" valign="top">
                  <span style="display: inline-block; width: 18px; height: 18px; line-height: 18px; background-color: #105935; color: #ffffff; text-align: center; border-radius: 50%; font-size: 10px; font-weight: 700;">4</span>
                </td>
                <td>
                  <strong>Action &amp; Sign-Off:</strong> Click <strong>Approve</strong> to forward to the next role / finalize, or <strong>Reject</strong> with feedback for necessary revisions.
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
      <tr>
        <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 28px; text-align: center; font-size: 11px; color: #94a3b8;">
          Ozellar Marine Inspection Platform &bull; <a href="${reportUrl}" style="color: #105935;">${reportUrl}</a>
        </td>
      </tr>
    </table>
  `;
}

async function runBackfill() {
  console.log('================================================================================');
  console.log('         OZELLAR VESSEL INSPECTION — PENDING APPROVALS EMAIL BACKFILL           ');
  console.log('================================================================================');
  console.log(`Database Host: ${process.env.PG_HOST ?? 'localhost'}`);
  console.log(`Database Name: ${process.env.PG_DB ?? 'vir/inspection'}`);
  console.log(`FROM Address:  ${process.env.MAIL_SENDER || 'techdevops@ozellar.com'}`);
  console.log(`Mode:          ${isLiveSend ? '🚀 LIVE SEND (Dispatching via Microsoft Graph)' : '🔍 DRY-RUN PREVIEW (pass --send to send)'}`);
  console.log('--------------------------------------------------------------------------------\n');

  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();

    // 1. Fetch pending inspections
    const pendingInspections = await client.query(`
      SELECT
        i.id,
        i.vessel_name,
        i.vessel_id,
        i.imo,
        i.start_date,
        i.status,
        i.created_by,
        a.tm_user_id,
        a.director_user_id,
        a.vu_user_id,
        a.submitted_by
      FROM inspections i
      LEFT JOIN approvals a ON a.inspection_id = i.id
      WHERE i.deleted_at IS NULL
        AND i.status IN ('pending_vu', 'pending_tm', 'pending_director')
        AND (i.report_category IS NULL OR i.report_category = 'inspection')
      ORDER BY i.created_at ASC
    `);

    if (pendingInspections.rows.length === 0) {
      console.log('No inspections currently waiting for approval.');
      return;
    }

    console.log(`Found ${pendingInspections.rows.length} inspection(s) currently waiting for approval:\n`);

    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (let idx = 0; idx < pendingInspections.rows.length; idx++) {
      const insp = pendingInspections.rows[idx];
      console.log(`[${idx + 1}/${pendingInspections.rows.length}] ──────────────────────────────────────────────────────────`);
      console.log(`Inspection:  ${insp.id}`);
      console.log(`Vessel:      ${insp.vessel_name} (IMO: ${insp.imo || 'N/A'})`);
      console.log(`Status:      ${insp.status.toUpperCase()}`);

      // 2. Identify the target approvers for this status
      let targetUserIds: string[] = [];
      let stageName = '';

      if (insp.status === 'pending_vu') {
        stageName = 'Vessel User Review';
        if (insp.vu_user_id) targetUserIds.push(insp.vu_user_id);
        const vuRes = await client.query(
          `SELECT u.id FROM user_vessels uv JOIN users u ON u.id = uv.user_id WHERE uv.vessel_id = $1 AND u.role = 'vesselUser' AND u.is_active = true`,
          [insp.vessel_id]
        );
        targetUserIds = [...targetUserIds, ...vuRes.rows.map((r: { id: string }) => r.id)];
      } else if (insp.status === 'pending_tm') {
        stageName = 'Technical Manager Approval';
        if (insp.tm_user_id) targetUserIds.push(insp.tm_user_id);
        const tmRes = await client.query(
          `SELECT u.id FROM user_vessels uv JOIN users u ON u.id = uv.user_id WHERE uv.vessel_id = $1 AND u.role = 'techManager' AND u.is_active = true`,
          [insp.vessel_id]
        );
        targetUserIds = [...targetUserIds, ...tmRes.rows.map((r: { id: string }) => r.id)];
      } else if (insp.status === 'pending_director') {
        stageName = 'Director Final Approval';
        if (insp.director_user_id) targetUserIds.push(insp.director_user_id);
        const dirRes = await client.query(`SELECT id FROM users WHERE role = 'director' AND is_active = true`);
        targetUserIds = [...targetUserIds, ...dirRes.rows.map((r: { id: string }) => r.id)];
      }

      // Deduplicate target user IDs
      targetUserIds = Array.from(new Set(targetUserIds.filter(Boolean)));

      if (targetUserIds.length === 0) {
        console.log(`⚠️  No approver users assigned/found for status ${insp.status}. Skipped.`);
        skippedCount++;
        continue;
      }

      // 3. Fetch recipient users
      const approverUsersRes = await client.query(
        `SELECT id, name, email, role, designation FROM users WHERE id = ANY($1::uuid[]) AND is_active = true`,
        [targetUserIds]
      );
      const approverUsers = approverUsersRes.rows;

      if (approverUsers.length === 0) {
        console.log(`⚠️  Approver user accounts exist but are marked inactive or missing email. Skipped.`);
        skippedCount++;
        continue;
      }

      // 4. Fetch latest submitter information and comments
      const eventRes = await client.query(
        `SELECT actor_name, actor_role, comment, created_at FROM approval_events WHERE inspection_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [insp.id]
      );
      const latestEvent = eventRes.rows[0];

      let submitterName = latestEvent?.actor_name || 'Inspector / Tech Manager';
      let submitterRole = latestEvent?.actor_role || 'Staff';
      const comment = latestEvent?.comment || null;

      if (!latestEvent && insp.created_by) {
        const creatorRes = await client.query(`SELECT name, role FROM users WHERE id = $1`, [insp.created_by]);
        if (creatorRes.rows[0]) {
          submitterName = creatorRes.rows[0].name;
          submitterRole = creatorRes.rows[0].role;
        }
      }

      const appUrl = process.env.APP_URL ?? 'https://inspection.ozellar.com';
      const reportUrl = `${appUrl}/inspections/${insp.id}/report`;
      const dateFormatted = insp.start_date
        ? new Date(insp.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '';
      const subject = `Approval needed: ${insp.vessel_name} — inspection of ${dateFormatted || 'record'}`;

      console.log(`Stage:       ${stageName}`);
      console.log(`Submitter:   ${submitterName} (${submitterRole})`);
      if (comment) console.log(`Comment:     "${comment}"`);

      // 5. Send notification to each approver
      for (const approver of approverUsers) {
        const toEmail = (approver.email || '').trim().toLowerCase();
        if (!toEmail) continue;

        console.log(`\n  ▸ Recipient: ${approver.name} [${approver.designation || approver.role}]`);
        console.log(`    FROM:      ${process.env.MAIL_SENDER || 'techdevops@ozellar.com'}`);
        console.log(`    TO:        ${toEmail}`);

        const html = buildApprovalEmailHtml({
          vesselName: insp.vessel_name,
          imo: insp.imo,
          statusLabel: insp.status.replace(/_/g, ' ').toUpperCase(),
          stageName,
          submitterName,
          submitterRole,
          comment,
          reportUrl,
          appUrl,
        });

        if (isLiveSend) {
          try {
            const success = await sendMail(
              [toEmail],
              subject,
              `${subject}\nBy: ${submitterName} (${submitterRole})\nStatus: ${stageName}\nLink: ${reportUrl}`,
              { html, link: reportUrl }
            );

            if (success) {
              console.log(`    Result:    ✓ Sent successfully (202 Accepted via Microsoft Graph)`);
              sentCount++;
            } else {
              console.log(`    Result:    ✗ Failed or in standby`);
              failedCount++;
            }
          } catch (sendErr) {
            console.error(`    Result:    ✗ Error sending email:`, (sendErr as Error).message);
            failedCount++;
          }
        } else {
          console.log(`    Result:    [Dry Run Preview] (Pass --send to dispatch email)`);
          sentCount++;
        }
      }
      console.log('');
    }

    console.log('================================================================================');
    console.log('                         BACKFILL EXECUTION SUMMARY                             ');
    console.log('================================================================================');
    console.log(`Total Pending Inspections: ${pendingInspections.rows.length}`);
    console.log(`Emails Processed / Sent:   ${sentCount}`);
    console.log(`Skipped / Inactive:        ${skippedCount}`);
    console.log(`Errors / Failed:           ${failedCount}`);
    console.log('================================================================================');
  } catch (err) {
    console.error('[Backfill] Fatal error:', (err as Error).message);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

void runBackfill();
