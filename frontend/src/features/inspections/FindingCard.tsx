import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Finding, InspectionSection, Photo, ReportCategory } from '@ozellar/shared';
import { db } from '../../offline/db';
import { localWrite, localDelete } from '../../offline/outbox';
import { addPhoto } from '../../offline/photoQueue';
import { PhotoStrip } from './PhotoStrip';
import { TrashIcon, CheckIcon, XIcon, CameraIcon, WarningIcon } from '../../icons';
import { ConfirmDeleteModal } from '../../app/ConfirmDeleteModal';
import { getDraggedPhoto, endPhotoDrag, showDragNotification } from './photoDragService';
import './QuestionCard.css';
import { RichTextEditor } from '../../components/RichTextEditor/RichTextEditor';

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
  reportCategory,
}: {
  finding: Finding;
  photos: Photo[];
  locked: boolean;
  allSections?: InspectionSection[];
  index?: number;
  sectionName?: string;
  reportCategory?: ReportCategory;
}) {
  const inspection = useLiveQuery(
    () => (finding.inspectionId ? db.inspections.get(finding.inspectionId) : undefined),
    [finding.inspectionId]
  );
  const effectiveCategory = reportCategory ?? inspection?.reportCategory;
  const isVesselInspection = !effectiveCategory || effectiveCategory === 'inspection';
  const showActions = isVesselInspection;

  const [text, setText] = useState(finding.text);
  const [correctiveAction, setCorrectiveAction] = useState(finding.correctiveAction);
  const [preventiveAction, setPreventiveAction] = useState(finding.preventiveAction);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSameFindingDrag, setIsSameFindingDrag] = useState(false);
  const dragCounter = useRef(0);

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
      // Revert attached photos to section photos as normal photos so evidence is not lost
      const attachedPhotos = await db.photos.where('findingId').equals(finding.id).toArray();
      for (const p of attachedPhotos) {
        await localWrite('photos', p.id, {
          findingId: null,
          target: 'section',
          isDefect: false,
          inspectionSectionId: p.inspectionSectionId || finding.inspectionSectionId || null,
          responseId: null,
        });
      }
      await localDelete('findings', finding.id);
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const isSatisfactory = finding.answer === 'yes';
  const obsLabel = index ? `Observation ${index}` : 'Observation';

  function handleCardDragEnter(e: React.DragEvent) {
    if (locked) return;
    e.preventDefault();
    dragCounter.current += 1;

    const dragged = getDraggedPhoto();
    if (dragged && dragged.fromFindingId && dragged.fromFindingId === finding.id) {
      setIsSameFindingDrag(true);
      setIsDragOver(false);
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    setIsSameFindingDrag(false);
    setIsDragOver(true);
  }

  function handleCardDragOver(e: React.DragEvent) {
    if (locked) return;
    e.preventDefault();

    const dragged = getDraggedPhoto();
    if (dragged && dragged.fromFindingId && dragged.fromFindingId === finding.id) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    e.dataTransfer.dropEffect = 'move';
  }

  function handleCardDragLeave(e: React.DragEvent) {
    if (locked) return;
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    dragCounter.current = 0;
    setIsDragOver(false);
    setIsSameFindingDrag(false);
  }

  async function handleCardDrop(e: React.DragEvent) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    setIsSameFindingDrag(false);
    endPhotoDrag();

    let photoIds: string[] = [];
    let fromFindingId: string | null = null;
    try {
      const json = e.dataTransfer.getData('application/json');
      if (json) {
        const parsed = JSON.parse(json);
        if (parsed.photoIds && Array.isArray(parsed.photoIds)) {
          photoIds = parsed.photoIds;
        } else if (parsed.photoId) {
          photoIds = [parsed.photoId];
        }
        if (parsed.fromFindingId) fromFindingId = parsed.fromFindingId;
      }
    } catch {}
    if (!photoIds.length) {
      const singleId = e.dataTransfer.getData('text/plain');
      if (singleId) photoIds = [singleId];
    }

    const activePhoto = getDraggedPhoto();
    const sourceFindingId = fromFindingId || activePhoto?.fromFindingId;
    if (sourceFindingId && sourceFindingId === finding.id) {
      showDragNotification(`Photo is already attached to ${obsLabel}`, 'warning');
      return;
    }

    // 1. Move/assign existing photos (from Section Photos, question, or another observation)
    if (photoIds.length > 0) {
      try {
        let pos = photos.length;
        let assignedCount = 0;
        for (const pId of photoIds) {
          const existingPhoto = await db.photos.get(pId);
          if (existingPhoto?.target === 'finding' && existingPhoto?.findingId === finding.id) {
            continue;
          }
          if (existingPhoto) {
            await localWrite('photos', pId, {
              ...existingPhoto,
              target: 'finding',
              findingId: finding.id,
              isDefect: true,
              inspectionSectionId: finding.inspectionSectionId || existingPhoto.inspectionSectionId || null,
              responseId: null,
              position: pos++,
            });
            assignedCount++;
          }
        }

        if (assignedCount > 0) {
          const msg = assignedCount > 1
            ? `${assignedCount} photos assigned to ${obsLabel}`
            : `Photo assigned to ${obsLabel}`;
          showDragNotification(msg, 'success');
        } else {
          showDragNotification(`Already attached to ${obsLabel}`, 'warning');
        }
      } catch (err) {
        console.error('Failed to assign photo(s) to observation', err);
      }
      return;
    }

    // 2. Upload dropped image files from desktop/device
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;

      try {
        let pos = photos.length;
        for (const file of files) {
          await addPhoto({
            file,
            target: 'finding',
            inspectionId: finding.inspectionId,
            inspectionSectionId: finding.inspectionSectionId,
            findingId: finding.id,
            position: pos++,
            isDefect: false,
          });
        }
        showDragNotification(`${files.length} photo${files.length > 1 ? 's' : ''} added to ${obsLabel}!`, 'success');
      } catch (err) {
        console.error('Failed to upload dropped files to observation', err);
      }
    }
  }

  return (
    <div
      className={`qcard ${stateClass(finding)}${isDragOver ? ' drag-over' : ''}${isSameFindingDrag ? ' drag-same-question' : ''}`}
      data-finding-card-id={finding.id}
      onDragEnter={handleCardDragEnter}
      onDragOver={handleCardDragOver}
      onDragLeave={handleCardDragLeave}
      onDrop={handleCardDrop}
    >
      {/* ── Drag overlay ── */}
      {isDragOver && (
        <div className="qcard-drag-overlay">
          <div className="qcard-drag-overlay-inner">
            <CameraIcon width={28} height={28} />
            <div className="qcard-drag-title">Drop photo to assign to {obsLabel}</div>
            <div className="qcard-drag-sub">Release to attach this photo evidence</div>
          </div>
        </div>
      )}

      {/* ── Same Observation Disabled Drag Overlay ── */}
      {isSameFindingDrag && (
        <div className="qcard-drag-overlay same-question">
          <div className="qcard-drag-overlay-inner">
            <WarningIcon width={28} height={28} />
            <div className="qcard-drag-title">Already attached to {obsLabel}</div>
            <div className="qcard-drag-sub">Photo is already part of this observation</div>
          </div>
        </div>
      )}
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

      {/* ── Observation / Defect Description Block with Rich Text ── */}
      <div className="observation-block" style={{ paddingBottom: 0 }}>
        <div className="seg-label" style={{ margin: '12px 0 6px' }}>Observation / Defect Description</div>
        <RichTextEditor
          placeholder="Describe the defect or observation (supports bold, italics, bullets, font styles)..."
          disabled={locked}
          value={text}
          onChange={setText}
          onBlur={() => void save(finding.id, { text })}
          minHeight={75}
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

      {/* ── Corrective & Preventive Actions (Active when Observation / Defect for Vessel Inspections) ── */}
      {!isSatisfactory && showActions && (
        <div className="corrective-preventive-block" style={{ marginTop: 10, paddingBottom: 0 }}>
          <div className="seg-label" style={{ margin: '0 0 6px' }}>Corrective Action</div>
          <RichTextEditor
            placeholder="Describe the corrective action taken or required..."
            disabled={locked}
            value={correctiveAction}
            onChange={setCorrectiveAction}
            onBlur={() => void save(finding.id, { correctiveAction })}
            minHeight={65}
            style={{ marginBottom: 10 }}
          />
          <div className="seg-label" style={{ margin: '0 0 6px' }}>Preventive Action</div>
          <RichTextEditor
            placeholder="Describe the preventive action to avoid recurrence..."
            disabled={locked}
            value={preventiveAction}
            onChange={setPreventiveAction}
            onBlur={() => void save(finding.id, { preventiveAction })}
            minHeight={65}
          />
        </div>
      )}

      {/* ── Photos Section ── */}
      <div className="observation-block" style={{ paddingTop: 8 }}>
        <div className="seg-label" style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{obsLabel} Photos {photos.length > 0 ? `(${photos.length})` : ''}</span>
          {!locked && (
            <span className="qcard-drag-hint">Drag section photos here to attach</span>
          )}
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
        {!locked && photos.length === 0 && (
          <div className="qcard-dropzone-prompt" style={{ margin: '8px 0 6px' }}>
            <CameraIcon width={22} height={22} style={{ color: 'var(--accent)' }} />
            <div className="qcard-dropzone-text">
              No photos yet — <strong>drag a section photo here</strong> or tap below to upload
            </div>
          </div>
        )}
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
