import './HomePage.css';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { STATUS_LABELS, type InspectionStatus, type User } from '@ozellar/shared';
import { api } from '../../api/client';
import { getCachedUser, setCachedUser } from '../../auth/session';
import { db } from '../../offline/db';
import { onSyncStatus, syncNow, type SyncStatus } from '../../offline/sync';
import { useLightMode } from './useLightMode';
import { PlusIcon, SearchIcon, XIcon, CameraIcon, MenuIcon, CheckIcon, WifiIcon, WarningIcon } from '../../icons';

// ---------------------------------------------------------------------------
export function HomePage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [vesselFilter, setVesselFilter] = useState('all');
  const [vesselFilterOpen, setVesselFilterOpen] = useState(false);
  const [light, setLight] = useLightMode();
  const [sync, setSync] = useState<SyncStatus | null>(null);
  useEffect(() => { const off = onSyncStatus(setSync); return () => { off(); }; }, []);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const user = await api<User>('/me');
      setCachedUser(user);
      return user;
    },
    initialData: getCachedUser() ?? undefined,
  });
  const inbox = useQuery({
    queryKey: ['inbox'], enabled: navigator.onLine,
    queryFn: () => api<{ waiting: Array<{ id: string; vesselName: string }>; returned: Array<{ id: string; vesselName: string; returnComment: string }> }>('/approvals/inbox'),
  });

  const homeData = useLiveQuery(async () => {
    const [inspections, allSections, allQuestions, allResponses, allPhotos] = await Promise.all([
      db.inspections.orderBy('updatedAt').reverse().toArray(),
      db.inspectionSections.toArray(),
      db.inspectionQuestions.toArray(),
      db.responses.toArray(),
      db.photos.toArray(),
    ]);
    return { inspections, allSections, allQuestions, allResponses, allPhotos };
  }, []);

  const isLoading = homeData === undefined;
  const inspections = homeData?.inspections ?? [];
  const allSections = homeData?.allSections ?? [];
  const allQuestions = homeData?.allQuestions ?? [];
  const allResponses = homeData?.allResponses ?? [];
  const allPhotos = homeData?.allPhotos ?? [];

  // Auto-sync if local database is empty on load and device is online
  useEffect(() => {
    if (homeData && homeData.inspections.length === 0 && navigator.onLine) {
      void syncNow();
    }
  }, [homeData]);

  // TM and VM should only see inspections for their assigned vessels
  const visibleInspections = useMemo(() => {
    const role = me.data?.role;
    if (role === 'admin' || role === 'director' || !me.data) return inspections;
    const vesselIds = (me.data.vesselIds ?? []).map((id) => id.toLowerCase().trim());
    return inspections.filter((i) => i.vesselId && vesselIds.includes(i.vesselId.toLowerCase().trim()));
  }, [inspections, me.data]);

  const uniqueVessels = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names = visibleInspections.filter((i: any) => !i.deletedAt).map((i: any) => i.vesselName);
    return Array.from(new Set(names)).sort();
  }, [visibleInspections]);

  const list = useMemo(
    () => visibleInspections.filter((i) => {
      if (i.deletedAt) return false;
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      if (vesselFilter !== 'all' && i.vesselName !== vesselFilter) return false;
      return i.vesselName.toLowerCase().includes(q.trim().toLowerCase());
    }),
    [visibleInspections, q, statusFilter, vesselFilter]);

  const inspectionProgress = useMemo(() => {
    // 1. Group questions by inspectionSectionId
    const questionsBySection = new Map<string, typeof allQuestions>();
    for (const q of allQuestions) {
      if (q.deletedAt) continue;
      const arr = questionsBySection.get(q.inspectionSectionId);
      if (arr) arr.push(q);
      else questionsBySection.set(q.inspectionSectionId, [q]);
    }

    // 2. Index evaluated responses: `${inspectionId}:${inspectionQuestionId}`
    const evaluatedResponses = new Set<string>();
    for (const r of allResponses) {
      if (r.deletedAt) continue;
      if (r.answer != null || r.applicable === false) {
        evaluatedResponses.add(`${r.inspectionId}:${r.inspectionQuestionId}`);
      }
    }

    // 3. Group sections by inspectionId
    const sectionsByInspection = new Map<string, typeof allSections>();
    for (const s of allSections) {
      if (s.deletedAt) continue;
      const arr = sectionsByInspection.get(s.inspectionId);
      if (arr) arr.push(s);
      else sectionsByInspection.set(s.inspectionId, [s]);
    }

    // 4. Calculate progress for each visible inspection
    const map = new Map<string, { doneSections: number; totalSections: number; pct: number }>();

    for (const insp of visibleInspections) {
      const isCompleteStatus =
        insp.status === 'pending_tm' ||
        insp.status === 'pending_director' ||
        insp.status === 'approved';

      const secs = sectionsByInspection.get(insp.id) ?? [];
      const totalSections = secs.length > 0 ? secs.length : 5;

      if (isCompleteStatus) {
        map.set(insp.id, {
          doneSections: totalSections,
          totalSections,
          pct: 100,
        });
        continue;
      }

      let doneSections = 0;
      let totalQuestions = 0;
      let answeredQuestions = 0;

      for (const s of secs) {
        const qs = questionsBySection.get(s.id) ?? [];
        if (qs.length === 0) {
          doneSections++;
          continue;
        }

        let sectionAnswered = 0;
        for (const q of qs) {
          totalQuestions++;
          if (evaluatedResponses.has(`${insp.id}:${q.id}`)) {
            sectionAnswered++;
            answeredQuestions++;
          }
        }

        if (sectionAnswered === qs.length) {
          doneSections++;
        }
      }

      let pct = 0;
      if (totalQuestions > 0) {
        pct = Math.round((answeredQuestions / totalQuestions) * 100);
      } else if (secs.length > 0) {
        pct = Math.round((doneSections / secs.length) * 100);
      }

      if (secs.length > 0 && doneSections === secs.length) {
        pct = 100;
      }

      map.set(insp.id, {
        doneSections,
        totalSections,
        pct,
      });
    }

    return map;
  }, [allSections, allQuestions, allResponses, visibleInspections]);

  const photoProgress = useMemo(() => {
    const photosBySection = new Map<string, number>();
    const photosByInspection = new Map<string, number>();

    for (const p of allPhotos) {
      if (p.deletedAt) continue;
      if (p.inspectionId) {
        photosByInspection.set(p.inspectionId, (photosByInspection.get(p.inspectionId) ?? 0) + 1);
      }
      if (p.inspectionSectionId) {
        photosBySection.set(p.inspectionSectionId, (photosBySection.get(p.inspectionSectionId) ?? 0) + 1);
      }
    }

    const map = new Map<string, { donePhotoSections: number; totalPhotoSections: number; totalPhotos: number; pct: number }>();

    for (const insp of visibleInspections) {
      const isApprovedOrSubmitted =
        insp.status === 'pending_tm' ||
        insp.status === 'pending_director' ||
        insp.status === 'approved';

      const photoSecs = allSections.filter((s) => s.inspectionId === insp.id && s.photoOnly && !s.deletedAt);
      const totalPhotos = photosByInspection.get(insp.id) ?? 0;
      const totalPhotoSections = photoSecs.length;

      let donePhotoSections = 0;
      for (const ps of photoSecs) {
        const count = photosBySection.get(ps.id) ?? 0;
        if (count > 0 || isApprovedOrSubmitted) {
          donePhotoSections++;
        }
      }

      const pct = totalPhotoSections > 0 ? Math.round((donePhotoSections / totalPhotoSections) * 100) : 0;

      map.set(insp.id, {
        donePhotoSections,
        totalPhotoSections,
        totalPhotos,
        pct,
      });
    }

    return map;
  }, [allPhotos, allSections, visibleInspections]);

  const syncText = sync?.state === 'syncing' ? 'Syncing…'
    : sync?.state === 'offline' ? `Offline — ${sync.pending} change(s) waiting`
    : sync?.state === 'error' ? `Sync problem: ${sync.message}`
    : sync?.lastSyncAt ? 'Synced just now' : 'Not synced yet';

  // Only roles that can create inspections: admin, techManager, vesselManager
  const canCreateInspection = me.data?.role === 'admin'
    || me.data?.role === 'techManager'
    || me.data?.role === 'vesselManager';

  return (
    <div className="page-wrap home-dashboard">
      
      {/* ── PREMIUM PAGE HEADER ── */}
      <div className="premium-page-header">
        
        <div className="header-titles">
          <h1 className="page-title">Fleet Inspections</h1>
          <p className="page-subtitle">Manage, track, and sync your vessel reports</p>
        </div>
        <div className="header-actions">
          
          {/* ── High-Priority Sync Widget ── */}
          <div className={`sync-widget ${sync?.state || 'synced'}`}>
            <div className="sync-widget-left">
              <div className="sync-widget-icon-wrap">
                <span className="sync-widget-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {sync?.state === 'syncing' ? (
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67"/>
                    </svg>
                  ) : sync?.state === 'error' ? (
                    <WarningIcon width={16} height={16} />
                  ) : sync?.state === 'offline' ? (
                    <WifiIcon width={16} height={16} />
                  ) : (
                    <CheckIcon width={16} height={16} />
                  )}
                </span>
              </div>
              <div className="sync-widget-info">
                <span className="sync-widget-title">
                  {sync?.state === 'syncing' ? 'Sync in progress' : sync?.state === 'offline' ? 'Offline Mode' : sync?.state === 'error' ? 'Sync Error' : 'All systems synced'}
                </span>
                <span className="sync-widget-sub">{syncText}</span>
              </div>
            </div>
            <button className="sync-widget-btn" onClick={() => void syncNow()}>
              Sync Now
            </button>
          </div>

        </div>
      </div>

      {/* ── CONTROLS ROW ── */}
      <div className="controls-bar">
        {/* Mode Toggle */}
        <div className="premium-mode-seg">
          <div className="mode-seg" role="group" aria-label="Inspection mode">
            <button type="button" className={!light ? 'selected' : ''} onClick={() => setLight(false)}>
              <span className="mode-seg-icon"><MenuIcon /></span> Normal
            </button>
            <button type="button" className={light ? 'selected' : ''} onClick={() => setLight(true)}>
              <span className="mode-seg-icon"><CameraIcon /></span> Light
            </button>
          </div>
        </div>

        <div className="ctrl-divider" />

        {/* Search */}
        <div className="search-wrap premium-search">
          <span className="search-icon"><SearchIcon /></span>
          <input
            type="text"
            placeholder="Search vessel or IMO…"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="search-clear" aria-label="Clear search" onClick={() => setQ('')}>
              <XIcon />
            </button>
          )}
        </div>

        <div className="ctrl-divider" />

        <div className="filters-row">
          {/* Vessel Filter */}
          <div className="premium-filter-wrap">
            <button
              className={`premium-dropdown-trigger ${vesselFilterOpen ? 'open' : ''}`}
              onClick={() => { setVesselFilterOpen(!vesselFilterOpen); setFilterOpen(false); }}
            >
              <span className="dropdown-val">{vesselFilter === 'all' ? 'All Vessels' : vesselFilter}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            {vesselFilterOpen && (
              <>
                <div className="dropdown-overlay" onClick={() => setVesselFilterOpen(false)}></div>
                <div className="premium-dropdown-menu">
                  <button className={`dropdown-item ${vesselFilter === 'all' ? 'active' : ''}`} onClick={() => { setVesselFilter('all'); setVesselFilterOpen(false); }}>All Vessels</button>
                  {uniqueVessels.map(vname => (
                    <button key={vname} className={`dropdown-item ${vesselFilter === vname ? 'active' : ''}`} onClick={() => { setVesselFilter(vname); setVesselFilterOpen(false); }}>{vname}</button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Status Filter */}
          <div className="premium-filter-wrap">
            <button
              className={`premium-dropdown-trigger ${filterOpen ? 'open' : ''}`}
              onClick={() => { setFilterOpen(!filterOpen); setVesselFilterOpen(false); }}
            >
              <span className="dropdown-val">
                {statusFilter === 'all' ? 'All Status' : statusFilter === 'in_progress' ? 'In Progress' : statusFilter === 'pending_tm' ? 'Pending TM' : statusFilter === 'pending_director' ? 'Pending Director' : statusFilter === 'approved' ? 'Approved' : statusFilter === 'returned' ? 'Returned' : 'All Status'}
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            {filterOpen && (
              <>
                <div className="dropdown-overlay" onClick={() => setFilterOpen(false)}></div>
                <div className="premium-dropdown-menu">
                  {[
                    { val: 'all', label: 'All Status' },
                    { val: 'in_progress', label: 'In Progress' },
                    { val: 'pending_tm', label: 'Pending TM' },
                    { val: 'pending_director', label: 'Pending Director' },
                    { val: 'approved', label: 'Approved' },
                    { val: 'returned', label: 'Returned' },
                  ].map(opt => (
                    <button key={opt.val} className={`dropdown-item ${statusFilter === opt.val ? 'active' : ''}`} onClick={() => { setStatusFilter(opt.val); setFilterOpen(false); }}>{opt.label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* New Inspection — only for roles that can create */}
        {canCreateInspection && (
          <button className="premium-new-btn premium-btn-dark" onClick={() => nav('/inspections/new')}>
            <span className="btn-icon"><PlusIcon width={16} height={16} /></span>
            <span className="btn-text">New Inspection</span>
          </button>
        )}
      </div>

      {light && (
        <div style={{
          margin: '0 0 16px',
          padding: '12px 18px',
          borderRadius: 12,
          background: '#f0fdfa',
          border: '1.5px solid #2dd4bf',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          boxShadow: '0 2px 8px rgba(13,148,136,0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 8,
              background: '#ccfbf1', color: '#0d9488',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
              <CameraIcon width={18} height={18} />
            </span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: '#0f766e' }}>Light Mode Active</div>
              <div style={{ fontSize: 12, color: '#115e59' }}>Showing Photo Sections only. Checklist questions are hidden.</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLight(false)}
            style={{
              padding: '6px 14px', borderRadius: 8, border: '1px solid #0d9488',
              background: '#ffffff', color: '#0d9488', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease'
            }}
          >
            Switch to Normal Mode
          </button>
        </div>
      )}

      {/* ── APPROVAL NOTICES ── */}
      <div className="notices-container">
        {!!inbox.data?.waiting.length && (
          <div className="notice-card premium-notice">
            <div className="title"><span className="notice-count">{inbox.data.waiting.length}</span> Waiting for your approval</div>
            {inbox.data.waiting.map((w) => (
              <button key={w.id} className="notice-row" onClick={() => nav(`/inspections/${w.id}/report`)}>{w.vesselName}</button>
            ))}
          </div>
        )}
        {!!inbox.data?.returned.length && (
          <div className="notice-card returned premium-notice">
            <div className="title"><span className="notice-count">{inbox.data.returned.length}</span> Rejected — returned to you</div>
            {inbox.data.returned.map((w) => (
              <button key={w.id} className="notice-row" onClick={() => nav(`/inspections/${w.id}/report`)}>{w.vesselName}: {w.returnComment}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── INSPECTION CARDS ── */}
      {isLoading ? (
        <div className="inspection-skeleton-list">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="inspection-skeleton-card">
              <div className="skeleton-bar-left" />
              <div className="skeleton-content">
                <div className="skeleton-line skeleton-title" />
                <div className="skeleton-line skeleton-sub" />
              </div>
              <div className="skeleton-progress" />
              <div className="skeleton-badge" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="empty-ship-svg">
            <rect x="12" y="36" width="40" height="12" rx="3" fill="currentColor" opacity=".15"/>
            <path d="M20 36V24h24v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M28 24V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M28 16h8l4 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 48c4 4 12 4 16 0s12-4 16 0 8 0 12 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <p className="empty-title">No inspections yet</p>
          <p className="empty-sub">
            {me.data?.role === 'director'
              ? 'Nothing has been submitted for approval yet.'
              : me.data?.role === 'techManager' || me.data?.role === 'vesselManager'
              ? 'No inspections for your assigned vessels yet.'
              : 'Start your first vessel inspection.'}
          </p>
        </div>
      ) : (
        <div className="inspection-list-body">
          {list.map((i) => {
            const status = i.status as InspectionStatus;
            const prog = inspectionProgress.get(i.id) ?? { doneSections: 0, totalSections: 5, pct: 0 };
            const pProg = photoProgress.get(i.id) ?? { donePhotoSections: 0, totalPhotoSections: 0, totalPhotos: 0, pct: 0 };
            const pct = prog.pct;
            const accentClass = CARD_ACCENT[status] ?? '';
            return (
              <div
                key={i.id}
                className={`vessel-row ${accentClass}`}
                onClick={() => nav(`/inspections/${i.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') nav(`/inspections/${i.id}`); }}
              >
                {/* Left accent bar */}
                <div className="vessel-row-accent" />

                {/* Vessel info */}
                <div className="vessel-row-info">
                  <div className="vessel-row-name-line">
                    <span className="vname">{i.vesselName || 'Unnamed vessel'}</span>
                    {i.imo && <span className="imo-pill">IMO {i.imo}</span>}
                  </div>
                  <div className="vessel-row-meta">
                    <span className="vmeta-item">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 3.2-1.5 5.5-1.5 2.3 0 3 1.5 5.5 1.5 1.3 0 1.9-.5 2.5-1"></path><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"></path><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"></path><path d="M12 10v4"></path><path d="M12 2v3"></path></svg>
                      {i.vesselType || 'Vessel'}
                    </span>
                    <span className="meta-dot">·</span>
                    <span className="vmeta-item">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                      {fmtDate(i.startDate)}
                    </span>
                  </div>
                </div>

                {/* Progress */}
                {light ? (
                  <div className="vessel-row-progress">
                    <div className="vessel-progress-top">
                      <span className="vessel-progress-pct" style={{ color: pProg.totalPhotoSections > 0 ? '#0d9488' : '#64748b', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CameraIcon width={15} height={15} />
                        {pProg.totalPhotoSections > 0 ? `${pProg.pct}%` : '0%'}
                      </span>
                      <span className="vessel-progress-label">
                        {pProg.totalPhotoSections > 0
                          ? `${pProg.donePhotoSections}/${pProg.totalPhotoSections} photo sections`
                          : (pProg.totalPhotos > 0 ? `${pProg.totalPhotos} photo(s)` : '0 photo sections')}
                      </span>
                    </div>
                    <div className="vessel-progress-track" style={{ background: '#e6f4f5' }}>
                      <div
                        className="vessel-progress-fill"
                        style={{
                          width: `${pProg.totalPhotoSections > 0 ? pProg.pct : 0}%`,
                          background: 'linear-gradient(90deg, #0A828A 0%, #10b981 100%)',
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="vessel-row-progress">
                    <div className="vessel-progress-top">
                      <span className="vessel-progress-pct">{pct}%</span>
                      <span className="vessel-progress-label">{prog.doneSections}/{prog.totalSections} sections</span>
                    </div>
                    <div className="vessel-progress-track">
                      <div className="vessel-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}

                {/* Status */}
                <div className="vessel-row-status">
                  <span className={`status-chip ${CHIP_CLASS[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>

                {/* Arrow */}
                <div className="vessel-row-arrow">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

const CARD_ACCENT: Record<InspectionStatus, string> = {
  in_progress: 'accent-warn',
  pending_tm: 'accent-info',
  pending_director: 'accent-info',
  returned: 'accent-bad',
  approved: 'accent-ok'
};

const CHIP_CLASS: Record<InspectionStatus, string> = {
  in_progress: 'progress',
  pending_tm: 'appr-wait',
  pending_director: 'appr-wait',
  returned: 'appr-returned',
  approved: 'complete'
};

function fmtDate(ms?: number | string | null) {
  if (!ms) return 'Unknown date';
  const d = typeof ms === 'string' ? new Date(ms) : new Date(ms);
  if (isNaN(d.getTime())) return String(ms);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
