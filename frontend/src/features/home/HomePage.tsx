import './HomePage.css';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { STATUS_LABELS, type Inspection, type InspectionStatus, type User } from '@ozellar/shared';
import { api } from '../../api/client';
import { getCachedUser, setCachedUser } from '../../auth/session';
import { useCurrentUser } from '../../auth/useCurrentUser';
import { db } from '../../offline/db';
import { onSyncStatus, syncNow, type SyncStatus } from '../../offline/sync';
import { useLightMode } from './useLightMode';
import { PlusIcon, SearchIcon, XIcon, CameraIcon, MenuIcon, CheckIcon, WifiIcon, WarningIcon, TrashIcon } from '../../icons';
import { DeleteInspectionModal } from '../inspections/DeleteInspectionModal';

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
  const [inspectionToDelete, setInspectionToDelete] = useState<Inspection | null>(null);
  useEffect(() => { const off = onSyncStatus(setSync); return () => { off(); }; }, []);

  const me = useCurrentUser();
  const isAdmin = me.data?.role === 'admin';
  const inbox = useQuery({
    queryKey: ['inbox', me.data?.id, me.data?.role],
    queryFn: async () => {
      if (navigator.onLine) {
        try {
          return await api<{ waiting: Array<{ id: string; vesselName: string }>; returned: Array<{ id: string; vesselName: string; returnComment: string }> }>('/approvals/inbox');
        } catch {
          // offline fallback below
        }
      }
      const [allInsp, allAppr] = await Promise.all([
        db.inspections.toArray(),
        db.approvals.toArray(),
      ]);
      const activeInsp = allInsp.filter((i) => !i.deletedAt);
      const apprMap = new Map(allAppr.map((a) => [a.id || (a as any).inspectionId, a]));
      const waiting: Array<{ id: string; vesselName: string }> = [];
      const returned: Array<{ id: string; vesselName: string; returnComment: string }> = [];
      const user = me.data;
      if (!user) return { waiting, returned };

      for (const i of activeInsp) {
        const a = apprMap.get(i.id);
        if (i.status === 'pending_tm') {
          if (user.role === 'admin' || (user.role === 'techManager' && (!a?.tmUserId || a.tmUserId === user.id))) {
            waiting.push({ id: i.id, vesselName: i.vesselName });
          }
        } else if (i.status === 'pending_director') {
          if (user.role === 'admin' || (user.role === 'director' && (!a?.directorUserId || a.directorUserId === user.id))) {
            waiting.push({ id: i.id, vesselName: i.vesselName });
          }
        } else if (i.status === 'returned') {
          if (user.role === 'admin' || a?.submittedBy === user.id || user.role === 'vesselManager') {
            returned.push({ id: i.id, vesselName: i.vesselName, returnComment: a?.returnComment || '' });
          }
        }
      }
      return { waiting, returned };
    },
    refetchInterval: navigator.onLine ? 30000 : false,
  });

  const inspections = useLiveQuery(
    () => db.inspections.orderBy('updatedAt').reverse().toArray(),
    []
  );

  const isLoading = inspections === undefined;

  // Auto-sync if local database is empty on load and device is online
  useEffect(() => {
    if (inspections && inspections.length === 0 && navigator.onLine) {
      void syncNow();
    }
  }, [inspections]);

  // TM and VM should only see inspections for their assigned vessels
  const visibleInspections = useMemo(() => {
    const inspList = inspections ?? [];
    const role = me.data?.role;
    if (role === 'admin' || role === 'director' || !me.data) return inspList;
    const vesselIds = (me.data.vesselIds ?? []).map((id) => id.toLowerCase().trim());
    if (vesselIds.length === 0) return inspList;
    return inspList.filter((i) => i.vesselId && vesselIds.includes(i.vesselId.toLowerCase().trim()));
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
            const accentClass = CARD_ACCENT[status] ?? '';
            return (
              <div
                key={i.id}
                id={`vessel-row-${i.id}`}
                className={`vessel-row ${accentClass}`}
                onClick={() => {
                  sessionStorage.setItem('oz_last_home_item', `vessel-row-${i.id}`);
                  nav(`/inspections/${i.id}`);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    sessionStorage.setItem('oz_last_home_item', `vessel-row-${i.id}`);
                    nav(`/inspections/${i.id}`);
                  }
                }}
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

                {/* Status */}
                <div className="vessel-row-status">
                  <span className={`status-chip ${CHIP_CLASS[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      className="vessel-row-delete-btn"
                      title="Delete Inspection (Admin only)"
                      aria-label="Delete Inspection"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInspectionToDelete(i as any);
                      }}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  )}
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

      {isAdmin && (
        <DeleteInspectionModal
          inspection={inspectionToDelete}
          isOpen={Boolean(inspectionToDelete)}
          onClose={() => setInspectionToDelete(null)}
          onDeleted={() => {
            setInspectionToDelete(null);
          }}
        />
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
