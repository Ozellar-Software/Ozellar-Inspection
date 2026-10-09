import React, { useState } from 'react';
import type { Inspection } from '@ozellar/shared';
import { db } from '../../offline/db';
import { localDelete } from '../../offline/outbox';
import { syncNow } from '../../offline/sync';
import { TrashIcon, AlertCircleIcon } from '../../icons';
import './DeleteInspectionModal.css';

interface DeleteInspectionModalProps {
  inspection: Inspection | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted?: (inspectionId: string) => void;
}

export function DeleteInspectionModal({
  inspection,
  isOpen,
  onClose,
  onDeleted,
}: DeleteInspectionModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !inspection) return null;

  async function handleConfirmDelete() {
    if (!inspection) return;
    setIsDeleting(true);
    setError(null);
    try {
      await localDelete('inspections', inspection.id);
      await db.inspections.update(inspection.id, { deletedAt: new Date().toISOString() });
      if (navigator.onLine) {
        void syncNow();
      }
      onDeleted?.(inspection.id);
      onClose();
    } catch (err: any) {
      console.error('Failed to delete inspection:', err);
      setError(err?.message || 'Failed to delete inspection. Please try again.');
      setIsDeleting(false);
    }
  }

  return (
    <div className="delete-inspection-backdrop" onClick={() => !isDeleting && onClose()}>
      <div className="delete-inspection-card" onClick={(e) => e.stopPropagation()}>
        <div className="delete-inspection-icon-box">
          <TrashIcon width={28} height={28} />
        </div>

        <h3 className="delete-inspection-title">Delete Inspection</h3>
        <p className="delete-inspection-desc">
          Are you sure you want to delete the inspection for{' '}
          <strong>{inspection.vesselName || 'Unnamed vessel'}</strong>?
        </p>
        <p className="delete-inspection-subdesc">
          This will remove this inspection, checklist responses, observations, and photos from active records. This action can only be performed by administrators.
        </p>

        {error && (
          <div className="delete-inspection-error-msg">
            <AlertCircleIcon width={16} height={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="delete-inspection-actions">
          <button
            type="button"
            className="delete-inspection-btn-cancel"
            disabled={isDeleting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="delete-inspection-btn-confirm"
            disabled={isDeleting}
            onClick={handleConfirmDelete}
          >
            <TrashIcon width={15} height={15} />
            {isDeleting ? 'Deleting Inspection...' : 'Yes, Delete Inspection'}
          </button>
        </div>
      </div>
    </div>
  );
}
