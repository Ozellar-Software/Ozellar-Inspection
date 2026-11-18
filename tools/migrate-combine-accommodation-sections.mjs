// tools/migrate-combine-accommodation-sections.mjs
// Consolidates 9 Accommodation sections into "Accommodation"
// and 3 Galley/Mess/Provision sections into "Galley / Provision / Mess Room"
// while fully preserving all questions, responses, defect observations, and photos.

import pg from 'pg';
import crypto from 'node:crypto';

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  database: process.env.PG_DB || 'vir',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'sujil123',
  port: Number(process.env.PG_PORT || 5432),
  ssl: false,
});

const GROUP1_QUESTIONS = [
  {
    oldSectionNames: ['Telly Room', 'Tally Room'],
    oldRefs: ['ADD-TR1', 'TEL-01'],
    newRef: 'TEL-01',
    text: 'TELLY ROOM — GENERAL CONDITION: Verify general condition of the Telly / Tally Room / cargo watch office — lighting, cleanliness, furniture and equipment in good working order.',
  },
  {
    oldSectionNames: ['Gym'],
    oldRefs: ['ADD-GY1', 'GYM-01'],
    newRef: 'GYM-01',
    text: "GYM EQUIPMENT & FACILITY: Confirm all gym equipment is properly secured against the ship's motion and is in good working condition; confirm lighting and the attached toilet facility (if fitted) are in working order.",
  },
  {
    oldSectionNames: ['Hospital'],
    oldRefs: ['AS-6', 'HOS-01'],
    newRef: 'HOS-01',
    text: 'HOSPITAL / SICK BAY: Verify hospital/sick bay meets requirements, medicines within validity, medical equipment functional, and medical chest maintained per flag state requirements.',
  },
  {
    oldSectionNames: ['Hospital'],
    oldRefs: ['AS-9', 'HOS-02'],
    newRef: 'HOS-02',
    text: 'HOSPITAL / MEDICAL CARE: Verify arrangements for medical care on board including medicine chest complete, medical officer designated, and communication for shore medical advice available.',
  },
  {
    oldSectionNames: ['AC Room', 'Accommodation AC room'],
    oldRefs: ['AS-11', 'AC-01'],
    newRef: 'AC-01',
    text: 'AC ROOM & REFRIGERATION: Verify AC/refrigeration system functioning. Check accommodation temperature maintained. Inspect provision room temperature (fridge <5°C, freezer <-18°C), anti-skid flooring, manual call alarm, door handle and emergency door release arrangement.',
  },
  {
    oldSectionNames: ['Changing Lockers', 'Changing Locker'],
    oldRefs: ['ADD-CL1', 'CLK-01'],
    newRef: 'CLK-01',
    text: 'CHANGING LOCKER — GENERAL CONDITION: Verify general condition of deck/engine changing lockers — lighting, ventilation, cleanliness, lockers and benches in good order, free of unauthorized storage.',
  },
  {
    oldSectionNames: ['Recreation Room'],
    oldRefs: ['ADD-RR1', 'REC-01'],
    newRef: 'REC-01',
    text: 'RECREATION ROOM — LIGHTING & GENERAL CONDITION: Verify lighting and general condition of the crew recreation room, including furniture, entertainment equipment and cleanliness.',
  },
  {
    oldSectionNames: ['Recreation Room'],
    oldRefs: ['ADD-RR2', 'REC-02'],
    newRef: 'REC-02',
    text: 'RECREATION ROOM — TRAINING MANUAL AVAILABILITY: Confirm onboard training manual(s)/materials are available and accessible to crew in the recreation room.',
  },
  {
    oldSectionNames: ['Crew Cabins'],
    oldRefs: ['AS-2', 'CAB-01'],
    newRef: 'CAB-01',
    text: 'CREW CABINS & LIVING STANDARDS: Inspect crew accommodation including cabins, messrooms, recreation spaces for MLC compliance covering living standards, ventilation, lighting, sanitary facilities and pest control.',
  },
  {
    oldSectionNames: ['Common Toilet'],
    oldRefs: ['ADD-CT1', 'TOI-01'],
    newRef: 'TOI-01',
    text: 'COMMON TOILET — GENERAL CONDITION: Verify general condition of common toilets — fixtures in working order, adequate lighting and ventilation, free of leaks, clean and hygienic.',
  },
  {
    oldSectionNames: ['Laundry Room'],
    oldRefs: ['ADD-LR1', 'LND-01'],
    newRef: 'LND-01',
    text: 'LAUNDRY ROOM — GENERAL CONDITION: Verify general condition of the laundry room — washing/drying machines in working order, lighting and ventilation adequate, drainage free, area clean and free of trip/fire hazards (lint accumulation, stowage of chemicals).',
  },
];

const GROUP2_QUESTIONS = [
  {
    oldSectionNames: ['Mess Room'],
    oldRefs: ['ADD-MR1', 'MES-01'],
    newRef: 'MES-01',
    text: "MESS ROOM — GENERAL CONDITION: Verify general condition of the crew/officers' mess room — lighting, furniture, cleanliness and hygiene satisfactory, notice boards up to date.",
  },
  {
    oldSectionNames: ['Galley', 'Galley and Provision'],
    oldRefs: ['AS-3', 'GAL-01'],
    newRef: 'GAL-01',
    text: 'GALLEY & FOOD HYGIENE: Examine galley and food storage areas for hygiene, food handling practices, cold room temperatures, equipment safety and verify food and drinking water safe for consumption.',
  },
  {
    oldSectionNames: ['Provision Store', 'Galley and Provision'],
    oldRefs: ['AS-7', 'PRV-01'],
    newRef: 'PRV-01',
    text: 'PROVISION STORE & FOOD STORAGE: Verify fresh provisions adequate for voyage with quality satisfactory, and storage temperatures correct (fridge <5°C, freezer <-18°C).',
  },
];

const ALL_GROUP1_NAMES = ['Telly Room', 'Tally Room', 'Gym', 'Hospital', 'AC Room', 'Accommodation AC room', 'Changing Lockers', 'Changing Locker', 'Recreation Room', 'Crew Cabins', 'Common Toilet', 'Laundry Room'];
const ALL_GROUP2_NAMES = ['Mess Room', 'Galley', 'Provision Store', 'Galley and Provision'];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('--- Starting Migration: Combining Accommodation & Galley/Mess/Provision sections ---');

    // ── 1. TEMPLATE SECTIONS (Universal & Bulk Carrier) ─────────────────────────
    const templateSets = [
      { name: 'Universal', vesselTypes: [], accomSr: 157, galleySr: 158, oldSrGroup1: [25, 26, 27, 29, 30, 34, 36, 37, 38], oldSrGroup2: [31, 32, 33] },
      { name: 'Bulk Carrier', vesselTypes: ['Bulk Carrier'], accomSr: 159, galleySr: 160, oldSrGroup1: [103, 104, 105, 107, 108, 112, 114, 115, 116], oldSrGroup2: [109, 110, 111] },
    ];

    for (const tSet of templateSets) {
      console.log(`\nMigrating template set: ${tSet.name}...`);

      // 1A. Accomodation (Internal)
      let accomSec = (await client.query(
        `SELECT id FROM template_sections WHERE name = 'Accommodation' AND deleted_at IS NULL AND vessel_types = $1`,
        [tSet.vesselTypes]
      )).rows[0];

      if (!accomSec) {
        // Find next position
        const minPosRes = await client.query(
          `SELECT coalesce(min(position), 24) as pos FROM template_sections WHERE sr = ANY($1)`,
          [tSet.oldSrGroup1]
        );
        const pos = Number(minPosRes.rows[0]?.pos ?? 24);
        accomSec = (await client.query(
          `INSERT INTO template_sections (id, sr, zone, name, position, photo_only, vessel_types, updated_at, row_version)
           VALUES (gen_random_uuid(), $1, 'INSIDE', 'Accommodation', $2, false, $3, now(), nextval('sync_seq'))
           RETURNING id`,
          [tSet.accomSr, pos, tSet.vesselTypes]
        )).rows[0];
        console.log(`  Created template section: Accommodation (sr=${tSet.accomSr})`);
      }

      // Upsert questions for Accommodation
      for (let idx = 0; idx < GROUP1_QUESTIONS.length; idx++) {
        const qDef = GROUP1_QUESTIONS[idx];
        await client.query(
          `INSERT INTO template_questions (id, section_id, qid, ref, text, position, updated_at, row_version)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), nextval('sync_seq'))
           ON CONFLICT (section_id, qid) DO UPDATE
           SET ref = EXCLUDED.ref, text = EXCLUDED.text, position = EXCLUDED.position, deleted_at = NULL, updated_at = now(), row_version = nextval('sync_seq')`,
          [accomSec.id, idx + 1, qDef.newRef, qDef.text, idx]
        );
      }

      // Soft-delete old template sections and their questions
      await client.query(
        `UPDATE template_questions SET deleted_at = now(), updated_at = now(), row_version = nextval('sync_seq')
         WHERE section_id IN (SELECT id FROM template_sections WHERE sr = ANY($1)) AND deleted_at IS NULL`,
        [tSet.oldSrGroup1]
      );
      await client.query(
        `UPDATE template_sections SET deleted_at = now(), updated_at = now(), row_version = nextval('sync_seq')
         WHERE sr = ANY($1) AND deleted_at IS NULL`,
        [tSet.oldSrGroup1]
      );

      // 1B. Galley / Provision / Mess Room
      let galleySec = (await client.query(
        `SELECT id FROM template_sections WHERE name = 'Galley / Provision / Mess Room' AND deleted_at IS NULL AND vessel_types = $1`,
        [tSet.vesselTypes]
      )).rows[0];

      if (!galleySec) {
        const minPosRes = await client.query(
          `SELECT coalesce(min(position), 25) as pos FROM template_sections WHERE sr = ANY($1)`,
          [tSet.oldSrGroup2]
        );
        const pos = Number(minPosRes.rows[0]?.pos ?? 25);
        galleySec = (await client.query(
          `INSERT INTO template_sections (id, sr, zone, name, position, photo_only, vessel_types, updated_at, row_version)
           VALUES (gen_random_uuid(), $1, 'INSIDE', 'Galley / Provision / Mess Room', $2, false, $3, now(), nextval('sync_seq'))
           RETURNING id`,
          [tSet.galleySr, pos, tSet.vesselTypes]
        )).rows[0];
        console.log(`  Created template section: Galley / Provision / Mess Room (sr=${tSet.galleySr})`);
      }

      // Upsert questions for Galley / Provision / Mess Room
      for (let idx = 0; idx < GROUP2_QUESTIONS.length; idx++) {
        const qDef = GROUP2_QUESTIONS[idx];
        await client.query(
          `INSERT INTO template_questions (id, section_id, qid, ref, text, position, updated_at, row_version)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), nextval('sync_seq'))
           ON CONFLICT (section_id, qid) DO UPDATE
           SET ref = EXCLUDED.ref, text = EXCLUDED.text, position = EXCLUDED.position, deleted_at = NULL, updated_at = now(), row_version = nextval('sync_seq')`,
          [galleySec.id, idx + 1, qDef.newRef, qDef.text, idx]
        );
      }

      // Soft-delete old template sections and their questions
      await client.query(
        `UPDATE template_questions SET deleted_at = now(), updated_at = now(), row_version = nextval('sync_seq')
         WHERE section_id IN (SELECT id FROM template_sections WHERE sr = ANY($1)) AND deleted_at IS NULL`,
        [tSet.oldSrGroup2]
      );
      await client.query(
        `UPDATE template_sections SET deleted_at = now(), updated_at = now(), row_version = nextval('sync_seq')
         WHERE sr = ANY($1) AND deleted_at IS NULL`,
        [tSet.oldSrGroup2]
      );

      // Normalize template_sections positions for this set
      const allActiveRes = await client.query(
        `SELECT id FROM template_sections
         WHERE deleted_at IS NULL AND vessel_types = $1
         ORDER BY photo_only ASC, position ASC, sr ASC`,
        [tSet.vesselTypes]
      );
      for (let i = 0; i < allActiveRes.rows.length; i++) {
        await client.query(
          `UPDATE template_sections SET position = $2 WHERE id = $1`,
          [allActiveRes.rows[i].id, i]
        );
      }
    }

    // ── 2. EXISTING INSPECTIONS ──────────────────────────────────────────────
    console.log('\nMigrating existing inspections...');
    const allInspectionsRes = await client.query(`SELECT id, vessel_name, vessel_type FROM inspections WHERE deleted_at IS NULL`);
    const inspections = allInspectionsRes.rows;

    let totalInspectionsUpdated = 0;

    for (const insp of inspections) {
      const inspId = insp.id;

      // Check if this inspection has any Group 1 or Group 2 sections
      const existingSecsRes = await client.query(
        `SELECT id, name, position, vessel_types FROM inspection_sections
         WHERE inspection_id = $1 AND deleted_at IS NULL AND (name = ANY($2) OR name = ANY($3))`,
        [inspId, ALL_GROUP1_NAMES, ALL_GROUP2_NAMES]
      );

      if (!existingSecsRes.rows.length) continue;

      const group1Secs = existingSecsRes.rows.filter((s) => ALL_GROUP1_NAMES.includes(s.name));
      const group2Secs = existingSecsRes.rows.filter((s) => ALL_GROUP2_NAMES.includes(s.name));

      // ── Process Group 1: Accommodation
      if (group1Secs.length > 0) {
        let accomSec = (await client.query(
          `SELECT id FROM inspection_sections WHERE inspection_id = $1 AND name = 'Accommodation' AND deleted_at IS NULL`,
          [inspId]
        )).rows[0];

        const minPos = Math.min(...group1Secs.map((s) => s.position));

        if (!accomSec) {
          const newId = crypto.randomUUID();
          accomSec = (await client.query(
            `INSERT INTO inspection_sections (id, inspection_id, template_sr, zone, name, position, photo_only, is_custom, vessel_types, remarks, applicable, updated_at, row_version)
             VALUES ($1, $2, null, 'INSIDE', 'Accommodation', $3, false, false, $4, '', true, now(), nextval('sync_seq'))
             RETURNING id`,
            [newId, inspId, minPos, insp.vessel_type ? [insp.vessel_type] : []]
          )).rows[0];
        }

        const accomSecId = accomSec.id;

        // Move questions
        for (let idx = 0; idx < GROUP1_QUESTIONS.length; idx++) {
          const qDef = GROUP1_QUESTIONS[idx];
          // Find matching question in old sections
          const qMatch = (await client.query(
            `SELECT q.id FROM inspection_questions q
             JOIN inspection_sections s ON s.id = q.inspection_section_id
             WHERE s.inspection_id = $1 AND s.name = ANY($2) AND (q.ref = ANY($3) OR q.ref = $4)
             LIMIT 1`,
            [inspId, qDef.oldSectionNames, qDef.oldRefs, qDef.newRef]
          )).rows[0];

          if (qMatch) {
            await client.query(
              `UPDATE inspection_questions
               SET inspection_section_id = $1, position = $2, qid = $3, ref = $4, text = $5, updated_at = now(), row_version = nextval('sync_seq')
               WHERE id = $6`,
              [accomSecId, idx, idx + 1, qDef.newRef, qDef.text, qMatch.id]
            );
          } else {
            // If question was not present, insert it so full checklist is consistent
            await client.query(
              `INSERT INTO inspection_questions (id, inspection_section_id, qid, ref, text, position, updated_at, row_version)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), nextval('sync_seq'))
               ON CONFLICT (inspection_section_id, qid) DO UPDATE
               SET ref = EXCLUDED.ref, text = EXCLUDED.text, position = EXCLUDED.position, updated_at = now(), row_version = nextval('sync_seq')`,
              [accomSecId, idx + 1, qDef.newRef, qDef.text, idx]
            );
          }
        }

        // Reassign findings
        await client.query(
          `UPDATE findings SET inspection_section_id = $1, updated_at = now(), row_version = nextval('sync_seq')
           WHERE inspection_id = $2 AND inspection_section_id = ANY($3)`,
          [accomSecId, inspId, group1Secs.map((s) => s.id)]
        );

        // Reassign photos targeting section
        await client.query(
          `UPDATE photos SET inspection_section_id = $1, updated_at = now(), row_version = nextval('sync_seq')
           WHERE inspection_id = $2 AND inspection_section_id = ANY($3)`,
          [accomSecId, inspId, group1Secs.map((s) => s.id)]
        );

        // Soft delete old sections
        await client.query(
          `UPDATE inspection_sections SET deleted_at = now(), updated_at = now(), row_version = nextval('sync_seq')
           WHERE inspection_id = $1 AND id = ANY($2) AND id != $3`,
          [inspId, group1Secs.map((s) => s.id), accomSecId]
        );
      }

      // ── Process Group 2: Galley / Provision / Mess Room
      if (group2Secs.length > 0) {
        let galleySec = (await client.query(
          `SELECT id FROM inspection_sections WHERE inspection_id = $1 AND name = 'Galley / Provision / Mess Room' AND deleted_at IS NULL`,
          [inspId]
        )).rows[0];

        const minPos = Math.min(...group2Secs.map((s) => s.position));

        if (!galleySec) {
          const newId = crypto.randomUUID();
          galleySec = (await client.query(
            `INSERT INTO inspection_sections (id, inspection_id, template_sr, zone, name, position, photo_only, is_custom, vessel_types, remarks, applicable, updated_at, row_version)
             VALUES ($1, $2, null, 'INSIDE', 'Galley / Provision / Mess Room', $3, false, false, $4, '', true, now(), nextval('sync_seq'))
             RETURNING id`,
            [newId, inspId, minPos, insp.vessel_type ? [insp.vessel_type] : []]
          )).rows[0];
        }

        const galleySecId = galleySec.id;

        // Move questions
        for (let idx = 0; idx < GROUP2_QUESTIONS.length; idx++) {
          const qDef = GROUP2_QUESTIONS[idx];
          const qMatch = (await client.query(
            `SELECT q.id FROM inspection_questions q
             JOIN inspection_sections s ON s.id = q.inspection_section_id
             WHERE s.inspection_id = $1 AND s.name = ANY($2) AND (q.ref = ANY($3) OR q.ref = $4)
             LIMIT 1`,
            [inspId, qDef.oldSectionNames, qDef.oldRefs, qDef.newRef]
          )).rows[0];

          if (qMatch) {
            await client.query(
              `UPDATE inspection_questions
               SET inspection_section_id = $1, position = $2, qid = $3, ref = $4, text = $5, updated_at = now(), row_version = nextval('sync_seq')
               WHERE id = $6`,
              [galleySecId, idx, idx + 1, qDef.newRef, qDef.text, qMatch.id]
            );
          } else {
            await client.query(
              `INSERT INTO inspection_questions (id, inspection_section_id, qid, ref, text, position, updated_at, row_version)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), nextval('sync_seq'))
               ON CONFLICT (inspection_section_id, qid) DO UPDATE
               SET ref = EXCLUDED.ref, text = EXCLUDED.text, position = EXCLUDED.position, updated_at = now(), row_version = nextval('sync_seq')`,
              [galleySecId, idx + 1, qDef.newRef, qDef.text, idx]
            );
          }
        }

        // Reassign findings
        await client.query(
          `UPDATE findings SET inspection_section_id = $1, updated_at = now(), row_version = nextval('sync_seq')
           WHERE inspection_id = $2 AND inspection_section_id = ANY($3)`,
          [galleySecId, inspId, group2Secs.map((s) => s.id)]
        );

        // Reassign photos targeting section
        await client.query(
          `UPDATE photos SET inspection_section_id = $1, updated_at = now(), row_version = nextval('sync_seq')
           WHERE inspection_id = $2 AND inspection_section_id = ANY($3)`,
          [galleySecId, inspId, group2Secs.map((s) => s.id)]
        );

        // Soft delete old sections
        await client.query(
          `UPDATE inspection_sections SET deleted_at = now(), updated_at = now(), row_version = nextval('sync_seq')
           WHERE inspection_id = $1 AND id = ANY($2) AND id != $3`,
          [inspId, group2Secs.map((s) => s.id), galleySecId]
        );
      }

      // Normalize position of all active sections in this inspection
      const activeSecs = (await client.query(
        `SELECT id FROM inspection_sections WHERE inspection_id = $1 AND deleted_at IS NULL ORDER BY photo_only ASC, position ASC`,
        [inspId]
      )).rows;

      for (let p = 0; p < activeSecs.length; p++) {
        await client.query(`UPDATE inspection_sections SET position = $2 WHERE id = $1`, [activeSecs[p].id, p]);
      }

      totalInspectionsUpdated++;
      console.log(`  Updated inspection: ${insp.vessel_name} (${inspId})`);
    }

    await client.query('COMMIT');
    console.log(`\nMigration completed successfully! Processed ${totalInspectionsUpdated} existing inspections.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back all changes:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
