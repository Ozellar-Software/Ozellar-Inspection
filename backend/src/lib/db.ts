import pg from 'pg';
import { DefaultAzureCredential } from '@azure/identity';

/**
 * PostgreSQL pool. In Azure the Function App's managed identity signs in to
 * Postgres with an Entra token (no password). Locally you can set PG_PASSWORD.
 */
const credential = new DefaultAzureCredential();
const PG_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

async function password(): Promise<string> {
  if (process.env.PG_PASSWORD) return process.env.PG_PASSWORD;
  const token = await credential.getToken(PG_SCOPE);
  if (!token) throw new Error('Could not get Postgres token');
  return token.token;
}

export const pool = new pg.Pool({
  host: process.env.PG_HOST,
  database: process.env.PG_DB ?? 'vir',
  user: process.env.PG_USER,
  password, // pg calls this for every new connection → token stays fresh
  port: Number(process.env.PG_PORT ?? 5432),
  ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: true },
  max: 5,
  idleTimeoutMillis: 30_000,
});

export type Tx = pg.PoolClient;

/** Run fn inside a transaction. */
export async function tx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export async function one<T = Record<string, unknown>>(c: Tx | pg.Pool, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await c.query(sql, params);
  return (r.rows[0] as T) ?? null;
}
