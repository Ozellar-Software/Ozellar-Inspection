import { useState } from 'react';
import type { Finding, Photo } from '@ozellar/shared';
import { localWrite, localDelete } from '../../offline/outbox';
import { PhotoStrip } from './PhotoStrip';
import { TrashIcon } from '../../icons';

function stateClass(f: Finding): string {
  if (f.answer === 'yes') return 'state-ok';
  if (f.answer === 'no') return 'state-bad';
  return 'state-pending';
}

async function save(id: string, patch: Record<string, unknown>): Promise<void> {
  await localWrite('findings', id, patch);
}

export function FindingCard({ finding, photos, locked }: { finding: Finding; photos: Photo[]; locked: boolean }) {
  const [text, setText] = useState(finding.text);
  const [correctiveAction, setCorrectiveAction] = useState(finding.correctiveAction);
  const [preventiveAction, setPreventiveAction] = useState(finding.preventiveAction);

  return (
    <div className={`qcard ${stateClass(finding)}`}>
      <div className="qhead" style={{ justifyContent: 'space-between' }}>
        <span className="ref">Extra</span>
        {!locked && (
          <button className="icon-btn" aria-label="Remove observation" onClick={() => void localDelete('findings', finding.id)}><TrashIcon /></button>
        )}
      </div>

      <div className="seg-label">Observation / defect</div>
      <textarea placeholder="Describe the defect or observation you found..." disabled={locked}
        value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void save(finding.id, { text })} />

      <div className="seg-label">Finding</div>
      <div className={`seg${locked ? ' disabled' : ''}`}>
        <button type="button" disabled={locked} className={finding.answer === 'yes' ? 'active-yes' : ''} onClick={() => void save(finding.id, { answer: 'yes' })}>Yes / satisfactory</button>
        <button type="button" disabled={locked} className={finding.answer === 'no' ? 'active-no' : ''} onClick={() => void save(finding.id, { answer: 'no' })}>No / observation</button>
      </div>

      {finding.answer === 'no' && (
        <div className="corrective-preventive-block">
          <div className="seg-label">Corrective Action</div>
          <textarea placeholder="Describe the corrective action taken..." disabled={locked}
            value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)}
            onBlur={() => void save(finding.id, { correctiveAction })} />
          <div className="seg-label">Preventive Action</div>
          <textarea placeholder="Describe the preventive action to avoid recurrence..." disabled={locked}
            value={preventiveAction} onChange={(e) => setPreventiveAction(e.target.value)}
            onBlur={() => void save(finding.id, { preventiveAction })} />
        </div>
      )}

      <div className="observation-block">
        <div className="seg-label">Photos</div>
        <PhotoStrip photos={photos} target="finding" inspectionId={finding.inspectionId} findingId={finding.id} locked={locked} title="Finding Photo" />
      </div>
    </div>
  );
}
