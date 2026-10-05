import { DefaultAzureCredential } from '@azure/identity';

/**
 * Sends email through Microsoft Graph as MAIL_SENDER (e.g. inspections@ozellar.com),
 * using the Function App's managed identity (Mail.Send, restricted to that mailbox).
 * Never throws: an email failure must not undo an approval.
 */
const credential = new DefaultAzureCredential();

export async function sendMail(to: string[], subject: string, text: string): Promise<boolean> {
  const sender = process.env.MAIL_SENDER;
  const recipients = to.filter(Boolean);
  if (!sender || recipients.length === 0) return false;
  try {
    const token = await credential.getToken('https://graph.microsoft.com/.default');
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token?.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: `${text}\n\nOpen the app: ${process.env.APP_URL ?? ''}` },
          toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
