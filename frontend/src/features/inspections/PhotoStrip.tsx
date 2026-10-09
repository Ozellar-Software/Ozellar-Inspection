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
  CompassIcon,
  CheckIcon,
  CheckCircleIcon,
  TrashIcon,
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
  const [moveModalPhotos, setMoveModalPhotos] = useState<SyncedPhoto[] | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
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

  // Batch toggle Defect / Normal classification for selected photos
  const handleBatchSetDefect = async (defectValue: boolean) => {
    if (selectedPhotoIds.size === 0) return;
    for (const id of selectedPhotoIds) {
      await handleToggleDefect(id, defectValue);
    }
  };

  // Batch delete selected photos
  const handleBatchDelete = async () => {
    if (selectedPhotoIds.size === 0) return;
    const count = selectedPhotoIds.size;
    const confirmMsg = `Are you sure you want to delete ${count} selected photo${count > 1 ? 's' : ''}? This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    for (const id of selectedPhotoIds) {
      await localDelete('photos', id);
    }
    setSelectedPhotoIds(new Set());
    if (activePhotos.length <= count) {
      setIsSelectMode(false);
    }
  };

  // Move photo to any section in this inspection
  const handleMoveToSection = async (photoId: string, targetSectionId: string, customPosition?: number) => {
    let position = customPosition;
    if (position === undefined) {
      const targetSectionPhotos = await db.photos
        .where('inspectionId')
        .equals(inspectionId)
        .filter((p) => p.target === 'section' && p.inspectionSectionId === targetSectionId && !p.deletedAt)
        .toArray();
      position = targetSectionPhotos.length;
    }

    const existing = await db.photos.get(photoId);
    if (existing) {
      await localWrite('photos', photoId, {
        ...existing,
        target: 'section',
        inspectionSectionId: targetSectionId,
        responseId: null,
        findingId: null,
        position,
      });
    }
  };

  // Assign or move photo to a chosen question
  const handleAssignToQuestion = async (
    photoId: string,
    questionId: string,
    targetSectionId?: string,
    customPosition?: number
  ) => {
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

      let position = customPosition;
      if (position === undefined) {
        const qPhotos = await db.photos
          .where('inspectionId')
          .equals(inspectionId)
          .filter((p) => p.target === 'question' && p.responseId === respId && !p.deletedAt)
          .toArray();
        position = qPhotos.length;
      }

      const targetPhoto = await db.photos.get(photoId);
      if (targetPhoto) {
        await localWrite('photos', photoId, {
          ...targetPhoto,
          target: 'question',
          responseId: respId,
          inspectionSectionId: null,
          findingId: null,
          position,
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
    if (isSelectMode) {
      setSelectedPhotoIds(prev => {
        const next = new Set(prev);
        if (next.has(photo.id)) next.delete(photo.id);
        else next.add(photo.id);
        return next;
      });
      return;
    }

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
    if (isSelectMode && !selectedPhotoIds.has(photo.id)) return;
    if (e.touches.length > 1) return;

    const t = e.touches[0];
    const startCoord = { clientX: t.clientX, clientY: t.clientY };
    touchStartPosRef.current = { x: t.clientX, y: t.clientY };
    isHoldingTouchRef.current = false;
    isLongPressTriggeredRef.current = false;

    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);

    const isSelected = selectedPhotoIds.has(photo.id);
    const photoIds = (isSelected && selectedPhotoIds.size > 1)
      ? Array.from(selectedPhotoIds)
      : [photo.id];

    // 280ms hold threshold to activate mobile drag & drop!
    longPressTimeoutRef.current = window.setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      isHoldingTouchRef.current = true;
      startTouchPhotoDrag(
        startCoord,
        {
          photoId: photo.id,
          photoIds,
          count: photoIds.length,
          fromTarget: target,
          fromSectionId: inspectionSectionId,
          fromResponseId: responseId,
          isDefect: photo.isDefect,
          photoUrl: urls[photo.id],
        },
        {
          onDropToQuestion: async (photoId, questionId, targetSecId, droppedIds) => {
            const idsToMove = (droppedIds && droppedIds.length > 0) ? droppedIds : [photoId];
            for (const id of idsToMove) {
              await handleAssignToQuestion(id, questionId, targetSecId);
            }
            setSelectedPhotoIds(new Set());
          },
          onDropToSection: async (photoId, targetSecId, droppedIds) => {
            const idsToMove = (droppedIds && droppedIds.length > 0) ? droppedIds : [photoId];
            for (const id of idsToMove) {
              await handleMoveToSection(id, targetSecId || inspectionSectionId || '');
            }
            setSelectedPhotoIds(new Set());
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
    const isSelected = selectedPhotoIds.has(photo.id);
    const photoIds = (isSelected && selectedPhotoIds.size > 1)
      ? Array.from(selectedPhotoIds)
      : [photo.id];

    startTouchPhotoDrag(
      startCoord,
      {
        photoId: photo.id,
        photoIds,
        count: photoIds.length,
        fromTarget: target,
        fromSectionId: inspectionSectionId,
        fromResponseId: responseId,
        isDefect: photo.isDefect,
        photoUrl: urls[photo.id],
      },
      {
        onDropToQuestion: async (photoId, questionId, targetSecId, droppedIds) => {
          const idsToMove = (droppedIds && droppedIds.length > 0) ? droppedIds : [photoId];
          for (const id of idsToMove) {
            await handleAssignToQuestion(id, questionId, targetSecId);
          }
          setSelectedPhotoIds(new Set());
        },
        onDropToSection: async (photoId, targetSecId, droppedIds) => {
          const idsToMove = (droppedIds && droppedIds.length > 0) ? droppedIds : [photoId];
          for (const id of idsToMove) {
            await handleMoveToSection(id, targetSecId || inspectionSectionId || '');
          }
          setSelectedPhotoIds(new Set());
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

    // Check if existing photos were dropped (e.g. from question back to section)
    let photoIds: string[] = [];
    try {
      const json = e.dataTransfer.getData('application/json');
      if (json) {
        const parsed = JSON.parse(json);
        if (parsed.photoIds && Array.isArray(parsed.photoIds)) {
          photoIds = parsed.photoIds;
        } else if (parsed.photoId) {
          photoIds = [parsed.photoId];
        }
      }
    } catch {}
    if (!photoIds.length) {
      const singleId = e.dataTransfer.getData('text/plain');
      if (singleId) photoIds = [singleId];
    }

    if (photoIds.length > 0) {
      let pos = photos.length;
      let movedCount = 0;
      for (const id of photoIds) {
        const existingPhoto = await db.photos.get(id);
        if (existingPhoto) {
          // Prevent drop into same section
          if (target === 'section' && existingPhoto.target === 'section' && existingPhoto.inspectionSectionId === inspectionSectionId) {
            continue;
          }
          // Prevent drop into same question
          if (target === 'question' && existingPhoto.target === 'question' && existingPhoto.responseId === responseId) {
            continue;
          }

          await localWrite('photos', id, {
            ...existingPhoto,
            target,
            inspectionSectionId: target === 'section' ? inspectionSectionId : null,
            responseId: target === 'question' ? responseId : null,
            findingId: target === 'finding' ? findingId : null,
            position: pos++,
          });
          movedCount++;
        }
      }
      setSelectedPhotoIds(new Set());
      if (movedCount > 0) {
        showDragNotification(`${movedCount} photo${movedCount > 1 ? 's' : ''} moved to ${target === 'section' ? 'section photos' : 'question'}`, 'success');
      } else {
        showDragNotification(target === 'section' ? 'Photos are already in section photos' : 'Photos already attached', 'warning');
      }
      return;
    }

    // Direct drop of image files from computer / desktop
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        let pos = photos.length;
        for (const file of files) {
          await addPhoto({
            file,
            target,
            inspectionId,
            inspectionSectionId,
            responseId,
            findingId,
            position: pos++,
            isDefect: false,
          });
        }
        showDragNotification(`${files.length} photo${files.length > 1 ? 's' : ''} added!`, 'success');
      }
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
  const handleSavePhotosFromCamera = async (newPhotos: { file: File; isDefect: boolean }[]): Promise<string[]> => {
    let position = photos.length;
    const addedIds: string[] = [];
    for (const item of newPhotos) {
      const id = await addPhoto({
        file: item.file,
        target,
        inspectionId,
        inspectionSectionId,
        responseId,
        findingId,
        position: position++,
        isDefect: item.isDefect,
      });
      addedIds.push(id);
    }
    return addedIds;
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
        isSelectMode ? (
          <div className="photostrip-header photostrip-select-banner">
            <div className="photostrip-select-info">
              <span className="photostrip-select-pill">
                <CheckIcon style={{ width: 12, height: 12 }} />
                {selectedPhotoIds.size} of {activePhotos.length} Selected
              </span>
              <span className="photostrip-select-instruction">
                {selectedPhotoIds.size === 0
                  ? 'Tap photos to select'
                  : `${selectedPhotoIds.size} photo${selectedPhotoIds.size > 1 ? 's' : ''} selected`}
              </span>
            </div>

            <div className="photostrip-actions">
              <button
                type="button"
                className="photostrip-btn-link"
                onClick={(e) => {
                  e.stopPropagation();
                  if (selectedPhotoIds.size === activePhotos.length) {
                    setSelectedPhotoIds(new Set());
                  } else {
                    setSelectedPhotoIds(new Set(activePhotos.map((p) => p.id)));
                  }
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (selectedPhotoIds.size === activePhotos.length) {
                    setSelectedPhotoIds(new Set());
                  } else {
                    setSelectedPhotoIds(new Set(activePhotos.map((p) => p.id)));
                  }
                }}
                title={selectedPhotoIds.size === activePhotos.length ? 'Deselect all photos' : 'Select all photos'}
              >
                {selectedPhotoIds.size === activePhotos.length ? 'Deselect All' : 'Select All'}
              </button>

              <button
                type="button"
                className="photostrip-btn-primary"
                disabled={selectedPhotoIds.size === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (selectedPhotoIds.size > 0) {
                    setMoveModalPhotos(activePhotos.filter((p) => selectedPhotoIds.has(p.id)));
                  }
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (selectedPhotoIds.size > 0) {
                    setMoveModalPhotos(activePhotos.filter((p) => selectedPhotoIds.has(p.id)));
                  }
                }}
                title={selectedPhotoIds.size === 0 ? 'Select photos to move' : 'Move selected photos'}
              >
                <CompassIcon style={{ width: 13, height: 13 }} />
                <span>Move {selectedPhotoIds.size > 0 ? `(${selectedPhotoIds.size})` : ''}</span>
              </button>

              <button
                type="button"
                className="photostrip-btn-link defect-btn"
                disabled={selectedPhotoIds.size === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleBatchSetDefect(true);
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (selectedPhotoIds.size > 0) void handleBatchSetDefect(true);
                }}
                title="Mark selected photos as Defect"
              >
                <WarningIcon style={{ width: 12, height: 12 }} />
                <span>Defect</span>
              </button>

              <button
                type="button"
                className="photostrip-btn-link normal-btn"
                disabled={selectedPhotoIds.size === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleBatchSetDefect(false);
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (selectedPhotoIds.size > 0) void handleBatchSetDefect(false);
                }}
                title="Mark selected photos as Normal"
              >
                <CheckCircleIcon style={{ width: 12, height: 12 }} />
                <span>Normal</span>
              </button>

              <button
                type="button"
                className="photostrip-btn-link delete-btn"
                disabled={selectedPhotoIds.size === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleBatchDelete();
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (selectedPhotoIds.size > 0) void handleBatchDelete();
                }}
                title="Delete selected photos"
              >
                <TrashIcon style={{ width: 12, height: 12 }} />
                <span>Delete</span>
              </button>

              <button
                type="button"
                className="photostrip-btn-link"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSelectMode(false);
                  setSelectedPhotoIds(new Set());
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setIsSelectMode(false);
                  setSelectedPhotoIds(new Set());
                }}
                title="Cancel selection mode"
              >
                <XIcon style={{ width: 12, height: 12 }} />
                <span>Done</span>
              </button>
            </div>
          </div>
        ) : (
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
                onClick={(e) => {
                  e.stopPropagation();
                  setViewerIndex(0);
                  setIsViewerOpen(true);
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
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
                onClick={(e) => { e.stopPropagation(); handleBatchDownload('all'); }}
                onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); handleBatchDownload('all'); }}
                title="Download all photos as ZIP"
              >
                <DownloadIcon style={{ width: 13, height: 13 }} />
                All ({activePhotos.length})
              </button>

              {defectCount > 0 && (
                <button
                  type="button"
                  className="photostrip-btn-link defect-btn"
                  onClick={(e) => { e.stopPropagation(); handleBatchDownload('defect'); }}
                  onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); handleBatchDownload('defect'); }}
                  title="Download defect photos as ZIP"
                >
                  <WarningIcon style={{ width: 13, height: 13 }} />
                  Defect ({defectCount})
                </button>
              )}

              {!locked && (
                <button
                  type="button"
                  className="photostrip-btn-link select-btn"
                  onClick={(e) => { e.stopPropagation(); setIsSelectMode(true); }}
                  onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setIsSelectMode(true); }}
                  title="Select multiple photos to move"
                >
                  <CheckCircleIcon style={{ width: 13, height: 13 }} />
                  Select
                </button>
              )}
            </div>
          </div>
        )
      )}

      {/* ── Thumbnails Row ── */}
      <div className="thumb-row">
        {activePhotos.map((p, idx) => {
          const isSelected = selectedPhotoIds.has(p.id);
          return (
            <div
              key={p.id}
              className={`thumb${p.isDefect ? ' defect' : ''}${!locked ? ' draggable' : ''}${isSelectMode ? ' select-mode' : ''}${isSelected ? ' selected' : ''}`}
              draggable={!locked}
              onDragStart={(e) => {
                if (locked) return;
                const photoIds = (isSelected && selectedPhotoIds.size > 1)
                  ? Array.from(selectedPhotoIds)
                  : [p.id];
                startPhotoDrag({
                  photoId: p.id,
                  photoIds,
                  count: photoIds.length,
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
                    photoIds,
                    count: photoIds.length,
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
              style={{ cursor: isSelectMode ? 'pointer' : !locked ? 'grab' : 'pointer' }}
              title={
                isSelectMode
                  ? isSelected
                    ? 'Selected - click to deselect'
                    : 'Click to select photo'
                  : target === 'section'
                  ? 'Click to view, double-click or hold for options (normal/defect, move section)'
                  : 'Click to view, double-click or hold for options'
              }
            >
              {/* Selection Checkbox Badge when in Select Mode */}
              {isSelectMode && (
                <div
                  className={`thumb-select-badge ${isSelected ? 'checked' : ''}`}
                  title={isSelected ? 'Photo selected' : 'Click to select'}
                >
                  {isSelected && <CheckIcon style={{ width: 9, height: 9, strokeWidth: 3 }} />}
                </div>
              )}

              {/* Translucent overlay when selected */}
              {isSelectMode && isSelected && (
                <div className="thumb-selected-overlay" />
              )}

              {/* Drag grip icon */}
              {!locked && (!isSelectMode || isSelected) && (
                <span
                  className={`thumb-drag-indicator${isSelectMode && isSelected ? ' in-select-mode' : ''}`}
                  title={isSelected && selectedPhotoIds.size > 1 ? `Drag ${selectedPhotoIds.size} photos` : "Drag to question"}
                  onTouchStart={(e) => handleTouchDragInitiate(e, p)}
                >
                  <GripVerticalIcon width={12} height={12} />
                </span>
              )}

              {/* Quick options button (Double-click or hold) */}
              {!locked && !isSelectMode && (
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
              {!locked && !isSelectMode && target === 'section' && availableQuestions && availableQuestions.length > 0 && (
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

              {!locked && !isSelectMode && (
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
          );
        })}
      </div>

      {/* ── Take / Upload Controls ── */}
      {!locked && (
        <div className="photo-btns">
          {/* Direct Camera Button */}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={(e) => { e.stopPropagation(); setIsCameraModalOpen(true); }}
            onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setIsCameraModalOpen(true); }}
            title="Open camera to capture photos"
          >
            <CameraIcon />
            Take photo
          </button>

          {/* Direct Upload Photos Button */}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              setModalInitialFiles([]);
              setIsUploadModalOpen(true);
            }}
            onTouchEnd={(e) => {
              e.stopPropagation();
              e.preventDefault();
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
          onOpenMoveModal={(p) => setMoveModalPhotos([p])}
          onOpenAssignModal={availableQuestions && availableQuestions.length > 0 ? (p) => setAssignModalPhoto(p) : undefined}
          onDeletePhoto={async (photoId) => {
            await localDelete('photos', photoId);
          }}
          onClose={() => setTooltipTarget(null)}
        />
      )}

      {/* ── Move Photo to Any Section / Question Modal ── */}
      {moveModalPhotos && moveModalPhotos.length > 0 && allSections && (
        <MovePhotoModal
          isOpen={true}
          photos={moveModalPhotos}
          photoUrls={moveModalPhotos.map(p => urls[p.id] || '')}
          currentSectionId={inspectionSectionId}
          sections={allSections}
          onMoveToSection={async (targetSecId) => {
            const targetSectionPhotos = await db.photos
              .where('inspectionId')
              .equals(inspectionId)
              .filter((p) => p.target === 'section' && p.inspectionSectionId === targetSecId && !p.deletedAt)
              .toArray();
            let basePos = targetSectionPhotos.length;
            for (const photo of moveModalPhotos) {
              await handleMoveToSection(photo.id, targetSecId, basePos++);
            }
            setMoveModalPhotos(null);
            setSelectedPhotoIds(new Set());
          }}
          onMoveToQuestion={async (targetQId, targetSecId) => {
            const existing = await db.responses
              .where('inspectionId')
              .equals(inspectionId)
              .filter((r) => r.inspectionQuestionId === targetQId)
              .first();
            let basePos = 0;
            if (existing) {
              const qPhotos = await db.photos
                .where('inspectionId')
                .equals(inspectionId)
                .filter((p) => p.target === 'question' && p.responseId === existing.id && !p.deletedAt)
                .toArray();
              basePos = qPhotos.length;
            }
            for (const photo of moveModalPhotos) {
              await handleAssignToQuestion(photo.id, targetQId, targetSecId, basePos++);
            }
            setMoveModalPhotos(null);
            setSelectedPhotoIds(new Set());
          }}
          onClose={() => setMoveModalPhotos(null)}
        />
      )}
    </div>
  );
}
