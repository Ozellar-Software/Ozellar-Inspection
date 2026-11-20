// Combines the two tank sections
//   "Bunker, Ballast and Fresh Water Tanks"   (BF-1, BF-3, BF-5)   <- survives
//   "Ballast/Fuel/Fresh Water Tank"           (BF-2)                <- folded into it
// into ONE section, without losing data: the second section's question moves into the first together with its
// response, photos, findings and section remarks, and the second section is soft-deleted (the rows stay).
// Sections are matched BY NAME, so every template set (Universal, Bulk Carrier, ...) and every inspection is handled,
// whatever template_sr numbers they carry.
//
//   node tools/migrate-combine-tank-sections.mjs            # DRY RUN: does everything, prints a report, then ROLLS BACK
//   node tools/migrate-combine-tank-sections.mjs --apply    # same, but COMMITS
//
// Connection: PG_HOST / PG_PORT / PG_DB / PG_USER / PG_PASSWORD (PG_SSL=true for TLS), else backend/.env,
// else backend/local.settings.json. Safe to re-run: once the second section is gone there is nothing left to do.
// Do NOT re-run tools/seed-checklist.mjs afterwards: db/seed/default-checklist.json numbers these sections differently.
import pg from 'pg';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadConfig() {
  const env = { ...process.env };
  if (!env.PG_DB) {
    const dotenv = join(root, 'backend', '.env');
    const settings = join(root, 'backend', 'local.settings.json');
    if (existsSync(dotenv)) {
      for (const line of readFileSync(dotenv, 'utf8').split(/\r?\n/)) {
        const m = /^\s*(PG_[A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
    if (!env.PG_DB && existsSync(settings)) {
      const v = JSON.parse(readFileSync(settings, 'utf8')).Values ?? {};
      for (const k of ['PG_HOST', 'PG_PORT', 'PG_DB', 'PG_USER', 'PG_PASSWORD', 'PG_SSL']) if (v[k] && !env[k]) env[k] = v[k];
    }
  }
  if (!env.PG_DB || !env.PG_USER) throw new Error('Database settings not found (set PG_HOST/PG_DB/PG_USER/PG_PASSWORD)');
  return env;
}

const cfg = loadConfig();
const pool = new pg.Pool({
  host: cfg.PG_HOST || 'localhost', port: Number(cfg.PG_PORT || 5432), database: cfg.PG_DB,
  user: cfg.PG_USER, password: cfg.PG_PASSWORD, ssl: cfg.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const KEEP_NAME = 'Bunker, Ballast and Fresh Water Tanks';   // section that survives
const DROP_NAME = 'Ballast/Fuel/Fresh Water Tank';            // section folded into it
const count = async (c, sql, args) => Number((await c.query(sql, args)).rows[0].n);

const client = await pool.connect();
const report = { template: '', inspections: 0, skipped: 0, questionsMoved: 0, responsesKept: 0, photosMoved: 0, findingsMoved: 0, naAligned: 0, remarksMerged: 0 };
try {
  console.log(`Database: ${cfg.PG_DB}   Mode: ${APPLY ? 'APPLY (will commit)' : 'DRY RUN (will roll back)'}\n`);
  await client.query('begin');

  const haveCols = await count(client,
    `select count(*) n from information_schema.columns where table_name = 'inspection_sections' and column_name in ('remarks', 'applicable')`);
  if (haveCols < 2) throw new Error('inspection_sections is missing the remarks/applicable columns: apply db/schema.sql first');

  // ── 1. Template (one pair per template set / vessel-type group) ──────────────────────────────────────
  const tpl = (await client.query(
    `select id, sr, name, vessel_types::text vt from template_sections where name = any($1) and deleted_at is null order by sr`, [[KEEP_NAME, DROP_NAME]])).rows;
  const groups = new Map();
  for (const s of tpl) {
    const g = groups.get(s.vt) ?? {};
    if (s.name === KEEP_NAME) g.keep = s; else g.drop = s;
    groups.set(s.vt, g);
  }
  const tplLines = [];
  for (const [vt, g] of groups) {
    if (!g.keep || !g.drop) { tplLines.push(`  ${vt}: nothing to do (only one of the two sections exists)`); continue; }
    const moved = (await client.query(
      `select id from template_questions where section_id = $1 and deleted_at is null order by position`, [g.drop.id])).rows;
    let { qid, pos } = (await client.query(
      `select coalesce(max(qid), -1) qid, coalesce(max(position), -1) pos from template_questions where section_id = $1`, [g.keep.id])).rows[0];
    for (const q of moved) {
      await client.query(
        `update template_questions set section_id = $1, qid = $2, position = $3, updated_at = now(), row_version = nextval('sync_seq') where id = $4`,
        [g.keep.id, ++qid, ++pos, q.id]);
    }
    await client.query(`update template_sections set deleted_at = now(), updated_at = now(), row_version = nextval('sync_seq') where id = $1`, [g.drop.id]);
    tplLines.push(`  ${vt}: moved ${moved.length} question(s) (sr ${g.drop.sr} -> sr ${g.keep.sr}); sr ${g.drop.sr} soft-deleted`);
  }
  report.template = tplLines.length ? '\n' + tplLines.join('\n') : 'no template sections found';

  // ── 2. Existing inspections ───────────────────────────────────────────────
  const pairs = (await client.query(
    `select a.inspection_id, a.id keep_id, a.remarks keep_remarks, a.applicable keep_applicable,
            b.id drop_id, b.remarks drop_remarks, b.applicable drop_applicable
       from inspection_sections a
       join inspection_sections b on b.inspection_id = a.inspection_id
      where a.name = $1 and b.name = $2 and a.deleted_at is null and b.deleted_at is null`, [KEEP_NAME, DROP_NAME])).rows;
  const orphans = await count(client,
    `select count(*) n from inspection_sections b where b.name = $1 and b.deleted_at is null
        and not exists (select 1 from inspection_sections a where a.inspection_id = b.inspection_id and a.name = $2 and a.deleted_at is null)`, [DROP_NAME, KEEP_NAME]);
  report.skipped = orphans;
  // An inspection with duplicate copies of either section would pair up ambiguously: leave those alone and report them.
  const perInspection = new Map();
  for (const p of pairs) perInspection.set(p.inspection_id, (perInspection.get(p.inspection_id) ?? 0) + 1);
  const ambiguous = [...perInspection.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (ambiguous.length) {
    console.log(`Skipping ${ambiguous.length} inspection(s) with duplicate copies of these sections: ${ambiguous.join(', ')}`);
    for (let i = pairs.length - 1; i >= 0; i--) if (ambiguous.includes(pairs[i].inspection_id)) pairs.splice(i, 1);
  }

  for (const p of pairs) {
    const before = {
      q: await count(client, `select count(*) n from inspection_questions where inspection_section_id = any($1)`, [[p.keep_id, p.drop_id]]),
      r: await count(client, `select count(*) n from responses r join inspection_questions q on q.id = r.inspection_question_id where q.inspection_section_id = any($1)`, [[p.keep_id, p.drop_id]]),
      ph: await count(client, `select count(*) n from photos where inspection_section_id = any($1)`, [[p.keep_id, p.drop_id]]),
      f: await count(client, `select count(*) n from findings where inspection_section_id = any($1)`, [[p.keep_id, p.drop_id]]),
    };

    // Section-level "Mark N/A": if the two sections disagree, write the N/A onto the questions of the N/A side so the
    // merged section (applicable) shows each question exactly as before.
    if (p.keep_applicable !== p.drop_applicable) {
      const naSection = p.keep_applicable ? p.drop_id : p.keep_id;
      const qs = (await client.query(`select id from inspection_questions where inspection_section_id = $1`, [naSection])).rows;
      for (const q of qs) {
        const upd = await client.query(
          `update responses set applicable = false, updated_at = now(), row_version = nextval('sync_seq') where inspection_question_id = $1`, [q.id]);
        if (!upd.rowCount) {
          await client.query(
            `insert into responses (id, inspection_id, inspection_question_id, applicable, updated_at, row_version)
             values (gen_random_uuid(), $1, $2, false, now(), nextval('sync_seq'))`, [p.inspection_id, q.id]);
        }
        report.naAligned++;
      }
    }

    // Questions (their responses and question photos follow automatically: they point at the question / response)
    const moved = (await client.query(`select id from inspection_questions where inspection_section_id = $1 order by position`, [p.drop_id])).rows;
    let { qid, pos } = (await client.query(
      `select coalesce(max(qid), 0) qid, coalesce(max(position), -1) pos from inspection_questions where inspection_section_id = $1`, [p.keep_id])).rows[0];
    for (const q of moved) {
      await client.query(
        `update inspection_questions set inspection_section_id = $1, qid = $2, position = $3, updated_at = now(), row_version = nextval('sync_seq') where id = $4`,
        [p.keep_id, ++qid, ++pos, q.id]);
    }
    report.questionsMoved += moved.length;

    // Findings (observations) and photos attached to the old section
    const fOffset = (await client.query(`select coalesce(max(position), -1) + 1 off from findings where inspection_section_id = $1`, [p.keep_id])).rows[0].off;
    report.findingsMoved += (await client.query(
      `update findings set inspection_section_id = $1, position = position + $2, updated_at = now(), row_version = nextval('sync_seq')
        where inspection_section_id = $3`, [p.keep_id, fOffset, p.drop_id])).rowCount;
    report.photosMoved += (await client.query(
      `update photos set inspection_section_id = $1, updated_at = now(), row_version = nextval('sync_seq')
        where inspection_section_id = $2`, [p.keep_id, p.drop_id])).rowCount;

    // Section remarks: keep both
    const dropRemarks = (p.drop_remarks ?? '').trim();
    const merged = dropRemarks ? [(p.keep_remarks ?? '').trim(), dropRemarks].filter(Boolean).join('\n\n') : p.keep_remarks;
    if (dropRemarks) report.remarksMerged++;
    await client.query(`update inspection_sections set remarks = $2, applicable = true, updated_at = now(), row_version = nextval('sync_seq') where id = $1`, [p.keep_id, merged ?? '']);

    // Soft-delete the emptied section (row kept)
    await client.query(`update inspection_sections set deleted_at = now(), updated_at = now(), row_version = nextval('sync_seq') where id = $1`, [p.drop_id]);

    // Reconcile: nothing may be lost
    const after = {
      q: await count(client, `select count(*) n from inspection_questions where inspection_section_id = $1`, [p.keep_id]),
      r: await count(client, `select count(*) n from responses r join inspection_questions q on q.id = r.inspection_question_id where q.inspection_section_id = $1`, [p.keep_id]),
      ph: await count(client, `select count(*) n from photos where inspection_section_id = $1`, [p.keep_id]),
      f: await count(client, `select count(*) n from findings where inspection_section_id = $1`, [p.keep_id]),
    };
    // responses can only grow (N/A alignment adds rows); everything else must match exactly
    if (after.q !== before.q || after.ph !== before.ph || after.f !== before.f || after.r < before.r) {
      throw new Error(`Reconciliation failed for inspection ${p.inspection_id}: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
    }
    report.responsesKept += before.r;
    report.inspections++;
  }

  console.log('Template      :', report.template);
  console.log(`Inspections   : ${report.inspections} merged, ${report.skipped} had only one of the two sections (left untouched)`);
  console.log(`Moved         : ${report.questionsMoved} question(s), ${report.findingsMoved} finding(s), ${report.photosMoved} photo link(s)`);
  console.log(`Responses kept: ${report.responsesKept}   N/A aligned: ${report.naAligned}   Remarks merged: ${report.remarksMerged}`);

  if (APPLY) { await client.query('commit'); console.log('\nCOMMITTED.'); }
  else { await client.query('rollback'); console.log('\nDRY RUN: rolled back, nothing was changed. Re-run with --apply to commit.'); }
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error('\nFAILED, rolled back:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
