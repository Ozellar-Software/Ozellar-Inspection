import { useState, useEffect } from 'react';
import type { Finding, InspectionSection, Photo } from '@ozellar/shared';
import { localWrite, localDelete } from '../../offline/outbox';
import { PhotoStrip } from './PhotoStrip';
import { TrashIcon, CheckIcon, XIcon } from '../../icons';
import { ConfirmDeleteModal } from '../../app/ConfirmDeleteModal';
import './QuestionCard.css';

function stateClass(f: Finding): string {
  if (f.answer === 'yes') return 'state-ok';
  return 'state-bad';
}

async function save(id: string, patch: Record<string, unknown>): Promise<void> {
  await localWrite('findings', id, patch);
}

function PillBtn({
  active,
  disabled,
  activeStyle,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  activeStyle?: React.CSSProperties;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`qcard-pill-btn ${active ? 'active' : ''}`}
      disabled={disabled}
      style={active ? activeStyle : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function FindingCard({
  finding,
  photos,
  locked,
  allSections,
  index,
  sectionName,
}: {
  finding: Finding;
  photos: Photo[];
  locked: boolean;
  allSections?: InspectionSection[];
  index?: number;
  sectionName?: string;
}) {
  const [text, setText] = useState(finding.text);
  const [correctiveAction, setCorrectiveAction] = useState(finding.correctiveAction);
  const [preventiveAction, setPreventiveAction] = useState(finding.preventiveAction);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setText(finding.text);
  }, [finding.text]);

  useEffect(() => {
    setCorrectiveAction(finding.correctiveAction);
  }, [finding.correctiveAction]);

  useEffect(() => {
    setPreventiveAction(finding.preventiveAction);
  }, [finding.preventiveAction]);

  const handleDeleteFinding = async () => {
    setIsDeleting(true);
    try {
      await localDelete('findings', finding.id);
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const isSatisfactory = finding.answer === 'yes';
  const obsLabel = index ? `Observation ${index}` : 'Observation';

  return (
    <div className={`qcard ${stateClass(finding)}`}>
      {/* ── Card Header ── */}
      <div className="qhead" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="ref" style={{ marginBottom: 0 }}>{obsLabel}</span>
          {sectionName && (
            <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
              • {sectionName}
            </span>
          )}
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 20,
              background: isSatisfactory ? 'var(--ok-tint)' : 'var(--bad-tint)',
              color: isSatisfactory ? 'var(--ok)' : 'var(--bad)',
              letterSpacing: '0.2px',
            }}
          >
            {isSatisfactory ? 'Satisfactory' : 'Observation / Defect'}
          </span>
        </div>
        {!locked && (
          <button
            className="icon-btn"
            aria-label={`Remove ${obsLabel.toLowerCase()}`}
            onClick={() => setShowDeleteConfirm(true)}
            title={`Delete ${obsLabel.toLowerCase()}`}
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {/* ── Observation / Defect Description Block ── */}
      <div className="observation-block" style={{ paddingBottom: 0 }}>
        <div className="seg-label" style={{ margin: '12px 0 6px' }}>Observation / Defect Description</div>
        <textarea
          placeholder="Describe the defect or observation you found..."
          disabled={locked}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void save(finding.id, { text })}
        />
      </div>

      {/* ── Finding Status Toggle (Yes / Satisfactory vs No / Observation) ── */}
      <div className="seg-label" style={{ margin: '12px 16px 6px' }}>Status / Evaluation</div>
      <div className={`qcard-pill-row ${locked ? 'disabled' : ''}`}>
        <PillBtn
          active={isSatisfactory}
          disabled={locked}
          activeStyle={{
            background: 'var(--ok-tint)',
            borderColor: 'var(--ok)',
            color: 'var(--ok)',
          }}
          onClick={() => void save(finding.id, { answer: 'yes' })}
        >
          <CheckIcon />
          Yes / Satisfactory
        </PillBtn>
        <PillBtn
          active={!isSatisfactory}
          disabled={locked}
          activeStyle={{
            background: 'var(--bad-tint)',
            borderColor: 'var(--bad)',
            color: 'var(--bad)',
          }}
          onClick={() => void save(finding.id, { answer: 'no' })}
        >
          <XIcon />
          No / Observation
        </PillBtn>
      </div>

      {/* ── Corrective & Preventive Actions (Active when Observation / Defect) ── */}
      {!isSatisfactory && (
        <div className="corrective-preventive-block" style={{ marginTop: 10, paddingBottom: 0 }}>
          <div className="seg-label" style={{ margin: '0 0 6px' }}>Corrective Action</div>
          <textarea
            placeholder="Describe the corrective action taken or required..."
            disabled={locked}
            value={correctiveAction}
            onChange={(e) => setCorrectiveAction(e.target.value)}
            onBlur={() => void save(finding.id, { correctiveAction })}
            style={{ marginBottom: 10 }}
          />
          <div className="seg-label" style={{ margin: '0 0 6px' }}>Preventive Action</div>
          <textarea
            placeholder="Describe the preventive action to avoid recurrence..."
            disabled={locked}
            value={preventiveAction}
            onChange={(e) => setPreventiveAction(e.target.value)}
            onBlur={() => void save(finding.id, { preventiveAction })}
          />
        </div>
      )}

      {/* ── Photos Section ── */}
      <div className="observation-block" style={{ paddingTop: 8 }}>
        <div className="seg-label" style={{ margin: '0 0 8px' }}>
          {obsLabel} Photos {photos.length > 0 ? `(${photos.length})` : ''}
        </div>
        <PhotoStrip
          photos={photos}
          target="finding"
          inspectionId={finding.inspectionId}
          inspectionSectionId={finding.inspectionSectionId}
          findingId={finding.id}
          locked={locked}
          title={`${obsLabel} Photos`}
          allSections={allSections}
        />
      </div>

      {/* ── Confirm Delete Observation Modal ── */}
      {showDeleteConfirm && (
        <ConfirmDeleteModal
          isOpen={showDeleteConfirm}
          title={`Delete ${obsLabel}`}
          description={`Are you sure you want to delete ${obsLabel}?`}
          subdesc={
            finding.text
              ? `"${finding.text.slice(0, 80)}${finding.text.length > 80 ? '…' : ''}" will be removed.`
              : `This observation and any associated data will be removed.`
          }
          confirmText="Delete Observation"
          loading={isDeleting}
          onConfirm={handleDeleteFinding}
          onCancel={() => {
            if (!isDeleting) setShowDeleteConfirm(false);
          }}
        />
      )}
    </div>
  );
}
