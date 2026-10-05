import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  type User, type TemplateSection, type TemplateQuestion,
  COMMON_VESSEL_TYPES,
} from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import { syncNow } from '../../offline/sync';
import {
  BackIcon, PlusIcon, TrashIcon, ClipboardIcon, AlertCircleIcon,
  CheckIcon, EditIcon, ChevronRightIcon, UsersIcon, ShipIcon,
  CameraIcon, CompassIcon,
} from '../../icons';
import './ChecklistPage.css';

const COMMON_VESSEL_TYPES_INFO: Array<{ name: string; key: string; color: string; bg: string; border: string }> = [
  { name: 'Bulk Carrier', key: 'bulk', color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' },
  { name: 'Container Ship', key: 'container', color: '#4F46E5', bg: '#EEF2FF', border: '#C7D2FE' },
  { name: 'Oil Tanker', key: 'tanker', color: '#E11D48', bg: '#FFF1F2', border: '#FECDD3' },
  { name: 'Chemical Tanker', key: 'chemical', color: '#BE123C', bg: '#FFF1F2', border: '#FECDD3' },
  { name: 'Gas Carrier', key: 'gas', color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  { name: 'General Cargo', key: 'general', color: '#0E7C86', bg: '#F0FDFA', border: '#99F6E4' },
  { name: 'Tug / Offshore', key: 'offshore', color: '#475569', bg: '#F1F5F9', border: '#CBD5E1' },
];

function getVesselTypeBadgeColor(type: string) {
  const match = COMMON_VESSEL_TYPES_INFO.find((t) => t.name.toLowerCase() === type.trim().toLowerCase());
  if (match) return match;
  return { name: type, key: 'custom', color: '#0E7C86', bg: '#F0FDFA', border: '#99F6E4' };
}

interface SectionFormData {
  id?: string;
  zone: string;
  name: string;
  photoOnly: boolean;
  vesselTypes: string[];
}

export function ChecklistPage() {
  const nav = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });
  const rawSections = ((useLiveQuery(() => db.templateSections.toArray(), []) as unknown as TemplateSection[] | undefined) ?? [])
    .filter((s) => !s.deletedAt).sort((a, b) => a.position - b.position);
  const allQuestions = ((useLiveQuery(() => db.templateQuestions.toArray(), []) as unknown as TemplateQuestion[] | undefined) ?? [])
    .filter((q) => !q.deletedAt);

  // Normalize sections so vesselTypes is always an array
  const sections = useMemo(() => {
    return rawSections.map((s) => ({
      ...s,
      vesselTypes: Array.isArray(s.vesselTypes) ? s.vesselTypes : [],
    }));
  }, [rawSections]);

  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [sectionForm, setSectionForm] = useState<SectionFormData | null>(null);
  const [newCustomType, setNewCustomType] = useState('');
  const [questionForm, setQuestionForm] = useState<{ id?: string; ref: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [filterScope, setFilterScope] = useState<'applicable' | 'assignedOnly'>('applicable');

  useEffect(() => {
    // Keep local IndexedDB template sections updated with the master checklist
    async function hydrateTemplates() {
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
    void hydrateTemplates();
  }, []);

  const openSection = sections.find((s) => s.id === openSectionId) ?? null;
  const questionsForOpen = allQuestions.filter((q) => q.sectionId === openSectionId).sort((a, b) => a.position - b.position);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: sections.length,
      universal: sections.filter((s) => !s.vesselTypes || s.vesselTypes.length === 0).length,
    };
    for (const type of COMMON_VESSEL_TYPES) {
      const catLower = type.trim().toLowerCase();
      counts[type] = sections.filter((s) => {
        const isUniversal = !s.vesselTypes || s.vesselTypes.length === 0;
        const isAssigned = (s.vesselTypes ?? []).some((t) => t.trim().toLowerCase() === catLower);
        return isAssigned || isUniversal;
      }).length;
    }
    return counts;
  }, [sections]);

  // Filtered sections list
  const filteredSections = useMemo(() => {
    if (selectedCategory === 'all') return sections;
    if (selectedCategory === 'universal') {
      return sections.filter((s) => !s.vesselTypes || s.vesselTypes.length === 0);
    }
    const catLower = selectedCategory.trim().toLowerCase();
    return sections.filter((s) => {
      const isUniversal = !s.vesselTypes || s.vesselTypes.length === 0;
      const isAssigned = (s.vesselTypes ?? []).some((t) => t.trim().toLowerCase() === catLower);
      if (filterScope === 'assignedOnly') {
        return isAssigned;
      }
      return isAssigned || isUniversal;
    });
  }, [sections, selectedCategory, filterScope]);

  function handleOpenAddSection() {
    const initialVesselTypes: string[] =
      selectedCategory !== 'all' && selectedCategory !== 'universal'
        ? [selectedCategory]
        : [];
    setSectionForm({
      zone: '',
      name: '',
      photoOnly: false,
      vesselTypes: initialVesselTypes,
    });
    setNewCustomType('');
    setError(null);
  }

  function handleOpenEditSection(s: TemplateSection) {
    setSectionForm({
      id: s.id,
      zone: s.zone,
      name: s.name,
      photoOnly: s.photoOnly,
      vesselTypes: Array.isArray(s.vesselTypes) ? [...s.vesselTypes] : [],
    });
    setNewCustomType('');
    setError(null);
  }

  function handleAddCustomType() {
    if (!sectionForm || !newCustomType.trim()) return;
    const trimmed = newCustomType.trim();
    if (!sectionForm.vesselTypes.includes(trimmed)) {
      setSectionForm({
        ...sectionForm,
        vesselTypes: [...sectionForm.vesselTypes, trimmed],
      });
    }
    setNewCustomType('');
  }

  async function saveSection(e: React.FormEvent) {
    e.preventDefault();
    if (!sectionForm) return;
    setBusy(true); setError(null);
    try {
      const payload = {
        id: sectionForm.id,
        zone: sectionForm.zone,
        name: sectionForm.name,
        photoOnly: sectionForm.photoOnly,
        vesselTypes: sectionForm.vesselTypes,
      };
      const saved = await api<TemplateSection>('/templates/sections', { method: 'POST', body: payload });
      await db.templateSections.put(saved as unknown as Record<string, unknown> & { id: string });
      await syncNow();
      setSectionForm(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this section');
    } finally { setBusy(false); }
  }

  async function deleteSection(s: TemplateSection) {
    if (!window.confirm(`Delete section "${s.name}" and all its questions?`)) return;
    setBusy(true); setError(null);
    try {
      await api(`/templates/sections/${s.id}`, { method: 'DELETE' });
      await db.templateSections.update(s.id, { deletedAt: new Date().toISOString() });
      if (openSectionId === s.id) setOpenSectionId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this section');
    } finally { setBusy(false); }
  }

  async function moveSection(s: TemplateSection, dir: -1 | 1) {
    const curIdx = sections.findIndex((item) => item.id === s.id);
    const targetIdx = curIdx + dir;
    if (targetIdx < 0 || targetIdx >= sections.length) return;
    const ids = sections.map((item) => item.id);
    [ids[curIdx], ids[targetIdx]] = [ids[targetIdx], ids[curIdx]];
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
    if (!window.confirm('Delete this question?')) return;
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
              {(!openSection.vesselTypes || openSection.vesselTypes.length === 0) ? (
                <span className="cl-vessel-tag-header universal">All Vessels</span>
              ) : (
                <span className="cl-vessel-tag-header specific">
                  <ShipIcon width={13} height={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  {openSection.vesselTypes.join(', ')}
                </span>
              )}
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
            <CameraIcon width={16} height={16} />
            <span>Photo sections hold photos only — they have no checklist questions.</span>
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
            <button className="cl-primary-btn" onClick={handleOpenAddSection}>
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

      {/* Category Filter Tabs */}
      {!sectionForm && (
        <div className="cl-filter-container">
          <div className="cl-category-filter-scroll">
            <button
              type="button"
              className={`cl-cat-tab ${selectedCategory === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              <span>All Sections</span>
              <span className="cl-cat-count">{categoryCounts.all}</span>
            </button>

            <button
              type="button"
              className={`cl-cat-tab ${selectedCategory === 'universal' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('universal')}
            >
              <CompassIcon width={14} height={14} />
              <span>Universal (All Vessels)</span>
              <span className="cl-cat-count">{categoryCounts.universal}</span>
            </button>

            {COMMON_VESSEL_TYPES.map((type) => {
              const isAct = selectedCategory === type;
              return (
                <button
                  key={type}
                  type="button"
                  className={`cl-cat-tab ${isAct ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(type)}
                >
                  <ShipIcon width={14} height={14} />
                  <span>{type}</span>
                  <span className="cl-cat-count">{categoryCounts[type] ?? 0}</span>
                </button>
              );
            })}
          </div>

          {selectedCategory !== 'all' && selectedCategory !== 'universal' && (
            <div className="cl-filter-subbar">
              <span className="cl-filter-hint">
                Viewing sections for <strong>{selectedCategory}</strong>:
              </span>
              <div className="cl-scope-toggles">
                <button
                  type="button"
                  className={`cl-scope-btn ${filterScope === 'applicable' ? 'active' : ''}`}
                  onClick={() => setFilterScope('applicable')}
                  title="Shows Universal sections + sections assigned to this vessel category"
                >
                  All Applicable ({categoryCounts[selectedCategory] ?? 0})
                </button>
                <button
                  type="button"
                  className={`cl-scope-btn ${filterScope === 'assignedOnly' ? 'active' : ''}`}
                  onClick={() => setFilterScope('assignedOnly')}
                  title="Shows only sections specifically assigned to this vessel category"
                >
                  Assigned Only ({sections.filter((s) => s.vesselTypes.some(t => t.toLowerCase() === selectedCategory.toLowerCase())).length})
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section Form */}
      {sectionForm && (
        <div className="cl-form-card">
          <div className="cl-form-header">
            <h2>{sectionForm.id ? 'Edit Section' : 'Add Section'}</h2>
            <p>Configure section name, zone, and vessel category applicability</p>
          </div>
          <form onSubmit={saveSection} className="cl-form-body">
            <div className="cl-form-grid">
              <div className="cl-form-field">
                <label className="cl-label">Zone</label>
                <input className="cl-input" value={sectionForm.zone}
                  onChange={(e) => setSectionForm({ ...sectionForm, zone: e.target.value })}
                  placeholder="e.g. Outside, Engine Room, Cargo Holds, Bridge" />
              </div>
              <div className="cl-form-field">
                <label className="cl-label">Section Name <span className="cl-req">*</span></label>
                <input className="cl-input" value={sectionForm.name}
                  onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })}
                  required autoFocus placeholder="e.g. Hull Condition, Cargo Tanks, Hatch Covers" />
              </div>
            </div>

            {/* Photo Section Toggle */}
            <label className={`cl-photo-toggle ${sectionForm.id ? 'disabled' : ''}`}>
              <input type="checkbox" checked={sectionForm.photoOnly} disabled={!!sectionForm.id}
                onChange={(e) => setSectionForm({ ...sectionForm, photoOnly: e.target.checked })} />
              <div className="cl-photo-toggle-text">
                <strong>Photo Section</strong>
                <span>Photos only — no checklist questions in this section</span>
              </div>
            </label>

            {/* Vessel Category Assignment Panel */}
            <div className="cl-vessel-assignment-box">
              <div className="cl-assignment-header">
                <label className="cl-label">Vessel Category Assignment <span className="cl-req">*</span></label>
                <span className="cl-assignment-subhint">
                  Assign this section to all vessels or select 1 or more particular vessel categories
                </span>
              </div>

              {/* Mode Selector Toggle */}
              <div className="cl-vessel-mode-toggle">
                <button
                  type="button"
                  className={`cl-vessel-mode-btn ${sectionForm.vesselTypes.length === 0 ? 'active' : ''}`}
                  onClick={() => setSectionForm({ ...sectionForm, vesselTypes: [] })}
                >
                  <span className="cl-mode-icon"><CompassIcon width={20} height={20} /></span>
                  <div className="cl-mode-text">
                    <strong>All Vessel Categories (Universal)</strong>
                    <small>Included in inspections for every vessel</small>
                  </div>
                </button>
                <button
                  type="button"
                  className={`cl-vessel-mode-btn ${sectionForm.vesselTypes.length > 0 ? 'active' : ''}`}
                  onClick={() => {
                    if (sectionForm.vesselTypes.length === 0) {
                      const initial = (selectedCategory !== 'all' && selectedCategory !== 'universal')
                        ? [selectedCategory]
                        : ['Bulk Carrier'];
                      setSectionForm({ ...sectionForm, vesselTypes: initial });
                    }
                  }}
                >
                  <span className="cl-mode-icon"><ShipIcon width={18} height={18} /></span>
                  <div className="cl-mode-text">
                    <strong>Specific Vessel Categories</strong>
                    <small>Assign to 1 or more particular vessel types</small>
                  </div>
                </button>
              </div>

              {/* Specific Categories Chips Grid */}
              {sectionForm.vesselTypes.length > 0 && (
                <div className="cl-specific-vessels-panel">
                  <div className="cl-panel-toolbar">
                    <span className="cl-selection-summary">
                      Assigned to <strong>{sectionForm.vesselTypes.length}</strong> vessel categor{sectionForm.vesselTypes.length === 1 ? 'y' : 'ies'}:
                    </span>
                    <div className="cl-quick-actions">
                      <button
                        type="button"
                        className="cl-text-action-btn"
                        onClick={() => setSectionForm({ ...sectionForm, vesselTypes: [...COMMON_VESSEL_TYPES] })}
                      >
                        Select All Standard
                      </button>
                      <span className="cl-action-sep">·</span>
                      <button
                        type="button"
                        className="cl-text-action-btn"
                        onClick={() => setSectionForm({ ...sectionForm, vesselTypes: ['Bulk Carrier'] })}
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="cl-vessel-chips-grid">
                    {COMMON_VESSEL_TYPES.map((type) => {
                      const isSelected = sectionForm.vesselTypes.includes(type);
                      const theme = COMMON_VESSEL_TYPES_INFO.find((t) => t.name === type);
                      return (
                        <button
                          key={type}
                          type="button"
                          className={`cl-vessel-chip ${isSelected ? 'selected' : ''}`}
                          style={isSelected && theme ? { borderColor: theme.border, background: theme.bg, color: theme.color } : {}}
                          onClick={() => {
                            const current = sectionForm.vesselTypes;
                            const next = isSelected
                              ? current.filter((t) => t !== type)
                              : [...current, type];
                            setSectionForm({ ...sectionForm, vesselTypes: next });
                          }}
                        >
                          <span className="cl-chip-check">
                            {isSelected ? <CheckIcon width={13} height={13} /> : <span className="cl-chip-empty-dot" />}
                          </span>
                          <span className="cl-chip-label">{type}</span>
                        </button>
                      );
                    })}

                    {/* Custom types added */}
                    {sectionForm.vesselTypes
                      .filter((t) => !COMMON_VESSEL_TYPES.includes(t as any))
                      .map((type) => (
                        <button
                          key={type}
                          type="button"
                          className="cl-vessel-chip selected custom"
                          onClick={() => {
                            setSectionForm({
                              ...sectionForm,
                              vesselTypes: sectionForm.vesselTypes.filter((t) => t !== type),
                            });
                          }}
                        >
                          <span className="cl-chip-check"><CheckIcon width={13} height={13} /></span>
                          <span className="cl-chip-label">{type}</span>
                          <span className="cl-chip-remove">×</span>
                        </button>
                      ))}
                  </div>

                  {/* Add Custom Vessel Type */}
                  <div className="cl-add-custom-type-row">
                    <input
                      type="text"
                      className="cl-custom-type-input"
                      placeholder="Add custom vessel type (e.g. Ro-Ro, Chemical Barge)..."
                      value={newCustomType}
                      onChange={(e) => setNewCustomType(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustomType();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="cl-btn-add-custom"
                      onClick={handleAddCustomType}
                      disabled={!newCustomType.trim()}
                    >
                      <PlusIcon width={14} height={14} /> Add
                    </button>
                  </div>

                  {sectionForm.vesselTypes.length === 0 && (
                    <div className="cl-warning-hint">
                      <AlertCircleIcon width={14} height={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                      No vessel categories selected. Switch to Universal or select at least 1 vessel category above.
                    </div>
                  )}
                </div>
              )}
            </div>

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
            {filteredSections.length} section{filteredSections.length !== 1 ? 's' : ''}
            {selectedCategory !== 'all' && ` (filtered by ${selectedCategory})`}
            {' · '}
            {allQuestions.length} total questions
          </div>

          {filteredSections.length === 0 && (
            <div className="cl-empty-state">
              <div className="cl-empty-icon"><ClipboardIcon width={48} height={48} /></div>
              <h3 className="cl-empty-title">No Sections Found</h3>
              <p className="cl-empty-desc">
                {selectedCategory !== 'all'
                  ? `There are no sections assigned to "${selectedCategory}". Click "Add Section" to create one.`
                  : 'Start building your inspection checklist by adding the first section above.'}
              </p>
              {selectedCategory !== 'all' && (
                <button className="cl-primary-btn" onClick={handleOpenAddSection}>
                  <PlusIcon width={16} height={16} /> Add Section for {selectedCategory}
                </button>
              )}
            </div>
          )}

          <div className="cl-list-container">
            {filteredSections.map((s) => {
              const count = allQuestions.filter((q) => q.sectionId === s.id).length;
              const isUniversal = !s.vesselTypes || s.vesselTypes.length === 0;

              return (
                <div key={s.id} className="cl-row-card">
                  <div className="cl-row-header" onClick={() => setOpenSectionId(s.id)} style={{ cursor: 'pointer' }}>
                    <div className="cl-row-main">
                      <div className={`cl-section-avatar ${s.photoOnly ? 'photo' : 'check'}`}>
                        {s.photoOnly ? <CameraIcon width={22} height={22} /> : <ClipboardIcon width={22} height={22} />}
                      </div>
                      <div className="cl-row-info">
                        <div className="cl-title-main">
                          <span className="cl-section-name">{s.name}</span>
                          {s.photoOnly && <span className="cl-type-chip photo-chip">Photo Section</span>}
                        </div>

                        {/* Vessel Category Badges */}
                        <div className="cl-vessel-tags-row">
                          {isUniversal ? (
                            <span className="cl-vessel-badge universal">All Vessel Types</span>
                          ) : s.vesselTypes.length === 1 ? (
                            (() => {
                              const badge = getVesselTypeBadgeColor(s.vesselTypes[0]);
                              return (
                                <span
                                  className="cl-vessel-badge specific"
                                  style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
                                >
                                  <ShipIcon width={12} height={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                  {s.vesselTypes[0]}
                                </span>
                              );
                            })()
                          ) : (
                            <div className="cl-vessel-badge-cluster">
                              <span className="cl-vessel-badge-counter">
                                {s.vesselTypes.length} Types:
                              </span>
                              {s.vesselTypes.map((t) => {
                                const badge = getVesselTypeBadgeColor(t);
                                return (
                                  <span
                                    key={t}
                                    className="cl-vessel-badge specific"
                                    style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
                                  >
                                    <ShipIcon width={12} height={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                    {t}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="cl-q-meta">
                          <span className="cl-sub-item">{s.zone || 'No zone'}</span>
                          <span className="cl-sub-sep">•</span>
                          <span className="cl-sub-item">{s.photoOnly ? 'Photos only' : `${count} question${count !== 1 ? 's' : ''}`}</span>
                          <span className="cl-sub-sep">•</span>
                          <span className="cl-sub-item">Position {s.position + 1}</span>
                        </div>
                      </div>
                    </div>

                    <div className="cl-row-controls" onClick={(e) => e.stopPropagation()}>
                      <div className="cl-reorder-group" title={selectedCategory !== 'all' ? 'Filtering active — reordering adjusts overall template position' : ''}>
                        <button className="cl-icon-btn" aria-label="Move up" disabled={s.position === 0}
                          onClick={() => void moveSection(s, -1)}>↑</button>
                        <button className="cl-icon-btn" aria-label="Move down" disabled={s.position >= sections.length - 1}
                          onClick={() => void moveSection(s, 1)}>↓</button>
                      </div>
                      <button className="cl-icon-btn edit" title="Edit section"
                        onClick={() => handleOpenEditSection(s)}>
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
