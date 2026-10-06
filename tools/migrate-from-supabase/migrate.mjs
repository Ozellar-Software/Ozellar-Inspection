// Migrates the old Supabase export (records + user_roles CSVs) into the new Postgres schema.
//
//   node --max-old-space-size=4096 tools/migrate-from-supabase/migrate.mjs --records <records.csv> --roles <user_roles.csv>
//        [--apply] [--alias "Old name=Vessel name"] [--out <photos dir>] [--settings backend/local.settings.json]
//
// Default is a DRY RUN: it parses everything, prints what it would create and any problems, and writes nothing.
// With --apply it loads Postgres (one transaction per inspection, safe to re-run: ids are derived from the old ids)
// and writes the decoded photos to <out>/<blob_path> so they can be bulk-uploaded to Blob Storage later.
// Mapping: docs-reference/docs/06-data-model.md ("Current -> target mapping").
import pg from 'pg';
import { createHash } from 'node:crypto';
import { openSync, readSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

/* ------------------------------------------------------------------ args */
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const APPLY = argv.includes('--apply');
const RECORDS = arg('records');
// --alias "Herculas=AMNS Hercules" links inspections saved under a misspelt vessel name to the real vessel (repeatable)
const ALIASES = new Map(argv.flatMap((a, i) => (a === '--alias' && argv[i + 1]?.includes('=') ? [argv[i + 1].split('=').map((x) => x.trim().toLowerCase())] : [])));
const ROLES = arg('roles');
const OUT = resolve(arg('out', join(__dirname, 'out')));
if (!RECORDS || !ROLES) { console.error('Usage: node migrate.mjs --records <records.csv> --roles <user_roles.csv> [--apply]'); process.exit(1); }

/* ------------------------------------------------------------------ CSV (streaming; the export is >150 MB) */
function readCsv(path, onRow) {
  const fd = openSync(path, 'r');
  const dec = new StringDecoder('utf8');
  const buf = Buffer.alloc(4 * 1024 * 1024);
  let header = null, row = [], parts = [], q = false, pendingQuote = false;
  const endRow = () => {
    const r = row; row = [];
    if (r.length < 2) return;
    if (!header) { header = r; return; }
    onRow(Object.fromEntries(header.map((h, i) => [h, r[i]])));
  };
  const feed = (text) => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (pendingQuote) { pendingQuote = false; if (ch === '"') { parts.push('"'); continue; } q = false; }
      if (q) { if (ch === '"') pendingQuote = true; else parts.push(ch); continue; }
      if (ch === '"') q = true;
      else if (ch === ',') { row.push(parts.join('')); parts = []; }
      else if (ch === '\n' || ch === '\r') { if (parts.length || row.length) { row.push(parts.join('')); parts = []; endRow(); } }
      else parts.push(ch);
    }
  };
  let n;
  while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) feed(dec.write(buf.subarray(0, n)));
  feed(dec.end());
  if (parts.length || row.length) { row.push(parts.join('')); endRow(); }
}

/* ------------------------------------------------------------------ helpers */
const uuid = (...p) => {
  const h = createHash('sha1').update('ozellar-migrate:' + p.join('|')).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};
const iso = (ms) => (ms && Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : null);
const dateOnly = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const yn = (v) => (v === 'yes' || v === 'no' ? v : null);
const lc = (s) => str(s).trim().toLowerCase();
const PARTICULARS = ['flag', 'portOfRegistry', 'callSign', 'officialNo', 'yearBuilt', 'placeOfBuild', 'classSociety', 'classNotation',
  'grossTonnage', 'netTonnage', 'deadweight', 'loa', 'breadth', 'depth', 'summerDraft', 'mainEngine', 'mainEngineMakerModel',
  'mainEnginePower', 'propulsion', 'owner', 'managerOperator', 'email', 'satellitePhone'];

const warnings = [];
const warn = (m) => warnings.push(m);

/* ------------------------------------------------------------------ 1. read the export */
console.log(`Reading ${RECORDS} …`);
const latest = new Map(); // `${store}\0${key}` -> newest row across all users
let rawRows = 0;
readCsv(RECORDS, (o) => {
  rawRows++;
  const k = `${o.store}\0${o.key}`;
  const ts = Number(o.updated_at) || 0;
  const cur = latest.get(k);
  if (!cur || ts >= cur.ts) latest.set(k, { ts, deleted: o.deleted === 'true', data: o.data, store: o.store, key: o.key });
});
const stores = {};
let tombstones = 0;
for (const r of latest.values()) {
  if (r.deleted) { tombstones++; continue; }
  let d;
  try { d = JSON.parse(r.data); } catch { warn(`Unparseable JSON in ${r.store}/${r.key} — skipped`); continue; }
  if (d == null || typeof d !== 'object') continue;
  (stores[r.store] ??= []).push({ key: r.key, d });
}
latest.clear();
console.log(`  ${rawRows} rows -> ${Object.entries(stores).map(([s, a]) => `${a.length} ${s}`).join(', ')} (${tombstones} deleted dropped)`);

const roles = [];
readCsv(ROLES, (o) => roles.push(o));

/* ------------------------------------------------------------------ 2. photo blobs */
const blobStore = new Map();
for (const { key, d } of stores.blobs ?? []) if (d.b64) blobStore.set(key, { b64: d.b64, type: d.type || 'image/jpeg' });

function resolveBlob(p) {
  const b = p?.blob;
  if (b?.__sbBlob && b.b64) return { b64: b.b64, type: b.type || 'image/jpeg' };
  if (b?.__sbBlobRef) return blobStore.get(b.__sbBlobRef) ?? null;
  const m = /^data:([^;]+);base64,(.*)$/s.exec(p?.__dataUrl ?? '');
  return m ? { b64: m[2], type: m[1] } : null;
}

/* ------------------------------------------------------------------ 3. build the plan (pure — no DB) */
const plan = {
  users: roles.map((r) => ({
    email: lc(r.email), name: str(r.name), designation: str(r.designation), role: r.role,
    fleet: (() => { try { return JSON.parse(r.fleet || '[]'); } catch { return []; } })(),
  })),
  template: [],
  vessels: [],
  inspections: [],
};
const userEmails = new Set(plan.users.map((u) => u.email));
const VALID_ROLES = new Set(['admin', 'director', 'techManager', 'vesselManager']);
for (const u of plan.users) if (!VALID_ROLES.has(u.role)) warn(`User ${u.email} has unknown role "${u.role}"`);

// template (appConfig/sections)
const cfg = (stores.appConfig ?? []).find((x) => x.key === 'sections')?.d;
for (const [i, s] of (cfg?.sections ?? []).entries()) {
  plan.template.push({
    sr: s.sr, zone: str(s.zone), name: str(s.name), position: i, photoOnly: s.photoOnly === true,
    questions: (s.q ?? []).map((q, qi) => ({ ref: str(q[0]), text: str(q[1]), qid: Number.isInteger(q[2]) ? q[2] : qi, position: qi })),
  });
}
if (!cfg) warn('No appConfig "sections" row found — checklist template will not be updated');

// vessels
const vesselIdByName = new Map();
for (const { key, d } of stores.vessels ?? []) {
  const oldId = d.id || key;
  const v = {
    id: uuid('vessel', oldId), oldId, name: str(d.name).trim(), imo: str(d.imo), vesselType: str(d.vesselType),
    particulars: Object.fromEntries(PARTICULARS.filter((k) => str(d[k]).trim()).map((k) => [k, str(d[k])])),
    createdAt: iso(d.createdAt), photo: null,
  };
  if (!v.name) { warn(`Vessel ${oldId} has no name — skipped`); continue; }
  if (vesselIdByName.has(lc(v.name))) { warn(`Duplicate vessel name "${v.name}" — kept the first`); continue; }
  const blob = d.vesselPhoto ? resolveBlob(d.vesselPhoto) : null;
  if (d.vesselPhoto && !blob) warn(`Vessel ${v.name}: photo data missing`);
  if (blob) {
    const pid = uuid('photo', 'vessel', d.vesselPhoto.id || oldId);
    v.photo = { id: pid, target: 'vessel', vesselId: v.id, blob, blobPath: `vessels/${v.id}/${pid}.jpg`, isDefect: false, position: 0 };
  }
  vesselIdByName.set(lc(v.name), v.id);
  plan.vessels.push(v);
}
for (const u of plan.users) for (const n of u.fleet) if (!vesselIdByName.has(lc(n))) warn(`User ${u.email}: fleet vessel "${n}" has no matching vessel record`);

// index the per-inspection stores
const responsesByInsp = new Map(), extrasByInsp = new Map(), customByInsp = new Map();
const push = (m, k, v) => (m.get(k) ?? m.set(k, []).get(k)).push(v);
for (const { key, d } of stores.responses ?? []) push(responsesByInsp, d.inspectionId ?? key.split('__')[0], { key, d });
for (const { key, d } of stores.sectionExtras ?? []) push(extrasByInsp, d.inspectionId ?? key.split('__')[0], { key, d });
for (const { key, d } of stores.customSections ?? []) push(customByInsp, d.inspectionId, { key, d });

const firstAdmin = plan.users.find((u) => u.role === 'admin')?.email ?? null;
const statusTally = {};

for (const { key, d } of stores.inspections ?? []) {
  const oldId = d.id || key;
  const id = uuid('inspection', oldId);
  const W = (m) => warn(`Inspection ${oldId} (${d.vesselName}): ${m}`);
  const insp = {
    id, oldId, vesselName: str(d.vesselName), imo: str(d.imo), vesselType: str(d.vesselType),
    vesselId: vesselIdByName.get(ALIASES.get(lc(d.vesselName)) ?? lc(d.vesselName)) ?? null,
    inspectionType: ['port', 'remote', 'sailing'].includes(d.inspectionType) ? d.inspectionType : 'port',
    port: str(d.port), startDate: dateOnly(d.date), completionDate: dateOnly(d.completionDate),
    sailFromDate: dateOnly(d.sailFromDate), sailFromPort: str(d.sailFromPort), sailToDate: dateOnly(d.sailToDate), sailToPort: str(d.sailToPort),
    remoteFromDate: dateOnly(d.remoteFromDate), remoteToDate: dateOnly(d.remoteToDate),
    inspector: str(d.inspector), company: str(d.company), summary: str(d.summary), conclusion: str(d.conclusion),
    createdAt: iso(d.createdAt), coverPhotoId: null,
    sections: [], questions: [], responses: [], findings: [], photos: [], approval: null, events: [], status: 'in_progress',
  };
  if (!insp.vesselId) W('no matching vessel record (inspection keeps its own vessel name snapshot, vessel_id = null)');

  // cover photo
  if (d.vesselPhoto) {
    const blob = resolveBlob(d.vesselPhoto);
    if (blob) {
      const pid = uuid('photo', 'cover', oldId, d.vesselPhoto.id || 'cover');
      insp.coverPhotoId = pid;
      insp.photos.push({ id: pid, target: 'cover', blob, blobPath: `inspections/${id}/${pid}.jpg`, isDefect: false, position: 0 });
    } else W('cover photo data missing');
  }

  // frozen sections + questions
  const sectionBySr = new Map(); // String(sr) -> { id, qidMap, qIdxList }
  for (const [si, s] of (d.sections ?? []).entries()) {
    const sid = uuid('section', oldId, s.sr);
    insp.sections.push({ id: sid, templateSr: Number.isInteger(s.sr) ? s.sr : null, zone: str(s.zone), name: str(s.name), position: si, photoOnly: s.photoOnly === true, isCustom: false });
    const qidMap = new Map(), qList = [];
    for (const [qi, q] of (s.q ?? []).entries()) {
      const qid = Number.isInteger(q[2]) ? q[2] : qi;
      if (qidMap.has(qid)) { W(`section ${s.sr} has duplicate question id ${qid} — skipped`); continue; }
      const qrow = { id: uuid('question', oldId, s.sr, qid), sectionId: sid, qid, ref: str(q[0]), text: str(q[1]), position: qi };
      insp.questions.push(qrow); qidMap.set(qid, qrow); qList.push(qrow);
    }
    sectionBySr.set(String(s.sr), { id: sid, qidMap, qList });
  }
  // custom sections
  for (const [ci, c] of (customByInsp.get(oldId) ?? []).entries()) {
    const sid = uuid('section', oldId, c.d.id || c.key);
    insp.sections.push({ id: sid, templateSr: null, zone: '', name: str(c.d.name), position: insp.sections.length + ci, photoOnly: c.d.photoOnly === true, isCustom: true });
    sectionBySr.set(String(c.d.id || c.key), { id: sid, qidMap: new Map(), qList: [] });
  }

  // responses (+ question photos)
  let unmatched = 0;
  for (const { key: rkey, d: r } of responsesByInsp.get(oldId) ?? []) {
    const [, srPart, qPart] = rkey.split('__');
    const sec = sectionBySr.get(String(r.sectionSr ?? srPart));
    const qrow = sec && (sec.qidMap.get(Number(qPart)) ?? sec.qList[r.qIdx ?? Number(qPart)]);
    if (!qrow) { unmatched++; continue; }
    const photos = r.photos ?? [];
    const hasData = r.applicable !== null && r.applicable !== undefined || yn(r.answer) || str(r.remarks).trim() || str(r.correctiveAction).trim() || str(r.preventiveAction).trim() || photos.length;
    if (!hasData) continue;
    const resp = {
      id: uuid('response', oldId, sec.id, qrow.qid), questionId: qrow.id,
      applicable: typeof r.applicable === 'boolean' ? r.applicable : null, answer: yn(r.answer),
      remarks: str(r.remarks), correctiveAction: str(r.correctiveAction), preventiveAction: str(r.preventiveAction),
    };
    insp.responses.push(resp);
    for (const [pi, p] of photos.entries()) {
      const blob = resolveBlob(p);
      if (!blob) { W(`question photo ${p?.id} has no image data — skipped`); continue; }
      const pid = uuid('photo', 'question', oldId, p.id || `${resp.id}-${pi}`);
      insp.photos.push({ id: pid, target: 'question', responseId: resp.id, blob, blobPath: `inspections/${id}/${pid}.jpg`, isDefect: p.defect === true, position: pi });
    }
  }
  if (unmatched) W(`${unmatched} response(s) matched no question — skipped`);

  // section extras: section photos + custom findings
  for (const { key: ekey, d: e } of extrasByInsp.get(oldId) ?? []) {
    const srKey = String(e.sectionSr ?? ekey.split('__')[1]);
    const sec = sectionBySr.get(srKey);
    if (!sec) { W(`section extras for unknown section "${srKey}" — skipped`); continue; }
    for (const [pi, p] of (e.photos ?? []).entries()) {
      const blob = resolveBlob(p);
      if (!blob) { W(`section photo ${p?.id} has no image data — skipped`); continue; }
      const pid = uuid('photo', 'section', oldId, srKey, p.id || pi);
      insp.photos.push({ id: pid, target: 'section', sectionId: sec.id, blob, blobPath: `inspections/${id}/${pid}.jpg`, isDefect: p.defect === true, position: pi });
    }
    for (const [fi, f] of (e.customFindings ?? []).entries()) {
      const fid = uuid('finding', oldId, srKey, f.id || fi);
      insp.findings.push({ id: fid, sectionId: sec.id, text: str(f.text), answer: yn(f.answer), correctiveAction: str(f.correctiveAction), preventiveAction: str(f.preventiveAction), position: fi });
      for (const [pi, p] of (f.photos ?? []).entries()) {
        const blob = resolveBlob(p);
        if (!blob) { W(`finding photo ${p?.id} has no image data — skipped`); continue; }
        const pid = uuid('photo', 'finding', oldId, fid, p.id || pi);
        insp.photos.push({ id: pid, target: 'finding', findingId: fid, blob, blobPath: `inspections/${id}/${pid}.jpg`, isDefect: p.defect === true, position: pi });
      }
    }
  }

  // status + approval
  const ap = d.approval && typeof d.approval === 'object' ? d.approval : null;
  const stageStatus = { tm: 'pending_tm', director: 'pending_director', approved: 'approved', returned: 'returned' };
  let migratedAsApproved = false;
  if (ap && stageStatus[ap.stage]) insp.status = stageStatus[ap.stage];
  else if (!ap && d.status === 'completed') { insp.status = 'approved'; migratedAsApproved = true; }
  else insp.status = 'in_progress';
  statusTally[`${d.status ?? '(none)'} / ${ap?.stage ?? '(no approval)'} -> ${insp.status}`] = (statusTally[`${d.status ?? '(none)'} / ${ap?.stage ?? '(no approval)'} -> ${insp.status}`] ?? 0) + 1;

  const history = Array.isArray(ap?.history) ? ap.history : [];
  const email = (e) => { const x = lc(e); return x && userEmails.has(x) ? x : null; };
  if (ap && stageStatus[ap.stage]) {
    const submitter = email(ap.submittedBy?.email) ?? email(history.find((h) => h.action === 'submitted')?.byEmail) ?? firstAdmin;
    if (!email(ap.submittedBy?.email)) W(`submitter "${ap.submittedBy?.email ?? ''}" is not a known user — using ${submitter}`);
    const lastReject = [...history].reverse().find((h) => h.action === 'rejected');
    insp.approval = {
      stage: ap.stage, submittedBy: submitter, submittedAt: iso(ap.submittedAt) ?? iso(history[0]?.at) ?? insp.createdAt ?? new Date().toISOString(),
      tm: email(ap.tmEmail), director: email(ap.directorEmail), approvedAt: iso(ap.approvedAt),
      returnedBy: ap.stage === 'returned' ? email(lastReject?.byEmail) : null, returnComment: ap.stage === 'returned' ? str(lastReject?.comment) : null,
    };
    for (const h of history) {
      if (!['submitted', 'approved', 'rejected', 'reopened'].includes(h.action)) { W(`unknown approval action "${h.action}" — skipped`); continue; }
      const actor = email(h.byEmail);
      if (!actor) W(`approval event by unknown user "${h.byEmail}" — attributed to ${firstAdmin}`);
      insp.events.push({ action: h.action, level: str(h.level), actor: actor ?? firstAdmin, actorName: str(h.byName), actorDesignation: '', actorRole: str(h.byRole), comment: str(h.comment), createdAt: iso(h.at) ?? insp.createdAt });
    }
  } else if (migratedAsApproved) {
    insp.approval = { stage: 'approved', submittedBy: firstAdmin, submittedAt: iso(d.updatedAt) ?? insp.createdAt, tm: null, director: null, approvedAt: iso(d.updatedAt), returnedBy: null, returnComment: null };
    insp.events.push({ action: 'approved', level: 'Final — Director', actor: firstAdmin, actorName: 'Migration', actorDesignation: '', actorRole: 'admin', comment: 'Migrated as approved (completed before approvals existed)', createdAt: iso(d.updatedAt) ?? insp.createdAt });
  }
  plan.inspections.push(insp);
}

/* ------------------------------------------------------------------ 4. report */
const sizeMB = (b64) => (b64.length * 0.75) / 1e6;
const allPhotos = [...plan.vessels.flatMap((v) => (v.photo ? [v.photo] : [])), ...plan.inspections.flatMap((i) => i.photos)];
console.log('\n=== MIGRATION PLAN ===');
console.log(`users            ${plan.users.length}  (${plan.users.map((u) => `${u.email}:${u.role}`).join(', ')})`);
console.log(`template         ${plan.template.length} sections, ${plan.template.reduce((n, s) => n + s.questions.length, 0)} questions`);
console.log(`vessels          ${plan.vessels.length}  (${plan.vessels.map((v) => `${v.name} [${Object.keys(v.particulars).length}/23 particulars]`).join(', ')})`);
console.log(`inspections      ${plan.inspections.length}`);
for (const i of plan.inspections) {
  console.log(`  - ${i.oldId}  ${i.vesselName}  ${i.startDate ?? '-'}  [${i.status}]  sections ${i.sections.length}, questions ${i.questions.length}, responses ${i.responses.length}, findings ${i.findings.length}, photos ${i.photos.length}, approval events ${i.events.length}`);
}
console.log('status mapping:'); for (const [k, v] of Object.entries(statusTally)) console.log(`  ${v} x ${k}`);
console.log(`photos           ${allPhotos.length}, ${allPhotos.reduce((n, p) => n + sizeMB(p.blob.b64), 0).toFixed(1)} MB decoded (${allPhotos.filter((p) => p.isDefect).length} marked defect)`);
console.log(`\n${warnings.length} warning(s)`); for (const w of warnings.slice(0, 60)) console.log('  ! ' + w);
if (warnings.length > 60) console.log(`  … and ${warnings.length - 60} more`);

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to load Postgres and write photo files.'); process.exit(0); }

/* ------------------------------------------------------------------ 5. apply */
function dbConfig() {
  if (process.env.PG_HOST) {
    return { host: process.env.PG_HOST, port: Number(process.env.PG_PORT ?? 5432), database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD, ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : false };
  }
  const f = resolve(arg('settings', join(root, 'backend', 'local.settings.json')));
  if (!existsSync(f)) throw new Error('Set PG_HOST/PG_DB/PG_USER/PG_PASSWORD, or pass --settings <local.settings.json>');
  const v = JSON.parse(readFileSync(f, 'utf8')).Values;
  return { host: v.PG_HOST, port: Number(v.PG_PORT ?? 5432), database: v.PG_DB, user: v.PG_USER, password: v.PG_PASSWORD, ssl: v.PG_SSL === 'false' ? false : { rejectUnauthorized: true } };
}

const cfgDb = dbConfig();
console.log(`\nApplying to ${cfgDb.user}@${cfgDb.host}:${cfgDb.port}/${cfgDb.database} …`);
const client = new pg.Client(cfgDb);
await client.connect();
const q = (sql, params) => client.query(sql, params);

try {
  // users
  await q('begin');
  const userId = new Map();
  for (const u of plan.users) {
    const r = await q(
      `insert into users (email, name, designation, role, is_active) values ($1,$2,$3,$4,true)
       on conflict ((lower(email))) do update set name = excluded.name, designation = excluded.designation, role = excluded.role
       returning id`, [u.email, u.name, u.designation, u.role]);
    userId.set(u.email, r.rows[0].id);
  }
  // template
  let tq = 0;
  for (const s of plan.template) {
    const r = await q(
      `insert into template_sections (sr, zone, name, position, photo_only) values ($1,$2,$3,$4,$5)
       on conflict (sr) do update set zone = excluded.zone, name = excluded.name, position = excluded.position, photo_only = excluded.photo_only, deleted_at = null
       returning id`, [s.sr, s.zone, s.name, s.position, s.photoOnly]);
    for (const qu of s.questions) {
      await q(
        `insert into template_questions (section_id, qid, ref, text, position) values ($1,$2,$3,$4,$5)
         on conflict (section_id, qid) do update set ref = excluded.ref, text = excluded.text, position = excluded.position, deleted_at = null`,
        [r.rows[0].id, qu.qid, qu.ref, qu.text, qu.position]);
      tq++;
    }
  }
  // vessels (+ vessel photos) and user -> vessel assignments
  const photoFiles = [];
  const insertPhoto = async (p, inspectionId) => {
    const buf = Buffer.from(p.blob.b64, 'base64');
    photoFiles.push({ path: p.blobPath, buf });
    await q(
      `insert into photos (id, inspection_id, target, inspection_section_id, response_id, finding_id, vessel_id, blob_path, content_type, size_bytes, is_defect, position, uploaded)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
       on conflict (id) do update set blob_path = excluded.blob_path, content_type = excluded.content_type, size_bytes = excluded.size_bytes,
         is_defect = excluded.is_defect, position = excluded.position, uploaded = true, deleted_at = null`,
      [p.id, inspectionId ?? null, p.target, p.sectionId ?? null, p.responseId ?? null, p.findingId ?? null, p.vesselId ?? null, p.blobPath, p.blob.type, buf.length, p.isDefect, p.position]);
  };
  for (const v of plan.vessels) {
    await q(
      `insert into vessels (id, name, imo, vessel_type, particulars, photo_id, created_at) values ($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz, now()))
       on conflict (id) do update set name = excluded.name, imo = excluded.imo, vessel_type = excluded.vessel_type,
         particulars = excluded.particulars, photo_id = excluded.photo_id, deleted_at = null`,
      [v.id, v.name, v.imo, v.vesselType, v.particulars, v.photo?.id ?? null, v.createdAt]);
    if (v.photo) await insertPhoto(v.photo, null);
  }
  for (const u of plan.users) {
    await q('delete from user_vessels where user_id = $1', [userId.get(u.email)]);
    for (const n of u.fleet) {
      const r = await q('select id from vessels where lower(name) = lower($1) and deleted_at is null', [n]);
      if (r.rows[0]) await q('insert into user_vessels (user_id, vessel_id) values ($1,$2) on conflict do nothing', [userId.get(u.email), r.rows[0].id]);
    }
  }
  await q('commit');
  console.log(`  users ${plan.users.length}, template ${plan.template.length} sections / ${tq} questions, vessels ${plan.vessels.length}`);

  // inspections: one transaction each
  for (const i of plan.inspections) {
    await q('begin');
    try {
      await q(
        `insert into inspections (id, vessel_id, vessel_name, imo, vessel_type, inspection_type, port, start_date, completion_date,
           sail_from_date, sail_from_port, sail_to_date, sail_to_port, remote_from_date, remote_to_date, inspector, company, summary, conclusion,
           cover_photo_id, status, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,coalesce($22::timestamptz, now()))
         on conflict (id) do update set vessel_id = excluded.vessel_id, vessel_name = excluded.vessel_name, imo = excluded.imo, vessel_type = excluded.vessel_type,
           inspection_type = excluded.inspection_type, port = excluded.port, start_date = excluded.start_date, completion_date = excluded.completion_date,
           sail_from_date = excluded.sail_from_date, sail_from_port = excluded.sail_from_port, sail_to_date = excluded.sail_to_date, sail_to_port = excluded.sail_to_port,
           remote_from_date = excluded.remote_from_date, remote_to_date = excluded.remote_to_date, inspector = excluded.inspector, company = excluded.company,
           summary = excluded.summary, conclusion = excluded.conclusion, cover_photo_id = excluded.cover_photo_id, status = excluded.status, deleted_at = null`,
        [i.id, i.vesselId, i.vesselName, i.imo, i.vesselType, i.inspectionType, i.port, i.startDate, i.completionDate,
          i.sailFromDate, i.sailFromPort, i.sailToDate, i.sailToPort, i.remoteFromDate, i.remoteToDate, i.inspector, i.company, i.summary, i.conclusion,
          i.coverPhotoId, i.status, i.createdAt]);
      for (const s of i.sections) {
        await q(
          `insert into inspection_sections (id, inspection_id, template_sr, zone, name, position, photo_only, is_custom) values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (id) do update set zone = excluded.zone, name = excluded.name, position = excluded.position, photo_only = excluded.photo_only, deleted_at = null`,
          [s.id, i.id, s.templateSr, s.zone, s.name, s.position, s.photoOnly, s.isCustom]);
      }
      for (const qu of i.questions) {
        await q(
          `insert into inspection_questions (id, inspection_section_id, qid, ref, text, position) values ($1,$2,$3,$4,$5,$6)
           on conflict (id) do update set ref = excluded.ref, text = excluded.text, position = excluded.position`,
          [qu.id, qu.sectionId, qu.qid, qu.ref, qu.text, qu.position]);
      }
      for (const r of i.responses) {
        await q(
          `insert into responses (id, inspection_id, inspection_question_id, applicable, answer, remarks, corrective_action, preventive_action)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (id) do update set applicable = excluded.applicable, answer = excluded.answer, remarks = excluded.remarks,
             corrective_action = excluded.corrective_action, preventive_action = excluded.preventive_action`,
          [r.id, i.id, r.questionId, r.applicable, r.answer, r.remarks, r.correctiveAction, r.preventiveAction]);
      }
      for (const f of i.findings) {
        await q(
          `insert into findings (id, inspection_id, inspection_section_id, text, answer, corrective_action, preventive_action, position)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (id) do update set text = excluded.text, answer = excluded.answer, corrective_action = excluded.corrective_action,
             preventive_action = excluded.preventive_action, position = excluded.position, deleted_at = null`,
          [f.id, i.id, f.sectionId, f.text, f.answer, f.correctiveAction, f.preventiveAction, f.position]);
      }
      for (const p of i.photos) await insertPhoto(p, i.id);
      if (i.approval) {
        const a = i.approval;
        await q(
          `insert into approvals (inspection_id, stage, submitted_by, submitted_at, tm_user_id, director_user_id, approved_at, returned_by, return_comment)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           on conflict (inspection_id) do update set stage = excluded.stage, submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at,
             tm_user_id = excluded.tm_user_id, director_user_id = excluded.director_user_id, approved_at = excluded.approved_at,
             returned_by = excluded.returned_by, return_comment = excluded.return_comment`,
          [i.id, a.stage, userId.get(a.submittedBy), a.submittedAt, a.tm && userId.get(a.tm), a.director && userId.get(a.director), a.approvedAt, a.returnedBy && userId.get(a.returnedBy), a.returnComment]);
        await q('delete from approval_events where inspection_id = $1', [i.id]);
        for (const e of i.events) {
          await q(
            `insert into approval_events (inspection_id, action, level, actor_user_id, actor_name, actor_designation, actor_role, comment, created_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [i.id, e.action, e.level, userId.get(e.actor), e.actorName, e.actorDesignation, e.actorRole, e.comment, e.createdAt]);
        }
      }
      await q('commit');
    } catch (e) {
      await q('rollback');
      throw new Error(`Inspection ${i.oldId} failed and was rolled back: ${e.message}`);
    }
  }

  // photo files, laid out exactly like the Blob container
  for (const f of photoFiles) {
    const p = join(OUT, 'photos', f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.buf);
  }

  // reconcile
  console.log('\n=== RECONCILIATION (plan vs database) ===');
  const ids = plan.inspections.map((i) => i.id);
  const count = async (sql) => Number((await q(sql, [ids])).rows[0].n);
  const rows = [
    ['inspections', plan.inspections.length, await count('select count(*) n from inspections where id = any($1)')],
    ['sections', plan.inspections.reduce((n, i) => n + i.sections.length, 0), await count('select count(*) n from inspection_sections where inspection_id = any($1)')],
    ['questions', plan.inspections.reduce((n, i) => n + i.questions.length, 0), await count('select count(*) n from inspection_questions iq join inspection_sections s on s.id = iq.inspection_section_id where s.inspection_id = any($1)')],
    ['responses', plan.inspections.reduce((n, i) => n + i.responses.length, 0), await count('select count(*) n from responses where inspection_id = any($1)')],
    ['findings', plan.inspections.reduce((n, i) => n + i.findings.length, 0), await count('select count(*) n from findings where inspection_id = any($1)')],
    ['inspection photos', plan.inspections.reduce((n, i) => n + i.photos.length, 0), await count('select count(*) n from photos where inspection_id = any($1)')],
    ['approvals', plan.inspections.filter((i) => i.approval).length, await count('select count(*) n from approvals where inspection_id = any($1)')],
    ['approval events', plan.inspections.reduce((n, i) => n + i.events.length, 0), await count('select count(*) n from approval_events where inspection_id = any($1)')],
  ];
  let ok = true;
  for (const [name, expected, actual] of rows) { const good = expected === actual; ok &&= good; console.log(`  ${good ? 'OK ' : 'MISMATCH'} ${name.padEnd(18)} expected ${expected}, database ${actual}`); }
  console.log(`  photo files written: ${photoFiles.length} -> ${join(OUT, 'photos')}`);
  console.log(ok ? '\nAll counts match.' : '\nCOUNT MISMATCH — investigate before relying on this data.');
} catch (e) {
  try { await q('rollback'); } catch { /* nothing open */ }
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
