import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { can, isEditable, STATUS_LABELS, type InspectionStatus, type User } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { localWrite } from '../../offline/outbox';
import { BackIcon, CameraIcon, PlusIcon, XIcon } from '../../icons';
import { useLightMode } from '../home/useLightMode';
import './SectionListPage.css';

// ─── Zone colour pills ────────────────────────────────────────────────────
const ZONE_COLORS: Record<string, { bg: string; text: string }> = {
  'Exterior':  { bg: '#E4F1F1', text: '#0A5F67' },
  'Machinery': { bg: '#FBF1DE', text: '#C98A1A' },
  'Bridge':    { bg: '#E6F0FA', text: '#1F5C99' },
  'Cargo':     { bg: '#F1EBF9', text: '#7C3EC6' },
  'Safety':    { bg: '#E7F5EC', text: '#1F8A57' },
  'Living':    { bg: '#FBEAE6', text: '#C1432A' },
};
function zoneColor(zone: string) {
  return ZONE_COLORS[zone] ?? { bg: '#EEF1F2', text: '#5B6B76' };
}

// ─── Progress fill colour based on completion ─────────────────────────────
function progressColor(pct: number): string {
  if (pct === 100) return 'var(--ok)';
  if (pct >= 50)   return 'var(--accent)';
  if (pct > 0)     return 'var(--warn)';
  return '#CBD3D8';
}

export function SectionListPage() {
  const nav = useNavigate();
  const { id: inspectionId } = useParams<{ id: string }>();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });
  const [light, setLight] = useLightMode();
  const [showAddSection, setShowAddSection] = useState(false);
  const [addName, setAddName] = useState('');
  const [addZone, setAddZone] = useState('Exterior');
  const [isSaving, setIsSaving] = useState(false);

  const inspection = useLiveQuery(() => (inspectionId ? db.inspections.get(inspectionId) : undefined), [inspectionId]);
  const sections = useLiveQuery(
    () => (inspectionId ? db.inspectionSections.where('inspectionId').equals(inspectionId).sortBy('position') : []), [inspectionId]) ?? [];
  const rawQuestions = useLiveQuery(
    () => (inspectionId ? db.inspectionQuestions.toArray() : []), [inspectionId]) ?? [];
  const sectionIdSet = useMemo(() => new Set(sections.map((s) => s.id)), [sections]);
  const questions = useMemo(
    () => rawQuestions.filter((q) => sectionIdSet.has(q.inspectionSectionId)),
    [rawQuestions, sectionIdSet]
  );
  const responses = useLiveQuery(
    () => (inspectionId ? db.responses.where('inspectionId').equals(inspectionId).toArray() : []), [inspectionId]) ?? [];
  const photos = useLiveQuery(
    () => (inspectionId ? db.photos.where('inspectionId').equals(inspectionId).toArray() : []), [inspectionId]) ?? [];

  const photosBySection = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of photos) {
      if (p.deletedAt) continue;
      if (p.inspectionSectionId) {
        map.set(p.inspectionSectionId, (map.get(p.inspectionSectionId) ?? 0) + 1);
      }
    }
    return map;
  }, [photos]);

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

  const displayInspection = inspection;
  if (!displayInspection) return null;

  if (me.data && !can(me.data, 'inspection.view', { inspection: displayInspection })) {
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

  // Filter sections: In Light mode, show ONLY photo-only sections
  const activeSections = light ? sections.filter((s) => s.photoOnly) : sections;

  const displaySections = activeSections.map((s) => {
    const p = progressBySection.get(s.id) ?? { done: 0, total: 0 };
    const pCount = photosBySection.get(s.id) ?? 0;
    return {
      id: s.id, name: s.name, zone: s.zone, inspectionId: s.inspectionId,
      position: s.position, done: p.done, total: p.total, photoOnly: s.photoOnly, photoCount: pCount,
    };
  });

  // Overall progress (checklist questions)
  const totalDone  = displaySections.reduce((a, s) => a + s.done, 0);
  const totalItems = displaySections.reduce((a, s) => a + s.total, 0);
  const overallPct = totalItems ? Math.round((totalDone / totalItems) * 100) : 0;

  // Photo-mode overall progress
  const donePhotoSecs = displaySections.filter((s) => s.photoCount > 0 || displayInspection.status !== 'in_progress').length;
  const photoPct = displaySections.length ? Math.round((donePhotoSecs / displaySections.length) * 100) : 0;

  const canAddSection = Boolean(me.data && can(me.data, 'inspection.addSection', { inspection: displayInspection }) && isEditable(displayInspection.status));

  async function handleCreatePhotoSection(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim() || !inspectionId) return;
    setIsSaving(true);
    try {
      const sectionId = crypto.randomUUID();
      await localWrite('inspectionSections', sectionId, {
        inspectionId,
        templateSr: null,
        zone: addZone.trim() || 'General',
        name: addName.trim(),
        position: sections.length,
        photoOnly: true,
        isCustom: true,
      });
      setAddName('');
      setShowAddSection(false);
    } catch (err) {
      console.error('Failed to create photo section', err);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      {/* ── Sub-header / appbar ── */}
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => nav('/')}>
          <BackIcon />
        </button>
        <div className="title-wrap">
          <h1>{displayInspection.vesselName || 'Inspection'}</h1>
          <div className="sub">{STATUS_LABELS[displayInspection.status]}</div>
        </div>
      </div>

      <div className="page-wrap" style={{ paddingTop: 20 }}>

        {/* ── Light Mode Top Alert Banner ── */}
        {light && (
          <div className="light-mode-inspection-alert">
            <div className="lmia-content">
              <span className="lmia-icon">
                <CameraIcon width={20} height={20} />
              </span>
              <div>
                <div className="lmia-title">Light Mode Active</div>
                <div className="lmia-desc">Showing Photo sections only. Standard checklist questions are hidden.</div>
              </div>
            </div>
            <button
              type="button"
              className="lmia-btn"
              onClick={() => setLight(false)}
            >
              Show All Sections
            </button>
          </div>
        )}

        {/* ── Premium Progress Card ── */}
        <div className="premium-progress-card">
          <div className="ppc-chart">
            <svg viewBox="0 0 100 100" className="ppc-chart-svg">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#f1f5f9" strokeWidth="8" />
              <circle
                cx="50" cy="50" r="45" fill="none"
                stroke="url(#progress-grad)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray="282.74"
                strokeDashoffset={282.74 - (282.74 * (light ? photoPct : overallPct)) / 100}
                style={{ transition: 'stroke-dashoffset 1s ease-out' }}
              />
              <defs>
                <linearGradient id="progress-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#4ECDC4" />
                  <stop offset="100%" stopColor="#0d9488" />
                </linearGradient>
              </defs>
            </svg>
            <div className="ppc-chart-text">{light ? `${photoPct}%` : `${overallPct}%`}</div>
          </div>
          <div className="ppc-content">
            <h2 className="ppc-title">{light ? 'Photo Section Progress' : 'Inspection Progress'}</h2>
            <p className="ppc-desc">
              {light ? (
                displaySections.length === 0 ? (
                  'No photo sections configured for this inspection.'
                ) : (
                  <>You have completed <b>{donePhotoSecs}</b> out of {displaySections.length} photo section{displaySections.length === 1 ? '' : 's'} with photos.</>
                )
              ) : (
                <>You have answered <b>{totalDone}</b> out of {totalItems} questions.</>
              )}
            </p>
            <div className="ppc-stats">
              <div className="ppc-stat-item">
                <span className="ppc-stat-label">{light ? 'Photo Sections' : 'Sections'}</span>
                <span className="ppc-stat-value">{displaySections.length}</span>
              </div>
              <div className="ppc-divider" />
              <div className="ppc-stat-item">
                <span className="ppc-stat-label">{light ? 'Total Photos' : 'Status'}</span>
                <span
                  className="ppc-stat-value"
                  style={{
                    color: light
                      ? '#0d9488'
                      : (overallPct === 100 ? '#10b981' : '#f59e0b')
                  }}
                >
                  {light
                    ? photos.filter((p) => !p.deletedAt).length
                    : (overallPct === 100 ? 'Completed' : 'In Progress')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Report button ── */}
        {(() => {
          const canSubmit = me.data ? can(me.data, 'inspection.submit', { inspection: displayInspection }) : false;
          if (canSubmit) {
            return (
              <div className="section-pad fab-new">
                <button
                  className="btn btn-primary btn-block"
                  style={{ borderRadius: 12, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  onClick={() => nav(`/inspections/${inspectionId}/report`)}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                  </svg>
                  Submit for Approval
                </button>
              </div>
            );
          }
          return (
            <div className="section-pad fab-new">
              <button
                className="btn btn-outline btn-block"
                style={{ borderRadius: 12, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onClick={() => nav(`/inspections/${inspectionId}/report`)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                {displayInspection.status === 'pending_tm' || displayInspection.status === 'pending_director' ? 'Review Inspection' : 'View Report'}
              </button>
            </div>
          );
        })()}

        {/* ── Section header with label and add button ── */}
        <div style={{
          margin: '8px 16px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 800,
            color: light ? '#0d9488' : '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            {light && <CameraIcon width={14} height={14} />}
            <span>{light ? `Photo Sections (${displaySections.length})` : 'Inspection Sections'}</span>
          </div>

          {canAddSection && (
            <button
              type="button"
              onClick={() => setShowAddSection(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#0d9488',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 6px',
                borderRadius: 6
              }}
            >
              <PlusIcon width={14} height={14} /> Add Photo Section
            </button>
          )}
        </div>

        {/* ── Section cards or Empty State ── */}
        {displaySections.length === 0 ? (
          <div className="empty-photo-sections-card">
            <div className="epsc-icon">
              <CameraIcon width={26} height={26} />
            </div>
            <h3 className="epsc-title">No Photo Sections Found</h3>
            <p className="epsc-desc">
              {light
                ? 'This inspection contains standard checklist question sections only. Switch to Normal Mode to view all checklist sections.'
                : 'No inspection sections have been added yet.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {light && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ borderRadius: 10, padding: '8px 20px', fontSize: 13 }}
                  onClick={() => setLight(false)}
                >
                  Switch to Normal Mode
                </button>
              )}
              {canAddSection && (
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ borderRadius: 10, padding: '8px 20px', fontSize: 13 }}
                  onClick={() => setShowAddSection(true)}
                >
                  + Add Photo Section
                </button>
              )}
            </div>
          </div>
        ) : (
          displaySections.map((s, idx) => {
            const isPhoto = s.photoOnly;
            const pCount = s.photoCount;
            const hasPhotos = pCount > 0;
            const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
            const fillColor = isPhoto
              ? (hasPhotos ? '#10b981' : '#f59e0b')
              : progressColor(pct);
            const zone = zoneColor(s.zone);

            return (
              <div
                key={s.id}
                className="section-card-row"
                onClick={() => nav(`/inspections/${inspectionId}/sections/${s.id}`)}
              >
                {/* Section number or camera badge */}
                <div style={{
                  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                  background: isPhoto ? '#f0fdfa' : fillColor + '15',
                  border: `1.5px solid ${isPhoto ? '#2dd4bf' : fillColor + '40'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 15, color: isPhoto ? '#0d9488' : fillColor,
                }}>
                  {isPhoto ? <CameraIcon width={18} height={18} /> : (s.position ?? idx + 1)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14.5, color: '#0f172a' }}>{s.name}</span>
                    {s.zone && (
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                        background: zone.bg, color: zone.text,
                      }}>
                        {s.zone}
                      </span>
                    )}
                    {isPhoto && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
                        background: '#ccfbf1', color: '#0f766e', letterSpacing: '0.4px',
                      }}>
                        PHOTO SECTION
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  {isPhoto ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: hasPhotos ? '100%' : '0%',
                          background: 'linear-gradient(90deg, #0A828A 0%, #10b981 100%)',
                          borderRadius: 99,
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                      <span style={{
                        fontSize: 12,
                        color: hasPhotos ? '#0d9488' : '#94a3b8',
                        whiteSpace: 'nowrap',
                        minWidth: 64,
                        textAlign: 'right',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        justifyContent: 'flex-end',
                      }}>
                        <CameraIcon width={13} height={13} />
                        {pCount} photo{pCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 5, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: fillColor, borderRadius: 99, transition: 'width 0.3s ease' }} />
                      </div>
                      <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', minWidth: 54, textAlign: 'right', fontWeight: 600 }}>
                        {s.done}/{s.total} · {pct}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Chevron */}
                <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, flexShrink: 0, transition: 'stroke 0.18s' }}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            );
          })
        )}

        <div style={{ height: 24 }} />
      </div>

      {/* ── Add Photo Section Modal ── */}
      {showAddSection && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 16, backdropFilter: 'blur(3px)'
        }}>
          <div style={{
            background: '#ffffff', borderRadius: 16, width: '100%', maxWidth: 440,
            padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.18)', position: 'relative'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 8, background: '#ccfbf1',
                  color: '#0d9488', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <CameraIcon width={18} height={18} />
                </span>
                <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: '#0f172a' }}>Add Photo Section</h2>
              </div>
              <button
                onClick={() => setShowAddSection(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}
              >
                <XIcon width={20} height={20} />
              </button>
            </div>
            <form onSubmit={handleCreatePhotoSection}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                  Zone
                </label>
                <input
                  className="input"
                  value={addZone}
                  onChange={(e) => setAddZone(e.target.value)}
                  placeholder="e.g. Outside, Machinery, Bridge, Cargo"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                  Section Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  className="input"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  required autoFocus
                  placeholder="e.g. Deck Equipment Photos, Cargo Hold Photos"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                />
              </div>
              <div style={{
                padding: '10px 14px', borderRadius: 8, background: '#f0fdfa',
                border: '1px solid #99f6e4', color: '#0f766e', fontSize: 12, marginBottom: 18,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <CameraIcon width={16} height={16} />
                <span>This section holds photo evidence only without standard checklist questions.</span>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowAddSection(false)}
                  style={{ padding: '8px 16px', borderRadius: 8 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSaving}
                  style={{ padding: '8px 18px', borderRadius: 8 }}
                >
                  {isSaving ? 'Saving…' : 'Create Section'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
