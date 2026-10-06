import { apiToken, logout } from '../auth/session';

const BASE = (import.meta.env.VITE_API_BASE as string) ?? '/api';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Typed fetch to the Azure Functions API with the signed-in user's access token. */


export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await apiToken();
  
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || (res.status === 403 && (json?.error?.code === 'FORBIDDEN' || json?.error?.message?.includes('access')))) {
      logout(); // expired/invalid token or removed user: drop back to sign-in screen
    }
    throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? res.statusText);
  }
  return json as T;
}
