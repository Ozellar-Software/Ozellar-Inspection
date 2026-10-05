const TOKEN_KEY = 'oz_token';
const BASE = (import.meta.env.VITE_API_BASE as string) ?? '/api';

type Listener = () => void;
let listeners: Listener[] = [];
const notify = () => listeners.forEach((l) => l());

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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? 'Something went wrong');
  return json as T;
}

export async function login(email: string, password: string): Promise<void> {
  const { token } = await postJson<{ token: string }>('/auth/login', { email, password });
  setToken(token);
}
export async function requestReset(email: string): Promise<void> {
  await postJson('/auth/request-reset', { email });
}
export async function resetPassword(resetToken: string, password: string): Promise<void> {
  const { token } = await postJson<{ token: string }>('/auth/reset-password', { token: resetToken, password });
  setToken(token);
}

/** Signs out: clears the JWT, wipes the React Query cache (so old user's data doesn't show on next login),
 *  and clears the local Dexie sync store (vessel/inspection data is user-scoped). */
export function logout(): void {
  setToken(null);
  // Lazy-import to avoid circular deps (main.tsx imports session.ts indirectly)
  import('../main').then(({ queryClient }) => {
    queryClient.clear();
  }).catch(() => {/* non-fatal */});
  // Wipe the local offline DB so the next user starts fresh
  import('../offline/db').then(({ clearAllData }) => {
    void clearAllData().finally(() => {
      window.location.href = '/';
    });
  }).catch(() => {
    window.location.href = '/';
  });
}
