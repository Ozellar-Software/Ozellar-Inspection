import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

export type ErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'LOCKED' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

export class HttpError extends Error {
  constructor(public status: number, public code: ErrorCode, message: string) { super(message); }
}

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401, FORBIDDEN: 403, LOCKED: 409, VALIDATION: 400, NOT_FOUND: 404, CONFLICT: 409, INTERNAL: 500,
};
export const fail = (code: ErrorCode, message: string) => new HttpError(STATUS[code], code, message);

function corsHeaders(req: HttpRequest): Record<string, string> {
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin') ?? '';
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

/** Wraps a handler: CORS, JSON body, error mapping, timing log. */
export function handler(
  fn: (req: HttpRequest, ctx: InvocationContext) => Promise<unknown>,
): (req: HttpRequest, ctx: InvocationContext) => Promise<HttpResponseInit> {
  return async (req, ctx) => {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return { status: 204, headers: cors };
    const started = Date.now();
    try {
      const body = await fn(req, ctx);
      return { status: 200, jsonBody: body ?? { ok: true }, headers: cors };
    } catch (e) {
      const err = e instanceof HttpError ? e
        : (e as { code?: string })?.code === 'FORBIDDEN' || (e as { code?: string })?.code === 'VALIDATION' || (e as { code?: string })?.code === 'INVALID_STATE'
          ? mapDomainError(e as { code: string; message: string })
          : null;
      if (!err) ctx.error('Unhandled error', e);
      const out = err ?? new HttpError(500, 'INTERNAL', 'Something went wrong');
      return { status: out.status, jsonBody: { error: { code: out.code, message: out.message } }, headers: cors };
    } finally {
      ctx.log(`${req.method} ${new URL(req.url).pathname} ${Date.now() - started}ms`);
    }
  };
}

function mapDomainError(e: { code: string; message: string }): HttpError {
  if (e.code === 'FORBIDDEN') return fail('FORBIDDEN', e.message);
  if (e.code === 'INVALID_STATE') return fail('LOCKED', e.message);
  return fail('VALIDATION', e.message);
}

export async function jsonBody<T>(req: HttpRequest): Promise<T> {
  try { return (await req.json()) as T; } catch { throw fail('VALIDATION', 'Invalid JSON body'); }
}

/** snake_case DB row -> camelCase API object */
export function camel<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  return out as T;
}
export const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
