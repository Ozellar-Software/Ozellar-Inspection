import { useCallback, useEffect, useRef, useState } from 'react';
import type { InspectionSection, Photo, PhotoTarget } from '@ozellar/shared';
import { db } from '../../offline/db';
import { photoSrc, addPhoto } from '../../offline/photoQueue';
import { localDelete, localWrite } from '../../offline/outbox';
import {
  CameraIcon,
  UploadIcon,
  XIcon,
  EyeIcon,
  DownloadIcon,
  WarningIcon,
  GripVerticalIcon,
  ArrowRightCircleIcon,
  MoreHorizontalIcon,
} from '../../icons';
import { ImageViewerModal } from './ImageViewerModal';
import { PhotoUploadModal } from './PhotoUploadModal';
import { CameraCaptureModal } from './CameraCaptureModal';
import { AssignPhotoModal } from './AssignPhotoModal';
import { PhotoTooltipMenu } from './PhotoTooltipMenu';
import { MovePhotoModal } from './MovePhotoModal';
import { downloadPhotosAsZip } from './photoDownload';
import { startPhotoDrag, endPhotoDrag, startTouchPhotoDrag, showDragNotification } from './photoDragService';
import './PhotoStrip.css';

/**
 * Thumbnail row + take/upload buttons for one target (a question, a finding, or a section's own photos).
 * Supports dragging photos to/from questions, and quick-assigning section photos to questions.
 */
type SyncedPhoto = Photo & { deletedAt?: string | null };
const MAX_ATTEMPTS = 6;

export interface QuestionSummary {
  id: string;
  ref: string;
  text: string;
}

export function PhotoStrip({
  photos,
  target,
  inspectionId,
  inspectionSectionId,
  responseId,
  findingId,
  locked,
  title,
  allSections,
  availableQuestions,
}: {
  photos: SyncedPhoto[];
  target: PhotoTarget;
  inspectionId: string;
  inspectionSectionId?: string;
  responseId?: string;
  findingId?: string;
  locked: boolean;
  title?: string;
  allSections?: InspectionSection[];
  availableQuestions?: QuestionSummary[];
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [assignModalPhoto, setAssignModalPhoto] = useState<SyncedPhoto | null>(null);
  const [moveModalPhoto, setMoveModalPhoto] = useState<SyncedPhoto | null>(null);
  const [tooltipTarget, setTooltipTarget] = useState<{ photo: SyncedPhoto; anchorEl: HTMLElement } | null>(null);

  // Gesture refs for single-click (lightbox) vs double-click & long-press (tooltip options)
  const clickTimeoutRef = useRef<number | null>(null);
  const longPressTimeoutRef = useRef<number | null>(null);
  const isLongPressTriggeredRef = useRef(false);

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

  // Toggle Normal / Defect classification
  const handleToggleDefect = async (photoId: string, isDefect: boolean) => {
    const existing = await db.photos.get(photoId);
    if (existing) {
      await localWrite('photos', photoId, {
        ...existing,
        isDefect,
      });
    }
  };

  // Move photo to any section in this inspection
  const handleMoveToSection = async (photoId: string, targetSectionId: string) => {
    const targetSectionPhotos = await db.photos
      .where('inspectionId')
      .equals(inspectionId)
      .filter((p) => p.target === 'section' && p.inspectionSectionId === targetSectionId && !p.deletedAt)
      .toArray();

    const existing = await db.photos.get(photoId);
    if (existing) {
      await localWrite('photos', photoId, {
        ...existing,
        target: 'section',
        inspectionSectionId: targetSectionId,
        responseId: null,
        findingId: null,
        position: targetSectionPhotos.length,
      });
    }
  };

  // Assign or move photo to a chosen question
  const handleAssignToQuestion = async (photoId: string, questionId: string, targetSectionId?: string) => {
    try {
      const existing = await db.responses
        .where('inspectionId')
        .equals(inspectionId)
        .filter((r) => r.inspectionQuestionId === questionId)
        .first();
      let respId = existing?.id;
      if (!respId) {
        respId = crypto.randomUUID();
        await localWrite('responses', respId, {
          inspectionId,
          inspectionQuestionId: questionId,
          inspectionSectionId: targetSectionId || inspectionSectionId || null,
          applicable: true,
          updatedAt: new Date().toISOString(),
        });
      }

      const qPhotos = await db.photos
        .where('inspectionId')
        .equals(inspectionId)
        .filter((p) => p.target === 'question' && p.responseId === respId && !p.deletedAt)
        .toArray();

      const targetPhoto = await db.photos.get(photoId);
      if (targetPhoto) {
        await localWrite('photos', photoId, {
          ...targetPhoto,
          target: 'question',
          responseId: respId,
          inspectionSectionId: null,
          findingId: null,
          position: qPhotos.length,
        });
      }
      setAssignModalPhoto(null);
    } catch (err) {
      console.error('Failed to assign photo to question', err);
    }
  };

  // ── Thumbnail interaction: Single-click (view), Double-click (tooltip), Long hold (drag & drop) ──
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isHoldingTouchRef = useRef(false);

  const handleThumbnailClick = (idx: number, photo: SyncedPhoto, el: HTMLElement) => {
    if (isLongPressTriggeredRef.current || isHoldingTouchRef.current) {
      isLongPressTriggeredRef.current = false;
      isHoldingTouchRef.current = false;
      return;
    }

    // Double-click detection within 230ms
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      setTooltipTarget({ photo, anchorEl: el });
      return;
    }

    // Single click: open image viewer directly (old behavior)
    clickTimeoutRef.current = window.setTimeout(() => {
      clickTimeoutRef.current = null;
      setViewerIndex(idx);
      setIsViewerOpen(true);
    }, 220);
  };

  const handleDoubleClick = (e: React.MouseEvent, photo: SyncedPhoto, el: HTMLElement) => {
    e.preventDefault();
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    setTooltipTarget({ photo, anchorEl: el });
  };

  const handleTouchStart = (photo: SyncedPhoto, el: HTMLElement, e: React.TouchEvent) => {
    if (locked) return;
    if (e.touches.length > 1) return;

    const t = e.touches[0];
    const startCoord = { clientX: t.clientX, clientY: t.clientY };
    touchStartPosRef.current = { x: t.clientX, y: t.clientY };
    isHoldingTouchRef.current = false;
    isLongPressTriggeredRef.current = false;

    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);

    // 280ms hold threshold to activate mobile drag & drop!
    longPressTimeoutRef.current = window.setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      isHoldingTouchRef.current = true;
      startTouchPhotoDrag(
        startCoord,
        {
          photoId: photo.id,
          fromTarget: target,
          fromSectionId: inspectionSectionId,
          fromResponseId: responseId,
          isDefect: photo.isDefect,
          photoUrl: urls[photo.id],
        },
        {
          onDropToQuestion: async (photoId, questionId, targetSecId) => {
            await handleAssignToQuestion(photoId, questionId, targetSecId);
          },
          onDropToSection: async (photoId, targetSecId) => {
            await handleMoveToSection(photoId, targetSecId || inspectionSectionId || '');
          },
          onSameQuestionAttempt: () => {
            showDragNotification('Photo is already attached to this question', 'warning');
          },
          onSameSectionAttempt: () => {
            showDragNotification('Photo is already in section photos', 'warning');
          },
        },
        el
      );
    }, 280);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    if (!isHoldingTouchRef.current) {
      const t = e.touches[0];
      const dist = Math.hypot(t.clientX - touchStartPosRef.current.x, t.clientY - touchStartPosRef.current.y);
      // If moved > 16px before 280ms hold timer fires, user is scrolling! Cancel hold timer.
      if (dist > 16 && longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
        longPressTimeoutRef.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    touchStartPosRef.current = null;
    if (isLongPressTriggeredRef.current) {
      setTimeout(() => {
        isLongPressTriggeredRef.current = false;
        isHoldingTouchRef.current = false;
      }, 450);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, photo: SyncedPhoto, el: HTMLElement) => {
    e.preventDefault();
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    // Only open tooltip on desktop right-click with a mouse; on mobile touch, suppress it so it never blocks drag
    const isTouch =
      (e.nativeEvent as any).pointerType === 'touch' ||
      isHoldingTouchRef.current ||
      ('ontouchstart' in window && window.innerWidth <= 768);
    if (!isTouch) {
      setTooltipTarget({ photo, anchorEl: el });
    }
  };

  // Touch drag initiation from the drag handle indicator
  const handleTouchDragInitiate = (e: React.TouchEvent, photo: SyncedPhoto) => {
    if (locked) return;
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    e.stopPropagation();
    const t = e.touches[0];
    const startCoord = { clientX: t.clientX, clientY: t.clientY };
    startTouchPhotoDrag(
      startCoord,
      {
        photoId: photo.id,
        fromTarget: target,
        fromSectionId: inspectionSectionId,
        fromResponseId: responseId,
        isDefect: photo.isDefect,
        photoUrl: urls[photo.id],
      },
      {
        onDropToQuestion: async (photoId, questionId, targetSecId) => {
          await handleAssignToQuestion(photoId, questionId, targetSecId);
        },
        onDropToSection: async (photoId, targetSecId) => {
          await handleMoveToSection(photoId, targetSecId || inspectionSectionId || '');
        },
        onSameQuestionAttempt: () => {
          showDragNotification('Photo is already attached to this question', 'warning');
        },
        onSameSectionAttempt: () => {
          showDragNotification('Photo is already in section photos', 'warning');
        },
      }
    );
  };

  // Drag and drop onto the strip directly
  const handleStripDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    endPhotoDrag();
    if (locked) return;

    // Check if an existing photo was dropped (e.g. from question back to section)
    let photoId = '';
    try {
      const json = e.dataTransfer.getData('application/json');
      if (json) {
        const parsed = JSON.parse(json);
        if (parsed.photoId) photoId = parsed.photoId;
      }
    } catch {}
    if (!photoId) {
      photoId = e.dataTransfer.getData('text/plain');
    }

    if (photoId) {
      const existingPhoto = await db.photos.get(photoId);
      if (existingPhoto) {
        // Prevent drop into same section
        if (target === 'section' && existingPhoto.target === 'section' && existingPhoto.inspectionSectionId === inspectionSectionId) {
          return;
        }
        // Prevent drop into same question
        if (target === 'question' && existingPhoto.target === 'question' && existingPhoto.responseId === responseId) {
          return;
        }

        await localWrite('photos', photoId, {
          ...existingPhoto,
          target,
          inspectionSectionId: target === 'section' ? inspectionSectionId : null,
          responseId: target === 'question' ? responseId : null,
          findingId: target === 'finding' ? findingId : null,
          position: photos.length,
        });
      }
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
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
            className={`thumb${p.isDefect ? ' defect' : ''}${!locked ? ' draggable' : ''}`}
            draggable={!locked}
            onDragStart={(e) => {
              if (locked) return;
              startPhotoDrag({
                photoId: p.id,
                fromTarget: target,
                fromSectionId: inspectionSectionId,
                fromResponseId: responseId,
                isDefect: p.isDefect,
                photoUrl: urls[p.id],
              });
              e.dataTransfer.setData('text/plain', p.id);
              e.dataTransfer.setData(
                'application/json',
                JSON.stringify({
                  type: 'ozellar-photo',
                  photoId: p.id,
                  fromTarget: target,
                  fromInspectionSectionId: inspectionSectionId,
                  fromResponseId: responseId,
                })
              );
              e.dataTransfer.effectAllowed = 'copyMove';
            }}
            onDragEnd={() => {
              endPhotoDrag();
            }}
            onClick={(e) => handleThumbnailClick(idx, p, e.currentTarget)}
            onDoubleClick={(e) => handleDoubleClick(e, p, e.currentTarget)}
            onTouchStart={(e) => handleTouchStart(p, e.currentTarget, e)}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onContextMenu={(e) => handleContextMenu(e, p, e.currentTarget)}
            style={{ cursor: !locked ? 'grab' : 'pointer' }}
            title={
              target === 'section'
                ? 'Click to view, double-click or hold for options (normal/defect, move section)'
                : 'Click to view, double-click or hold for options'
            }
          >
            {/* Drag grip icon */}
            {!locked && (
              <span
                className="thumb-drag-indicator"
                title="Drag to question"
                onTouchStart={(e) => handleTouchDragInitiate(e, p)}
              >
                <GripVerticalIcon width={12} height={12} />
              </span>
            )}

            {/* Quick options button (Double-click or hold) */}
            {!locked && (
              <button
                type="button"
                className="thumb-more-btn"
                title="Options (Double-click or hold)"
                onClick={(e) => {
                  e.stopPropagation();
                  if (clickTimeoutRef.current) {
                    clearTimeout(clickTimeoutRef.current);
                    clickTimeoutRef.current = null;
                  }
                  setTooltipTarget({ photo: p, anchorEl: e.currentTarget.parentElement as HTMLElement });
                }}
                aria-label="Photo options"
              >
                <MoreHorizontalIcon width={13} height={13} />
              </button>
            )}

            {/* Quick assign button on Section photos */}
            {!locked && target === 'section' && availableQuestions && availableQuestions.length > 0 && (
              <button
                type="button"
                className="thumb-assign-btn"
                title="Assign to question"
                onClick={(e) => {
                  e.stopPropagation();
                  setAssignModalPhoto(p);
                }}
                aria-label="Assign to question"
              >
                <ArrowRightCircleIcon width={13} height={13} />
              </button>
            )}

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
            ) : (
              <div className="thumb-loading-placeholder" title="Photo loading or stored offline">
                <CameraIcon style={{ width: 20, height: 20, opacity: 0.5 }} />
              </div>
            )}
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
          allSections={allSections}
          currentSectionId={inspectionSectionId}
          onMoveToSection={handleMoveToSection}
          onMoveToQuestion={handleAssignToQuestion}
          onPhotoToggled={handleToggleDefect}
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

      {/* ── Quick Assign to Question Modal (direct trigger from button) ── */}
      {assignModalPhoto && availableQuestions && (
        <AssignPhotoModal
          isOpen={!!assignModalPhoto}
          photo={assignModalPhoto}
          photoUrl={urls[assignModalPhoto.id]}
          questions={availableQuestions}
          onAssign={(qId) => handleAssignToQuestion(assignModalPhoto.id, qId)}
          onClose={() => setAssignModalPhoto(null)}
        />
      )}

      {/* ── Photo Floating Tooltip Menu (Double-click, Hold, or More button) ── */}
      {tooltipTarget && (
        <PhotoTooltipMenu
          photo={tooltipTarget.photo}
          anchorEl={tooltipTarget.anchorEl}
          locked={locked}
          allSections={allSections}
          availableQuestions={availableQuestions}
          onToggleDefect={handleToggleDefect}
          onOpenMoveModal={(p) => setMoveModalPhoto(p)}
          onOpenAssignModal={availableQuestions && availableQuestions.length > 0 ? (p) => setAssignModalPhoto(p) : undefined}
          onDeletePhoto={async (photoId) => {
            await localDelete('photos', photoId);
          }}
          onClose={() => setTooltipTarget(null)}
        />
      )}

      {/* ── Move Photo to Any Section / Question Modal ── */}
      {moveModalPhoto && allSections && (
        <MovePhotoModal
          isOpen={!!moveModalPhoto}
          photo={moveModalPhoto}
          photoUrl={urls[moveModalPhoto.id]}
          currentSectionId={inspectionSectionId}
          sections={allSections}
          onMoveToSection={async (targetSecId) => {
            await handleMoveToSection(moveModalPhoto.id, targetSecId);
            setMoveModalPhoto(null);
          }}
          onMoveToQuestion={async (targetQId, targetSecId) => {
            await handleAssignToQuestion(moveModalPhoto.id, targetQId, targetSecId);
            setMoveModalPhoto(null);
          }}
          onClose={() => setMoveModalPhoto(null)}
        />
      )}
    </div>
  );
}
