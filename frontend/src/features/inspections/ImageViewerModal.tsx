import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { InspectionSection, Photo } from '@ozellar/shared';
import { localWrite, localDelete } from '../../offline/outbox';
import { photoSrc, getPhotoUrls } from '../../offline/photoQueue';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  XIcon,
  TrashIcon,
  WarningIcon,
  CheckIcon,
  CompassIcon,
} from '../../icons';
import { MovePhotoModal } from './MovePhotoModal';
import {
  downloadSinglePhoto,
  downloadPhotosAsZip,
} from './photoDownload';
import { ConfirmDeleteModal } from '../../app/ConfirmDeleteModal';
import { togglePhotoDefectWithObservation, type DefectConfirmRequest } from './photoDefectService';
import { ConfirmDefectRemovalModal } from './ConfirmDefectRemovalModal';
import './ImageViewerModal.css';

type SyncedPhoto = Photo & { deletedAt?: string | null };

export interface ImageViewerModalProps {
  photos: SyncedPhoto[];
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
  locked?: boolean;
  title?: string;
  initialUrls?: Record<string, string>;
  onPhotoToggled?: (photoId: string, isDefect: boolean) => void;
  onPhotoUpdated?: (photoId: string, updates: Partial<Photo>) => void;
  allSections?: InspectionSection[];
  currentSectionId?: string;
  onMoveToSection?: (photoId: string, targetSectionId: string) => Promise<void> | void;
  onMoveToQuestion?: (photoId: string, questionId: string, sectionId: string) => Promise<void> | void;
}

export function ImageViewerModal({
  photos,
  initialIndex,
  isOpen,
  onClose,
  locked = false,
  title,
  initialUrls,
  onPhotoToggled,
  onPhotoUpdated,
  allSections = [],
  currentSectionId,
  onMoveToSection,
  onMoveToQuestion,
}: ImageViewerModalProps) {
  const [localPhotos, setLocalPhotos] = useState<SyncedPhoto[]>(photos);

  useEffect(() => {
    setLocalPhotos(photos);
  }, [photos]);

  const activePhotos = React.useMemo(() => localPhotos.filter((p) => !p.deletedAt), [localPhotos]);
  const [index, setIndex] = useState(initialIndex);
  const [urls, setUrls] = useState<Record<string, string>>(initialUrls || {});
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmReq, setConfirmReq] = useState<DefectConfirmRequest | null>(null);
  const [descMap, setDescMap] = useState<Record<string, string>>({});
  const [descText, setDescText] = useState('');
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [isSavingDesc, setIsSavingDesc] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const activeThumbRef = useRef<HTMLDivElement>(null);

  // Sync index when initialIndex or activePhotos change
  useEffect(() => {
    if (activePhotos.length > 0) {
      const validIndex = Math.min(Math.max(0, initialIndex), activePhotos.length - 1);
      setIndex(validIndex);
    }
  }, [initialIndex, activePhotos.length]);

  // Sync with initialUrls if provided from parent PhotoStrip
  useEffect(() => {
    if (initialUrls && Object.keys(initialUrls).length > 0) {
      setUrls((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, url] of Object.entries(initialUrls)) {
          if (next[id] !== url) {
            next[id] = url;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [initialUrls]);

  const currentPhoto = activePhotos[index];

  // Sync description when photo changes
  useEffect(() => {
    if (currentPhoto) {
      setDescText(descMap[currentPhoto.id] ?? currentPhoto.description ?? '');
      setIsEditingDesc(false);
      setSaveSuccess(false);
    }
  }, [currentPhoto?.id]);

  const handleSaveDescription = async () => {
    if (locked || !currentPhoto || isSavingDesc) return;
    const trimmed = descText.trim();
    setIsSavingDesc(true);
    try {
      await localWrite('photos', currentPhoto.id, { description: trimmed });
      setDescMap((prev) => ({ ...prev, [currentPhoto.id]: trimmed }));
      currentPhoto.description = trimmed;
      onPhotoUpdated?.(currentPhoto.id, { description: trimmed });
      setIsEditingDesc(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to save photo description', err);
    } finally {
      setIsSavingDesc(false);
    }
  };

  // High-priority load for individual photo (current and adjacent)
  const loadPhoto = useCallback((photoId: string) => {
    if (!photoId) return;
    photoSrc(photoId).then((src) => {
      if (src) {
        setUrls((prev) => (prev[photoId] === src ? prev : { ...prev, [photoId]: src }));
      }
    });
  }, []);

  // Ensure current and adjacent photos are immediately loaded
  useEffect(() => {
    if (!isOpen || !currentPhoto) return;
    if (!urls[currentPhoto.id]) loadPhoto(currentPhoto.id);
    if (activePhotos[index + 1] && !urls[activePhotos[index + 1].id]) {
      loadPhoto(activePhotos[index + 1].id);
    }
    if (activePhotos[index - 1] && !urls[activePhotos[index - 1].id]) {
      loadPhoto(activePhotos[index - 1].id);
    }
  }, [isOpen, currentPhoto, index, activePhotos, loadPhoto, urls]);

  // Batch-fetch all active photos so all filmstrip thumbnails show their actual images
  useEffect(() => {
    if (!isOpen || activePhotos.length === 0) return;
    let isCancelled = false;

    const allIds = activePhotos.map((p) => p.id);
    getPhotoUrls(allIds).then((resolved) => {
      if (!isCancelled && Object.keys(resolved).length > 0) {
        setUrls((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [id, url] of Object.entries(resolved)) {
            if (next[id] !== url) {
              next[id] = url;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, activePhotos]);

  // Smooth scroll active thumbnail into center of filmstrip
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (activeThumbRef.current) {
        activeThumbRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [index, isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      if (e.key === 'Escape') {
        if (isEditingDesc) {
          setIsEditingDesc(false);
          setDescText(descMap[currentPhoto?.id || ''] ?? currentPhoto?.description ?? '');
          return;
        }
        onClose();
      } else if (!isInput && e.key === 'ArrowLeft') {
        goPrev();
      } else if (!isInput && e.key === 'ArrowRight') {
        goNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activePhotos.length, isEditingDesc, currentPhoto?.id, descMap]);

  if (!isOpen || !currentPhoto || activePhotos.length === 0) {
    return null;
  }

  const defectCount = activePhotos.filter((p) => !!p.isDefect).length;

  const goPrev = () => {
    setIndex((i) => (i > 0 ? i - 1 : activePhotos.length - 1));
  };

  const goNext = () => {
    setIndex((i) => (i < activePhotos.length - 1 ? i + 1 : 0));
  };

  // Touch swipe handling
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) {
        goNext();
      } else {
        goPrev();
      }
    }
    setTouchStartX(null);
  };

  // Toggle defect status
  const handleToggleDefect = async () => {
    if (locked || !currentPhoto) return;
    const newDefect = !currentPhoto.isDefect;
    const photoId = currentPhoto.id;

    // Optimistically update localPhotos in 0ms
    setLocalPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, isDefect: newDefect } : p))
    );

    try {
      await togglePhotoDefectWithObservation(currentPhoto, newDefect, {
        onConfirmRequired: (req) => setConfirmReq(req),
        onCompleted: (updatedPhoto) => {
          setLocalPhotos((prev) =>
            prev.map((p) => (p.id === updatedPhoto.id ? { ...p, ...updatedPhoto } : p))
          );
          onPhotoToggled?.(currentPhoto.id, updatedPhoto.isDefect);
          onPhotoUpdated?.(currentPhoto.id, updatedPhoto);
        },
      });
    } catch (err) {
      console.error('Failed to toggle photo defect status', err);
      // Revert optimistic update on failure
      setLocalPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, isDefect: !newDefect } : p))
      );
    }
  };

  // Delete photo
  const executeDelete = async () => {
    if (locked || !currentPhoto) return;
    setIsDeleting(true);
    try {
      await localDelete('photos', currentPhoto.id);
      setIsDeleteModalOpen(false);
      if (activePhotos.length <= 1) {
        onClose();
      } else {
        setIndex((i) => Math.min(i, activePhotos.length - 2));
      }
    } catch (err) {
      console.error('Failed to delete photo', err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Download single photo
  const handleDownloadSingle = async () => {
    try {
      setLoading(true);
      const url = urls[currentPhoto.id];
      await downloadSinglePhoto(currentPhoto, url, title || 'inspection_photo');
    } catch (err: any) {
      alert(err.message || 'Failed to download photo');
    } finally {
      setLoading(false);
    }
  };

  // Download all or defect photos as zip
  const handleDownloadZip = async (filter: 'all' | 'defect') => {
    try {
      setLoading(true);
      const zipName = `${title || 'inspection'}_${filter === 'defect' ? 'defect_photos' : 'all_photos'}`;
      await downloadPhotosAsZip(activePhotos, {
        zipFilename: zipName,
        filter,
        defaultSectionName: title,
        onProgress: (_curr, _tot, msg) => setDownloadProgress(msg),
      });
    } catch (err: any) {
      alert(err.message || 'Failed to download zip');
    } finally {
      setLoading(false);
      setDownloadProgress(null);
    }
  };

  return (
    <div className="ivm-overlay" onClick={onClose}>
      <div className="ivm-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Top Bar ── */}
        <div className="ivm-topbar">
          <div className="ivm-meta">
            <span className="ivm-counter">
              {index + 1} / {activePhotos.length}
            </span>
            {title && <span className="ivm-title-label">{title}</span>}
            <span className={`ivm-badge ${currentPhoto.isDefect ? 'defect' : 'normal'}`}>
              {currentPhoto.isDefect ? (
                <>
                  <WarningIcon style={{ width: 13, height: 13 }} />
                  Defect Image
                </>
              ) : (
                <>
                  <CheckIcon style={{ width: 13, height: 13 }} />
                  Normal Image
                </>
              )}
            </span>
          </div>

          <div className="ivm-actions">
            {!locked && allSections && allSections.length > 0 && onMoveToSection && (
              <button
                type="button"
                className="ivm-btn-move"
                onClick={() => setIsMoveModalOpen(true)}
                title="Move this photo to another section in this inspection"
              >
                <CompassIcon style={{ width: 13, height: 13 }} />
                <span>Move</span>
              </button>
            )}

            {!locked && (
              <button
                type="button"
                className={`ivm-btn-toggle ${currentPhoto.isDefect ? 'is-defect' : ''}`}
                onClick={handleToggleDefect}
                title="Toggle Normal/Defect status"
              >
                {currentPhoto.isDefect ? 'Mark as Normal' : 'Mark as Defect'}
              </button>
            )}

            <button
              type="button"
              className="ivm-icon-btn close-btn"
              onClick={onClose}
              aria-label="Close viewer"
            >
              <XIcon />
            </button>
          </div>
        </div>

        {/* ── Center Stage ── */}
        <div
          className="ivm-stage"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {activePhotos.length > 1 && (
            <button
              type="button"
              className="ivm-arrow-btn prev"
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
              onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); goPrev(); }}
              aria-label="Previous photo"
            >
              <ChevronLeftIcon />
            </button>
          )}

          <div className="ivm-img-wrapper">
            {urls[currentPhoto.id] ? (
              <img
                src={urls[currentPhoto.id]}
                alt={`Photo ${index + 1}`}
                className={`ivm-image ${currentPhoto.isDefect ? 'has-defect-glow' : ''}`}
              />
            ) : (
              <div className="ivm-loading-placeholder">
                <div className="ivm-spinner" />
                <span>Loading image...</span>
              </div>
            )}
          </div>

          {activePhotos.length > 1 && (
            <button
              type="button"
              className="ivm-arrow-btn next"
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); goNext(); }}
              aria-label="Next photo"
            >
              <ChevronRightIcon />
            </button>
          )}
        </div>

        {/* ── Download Progress Notification ── */}
        {downloadProgress && (
          <div className="ivm-progress-banner">
            <div className="ivm-spinner-sm" />
            <span>{downloadProgress}</span>
          </div>
        )}

                {/* ── Photo Description Bar ── */}
        <div className="ivm-desc-bar" onClick={(e) => e.stopPropagation()}>
          {isEditingDesc ? (
            <div className="ivm-desc-edit-wrap">
              <input
                type="text"
                className="ivm-desc-input"
                value={descText}
                onChange={(e) => setDescText(e.target.value)}
                placeholder="Enter photo description..."
                autoFocus
                maxLength={500}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSaveDescription();
                  }
                }}
              />
              <div className="ivm-desc-actions">
                <button
                  type="button"
                  className="ivm-desc-btn save"
                  onClick={handleSaveDescription}
                  disabled={isSavingDesc}
                  title="Save description"
                >
                  <CheckIcon style={{ width: 13, height: 13 }} />
                  <span>{isSavingDesc ? 'Saving...' : 'Save'}</span>
                </button>
                <button
                  type="button"
                  className="ivm-desc-btn cancel"
                  onClick={() => {
                    setIsEditingDesc(false);
                    setDescText(descMap[currentPhoto.id] ?? currentPhoto.description ?? '');
                  }}
                  disabled={isSavingDesc}
                  title="Cancel editing"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="ivm-desc-display-wrap">
              <div
                className={`ivm-desc-content ${!locked ? 'clickable' : ''}`}
                onClick={() => !locked && setIsEditingDesc(true)}
                title={!locked ? 'Click to edit description' : undefined}
              >
                <span className="ivm-desc-label">Description:</span>
                {(descMap[currentPhoto.id] ?? currentPhoto.description) ? (
                  <span className="ivm-desc-text">
                    {descMap[currentPhoto.id] ?? currentPhoto.description}
                  </span>
                ) : (
                  <span className="ivm-desc-placeholder">
                    {!locked ? '+ Add description for this photo...' : 'No description'}
                  </span>
                )}
                {saveSuccess && (
                  <span className="ivm-desc-saved">
                    <CheckIcon style={{ width: 12, height: 12 }} /> Saved
                  </span>
                )}
              </div>
              {!locked && (
                <button
                  type="button"
                  className="ivm-desc-edit-btn"
                  onClick={() => setIsEditingDesc(true)}
                  title={(descMap[currentPhoto.id] ?? currentPhoto.description) ? 'Edit photo description' : 'Add photo description'}
                >
                  {(descMap[currentPhoto.id] ?? currentPhoto.description) ? 'Edit Description' : '+ Add Description'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Bottom Action Toolbar ── */}
        <div className="ivm-bottom-bar">
          <div className="ivm-download-group">
            {/* Download This Photo */}
            <button
              type="button"
              className="ivm-action-btn primary"
              onClick={handleDownloadSingle}
              disabled={loading}
              title="Download this specific photo"
            >
              <DownloadIcon style={{ width: 16, height: 16 }} />
              <span className="ivm-btn-text-full">Download Image</span>
              <span className="ivm-btn-text-short">Image</span>
            </button>

            {/* Download All Photos */}
            <button
              type="button"
              className="ivm-action-btn secondary"
              onClick={() => handleDownloadZip('all')}
              disabled={loading}
              title={`Download all ${activePhotos.length} photos as ZIP`}
            >
              <DownloadIcon style={{ width: 16, height: 16 }} />
              <span className="ivm-btn-text-full">Download All ({activePhotos.length})</span>
              <span className="ivm-btn-text-short">All ({activePhotos.length})</span>
            </button>

            {/* Download Defect Photos */}
            <button
              type="button"
              className="ivm-action-btn defect-btn"
              onClick={() => handleDownloadZip('defect')}
              disabled={loading || defectCount === 0}
              title={
                defectCount > 0
                  ? `Download only defect photos (${defectCount}) as ZIP`
                  : 'No defect photos in this group'
              }
            >
              <WarningIcon style={{ width: 16, height: 16 }} />
              <span className="ivm-btn-text-full">Download Defect ({defectCount})</span>
              <span className="ivm-btn-text-short">Defect ({defectCount})</span>
            </button>
          </div>

          {!locked && (
            <button
              type="button"
              className="ivm-delete-btn"
              onClick={() => setIsDeleteModalOpen(true)}
              aria-label="Delete photo"
              title="Delete this photo"
            >
              <TrashIcon style={{ width: 16, height: 16 }} />
            </button>
          )}
        </div>

        {/* ── Filmstrip Carousel ── */}
        {activePhotos.length > 1 && (
          <div className="ivm-filmstrip">
            {activePhotos.map((p, i) => (
              <div
                key={p.id}
                ref={i === index ? activeThumbRef : undefined}
                className={`ivm-thumb ${i === index ? 'active' : ''} ${p.isDefect ? 'defect' : ''}`}
                onClick={() => setIndex(i)}
                title={`Photo ${i + 1}${p.isDefect ? ' (Defect)' : ''}`}
              >
                {urls[p.id] ? (
                  <img
                    src={urls[p.id]}
                    alt=""
                    onError={() => {
                      // Attempt single reload if blob URL expired
                      photoSrc(p.id).then((src) => {
                        if (src) setUrls((prev) => ({ ...prev, [p.id]: src }));
                      });
                    }}
                  />
                ) : (
                  <div className="ivm-thumb-empty" />
                )}
                {p.isDefect && <span className="ivm-thumb-def-dot" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Move Photo to Section / Question Modal ── */}
      {isMoveModalOpen && (onMoveToSection || onMoveToQuestion) && (
        <MovePhotoModal
          isOpen={isMoveModalOpen}
          photos={[currentPhoto]}
          photoUrls={[urls[currentPhoto.id] || '']}
          currentSectionId={currentSectionId}
          sections={allSections}
          onMoveToSection={onMoveToSection ? async (targetSecId) => {
            await onMoveToSection(currentPhoto.id, targetSecId);
            setIsMoveModalOpen(false);
            if (activePhotos.length <= 1) {
              onClose();
            }
          } : undefined}
          onMoveToQuestion={onMoveToQuestion ? async (targetQId, targetSecId) => {
            await onMoveToQuestion(currentPhoto.id, targetQId, targetSecId);
            setIsMoveModalOpen(false);
            if (activePhotos.length <= 1) {
              onClose();
            }
          } : undefined}
          onClose={() => setIsMoveModalOpen(false)}
        />
      )}

      {/* ── Confirm Delete Photo Modal ── */}
      {isDeleteModalOpen && currentPhoto && (
        <ConfirmDeleteModal
          isOpen={isDeleteModalOpen}
          title="Delete Photo"
          description="Are you sure you want to delete this photo?"
          subdesc="This action cannot be undone and will permanently remove this image from the inspection."
          previewImageUrl={urls[currentPhoto.id]}
          confirmText="Delete Photo"
          loading={isDeleting}
          onConfirm={executeDelete}
          onCancel={() => {
            if (!isDeleting) setIsDeleteModalOpen(false);
          }}
        />
      )}

      {/* ── Confirm Defect Removal Modal ── */}
      {confirmReq && (
        <ConfirmDefectRemovalModal
          isOpen={!!confirmReq}
          photo={confirmReq.photo}
          finding={confirmReq.finding}
          sectionName={confirmReq.sectionName}
          onRemoveObservationAndSetNormal={async () => {
            const req = confirmReq;
            setConfirmReq(null);
            await req.onRemoveObservationAndSetNormal();
            setLocalPhotos((prev) =>
              prev.map((p) =>
                p.id === req.photo.id ? { ...p, isDefect: false, findingId: null } : p
              )
            );
          }}
          onKeepObservationAndSetNormal={async () => {
            const req = confirmReq;
            setConfirmReq(null);
            await req.onKeepObservationAndSetNormal();
            setLocalPhotos((prev) =>
              prev.map((p) =>
                p.id === req.photo.id ? { ...p, isDefect: false, findingId: null } : p
              )
            );
          }}
          onCancel={() => {
            const req = confirmReq;
            setConfirmReq(null);
            req.onCancel();
            setLocalPhotos((prev) =>
              prev.map((p) => (p.id === req.photo.id ? { ...p, isDefect: true } : p))
            );
          }}
        />
      )}
    </div>
  );
}
