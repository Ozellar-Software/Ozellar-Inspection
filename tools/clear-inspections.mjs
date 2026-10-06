import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  database: process.env.PG_DB || 'vir',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'sujil123',
  port: Number(process.env.PG_PORT || 5432),
});

async function clearInspectionData() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    console.log('Clearing all inspection data from DB...');

    const resPhotos = await client.query("delete from photos where inspection_id is not null or target in ('section','question','finding','cover')");
    console.log(`- Deleted ${resPhotos.rowCount} inspection photos`);

    const resAppEvents = await client.query('delete from approval_events');
    console.log(`- Deleted ${resAppEvents.rowCount} approval events`);

    const resApprovals = await client.query('delete from approvals');
    console.log(`- Deleted ${resApprovals.rowCount} approvals`);

    const resNotifications = await client.query("delete from notifications where inspection_id is not null or type in ('inspection_created', 'section_completed', 'inspection_submitted', 'inspection_approved', 'inspection_returned')");
    console.log(`- Deleted ${resNotifications.rowCount} inspection notifications`);

    const resResponses = await client.query('delete from responses');
    console.log(`- Deleted ${resResponses.rowCount} responses`);

    const resFindings = await client.query('delete from findings');
    console.log(`- Deleted ${resFindings.rowCount} findings`);

    const resQuestions = await client.query('delete from inspection_questions');
    console.log(`- Deleted ${resQuestions.rowCount} inspection questions`);

    const resSections = await client.query('delete from inspection_sections');
    console.log(`- Deleted ${resSections.rowCount} inspection sections`);

    const resInspections = await client.query('delete from inspections');
    console.log(`- Deleted ${resInspections.rowCount} inspections`);

    const resMutations = await client.query('delete from sync_mutations');
    console.log(`- Deleted ${resMutations.rowCount} sync mutations`);

    await client.query('commit');
    console.log('\nAll inspection details successfully wiped from the database!');
  } catch (err) {
    await client.query('rollback');
    console.error('Failed to clear inspection data:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

clearInspectionData();
