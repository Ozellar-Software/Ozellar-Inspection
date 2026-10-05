import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { can, isEditable, type Photo, type User } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { localWrite } from '../../offline/outbox';
import { BackIcon, PlusIcon, LockIcon, CameraIcon } from '../../icons';
import { QuestionCard } from './QuestionCard';
import { FindingCard } from './FindingCard';
import { PhotoStrip } from './PhotoStrip';

export function SectionDetailPage() {
  const nav = useNavigate();
  const { id: inspectionId, sectionId } = useParams<{ id: string; sectionId: string }>();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });

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

  
  // MOCK FALLBACK
  const isMock = !inspection && inspectionId?.startsWith('mock');
  const dispInspection = isMock ? { status: 'in_progress', id: inspectionId } : inspection;
  const dispSection = isMock ? { id: sectionId, name: 'Sample Section (Demo)', zone: 'Demo Zone', photoOnly: false } : section;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dispQuestions: any[] = isMock ? [
    { id: 'q1', text: 'Is the equipment in good condition?', position: 1, inspectionSectionId: sectionId, qid: 1, ref: 'Q1' },
    { id: 'q2', text: 'Are safety labels clearly visible?', position: 2, inspectionSectionId: sectionId, qid: 2, ref: 'Q2' },
  ] : questions;

  if (!dispInspection || !dispSection) return null;

  if (me.data && inspection && !can(me.data, 'inspection.view', { inspection })) {
    return (
      <div className="page-wrap" style={{ padding: 32, textAlign: 'center' }}>
        <h2 style={{ color: 'var(--bad)', fontSize: 18, marginBottom: 8 }}>Access Restricted</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>
          You do not have permission to view inspections for this vessel.
        </p>
        <button className="btn btn-outline" onClick={() => nav('/')}>Back to Home</button>
      </div>
    );
  }

  const locked = !isEditable(dispInspection.status as any);
  const byQuestion = new Map(responses.map((r) => [r.inspectionQuestionId, r]));
  const photosByResponse = new Map<string, Photo[]>();
  const photosByFinding = new Map<string, Photo[]>();
  const sectionPhotos: Photo[] = [];
  for (const p of photos) {
    if (p.target === 'question' && p.responseId)
      (photosByResponse.get(p.responseId) ?? photosByResponse.set(p.responseId, []).get(p.responseId)!).push(p);
    else if (p.target === 'finding' && p.findingId)
      (photosByFinding.get(p.findingId) ?? photosByFinding.set(p.findingId, []).get(p.findingId)!).push(p);
    else if (p.target === 'section' && p.inspectionSectionId === sectionId)
      sectionPhotos.push(p);
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
        <button className="back" aria-label="Back" onClick={() => nav(`/inspections/${inspectionId}`)}>
          <BackIcon />
        </button>
        <div className="title-wrap">
          <h1>{dispSection.name}</h1>
          <div className="sub">{dispSection.zone}</div>
        </div>
      </div>

      <div className="page-wrap" style={{ paddingTop: 16 }}>

        {/* Locked warning banner */}
        {locked && (
          <div style={{
            margin: '0 16px 16px', padding: '12px 16px',
            background: 'var(--warn-tint)', border: '1px solid var(--warn)',
            borderRadius: 10, display: 'flex', gap: 10, alignItems: 'center',
          }}>
            <span style={{ flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LockIcon /></span>
            <p style={{ fontSize: 13, color: '#7A5800', margin: 0, lineHeight: 1.5 }}>
              This inspection is <strong>locked</strong> while pending approval or already approved — answers cannot be changed.
            </p>
          </div>
        )}

        {/* Photo Section banner */}
        {dispSection.photoOnly && (
          <div style={{
            margin: '0 16px 14px',
            padding: '12px 16px',
            background: '#f0fdfa',
            border: '1.5px solid #2dd4bf',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 2px 8px rgba(13,148,136,0.06)',
          }}>
            <span style={{
              width: 32, height: 32, borderRadius: 8,
              background: '#ccfbf1', color: '#0d9488',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <CameraIcon width={18} height={18} />
            </span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: '#0f766e' }}>Photo Section</div>
              <div style={{ fontSize: 12, color: '#115e59' }}>
                This section is dedicated to photo evidence and observations. No checklist questions apply.
              </div>
            </div>
          </div>
        )}

        {/* Question cards */}
        {dispQuestions.map((q) => (
          <QuestionCard
            key={q.id}
            inspectionId={inspectionId!}
            question={q}
            response={byQuestion.get(q.id)}
            photos={photosByResponse.get(byQuestion.get(q.id)?.id ?? '') ?? []}
            locked={locked}
          />
        ))}

        {/* Section photos card */}
        <div style={{
          margin: '0 16px 12px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 12,
          overflow: 'hidden', boxShadow: '0 1px 4px rgba(11,33,56,0.06)',
        }}>
          <div style={{
            padding: '14px 16px 12px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CameraIcon width={18} height={18} /></span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Section photos</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>General photos for this location — not tied to a specific question</div>
            </div>
          </div>
          <div style={{ padding: '12px 16px' }}>
            <PhotoStrip
              photos={sectionPhotos}
              target="section"
              inspectionId={inspectionId!}
              inspectionSectionId={sectionId}
              locked={locked}
            />
          </div>
        </div>

        {/* Additional findings heading */}
        <div style={{ margin: '8px 16px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>
            Additional Findings
          </div>
          {findings.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--warn-tint)', color: 'var(--warn)' }}>
              {findings.length}
            </span>
          )}
        </div>
        <p style={{ margin: '0 16px 10px', fontSize: 12.5, color: 'var(--muted)' }}>
          {dispSection.photoOnly
            ? 'Record any specific observations, deficiencies, or findings for this photo section.'
            : 'Anything not covered by the checklist above — describe it and mark Yes/No.'}
        </p>

        {findings.map((f) => (
          <FindingCard key={f.id} finding={f} photos={photosByFinding.get(f.id) ?? []} locked={locked} />
        ))}

        {!locked && (
          <div style={{ margin: '4px 16px 24px' }}>
            <button
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '14px', borderRadius: 12, cursor: 'pointer',
                border: '1.5px dashed var(--accent)', background: 'var(--accent-tint)',
                color: 'var(--accent-dark)', fontWeight: 700, fontSize: 14,
                transition: 'all 0.15s ease',
              }}
              onClick={() => void addFinding()}
            >
              <div style={{width: 20, height: 20, flexShrink: 0, display: "flex"}}><PlusIcon /></div> Add observation
            </button>
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </>
  );
}
