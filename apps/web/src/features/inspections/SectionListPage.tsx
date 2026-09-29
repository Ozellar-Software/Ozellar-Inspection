import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { STATUS_LABELS } from '@ozellar/shared';
import { db } from '../../offline/db';
import { BackIcon } from '../../icons';

export function SectionListPage() {
  const nav = useNavigate();
  const { id: inspectionId } = useParams<{ id: string }>();

  const inspection = useLiveQuery(() => (inspectionId ? db.inspections.get(inspectionId) : undefined), [inspectionId]);
  const sections = useLiveQuery(
    () => (inspectionId ? db.inspectionSections.where('inspectionId').equals(inspectionId).sortBy('position') : []), [inspectionId]) ?? [];
  const questions = useLiveQuery(
    () => (inspectionId ? db.inspectionQuestions.toArray() : []), [inspectionId]) ?? [];
  const responses = useLiveQuery(
    () => (inspectionId ? db.responses.where('inspectionId').equals(inspectionId).toArray() : []), [inspectionId]) ?? [];

  const progressBySection = useMemo(() => {
    const answeredByQuestion = new Map(responses.map((r) => [r.inspectionQuestionId, r.answer != null || r.applicable === false]));
    const map = new Map<string, { done: number; total: number }>();
    for (const q of questions) {
      const cur = map.get(q.inspectionSectionId) ?? { done: 0, total: 0 };
      cur.total++;
      if (answeredByQuestion.get(q.id)) cur.done++;
      map.set(q.inspectionSectionId, cur);
    }
    return map;
  }, [questions, responses]);

  if (!inspection) return null;

  return (
    <>
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => nav('/')}><BackIcon /></button>
        <div className="title-wrap">
          <h1>{inspection.vesselName || 'Inspection'}</h1>
          <div className="sub">{STATUS_LABELS[inspection.status]}</div>
        </div>
      </div>

      <div className="page-wrap">
        {inspection.status === 'in_progress' || inspection.status === 'returned' ? (
          <div className="section-pad fab-new">
            <button className="btn btn-primary btn-block" onClick={() => nav(`/inspections/${inspectionId}/report`)}>
              Submit / view report
            </button>
          </div>
        ) : (
          <div className="section-pad fab-new">
            <button className="btn btn-outline btn-block" onClick={() => nav(`/inspections/${inspectionId}/report`)}>
              View report
            </button>
          </div>
        )}

        {sections.map((s) => {
          const p = progressBySection.get(s.id) ?? { done: 0, total: 0 };
          const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
          return (
            <div key={s.id} className="inspection-card" onClick={() => nav(`/inspections/${inspectionId}/sections/${s.id}`)}>
              <div className="body">
                <div className="vname">{s.name}</div>
                <div className="vmeta">{s.zone}</div>
                <div className="progress-row">
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                  <div className="progress-label">{p.done}/{p.total}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
