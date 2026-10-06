import React, { useState, useRef, useEffect } from 'react';
import type { PhotoTarget } from '@ozellar/shared';
import { addPhoto } from '../../offline/photoQueue';
import {
  UploadIcon,
  XIcon,
  WarningIcon,
  CheckIcon,
  PlusIcon,
} from '../../icons';
import './PhotoUploadModal.css';

export interface PendingPhotoItem {
  id: string;
  file: File;
  previewUrl: string;
  isDefect: boolean;
  name: string;
  sizeFormatted: string;
}

export interface PhotoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialFiles?: File[];
  target: PhotoTarget;
  inspectionId: string;
  inspectionSectionId?: string;
  responseId?: string;
  findingId?: string;
  title?: string;
  currentPhotoCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PhotoUploadModal({
  isOpen,
  onClose,
  initialFiles = [],
  target,
  inspectionId,
  inspectionSectionId,
  responseId,
  findingId,
  title,
  currentPhotoCount,
}: PhotoUploadModalProps) {
  const [items, setItems] = useState<PendingPhotoItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Initialize with initialFiles when modal opens
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      const newItems: PendingPhotoItem[] = initialFiles
        .filter((f) => f.type.startsWith('image/'))
        .map((file) => ({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          isDefect: false,
          name: file.name,
          sizeFormatted: formatBytes(file.size),
        }));
      setItems(newItems);
    } else {
      setItems([]);
    }
  }, [initialFiles, isOpen]);

  // Clean up object URLs when modal unmounts or items change
  useEffect(() => {
    return () => {
      itemsRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    };
  }, []);

  if (!isOpen) return null;

  const appendFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;

    const newItems: PendingPhotoItem[] = list.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      isDefect: false,
      name: file.name,
      sizeFormatted: formatBytes(file.size),
    }));

    setItems((prev) => [...prev, ...newItems]);
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      appendFiles(e.dataTransfer.files);
    }
  };

  // Bulk set all to normal or defect
  const setAllDefect = (isDefect: boolean) => {
    setItems((prev) => prev.map((it) => ({ ...it, isDefect })));
  };

  // Toggle individual item
  const toggleItemDefect = (id: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, isDefect: !it.isDefect } : it))
    );
  };

  // Remove individual item
  const removeItem = (id: string) => {
    setItems((prev) => {
      const targetItem = prev.find((it) => it.id === id);
      if (targetItem) URL.revokeObjectURL(targetItem.previewUrl);
      return prev.filter((it) => it.id !== id);
    });
  };

  // Close and cleanup
  const handleClose = () => {
    if (isUploading) return;
    items.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    setItems([]);
    onClose();
  };

  // Perform upload
  const handleUploadAll = async () => {
    if (!items.length || isUploading) return;
    setIsUploading(true);
    setUploadProgress({ current: 0, total: items.length });

    try {
      let position = currentPhotoCount;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setUploadProgress({ current: i + 1, total: items.length });

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

      // Cleanup and close
      items.forEach((it) => URL.revokeObjectURL(it.previewUrl));
      setItems([]);
      onClose();
    } catch (err: any) {
      alert(`Photo upload error: ${err.message || 'Unknown error during save'}`);
      console.error('Batch photo upload failed', err);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const defectCount = items.filter((it) => it.isDefect).length;
  const normalCount = items.length - defectCount;

  return (
    <div className="pum-overlay" onClick={handleClose}>
      <div className="pum-modal" onClick={(e) => e.stopPropagation()}>
        {/* Hidden input for selecting files */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) appendFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {/* ── Modal Header ── */}
        <div className="pum-header">
          <div>
            <h2 className="pum-title">Upload Photos</h2>
            {title && <span className="pum-subtitle">{title}</span>}
          </div>
          <button
            type="button"
            className="pum-close-btn"
            onClick={handleClose}
            disabled={isUploading}
            aria-label="Close dialog"
          >
            <XIcon />
          </button>
        </div>

        {/* ── Modal Body ── */}
        <div className="pum-body">
          {items.length === 0 ? (
            /* ── Empty State: Large Drag & Drop Dropzone ── */
            <div
              className={`pum-dropzone-large ${isDragging ? 'is-dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="pum-dropzone-large-icon">
                <UploadIcon style={{ width: 44, height: 44, color: '#0284c7' }} />
              </div>
              <span className="pum-dropzone-large-title">Drag & drop photos here</span>
              <span className="pum-dropzone-large-sub">or click anywhere to browse from your device</span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <PlusIcon style={{ width: 16, height: 16 }} />
                <span>Browse Files</span>
              </button>
            </div>
          ) : (
            <>
              {/* ── Batch Selection Toolbar ── */}
              <div className="pum-batch-bar">
                <div className="pum-batch-summary">
                  <span className="pum-batch-badge total">{items.length} Selected</span>
                  <span className="pum-batch-badge normal">{normalCount} Normal</span>
                  {defectCount > 0 && (
                    <span className="pum-batch-badge defect">{defectCount} Defect</span>
                  )}
                </div>

                <div className="pum-batch-actions">
                  <span className="pum-batch-label">Set all:</span>
                  <button
                    type="button"
                    className="pum-pill-btn normal"
                    onClick={() => setAllDefect(false)}
                    disabled={isUploading}
                    title="Mark all selected photos as Normal"
                  >
                    <CheckIcon style={{ width: 12, height: 12 }} />
                    All Normal
                  </button>
                  <button
                    type="button"
                    className="pum-pill-btn defect"
                    onClick={() => setAllDefect(true)}
                    disabled={isUploading}
                    title="Mark all selected photos as Defect"
                  >
                    <WarningIcon style={{ width: 12, height: 12 }} />
                    All Defect
                  </button>
                </div>
              </div>

              {/* ── Selected Photos Grid ── */}
              <div className="pum-items-grid">
                {items.map((it, idx) => (
                  <div
                    key={it.id}
                    className={`pum-item-card ${it.isDefect ? 'is-defect' : 'is-normal'}`}
                  >
                    <div className="pum-item-thumb-wrap">
                      <img src={it.previewUrl} alt={it.name} className="pum-item-thumb" />
                      <span className="pum-item-index">{idx + 1}</span>
                    </div>

                    <div className="pum-item-info">
                      <div className="pum-item-name" title={it.name}>
                        {it.name}
                      </div>
                      <div className="pum-item-size">{it.sizeFormatted}</div>

                      {/* Defect vs Normal Segmented Switch */}
                      <div className="pum-item-type-switch">
                        <button
                          type="button"
                          className={`pum-type-btn normal ${!it.isDefect ? 'active' : ''}`}
                          onClick={() => toggleItemDefect(it.id)}
                          disabled={isUploading}
                        >
                          <CheckIcon style={{ width: 12, height: 12 }} />
                          Normal
                        </button>

                        <button
                          type="button"
                          className={`pum-type-btn defect ${it.isDefect ? 'active' : ''}`}
                          onClick={() => toggleItemDefect(it.id)}
                          disabled={isUploading}
                        >
                          <WarningIcon style={{ width: 12, height: 12 }} />
                          Defect
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="pum-item-remove-btn"
                      onClick={() => removeItem(it.id)}
                      disabled={isUploading}
                      aria-label="Remove this photo"
                      title="Remove photo"
                    >
                      <XIcon style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                ))}
              </div>

              {/* ── Compact Add More Dropzone ── */}
              <div
                className={`pum-dropzone-compact ${isDragging ? 'is-dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="pum-dropzone-compact-text">
                  <UploadIcon style={{ width: 18, height: 18 }} />
                  <span>Drop more photos here, or:</span>
                </div>

                <div className="pum-compact-actions">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm pum-btn-compact"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    <PlusIcon style={{ width: 14, height: 14 }} />
                    <span>Browse Files</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Modal Footer ── */}
        <div className="pum-footer">
          <div className="pum-footer-summary">
            {uploadProgress ? (
              <span className="pum-progress-text">
                Compressing & saving {uploadProgress.current} of {uploadProgress.total}...
              </span>
            ) : (
              <span>
                {items.length > 0 ? (
                  <>
                    Ready to upload <b>{items.length} photo{items.length > 1 ? 's' : ''}</b> ({normalCount} Normal, {defectCount} Defect)
                  </>
                ) : (
                  'No photos selected'
                )}
              </span>
            )}
          </div>

          <div className="pum-footer-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleClose}
              disabled={isUploading}
            >
              Cancel
            </button>

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleUploadAll}
              disabled={items.length === 0 || isUploading}
              style={{ minWidth: 160 }}
            >
              {isUploading
                ? 'Saving...'
                : `Upload ${items.length} Photo${items.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
