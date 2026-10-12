import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  DownloadIcon,
  WarningIcon,
  CheckCircleIcon,
  XIcon,
} from '../../icons';
import './PhotoDownloadModal.css';

export type DownloadFilterOption = 'defect' | 'normal' | 'all';

interface PhotoDownloadModalProps {
  isOpen: boolean;
  totalCount: number;
  defectCount: number;
  normalCount: number;
  sectionTitle?: string;
  isDownloading?: boolean;
  onSelect: (option: DownloadFilterOption) => void;
  onClose: () => void;
}

export function PhotoDownloadModal({
  isOpen,
  totalCount,
  defectCount,
  normalCount,
  sectionTitle,
  isDownloading = false,
  onSelect,
  onClose,
}: PhotoDownloadModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isDownloading) {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, isDownloading, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="pdm-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDownloading) {
          onClose();
        }
      }}
    >
      <div className="pdm-dialog" role="dialog" aria-modal="true" aria-labelledby="pdm-title">
        {/* Mobile sheet pull bar indicator */}
        <div className="pdm-drag-handle-wrap">
          <div className="pdm-drag-handle" />
        </div>

        {/* Header */}
        <div className="pdm-header">
          <div>
            <h2 id="pdm-title" className="pdm-title">Download Photos</h2>
            <p className="pdm-subtitle">
              {sectionTitle ? `Select which photos to export for ${sectionTitle}:` : 'Select which photos to export as ZIP archive:'}
            </p>
          </div>
          <button
            type="button"
            className="pdm-close-btn"
            onClick={onClose}
            disabled={isDownloading}
            aria-label="Close dialog"
          >
            <XIcon width={18} height={18} />
          </button>
        </div>

        {/* Options list: All Photos first, then Defect, then Normal */}
        <div className="pdm-options-list">
          {/* 1. All Option (First) */}
          <button
            type="button"
            className="pdm-option-card pdm-option-all"
            disabled={totalCount === 0 || isDownloading}
            onClick={() => onSelect('all')}
          >
            <div className="pdm-option-icon pdm-icon-all">
              <DownloadIcon width={22} height={22} />
            </div>
            <div className="pdm-option-body">
              <div className="pdm-option-top">
                <span className="pdm-option-label">All Photos</span>
                <span className="pdm-badge pdm-badge-all">
                  {totalCount}
                </span>
              </div>
              <div className="pdm-option-desc">
                Download all photos organized into normal and defect folders
              </div>
            </div>
          </button>

          {/* 2. Defect Option */}
          <button
            type="button"
            className="pdm-option-card pdm-option-defect"
            disabled={defectCount === 0 || isDownloading}
            onClick={() => onSelect('defect')}
          >
            <div className="pdm-option-icon pdm-icon-defect">
              <WarningIcon width={22} height={22} />
            </div>
            <div className="pdm-option-body">
              <div className="pdm-option-top">
                <span className="pdm-option-label">Defect Photos</span>
                <span className={`pdm-badge ${defectCount > 0 ? 'pdm-badge-defect' : 'pdm-badge-empty'}`}>
                  {defectCount}
                </span>
              </div>
              <div className="pdm-option-desc">
                {defectCount > 0
                  ? 'Download only photos flagged as defects'
                  : 'No defect photos recorded in this section'}
              </div>
            </div>
          </button>

          {/* 3. Normal Option */}
          <button
            type="button"
            className="pdm-option-card pdm-option-normal"
            disabled={normalCount === 0 || isDownloading}
            onClick={() => onSelect('normal')}
          >
            <div className="pdm-option-icon pdm-icon-normal">
              <CheckCircleIcon width={22} height={22} />
            </div>
            <div className="pdm-option-body">
              <div className="pdm-option-top">
                <span className="pdm-option-label">Normal Photos</span>
                <span className={`pdm-badge ${normalCount > 0 ? 'pdm-badge-normal' : 'pdm-badge-empty'}`}>
                  {normalCount}
                </span>
              </div>
              <div className="pdm-option-desc">
                {normalCount > 0
                  ? 'Download only standard condition photos'
                  : 'No normal photos recorded in this section'}
              </div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="pdm-footer">
          <button
            type="button"
            className="pdm-cancel-btn"
            onClick={onClose}
            disabled={isDownloading}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
