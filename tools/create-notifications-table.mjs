import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:sujil123@localhost:5432/vir',
});

async function main() {
  const sql = `
    create table if not exists notifications (
      id            uuid primary key default gen_random_uuid(),
      user_id       uuid not null references users(id) on delete cascade,
      inspection_id uuid references inspections(id) on delete cascade,
      type          text not null,
      title         text not null,
      message       text not null,
      link          text not null default '',
      read          boolean not null default false,
      created_at    timestamptz not null default now()
    );
    create index if not exists notifications_user_idx on notifications (user_id, read, created_at desc);
  `;

  await pool.query(sql);
  console.log('Successfully created notifications table and index.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
