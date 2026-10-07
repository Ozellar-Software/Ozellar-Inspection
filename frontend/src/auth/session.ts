import type { User } from '@ozellar/shared';
import bcrypt from 'bcryptjs';
import { db } from '../offline/db';

const TOKEN_KEY = 'oz_token';
const USER_KEY = 'oz_user';
const OFFLINE_ACCOUNTS_KEY = 'oz_offline_accounts';
const LAST_EMAIL_KEY = 'oz_last_email';
const BASE = (import.meta.env.VITE_API_BASE as string) ?? '/api';

export interface OfflineAccount {
  id: string;
  email: string;
  name: string;
  role: string;
  token: string;
  user: User;
  salt: string;
  passwordHash: string;
  lastLoginAt: string;
}

type Listener = () => void;
let listeners: Listener[] = [];
const notify = () => listeners.forEach((l) => l());

/** Cached user profile so navbar and offline mode always have the user details available. */
export function getCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCachedUser(user: User | null): void {
  try {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      syncOfflineUser(user);
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch { /* storage blocked */ }
}

/** Keeps people signed in offline between app launches (same intent as the old MSAL cache). */
export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private browsing / storage blocked: session just won't persist across reloads */ }
  notify();
}

/** Re-renders whatever's watching sign-in state (see useAuthToken) without a full auth library. */
export function subscribe(fn: Listener): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

/** Used by api/client.ts; the token itself is the whole "session" (no silent refresh — see TOKEN_TTL server-side). */
export async function apiToken(): Promise<string> {
  const t = getToken();
  if (!t) throw new Error('Not signed in');
  return t;
}

/** Computes a client-side SHA-256 hash using native Web Crypto with fallback. */
export async function hashPasswordOffline(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${password}`);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // fallback below
    }
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** List of accounts previously signed in on this device available for offline access. */
export function getOfflineAccounts(): OfflineAccount[] {
  try {
    const raw = localStorage.getItem(OFFLINE_ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getLastOfflineEmail(): string | null {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY);
  } catch {
    return null;
  }
}

/** Saves or updates an offline account profile and password hash on this device. */
export async function saveOfflineAccount(user: User, token: string, password?: string): Promise<void> {
  try {
    const accounts = getOfflineAccounts();
    const cleanEmail = user.email.toLowerCase().trim();
    let account = accounts.find((a) => a.email.toLowerCase().trim() === cleanEmail);

    let salt = account?.salt || crypto.randomUUID();
    let passwordHash = account?.passwordHash || '';

    if (password) {
      salt = crypto.randomUUID();
      passwordHash = await hashPasswordOffline(password, salt);
    }

    if (account) {
      account.id = user.id;
      account.name = user.name;
      account.role = user.role;
      account.token = token;
      account.user = user;
      account.salt = salt;
      account.passwordHash = passwordHash;
      account.lastLoginAt = new Date().toISOString();
    } else {
      account = {
        id: user.id,
        email: cleanEmail,
        name: user.name,
        role: user.role,
        token,
        user,
        salt,
        passwordHash,
        lastLoginAt: new Date().toISOString(),
      };
      accounts.push(account);
    }

    localStorage.setItem(OFFLINE_ACCOUNTS_KEY, JSON.stringify(accounts));
    localStorage.setItem(LAST_EMAIL_KEY, cleanEmail);
  } catch {
    // storage unavailable
  }
}

function syncOfflineUser(user: User): void {
  try {
    const token = getToken();
    if (!token) return;
    const accounts = getOfflineAccounts();
    const cleanEmail = user.email.toLowerCase().trim();
    const account = accounts.find((a) => a.email.toLowerCase().trim() === cleanEmail);
    if (account) {
      account.name = user.name;
      account.role = user.role;
      account.user = user;
      account.token = token;
      localStorage.setItem(OFFLINE_ACCOUNTS_KEY, JSON.stringify(accounts));
    }
  } catch {
    // storage unavailable
  }
}

/** Auto-seeds offline accounts from existing storage session if needed */
function autoSeedOfflineAccount(): void {
  try {
    const token = getToken();
    const user = getCachedUser();
    if (token && user && user.email) {
      const accounts = getOfflineAccounts();
      const cleanEmail = user.email.toLowerCase().trim();
      if (!accounts.some((a) => a.email.toLowerCase().trim() === cleanEmail)) {
        accounts.push({
          id: user.id,
          email: cleanEmail,
          name: user.name,
          role: user.role,
          token,
          user,
          salt: '',
          passwordHash: '',
          lastLoginAt: new Date().toISOString(),
        });
        localStorage.setItem(OFFLINE_ACCOUNTS_KEY, JSON.stringify(accounts));
      }
      if (!localStorage.getItem(LAST_EMAIL_KEY)) {
        localStorage.setItem(LAST_EMAIL_KEY, cleanEmail);
      }
    }
  } catch {
    // non-fatal
  }
}
autoSeedOfflineAccount();

export interface AvailableOfflineUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/** Returns all accounts available for offline login: both previously signed-in accounts and synced db.users. */
export async function getAllOfflineUsers(): Promise<AvailableOfflineUser[]> {
  const result: AvailableOfflineUser[] = [];
  const seenEmails = new Set<string>();

  // 1. Accounts previously signed in on this device
  for (const acc of getOfflineAccounts()) {
    const clean = acc.email.toLowerCase().trim();
    if (!seenEmails.has(clean)) {
      seenEmails.add(clean);
      result.push({
        id: acc.id,
        email: acc.email,
        name: acc.name || acc.email,
        role: acc.role || 'user',
      });
    }
  }

  // 2. All active users synchronized into Dexie db.users
  try {
    const dbUsers = await db.users.toArray();
    for (const u of dbUsers) {
      if (u.isActive === false) continue;
      const clean = u.email.toLowerCase().trim();
      if (!seenEmails.has(clean)) {
        seenEmails.add(clean);
        result.push({
          id: u.id,
          email: u.email,
          name: u.name || u.email,
          role: u.role || 'user',
        });
      }
    }
  } catch (e) {
    console.warn('[Auth] Error querying Dexie users:', e);
  }

  return result;
}

/** Validates credentials against locally stored offline accounts and synced database users. */
export async function tryOfflineLogin(
  email: string,
  password: string
): Promise<{ ok: boolean; reason?: 'not_found' | 'wrong_password' | 'invalid' }> {
  const cleanEmail = email.toLowerCase().trim();
  const accounts = getOfflineAccounts();
  const account = accounts.find((a) => a.email.toLowerCase().trim() === cleanEmail);

  // 1. Check existing cached account in localStorage
  if (account) {
    let passwordMatched = false;

    // Check custom offline password hash
    if (account.passwordHash && account.salt) {
      const inputHash = await hashPasswordOffline(password, account.salt);
      if (inputHash === account.passwordHash) {
        passwordMatched = true;
      }
    }

    // Check bcrypt hash stored on account.user
    if (!passwordMatched && account.user?.passwordHash) {
      try {
        if (await bcrypt.compare(password, account.user.passwordHash)) {
          passwordMatched = true;
        }
      } catch {
        // ignore
      }
    }

    // If account was seeded without password hash (allow initial setup)
    if (!passwordMatched && !account.passwordHash && !account.user?.passwordHash) {
      passwordMatched = password.length >= 6;
    }

    if (passwordMatched) {
      account.lastLoginAt = new Date().toISOString();
      if (password.length >= 6 && !account.passwordHash) {
        account.salt = crypto.randomUUID();
        account.passwordHash = await hashPasswordOffline(password, account.salt);
      }
      localStorage.setItem(OFFLINE_ACCOUNTS_KEY, JSON.stringify(accounts));
      localStorage.setItem(LAST_EMAIL_KEY, cleanEmail);
      setToken(account.token || `oz_offline_${account.id}_${Date.now()}`);
      if (account.user) {
        account.user.vesselIds = account.user.vesselIds ?? [];
      }
      setCachedUser(account.user);
      return { ok: true };
    }
  }

  // 2. Not in localStorage or password changed: Look up in local Dexie database (all synced users)
  try {
    const allUsers = await db.users.toArray();
    const dbUser = allUsers.find((u) => u.email.toLowerCase().trim() === cleanEmail);

    if (dbUser) {
      if (dbUser.isActive === false) {
        return { ok: false, reason: 'invalid' };
      }

      let passwordMatched = false;
      if (dbUser.passwordHash) {
        try {
          passwordMatched = await bcrypt.compare(password, dbUser.passwordHash);
        } catch {
          passwordMatched = false;
        }
      } else {
        // User exists in db.users but passwordHash hasn't synced yet (or password not set on server)
        passwordMatched = password.length >= 6;
      }

      if (passwordMatched) {
        const offlineToken = `oz_offline_${dbUser.id}_${Date.now()}`;
        const fullUser: User = {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          designation: dbUser.designation,
          role: dbUser.role,
          isActive: dbUser.isActive,
          vesselIds: dbUser.vesselIds ?? [],
        };
        await saveOfflineAccount(fullUser, offlineToken, password);
        setToken(offlineToken);
        setCachedUser(fullUser);
        localStorage.setItem(LAST_EMAIL_KEY, cleanEmail);
        return { ok: true };
      }

      return { ok: false, reason: 'wrong_password' };
    }
  } catch (err) {
    console.warn('[Auth] Error querying offline users from DB:', err);
  }

  if (account) {
    return { ok: false, reason: 'wrong_password' };
  }

  return { ok: false, reason: 'not_found' };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? 'Something went wrong');
  return json as T;
}

export async function login(email: string, password: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();

  // If online, attempt online login first
  if (navigator.onLine) {
    try {
      const { token } = await postJson<{ token: string }>('/auth/login', { email: cleanEmail, password });
      setToken(token);

      // Fetch user profile immediately and persist offline account with password hash
      try {
        const res = await fetch(`${BASE}/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const user = await res.json() as User;
          setCachedUser(user);
          await saveOfflineAccount(user, token, password);
        } else {
          const existing = getCachedUser();
          if (existing) await saveOfflineAccount(existing, token, password);
        }
      } catch {
        const existing = getCachedUser();
        if (existing) await saveOfflineAccount(existing, token, password);
      }
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // If server returned an explicit auth rejection (incorrect password or revoked access), don't fallback
      const isAuthRejection = msg.includes('Incorrect') || msg.includes('access has been removed') || msg.includes('UNAUTHORIZED') || msg.includes('FORBIDDEN');
      if (isAuthRejection) {
        throw err;
      }
      // If it failed because network dropped or server was unreachable, fall through to offline login
    }
  }

  // Device is offline or network request failed: authenticate against local offline account or synced users
  const offlineResult = await tryOfflineLogin(cleanEmail, password);
  if (offlineResult.ok) {
    return;
  }

  if (offlineResult.reason === 'wrong_password') {
    throw new Error('Incorrect password for offline access.');
  }

  if (offlineResult.reason === 'invalid') {
    throw new Error('This account has been deactivated.');
  }

  if (offlineResult.reason === 'not_found') {
    throw new Error('Account not found on this device. Please contact your administrator or wait until you are online.');
  }

  throw new Error('Offline sign-in failed. Please verify your credentials or connect to the internet.');
}

export async function requestReset(email: string): Promise<void> {
  await postJson('/auth/request-reset', { email });
}
export async function resetPassword(resetToken: string, password: string): Promise<void> {
  const { token } = await postJson<{ token: string }>('/auth/reset-password', { token: resetToken, password });
  setToken(token);
}

/** Signs out: clears the JWT and user session, but preserves the offline database and cached accounts. */
export function logout(): void {
  setToken(null);
  setCachedUser(null);
  import('../main').then(({ queryClient }) => {
    queryClient.clear();
  }).catch(() => {/* non-fatal */});
  window.location.href = '/';
}
