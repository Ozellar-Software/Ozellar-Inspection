import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { isEditable, type Photo } from '@ozellar/shared';
import { db } from '../../offline/db';
import { localWrite } from '../../offline/outbox';
import { BackIcon, PlusIcon } from '../../icons';
import { QuestionCard } from './QuestionCard';
import { FindingCard } from './FindingCard';
import { PhotoStrip } from './PhotoStrip';

export function SectionDetailPage() {
  const nav = useNavigate();
  const { id: inspectionId, sectionId } = useParams<{ id: string; sectionId: string }>();

  const inspection = useLiveQuery(() => (inspectionId ? db.inspections.get(inspectionId) : undefined), [inspectionId]);
  const section = useLiveQuery(() => (sectionId ? db.inspectionSections.get(sectionId) : undefined), [sectionId]);
  const questions = useLiveQuery(
    () => (sectionId ? db.inspectionQuestions.where('inspectionSectionId').equals(sectionId).sortBy('position') : []), [sectionId]) ?? [];
  const responses = useLiveQuery(
    () => (inspectionId ? db.responses.where('inspectionId').equals(inspectionId).toArray() : []), [inspectionId]) ?? [];
  const findings = useLiveQuery(
    () => (sectionId ? db.findings.where('inspectionSectionId').equals(sectionId).toArray() : []), [sectionId])
    ?.filter((f) => !f.deletedAt).sort((a, b) => a.position - b.position) ?? [];
  const photos = useLiveQuery(
    () => (inspectionId ? db.photos.where('inspectionId').equals(inspectionId).toArray() : []), [inspectionId]) ?? [];

  if (!inspection || !section) return null;
  const locked = !isEditable(inspection.status);
  const byQuestion = new Map(responses.map((r) => [r.inspectionQuestionId, r]));
  const photosByResponse = new Map<string, Photo[]>();
  const photosByFinding = new Map<string, Photo[]>();
  const sectionPhotos: Photo[] = [];
  for (const p of photos) {
    if (p.target === 'question' && p.responseId) (photosByResponse.get(p.responseId) ?? photosByResponse.set(p.responseId, []).get(p.responseId)!).push(p);
    else if (p.target === 'finding' && p.findingId) (photosByFinding.get(p.findingId) ?? photosByFinding.set(p.findingId, []).get(p.findingId)!).push(p);
    else if (p.target === 'section' && p.inspectionSectionId === sectionId) sectionPhotos.push(p);
  }

  async function addFinding() {
    const id = crypto.randomUUID();
    await localWrite('findings', id, {
      inspectionId, inspectionSectionId: sectionId, text: '', answer: null,
      correctiveAction: '', preventiveAction: '', position: findings.length,
    });
  }

  return (
    <>
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => nav(`/inspections/${inspectionId}`)}><BackIcon /></button>
        <div className="title-wrap">
          <h1>{section.name}</h1>
          <div className="sub">{section.zone}</div>
        </div>
      </div>

      <div className="page-wrap" style={{ paddingTop: 16 }}>
        {locked && (
          <p className="footer-note" style={{ margin: '0 0 12px' }}>
            This inspection is locked while it's pending approval or already approved — answers can't be changed.
          </p>
        )}
        {questions.map((q) => (
          <QuestionCard key={q.id} inspectionId={inspectionId!} question={q} response={byQuestion.get(q.id)}
            photos={photosByResponse.get(byQuestion.get(q.id)?.id ?? '') ?? []} locked={locked} />
        ))}

        <div className="qcard extras-card">
          <div className="seg-label">Section photos</div>
          <p className="extras-hint" style={{ margin: '0 0 10px' }}>General photos for this location, not tied to one specific question above.</p>
          <PhotoStrip photos={sectionPhotos} target="section" inspectionId={inspectionId!} inspectionSectionId={sectionId} locked={locked} />
        </div>

        <div className="report-section-title">Additional findings</div>
        <p className="extras-hint">Anything not covered by the checklist above — describe it and mark Yes/No.</p>
        {findings.map((f) => (
          <FindingCard key={f.id} finding={f} photos={photosByFinding.get(f.id) ?? []} locked={locked} />
        ))}
        {!locked && (
          <div className="section-pad" style={{ margin: '4px 0 22px' }}>
            <button className="btn btn-outline btn-block" onClick={() => void addFinding()}><PlusIcon />Add observation</button>
          </div>
        )}
      </div>
    </>
  );
}
