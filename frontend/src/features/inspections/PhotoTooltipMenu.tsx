import React, { useEffect, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { InspectionSection, Photo } from '@ozellar/shared';
import {
  WarningIcon,
  CheckIcon,
  CompassIcon,
  ArrowRightCircleIcon,
  TrashIcon,
} from '../../icons';
import type { QuestionSummary } from './PhotoStrip';
import './PhotoTooltipMenu.css';

interface PhotoTooltipMenuProps {
  photo: Photo;
  anchorEl: HTMLElement;
  locked?: boolean;
  allSections?: InspectionSection[];
  availableQuestions?: QuestionSummary[];
  onToggleDefect: (photoId: string, isDefect: boolean) => Promise<void> | void;
  onOpenMoveModal: (photo: Photo) => void;
  onOpenAssignModal?: (photo: Photo) => void;
  onDeletePhoto?: (photoId: string) => Promise<void> | void;
  onClose: () => void;
}

export function PhotoTooltipMenu({
  photo,
  anchorEl,
  locked = false,
  allSections = [],
  availableQuestions = [],
  onToggleDefect,
  onOpenMoveModal,
  onOpenAssignModal,
  onDeletePhoto,
  onClose,
}: PhotoTooltipMenuProps) {
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    placed: 'top' | 'bottom';
    arrowLeft: number;
  } | null>(null);

  useLayoutEffect(() => {
    function computeCoords() {
      if (!anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const menuWidth = 220;
      const menuHeight = 150;
      const viewportWidth = window.innerWidth;

      const placeTop = rect.top >= menuHeight + 14;
      const top = placeTop ? rect.top - 8 : rect.bottom + 8;
      const placed: 'top' | 'bottom' = placeTop ? 'top' : 'bottom';

      const anchorCenter = rect.left + rect.width / 2;
      let left = anchorCenter - menuWidth / 2;
      left = Math.max(10, Math.min(left, viewportWidth - menuWidth - 10));

      const arrowLeft = Math.max(14, Math.min(anchorCenter - left - 5, menuWidth - 24));

      setCoords({ top, left, placed, arrowLeft });
    }

    computeCoords();
    window.addEventListener('resize', computeCoords);
    window.addEventListener('scroll', computeCoords, true);

    return () => {
      window.removeEventListener('resize', computeCoords);
      window.removeEventListener('scroll', computeCoords, true);
    };
  }, [anchorEl]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!coords) return null;

  return createPortal(
    <>
      <div
        className="ptt-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className={`ptt-bubble placed-${coords.placed}`}
        style={{
          top: coords.placed === 'top' ? undefined : coords.top,
          bottom: coords.placed === 'top' ? window.innerHeight - coords.top : undefined,
          left: coords.left,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pointer Arrow */}
        <div
          className="ptt-arrow"
          style={{ left: coords.arrowLeft }}
        />

        {/* Header Indicator */}
        <div className="ptt-header">
          <span className={`ptt-status-chip ${photo.isDefect ? 'defect' : 'normal'}`}>
            {photo.isDefect ? 'Defect' : 'Normal'}
          </span>
          <span className="ptt-header-hint">Quick Options</span>
        </div>

        {/* Action 1: Toggle Normal / Defect */}
        {!locked && (
          <button
            type="button"
            className="ptt-item"
            onClick={() => {
              void onToggleDefect(photo.id, !photo.isDefect);
              onClose();
            }}
          >
            {photo.isDefect ? (
              <>
                <CheckIcon width={15} height={15} className="ptt-icon-success" />
                <span>Mark as Normal</span>
              </>
            ) : (
              <>
                <WarningIcon width={15} height={15} className="ptt-icon-defect" />
                <span>Mark as Defect</span>
              </>
            )}
          </button>
        )}

        {/* Action 2: Move to Section or Question */}
        {!locked && allSections.length > 0 && (
          <button
            type="button"
            className="ptt-item"
            onClick={() => {
              onClose();
              onOpenMoveModal(photo);
            }}
          >
            <CompassIcon width={15} height={15} className="ptt-icon-move" />
            <span>Move to Section / Question…</span>
          </button>
        )}

        {/* Action 3: Assign to Question (if section questions exist) */}
        {!locked && availableQuestions.length > 0 && onOpenAssignModal && (
          <button
            type="button"
            className="ptt-item"
            onClick={() => {
              onClose();
              onOpenAssignModal(photo);
            }}
          >
            <ArrowRightCircleIcon width={15} height={15} className="ptt-icon-assign" />
            <span>Assign to Question…</span>
          </button>
        )}

        {/* Action 4: Delete */}
        {!locked && onDeletePhoto && (
          <button
            type="button"
            className="ptt-item danger"
            onClick={() => {
              if (window.confirm('Are you sure you want to delete this photo?')) {
                onClose();
                void onDeletePhoto(photo.id);
              }
            }}
          >
            <TrashIcon width={15} height={15} className="ptt-icon-del" />
            <span>Delete Photo</span>
          </button>
        )}
      </div>
    </>,
    document.body
  );
}
