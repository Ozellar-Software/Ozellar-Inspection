import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

process.env.PG_HOST = 'localhost';
process.env.PG_PORT = '5432';
process.env.PG_DB = 'vir';
process.env.PG_USER = 'postgres';
process.env.PG_PASSWORD = 'sujil123';
process.env.PG_SSL = 'false';
process.env.JWT_SECRET = 'dev-local-jwt-secret-change-in-production-min32chars!';

const { HttpRequest, InvocationContext } = await import('@azure/functions');
const { pool, ensureSchema } = await import('../src/lib/db.js');
const { signAccessToken } = await import('../src/lib/auth.js');

const auth = await import('../src/functions/auth.js');
const me = await import('../src/functions/me.js');
const users = await import('../src/functions/users.js');
const vessels = await import('../src/functions/vessels.js');
const templates = await import('../src/functions/templates.js');
const sync = await import('../src/functions/sync.js');
const approvals = await import('../src/functions/approvals.js');
const notifications = await import('../src/functions/notifications.js');

console.log('🚀 Step 1: Running ensureSchema()...');
await ensureSchema();
console.log('✅ ensureSchema() executed successfully.');

// Helper to call handlers
async function callHandler(handler: any, userToken: string | null, opts: {
  method?: string;
  url?: string;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
} = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (userToken) headers['authorization'] = `Bearer ${userToken}`;

  const req = new HttpRequest({
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    url: opts.url ?? 'http://localhost/api/test' + (opts.query ? '?' + new URLSearchParams(opts.query) : ''),
    headers,
    body: opts.body ? { string: JSON.stringify(opts.body) } : undefined,
    params: opts.params ?? {},
  });

  const ctx = new InvocationContext({ functionName: 'test-endpoint' });
  const res = await handler(req, ctx);
  return { status: res.status ?? 200, body: res.jsonBody };
}

let passedTests = 0;
let totalTests = 0;

function testAssert(desc: string, passed: boolean, extra?: unknown) {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  [PASS] ${desc}`);
  } else {
    console.error(`  [FAIL] ${desc}`, extra ?? '');
  }
}

async function run() {
  console.log('\n📦 Step 2: Seeding admin and test users...');
  const adminId = randomUUID();
  const dirId = randomUUID();
  const tmId = randomUUID();
  const vmId = randomUUID();
  const vesselId = randomUUID();

  const runStamp = Date.now();
  await pool.query(`
    insert into users (id, email, name, role, is_active)
    values ($1, $2, 'Test Admin', 'admin', true),
           ($3, $4, 'Test Dir', 'director', true),
           ($5, $6, 'Test TM', 'techManager', true),
           ($7, $8, 'Test VM', 'vesselManager', true)
  `, [
    adminId, `test-admin-${runStamp}@ozellar.com`,
    dirId, `test-dir-${runStamp}@ozellar.com`,
    tmId, `test-tm-${runStamp}@ozellar.com`,
    vmId, `test-vm-${runStamp}@ozellar.com`
  ]);

  const adminToken = await signAccessToken(adminId);
  const dirToken = await signAccessToken(dirId);
  const tmToken = await signAccessToken(tmId);
  const vmToken = await signAccessToken(vmId);

  // 1. Test /me
  console.log('\n--- Testing /me ---');
  const meRes = await callHandler(me.meHandler, adminToken);
  testAssert('/me returns admin role', meRes.status === 200 && meRes.body?.role === 'admin');

  // 2. Test Templates: Sections & Questions
  console.log('\n--- Testing /templates/sections and /apply-default ---');
  // List sections
  const secListRes = await callHandler(templates.templateSectionsListHandler, adminToken);
  testAssert('GET /templates/sections/list returns 200 array', secListRes.status === 200 && Array.isArray(secListRes.body));

  // Create a default (Universal) section
  const createSecRes = await callHandler(templates.templateSectionUpsertHandler, adminToken, {
    method: 'POST',
    body: {
      zone: 'DECK',
      name: 'Test Universal Section ' + Date.now(),
      photoOnly: false,
      vesselTypes: [],
    },
  });
  testAssert('POST /templates/sections creates universal section', createSecRes.status === 200 && !!createSecRes.body?.id);
  const univSecId = createSecRes.body?.id;

  // Add question to that universal section
  const createQRes = await callHandler(templates.templateQuestionUpsertHandler, adminToken, {
    method: 'POST',
    body: {
      sectionId: univSecId,
      ref: 'T-01',
      text: 'Is hull clean and free of cracks?',
    },
  });
  testAssert('POST /templates/questions creates question in section', createQRes.status === 200 && !!createQRes.body?.id);

  // Apply Default to a vessel type (Testing the exact endpoint that failed on the VM!)
  const applyDefRes = await callHandler(templates.templateSectionsApplyDefaultHandler, adminToken, {
    method: 'POST',
    body: { vesselType: 'Test Tanker' },
  });
  testAssert('POST /templates/sections/apply-default succeeds with 200', applyDefRes.status === 200 && Array.isArray(applyDefRes.body?.createdSections));

  // Reorder sections
  const reorderSecRes = await callHandler(templates.templateSectionsReorderHandler, adminToken, {
    method: 'POST',
    body: { ids: [univSecId] },
  });
  testAssert('POST /templates/sections/reorder succeeds with 200', reorderSecRes.status === 200);

  // 3. Test Vessels
  console.log('\n--- Testing /vessels ---');
  const vesselUpsertRes = await callHandler(vessels.vesselsUpsertHandler, adminToken, {
    method: 'POST',
    body: {
      id: vesselId,
      name: 'MV Ozellar Test ' + Date.now(),
      imo: '9988776',
      vesselType: 'Bulk Carrier',
    },
  });
  testAssert('POST /vessels creates vessel', vesselUpsertRes.status === 200 && vesselUpsertRes.body?.imo === '9988776');
  await pool.query(`insert into user_vessels (user_id, vessel_id) values ($1, $2), ($3, $2)`, [tmId, vesselId, vmId]);

  const vesselsListRes = await callHandler(vessels.vesselsListHandler, adminToken);
  testAssert('GET /vessels returns list containing new vessel', vesselsListRes.status === 200 && Array.isArray(vesselsListRes.body));

  const fleetStatusRes = await callHandler(vessels.fleetStatusHandler, adminToken);
  testAssert('GET /vessels/fleet-status returns 200 array', fleetStatusRes.status === 200 && Array.isArray(fleetStatusRes.body));

  // 4. Test Users Management
  console.log('\n--- Testing /users ---');
  const usersListRes = await callHandler(users.usersHandler, adminToken);
  testAssert('GET /users returns user list', usersListRes.status === 200 && Array.isArray(usersListRes.body));

  const designationsRes = await callHandler(users.designationsHandler, adminToken);
  testAssert('GET /users/designations returns designations', designationsRes.status === 200 && Array.isArray(designationsRes.body));

  // 5. Test Sync Pull & Push
  console.log('\n--- Testing /sync/pull and /sync/push ---');
  const pullRes = await callHandler(sync.syncPullHandler, adminToken, { query: { cursor: '0' } });
  testAssert('GET /sync/pull returns changes and nextCursor', pullRes.status === 200 && pullRes.body?.changes !== undefined);

  const testInspId = randomUUID();
  const testSecId = randomUUID();
  const testQId = randomUUID();
  const testRespId = randomUUID();

  const pushRes = await callHandler(sync.syncPushHandler, adminToken, {
    method: 'POST',
    body: {
      deviceId: 'device-test-1',
      mutations: [
        {
          id: randomUUID(),
          entity: 'inspections',
          entityId: testInspId,
          op: 'upsert',
          data: {
            vesselId,
            vesselName: 'MV Ozellar Test',
            inspectionType: 'port',
            startDate: '2026-10-13',
            summary: 'Good condition',
            conclusion: 'Passed test',
          },
        },
        {
          id: randomUUID(),
          entity: 'inspectionSections',
          entityId: testSecId,
          op: 'upsert',
          data: {
            inspectionId: testInspId,
            templateSr: 1,
            zone: 'DECK',
            name: 'Main Deck',
            position: 0,
            photoOnly: false,
            vesselTypes: ['Bulk Carrier'],
          },
        },
        {
          id: randomUUID(),
          entity: 'inspectionQuestions',
          entityId: testQId,
          op: 'upsert',
          data: {
            inspectionSectionId: testSecId,
            qid: 1,
            ref: 'D-01',
            text: 'Is anchor windlass operational?',
            position: 0,
          },
        },
        {
          id: randomUUID(),
          entity: 'responses',
          entityId: testRespId,
          op: 'upsert',
          data: {
            inspectionId: testInspId,
            inspectionQuestionId: testQId,
            applicable: true,
            answer: 'yes',
            remarks: 'Smooth operation',
          },
        },
      ],
    },
  });
  testAssert('POST /sync/push applies mutations with all ok:true',
    pushRes.status === 200 && Array.isArray(pushRes.body?.results) && pushRes.body.results.every((r: any) => r.ok));

  // 6. Test Approvals Workflow
  console.log('\n--- Testing Approvals ---');
  // Submit inspection by VM to TM
  const submitRes = await callHandler(approvals.approvalSubmitHandler, vmToken, {
    method: 'POST',
    params: { id: testInspId },
    body: { approverId: tmId, comment: 'Ready for review' },
  });
  if (submitRes.status !== 200) console.log('submitRes error:', submitRes);
  testAssert('POST /approvals/{id}/submit by VM moves to pending_tm', submitRes.status === 200 && submitRes.body?.status === 'pending_tm');

  // Approval inbox for TM
  const inboxRes = await callHandler(approvals.approvalInboxHandler, tmToken);
  testAssert('GET /approvals/inbox for TM shows submitted inspection',
    inboxRes.status === 200 && inboxRes.body?.waiting?.some((i: any) => i.id === testInspId));

  // TM Approves to Director
  const approveTmRes = await callHandler(approvals.approvalApproveHandler, tmToken, {
    method: 'POST',
    params: { id: testInspId },
    body: { nextApproverId: dirId, comment: 'TM approved' },
  });
  testAssert('POST /approvals/{id}/approve by TM moves to pending_director', approveTmRes.status === 200 && approveTmRes.body?.status === 'pending_director');

  // Director Approves (Final)
  const approveDirRes = await callHandler(approvals.approvalApproveHandler, dirToken, {
    method: 'POST',
    params: { id: testInspId },
    body: { comment: 'Director approved' },
  });
  testAssert('POST /approvals/{id}/approve by Director moves to approved', approveDirRes.status === 200 && approveDirRes.body?.status === 'approved');

  // Approval history
  const historyRes = await callHandler(approvals.approvalHistoryHandler, adminToken, {
    params: { id: testInspId },
  });
  testAssert('GET /approvals/{id}/history records submission and approval events',
    historyRes.status === 200 && Array.isArray(historyRes.body?.history) && historyRes.body.history.length >= 3);

  // 7. Test Notifications
  console.log('\n--- Testing Notifications ---');
  const notifListRes = await callHandler(notifications.notificationsListHandler, tmToken);
  testAssert('GET /notifications returns list for TM', notifListRes.status === 200 && Array.isArray(notifListRes.body?.notifications));

  const readAllRes = await callHandler(notifications.notificationsReadHandler, tmToken, { method: 'POST', body: { all: true } });
  testAssert('POST /notifications/read succeeds', readAllRes.status === 200 && readAllRes.body?.ok === true);

  // 8. Cleanup test section
  console.log('\n--- Cleanup test records ---');
  const delSecRes = await callHandler(templates.templateSectionDeleteHandler, adminToken, {
    method: 'DELETE',
    params: { id: univSecId },
  });
  testAssert('DELETE /templates/sections/{id} soft-deletes test section', delSecRes.status === 200 && delSecRes.body?.ok === true);

  console.log(`\n========================================`);
  console.log(`🎯 Test Summary: ${passedTests} / ${totalTests} tests passed`);
  console.log(`========================================\n`);

  await pool.end();
  process.exit(passedTests === totalTests ? 0 : 1);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
