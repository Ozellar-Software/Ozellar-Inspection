import { useCallback, useEffect, useRef, useState } from 'react';
import type { Photo, PhotoTarget } from '@ozellar/shared';
import { addPhoto, photoSrc } from '../../offline/photoQueue';
import { localDelete } from '../../offline/outbox';
import { CameraIcon, UploadIcon, XIcon } from '../../icons';

/**
 * Thumbnail row + take/upload buttons for one target (a question, a finding, or a section's own photos).
 * Actual cloud upload needs a real Azure Storage account configured — locally the photo still saves,
 * compresses and displays immediately; it just stays queued as "pending" until that's set up.
 */
type SyncedPhoto = Photo & { deletedAt?: string | null };
const MAX_ATTEMPTS = 6;

export function PhotoStrip({ photos, target, inspectionId, inspectionSectionId, responseId, findingId, locked }: {
  photos: SyncedPhoto[]; target: PhotoTarget; inspectionId: string;
  inspectionSectionId?: string; responseId?: string; findingId?: string; locked: boolean;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Loading a photo URL can fail (backend restarting, offline, a link that expired) — retry with backoff instead of
  // leaving the thumbnail blank until the page is reloaded.
  const alive = useRef(true);
  const inflight = useRef(new Set<string>());
  const attempts = useRef(new Map<string, number>());
  const timers = useRef(new Set<number>());
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  const load = useCallback((id: string) => {
    if (!alive.current || inflight.current.has(id)) return;
    inflight.current.add(id);
    photoSrc(id)
      .then((src) => {
        if (!alive.current) return;
        if (!src) throw new Error('no url');
        attempts.current.delete(id);
        setUrls((u) => ({ ...u, [id]: src }));
      })
      .catch(() => scheduleRetry(id))
      .finally(() => inflight.current.delete(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleRetry = useCallback((id: string) => {
    const n = attempts.current.get(id) ?? 0;
    if (!alive.current || n >= MAX_ATTEMPTS) return;
    attempts.current.set(id, n + 1);
    const t = window.setTimeout(() => { timers.current.delete(t); load(id); }, Math.min(2000 * 2 ** n, 30_000));
    timers.current.add(t);
  }, [load]);

  useEffect(() => {
    alive.current = true;
    const onOnline = () => {
      attempts.current.clear();
      for (const p of photosRef.current) if (!urlsRef.current[p.id] && !p.deletedAt) load(p.id);
    };
    window.addEventListener('online', onOnline);
    return () => {
      alive.current = false;
      window.removeEventListener('online', onOnline);
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current.clear();
    };
  }, [load]);

  useEffect(() => {
    for (const p of photos) if (!urls[p.id] && !p.deletedAt) load(p.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      let position = photos.length;
      for (const file of Array.from(files).slice(0, 15)) {
        await addPhoto({
          file, target, inspectionId, inspectionSectionId, responseId, findingId, position: position++,
        });
      }
    } catch (err: any) {
      alert(`Photo error: ${err.message || 'Unknown compression/save error'}`);
      console.error('Photo save failed', err);
    }
  }

  return (
    <div>
      <div className="thumb-row">
        {photos.filter((p) => !p.deletedAt).map((p) => (
          <div key={p.id} className={`thumb${p.isDefect ? ' defect' : ''}`}>
            {urls[p.id] ? (
              <img src={urls[p.id]} alt="" onError={() => {
                // expired/failed link: drop it and fetch a fresh one
                setUrls((u) => { const { [p.id]: _gone, ...rest } = u; return rest; });
                scheduleRetry(p.id);
              }} />
            ) : null}
            {!locked && (
              <button className="del" aria-label="Remove photo" onClick={() => void localDelete('photos', p.id)}><XIcon /></button>
            )}
          </div>
        ))}
      </div>
      {!locked && (
        <div className="photo-btns">
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
          <button type="button" className="btn btn-outline btn-sm" onClick={() => cameraInputRef.current?.click()}><CameraIcon />Take photo</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => fileInputRef.current?.click()}><UploadIcon />Upload photos</button>
        </div>
      )}
    </div>
  );
}
