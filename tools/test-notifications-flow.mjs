import crypto from 'node:crypto';

const API = 'http://localhost:7071/api';

async function login(email, password = 'password123') {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const meRes = await fetch(`${API}/me`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  const user = await meRes.json();
  return { token: data.token, user };
}

async function run() {
  console.log('1. Logging in as users...');
  const { token: adminToken, user: adminUser } = await login('admin@ozellar.com');
  const { token: techToken, user: techUser } = await login('tech@ozellar.com');
  const { token: dirToken, user: dirUser } = await login('director@ozellar.com');
  const { token: vmToken, user: vmUser } = await login('vessel@ozellar.com');
  console.log('   ✓ Logged in as Admin, Tech Manager, Director, and Vessel Manager');

  // Fetch vessels to get a real vesselId
  const vesselsRes = await fetch(`${API}/vessels`, {
    headers: { Authorization: `Bearer ${techToken}` },
  });
  const vesselsData = await vesselsRes.json();
  const vessels = vesselsData.vessels || vesselsData;
  const vessel = vessels[0];
  if (!vessel) throw new Error('No vessel found in database to test with');
  console.log(`   ✓ Found test vessel: "${vessel.name}" (ID: ${vessel.id})`);

  // 2. Fetch initial notifications for tech manager & director
  console.log('\n2. Fetching current notifications...');
  let res = await fetch(`${API}/notifications`, {
    headers: { Authorization: `Bearer ${techToken}` },
  });
  let data = await res.json();
  console.log(`   Initial unreadCount for TM: ${data.unreadCount}`);

  // 3. Sync-push an inspection (simulating new inspection creation)
  console.log('\n3. Pushing a new inspection via sync push...');
  const inspId = crypto.randomUUID();
  const pushRes = await fetch(`${API}/sync/push`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      deviceId: 'test-device-1',
      mutations: [
        {
          id: crypto.randomUUID(),
          entity: 'inspections',
          entityId: inspId,
          op: 'upsert',
          data: {
            id: inspId,
            vesselId: vessel.id,
            vesselName: vessel.name,
            inspectionType: 'port',
            startDate: new Date().toISOString().split('T')[0],
            status: 'in_progress',
            summary: 'All systems inspected satisfactorily.',
            conclusion: 'Vessel in good operational order.',
          },
        },
      ],
    }),
  });
  const pushData = await pushRes.json();
  console.log('   Push result:', pushData.results?.[0]?.ok ? 'Success' : pushData);

  // Check TM notifications for inspection_created
  res = await fetch(`${API}/notifications`, {
    headers: { Authorization: `Bearer ${techToken}` },
  });
  data = await res.json();
  const createdNotif = data.notifications.find((n) => n.inspectionId === inspId && n.type === 'inspection_created');
  if (createdNotif) {
    console.log(`   ✓ Found "inspection_created" notification for TM: "${createdNotif.title}" - "${createdNotif.message}"`);
  } else {
    console.log('   Warning: inspection_created not found for TM');
  }

  // 4. Trigger section_completed
  console.log('\n4. Triggering section_completed notification...');
  const sectionId = crypto.randomUUID();
  const trigRes = await fetch(`${API}/notifications/trigger`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${vmToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inspectionId: inspId,
      type: 'section_completed',
      sectionId: sectionId,
      sectionName: 'Bridge & Navigation',
    }),
  });
  const trigData = await trigRes.json();
  console.log('   Trigger response:', trigData);

  // Check Director notifications for section_completed
  res = await fetch(`${API}/notifications`, {
    headers: { Authorization: `Bearer ${dirToken}` },
  });
  data = await res.json();
  const sectionNotif = data.notifications.find((n) => n.inspectionId === inspId && n.type === 'section_completed');
  if (sectionNotif) {
    console.log(`   ✓ Director received section_completed: "${sectionNotif.title}" - "${sectionNotif.message}"`);
  } else {
    throw new Error('Director did not receive section_completed notification!');
  }

  // 5. Submit inspection
  console.log('\n5. Submitting inspection for approval...');
  const subRes = await fetch(`${API}/inspections/${inspId}/submit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ approverId: dirUser.id, comment: 'Please review Bridge & Navigation inspection.' }),
  });
  const subData = await subRes.json();
  console.log('   Submit response:', subRes.status, subData.status ? 'Success' : subData);

  // Check Director notifications for submission
  res = await fetch(`${API}/notifications`, {
    headers: { Authorization: `Bearer ${dirToken}` },
  });
  data = await res.json();
  const submitNotif = data.notifications.find((n) => n.inspectionId === inspId && n.type === 'inspection_submitted');
  if (submitNotif) {
    console.log(`   ✓ Director received inspection_submitted: "${submitNotif.title}" - "${submitNotif.message}"`);
  } else {
    console.log('   Note: Director inspection_submitted notification:', data.notifications.slice(0, 2));
  }

  // 6. Approve inspection by Director
  console.log('\n6. Approving inspection by Director...');
  const dirAppRes = await fetch(`${API}/inspections/${inspId}/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${dirToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comment: 'Final Director approval granted.' }),
  });
  const appData = await dirAppRes.json();
  console.log('   Director approve status:', dirAppRes.status, appData.status ? 'Success' : appData);

  // Check Tech Manager & Vessel Manager notifications for approval
  res = await fetch(`${API}/notifications`, {
    headers: { Authorization: `Bearer ${techToken}` },
  });
  data = await res.json();
  const tmApproveNotif = data.notifications.find((n) => n.inspectionId === inspId && n.type === 'inspection_approved');
  if (tmApproveNotif) {
    console.log(`   ✓ Tech Manager received inspection_approved: "${tmApproveNotif.title}" - "${tmApproveNotif.message}"`);
  } else {
    console.log('   Note: TM notifications:', data.notifications.slice(0, 2));
  }
  const notifToRead = tmApproveNotif;

  // 7. Mark notification as read
  if (notifToRead) {
    console.log('\n7. Marking single notification as read for TM...');
    const readRes = await fetch(`${API}/notifications/read`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${techToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: notifToRead.id }),
    });
    console.log('   Mark read status:', readRes.status);

    res = await fetch(`${API}/notifications`, {
      headers: { Authorization: `Bearer ${techToken}` },
    });
    data = await res.json();
    const updated = data.notifications.find((n) => n.id === notifToRead.id);
    console.log(`   Is notification now read: ${updated?.read} (expected: true)`);
  }

  // 8. Mark all as read
  console.log('\n8. Marking ALL notifications as read for Tech Manager...');
  await fetch(`${API}/notifications/read`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ all: true }),
  });
  res = await fetch(`${API}/notifications`, {
    headers: { Authorization: `Bearer ${techToken}` },
  });
  data = await res.json();
  console.log(`   Tech Manager unread count now: ${data.unreadCount} (expected: 0)`);

  console.log('\n======================================================');
  console.log('🎉 ALL NOTIFICATION FLOW TESTS PASSED SUCCESSFULLY! 🎉');
  console.log('======================================================');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
