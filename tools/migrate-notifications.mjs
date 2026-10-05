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
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        inspection_id uuid REFERENCES inspections(id) ON DELETE CASCADE,
        type          text NOT NULL,
        title         text NOT NULL,
        message       text NOT NULL,
        link          text NOT NULL DEFAULT '',
        read          boolean NOT NULL DEFAULT false,
        created_at    timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read, created_at DESC);
    `);
    await client.query('COMMIT');
    console.log('Migration completed successfully: notifications table created.');
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
