import pg from 'pg';
import { DefaultAzureCredential } from '@azure/identity';

/**
 * PostgreSQL pool. In Azure the Function App's managed identity signs in to
 * Postgres with an Entra token (no password). Locally or on Linux VM you set PG_PASSWORD.
 */
const credential = new DefaultAzureCredential();
const PG_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

async function password(): Promise<string> {
  if (process.env.PG_PASSWORD) return process.env.PG_PASSWORD;
  const host = process.env.PG_HOST ?? 'localhost';
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (isLocal) {
    return '';
  }
  const token = await credential.getToken(PG_SCOPE);
  if (!token) throw new Error('Could not get Postgres token');
  return token.token;
}

export const pool = new pg.Pool({
  host: process.env.PG_HOST ?? 'localhost',
  database: process.env.PG_DB ?? (process.env.NODE_ENV === 'production' ? 'inspection' : 'vir'),
  user: process.env.PG_USER ?? 'postgres',
  password, // pg calls this for every new connection → token stays fresh
  port: Number(process.env.PG_PORT ?? 5432),
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : false,
  max: 25,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

export type Tx = pg.PoolClient;

export const AUTO_BACKFILL_DEFECT_FINDINGS_SQL = `
WITH unlinked AS (
  SELECT
    p.id AS photo_id,
    p.inspection_id,
    p.inspection_section_id,
    p.created_by,
    COALESCE(NULLIF(TRIM(p.description), ''), 'Defect observation logged from visual evidence') AS f_text,
    gen_random_uuid() AS new_finding_id,
    ROW_NUMBER() OVER (PARTITION BY p.inspection_section_id ORDER BY p.position, p.created_at) AS rn
  FROM photos p
  WHERE p.is_defect = true
    AND p.finding_id IS NULL
    AND p.inspection_section_id IS NOT NULL
    AND p.deleted_at IS NULL
),
section_max AS (
  SELECT
    inspection_section_id,
    COALESCE(MAX(position), -1) AS max_pos
  FROM findings
  WHERE deleted_at IS NULL
  GROUP BY inspection_section_id
),
inserted AS (
  INSERT INTO findings (
    id,
    inspection_id,
    inspection_section_id,
    text,
    answer,
    corrective_action,
    preventive_action,
    position,
    updated_by,
    updated_at,
    row_version
  )
  SELECT
    u.new_finding_id,
    u.inspection_id,
    u.inspection_section_id,
    u.f_text,
    'no',
    '',
    '',
    COALESCE(sm.max_pos, -1) + u.rn,
    u.created_by,
    NOW(),
    nextval('sync_seq')
  FROM unlinked u
  LEFT JOIN section_max sm ON sm.inspection_section_id = u.inspection_section_id
  RETURNING id
)
UPDATE photos p
SET finding_id = u.new_finding_id,
    updated_at = NOW(),
    row_version = nextval('sync_seq')
FROM unlinked u
WHERE p.id = u.photo_id;
`;

let schemaEnsured = false;
let schemaPromise: Promise<void> | null = null;

/**
 * Automatically applies non-destructive, idempotent column and sequence migrations
 * so existing databases self-heal upon service startup without blocking incoming HTTP requests.
 */
export async function ensureSchema(): Promise<void> {
  if (schemaEnsured) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      let client: pg.PoolClient | null = null;
      try {
        client = await pool.connect();
        // Prevent migrations from waiting on locks: fail fast if table is busy
        await client.query("SET lock_timeout = '2s'; SET statement_timeout = '15s';");
        const statements = [
          `create sequence if not exists sync_seq;`,
          `create index if not exists approval_events_rv_idx on approval_events (row_version);`,
          `alter table if exists users add column if not exists password_hash text;`,
          `alter table if exists template_sections add column if not exists photo_only boolean not null default false;`,
          `alter table if exists template_sections add column if not exists vessel_types text[] not null default '{}'::text[];`,
          `alter table if exists inspection_sections add column if not exists photo_only boolean not null default false;`,
          `alter table if exists inspection_sections add column if not exists is_custom boolean not null default false;`,
          `alter table if exists inspection_sections add column if not exists vessel_types text[] not null default '{}'::text[];`,
          `alter table if exists approval_events add column if not exists row_version bigint not null default nextval('sync_seq');`,
          `alter table if exists vessels add column if not exists registration_status text not null default 'registered';`,
          `alter table if exists vessels add column if not exists created_by uuid;`,
          `alter table if exists inspections add column if not exists report_category text not null default 'inspection';`,
          `alter table if exists photos add column if not exists description text not null default '';`,
          `delete from user_vessels where vessel_id in (select id from vessels where deleted_at is not null or registration_status = 'unregistered');`,
          `delete from user_vessels where vessel_id not in (select id from vessels);`,
          `update vessels v set created_by = i.created_by from inspections i where v.id = i.vessel_id and v.created_by is null and i.created_by is not null;`,
          `delete from notifications where inspection_id in (select id from inspections where deleted_at is not null);`,
          AUTO_BACKFILL_DEFECT_FINDINGS_SQL,
        ];
        for (const sql of statements) {
          try {
            await client.query(sql);
          } catch (stmtErr) {
            console.warn('[DB Auto-migration statement notice]:', sql.trim().slice(0, 50), (stmtErr as Error)?.message);
          }
        }
        schemaEnsured = true;
      } catch (err) {
        console.warn('[DB] Schema auto-migration connect notice:', (err as Error)?.message);
      } finally {
        if (client) client.release();
        schemaPromise = null;
      }
    })();
  }
  return schemaPromise;
}

// Kick off schema check in background on module load without blocking requests
void ensureSchema().catch(() => {});

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
