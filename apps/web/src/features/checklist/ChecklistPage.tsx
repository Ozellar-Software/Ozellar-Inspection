import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import { syncNow } from '../../offline/sync';
import { BackIcon, PlusIcon, TrashIcon } from '../../icons';

interface TemplateSection { id: string; sr: number; zone: string; name: string; position: number; photoOnly: boolean; deletedAt?: string | null }
interface TemplateQuestion { id: string; sectionId: string; qid: number; ref: string; text: string; position: number; deletedAt?: string | null }

export function ChecklistPage() {
  const nav = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });
  const sections = ((useLiveQuery(() => db.templateSections.toArray(), []) as unknown as TemplateSection[] | undefined) ?? [])
    .filter((s) => !s.deletedAt).sort((a, b) => a.position - b.position);
  const allQuestions = ((useLiveQuery(() => db.templateQuestions.toArray(), []) as unknown as TemplateQuestion[] | undefined) ?? [])
    .filter((q) => !q.deletedAt);

  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [sectionForm, setSectionForm] = useState<{ id?: string; zone: string; name: string; photoOnly: boolean } | null>(null);
  const [questionForm, setQuestionForm] = useState<{ id?: string; ref: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openSection = sections.find((s) => s.id === openSectionId) ?? null;
  const questionsForOpen = allQuestions.filter((q) => q.sectionId === openSectionId).sort((a, b) => a.position - b.position);

  if (me.data && me.data.role !== 'admin') {
    return (
      <>
        <div className="appbar">
          <button className="back" aria-label="Back" onClick={() => nav('/')}><BackIcon /></button>
          <div className="title-wrap"><h1>Manage checklist</h1></div>
        </div>
        <div className="empty-state"><p>Admins only.</p></div>
      </>
    );
  }

  async function saveSection(e: React.FormEvent) {
    e.preventDefault();
    if (!sectionForm) return;
    setBusy(true); setError(null);
    try {
      const saved = await api<TemplateSection>('/templates/sections', { method: 'POST', body: sectionForm });
      await db.templateSections.put(saved as unknown as Record<string, unknown> & { id: string });
      await syncNow(); // a new Photo section is also added server-side to every open inspection — pull that in
      setSectionForm(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this section');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSection(s: TemplateSection) {
    setBusy(true); setError(null);
    try {
      await api(`/templates/sections/${s.id}`, { method: 'DELETE' });
      await db.templateSections.update(s.id, { deletedAt: new Date().toISOString() });
      if (openSectionId === s.id) setOpenSectionId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this section');
    } finally {
      setBusy(false);
    }
  }

  async function moveSection(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= sections.length) return;
    const ids = sections.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true); setError(null);
    try {
      await api('/templates/sections/reorder', { method: 'POST', body: { ids } });
      await Promise.all(ids.map((id, i) => db.templateSections.update(id, { position: i })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reorder sections');
    } finally {
      setBusy(false);
    }
  }

  async function saveQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!questionForm || !openSectionId) return;
    setBusy(true); setError(null);
    try {
      const saved = await api<TemplateQuestion>('/templates/questions', { method: 'POST', body: { ...questionForm, sectionId: openSectionId } });
      await db.templateQuestions.put(saved as unknown as Record<string, unknown> & { id: string });
      setQuestionForm(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this question');
    } finally {
      setBusy(false);
    }
  }

  async function deleteQuestion(q: TemplateQuestion) {
    setBusy(true); setError(null);
    try {
      await api(`/templates/questions/${q.id}`, { method: 'DELETE' });
      await db.templateQuestions.update(q.id, { deletedAt: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this question');
    } finally {
      setBusy(false);
    }
  }

  async function moveQuestion(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= questionsForOpen.length) return;
    const ids = questionsForOpen.map((q) => q.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true); setError(null);
    try {
      await api('/templates/questions/reorder', { method: 'POST', body: { ids } });
      await Promise.all(ids.map((id, i) => db.templateQuestions.update(id, { position: i })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reorder questions');
    } finally {
      setBusy(false);
    }
  }

  if (openSection) {
    return (
      <>
        <div className="appbar">
          <button className="back" aria-label="Back" onClick={() => (questionForm ? setQuestionForm(null) : setOpenSectionId(null))}><BackIcon /></button>
          <div className="title-wrap"><h1>{openSection.name}</h1><div className="sub">{openSection.zone || 'Section'}</div></div>
        </div>

        <div className="page-wrap">
          {error && <div className="section-pad"><div className="auth-error">{error}</div></div>}

          {questionForm ? (
            <form onSubmit={saveQuestion} className="section-pad" style={{ margin: '16px 0', display: 'grid', gap: 14 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span className="seg-label">REF</span>
                <input className="auth-input" value={questionForm.ref} onChange={(e) => setQuestionForm({ ...questionForm, ref: e.target.value })} placeholder="e.g. H-1" />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span className="seg-label">QUESTION TEXT</span>
                <textarea className="auth-input" style={{ minHeight: 90, width: '100%' }} value={questionForm.text}
                  onChange={(e) => setQuestionForm({ ...questionForm, text: e.target.value })} required autoFocus />
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setQuestionForm(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          ) : (
            <>
              {openSection.photoOnly ? (
                <p className="footer-note">Photo sections hold photos only — they have no checklist questions.</p>
              ) : (
                <div className="section-pad fab-new" style={{ marginTop: 16 }}>
                  <button className="btn btn-primary btn-block" onClick={() => setQuestionForm({ ref: '', text: '' })}><PlusIcon />Add question</button>
                </div>
              )}
              {questionsForOpen.length === 0 && !openSection.photoOnly && <div className="empty-state"><p>No questions in this section yet.</p></div>}
              {questionsForOpen.map((q, i) => (
                <div key={q.id} className="inspection-card" onClick={() => setQuestionForm({ id: q.id, ref: q.ref, text: q.text })}>
                  <div className="body">
                    <div className="vname">{q.ref || `Q${i + 1}`}</div>
                    <div className="vmeta">{q.text}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button className="icon-btn" aria-label="Move up" disabled={i === 0}
                      onClick={(e) => { e.stopPropagation(); void moveQuestion(i, -1); }}>↑</button>
                    <button className="icon-btn" aria-label="Move down" disabled={i === questionsForOpen.length - 1}
                      onClick={(e) => { e.stopPropagation(); void moveQuestion(i, 1); }}>↓</button>
                  </div>
                  <button className="icon-btn" aria-label="Delete question" onClick={(e) => { e.stopPropagation(); void deleteQuestion(q); }}><TrashIcon /></button>
                </div>
              ))}
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => (sectionForm ? setSectionForm(null) : nav('/'))}><BackIcon /></button>
        <div className="title-wrap"><h1>{sectionForm ? (sectionForm.id ? 'Edit section' : 'Add section') : 'Manage checklist'}</h1></div>
      </div>

      <div className="page-wrap">
        {error && <div className="section-pad"><div className="auth-error">{error}</div></div>}

        {sectionForm ? (
          <form onSubmit={saveSection} className="section-pad" style={{ margin: '16px 0', display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="seg-label">ZONE</span>
              <input className="auth-input" value={sectionForm.zone} onChange={(e) => setSectionForm({ ...sectionForm, zone: e.target.value })} placeholder="e.g. Outside, Inside, Engine Room" />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="seg-label">SECTION NAME</span>
              <input className="auth-input" value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} required autoFocus />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={sectionForm.photoOnly} disabled={!!sectionForm.id}
                onChange={(e) => setSectionForm({ ...sectionForm, photoOnly: e.target.checked })} />
              <span>Photo section (photos only, no questions)</span>
            </label>
            {sectionForm.photoOnly && !sectionForm.id && (
              <p className="footer-note" style={{ textAlign: 'left', padding: 0 }}>This is added automatically to every not-yet-completed inspection, on every vessel.</p>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setSectionForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        ) : (
          <>
            <div className="section-pad fab-new" style={{ marginTop: 16 }}>
              <button className="btn btn-primary btn-block" onClick={() => setSectionForm({ zone: '', name: '', photoOnly: false })}><PlusIcon />Add section</button>
            </div>
            {sections.length === 0 && <div className="empty-state"><p>No sections yet.</p></div>}
            {sections.map((s, i) => {
              const count = allQuestions.filter((q) => q.sectionId === s.id).length;
              return (
                <div key={s.id} className="inspection-card" onClick={() => setOpenSectionId(s.id)}>
                  <div className="body">
                    <div className="vname">
                      {s.name}
                      {s.photoOnly && <span className="badge" style={{ marginLeft: 8, background: 'var(--warn-tint)', color: 'var(--warn)' }}>Photo section</span>}
                    </div>
                    <div className="vmeta">{s.zone || '—'} · {s.photoOnly ? 'photos only' : `${count} question${count === 1 ? '' : 's'}`}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button className="icon-btn" aria-label="Move up" disabled={i === 0}
                      onClick={(e) => { e.stopPropagation(); void moveSection(i, -1); }}>↑</button>
                    <button className="icon-btn" aria-label="Move down" disabled={i === sections.length - 1}
                      onClick={(e) => { e.stopPropagation(); void moveSection(i, 1); }}>↓</button>
                  </div>
                  <button className="icon-btn" aria-label="Delete section" onClick={(e) => { e.stopPropagation(); void deleteSection(s); }}><TrashIcon /></button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
