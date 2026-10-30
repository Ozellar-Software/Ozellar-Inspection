import type { PhotoTarget } from '@ozellar/shared';
import { api } from '../api/client';
import { db } from './db';
import { localWrite } from './outbox';

export async function compressImage(file: Blob, maxSide = 1600, quality = 0.8): Promise<Blob> {
  // Use modern createImageBitmap if available, with EXIF orientation preservation
  let width = 0;
  let height = 0;
  let drawable: CanvasImageSource | null = null;
  let bmp: ImageBitmap | null = null;
  
  if (typeof createImageBitmap !== 'undefined') {
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try {
        bmp = await createImageBitmap(file);
      } catch {
        bmp = null;
      }
    }
    if (bmp) {
      width = bmp.width;
      height = bmp.height;
      drawable = bmp;
    }
  }

  if (!drawable) {
    // Fallback for older Safari/iOS
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
    URL.revokeObjectURL(url);
    width = img.width;
    height = img.height;
    drawable = img;
  }

  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  try {
    // Use OffscreenCanvas if available
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const canvas = new OffscreenCanvas(w, h);
        canvas.getContext('2d')!.drawImage(drawable, 0, 0, w, h);
        return await canvas.convertToBlob({ type: 'image/jpeg', quality });
      } catch (e) {
        // ignore and fallback
      }
    }

    // Fallback standard DOM canvas
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(drawable, 0, 0, w, h);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/jpeg', quality);
    });
  } finally {
    // Release uncompressed GPU bitmap texture memory immediately to prevent mobile browser memory exhaustion
    if (bmp) {
      try { bmp.close(); } catch { /* ignore */ }
    }
  }
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
  // Dual-store in Service Worker CacheStorage so image binary is preserved in two independent storages
  void putCachedBlobToServiceWorker(photoId, blob);
  // Immediately cache blob URL in memory so thumbnails render instantly without waiting for async DB fetch
  const objUrl = URL.createObjectURL(blob);
  blobUrlCache.set(photoId, objUrl);

  await localWrite('photos', photoId, {
    inspectionId: input.inspectionId ?? null, vesselId: input.vesselId ?? null, target: input.target,
    inspectionSectionId: input.inspectionSectionId ?? null, responseId: input.responseId ?? null,
    findingId: input.findingId ?? null, isDefect: !!input.isDefect, position: input.position,
    contentType: 'image/jpeg', sizeBytes: blob.size,
  });
  return photoId;
}

// ─── Photo sync progress (used by PhotoSyncBanner) ──────────────────────────────────────────
export interface PhotoSyncProgress {
  pending: number;
  total: number;
  uploaded: number;
  isUploading: boolean;
}
const progressListeners = new Set<(p: PhotoSyncProgress) => void>();

/** Subscribe to live upload progress updates. Returns an unsubscribe function. */
export function subscribePhotoSync(cb: (p: PhotoSyncProgress) => void): () => void {
  progressListeners.add(cb);
  return () => { progressListeners.delete(cb); };
}

function emitProgress(pending: number, total: number, uploaded: number, isUploading: boolean): void {
  const p: PhotoSyncProgress = { pending, total, uploaded, isUploading };
  progressListeners.forEach((cb) => { try { cb(p); } catch { /* ignore */ } });
}

// ─── Screen Wake Lock (prevents phone from sleeping mid-upload) ─────────────────────────
let wakeLock: WakeLockSentinel | null = null;

async function acquireWakeLock(): Promise<void> {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {
    // Wake Lock not supported on this device/OS — non-fatal
  }
}

function releaseWakeLock(): void {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

let photoProcessing: Promise<void> | null = null;
let rerunPhotoProcessing = false;

/** Upload pending images with dual-strategy fallback:
 *  1. Try direct Azure Blob SAS PUT with 20s timeout and self-healing commit.
 *  2. Fallback to direct server upload (/api/photos/:id/upload) if Azure fails (zero CORS, 100% reliable).
 *  Runs up to 4 parallel uploads under Screen Wake Lock and emits accurate live progress. */
export function processPhotoQueue(): Promise<void> {
  if (photoProcessing) {
    rerunPhotoProcessing = true;
    return photoProcessing;
  }
  photoProcessing = (async () => {
    do {
      rerunPhotoProcessing = false;
      const items = await db.photoQueue.where('status').anyOf('pending', 'uploading', 'uploaded').toArray();
      if (!items.length) {
        emitProgress(0, 0, 0, false);
        break;
      }

      await acquireWakeLock();

      // Filter out orphaned / soft-deleted entries first
      const uploadable: typeof items = [];
      for (const it of items) {
        const photoRow = await db.photos.get(it.photoId);
        if (photoRow?.deletedAt) { await db.photoQueue.delete(it.photoId); continue; }
        if (it.inspectionId) {
          const insp = await db.inspections.get(it.inspectionId);
          if (insp?.deletedAt) { await db.photoQueue.delete(it.photoId); continue; }
        }
        uploadable.push(it);
      }

      if (!uploadable.length) { emitProgress(0, 0, 0, false); break; }

      const total = uploadable.length;
      let remainingCount = total;
      let successfulCount = 0;
      emitProgress(remainingCount, total, successfulCount, true);

      // Parallel upload — 4 concurrent workers
      const CONCURRENCY = 4;
      const queue = [...uploadable];

      const worker = async () => {
        for (let it: typeof uploadable[0] | undefined; (it = queue.shift());) {
          let uploadSucceeded = false;
          try {
            // Recover blob if missing from IndexedDB (check CacheStorage)
            if (!it.blob) {
              it.blob = (await getCachedBlobFromServiceWorker(it.photoId)) ?? (undefined as any);
            }
            if (!it.blob) {
              console.warn('[PhotoQueue] Blob unavailable for photo', it.photoId);
              continue;
            }

            const localPhoto = await db.photos.get(it.photoId);

            // Strategy 1: Direct Azure SAS PUT
            if (it.status !== 'uploaded') {
              try {
                await db.photoQueue.update(it.photoId, { status: 'uploading' });
                const { uploadUrl, headers } = await api<{ uploadUrl: string; headers: Record<string, string> }>(
                  '/photos/upload-url', { body: { photoId: it.photoId, inspectionId: it.inspectionId, vesselId: it.vesselId } });
                const ctrl = new AbortController();
                const tid = setTimeout(() => ctrl.abort(), 20_000);
                const put = await fetch(uploadUrl, { method: 'PUT', headers, body: it.blob, signal: ctrl.signal });
                clearTimeout(tid);
                if (put.ok) {
                  await db.photoQueue.update(it.photoId, { status: 'uploaded' });
                  uploadSucceeded = true;
                } else {
                  console.warn(`[PhotoQueue] SAS PUT failed with status ${put.status}`);
                }
              } catch (sasErr) {
                console.warn('[PhotoQueue] Direct SAS PUT failed, trying direct server upload:', (sasErr as Error)?.message);
              }
            } else {
              uploadSucceeded = true;
            }

            // Commit Strategy 1 if SAS PUT was used
            if (uploadSucceeded) {
              try {
                await api(`/photos/${it.photoId}/commit`, {
                  method: 'POST',
                  body: {
                    inspectionId: it.inspectionId ?? localPhoto?.inspectionId,
                    vesselId: it.vesselId ?? localPhoto?.vesselId,
                    target: localPhoto?.target ?? 'question',
                    inspectionSectionId: localPhoto?.inspectionSectionId,
                    responseId: localPhoto?.responseId,
                    findingId: localPhoto?.findingId,
                    isDefect: localPhoto?.isDefect,
                    position: localPhoto?.position,
                    sizeBytes: it.blob.size,
                  },
                });
                await db.photoQueue.update(it.photoId, { status: 'committed' });
                successfulCount++;
                continue;
              } catch (commitErr) {
                console.warn('[PhotoQueue] Commit failed, falling back to direct server upload:', (commitErr as Error)?.message);
              }
            }

            // Strategy 2: Direct Server Upload Fallback (Zero CORS, 100% reliable)
            const token = localStorage.getItem('token') ?? '';
            const fallbackRes = await fetch(`/api/photos/${it.photoId}/upload`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'image/jpeg',
                'x-inspection-id': it.inspectionId ?? localPhoto?.inspectionId ?? '',
                'x-vessel-id': it.vesselId ?? localPhoto?.vesselId ?? '',
                'x-target': localPhoto?.target ?? 'question',
                'x-section-id': localPhoto?.inspectionSectionId ?? '',
                'x-response-id': localPhoto?.responseId ?? '',
                'x-finding-id': localPhoto?.findingId ?? '',
                'x-is-defect': String(!!localPhoto?.isDefect),
                'x-position': String(localPhoto?.position ?? 0),
              },
              body: it.blob,
            });

            if (!fallbackRes.ok) {
              const errTxt = await fallbackRes.text().catch(() => '');
              throw new Error(`Upload failed (${fallbackRes.status}): ${errTxt.slice(0, 100)}`);
            }

            await db.photoQueue.update(it.photoId, { status: 'committed' });
            successfulCount++;
          } catch (e) {
            console.error('[PhotoQueue] Upload failed for', it.photoId, e);
            await db.photoQueue.update(it.photoId, {
              status: it.status === 'uploaded' ? 'uploaded' : 'pending',
              attempts: it.attempts + 1,
              lastError: (e as Error).message,
            });
          } finally {
            remainingCount--;
            emitProgress(remainingCount, total, successfulCount, remainingCount > 0);
          }
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } while (rerunPhotoProcessing && navigator.onLine);

    releaseWakeLock();
  })().finally(() => { photoProcessing = null; });
  return photoProcessing;
}

const photoUrlCache = new Map<string, { url: string; expires: number }>();
const blobUrlCache = new Map<string, string>();
const downloadingBlobs = new Set<string>();

/**
 * Evicts a photo from all caches (in-memory URL caches, IndexedDB photoQueue, CacheStorage).
 * Must be called whenever a photo is soft-deleted locally or confirmed deleted from server.
 */
export async function evictPhotoCache(photoId: string): Promise<void> {
  // Revoke and remove any in-memory object URL to free memory
  const objUrl = blobUrlCache.get(photoId);
  if (objUrl && objUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(objUrl); } catch { /* ignore */ }
  }
  blobUrlCache.delete(photoId);
  photoUrlCache.delete(photoId);
  downloadingBlobs.delete(photoId);

  // Remove from IndexedDB photoQueue (no longer needed to upload)
  try {
    await db.photoQueue.delete(photoId);
  } catch { /* ignore */ }

  // Remove from CacheStorage (service worker cache)
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(PHOTO_CACHE_NAME);
      await cache.delete(`/cached-photos/${photoId}`);
    } catch { /* ignore */ }
  }
}

const PHOTO_CACHE_NAME = 'ozellar-photo-cache-v1';

async function getCachedBlobFromServiceWorker(photoId: string): Promise<Blob | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(PHOTO_CACHE_NAME);
    const match = await cache.match(`/cached-photos/${photoId}`);
    if (match) {
      return await match.blob();
    }
  } catch {
    // ignore
  }
  return null;
}

async function putCachedBlobToServiceWorker(photoId: string, blob: Blob): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(PHOTO_CACHE_NAME);
    const resp = new Response(blob, {
      headers: { 'Content-Type': blob.type || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' },
    });
    await cache.put(`/cached-photos/${photoId}`, resp);
  } catch {
    // ignore
  }
}

/** Caches a photo blob into Dexie IndexedDB and browser CacheStorage for 100% offline access. */
export async function cachePhotoBlob(photoId: string, blob: Blob, inspectionId?: string | null): Promise<string> {
  try {
    const existing = await db.photoQueue.get(photoId);
    if (!existing) {
      await db.photoQueue.put({
        photoId,
        inspectionId: inspectionId ?? null,
        vesselId: null,
        blob,
        status: 'committed',
        attempts: 0,
      });
    } else if (!existing.blob) {
      await db.photoQueue.update(photoId, { blob });
    }
  } catch (err) {
    console.warn('[Photo] Error saving blob to IndexedDB:', err);
  }

  await putCachedBlobToServiceWorker(photoId, blob);

  const existingUrl = blobUrlCache.get(photoId);
  if (existingUrl) return existingUrl;

  const objUrl = URL.createObjectURL(blob);
  blobUrlCache.set(photoId, objUrl);
  return objUrl;
}

/** Downloads and permanently stores a remote photo blob in the background. */
async function backgroundDownloadBlob(photoId: string, remoteUrl: string): Promise<void> {
  if (downloadingBlobs.has(photoId) || blobUrlCache.has(photoId)) return;
  downloadingBlobs.add(photoId);
  try {
    const meta = await db.photos.get(photoId);
    const resp = await fetch(remoteUrl);
    if (resp.ok) {
      const blob = await resp.blob();
      await cachePhotoBlob(photoId, blob, meta?.inspectionId);
    }
  } catch {
    // non-fatal background fetch
  } finally {
    downloadingBlobs.delete(photoId);
  }
}

/** Resolves photo image URL from local IndexedDB/CacheStorage offline, or remote SAS URL online. */
export async function photoSrc(photoId: string): Promise<string | null> {
  if (!photoId) return null;

  // 1. In-memory object URL cache (instant, no memory leak)
  if (blobUrlCache.has(photoId)) {
    return blobUrlCache.get(photoId)!;
  }

  // 2. Local IndexedDB photoQueue blob
  try {
    const local = await db.photoQueue.get(photoId);
    if (local?.blob) {
      const objUrl = URL.createObjectURL(local.blob);
      blobUrlCache.set(photoId, objUrl);
      return objUrl;
    }
  } catch {
    // ignore
  }

  // 3. Browser CacheStorage blob
  const swBlob = await getCachedBlobFromServiceWorker(photoId);
  if (swBlob) {
    const objUrl = URL.createObjectURL(swBlob);
    blobUrlCache.set(photoId, objUrl);
    // Backfill Dexie so both storages stay synchronized
    await db.photoQueue.put({
      photoId,
      inspectionId: null,
      vesselId: null,
      blob: swBlob,
      status: 'committed',
      attempts: 0,
    }).catch(() => {});
    return objUrl;
  }

  // 4. In-memory SAS URL cache (valid only for current session online)
  const cached = photoUrlCache.get(photoId);
  if (cached && cached.expires > Date.now()) {
    if (navigator.onLine) {
      void backgroundDownloadBlob(photoId, cached.url);
    }
    return cached.url;
  }

  // 5. If completely offline and no local blob exists
  if (!navigator.onLine) {
    return null;
  }

  // 6. Online: Fetch SAS read URL from API and eagerly persist blob locally
  try {
    const urls = await api<Record<string, string>>('/photos/read-urls', { body: { photoIds: [photoId] } });
    const url = urls[photoId] ?? null;
    if (url) {
      photoUrlCache.set(photoId, { url, expires: Date.now() + 50 * 60_000 });
      void backgroundDownloadBlob(photoId, url);
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

/** Batch resolve photo URLs for high performance (checks local blobs first, batches remote online). */
export async function getPhotoUrls(photoIds: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const missing: string[] = [];

  for (const id of photoIds) {
    if (!id) continue;
    if (blobUrlCache.has(id)) {
      result[id] = blobUrlCache.get(id)!;
      continue;
    }
    try {
      const local = await db.photoQueue.get(id);
      if (local?.blob) {
        const obj = URL.createObjectURL(local.blob);
        blobUrlCache.set(id, obj);
        result[id] = obj;
        continue;
      }
    } catch {
      // ignore
    }

    const swBlob = await getCachedBlobFromServiceWorker(id);
    if (swBlob) {
      const obj = URL.createObjectURL(swBlob);
      blobUrlCache.set(id, obj);
      result[id] = obj;
      continue;
    }

    const cached = photoUrlCache.get(id);
    if (cached && cached.expires > Date.now()) {
      result[id] = cached.url;
      if (navigator.onLine) void backgroundDownloadBlob(id, cached.url);
      continue;
    }
    missing.push(id);
  }

  if (missing.length > 0 && navigator.onLine) {
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      try {
        const fetched = await api<Record<string, string>>('/photos/read-urls', { body: { photoIds: chunk } });
        for (const [id, url] of Object.entries(fetched)) {
          if (url) {
            photoUrlCache.set(id, { url, expires: Date.now() + 50 * 60_000 });
            result[id] = url;
            void backgroundDownloadBlob(id, url);
          }
        }
      } catch (err) {
        console.error('Failed to batch fetch photo urls', err);
      }
    }
  }

  return result;
}

/** Eagerly prefetch and cache all photos for an inspection so they are 100% available offline. */
export async function prefetchInspectionPhotos(inspectionId: string): Promise<void> {
  if (!navigator.onLine || !inspectionId) return;
  try {
    const inspectionPhotos = await db.photos.where('inspectionId').equals(inspectionId).toArray();
    const active = inspectionPhotos.filter((p) => !p.deletedAt);
    if (!active.length) return;

    const uncachedIds: string[] = [];
    for (const p of active) {
      if (blobUrlCache.has(p.id)) continue;
      const existing = await db.photoQueue.get(p.id);
      if (!existing?.blob) {
        uncachedIds.push(p.id);
      }
    }

    if (!uncachedIds.length) return;

    for (let i = 0; i < uncachedIds.length; i += 50) {
      const batch = uncachedIds.slice(i, i + 50);
      try {
        const urlMap = await api<Record<string, string>>('/photos/read-urls', { body: { photoIds: batch } });
        await Promise.allSettled(
          Object.entries(urlMap).map(async ([photoId, url]) => {
            if (!url) return;
            const resp = await fetch(url);
            if (resp.ok) {
              const blob = await resp.blob();
              await cachePhotoBlob(photoId, blob, inspectionId);
            }
          })
        );
      } catch (e) {
        console.warn('[Photo] Error in prefetch batch:', e);
      }
    }
  } catch (err) {
    console.warn('[Photo] Failed prefetching inspection photos:', err);
  }
}

