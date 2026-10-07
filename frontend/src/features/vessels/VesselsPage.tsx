import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQuery } from '@tanstack/react-query';
import type { User, Vessel, VesselParticularKey } from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import { localWrite, localDelete } from '../../offline/outbox';
import './VesselsPage.css';
import {
  PlusIcon, SearchIcon, XIcon, EditIcon, CheckIcon, BackIcon,
  ShipIcon, CompassIcon, FlagIcon, CalendarIcon, AnchorIcon,
  TrashIcon, CheckCircleIcon, ChevronDownIcon, RulerIcon, GaugeIcon,
  AlertCircleIcon, UsersIcon, ChevronLeftIcon, ChevronRightIcon
} from '../../icons';
import { PARTICULAR_GROUPS, PARTICULAR_LABELS } from './particulars';

type ParticularsForm = Partial<Record<VesselParticularKey, string>>;

interface VesselForm {
  id?: string;
  name: string;
  imo: string;
  vesselType: string;
  particulars: ParticularsForm;
}

const blankVessel: VesselForm = {
  name: '',
  imo: '',
  vesselType: 'Bulk Carrier',
  particulars: {},
};

const COMMON_VESSEL_TYPES = [
  'Bulk Carrier',
  'Container Ship',
  'Oil Tanker',
  'Chemical Tanker',
  'Gas Carrier',
  'General Cargo',
  'Tug / Offshore'
];

const COMMON_VESSEL_TYPES_DATA = [
  { name: 'Bulk Carrier', key: 'bulk', color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' },
  { name: 'Container Ship', key: 'container', color: '#4F46E5', bg: '#EEF2FF', border: '#C7D2FE' },
  { name: 'Oil Tanker', key: 'tanker', color: '#E11D48', bg: '#FFF1F2', border: '#FECDD3' },
  { name: 'Chemical Tanker', key: 'tanker', color: '#E11D48', bg: '#FFF1F2', border: '#FECDD3' },
  { name: 'Gas Carrier', key: 'gas', color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  { name: 'General Cargo', key: 'general', color: '#0E7C86', bg: '#F0FDFA', border: '#99F6E4' },
  { name: 'Tug / Offshore', key: 'general', color: '#0E7C86', bg: '#F0FDFA', border: '#99F6E4' },
];

const MODAL_TABS = [
  { id: 0, title: 'Core Profile', subtitle: 'Identification & Category' },
  { id: 1, title: 'Registration & Flag', subtitle: 'Port, Flag & Registry' },
  { id: 2, title: 'Class & Tonnage', subtitle: 'Society, DWT & Net Tonnage' },
  { id: 3, title: 'Dimensions & Draft', subtitle: 'LOA, Beam & Summer Draft' },
  { id: 4, title: 'Machinery & Power', subtitle: 'Main Engine & Propulsion' },
  { id: 5, title: 'Management & Comms', subtitle: 'Owner, Operator & Comms' },
];

const PARTICULAR_HINTS: Partial<Record<VesselParticularKey, string>> = {
  flag: 'e.g. Marshall Islands, Panama, Singapore, Liberia',
  portOfRegistry: 'e.g. Majuro, Panama City, Singapore, Monrovia',
  callSign: 'e.g. V7AB8, 3EPR9, 9V812',
  officialNo: 'e.g. 72910, 81920',
  yearBuilt: 'e.g. 2021',
  placeOfBuild: 'e.g. Imabari, Japan; Geoje, South Korea',
  classSociety: 'e.g. DNV, Lloyd\'s Register, ABS, Bureau Veritas',
  classNotation: 'e.g. 1A1 Bulk Carrier ESP, +100A1 Container',
  grossTonnage: 'Gross registered tonnage in MT (e.g. 43500)',
  netTonnage: 'Net registered tonnage in MT (e.g. 24200)',
  deadweight: 'Deadweight carrying capacity in MT (e.g. 82000)',
  loa: 'Length overall in meters (e.g. 229.0 m)',
  breadth: 'Moulded beam / breadth in meters (e.g. 32.26 m)',
  depth: 'Moulded depth in meters (e.g. 20.05 m)',
  summerDraft: 'Summer load line draft in meters (e.g. 14.5 m)',
  mainEngine: 'e.g. MAN B&W 6S60ME-C8.2, WinGD 6X72',
  mainEngineMakerModel: 'Engine maker & licensing model series',
  mainEnginePower: 'MCR continuous power (e.g. 9,600 kW @ 89 RPM)',
  propulsion: 'e.g. Single fixed pitch propeller, Dual azimuth',
  owner: 'Registered shipowner holding entity',
  managerOperator: 'Technical ship management company / ISM operator',
  email: 'Official shipboard email address',
  satellitePhone: 'Inmarsat / Sat phone (e.g. +870 773 241 890)',
};



function getVesselTypeTheme(type?: string): { key: string; avatarClass: string; tagClass: string } {
  const t = (type || '').toLowerCase();
  if (t.includes('bulk')) {
    return { key: 'bulk', avatarClass: 'avatar-amber', tagClass: 'tag-amber' };
  }
  if (t.includes('container')) {
    return { key: 'container', avatarClass: 'avatar-indigo', tagClass: 'tag-indigo' };
  }
  if (t.includes('tanker') || t.includes('oil') || t.includes('chem')) {
    return { key: 'tanker', avatarClass: 'avatar-rose', tagClass: 'tag-rose' };
  }
  if (t.includes('gas') || t.includes('lng') || t.includes('lpg')) {
    return { key: 'gas', avatarClass: 'avatar-emerald', tagClass: 'tag-emerald' };
  }
  return { key: 'general', avatarClass: 'avatar-teal', tagClass: 'tag-teal' };
}

export function VesselsPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });
  const rawVessels = useLiveQuery(() => db.vessels.orderBy('name').toArray(), []) ?? [];
  const canManageVessels = me.data?.role === 'admin';

  // Filter out any soft-deleted vessels, then restrict to assigned vessels for TM/VM
  const vessels = useMemo(() => {
    const active = rawVessels.filter(v => !(v as any).deletedAt);
    if (me.data?.role === 'techManager' || me.data?.role === 'vesselManager') {
      const ids = me.data.vesselIds ?? [];
      return active.filter(v => ids.includes(v.id));
    }
    return active;
  }, [rawVessels, me.data]);



  // Sync with remote backend vessels if connected
  useQuery({
    queryKey: ['remote-vessels'],
    queryFn: async () => {
      try {
        const remote = await api<Vessel[]>('/vessels');
        if (Array.isArray(remote) && remote.length > 0) {
          await db.vessels.bulkPut(remote as any);
        }
        return remote;
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string | 'all'>('all');
  const [expandedVessels, setExpandedVessels] = useState<Record<string, boolean>>({});

  // Navigation
  const navigate = useNavigate();

  // Modal State for Delete Confirmation
  const [vesselToDelete, setVesselToDelete] = useState<Vessel | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Vessel types available across fleet
  const fleetTypes = useMemo(() => {
    return Array.from(new Set(vessels.map(v => v.vesselType).filter(Boolean))) as string[];
  }, [vessels]);

  // Filtered vessels
  const filteredVessels = useMemo(() => {
    return vessels.filter(v => {
      const q = searchQuery.toLowerCase().trim();
      const flag = (v.particulars as Record<string, string>)?.flag?.toLowerCase() || '';
      const port = (v.particulars as Record<string, string>)?.portOfRegistry?.toLowerCase() || '';
      const cls = (v.particulars as Record<string, string>)?.classSociety?.toLowerCase() || '';

      const matchSearch = !q || (
        (v.name || '').toLowerCase().includes(q) ||
        (v.imo || '').toLowerCase().includes(q) ||
        (v.vesselType || '').toLowerCase().includes(q) ||
        flag.includes(q) ||
        port.includes(q) ||
        cls.includes(q)
      );

      const matchType = filterType === 'all' || v.vesselType === filterType;

      return matchSearch && matchType;
    });
  }, [vessels, searchQuery, filterType]);

  function toggleExpanded(id: string) {
    setExpandedVessels(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function startNewVessel() {
    navigate('/vessels/new');
  }

  function startEditVessel(v: Vessel) {
    navigate(`/vessels/${v.id}/edit`);
  }

  async function onConfirmDelete() {
    if (!vesselToDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);

    try {
      // 1. Delete from local database and sync outbox
      await localDelete('vessels', vesselToDelete.id);
      await db.vessels.delete(vesselToDelete.id);

      // 2. Send DELETE to backend
      await api(`/vessels/${vesselToDelete.id}`, { method: 'DELETE' }).catch(() => {});

      setVesselToDelete(null);
    } catch (err) {
      if (err instanceof ApiError) setDeleteError(err.message);
      else setDeleteError('Failed to delete vessel.');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="vessel-page-wrap">
      {/* ─── Top Header: Page Name & Actions ────────────────────────────── */}
      <header className="vessels-page-header">
        <div className="vessels-title-group" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="back-btn-premium" aria-label="Back" onClick={() => navigate('/')}>
            <BackIcon />
          </button>
          <div className="vessels-title-row">
            <h1 className="vessels-page-title">Vessels</h1>
            <span className="vessels-count-pill">{vessels.length} Fleet Ships</span>
          </div>
        </div>

        {canManageVessels && (
          <div className="vessels-header-actions">
            <button className="vessel-primary-btn" onClick={startNewVessel}>
              <PlusIcon width={16} height={16} />
              <span className="vessel-register-text-full">Register Vessel</span>
              <span className="vessel-register-text-short">Register</span>
            </button>
          </div>
        )}
      </header>

      {/* ─── Control Panel: Search & Class Filters in Same Row ─────────── */}
      <div className="vessels-control-panel">
        <div className="vessels-toolbar-row">
          <div className="vessels-search-box">
            <span className="vessels-search-icon"><SearchIcon width={16} height={16} /></span>
            <input
              className="vessel-search-input"
              placeholder="Search fleet vessels, IMO, flag..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="vessel-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <XIcon width={14} height={14} />
              </button>
            )}
          </div>

          {/* Filter Chips in the SAME row */}
          <div className="vessels-filter-row">
            <button
              className={`vessel-filter-btn ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              All Ships <span className="vessel-filter-count">{vessels.length}</span>
            </button>
            {fleetTypes.map(t => {
              const count = vessels.filter(v => v.vesselType === t).length;
              return (
                <button
                  key={t}
                  className={`vessel-filter-btn ${filterType === t ? 'active' : ''}`}
                  onClick={() => setFilterType(t)}
                >
                  {t} <span className="vessel-filter-count">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Results Header Count */}
      <div className="vessels-results-count">
        <span>Showing {filteredVessels.length} of {vessels.length} Fleet Vessels</span>
      </div>

      {/* Empty State */}
      {filteredVessels.length === 0 && (
        <div className="vessel-empty-state">
          <div className="vessel-empty-icon">
            <ShipIcon width={48} height={48} />
          </div>
          <h3 className="vessel-empty-title">No Fleet Vessels Found</h3>
          <p className="vessel-empty-desc">
            No vessels match the specified search query or active filter class.
          </p>
          {(searchQuery || filterType !== 'all') && (
            <button
              className="vessel-reset-btn"
              onClick={() => { setSearchQuery(''); setFilterType('all'); }}
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* ─── Compact Vessel Rows with Accordion Toggle for Full Details ───── */}
      <div className="vessel-list-container">
        {filteredVessels.map(v => {
          const filledCount = Object.values(v.particulars ?? {}).filter(Boolean).length;
          const flag = (v.particulars as Record<string, string>)?.flag;
          const yearBuilt = (v.particulars as Record<string, string>)?.yearBuilt;
          const cls = (v.particulars as Record<string, string>)?.classSociety;
          const dwt = (v.particulars as Record<string, string>)?.deadweight;
          const port = (v.particulars as Record<string, string>)?.portOfRegistry;
          const isExpanded = !!expandedVessels[v.id];
          const theme = getVesselTypeTheme(v.vesselType);

          return (
            <div key={v.id} className={`vessel-row-card vessel-type-${theme.key} ${isExpanded ? 'expanded' : ''}`}>
              {/* ── Compact Header Row: Always Visible ── */}
              <div
                className="vessel-row-header"
                onClick={() => toggleExpanded(v.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleExpanded(v.id); }}
                aria-expanded={isExpanded}
              >
                {/* Left Side: Ship Avatar & Clean Vessel Identifiers */}
                <div className="vessel-row-main">
                  <div className={`vessel-row-avatar ${theme.avatarClass}`}>
                    <ShipIcon width={22} height={22} />
                  </div>

                  <div className="vessel-row-info">
                    <div className="vessel-title-main">
                      <span className="vessel-name-text">{v.name}</span>
                      {v.vesselType && <span className={`vessel-type-chip ${theme.tagClass}`}>{v.vesselType}</span>}
                    </div>

                    <div className="vessel-subline">
                      {v.imo && <span className="vessel-sub-item">IMO {v.imo}</span>}
                      {v.imo && flag && <span className="vessel-sub-sep">•</span>}
                      {flag && (
                        <span className="vessel-sub-item">
                          <FlagIcon width={12} height={12} /> {flag}
                        </span>
                      )}
                      {(v.imo || flag) && <span className="vessel-sub-sep">•</span>}
                      <span className="vessel-status-simple">
                        <span className="vessel-dot" /> Active
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Side: Action Icons (Edit, Delete, Toggle - Icon Only) */}
                <div className="vessel-row-controls" onClick={e => e.stopPropagation()}>
                  {canManageVessels && (
                    <div className="vessel-action-group">
                      <button
                        className="vessel-icon-btn edit"
                        title="Edit vessel master particulars"
                        aria-label="Edit vessel"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditVessel(v);
                        }}
                      >
                        <EditIcon width={15} height={15} />
                      </button>

                      <button
                        className="vessel-icon-btn delete"
                        title="Delete vessel from fleet registry"
                        aria-label="Delete vessel"
                        onClick={(e) => {
                          e.stopPropagation();
                          setVesselToDelete(v);
                        }}
                      >
                        <TrashIcon width={15} height={15} />
                      </button>
                    </div>
                  )}

                  {/* Toggle Button: Icon Only */}
                  <button
                    className={`vessel-icon-btn toggle ${isExpanded ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(v.id);
                    }}
                    title={isExpanded ? 'Collapse details' : 'Expand full specifications'}
                    aria-label={isExpanded ? 'Collapse details' : 'Expand full specifications'}
                  >
                    <ChevronDownIcon
                      width={17}
                      height={17}
                      className={`vessel-chevron ${isExpanded ? 'rotated' : ''}`}
                    />
                  </button>
                </div>
              </div>

              {/* ── Toggleable Drawer: Revealed on Click ── */}
              {isExpanded && (
                <div className="vessel-drawer-content">
                  <div className="vessel-drawer-divider" />

                  {/* Master 4-Module Specifications Matrix */}
                  <div className="vessel-drawer-matrix">
                    {/* Module 1: Registration & Flag */}
                    <div className="vessel-drawer-card card-blue">
                      <div className="vessel-drawer-card-header">
                        <FlagIcon width={14} height={14} />
                        <span>1. Registration & Flag</span>
                      </div>
                      <div className="vessel-drawer-fields">
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Port of Registry:</span>
                          <span className="vessel-field-value">{v.particulars?.portOfRegistry || '—'}</span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Call Sign / Official No:</span>
                          <span className="vessel-field-value">
                            {v.particulars?.callSign || '—'} {v.particulars?.officialNo ? `(No. ${v.particulars.officialNo})` : ''}
                          </span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Place of Build:</span>
                          <span className="vessel-field-value">{v.particulars?.placeOfBuild || '—'}</span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Year of Build:</span>
                          <span className="vessel-field-value">{v.particulars?.yearBuilt || '—'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Module 2: Classification & Tonnage */}
                    <div className="vessel-drawer-card card-purple">
                      <div className="vessel-drawer-card-header">
                        <AnchorIcon width={14} height={14} />
                        <span>2. Class & Tonnage</span>
                      </div>
                      <div className="vessel-drawer-fields">
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Classification Society:</span>
                          <span className="vessel-field-value">{v.particulars?.classSociety || '—'}</span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Class Notation:</span>
                          <span className="vessel-field-value">{v.particulars?.classNotation || '—'}</span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Deadweight (DWT):</span>
                          <span className="vessel-field-value accent">
                            {v.particulars?.deadweight ? `${Number(v.particulars.deadweight).toLocaleString()} MT` : '—'}
                          </span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Gross / Net Tonnage:</span>
                          <span className="vessel-field-value">
                            GT {v.particulars?.grossTonnage ? Number(v.particulars.grossTonnage).toLocaleString() : '—'} / NT {v.particulars?.netTonnage ? Number(v.particulars.netTonnage).toLocaleString() : '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Module 3: Dimensions & Draft */}
                    <div className="vessel-drawer-card card-emerald">
                      <div className="vessel-drawer-card-header">
                        <RulerIcon width={14} height={14} />
                        <span>3. Dimensions & Draft</span>
                      </div>
                      <div className="vessel-drawer-fields">
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Length Overall (LOA):</span>
                          <span className="vessel-field-value">{v.particulars?.loa || '—'}</span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Breadth / Beam:</span>
                          <span className="vessel-field-value">{v.particulars?.breadth || '—'}</span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Depth:</span>
                          <span className="vessel-field-value">{v.particulars?.depth || '—'}</span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Summer Draft:</span>
                          <span className="vessel-field-value accent">{v.particulars?.summerDraft || '—'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Module 4: Machinery & Propulsion */}
                    <div className="vessel-drawer-card card-amber">
                      <div className="vessel-drawer-card-header">
                        <GaugeIcon width={14} height={14} />
                        <span>4. Machinery & Propulsion</span>
                      </div>
                      <div className="vessel-drawer-fields">
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Main Engine:</span>
                          <span className="vessel-field-value" title={v.particulars?.mainEngine}>{v.particulars?.mainEngine || '—'}</span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Maker / Model:</span>
                          <span className="vessel-field-value">{v.particulars?.mainEngineMakerModel || '—'}</span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Output Power:</span>
                          <span className="vessel-field-value">{v.particulars?.mainEnginePower || '—'}</span>
                        </div>
                        <div className="vessel-field-row">
                          <span className="vessel-field-label">Propulsion:</span>
                          <span className="vessel-field-value">{v.particulars?.propulsion || 'Single Fixed Pitch'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Module 5: Management, Operations & Communications */}
                  <div className="vessel-drawer-management-strip">
                    <div className="vessel-mgmt-card card-slate">
                      <div className="vessel-mgmt-header">
                        <UsersIcon width={14} height={14} />
                        <span>5. Ownership, Technical Management & Communications</span>
                      </div>
                      <div className="vessel-mgmt-grid">
                        <div className="vessel-mgmt-col">
                          <span className="vessel-mgmt-lbl">Registered Owner</span>
                          <span className="vessel-mgmt-val">{v.particulars?.owner || '—'}</span>
                        </div>
                        <div className="vessel-mgmt-col">
                          <span className="vessel-mgmt-lbl">Technical Manager / Operator</span>
                          <span className="vessel-mgmt-val">{v.particulars?.managerOperator || '—'}</span>
                        </div>
                        <div className="vessel-mgmt-col">
                          <span className="vessel-mgmt-lbl">Official Shipboard Email</span>
                          <span className="vessel-mgmt-val">{v.particulars?.email || '—'}</span>
                        </div>
                        <div className="vessel-mgmt-col">
                          <span className="vessel-mgmt-lbl">Inmarsat / Sat Phone</span>
                          <span className="vessel-mgmt-val">{v.particulars?.satellitePhone || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Drawer Footer Bar */}
                  <div className="vessel-drawer-footer">
                    <div className="vessel-drawer-status-chip">
                      <CheckCircleIcon width={15} height={15} style={{ color: '#059669' }} />
                      <span><strong>{filledCount} of 23</strong> Master Technical Specifications Documented</span>
                    </div>

                    <div className="vessel-drawer-actions">
                      {canManageVessels && (
                        <button
                          className="vessel-drawer-edit-btn"
                          onClick={() => startEditVessel(v)}
                        >
                          <EditIcon width={14} height={14} />
                          <span>Edit Full Specifications</span>
                        </button>
                      )}
                      <button
                        className="vessel-drawer-close-btn"
                        onClick={() => toggleExpanded(v.id)}
                      >
                        <span>Close Details</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Delete Confirmation Modal (Premium Styled) ───────────────────── */}
      {vesselToDelete && (
        <div className="vessel-modal-backdrop" onClick={() => !deleteBusy && setVesselToDelete(null)}>
          <div className="vessel-delete-modal-card" onClick={e => e.stopPropagation()}>
            <div className="vessel-delete-icon-box">
              <TrashIcon width={28} height={28} />
            </div>

            <h3 className="vessel-delete-title">Delete Fleet Vessel</h3>
            <p className="vessel-delete-desc">
              Are you sure you want to remove <strong>{vesselToDelete.name}</strong> (IMO: {vesselToDelete.imo}) from the master vessel database?
            </p>
            <p className="vessel-delete-subdesc">
              This vessel will be archived and removed from the active master registry.
            </p>

            {deleteError && (
              <div className="vessel-delete-error-msg">
                <AlertCircleIcon width={16} height={16} />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="vessel-delete-actions">
              <button
                type="button"
                className="vessel-btn-cancel"
                disabled={deleteBusy}
                onClick={() => setVesselToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="vessel-btn-delete-confirm"
                disabled={deleteBusy}
                onClick={onConfirmDelete}
              >
                {deleteBusy ? 'Deleting Vessel...' : 'Yes, Delete Vessel'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
