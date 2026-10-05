import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import { syncNow } from '../../offline/sync';
import {
  BackIcon, PlusIcon, TrashIcon, ClipboardIcon, AlertCircleIcon,
  CheckIcon, EditIcon, ChevronRightIcon, ChevronLeftIcon, UsersIcon,
} from '../../icons';
import './ChecklistPage.css';

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

  useEffect(() => {
    // If local IndexedDB templateSections is empty or outdated, fetch master checklist directly from server
    async function hydrateTemplates() {
      const count = await db.templateSections.count();
      if (count === 0) {
        try {
          const [serverSecs, serverQs] = await Promise.all([
            api<TemplateSection[]>('/templates/sections/list'),
            api<TemplateQuestion[]>('/templates/questions/list'),
          ]);
          if (serverSecs.length) {
            await db.templateSections.bulkPut(serverSecs as unknown as Record<string, unknown> & { id: string }[]);
          }
          if (serverQs.length) {
            await db.templateQuestions.bulkPut(serverQs as unknown as Record<string, unknown> & { id: string }[]);
          }
        } catch {
          void syncNow();
        }
      }
    }
    void hydrateTemplates();
  }, []);

  const openSection = sections.find((s) => s.id === openSectionId) ?? null;
  const questionsForOpen = allQuestions.filter((q) => q.sectionId === openSectionId).sort((a, b) => a.position - b.position);

  async function saveSection(e: React.FormEvent) {
    e.preventDefault();
    if (!sectionForm) return;
    setBusy(true); setError(null);
    try {
      const saved = await api<TemplateSection>('/templates/sections', { method: 'POST', body: sectionForm });
      await db.templateSections.put(saved as unknown as Record<string, unknown> & { id: string });
      await syncNow();
      setSectionForm(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this section');
    } finally { setBusy(false); }
  }

  async function deleteSection(s: TemplateSection) {
    setBusy(true); setError(null);
    try {
      await api(`/templates/sections/${s.id}`, { method: 'DELETE' });
      await db.templateSections.update(s.id, { deletedAt: new Date().toISOString() });
      if (openSectionId === s.id) setOpenSectionId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this section');
    } finally { setBusy(false); }
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
    } finally { setBusy(false); }
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
    } finally { setBusy(false); }
  }

  async function deleteQuestion(q: TemplateQuestion) {
    setBusy(true); setError(null);
    try {
      await api(`/templates/questions/${q.id}`, { method: 'DELETE' });
      await db.templateQuestions.update(q.id, { deletedAt: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this question');
    } finally { setBusy(false); }
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
    } finally { setBusy(false); }
  }

  // ─── Access Guard ───
  if (me.data && me.data.role !== 'admin') {
    return (
      <div className="cl-page-wrap">
        <header className="cl-page-header">
          <div className="cl-title-group">
            <button className="back-btn-premium" aria-label="Back" onClick={() => nav('/')}><BackIcon /></button>
            <div className="cl-title-row">
              <h1 className="cl-page-title">Checklist Templates</h1>
            </div>
          </div>
        </header>
        <div className="cl-empty-state">
          <div className="cl-empty-icon"><UsersIcon width={48} height={48} /></div>
          <h3 className="cl-empty-title">Administrator Access Required</h3>
          <p className="cl-empty-desc">Only system administrators can manage inspection checklist templates.</p>
          <button className="cl-primary-btn" onClick={() => nav('/')}>Return to Dashboard</button>
        </div>
      </div>
    );
  }

  // ─── Question Detail View ───
  if (openSection) {
    return (
      <div className="cl-page-wrap">
        <header className="cl-page-header">
          <div className="cl-title-group">
            <button className="back-btn-premium" aria-label="Back"
              onClick={() => (questionForm ? setQuestionForm(null) : setOpenSectionId(null))}>
              <BackIcon />
            </button>
            <div className="cl-title-row">
              <h1 className="cl-page-title">{openSection.name}</h1>
              <span className="cl-count-pill">{openSection.zone || 'Section'}</span>
            </div>
          </div>
          {!openSection.photoOnly && !questionForm && (
            <div className="cl-header-actions">
              <button className="cl-primary-btn" onClick={() => setQuestionForm({ ref: '', text: '' })}>
                <PlusIcon width={16} height={16} /> Add Question
              </button>
            </div>
          )}
        </header>

        {error && (
          <div className="cl-error-banner">
            <AlertCircleIcon width={16} height={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Question Form */}
        {questionForm && (
          <div className="cl-form-card">
            <div className="cl-form-header">
              <h2>{questionForm.id ? 'Edit Question' : 'Add Question'}</h2>
              <p>Add an inspection checklist item to this section</p>
            </div>
            <form onSubmit={saveQuestion} className="cl-form-body">
              <div className="cl-form-field">
                <label className="cl-label">Reference ID</label>
                <input
                  className="cl-input"
                  value={questionForm.ref}
                  onChange={(e) => setQuestionForm({ ...questionForm, ref: e.target.value })}
                  placeholder="e.g. H-1, SR-03"
                />
              </div>
              <div className="cl-form-field">
                <label className="cl-label">Question Text <span className="cl-req">*</span></label>
                <textarea
                  className="cl-input cl-textarea"
                  value={questionForm.text}
                  onChange={(e) => setQuestionForm({ ...questionForm, text: e.target.value })}
                  required autoFocus
                  placeholder="What needs to be inspected or checked?"
                />
              </div>
              <div className="cl-form-actions">
                <button type="button" className="cl-btn-cancel" onClick={() => setQuestionForm(null)}>Cancel</button>
                <button type="submit" className="cl-btn-save" disabled={busy}>
                  <CheckIcon width={15} height={15} />
                  <span>{busy ? 'Saving…' : questionForm.id ? 'Save Changes' : 'Add Question'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Photo-only notice */}
        {openSection.photoOnly && !questionForm && (
          <div className="cl-info-banner">
            <span>📷 Photo sections hold photos only — they have no checklist questions.</span>
          </div>
        )}

        {/* Questions List */}
        {!questionForm && !openSection.photoOnly && (
          <>
            <div className="cl-results-count">
              {questionsForOpen.length} question{questionsForOpen.length !== 1 ? 's' : ''} in this section
            </div>

            {questionsForOpen.length === 0 && (
              <div className="cl-empty-state" style={{ marginTop: 16 }}>
                <div className="cl-empty-icon"><ClipboardIcon width={40} height={40} /></div>
                <h3 className="cl-empty-title">No Questions Yet</h3>
                <p className="cl-empty-desc">Add inspection questions to this section using the button above.</p>
              </div>
            )}

            <div className="cl-list-container">
              {questionsForOpen.map((q, i) => (
                <div key={q.id} className="cl-row-card">
                  <div className="cl-row-header">
                    <div className="cl-row-main" onClick={() => setQuestionForm({ id: q.id, ref: q.ref, text: q.text })} style={{ cursor: 'pointer' }}>
                      <div className="cl-q-avatar">{q.ref || `Q${i + 1}`}</div>
                      <div className="cl-row-info">
                        <div className="cl-q-text">{q.text}</div>
                        <div className="cl-q-meta">
                          <span className="cl-sub-item">Reference: {q.ref || '—'}</span>
                          <span className="cl-sub-sep">•</span>
                          <span className="cl-sub-item">Position {i + 1} of {questionsForOpen.length}</span>
                        </div>
                      </div>
                    </div>
                    <div className="cl-row-controls">
                      <div className="cl-reorder-group">
                        <button className="cl-icon-btn" aria-label="Move up" disabled={i === 0}
                          onClick={(e) => { e.stopPropagation(); void moveQuestion(i, -1); }}>↑</button>
                        <button className="cl-icon-btn" aria-label="Move down" disabled={i === questionsForOpen.length - 1}
                          onClick={(e) => { e.stopPropagation(); void moveQuestion(i, 1); }}>↓</button>
                      </div>
                      <button className="cl-icon-btn edit" title="Edit question"
                        onClick={(e) => { e.stopPropagation(); setQuestionForm({ id: q.id, ref: q.ref, text: q.text }); }}>
                        <EditIcon width={14} height={14} />
                      </button>
                      <button className="cl-icon-btn delete" aria-label="Delete question"
                        onClick={(e) => { e.stopPropagation(); void deleteQuestion(q); }}>
                        <TrashIcon width={14} height={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // ─── Main Sections View ───
  return (
    <div className="cl-page-wrap">
      <header className="cl-page-header">
        <div className="cl-title-group">
          <button className="back-btn-premium" aria-label="Back"
            onClick={() => (sectionForm ? setSectionForm(null) : nav('/'))}>
            <BackIcon />
          </button>
          <div className="cl-title-row">
            <h1 className="cl-page-title">Checklist Templates</h1>
            <span className="cl-count-pill">{sections.length} Section{sections.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        {!sectionForm && (
          <div className="cl-header-actions">
            <button className="cl-primary-btn" onClick={() => setSectionForm({ zone: '', name: '', photoOnly: false })}>
              <PlusIcon width={16} height={16} /> Add Section
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="cl-error-banner">
          <AlertCircleIcon width={16} height={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Section Form */}
      {sectionForm && (
        <div className="cl-form-card">
          <div className="cl-form-header">
            <h2>{sectionForm.id ? 'Edit Section' : 'Add Section'}</h2>
            <p>Define an inspection zone and name for this checklist section</p>
          </div>
          <form onSubmit={saveSection} className="cl-form-body">
            <div className="cl-form-grid">
              <div className="cl-form-field">
                <label className="cl-label">Zone</label>
                <input className="cl-input" value={sectionForm.zone}
                  onChange={(e) => setSectionForm({ ...sectionForm, zone: e.target.value })}
                  placeholder="e.g. Outside, Engine Room, Bridge" />
              </div>
              <div className="cl-form-field">
                <label className="cl-label">Section Name <span className="cl-req">*</span></label>
                <input className="cl-input" value={sectionForm.name}
                  onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })}
                  required autoFocus placeholder="e.g. Hull Condition" />
              </div>
            </div>
            <label className={`cl-photo-toggle ${sectionForm.id ? 'disabled' : ''}`}>
              <input type="checkbox" checked={sectionForm.photoOnly} disabled={!!sectionForm.id}
                onChange={(e) => setSectionForm({ ...sectionForm, photoOnly: e.target.checked })} />
              <div className="cl-photo-toggle-text">
                <strong>Photo Section</strong>
                <span>Photos only — no checklist questions in this section</span>
              </div>
            </label>
            {sectionForm.photoOnly && !sectionForm.id && (
              <p className="cl-hint">Photo sections are included in newly created inspections.</p>
            )}
            <div className="cl-form-actions">
              <button type="button" className="cl-btn-cancel" onClick={() => setSectionForm(null)}>Cancel</button>
              <button type="submit" className="cl-btn-save" disabled={busy}>
                <CheckIcon width={15} height={15} />
                <span>{busy ? 'Saving…' : sectionForm.id ? 'Save Changes' : 'Add Section'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sections List */}
      {!sectionForm && (
        <>
          <div className="cl-results-count">
            {sections.length} section{sections.length !== 1 ? 's' : ''} · {allQuestions.length} total questions
          </div>

          {sections.length === 0 && (
            <div className="cl-empty-state">
              <div className="cl-empty-icon"><ClipboardIcon width={48} height={48} /></div>
              <h3 className="cl-empty-title">No Sections Yet</h3>
              <p className="cl-empty-desc">Start building your inspection checklist by adding the first section above.</p>
            </div>
          )}

          <div className="cl-list-container">
            {sections.map((s, i) => {
              const count = allQuestions.filter((q) => q.sectionId === s.id).length;
              return (
                <div key={s.id} className="cl-row-card">
                  <div className="cl-row-header" onClick={() => setOpenSectionId(s.id)} style={{ cursor: 'pointer' }}>
                    <div className="cl-row-main">
                      <div className={`cl-section-avatar ${s.photoOnly ? 'photo' : 'check'}`}>
                        {s.photoOnly ? '📷' : <ClipboardIcon width={22} height={22} />}
                      </div>
                      <div className="cl-row-info">
                        <div className="cl-title-main">
                          <span className="cl-section-name">{s.name}</span>
                          {s.photoOnly && <span className="cl-type-chip photo-chip">Photo Section</span>}
                        </div>
                        <div className="cl-q-meta">
                          <span className="cl-sub-item">{s.zone || 'No zone'}</span>
                          <span className="cl-sub-sep">•</span>
                          <span className="cl-sub-item">{s.photoOnly ? 'Photos only' : `${count} question${count !== 1 ? 's' : ''}`}</span>
                          <span className="cl-sub-sep">•</span>
                          <span className="cl-sub-item">Position {i + 1}</span>
                        </div>
                      </div>
                    </div>

                    <div className="cl-row-controls" onClick={e => e.stopPropagation()}>
                      <div className="cl-reorder-group">
                        <button className="cl-icon-btn" aria-label="Move up" disabled={i === 0}
                          onClick={() => void moveSection(i, -1)}>↑</button>
                        <button className="cl-icon-btn" aria-label="Move down" disabled={i === sections.length - 1}
                          onClick={() => void moveSection(i, 1)}>↓</button>
                      </div>
                      <button className="cl-icon-btn edit" title="Edit section"
                        onClick={() => setSectionForm({ id: s.id, zone: s.zone, name: s.name, photoOnly: s.photoOnly })}>
                        <EditIcon width={14} height={14} />
                      </button>
                      <button className="cl-icon-btn delete" aria-label="Delete section"
                        onClick={() => void deleteSection(s)}>
                        <TrashIcon width={14} height={14} />
                      </button>
                      <ChevronRightIcon width={16} height={16} style={{ color: 'var(--faint)', flexShrink: 0 }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
