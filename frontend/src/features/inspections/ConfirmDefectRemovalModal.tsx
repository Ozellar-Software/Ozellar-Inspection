import React from 'react';
import type { Finding, Photo } from '@ozellar/shared';
import { WarningIcon, XIcon, TrashIcon } from '../../icons';
import './ConfirmDefectRemovalModal.css';

export interface ConfirmDefectRemovalModalProps {
  isOpen: boolean;
  photo?: Photo | null;
  finding?: Finding | null;
  sectionName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDefectRemovalModal({
  isOpen,
  photo,
  finding,
  sectionName,
  onConfirm,
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
            <h3 className="cdrm-title">Remove Associated Observation?</h3>
            <p className="cdrm-subtitle">
              Changing this photograph from Defect to Normal will affect existing observation data.
            </p>
          </div>
          <button type="button" className="cdrm-close-btn" onClick={onCancel} title="Cancel">
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="cdrm-body">
          <p className="cdrm-warning-text">
            This photo is linked to an active defect observation in{' '}
            <strong>{sectionName || 'this section'}</strong>.
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
            Proceeding will <strong>delete this observation</strong> and mark the photograph as
            Satisfactory/Normal.
          </p>
        </div>

        <div className="cdrm-footer">
          <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>
            Keep as Defect (Cancel)
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm cdrm-confirm-btn"
            onClick={onConfirm}
          >
            <TrashIcon style={{ width: 14, height: 14 }} />
            <span>Remove Observation & Set Normal</span>
          </button>
        </div>
      </div>
    </div>
  );
}
