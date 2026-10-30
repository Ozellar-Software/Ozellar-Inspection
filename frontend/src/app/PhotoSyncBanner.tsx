import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../offline/db';
import { processPhotoQueue, subscribePhotoSync, type PhotoSyncProgress } from '../offline/photoQueue';

export function PhotoSyncBanner() {
  const [progress, setProgress] = useState<PhotoSyncProgress>({ pending: 0, total: 0, uploaded: 0, isUploading: false });
  const [justCompleted, setJustCompleted] = useState(false);

  // Live dynamic counts directly from device database — never hardcoded
  const counts = useLiveQuery(async () => {
    const missingCount = await db.photoQueue.where('status').anyOf('pending', 'uploading', 'uploaded').count();
    const uploadedCount = await db.photoQueue.where('status').equals('committed').count();
    return { missing: missingCount, uploaded: uploadedCount };
  }, []);

  useEffect(() => {
    return subscribePhotoSync((p) => {
      setProgress(p);
      if (p.isUploading && p.pending === 0 && p.total > 0 && p.uploaded > 0) {
        setJustCompleted(true);
        setTimeout(() => setJustCompleted(false), 7000);
      }
    });
  }, []);

  const missing = progress.isUploading ? progress.pending : (counts?.missing ?? 0);
  const total = progress.total > 0 ? progress.total : ((counts?.uploaded ?? 0) + missing);
  const uploaded = progress.isUploading ? progress.uploaded : (counts?.uploaded ?? 0);
  const percent = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 0;

  // Nothing missing and not recently finished — don't show banner
  if (!justCompleted && missing === 0) {
    return null;
  }

  return (
    <div
      style={{
        background: justCompleted ? '#059669' : progress.isUploading ? '#0284c7' : '#d97706',
        color: '#ffffff',
        padding: '10px 16px',
        fontSize: '13px',
        fontWeight: 600,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 999,
        transition: 'all 0.3s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {justCompleted ? (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : progress.isUploading ? (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
            </svg>
          ) : (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              <polyline points="12 13 12 9 14 11" />
            </svg>
          )}

          <span>
            {justCompleted
              ? `All ${uploaded} offline photos uploaded to cloud successfully! (100%)`
              : progress.isUploading
              ? `Syncing photos (${percent}%): ${uploaded} of ${total} uploaded, ${missing} remaining…`
              : navigator.onLine
              ? `${missing} photo${missing !== 1 ? 's' : ''} pending upload (${uploaded} already uploaded) — starting sync…`
              : `Offline mode: ${missing} photo${missing !== 1 ? 's' : ''} stored safely on device. Will auto-sync when online.`}
          </span>
        </div>

        {!justCompleted && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {progress.isUploading && (
              <span style={{ fontSize: '12px', fontWeight: 800, background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '4px' }}>
                {percent}%
              </span>
            )}
            {navigator.onLine && (
              <button
                type="button"
                onClick={() => void processPhotoQueue()}
                disabled={progress.isUploading}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: '1px solid rgba(255,255,255,0.4)',
                  color: '#ffffff',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: progress.isUploading ? 'default' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {progress.isUploading ? 'Uploading…' : 'Sync Photos Now'}
              </button>
            )}
          </div>
        )}
      </div>

      {!justCompleted && total > 0 && progress.isUploading && (
        <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.3)', borderRadius: '3px', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${percent}%`,
              background: '#ffffff',
              borderRadius: '3px',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      )}
    </div>
  );
}
