import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { can, isEditable, type Photo, type User } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { localWrite } from '../../offline/outbox';
import { prefetchInspectionPhotos } from '../../offline/photoQueue';
import { BackIcon, PlusIcon, LockIcon, CameraIcon, CheckIcon } from '../../icons';
import { QuestionCard } from './QuestionCard';
import { FindingCard } from './FindingCard';
import { PhotoStrip } from './PhotoStrip';
import { endPhotoDrag } from './photoDragService';
import './SectionDetailPage.css';

import { useCurrentUser } from '../../auth/useCurrentUser';

export function SectionDetailPage() {
  const nav = useNavigate();
  const { id: inspectionId, sectionId } = useParams<{ id: string; sectionId: string }>();
  const me = useCurrentUser();
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (inspectionId) {
      void prefetchInspectionPhotos(inspectionId);
    }
  }, [inspectionId]);

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
  const allSections = useLiveQuery(
    () => (inspectionId ? db.inspectionSections.where('inspectionId').equals(inspectionId).sortBy('position') : []),
    [inspectionId]
  ) ?? [];

  // MOCK FALLBACK
  const isMock = !inspection && inspectionId?.startsWith('mock');
  const dispInspection = isMock ? { status: 'in_progress', id: inspectionId } : inspection;
  const dispSection = isMock ? { id: sectionId, name: 'Sample Section (Demo)', zone: 'Demo Zone', photoOnly: false } : section;
  const dispAllSections = isMock
    ? [
        dispSection as any,
        { id: 'sec-demo-2', name: 'Bridge & Navigation (Demo)', zone: 'Navigation', photoOnly: false, inspectionId, position: 2 },
        { id: 'sec-demo-3', name: 'Main Deck & Cargo Holds (Demo)', zone: 'Deck', photoOnly: false, inspectionId, position: 3 },
      ]
    : allSections;
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


  const totalQuestions = dispQuestions.length;
  const answeredCount = dispQuestions.filter((q) => {
    const r = byQuestion.get(q.id);
    return r && (r.answer != null || r.applicable === false);
  }).length;
  const isSectionComplete = totalQuestions > 0
    ? (answeredCount === totalQuestions)
    : (dispSection.photoOnly ? sectionPhotos.length > 0 : false);

  async function notifySectionComplete() {
    if (!inspectionId || !sectionId || !dispSection) return;
    const key = `notified_section_${inspectionId}_${sectionId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    try {
      await api('/notifications/trigger', {
        method: 'POST',
        body: {
          inspectionId,
          type: 'section_completed',
          sectionId,
          sectionName: dispSection.name,
        },
      });
    } catch (err) {
      console.error('Failed to notify section completion', err);
    }
  }

  async function handleBack() {
    if (isSectionComplete) {
      void notifySectionComplete();
    }
    nav(`/inspections/${inspectionId}`);
  }

  async function handleCompleteSection() {
    setCompleting(true);
    await notifySectionComplete();
    nav(`/inspections/${inspectionId}`);
  }

  return (
    <>
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={handleBack}>
          <BackIcon />
        </button>
        <div className="title-wrap">
          <h1>{dispSection.name}</h1>
          <div className="sub">{dispSection.zone}</div>
        </div>
      </div>

      <div className="page-wrap section-detail-wrap" style={{ paddingTop: 16 }}>

        {/* Locked warning banner */}
        {locked && (
          <div className="locked-banner">
            <span style={{ flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LockIcon /></span>
            <p style={{ fontSize: 13, color: '#7A5800', margin: 0, lineHeight: 1.5 }}>
              This inspection is <strong>locked</strong> while pending approval or already approved — answers cannot be changed.
            </p>
          </div>
        )}

        {/* Photo Section banner */}
        {dispSection.photoOnly && (
          <div className="photo-sec-banner">
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
            allSections={dispAllSections}
            availableQuestions={dispQuestions.map((item) => ({ id: item.id, ref: item.ref, text: item.text }))}
          />
        ))}

        {/* Section photos card */}
        <div
          className="section-photos-card"
          data-section-photos-drop="true"
          data-section-id={sectionId}
          onDragOver={(e) => {
            if (!locked) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={async (e) => {
            if (locked) return;
            e.preventDefault();
            let photoId = '';
            try {
              const json = e.dataTransfer.getData('application/json');
              if (json) {
                const parsed = JSON.parse(json);
                if (parsed.photoId) photoId = parsed.photoId;
              }
            } catch {}
            if (!photoId) photoId = e.dataTransfer.getData('text/plain');
            if (photoId) {
              const existing = await db.photos.get(photoId);
              if (existing && !(existing.target === 'section' && existing.inspectionSectionId === sectionId)) {
                await localWrite('photos', photoId, {
                  ...existing,
                  target: 'section',
                  inspectionSectionId: sectionId,
                  responseId: null,
                  findingId: null,
                  position: sectionPhotos.length,
                });
              }
            }
            endPhotoDrag();
          }}
        >
          <div className="section-photos-header">
            <span style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CameraIcon width={18} height={18} /></span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Section photos</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                General photos for this location — drag any photo onto a question above to assign it
              </div>
            </div>
          </div>
          <div style={{ padding: '12px 16px' }}>
            <PhotoStrip
              photos={sectionPhotos}
              target="section"
              inspectionId={inspectionId!}
              inspectionSectionId={sectionId}
              locked={locked}
              title={dispSection?.name || 'Section Photos'}
              allSections={dispAllSections}
              availableQuestions={dispQuestions.map((q) => ({ id: q.id, ref: q.ref, text: q.text }))}
            />
          </div>
        </div>

        {/* Additional findings heading */}
        <div className="findings-header">
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>
            Additional Findings
          </div>
          {findings.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--warn-tint)', color: 'var(--warn)' }}>
              {findings.length}
            </span>
          )}
        </div>
        <p className="findings-desc">
          {dispSection.photoOnly
            ? 'Record any specific observations, deficiencies, or findings for this photo section.'
            : 'Anything not covered by the checklist above — describe it and mark Yes/No.'}
        </p>

        {findings.map((f) => (
          <FindingCard
            key={f.id}
            finding={f}
            photos={photosByFinding.get(f.id) ?? []}
            locked={locked}
            allSections={dispAllSections}
          />
        ))}

        {!locked && (
          <div className="detail-action-buttons">
            <button
              className="btn-add-observation"
              onClick={() => void addFinding()}
            >
              <div style={{ width: 20, height: 20, flexShrink: 0, display: 'flex' }}><PlusIcon /></div> Add observation
            </button>

            {isSectionComplete && (
              <button
                type="button"
                className="btn-complete-section"
                disabled={completing}
                onClick={handleCompleteSection}
              >
                <div style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CheckIcon /></div>
                {completing ? 'Completing Section...' : 'Complete Section & Return'}
              </button>
            )}
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </>
  );
}
