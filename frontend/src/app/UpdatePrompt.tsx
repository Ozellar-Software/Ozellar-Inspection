import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db } from '../offline/db';
import { processPhotoQueue } from '../offline/photoQueue';

/**
 * PWA update banner shown when a new service-worker version is waiting.
 *
 * If the user has pending photo uploads in their local queue, we warn them
 * and kick off the upload automatically when they tap "Update now" so the
 * photos are safely in the cloud before the service-worker swaps in.
 */
export function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => void reg.update(), 10 * 60_000); },
  });

  const [pendingPhotos, setPendingPhotos] = useState(0);

  // Count pending photos whenever the banner becomes visible
  useEffect(() => {
    if (!needRefresh) return;
    db.photoQueue.where('status').anyOf('pending', 'uploading', 'uploaded')
      .count()
      .then(setPendingPhotos)
      .catch(() => { /* non-fatal */ });
  }, [needRefresh]);

  if (!needRefresh) return null;

  const handleUpdate = () => {
    // Kick off photo upload in background first — it will survive the page reload
    // because IndexedDB persists across page navigations.
    if (pendingPhotos > 0) {
      void processPhotoQueue();
    }
    // Small delay so the queue has a moment to start before the SW activates
    setTimeout(() => updateServiceWorker(true), pendingPhotos > 0 ? 1500 : 0);
  };

  return (
    <div style={{
      position: 'fixed',
      left: 12,
      right: 12,
      bottom: 16,
      zIndex: 1000,
      maxWidth: 596,
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      {pendingPhotos > 0 && (
        <div style={{
          background: '#fffbeb',
          border: '1px solid #f6ad55',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          color: '#744210',
          lineHeight: 1.5,
        }}>
          ⚠️ You have <strong>{pendingPhotos} photo{pendingPhotos !== 1 ? 's' : ''}</strong> waiting to upload.
          Stay connected after tapping Update — they will sync automatically in the background.
        </div>
      )}
      <button className="btn btn-primary btn-block" onClick={handleUpdate}>
        {pendingPhotos > 0
          ? `Update now & upload ${pendingPhotos} pending photo${pendingPhotos !== 1 ? 's' : ''}`
          : 'A new version of the app is available — tap to update'}
      </button>
    </div>
  );
}
