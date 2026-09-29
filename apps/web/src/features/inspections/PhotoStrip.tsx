import { useEffect, useRef, useState } from 'react';
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

export function PhotoStrip({ photos, target, inspectionId, inspectionSectionId, responseId, findingId, locked }: {
  photos: SyncedPhoto[]; target: PhotoTarget; inspectionId: string;
  inspectionSectionId?: string; responseId?: string; findingId?: string; locked: boolean;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    for (const p of photos) {
      if (urls[p.id] || p.deletedAt) continue;
      void photoSrc(p.id).then((src) => { if (!cancelled && src) setUrls((u) => ({ ...u, [p.id]: src })); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    let position = photos.length;
    for (const file of Array.from(files).slice(0, 15)) {
      await addPhoto({
        file, target, inspectionId, inspectionSectionId, responseId, findingId, position: position++,
      });
    }
  }

  return (
    <div>
      <div className="thumb-row">
        {photos.filter((p) => !p.deletedAt).map((p) => (
          <div key={p.id} className={`thumb${p.isDefect ? ' defect' : ''}`}>
            {urls[p.id] ? <img src={urls[p.id]} alt="" /> : null}
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
