import React, { useEffect, useState } from 'react';
import { TrashIcon, AlertCircleIcon } from '../icons';
import './ConfirmDeleteModal.css';

export interface ConfirmDeleteModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onCancel?: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description: React.ReactNode;
  subdesc?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  previewImageUrl?: string | null;
  loading?: boolean;
}

export function ConfirmDeleteModal({
  isOpen,
  onClose,
  onCancel,
  onConfirm,
  title,
  description,
  subdesc,
  confirmText = 'Yes, Delete',
  cancelText = 'Cancel',
  previewImageUrl,
  loading = false,
}: ConfirmDeleteModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = isDeleting || loading;
  const handleClose = () => {
    if (onCancel) onCancel();
    else if (onClose) onClose();
  };

  useEffect(() => {
    if (isOpen) {
      setIsDeleting(false);
      setError(null);
    }
  }, [isOpen, title]);

  if (!isOpen) return null;

  async function handleConfirm() {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
      handleClose();
    } catch (err: any) {
      console.error('Failed to complete delete action:', err);
      setError(err?.message || 'Could not complete deletion. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div
      className="confirm-delete-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) handleClose();
      }}
    >
      <div
        className="confirm-delete-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
      >
        <div className="confirm-delete-icon-box">
          <TrashIcon width={26} height={26} />
        </div>

        <h3 id="confirm-delete-title" className="confirm-delete-title">
          {title}
        </h3>

        {previewImageUrl && (
          <div className="confirm-delete-preview-wrap">
            <img src={previewImageUrl} alt="Preview" className="confirm-delete-preview-img" />
          </div>
        )}

        <div className="confirm-delete-desc">{description}</div>

        {subdesc && <div className="confirm-delete-subdesc">{subdesc}</div>}

        {error && (
          <div className="confirm-delete-error">
            <AlertCircleIcon width={16} height={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="confirm-delete-actions">
          <button
            type="button"
            className="confirm-delete-btn-cancel"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className="confirm-delete-btn-confirm"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void handleConfirm();
            }}
          >
            <TrashIcon width={15} height={15} />
            <span>{busy ? 'Deleting…' : confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
