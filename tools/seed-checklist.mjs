// One-off: load db/seed/default-checklist.json into template_sections/template_questions.
// Usage: PG_HOST=... PG_DB=... PG_USER=... PG_PASSWORD=... node tools/seed-checklist.mjs
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, '..', 'db', 'seed', 'default-checklist.json'), 'utf8'));

const pool = new pg.Pool({
  host: process.env.PG_HOST, database: process.env.PG_DB, user: process.env.PG_USER,
  password: process.env.PG_PASSWORD, port: Number(process.env.PG_PORT ?? 5432),
  ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: true },
});

const client = await pool.connect();
try {
  await client.query('begin');
  let sections = 0, questions = 0;
  for (const s of data.sections) {
    const sec = (await client.query(
      `insert into template_sections (sr, zone, name, position, photo_only)
       values ($1,$2,$3,$4,$5)
       on conflict (sr) do update set zone = excluded.zone, name = excluded.name, position = excluded.position, photo_only = excluded.photo_only
       returning id`,
      [s.sr, s.zone, s.name, s.position, s.photoOnly ?? false])).rows[0];
    sections++;
    for (const q of s.questions) {
      await client.query(
        `insert into template_questions (section_id, qid, ref, text, position)
         values ($1,$2,$3,$4,$5)
         on conflict (section_id, qid) do update set ref = excluded.ref, text = excluded.text, position = excluded.position`,
        [sec.id, q.qid, q.ref, q.text, q.position]);
      questions++;
    }
  }
  await client.query('commit');
  console.log(`Seeded ${sections} sections, ${questions} questions.`);
} catch (e) {
  await client.query('rollback');
  throw e;
} finally {
  client.release();
  await pool.end();
}
