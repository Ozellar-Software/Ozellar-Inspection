import { app } from '@azure/functions';
import { can, type User } from '@ozellar/shared';
import { requireUser } from '../lib/auth.js';
import { pool, tx, type Tx } from '../lib/db.js';
import { camel, fail, handler, jsonBody } from '../lib/http.js';

function requireAdmin(user: User): void {
  if (!can(user, 'checklist.manage')) throw fail('FORBIDDEN', 'Only an Admin can manage the checklist template');
}

export const templateSectionsListHandler = handler(async (req) => {
  await requireUser(req);
  const r = await pool.query(`select * from template_sections where deleted_at is null order by photo_only asc, position asc`);
  return r.rows.map((row) => ({
    ...camel(row),
    vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
  }));
});
app.http('template-sections-list', { route: 'templates/sections/list', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', handler: templateSectionsListHandler });

export const templateSectionUpsertHandler = handler(async (req) => {
  const user = await requireUser(req);
  requireAdmin(user);
  const b = await jsonBody<{ id?: string; zone?: string; name: string; photoOnly?: boolean; vesselTypes?: string[] }>(req);
  if (!b.name?.trim()) throw fail('VALIDATION', 'Section name is required');

  return tx(async (c) => {
    const vesselTypes = Array.isArray(b.vesselTypes) ? b.vesselTypes.map((v) => String(v).trim()).filter(Boolean) : [];
    if (b.id) {
      const r = await c.query(
        `update template_sections set zone = $2, name = $3, photo_only = $4, vessel_types = $5 where id = $1 and deleted_at is null returning *`,
        [b.id, b.zone ?? '', b.name.trim(), !!b.photoOnly, vesselTypes]);
      if (!r.rows[0]) throw fail('NOT_FOUND', 'Section not found');
      return {
        ...camel(r.rows[0]),
        vesselTypes: Array.isArray(r.rows[0].vessel_types) ? r.rows[0].vessel_types : [],
      };
    }
    const sr = (await c.query(`select coalesce(max(sr), 0) + 1 as next from template_sections`)).rows[0].next as number;
    const pos = (await c.query(`select coalesce(max(position), -1) + 1 as next from template_sections where deleted_at is null`)).rows[0].next as number;
    const created = (await c.query(
      `insert into template_sections (id, sr, zone, name, position, photo_only, vessel_types) values (gen_random_uuid(), $1, $2, $3, $4, $5, $6) returning *`,
      [sr, b.zone ?? '', b.name.trim(), pos, !!b.photoOnly, vesselTypes])).rows[0];
    return {
      ...camel(created),
      vesselTypes: Array.isArray(created.vessel_types) ? created.vessel_types : [],
    };
  });
});
app.http('template-sections-upsert', { route: 'templates/sections', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler: templateSectionUpsertHandler });

export const templateSectionDeleteHandler = handler(async (req) => {
  const user = await requireUser(req);
  requireAdmin(user);
  const id = req.params.id;
  await tx(async (c) => {
    await c.query(`update template_questions set deleted_at = now() where section_id = $1 and deleted_at is null`, [id]);
    const r = await c.query(`update template_sections set deleted_at = now() where id = $1 and deleted_at is null returning id`, [id]);
    if (!r.rows[0]) throw fail('NOT_FOUND', 'Section not found');
  });
  return { ok: true };
});
app.http('template-sections-delete', { route: 'templates/sections/{id}', methods: ['DELETE', 'OPTIONS'], authLevel: 'anonymous', handler: templateSectionDeleteHandler });

export const templateSectionsReorderHandler = handler(async (req) => {
  const user = await requireUser(req);
  requireAdmin(user);
  const b = await jsonBody<{ ids: string[] }>(req);
  if (!Array.isArray(b.ids) || !b.ids.length) throw fail('VALIDATION', 'ids is required');
  await tx(async (c) => {
    for (let i = 0; i < b.ids.length; i++) await c.query(`update template_sections set position = $2 where id = $1`, [b.ids[i], i]);
  });
  return { ok: true };
});
app.http('template-sections-reorder', { route: 'templates/sections/reorder', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler: templateSectionsReorderHandler });

export const templateSectionsApplyDefaultHandler = handler(async (req) => {
  const user = await requireUser(req);
  requireAdmin(user);
  const b = await jsonBody<{ vesselType: string }>(req);
  const vesselType = b.vesselType?.trim();
  if (!vesselType) throw fail('VALIDATION', 'vesselType is required');

  return tx(async (c) => {
    // 1. Load all active Default (Universal) sections (empty vessel_types)
    const defaultSecsRes = await c.query(
      `select * from template_sections
       where deleted_at is null and coalesce(array_length(vessel_types, 1), 0) = 0
       order by photo_only asc, position asc`
    );
    const defaultSecs = defaultSecsRes.rows;
    if (!defaultSecs.length) {
      return { createdSections: [], createdQuestions: [], skippedCount: 0 };
    }

    // 2. Load all active non-universal sections so we can either skip (if already has vesselType)
    //    or append vesselType to an existing section with the same (name, photo_only) instead of duplicating rows
    const nonUniversalRes = await c.query(
      `select * from template_sections
       where deleted_at is null and coalesce(array_length(vessel_types, 1), 0) > 0
       order by position asc`
    );
    const byKey = new Map<string, any>();
    for (const row of nonUniversalRes.rows) {
      const key = `${String(row.name ?? '').trim().toLowerCase()}::${Boolean(row.photo_only)}`;
      if (!byKey.has(key)) byKey.set(key, row);
    }

    let nextSr = Number((await c.query(`select coalesce(max(sr), 0) + 1 as next from template_sections`)).rows[0].next);
    let nextPos = Number((await c.query(`select coalesce(max(position), -1) + 1 as next from template_sections where deleted_at is null`)).rows[0].next);

    const createdSections: Record<string, unknown>[] = [];
    const createdQuestions: Record<string, unknown>[] = [];
    let skippedCount = 0;

    for (const ds of defaultSecs) {
      const key = `${String(ds.name ?? '').trim().toLowerCase()}::${Boolean(ds.photo_only)}`;
      const existing = byKey.get(key);

      if (existing) {
        const curTypes: string[] = Array.isArray(existing.vessel_types) ? existing.vessel_types : [];
        const alreadyHas = curTypes.some((t) => String(t).trim().toLowerCase() === vesselType.toLowerCase());
        if (alreadyHas) {
          skippedCount++;
          continue;
        }
        const nextTypes = [...curTypes, vesselType];
        const updSec = (await c.query(
          `update template_sections set vessel_types = $2::text[] where id = $1 returning *`,
          [existing.id, nextTypes]
        )).rows[0];
        existing.vessel_types = nextTypes;
        createdSections.push({
          ...camel(updSec),
          vesselTypes: Array.isArray(updSec.vessel_types) ? updSec.vessel_types : nextTypes,
        });
        continue;
      }

      const insSec = (await c.query(
        `insert into template_sections (id, sr, zone, name, position, photo_only, vessel_types)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6::text[])
         returning *`,
        [nextSr++, ds.zone ?? '', ds.name, nextPos++, !!ds.photo_only, [vesselType]]
      )).rows[0];

      byKey.set(key, insSec);

      createdSections.push({
        ...camel(insSec),
        vesselTypes: Array.isArray(insSec.vessel_types) ? insSec.vessel_types : [vesselType],
      });

      // Copy all active questions from the default section into the new vessel-type section
      const qsRes = await c.query(
        `select * from template_questions where section_id = $1 and deleted_at is null order by position asc`,
        [ds.id]
      );
      for (const q of qsRes.rows) {
        const qidVal = Number.isInteger(Number(q.qid)) ? Number(q.qid) : (q.position ?? 1);
        const insQ = (await c.query(
          `insert into template_questions (id, section_id, qid, ref, text, position)
           values (gen_random_uuid(), $1, $2, $3, $4, $5)
           returning *`,
          [insSec.id, qidVal, q.ref ?? '', q.text, q.position]
        )).rows[0];
        createdQuestions.push(camel(insQ));
      }
    }

    return { createdSections, createdQuestions, skippedCount };
  });
});
app.http('template-sections-apply-default', { route: 'templates/sections/apply-default', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler: templateSectionsApplyDefaultHandler });

/* ------------------------------------------------------------------ Questions */

export const templateQuestionsListHandler = handler(async (req) => {
  await requireUser(req);
  const r = await pool.query(`select * from template_questions where deleted_at is null order by position`);
  return r.rows.map((row) => camel(row));
});
app.http('template-questions-list', { route: 'templates/questions/list', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', handler: templateQuestionsListHandler });

export const templateQuestionUpsertHandler = handler(async (req) => {
  const user = await requireUser(req);
  requireAdmin(user);
  const b = await jsonBody<{ id?: string; sectionId?: string; ref?: string; text: string }>(req);
  if (!b.text?.trim()) throw fail('VALIDATION', 'Question text is required');

  return tx(async (c) => {
    if (b.id) {
      const r = await c.query(
        `update template_questions set ref = $2, text = $3 where id = $1 and deleted_at is null returning *`,
        [b.id, b.ref ?? '', b.text.trim()]);
      if (!r.rows[0]) throw fail('NOT_FOUND', 'Question not found');
      return camel(r.rows[0]);
    }
    if (!b.sectionId) throw fail('VALIDATION', 'sectionId is required');
    const qid = (await c.query(`select coalesce(max(qid), 0) + 1 as next from template_questions where section_id = $1`, [b.sectionId])).rows[0].next as number;
    const pos = (await c.query(`select coalesce(max(position), -1) + 1 as next from template_questions where section_id = $1 and deleted_at is null`, [b.sectionId])).rows[0].next as number;
    const r = await c.query(
      `insert into template_questions (id, section_id, qid, ref, text, position) values (gen_random_uuid(), $1, $2, $3, $4, $5) returning *`,
      [b.sectionId, qid, b.ref ?? '', b.text.trim(), pos]);
    return camel(r.rows[0]);
  });
});
app.http('template-questions-upsert', { route: 'templates/questions', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler: templateQuestionUpsertHandler });

export const templateQuestionDeleteHandler = handler(async (req) => {
  const user = await requireUser(req);
  requireAdmin(user);
  const r = await pool.query(`update template_questions set deleted_at = now() where id = $1 and deleted_at is null returning id`, [req.params.id]);
  if (!r.rows[0]) throw fail('NOT_FOUND', 'Question not found');
  return { ok: true };
});
app.http('template-questions-delete', { route: 'templates/questions/{id}', methods: ['DELETE', 'OPTIONS'], authLevel: 'anonymous', handler: templateQuestionDeleteHandler });

export const templateQuestionsReorderHandler = handler(async (req) => {
  const user = await requireUser(req);
  requireAdmin(user);
  const b = await jsonBody<{ ids: string[] }>(req);
  if (!Array.isArray(b.ids) || !b.ids.length) throw fail('VALIDATION', 'ids is required');
  await tx(async (c) => {
    for (let i = 0; i < b.ids.length; i++) await c.query(`update template_questions set position = $2 where id = $1`, [b.ids[i], i]);
  });
  return { ok: true };
});
app.http('template-questions-reorder', { route: 'templates/questions/reorder', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler: templateQuestionsReorderHandler });
