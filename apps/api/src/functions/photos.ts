import { app } from '@azure/functions';
import { can, canSeeVessel, type Inspection, type User } from '@ozellar/shared';
import { requireUser } from '../lib/auth.js';
import { blobExists, photoBlobPath, readUrl, uploadUrl } from '../lib/blob.js';
import { pool } from '../lib/db.js';
import { fail, handler, jsonBody } from '../lib/http.js';

async function checkEditable(user: User, inspectionId: string | null, vesselId: string | null) {
  if (inspectionId) {
    const i = (await pool.query(`select vessel_id, status from inspections where id = $1 and deleted_at is null`, [inspectionId])).rows[0];
    if (!i) throw fail('NOT_FOUND', 'Inspection not found');
    const insp = { vesselId: i.vessel_id, status: i.status } as Pick<Inspection, 'vesselId' | 'status'>;
    if (!can(user, 'inspection.edit', { inspection: insp })) throw fail('LOCKED', 'This inspection can’t be changed now');
  } else if (vesselId) {
    if (!can(user, 'vessels.manage')) throw fail('FORBIDDEN', 'Only an Admin can change vessel photos');
  } else {
    throw fail('VALIDATION', 'inspectionId or vesselId required');
  }
}

/**
 * Step 1 of a photo upload. The photo's metadata row is created through /sync/push (offline-safe);
 * this only returns a 15-minute write-only URL for the image itself.
 */
export const photosUploadUrlHandler = handler(async (req) => {
    const user = await requireUser(req);
    const b = await jsonBody<{ photoId: string; inspectionId?: string; vesselId?: string }>(req);
    if (!b.photoId) throw fail('VALIDATION', 'photoId required');
    await checkEditable(user, b.inspectionId ?? null, b.vesselId ?? null);
    const blobPath = photoBlobPath({ id: b.photoId, inspectionId: b.inspectionId, vesselId: b.vesselId });
    return { blobPath, uploadUrl: await uploadUrl(blobPath), headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'image/jpeg' } };
  });
app.http('photos-upload-url', {
  route: 'photos/upload-url', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: photosUploadUrlHandler,
});

/** Step 2: after the PUT succeeded, mark the photo as uploaded (verifies the blob exists). */
export const photosCommitHandler = handler(async (req) => {
    const user = await requireUser(req);
    const p = (await pool.query(`select id, inspection_id, vessel_id, blob_path from photos where id = $1`, [req.params.id])).rows[0];
    if (!p) throw fail('NOT_FOUND', 'Photo metadata not synced yet — retry after sync');
    await checkEditable(user, p.inspection_id, p.vessel_id);
    if (!(await blobExists(p.blob_path))) throw fail('VALIDATION', 'Upload not found');
    await pool.query(`update photos set uploaded = true where id = $1`, [p.id]);
    return { ok: true };
  });
app.http('photos-commit', {
  route: 'photos/{id}/commit', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: photosCommitHandler,
});

/** Batch read URLs (60 min) for photos the caller may see. */
export const photosReadUrlsHandler = handler(async (req) => {
    const user = await requireUser(req);
    const { photoIds } = await jsonBody<{ photoIds: string[] }>(req);
    if (!Array.isArray(photoIds) || photoIds.length > 200) throw fail('VALIDATION', 'photoIds: 1–200 ids');
    const r = await pool.query(
      `select p.id, p.blob_path, coalesce(i.vessel_id, p.vessel_id) as vessel_id
         from photos p left join inspections i on i.id = p.inspection_id
        where p.id = any($1) and p.uploaded and p.deleted_at is null`, [photoIds]);
    const out: Record<string, string> = {};
    for (const row of r.rows) if (canSeeVessel(user, row.vessel_id)) out[row.id] = await readUrl(row.blob_path);
    return out;
  });
app.http('photos-read-urls', {
  route: 'photos/read-urls', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: photosReadUrlsHandler,
});
