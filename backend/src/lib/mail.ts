import { ClientSecretCredential, DefaultAzureCredential, type TokenCredential } from '@azure/identity';

/**
 * Microsoft Graph Mail Service
 *
 * Sends emails through Microsoft Graph via /v1.0/users/{sender}/sendMail using
 * OAuth2 Client Credentials (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)
 * or Azure Managed Identity (DefaultAzureCredential fallback).
 *
 * Activation:
 * - Controlled by the environment variable GRAPH_MAIL_ACTIVE ("true" / "false").
 * - When GRAPH_MAIL_ACTIVE is "false", emails are staged/logged without making external API calls.
 * - When GRAPH_MAIL_ACTIVE is "true", emails are actively dispatched via Microsoft Graph.
 */

let cachedCredential: TokenCredential | null = null;

function getCredential(): TokenCredential {
  if (cachedCredential) return cachedCredential;

  const tenantId = process.env.AZURE_TENANT_ID || process.env.ENTRA_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (tenantId && clientId && clientSecret) {
    cachedCredential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  } else {
    cachedCredential = new DefaultAzureCredential();
  }
  return cachedCredential;
}

export interface SendMailOptions {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  link?: string;
}

export async function sendMail(
  to: string[],
  subject: string,
  text: string,
  options?: { html?: string; link?: string }
): Promise<boolean> {
  const recipients = Array.from(new Set(to.map((e) => (e || '').trim()).filter(Boolean)));
  const sender = process.env.MAIL_SENDER || 'inspections@ozellar.com';
  const appUrl = process.env.APP_URL ?? 'https://inspection.ozellar.com';

  if (!sender || recipients.length === 0) {
    console.log('[GraphMail] Skipped: no sender or recipients specified.');
    return false;
  }

  const isGraphActive = (process.env.GRAPH_MAIL_ACTIVE ?? 'false').toLowerCase() === 'true';

  if (!isGraphActive) {
    console.log(
      `[GraphMail] Standby (GRAPH_MAIL_ACTIVE is not 'true'). Prepared email for ${recipients.join(', ')}: "${subject}"`
    );
    return false;
  }

  try {
    const credential = getCredential();
    const token = await credential.getToken('https://graph.microsoft.com/.default');
    if (!token?.token) {
      console.error('[GraphMail] Failed to acquire Microsoft Graph token.');
      return false;
    }

    const reportLink = options?.link
      ? (options.link.startsWith('http') ? options.link : `${appUrl}${options.link}`)
      : appUrl;

    const formattedHtml = options?.html || `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="margin: 0; color: #0f766e; font-size: 20px; font-weight: 700;">Ozellar Fleet Systems</h2>
          <p style="margin: 4px 0 0; color: #64748b; font-size: 13px;">Official Statutory & Technical Inspection Notification</p>
        </div>
        <div style="font-size: 15px; font-weight: 600; color: #0f172a; margin-bottom: 16px;">
          ${subject}
        </div>
        <div style="font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-wrap; margin-bottom: 24px;">
${text}
        </div>
        <div style="margin-bottom: 24px;">
          <a href="${reportLink}" style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 6px;">
            Open Inspection Report
          </a>
        </div>
        <div style="border-top: 1px solid #e2e8f0; padding-top: 14px; font-size: 12px; color: #94a3b8;">
          This is an automated notification from the Ozellar Marine Inspection Platform.<br/>
          Direct link: <a href="${reportLink}" style="color: #0f766e;">${reportLink}</a>
        </div>
      </div>
    `;

    const requestBody = {
      message: {
        subject,
        body: {
          contentType: 'HTML',
          content: formattedHtml,
        },
        toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    };

    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (res.ok) {
      console.log(`[GraphMail] Successfully dispatched email to ${recipients.join(', ')}: "${subject}"`);
      return true;
    } else {
      const errText = await res.text();
      console.error(`[GraphMail] Error sending email via Graph (${res.status} ${res.statusText}):`, errText);
      return false;
    }
  } catch (err) {
    console.error('[GraphMail] Unexpected error in sendMail:', err);
    return false;
  }
}
