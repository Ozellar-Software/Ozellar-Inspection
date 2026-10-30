import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db } from '../offline/db';
import { processPhotoQueue } from '../offline/photoQueue';
import { syncNow } from '../offline/sync';

/**
 * PWA update banner shown when a new service-worker version is waiting.
 *
 * When the user taps "tap to update", it automatically triggers syncNow()
 * and processPhotoQueue(), activates the waiting service worker, reloads
 * the page with the latest code, and resumes background sync.
 */
export function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // Check for server updates every 60 seconds
      setInterval(() => void reg.update(), 60_000);
      // Check immediately when returning to the tab
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update();
      });
    },
  });

  const [pendingPhotos, setPendingPhotos] = useState(0);
  const [updating, setUpdating] = useState(false);

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
    setUpdating(true);
    // 1. Kick off immediate data sync and photo uploads before reload
    if (navigator.onLine) {
      void syncNow();
      void processPhotoQueue();
    }
    // 2. Allow requests a brief moment to dispatch, then activate SW and reload page
    setTimeout(() => {
      void updateServiceWorker(true);
    }, pendingPhotos > 0 ? 1200 : 400);
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
      <button
        className="btn btn-primary btn-block"
        onClick={handleUpdate}
        disabled={updating}
        style={{
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          padding: '12px 18px',
          fontWeight: 700,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {updating ? (
          <>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67"/>
            </svg>
            <span>Syncing & updating…</span>
          </>
        ) : pendingPhotos > 0 ? (
          `Update now & sync ${pendingPhotos} pending photo${pendingPhotos !== 1 ? 's' : ''}`
        ) : (
          'A new version of the app is available — tap to update'
        )}
      </button>
    </div>
  );
}
