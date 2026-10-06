import pg from 'pg';
import bcrypt from 'bcryptjs';

const client = new pg.Client({
  host: process.env.PG_HOST || 'localhost',
  database: process.env.PG_DB || 'vir',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'sujil123',
  port: 5432,
});

async function main() {
  await client.connect();
  const hash = await bcrypt.hash('Ozellar@123', 12);

  // Set password for all existing users
  const res = await client.query('UPDATE users SET password_hash = $1', [hash]);
  console.log(`Updated ${res.rowCount} users with password Ozellar@123`);

  // Ensure admin@ozellar.com exists
  const check = await client.query("SELECT id FROM users WHERE lower(email) = 'admin@ozellar.com'");
  if (check.rows.length === 0) {
    await client.query(
      `INSERT INTO users (id, email, name, designation, role, is_active, password_hash)
       VALUES (gen_random_uuid(), 'admin@ozellar.com', 'Admin User', 'Administrator', 'admin', true, $1)`,
      [hash]
    );
    console.log('Created user admin@ozellar.com with password Ozellar@123');
  } else {
    console.log('admin@ozellar.com already exists.');
  }

  const users = await client.query('SELECT id, email, name, role, is_active FROM users');
  console.log('Current users:', users.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
