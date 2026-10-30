import { app } from '@azure/functions';
import { can, canSeeVessel, type Inspection, type User } from '@ozellar/shared';
import { requireUser } from '../lib/auth.js';
import { blobExists, photoBlobPath, readUrl, uploadBlobData, uploadUrl } from '../lib/blob.js';
import { pool } from '../lib/db.js';
import { fail, handler, jsonBody } from '../lib/http.js';

async function checkEditable(user: User, inspectionId: string | null, vesselId: string | null) {
  if (inspectionId) {
    const i = (await pool.query(`select vessel_id, status, created_by from inspections where id = $1 and deleted_at is null`, [inspectionId])).rows[0];
    if (!i) throw fail('NOT_FOUND', 'Inspection not found');
    const insp = { vesselId: i.vessel_id, status: i.status, createdBy: i.created_by } as Pick<Inspection, 'vesselId' | 'status' | 'createdBy'>;
    const isCreator = Boolean(user.id && i.created_by && user.id === i.created_by);
    const isPendingApproval = insp.status === 'pending_tm' || insp.status === 'pending_director';
    // Allow offline photos to finish syncing even if the report was already submitted or approved
    const allowPhotoSync = (isPendingApproval || isCreator || user.role === 'admin') && can(user, 'inspection.view', { inspection: insp });
    if (!can(user, 'inspection.edit', { inspection: insp }) && !allowPhotoSync) {
      throw fail('LOCKED', "This inspection can't be changed now");
    }
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
  const photoId = req.params.id;
  let p = (await pool.query(`select id, inspection_id, vessel_id, blob_path from photos where id = $1`, [photoId])).rows[0];

  // Self-heal: If metadata row hasn't synced via outbox yet, upsert row from client fallback payload
  if (!p) {
    const b = (await jsonBody<Record<string, any>>(req).catch(() => ({}))) as Record<string, any>;
    const inspectionId = b.inspectionId || null;
    const vesselId = b.vesselId || null;
    if (inspectionId || vesselId) {
      await checkEditable(user, inspectionId, vesselId);
      const blobPath = photoBlobPath({ id: photoId, inspectionId, vesselId });
      if (!(await blobExists(blobPath))) throw fail('VALIDATION', 'Upload not found in storage');
      await pool.query(
        `insert into photos (
           id, inspection_id, vessel_id, target, inspection_section_id, response_id, finding_id,
           is_defect, position, blob_path, content_type, size_bytes, uploaded, created_by, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'image/jpeg', $11, true, $12, now()
         )
         on conflict (id) do update set uploaded = true, updated_at = now()`,
        [
          photoId, inspectionId, vesselId, b.target || 'question',
          b.inspectionSectionId || null, b.responseId || null, b.findingId || null,
          !!b.isDefect, Number(b.position || 0), blobPath, Number(b.sizeBytes || 0), user.id,
        ]
      );
      return { ok: true };
    }
    throw fail('NOT_FOUND', 'Photo metadata not synced yet — retry after sync');
  }

  await checkEditable(user, p.inspection_id, p.vessel_id);
  if (!(await blobExists(p.blob_path))) throw fail('VALIDATION', 'Upload not found');
  await pool.query(`update photos set uploaded = true where id = $1`, [p.id]);
  return { ok: true };
});
app.http('photos-commit', {
  route: 'photos/{id}/commit', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: photosCommitHandler,
});

/**
 * Direct Server Upload Fallback: Receives the JPEG buffer directly from the client.
 * Bypasses all client-side Azure CORS, SAS, or mobile carrier blocking.
 * Uploads buffer directly to Azure Blob Storage and marks photo uploaded in PostgreSQL.
 */
export const photosUploadDirectHandler = handler(async (req) => {
  const user = await requireUser(req);
  const photoId = req.params.id;
  if (!photoId) throw fail('VALIDATION', 'photoId required');

  const arrayBuf = await req.arrayBuffer();
  if (!arrayBuf || arrayBuf.byteLength === 0) throw fail('VALIDATION', 'No image data received');
  const buffer = Buffer.from(arrayBuf);

  const inspectionId = req.headers.get('x-inspection-id') || null;
  const vesselId = req.headers.get('x-vessel-id') || null;
  const target = req.headers.get('x-target') || 'question';
  const inspectionSectionId = req.headers.get('x-section-id') || null;
  const responseId = req.headers.get('x-response-id') || null;
  const findingId = req.headers.get('x-finding-id') || null;
  const isDefect = req.headers.get('x-is-defect') === 'true';
  const position = Number(req.headers.get('x-position') || 0);

  await checkEditable(user, inspectionId, vesselId);

  const blobPath = photoBlobPath({ id: photoId, inspectionId, vesselId });

  // 1. Upload buffer to Azure Blob Storage
  await uploadBlobData(blobPath, buffer, 'image/jpeg');

  // 2. Ensure photo row is in PostgreSQL with uploaded = true
  await pool.query(
    `insert into photos (
       id, inspection_id, vessel_id, target, inspection_section_id, response_id, finding_id,
       is_defect, position, blob_path, content_type, size_bytes, uploaded, created_by, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'image/jpeg', $11, true, $12, now()
     )
     on conflict (id) do update set
       uploaded = true,
       blob_path = excluded.blob_path,
       size_bytes = excluded.size_bytes,
       updated_at = now()`,
    [
      photoId,
      inspectionId,
      vesselId,
      target,
      inspectionSectionId,
      responseId,
      findingId,
      isDefect,
      position,
      blobPath,
      buffer.length,
      user.id,
    ]
  );

  return { ok: true, blobPath };
});
app.http('photos-upload-direct', {
  route: 'photos/{id}/upload',
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: photosUploadDirectHandler,
});

/** Batch read URLs (60 min) for photos the caller may see. */
export const photosReadUrlsHandler = handler(async (req) => {
  const user = await requireUser(req);
  const { photoIds } = await jsonBody<{ photoIds: string[] }>(req);
  if (!Array.isArray(photoIds) || photoIds.length > 200) throw fail('VALIDATION', 'photoIds: 1–200 ids');
  const r = await pool.query(
    `select p.id, p.blob_path, coalesce(i.vessel_id, p.vessel_id) as vessel_id, i.created_by
       from photos p left join inspections i on i.id = p.inspection_id
      where p.id = any($1) and p.uploaded and p.deleted_at is null`, [photoIds]);
  const out: Record<string, string> = {};
  for (const row of r.rows) if (canSeeVessel(user, row.vessel_id) || row.created_by === user.id) out[row.id] = await readUrl(row.blob_path);
  return out;
});
app.http('photos-read-urls', {
  route: 'photos/read-urls', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: photosReadUrlsHandler,
});
