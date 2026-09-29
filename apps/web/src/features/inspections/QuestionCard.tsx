import { useState } from 'react';
import type { InspectionQuestion, Photo, Response } from '@ozellar/shared';
import { db } from '../../offline/db';
import { localWrite } from '../../offline/outbox';
import { PhotoStrip } from './PhotoStrip';

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
      <div className="qhead">
        <span className="ref">{question.ref}</span>
        <div className="qtext">{question.text}</div>
      </div>

      <div className="seg-label">Applicable to this vessel?</div>
      <div className="seg">
        <button type="button" disabled={locked} className={applicable === true ? 'active-app' : ''} onClick={() => setApplicable(true)}>Applicable</button>
        <button type="button" disabled={locked} className={applicable === false ? 'active-na' : ''} onClick={() => setApplicable(false)}>N/A</button>
      </div>

      <div className="seg-label">Finding</div>
      <div className={`seg${answerDisabled ? ' disabled' : ''}`}>
        <button type="button" disabled={answerDisabled} className={answer === 'yes' ? 'active-yes' : ''} onClick={() => setAnswer('yes')}>Yes / satisfactory</button>
        <button type="button" disabled={answerDisabled} className={answer === 'no' ? 'active-no' : ''} onClick={() => setAnswer('no')}>No / observation</button>
      </div>

      {answer === 'no' && (
        <div className="corrective-preventive-block">
          <div className="seg-label">Corrective Action</div>
          <textarea placeholder="Describe the corrective action taken..." disabled={locked}
            value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)}
            onBlur={() => void saveResponse(inspectionId, question.id, { correctiveAction })} />
          <div className="seg-label">Preventive Action</div>
          <textarea placeholder="Describe the preventive action to avoid recurrence..." disabled={locked}
            value={preventiveAction} onChange={(e) => setPreventiveAction(e.target.value)}
            onBlur={() => void saveResponse(inspectionId, question.id, { preventiveAction })} />
        </div>
      )}

      <div className="observation-block">
        <div className="seg-label">Remark</div>
        <textarea placeholder="Add remarks or describe what you observed..." disabled={locked}
          value={remarks} onChange={(e) => setRemarks(e.target.value)}
          onBlur={() => void saveResponse(inspectionId, question.id, { remarks })} />
        {response?.id ? (
          <PhotoStrip photos={photos} target="question" inspectionId={inspectionId} responseId={response.id} locked={locked} />
        ) : (
          <p className="footer-note" style={{ textAlign: 'left', padding: '6px 0 0' }}>Mark Applicable or N/A above to attach photos.</p>
        )}
      </div>
    </div>
  );
}
