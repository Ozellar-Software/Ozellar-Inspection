import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABELS, STATUS_LABELS, type InspectionStatus, type User } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { onSyncStatus, syncNow, type SyncStatus } from '../../offline/sync';
import { useLightMode } from './useLightMode';
import { ShipIcon, PlusIcon, SearchIcon, XIcon, ClipboardIcon } from '../../icons';
import { UserMenu } from '../../app/UserMenu';
import { HomeMenu } from '../../app/HomeMenu';

const CHIP_CLASS: Record<InspectionStatus, string> = {
  in_progress: 'progress', pending_tm: 'appr-wait', pending_director: 'appr-wait', approved: 'complete', returned: 'appr-returned',
};

function fmtDate(d?: string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Home: sync bar, approval notices, Normal/Light switch, New inspection, search, inspection list.
 * Reads inspections from the local DB (works offline); notices come from the API when online.
 */
export function HomePage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [light, setLight] = useLightMode();
  const [sync, setSync] = useState<SyncStatus | null>(null);
  useEffect(() => { const off = onSyncStatus(setSync); return () => { off(); }; }, []);

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });
  const inbox = useQuery({
    queryKey: ['inbox'], enabled: navigator.onLine,
    queryFn: () => api<{ waiting: Array<{ id: string; vesselName: string }>; returned: Array<{ id: string; vesselName: string; returnComment: string }> }>('/approvals/inbox'),
  });

  const inspections = useLiveQuery(() => db.inspections.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const list = useMemo(
    () => inspections.filter((i) => !i.deletedAt && i.vesselName.toLowerCase().includes(q.trim().toLowerCase())),
    [inspections, q]);

  const syncDotClass = sync?.state === 'syncing' ? 'syncing' : sync?.state === 'error' ? 'error' : sync?.lastSyncAt ? 'synced' : '';
  const syncText = sync?.state === 'syncing' ? 'Syncing…'
    : sync?.state === 'offline' ? `Offline — ${sync.pending} change(s) waiting`
    : sync?.state === 'error' ? `Sync problem: ${sync.message}`
    : sync?.lastSyncAt ? 'Synced just now' : 'Not synced yet';

  return (
    <div className="page-wrap">
      <div className="home-header">
        {me.data && <HomeMenu me={me.data} />}
        <ShipIcon className="mark" />
        <div>
          <div className="wordmark">Ozellar</div>
          <div className="tagline">All Right Inspection</div>
        </div>
        {me.data && <UserMenu me={me.data} />}
      </div>

      <div className="sync-bar">
        <span className={`sync-dot ${syncDotClass}`} />
        <span>{syncText}</span>
        <button className="btn btn-outline" style={{ minHeight: 32, padding: '6px 12px' }} onClick={() => void syncNow()}>Sync now</button>
      </div>

      {me.data && me.data.role !== 'admin' && (
        <p className="footer-note" style={{ margin: '0 0 10px' }}>
          Signed in as {ROLE_LABELS[me.data.role]}{me.data.name ? ` · ${me.data.name}` : ''}{me.data.designation ? ` — ${me.data.designation}` : ''}
        </p>
      )}

      {!!inbox.data?.waiting.length && (
        <div className="notice-card">
          <div className="title"><span className="notice-count">{inbox.data.waiting.length}</span> Waiting for your approval</div>
          {inbox.data.waiting.map((w) => (
            <button key={w.id} className="notice-row" onClick={() => nav(`/inspections/${w.id}/report`)}>{w.vesselName}</button>
          ))}
        </div>
      )}
      {!!inbox.data?.returned.length && (
        <div className="notice-card returned">
          <div className="title"><span className="notice-count">{inbox.data.returned.length}</span> Rejected — returned to you for correction</div>
          {inbox.data.returned.map((w) => (
            <button key={w.id} className="notice-row" onClick={() => nav(`/inspections/${w.id}/report`)}>{w.vesselName}: {w.returnComment}</button>
          ))}
        </div>
      )}

      <div className="section-pad" style={{ margin: '0 0 12px' }}>
        <div className="seg" role="group" aria-label="Inspection mode">
          <button type="button" className={!light ? 'selected' : ''} onClick={() => setLight(false)}>Normal mode</button>
          <button type="button" className={light ? 'selected' : ''} onClick={() => setLight(true)}>Light mode</button>
        </div>
        {light && <p className="footer-note" style={{ textAlign: 'left', padding: '6px 2px 0' }}>Light mode is on: inspections show Photo sections only.</p>}
      </div>

      {me.data?.role !== 'director' && (
        <div className="section-pad fab-new">
          <button className="btn btn-primary btn-block" onClick={() => nav('/inspections/new')}><PlusIcon />New inspection</button>
        </div>
      )}

      {list.length > 0 && (
        <div className="search-wrap section-pad">
          <span className="search-icon"><SearchIcon /></span>
          <input type="text" placeholder="Search vessel" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="search-clear" aria-label="Clear search" onClick={() => setQ('')}><XIcon /></button>}
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty-state">
          <ClipboardIcon />
          <p>No inspections yet.<br />{me.data?.role === 'director' ? 'Nothing has been logged yet.' : 'Start your first vessel inspection above.'}</p>
        </div>
      ) : list.map((i) => (
        <div key={i.id} className="inspection-card" onClick={() => nav(`/inspections/${i.id}`)}>
          <div className="body">
            <div className="vname">{i.vesselName || 'Unnamed vessel'}</div>
            <div className="vmeta">{[i.imo && `IMO ${i.imo}`, i.vesselType, fmtDate(i.startDate)].filter(Boolean).join(', ')}</div>
            <span className={`status-chip ${CHIP_CLASS[i.status]}`}>{STATUS_LABELS[i.status]}</span>
          </div>
        </div>
      ))}

      <p className="footer-note">Synced to your account and available on your other devices.</p>
    </div>
  );
}
