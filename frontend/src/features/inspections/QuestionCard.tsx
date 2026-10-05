import './QuestionCard.css';
import { useState } from 'react';
import type { InspectionQuestion, Photo, Response } from '@ozellar/shared';
import { db } from '../../offline/db';
import { localWrite } from '../../offline/outbox';
import { PhotoStrip } from './PhotoStrip';
import { CameraIcon, PlusIcon } from '../../icons';

function stateClass(r?: Response): string {
  if (!r) return 'state-pending';
  if (r.applicable === false) return 'state-na';
  if (r.applicable === true && r.answer === 'yes') return 'state-ok';
  if (r.applicable === true && r.answer === 'no') return 'state-bad';
  return 'state-pending';
}

async function saveResponse(inspectionId: string, questionId: string, patch: Record<string, unknown>): Promise<void> {
  const existing = await db.responses.where('inspectionQuestionId').equals(questionId).first();
  const id = existing?.id ?? crypto.randomUUID();
  await localWrite('responses', id, { inspectionId, inspectionQuestionId: questionId, ...patch });
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

export function QuestionCard({ inspectionId, question, response, photos, locked }: {
  inspectionId: string; question: InspectionQuestion; response?: Response; photos: Photo[]; locked: boolean;
}) {
  const [remarks, setRemarks] = useState(response?.remarks ?? '');
  const [correctiveAction, setCorrectiveAction] = useState(response?.correctiveAction ?? '');
  const [preventiveAction, setPreventiveAction] = useState(response?.preventiveAction ?? '');

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

  return (
    <div className={`qcard ${stateClass(response)}`}>
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
        {response?.id ? (
          <div>
            <div className="seg-label" style={{ marginTop: 4 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <CameraIcon width={14} height={14} />
                Photos
              </span>
            </div>
            <PhotoStrip
              photos={photos}
              target="question"
              inspectionId={inspectionId}
              responseId={response.id}
              locked={locked}
            />
            {!locked && photos.length === 0 && (
              <div style={{
                border: '1.5px dashed var(--border)', borderRadius: 8,
                padding: '16px 12px', textAlign: 'center',
                color: 'var(--faint)', fontSize: 13, marginTop: 6,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              }}>
                <CameraIcon width={28} height={28} style={{ color: 'var(--faint)' }} />
                <span>No photos yet — tap below to add one</span>
              </div>
            )}
          </div>
        ) : (
          <p className="footer-note" style={{ textAlign: 'left', padding: '6px 0 0' }}>
            Mark <strong>Applicable</strong> or <strong>N/A</strong> above to attach photos.
          </p>
        )}
      </div>
    </div>
  );
}
