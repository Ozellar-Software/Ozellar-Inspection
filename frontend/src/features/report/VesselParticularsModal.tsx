import { useEffect } from 'react';
import type { VesselParticularKey } from '@ozellar/shared';
import { PARTICULAR_GROUPS, PARTICULAR_LABELS } from '../vessels/particulars';
import { WarningIcon, XIcon } from '../../icons';
import './VesselParticularsModal.css';

export interface VesselParticularsModalProps {
  isOpen: boolean;
  vesselName?: string;
  reportCategoryLabel: string;
  values: Partial<Record<VesselParticularKey, string>>;
  onChange: (key: VesselParticularKey, value: string) => void;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSkip: () => void;
  onSave: () => void;
}

export function VesselParticularsModal({
  isOpen,
  vesselName,
  reportCategoryLabel,
  values,
  onChange,
  saving,
  error,
  onCancel,
  onSkip,
  onSave,
}: VesselParticularsModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onCancel]);

  if (!isOpen) return null;

  const filledCount = Object.values(values).filter((v) => !!v && String(v).trim() !== '').length;

  return (
    <div className="vpm-overlay" onClick={() => !saving && onCancel()}>
      <div className="vpm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vpm-header">
          <div>
            <h2 className="vpm-title">Vessel Technical Particulars</h2>
            <span className="vpm-subtitle">
              {reportCategoryLabel} report for <b>{vesselName || 'this vessel'}</b>
            </span>
          </div>
          <button type="button" className="vpm-close-btn" onClick={onCancel} disabled={saving} aria-label="Close dialog">
            <XIcon />
          </button>
        </div>

        <div className="vpm-banner">
          <WarningIcon style={{ width: 15, height: 15, flexShrink: 0 }} />
          <span>
            This vessel has no technical particulars on record. Fill in what you know below — it's saved to the
            vessel's master record and will appear in the "Vessel Technical Particulars" section of this report.
          </span>
        </div>

        <div className="vpm-body">
          {PARTICULAR_GROUPS.map((group) => (
            <div key={group.title} className="vpm-group">
              <div className="vpm-group-title">{group.title}</div>
              <div className="vpm-group-grid">
                {group.keys.map((key) => (
                  <label key={key} className="vpm-field">
                    <span className="vpm-field-label">{PARTICULAR_LABELS[key]}</span>
                    <input
                      type="text"
                      className="vpm-field-input"
                      value={values[key] ?? ''}
                      onChange={(e) => onChange(key, e.target.value)}
                      disabled={saving}
                      placeholder={`Enter ${PARTICULAR_LABELS[key].toLowerCase()}...`}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error && <div className="vpm-error">{error}</div>}

        <div className="vpm-footer">
          <span className="vpm-footer-summary">
            {filledCount > 0 ? `${filledCount} field${filledCount > 1 ? 's' : ''} filled` : 'No fields filled yet'}
          </span>
          <div className="vpm-footer-actions">
            <button type="button" className="btn btn-outline" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-outline" onClick={onSkip} disabled={saving}>
              Skip & Download
            </button>
            <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving || filledCount === 0}>
              {saving ? 'Saving...' : 'Save & Download'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
