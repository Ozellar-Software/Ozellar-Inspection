import { useCallback, useEffect, useRef, useState } from 'react';
import type { Photo, PhotoTarget } from '@ozellar/shared';
import { photoSrc, addPhoto } from '../../offline/photoQueue';
import { localDelete } from '../../offline/outbox';
import {
  CameraIcon,
  UploadIcon,
  XIcon,
  EyeIcon,
  DownloadIcon,
  WarningIcon,
} from '../../icons';
import { ImageViewerModal } from './ImageViewerModal';
import { PhotoUploadModal } from './PhotoUploadModal';
import { CameraCaptureModal } from './CameraCaptureModal';
import { downloadPhotosAsZip } from './photoDownload';
import './PhotoStrip.css';

/**
 * Thumbnail row + take/upload buttons for one target (a question, a finding, or a section's own photos).
 * Tapping "Take photo" opens the dedicated CameraCaptureModal with live viewfinder & multi-shot snapping.
 * Tapping "Upload photos" opens the dedicated PhotoUploadModal with drag-and-drop & file selection.
 */
type SyncedPhoto = Photo & { deletedAt?: string | null };
const MAX_ATTEMPTS = 6;

export function PhotoStrip({
  photos,
  target,
  inspectionId,
  inspectionSectionId,
  responseId,
  findingId,
  locked,
  title,
}: {
  photos: SyncedPhoto[];
  target: PhotoTarget;
  inspectionId: string;
  inspectionSectionId?: string;
  responseId?: string;
  findingId?: string;
  locked: boolean;
  title?: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  // Lightbox / Image Viewer state
  const [viewerIndex, setViewerIndex] = useState(0);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // Camera Modal state
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);

  // Upload Modal state & initial files
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [modalInitialFiles, setModalInitialFiles] = useState<File[]>([]);

  // Filter out deleted photos
  const activePhotos = photos.filter((p) => !p.deletedAt);
  const defectCount = activePhotos.filter((p) => !!p.isDefect).length;

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
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      load(id);
    }, Math.min(2000 * 2 ** n, 30_000));
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

  // Handle files selected via file picker or drag-and-drop
  const handleFilesChosen = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setModalInitialFiles(list);
    setIsUploadModalOpen(true);
  };

  // Drag and drop onto the strip directly
  const handleStripDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!locked && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesChosen(e.dataTransfer.files);
    }
  };

  // Batch download helper directly from strip
  const handleBatchDownload = async (filter: 'all' | 'defect') => {
    try {
      const zipName = `${title || 'photos'}_${filter === 'defect' ? 'defects' : 'all'}`;
      await downloadPhotosAsZip(activePhotos, {
        zipFilename: zipName,
        filter,
        defaultSectionName: title,
      });
    } catch (err: any) {
      alert(err.message || 'Failed to download zip');
    }
  };

  // Save handler for CameraCaptureModal
  const handleSavePhotosFromCamera = async (newPhotos: { file: File; isDefect: boolean }[]) => {
    let position = photos.length;
    for (const item of newPhotos) {
      await addPhoto({
        file: item.file,
        target,
        inspectionId,
        inspectionSectionId,
        responseId,
        findingId,
        position: position++,
        isDefect: item.isDefect,
      });
    }
  };

  return (
    <div
      className="photostrip-wrap"
      onDragOver={(e) => {
        if (!locked) e.preventDefault();
      }}
      onDrop={handleStripDrop}
    >
      {/* ── Strip Header with Counts & Fast Actions ── */}
      {activePhotos.length > 0 && (
        <div className="photostrip-header">
          <div className="photostrip-count">
            <span>{activePhotos.length} Photo{activePhotos.length > 1 ? 's' : ''}</span>
            {defectCount > 0 && (
              <span className="photostrip-defect-pill">
                {defectCount} Defect{defectCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="photostrip-actions">
            <button
              type="button"
              className="photostrip-btn-link"
              onClick={() => {
                setViewerIndex(0);
                setIsViewerOpen(true);
              }}
              title="Open photo viewer"
            >
              <EyeIcon style={{ width: 13, height: 13 }} />
              View
            </button>

            <button
              type="button"
              className="photostrip-btn-link"
              onClick={() => handleBatchDownload('all')}
              title="Download all photos as ZIP"
            >
              <DownloadIcon style={{ width: 13, height: 13 }} />
              All ({activePhotos.length})
            </button>

            {defectCount > 0 && (
              <button
                type="button"
                className="photostrip-btn-link defect-btn"
                onClick={() => handleBatchDownload('defect')}
                title="Download defect photos as ZIP"
              >
                <WarningIcon style={{ width: 13, height: 13 }} />
                Defect ({defectCount})
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Thumbnails Row ── */}
      <div className="thumb-row">
        {activePhotos.map((p, idx) => (
          <div
            key={p.id}
            className={`thumb${p.isDefect ? ' defect' : ''}`}
            onClick={() => {
              setViewerIndex(idx);
              setIsViewerOpen(true);
            }}
            style={{ cursor: 'pointer' }}
            title={p.isDefect ? 'Defect Photo (Click to view)' : 'Normal Photo (Click to view)'}
          >
            {urls[p.id] ? (
              <img
                src={urls[p.id]}
                alt=""
                onError={() => {
                  setUrls((u) => {
                    const { [p.id]: _gone, ...rest } = u;
                    return rest;
                  });
                  scheduleRetry(p.id);
                }}
              />
            ) : null}
            {!locked && (
              <button
                type="button"
                className="del"
                aria-label="Remove photo"
                onClick={(e) => {
                  e.stopPropagation();
                  void localDelete('photos', p.id);
                }}
              >
                <XIcon />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ── Take / Upload Controls ── */}
      {!locked && (
        <div className="photo-btns">
          {/* Direct Camera Button */}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setIsCameraModalOpen(true)}
            title="Open camera to capture photos"
          >
            <CameraIcon />
            Take photo
          </button>

          {/* Direct Upload Photos Button */}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              setModalInitialFiles([]);
              setIsUploadModalOpen(true);
            }}
            title="Upload and classify photos from files"
          >
            <UploadIcon />
            Upload photos
          </button>
        </div>
      )}

      {/* ── Fullscreen Lightbox / Image Viewer Modal ── */}
      {isViewerOpen && (
        <ImageViewerModal
          photos={activePhotos}
          initialIndex={viewerIndex}
          isOpen={isViewerOpen}
          onClose={() => setIsViewerOpen(false)}
          locked={locked}
          title={title}
          initialUrls={urls}
        />
      )}

      {/* ── Live Camera Capture Modal ── */}
      {isCameraModalOpen && (
        <CameraCaptureModal
          isOpen={isCameraModalOpen}
          onClose={() => setIsCameraModalOpen(false)}
          onSavePhotos={handleSavePhotosFromCamera}
          title={title}
        />
      )}

      {/* ── Dedicated Photo Upload & Classification Modal ── */}
      {isUploadModalOpen && (
        <PhotoUploadModal
          isOpen={isUploadModalOpen}
          onClose={() => {
            setIsUploadModalOpen(false);
            setModalInitialFiles([]);
          }}
          initialFiles={modalInitialFiles}
          target={target}
          inspectionId={inspectionId}
          inspectionSectionId={inspectionSectionId}
          responseId={responseId}
          findingId={findingId}
          title={title}
          currentPhotoCount={photos.length}
        />
      )}
    </div>
  );
}
