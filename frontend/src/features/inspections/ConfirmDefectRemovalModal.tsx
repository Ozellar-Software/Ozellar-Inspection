import React from 'react';
import type { Finding, Photo } from '@ozellar/shared';
import { WarningIcon, XIcon, TrashIcon, CheckIcon } from '../../icons';
import './ConfirmDefectRemovalModal.css';

export interface ConfirmDefectRemovalModalProps {
  isOpen: boolean;
  photo?: Photo | null;
  finding?: Finding | null;
  sectionName?: string;
  onRemoveObservationAndSetNormal: () => void;
  onKeepObservationAndSetNormal: () => void;
  onCancel: () => void;
}

export function ConfirmDefectRemovalModal({
  isOpen,
  photo,
  finding,
  sectionName,
  onRemoveObservationAndSetNormal,
  onKeepObservationAndSetNormal,
  onCancel,
}: ConfirmDefectRemovalModalProps) {
  if (!isOpen || !finding) return null;

  return (
    <div className="cdrm-backdrop" onClick={onCancel}>
      <div className="cdrm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cdrm-header">
          <div className="cdrm-icon-wrap">
            <WarningIcon style={{ width: 22, height: 22 }} />
          </div>
          <div className="cdrm-header-text">
            <h3 className="cdrm-title">Observation Details Exist</h3>
            <p className="cdrm-subtitle">
              Do you want to delete this observation?
            </p>
          </div>
          <button type="button" className="cdrm-close-btn" onClick={onCancel} title="Cancel">
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="cdrm-body">
          <p className="cdrm-warning-text">
            This photo is linked to an active observation in{' '}
            <strong>{sectionName || 'this section'}</strong> which has entered details:
          </p>

          <div className="cdrm-finding-preview">
            <div className="cdrm-preview-row">
              <span className="cdrm-preview-label">Observation Details:</span>
              <span className="cdrm-preview-val">
                {finding.text?.trim() ? finding.text : <em className="faint">(No description entered)</em>}
              </span>
            </div>
            {finding.correctiveAction?.trim() && (
              <div className="cdrm-preview-row">
                <span className="cdrm-preview-label">Corrective Action:</span>
                <span className="cdrm-preview-val">{finding.correctiveAction}</span>
              </div>
            )}
            {finding.preventiveAction?.trim() && (
              <div className="cdrm-preview-row">
                <span className="cdrm-preview-label">Preventive Action:</span>
                <span className="cdrm-preview-val">{finding.preventiveAction}</span>
              </div>
            )}
          </div>

          <p className="cdrm-note">
            Changing this photo to Normal: choose <strong>Yes</strong> to delete this observation, or <strong>No</strong> to keep the observation in the report without this photo.
          </p>
        </div>

        <div className="cdrm-footer">
          <button type="button" className="btn btn-outline btn-sm cdrm-cancel-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm cdrm-keep-btn"
            onClick={onKeepObservationAndSetNormal}
            title="Mark photo as Normal and keep this observation in the section"
          >
            <CheckIcon style={{ width: 14, height: 14 }} />
            <span>No, Keep Observation</span>
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm cdrm-confirm-btn"
            onClick={onRemoveObservationAndSetNormal}
            title="Mark photo as Normal and delete this observation"
          >
            <TrashIcon style={{ width: 14, height: 14 }} />
            <span>Yes, Delete Observation</span>
          </button>
        </div>
      </div>
    </div>
  );
}
