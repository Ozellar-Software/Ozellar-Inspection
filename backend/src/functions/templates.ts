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
  const r = await pool.query(`select * from template_sections where deleted_at is null order by position`);
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
