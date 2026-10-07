import './QuestionCard.css';
import { useState, useRef, useEffect } from 'react';
import type { InspectionQuestion, InspectionSection, Photo, Response } from '@ozellar/shared';
import { db } from '../../offline/db';
import { localWrite } from '../../offline/outbox';
import { addPhoto } from '../../offline/photoQueue';
import { PhotoStrip, type QuestionSummary } from './PhotoStrip';
import { CameraIcon, PlusIcon, WarningIcon } from '../../icons';
import { getDraggedPhoto, endPhotoDrag, onPhotoDragEnd, showDragNotification } from './photoDragService';

function stateClass(r?: Response): string {
  if (!r) return 'state-pending';
  if (r.applicable === false) return 'state-na';
  if (r.applicable === true && r.answer === 'yes') return 'state-ok';
  if (r.applicable === true && r.answer === 'no') return 'state-bad';
  return 'state-pending';
}

async function saveResponse(inspectionId: string, questionId: string, patch: Record<string, unknown>): Promise<string> {
  const existing = await db.responses.where('inspectionQuestionId').equals(questionId).first();
  const id = existing?.id ?? crypto.randomUUID();
  await localWrite('responses', id, { inspectionId, inspectionQuestionId: questionId, ...patch });
  return id;
}

// ─── Icon helpers ──────────────────────────────────────────────────────────
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
function SlashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
      strokeLinecap="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

// ─── Premium pill button ───────────────────────────────────────────────────
interface PillBtnProps {
  active: boolean;
  disabled: boolean;
  activeStyle: React.CSSProperties;
  onClick: () => void;
  children: React.ReactNode;
}
function PillBtn({ active, disabled, activeStyle, onClick, children }: PillBtnProps) {
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

export function QuestionCard({
  inspectionId,
  question,
  response,
  photos,
  locked,
  allSections,
  availableQuestions,
}: {
  inspectionId: string;
  question: InspectionQuestion;
  response?: Response;
  photos: Photo[];
  locked: boolean;
  allSections?: InspectionSection[];
  availableQuestions?: QuestionSummary[];
}) {
  const [remarks, setRemarks] = useState(response?.remarks ?? '');
  const [correctiveAction, setCorrectiveAction] = useState(response?.correctiveAction ?? '');
  const [preventiveAction, setPreventiveAction] = useState(response?.preventiveAction ?? '');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSameQuestionDrag, setIsSameQuestionDrag] = useState(false);
  const [dragFeedback, setDragFeedback] = useState<string | null>(null);
  const [dragFeedbackType, setDragFeedbackType] = useState<'success' | 'warning'>('success');
  const dragCounter = useRef(0);

  // Clean up dragover overlay whenever any drag ends in window
  useEffect(() => {
    return onPhotoDragEnd(() => {
      dragCounter.current = 0;
      setIsDragOver(false);
      setIsSameQuestionDrag(false);
    });
  }, []);

  const applicable = response?.applicable;
  const answer = response?.answer;
  const answerDisabled = locked || applicable !== true;

  function setApplicable(val: boolean) {
    if (locked) return;
    void saveResponse(inspectionId, question.id, val ? { applicable: true } : { applicable: false, answer: null });
  }
  function setAnswer(val: 'yes' | 'no') {
    if (locked || applicable !== true) return;
    void saveResponse(inspectionId, question.id, { answer: val });
  }

  function handleCardDragEnter(e: React.DragEvent) {
    if (locked) return;
    e.preventDefault();
    dragCounter.current += 1;

    // Check if dragging from the same question
    const dragged = getDraggedPhoto();
    if (dragged && dragged.fromResponseId && response?.id && dragged.fromResponseId === response.id) {
      setIsSameQuestionDrag(true);
      setIsDragOver(false);
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    setIsSameQuestionDrag(false);
    setIsDragOver(true);
  }

  function handleCardDragOver(e: React.DragEvent) {
    if (locked) return;
    e.preventDefault();

    const dragged = getDraggedPhoto();
    if (dragged && dragged.fromResponseId && response?.id && dragged.fromResponseId === response.id) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    e.dataTransfer.dropEffect = 'move';
  }

  function handleCardDragLeave(e: React.DragEvent) {
    if (locked) return;
    // Only clear if mouse genuinely left the card boundaries
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    dragCounter.current = 0;
    setIsDragOver(false);
    setIsSameQuestionDrag(false);
  }

  async function handleCardDrop(e: React.DragEvent) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    setIsSameQuestionDrag(false);
    endPhotoDrag();

    let photoId: string | null = null;
    let fromResponseId: string | null = null;
    try {
      const json = e.dataTransfer.getData('application/json');
      if (json) {
        const parsed = JSON.parse(json);
        if (parsed.photoId) photoId = parsed.photoId;
        if (parsed.fromResponseId) fromResponseId = parsed.fromResponseId;
      }
    } catch {}
    if (!photoId) {
      photoId = e.dataTransfer.getData('text/plain') || null;
    }

    // Prevent dropping into the same question
    const activePhoto = getDraggedPhoto();
    const sourceRespId = fromResponseId || activePhoto?.fromResponseId;
    if (sourceRespId && response?.id && sourceRespId === response.id) {
      showDragNotification(`Photo is already attached to ${question.ref || 'this question'}`, 'warning');
      setDragFeedback(`Photo is already attached to ${question.ref || 'this question'}`);
      setDragFeedbackType('warning');
      setTimeout(() => setDragFeedback(null), 2500);
      return;
    }

    // 1. Move/assign existing photo (from Section Photos or another question)
    if (photoId) {
      try {
        const existingPhoto = await db.photos.get(photoId);
        if (existingPhoto?.target === 'question' && existingPhoto?.responseId === response?.id) {
          showDragNotification(`Photo is already attached to ${question.ref || 'this question'}`, 'warning');
          setDragFeedback(`Photo is already attached to ${question.ref || 'this question'}`);
          setDragFeedbackType('warning');
          setTimeout(() => setDragFeedback(null), 2500);
          return;
        }

        let respId = response?.id;
        if (!respId) {
          respId = await saveResponse(inspectionId, question.id, {
            applicable: true,
            updatedAt: new Date().toISOString(),
          });
        }

        if (existingPhoto) {
          await localWrite('photos', photoId, {
            ...existingPhoto,
            target: 'question',
            responseId: respId,
            inspectionSectionId: null,
            position: photos.length,
          });
          showDragNotification(`Photo assigned to ${question.ref || 'question'}`, 'success');
          setDragFeedback(`Photo assigned to ${question.ref || 'question'}!`);
          setDragFeedbackType('success');
          setTimeout(() => setDragFeedback(null), 2500);
        }
      } catch (err) {
        console.error('Failed to assign photo to question', err);
      }
      return;
    }

    // 2. Upload dropped image files from desktop/device
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;

      try {
        let respId = response?.id;
        if (!respId) {
          respId = await saveResponse(inspectionId, question.id, {
            applicable: true,
            updatedAt: new Date().toISOString(),
          });
        }

        let pos = photos.length;
        for (const file of files) {
          await addPhoto({
            file,
            target: 'question',
            inspectionId,
            responseId: respId,
            position: pos++,
            isDefect: false,
          });
        }
        setDragFeedback(`${files.length} photo${files.length > 1 ? 's' : ''} added to ${question.ref || 'question'}!`);
        setDragFeedbackType('success');
        setTimeout(() => setDragFeedback(null), 2500);
      } catch (err) {
        console.error('Failed to upload dropped files to question', err);
      }
    }
  }

  return (
    <div
      className={`qcard ${stateClass(response)}${isDragOver ? ' drag-over' : ''}${isSameQuestionDrag ? ' drag-same-question' : ''}`}
      data-question-card-id={question.id}
      data-response-id={response?.id || ''}
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
            <div className="qcard-drag-title">Drop photo to assign to {question.ref || 'this question'}</div>
            <div className="qcard-drag-sub">Release to attach this photo evidence</div>
          </div>
        </div>
      )}

      {/* ── Same Question Disabled Drag Overlay ── */}
      {isSameQuestionDrag && (
        <div className="qcard-drag-overlay same-question">
          <div className="qcard-drag-overlay-inner">
            <WarningIcon width={28} height={28} />
            <div className="qcard-drag-title">Already in {question.ref || 'this question'}</div>
            <div className="qcard-drag-sub">Cannot drop photo into the same question</div>
          </div>
        </div>
      )}

      {/* ── Drag feedback toast ── */}
      {dragFeedback && (
        <div className={`qcard-drag-toast ${dragFeedbackType}`}>
          {dragFeedbackType === 'warning' ? <WarningIcon width={16} height={16} /> : <CheckIcon />}
          <span>{dragFeedback}</span>
        </div>
      )}

      {/* ── Question header ── */}
      <div className="qhead">
        <span className="ref">{question.ref}</span>
        <div className="qtext">{question.text}</div>
      </div>

      {/* ── Applicable toggle ── */}
      <div className="seg-label">Applicable to this vessel?</div>
      <div className="qcard-pill-row">
        <PillBtn
          active={applicable === true}
          disabled={locked}
          activeStyle={{
            background: 'var(--accent-tint)', borderColor: 'var(--accent)',
            color: 'var(--accent-dark)',
          }}
          onClick={() => setApplicable(true)}
        >
          <CheckIcon />
          Applicable
        </PillBtn>
        <PillBtn
          active={applicable === false}
          disabled={locked}
          activeStyle={{
            background: 'var(--na-tint)', borderColor: 'var(--na)',
            color: 'var(--na)',
          }}
          onClick={() => setApplicable(false)}
        >
          <SlashIcon />
          N/A
        </PillBtn>
      </div>

      {/* ── Finding ── */}
      <div className="seg-label">Finding</div>
      <div className={`qcard-pill-row ${answerDisabled ? 'disabled' : ''}`}>
        <PillBtn
          active={answer === 'yes'}
          disabled={answerDisabled}
          activeStyle={{
            background: 'var(--ok-tint)', borderColor: 'var(--ok)',
            color: 'var(--ok)',
          }}
          onClick={() => setAnswer('yes')}
        >
          <CheckIcon />
          Yes / Satisfactory
        </PillBtn>
        <PillBtn
          active={answer === 'no'}
          disabled={answerDisabled}
          activeStyle={{
            background: 'var(--bad-tint)', borderColor: 'var(--bad)',
            color: 'var(--bad)',
          }}
          onClick={() => setAnswer('no')}
        >
          <XIcon />
          No / Observation
        </PillBtn>
      </div>

      {/* ── Corrective / Preventive actions (shown when "no") ── */}
      {answer === 'no' && (
        <div className="corrective-preventive-block">
          <div className="seg-label">Corrective Action</div>
          <textarea
            placeholder="Describe the corrective action taken..."
            disabled={locked}
            value={correctiveAction}
            onChange={(e) => setCorrectiveAction(e.target.value)}
            onBlur={() => void saveResponse(inspectionId, question.id, { correctiveAction })}
          />
          <div className="seg-label">Preventive Action</div>
          <textarea
            placeholder="Describe the preventive action to avoid recurrence..."
            disabled={locked}
            value={preventiveAction}
            onChange={(e) => setPreventiveAction(e.target.value)}
            onBlur={() => void saveResponse(inspectionId, question.id, { preventiveAction })}
          />
        </div>
      )}

      {/* ── Remark + photos block ── */}
      <div className="observation-block">
        <div className="seg-label">Remark</div>
        <textarea
          placeholder="Add remarks or describe what you observed..."
          disabled={locked}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          onBlur={() => void saveResponse(inspectionId, question.id, { remarks })}
          style={{ marginBottom: 10 }}
        />

        {/* ── Photos section ── */}
        <div className="qcard-photos-container">
          <div className="seg-label" style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <CameraIcon width={14} height={14} />
              Photos {photos.length > 0 ? `(${photos.length})` : ''}
            </span>
            {!locked && (
              <span className="qcard-drag-hint">Drag section photos here to attach</span>
            )}
          </div>

          {response?.id ? (
            <div>
              <PhotoStrip
                photos={photos}
                target="question"
                inspectionId={inspectionId}
                inspectionSectionId={question.inspectionSectionId}
                responseId={response.id}
                locked={locked}
                title={question.ref ? `Question ${question.ref}` : 'Question Photos'}
                allSections={allSections}
                availableQuestions={availableQuestions}
              />
              {!locked && photos.length === 0 && (
                <div className="qcard-dropzone-prompt">
                  <CameraIcon width={22} height={22} style={{ color: 'var(--accent)' }} />
                  <div className="qcard-dropzone-text">
                    No photos yet — <strong>drag a section photo here</strong> or tap below to upload
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="qcard-dropzone-prompt unassigned">
              <CameraIcon width={20} height={20} style={{ color: 'var(--muted)' }} />
              <div className="qcard-dropzone-text">
                <strong>Drag a section photo here</strong> or mark <strong>Applicable</strong> above to attach photos
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
