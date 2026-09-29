import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

/** A reset/invite token: the raw value goes in the emailed link, only its hash is stored. */
export function newResetToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: createHash('sha256').update(raw).digest('hex') };
}
export const hashResetToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');
