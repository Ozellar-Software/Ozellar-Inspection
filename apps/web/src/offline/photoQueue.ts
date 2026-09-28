import type { PhotoTarget } from '@ozellar/shared';
import { api } from '../api/client';
import { db } from './db';
import { localWrite } from './outbox';

/** Compress on the device (same idea as the current app): longest side ≤ 1600 px, JPEG ~0.8. */
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.8): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

/** Add a photo: saved locally at once (visible immediately), metadata queued for sync, image queued for upload. */
export async function addPhoto(input: {
  file: Blob; target: PhotoTarget; inspectionId?: string | null; vesselId?: string | null;
  inspectionSectionId?: string | null; responseId?: string | null; findingId?: string | null;
  isDefect?: boolean; position: number;
}): Promise<string> {
  const photoId = crypto.randomUUID();
  const blob = await compressImage(input.file);
  await db.photoQueue.put({
    photoId, inspectionId: input.inspectionId ?? null, vesselId: input.vesselId ?? null,
    blob, status: 'pending', attempts: 0,
  });
  await localWrite('photos', photoId, {
    inspectionId: input.inspectionId ?? null, vesselId: input.vesselId ?? null, target: input.target,
    inspectionSectionId: input.inspectionSectionId ?? null, responseId: input.responseId ?? null,
    findingId: input.findingId ?? null, isDefect: !!input.isDefect, position: input.position,
    contentType: 'image/jpeg', sizeBytes: blob.size,
  });
  return photoId;
}

/** Upload pending images: get SAS URL → PUT to Blob → commit. Survives restarts; retried on next sync. */
export async function processPhotoQueue(): Promise<void> {
  const items = await db.photoQueue.where('status').anyOf('pending', 'uploading', 'uploaded').toArray();
  for (const it of items) {
    try {
      if (it.status !== 'uploaded') {
        await db.photoQueue.update(it.photoId, { status: 'uploading' });
        const { uploadUrl, headers } = await api<{ uploadUrl: string; headers: Record<string, string> }>(
          '/photos/upload-url', { body: { photoId: it.photoId, inspectionId: it.inspectionId, vesselId: it.vesselId } });
        const put = await fetch(uploadUrl, { method: 'PUT', headers, body: it.blob });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        await db.photoQueue.update(it.photoId, { status: 'uploaded' });
      }
      await api(`/photos/${it.photoId}/commit`, { method: 'POST', body: {} });
      await db.photoQueue.update(it.photoId, { status: 'committed' });
    } catch (e) {
      await db.photoQueue.update(it.photoId, {
        status: it.status === 'uploaded' ? 'uploaded' : 'pending', attempts: it.attempts + 1, lastError: (e as Error).message,
      });
    }
  }
}

/** Local blob if we still have it (offline), otherwise a short-lived read URL from the API. */
export async function photoSrc(photoId: string): Promise<string | null> {
  const local = await db.photoQueue.get(photoId);
  if (local) return URL.createObjectURL(local.blob);
  if (!navigator.onLine) return null;
  const urls = await api<Record<string, string>>('/photos/read-urls', { body: { photoIds: [photoId] } });
  return urls[photoId] ?? null;
}
