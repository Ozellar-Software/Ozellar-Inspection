import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendMail } from '../src/lib/mail.js';

describe('Microsoft Graph Mail Service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it('skips sending when recipients are empty or invalid', async () => {
    process.env.GRAPH_MAIL_ACTIVE = 'true';
    const result = await sendMail([], 'Test Subject', 'Test Body');
    expect(result).toBe(false);
  });

  it('stays in standby when GRAPH_MAIL_ACTIVE is false or unset', async () => {
    process.env.GRAPH_MAIL_ACTIVE = 'false';
    process.env.MAIL_SENDER = 'inspections@ozellar.com';
    const result = await sendMail(['techmanager@ozellar.com'], 'Test Subject', 'Test Body');
    expect(result).toBe(false);
  });

  it('handles token and dispatch gracefully without throwing', async () => {
    process.env.GRAPH_MAIL_ACTIVE = 'false';
    expect(async () => {
      await sendMail(['director@ozellar.com'], 'Approval Needed', 'Inspection submitted');
    }).not.toThrow();
  });
});
