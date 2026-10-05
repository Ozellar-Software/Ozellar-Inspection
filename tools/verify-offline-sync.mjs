import pg from 'pg';
import { randomUUID } from 'node:crypto';

// Load .env
try { process.loadEnvFile('backend/.env'); } catch { }

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  database: process.env.PG_DB || 'vir',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'sujil123',
  port: Number(process.env.PG_PORT || 5432),
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

async function verifySync() {
  console.log('=== Verifying PostgreSQL & Offline Sync Engine ===\n');
  const client = await pool.connect();
  let passCount = 0;
  const ok = (msg) => { console.log(`  ✓ ${msg}`); passCount++; };

  try {
    // 1. Check sync_seq
    const seq = await client.query(`select last_value, is_called from sync_seq`);
    ok(`sync_seq sequence exists and active (current version: ${seq.rows[0].last_value})`);

    // 2. Check row_version trigger on tables
    const tables = ['users', 'vessels', 'inspections', 'inspection_sections', 'inspection_questions', 'responses', 'findings', 'photos', 'approvals'];
    for (const t of tables) {
      const trg = await client.query(`
        select tgname from pg_trigger
        where tgrelid = $1::regclass and tgname = 'trg_touch' and not tgisinternal
      `, [t]);
      if (trg.rows.length === 0) throw new Error(`Missing trg_touch trigger on ${t}`);
    }
    ok(`All ${tables.length} sync tables have touch_row trigger active`);

    // 3. Test row_version bump on insert/update
    const testVesselId = randomUUID();
    const v1 = await client.query(`
      insert into vessels (id, name, imo, vessel_type)
      values ($1, 'Sync Test Vessel', '9999999', 'Test')
      returning row_version
    `, [testVesselId]);
    const rv1 = BigInt(v1.rows[0].row_version);
    ok(`Vessel created offline/online with row_version ${rv1}`);

    const v2 = await client.query(`
      update vessels set imo = '9999998' where id = $1
      returning row_version
    `, [testVesselId]);
    const rv2 = BigInt(v2.rows[0].row_version);
    if (rv2 <= rv1) throw new Error(`row_version did not advance on update! (was ${rv1}, now ${rv2})`);
    ok(`Updating vessel advanced row_version from ${rv1} -> ${rv2}`);

    // 4. Test cursor pull query
    const pullTest = await client.query(`
      select 'vessels' as entity, id::text, row_version
      from vessels
      where row_version > $1
      order by row_version limit 10
    `, [rv1.toString()]);
    if (!pullTest.rows.some(r => r.id === testVesselId)) {
      throw new Error(`Sync pull did not find updated vessel above cursor ${rv1}`);
    }
    ok(`Sync pull cursor query correctly identified updated row`);

    // 5. Test sync_mutations table
    const mutId = randomUUID();
    const testUserId = (await client.query(`select id from users limit 1`)).rows[0]?.id;
    if (testUserId) {
      await client.query(`
        insert into sync_mutations (id, user_id, device_id)
        values ($1, $2, 'test-device-uuid')
      `, [mutId, testUserId]);
      const mutCheck = await client.query(`select id from sync_mutations where id = $1`, [mutId]);
      if (mutCheck.rows.length === 1) {
        ok(`sync_mutations idempotency journal works`);
      }
      await client.query(`delete from sync_mutations where id = $1`, [mutId]);
    }

    // Clean up test vessel
    await client.query(`delete from vessels where id = $1`, [testVesselId]);
    ok(`Test vessel cleaned up`);

    console.log(`\n🎉 All ${passCount} Offline Sync checks passed with PostgreSQL!`);
  } catch (err) {
    console.error('Sync verification failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

verifySync();
