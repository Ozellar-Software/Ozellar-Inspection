import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  database: process.env.PG_DB || 'vir',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'sujil123',
  port: Number(process.env.PG_PORT || 5432),
  ssl: false,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("ALTER TABLE template_sections ADD COLUMN IF NOT EXISTS vessel_types text[] not null default '{}'::text[]");
    await client.query("ALTER TABLE inspection_sections ADD COLUMN IF NOT EXISTS vessel_types text[] not null default '{}'::text[]");
    await client.query('COMMIT');
    console.log('Migration completed successfully: vessel_types added to template_sections and inspection_sections.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
