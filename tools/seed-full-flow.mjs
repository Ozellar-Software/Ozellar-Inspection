import pg from 'pg';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  database: process.env.PG_DB || 'vir',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'sujil123',
  port: Number(process.env.PG_PORT || 5432),
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const pwHash = await bcrypt.hash('password123', 10);

    // 1. Seed 4 Users
    const users = [
      {
        email: 'admin@ozellar.com',
        name: 'Admin User',
        designation: 'Fleet Director / Admin',
        role: 'admin',
      },
      {
        email: 'tech@ozellar.com',
        name: 'Capt. Ramesh Kumar',
        designation: 'Technical Superintendent',
        role: 'techManager',
      },
      {
        email: 'director@ozellar.com',
        name: 'David Sterling',
        designation: 'Managing Director',
        role: 'director',
      },
      {
        email: 'vessel@ozellar.com',
        name: 'Sajin Peter',
        designation: 'Marine Superintendent',
        role: 'vesselManager',
      },
    ];

    const userMap = new Map();
    for (const u of users) {
      const res = await client.query(
        `insert into users (email, password_hash, name, designation, role, is_active)
         values ($1, $2, $3, $4, $5, true)
         on conflict (lower(email)) do update set
           password_hash = excluded.password_hash,
           name = excluded.name,
           designation = excluded.designation,
           role = excluded.role,
           is_active = true
         returning id, email, role`,
        [u.email.toLowerCase(), pwHash, u.name, u.designation, u.role]
      );
      userMap.set(u.email.toLowerCase(), res.rows[0]);
      console.log(`Seeded user: ${u.email} (${u.role}) -> ${res.rows[0].id}`);
    }

    // 2. Seed 2 Sample Vessels
    const vessels = [
      {
        name: 'MV Pacific Star',
        imo: '9234567',
        vesselType: 'Bulk Carrier',
        particulars: { flag: 'Marshall Islands', callSign: 'V7AB8', grossTonnage: 32000, buildYear: 2018 },
      },
      {
        name: 'MV Atlantic Grace',
        imo: '9345678',
        vesselType: 'Container Ship',
        particulars: { flag: 'Panama', callSign: '3EFC9', grossTonnage: 45000, buildYear: 2020 },
      },
    ];

    const vesselIds = [];
    for (const v of vessels) {
      // Find existing or create
      const existing = (await client.query(`select id from vessels where lower(name) = lower($1) and deleted_at is null`, [v.name])).rows[0];
      const vid = existing ? existing.id : randomUUID();
      await client.query(
        `insert into vessels (id, name, imo, vessel_type, particulars)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set
           name = excluded.name,
           imo = excluded.imo,
           vessel_type = excluded.vessel_type,
           particulars = excluded.particulars`,
        [vid, v.name, v.imo, v.vesselType, JSON.stringify(v.particulars)]
      );
      vesselIds.push(vid);
      console.log(`Seeded vessel: ${v.name} -> ${vid}`);
    }

    // 3. Assign vessels to tech@ozellar.com and vessel@ozellar.com
    const techUser = userMap.get('tech@ozellar.com');
    const vesselUser = userMap.get('vessel@ozellar.com');
    for (const vid of vesselIds) {
      if (techUser) {
        await client.query(
          `insert into user_vessels (user_id, vessel_id) values ($1, $2) on conflict do nothing`,
          [techUser.id, vid]
        );
      }
      if (vesselUser) {
        await client.query(
          `insert into user_vessels (user_id, vessel_id) values ($1, $2) on conflict do nothing`,
          [vesselUser.id, vid]
        );
      }
    }
    console.log(`Assigned vessels to Tech Manager and Vessel Manager.`);

    // 4. Seed Template Sections & Questions from default-checklist.json
    const checklistPath = join(__dirname, '..', 'db', 'seed', 'default-checklist.json');
    try {
      const data = JSON.parse(readFileSync(checklistPath, 'utf8'));
      let sectionsCount = 0, questionsCount = 0;
      for (const s of data.sections) {
        const sec = (await client.query(
          `insert into template_sections (sr, zone, name, position, photo_only)
           values ($1,$2,$3,$4,$5)
           on conflict (sr) do update set zone = excluded.zone, name = excluded.name, position = excluded.position, photo_only = excluded.photo_only
           returning id`,
          [s.sr, s.zone, s.name, s.position, s.photoOnly ?? false])).rows[0];
        sectionsCount++;
        for (const q of s.questions) {
          await client.query(
            `insert into template_questions (section_id, qid, ref, text, position)
             values ($1,$2,$3,$4,$5)
             on conflict (section_id, qid) do update set ref = excluded.ref, text = excluded.text, position = excluded.position`,
            [sec.id, q.qid, q.ref, q.text, q.position]);
          questionsCount++;
        }
      }
      console.log(`Seeded ${sectionsCount} checklist sections and ${questionsCount} questions.`);
    } catch (err) {
      console.log('Skipping or partial checklist load:', err.message);
    }

    await client.query('commit');
    console.log('\n--- Full Flow Seeding Complete! ---');
    console.log('Credentials for all 4 test accounts: password is "password123"');
    console.log('1. Admin:           admin@ozellar.com');
    console.log('2. Tech Manager:    tech@ozellar.com');
    console.log('3. Director:        director@ozellar.com');
    console.log('4. Vessel Manager:  vessel@ozellar.com');
  } catch (err) {
    await client.query('rollback');
    console.error('Seeding error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
