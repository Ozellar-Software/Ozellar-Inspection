/**
 * API integration test against a real PostgreSQL (schema from db/schema.sql).
 * Signs test tokens with the API's own JWT_SECRET (email/password auth, no Entra).
 * Run:  PG_TEST_HOST=... npx tsx test/integration.test.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

Object.assign(process.env, {
  JWT_SECRET: process.env.JWT_TEST_SECRET ?? 'integration-test-secret-not-for-real-use',
  PG_HOST: process.env.PG_TEST_HOST ?? '/tmp', PG_DB: process.env.PG_TEST_DB ?? 'virtest', PG_USER: process.env.PG_TEST_USER ?? 'postgres',
  PG_PASSWORD: process.env.PG_TEST_PASSWORD ?? 'unused', PG_SSL: 'false', PHOTOS_ACCOUNT: 'testacct', PG_PORT: process.env.PG_TEST_PORT ?? '5432',
});

const { HttpRequest, InvocationContext } = await import('@azure/functions');
const { pool } = await import('../src/lib/db.js');
const { signAccessToken } = await import('../src/lib/auth.js');
const sync = await import('../src/functions/sync.js');
const appr = await import('../src/functions/approvals.js');
const me = await import('../src/functions/me.js');
const users = await import('../src/functions/users.js');
const vessels = await import('../src/functions/vessels.js');

// `who` is a seeded user's short key (e.g. 'vm'); an unseeded key signs a token for a random,
// unknown user id so "unknown user is refused" still exercises a validly-signed token.
const token = (who: string) => signAccessToken(U[who] ?? randomUUID());

async function call(h: (r: InstanceType<typeof HttpRequest>, c: InstanceType<typeof InvocationContext>) => Promise<{ status?: number; jsonBody?: any }>,
                    who: string, opts: { method?: string; body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}) {
  const req = new HttpRequest({
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    url: 'http://localhost/api/x' + (opts.query ? '?' + new URLSearchParams(opts.query) : ''),
    headers: { authorization: `Bearer ${await token(who)}`, 'content-type': 'application/json' },
    body: opts.body ? { string: JSON.stringify(opts.body) } : undefined,
    params: opts.params ?? {},
  });
  const res = await h(req, new InvocationContext({ functionName: 'test' }));
  return { status: res.status ?? 200, body: res.jsonBody };
}

// ---- seed ----
const V = randomUUID(), V2 = randomUUID();
await pool.query(`truncate users, vessels restart identity cascade`);
await pool.query(`insert into vessels (id, name) values ($1,'MV Alpha'), ($2,'MV Beta')`, [V, V2]);
const U: Record<string, string> = {};
for (const [oid, role, vessels] of [['adm', 'admin', []], ['dir', 'director', []], ['tm', 'techManager', [V]], ['tm2', 'techManager', [V2]], ['vm', 'vesselManager', [V]]] as const) {
  const id = (await pool.query(`insert into users (entra_oid, email, name, designation, role) values ($1,$2,$3,$4,$5) returning id`,
    [oid, `${oid}@x.com`, oid.toUpperCase(), oid === 'tm' ? 'Technical Superintendent' : '', role])).rows[0].id;
  U[oid] = id;
  for (const v of vessels) await pool.query(`insert into user_vessels values ($1,$2)`, [id, v]);
}
let pass = 0; const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); pass++; console.log('  ✓', msg); };

// ---- /me ----
const meRes = await call(me.meHandler, 'vm');
ok(meRes.body.role === 'vesselManager' && meRes.body.vesselIds[0] === V, '/me returns role and assigned vessel');
ok((await call(me.meHandler, 'nobody')).status === 403, 'unknown user is refused');

// ---- VM creates an inspection offline, then pushes ----
const I = randomUUID(), S = randomUUID(), Q = randomUUID(), R = randomUUID(), P = randomUUID();
const m = (entity: string, entityId: string, data: object, op = 'upsert') => ({ id: randomUUID(), entity, entityId, op, data, createdAt: new Date().toISOString() });
const createBatch = [
  m('inspections', I, { vesselId: V, vesselName: 'MV Alpha', inspectionType: 'port', startDate: '2026-09-28', status: 'approved' /* ignored */ }),
  m('inspectionSections', S, { inspectionId: I, templateSr: 1, zone: 'OUTSIDE', name: 'External Hull', position: 1 }),
  m('inspectionQuestions', Q, { inspectionSectionId: S, qid: 0, ref: 'H-1', text: 'Hull plating', position: 1 }),
  m('responses', R, { inspectionId: I, inspectionQuestionId: Q, applicable: true, answer: 'no', remarks: 'rust' }),
  m('photos', P, { inspectionId: I, target: 'question', responseId: R, isDefect: true }),
];
let push = await call(sync.syncPushHandler, 'vm', { body: { deviceId: 'phone-1', mutations: createBatch } });
ok(push.body.results.every((r: any) => r.ok), 'VM pushes new inspection, section, question, answer, photo');
const st = (await pool.query(`select status, created_by from inspections where id = $1`, [I])).rows[0];
ok(st.status === 'in_progress' && st.created_by === U.vm, 'client cannot set status; creator recorded');
ok((await pool.query(`select blob_path from photos where id = $1`, [P])).rows[0].blob_path === `inspections/${I}/${P}.jpg`, 'server decides photo blob path');

const again = await call(sync.syncPushHandler, 'vm', { body: { deviceId: 'phone-1', mutations: [createBatch[3]] } });
ok(again.body.results[0].ok, 'retried mutation is idempotent');

// ---- visibility ----
const pullTm = await call(sync.syncPullHandler, 'tm', { query: { cursor: '0' } });
ok((pullTm.body.changes.inspections ?? []).some((x: any) => x.id === I), 'Tech Manager with the vessel pulls it');
const pullTm2 = await call(sync.syncPullHandler, 'tm2', { query: { cursor: '0' } });
ok(!(pullTm2.body.changes.inspections ?? []).some((x: any) => x.id === I) && !(pullTm2.body.changes.responses ?? []).length, 'other Tech Manager does not see it');
const cur = pullTm.body.nextCursor;
await call(sync.syncPushHandler, 'vm', { body: { deviceId: 'phone-1', mutations: [m('responses', R, { remarks: 'heavy rust' })] } });
const inc = await call(sync.syncPullHandler, 'tm', { query: { cursor: String(cur) } });
ok(inc.body.changes.responses?.length === 1 && inc.body.changes.responses[0].remarks === 'heavy rust' && !inc.body.changes.inspections, 'incremental pull returns only the changed answer');

// ---- tm2 cannot edit; director cannot edit ----
let r = await call(sync.syncPushHandler, 'tm2', { body: { deviceId: 'x', mutations: [m('responses', R, { remarks: 'hack' })] } });
ok(!r.body.results[0].ok && r.body.results[0].code === 'FORBIDDEN', 'Tech Manager without the vessel cannot edit');
r = await call(sync.syncPushHandler, 'dir', { body: { deviceId: 'x', mutations: [m('responses', R, { remarks: 'dir' })] } });
ok(!r.body.results[0].ok, 'Director cannot edit');
r = await call(sync.syncPushHandler, 'vm', { body: { deviceId: 'x', mutations: [m('inspectionSections', randomUUID(), { inspectionId: I, name: 'Custom', position: 9, isCustom: true })] } });
ok(!r.body.results[0].ok, 'only Admin adds custom sections');

// ---- approvals ----
let a = await call(appr.approvalSubmitHandler, 'vm', { params: { id: I }, body: { approverId: U.tm } });
ok(a.status === 400 && /Summary/.test(a.body.error.message), 'submit needs summary + conclusion');
await call(sync.syncPushHandler, 'vm', { body: { deviceId: 'x', mutations: [m('inspections', I, { summary: 'ok', conclusion: 'fit' })] } });
a = await call(appr.approvalSubmitHandler, 'vm', { params: { id: I }, body: { approverId: U.tm2 } });
ok(a.status === 400, 'cannot submit to a Tech Manager without the vessel');
a = await call(appr.approvalSubmitHandler, 'vm', { params: { id: I }, body: { approverId: U.tm, comment: 'please review' } });
ok(a.status === 200 && a.body.status === 'pending_tm', 'VM submits to TM');
r = await call(sync.syncPushHandler, 'vm', { body: { deviceId: 'x', mutations: [m('responses', R, { remarks: 'late edit' })] } });
ok(!r.body.results[0].ok && r.body.results[0].code === 'LOCKED' && r.body.results[0].serverRow.remarks === 'heavy rust', 'edits after submit are LOCKED and server copy returned');
const inbox = await call(appr.approvalInboxHandler, 'tm');
ok(inbox.body.waiting.length === 1, 'TM inbox shows it');
ok((await call(appr.approvalInboxHandler, 'tm2')).body.waiting.length === 0, 'other TM inbox empty');
a = await call(appr.approvalApproveHandler, 'tm2', { params: { id: I }, body: { nextApproverId: U.dir } });
ok(a.status === 403, 'unassigned TM cannot approve');
a = await call(appr.approvalRejectHandler, 'tm', { params: { id: I }, body: { comment: '' } });
ok(a.status === 400, 'reject needs a reason');
a = await call(appr.approvalRejectHandler, 'tm', { params: { id: I }, body: { comment: 'Photos missing' } });
ok(a.body.status === 'returned', 'TM rejects back to VM');
ok((await call(appr.approvalInboxHandler, 'vm')).body.returned.length === 1, 'VM sees it returned');
r = await call(sync.syncPushHandler, 'vm', { body: { deviceId: 'x', mutations: [m('responses', R, { remarks: 'fixed' })] } });
ok(r.body.results[0].ok, 'returned inspection is editable again');
a = await call(appr.approvalSubmitHandler, 'vm', { params: { id: I }, body: { approverId: U.tm } });
a = await call(appr.approvalApproveHandler, 'tm', { params: { id: I }, body: { nextApproverId: U.dir } });
ok(a.body.status === 'pending_director', 'TM approves level 1 → Director');
a = await call(appr.approvalApproveHandler, 'dir', { params: { id: I }, body: {} });
ok(a.body.status === 'approved', 'Director gives final approval');
r = await call(sync.syncPushHandler, 'adm', { body: { deviceId: 'x', mutations: [m('responses', R, { remarks: 'admin edit' })] } });
ok(!r.body.results[0].ok, 'approved inspection is locked even for Admin');
a = await call(appr.approvalReopenHandler, 'dir', { params: { id: I } });
ok(a.status === 403, 'only Admin can reopen');
const hist = await call(appr.approvalHistoryHandler, 'vm', { params: { id: I } });
ok(hist.body.history.map((e: any) => e.action).join(',') === 'submitted,rejected,submitted,approved,approved', 'history recorded in order');
ok(hist.body.history[1].actorDesignation === 'Technical Superintendent', 'history keeps designation snapshot');

// ---- users, approvers, fleet status ----
let u = await call(users.usersUpsertHandler, 'vm', { body: { email: 'new@x.com', role: 'director' } });
ok(u.status === 403, 'only Admin manages users');
u = await call(users.usersUpsertHandler, 'adm', { body: { email: 'NEW@x.com', name: 'Neha', designation: 'Port Captain', role: 'techManager' } });
ok(u.status === 400, 'Tech Manager needs at least one vessel');
u = await call(users.usersUpsertHandler, 'adm', { body: { email: 'NEW@x.com', name: 'Neha', designation: 'Port Captain', role: 'techManager', vesselIds: [V] } });
ok(u.status === 200 && u.body.email === 'new@x.com', 'Admin adds a user (email lower-cased)');
u = await call(users.usersUpsertHandler, 'adm', { body: { email: 'new@x.com', name: 'Neha K', designation: 'Port Captain', role: 'techManager', vesselIds: [V, V2] } });
ok(u.status === 200 && u.body.name === 'Neha K', 'editing the same email updates, not duplicates');
const tms = await call(users.approversHandler, 'vm', { query: { level: 'tm', inspectionId: I } });
ok(tms.body.map((x: any) => x.email).sort().join(',') === 'new@x.com,tm@x.com', 'approver list = Tech Managers who have the vessel');
const des = await call(users.designationsHandler, 'adm');
ok(des.body.includes('Port Captain') && des.body.includes('Master'), 'designation list = presets + used');
const fs = await call(vessels.fleetStatusHandler, 'vm');
ok(fs.body.length === 1 && fs.body[0].last?.id === I && fs.body[0].due.color === 'green', 'fleet status uses last approved inspection, filtered to own vessels');

console.log(`\n${pass} checks passed`);
await pool.end();
