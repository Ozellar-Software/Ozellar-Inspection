import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQuery } from '@tanstack/react-query';
import { type Inspection, type Vessel, inspectionDueInfo, type DueInfo } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { useCurrentUser } from '../../auth/useCurrentUser';
import {
  BackIcon, SearchIcon, XIcon, ShipIcon, AnchorIcon, WifiIcon,
  CheckCircleIcon, AlertCircleIcon, CalendarIcon, PlusIcon, FileIcon,
  EyeIcon, UserIcon, EditIcon, ArrowUpDownIcon, ChevronDownIcon, CheckIcon
} from '../../icons';
import { exportFleetToExcel, type FleetExportRow } from './fleetExportExcel';
import './FleetStatusPage.css';

export type FleetFilterColor = 'all' | 'in_progress' | 'green' | 'yellow' | 'red' | 'uninspected';
export type FleetStatusType = 'in_progress' | 'green' | 'yellow' | 'red' | 'uninspected';

interface VesselStatusRow {
  vessel: Vessel;
  lastCompleted: Inspection | null;
  pending: Inspection | null;
  activeInspection: Inspection | null;
  due: DueInfo;
  statusType: FleetStatusType;
  statusLabel: string;
  rank: number; // 0 = in_progress, 1 = red, 2 = yellow, 3 = green, 4 = uninspected
  reportRef: string;
  dateCommenced: string;
  dateCompleted: string;
  lastInspectionDate: string;
  lastInspectionRelative: string;
  typeLabel: string;
  portLabel: string;
  nextDueFormatted: string;
  daysInfo: { days: number; text: string } | null;
  cyclePct: number;
  inspectorName: string;
  isInProgress: boolean;
}

export type SortOption = 'urgency' | 'name' | 'dueSoonest' | 'lastRecent';

/**
 * Sleek SVG Circular Progress Dial for Unique KPI Cards
 */
function KpiDial({ pct, color, children }: { pct: number; color: string; children: React.ReactNode }) {
  const r = 16;
  const circ = 2 * Math.PI * r; // ~100.53
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = circ * (1 - clamped / 100);

  return (
    <div className={`fs-kpi-dial-wrap ${color}`}>
      <svg className="fs-kpi-dial-svg" width="42" height="42" viewBox="0 0 42 42">
        <circle className="fs-kpi-dial-bg" cx="21" cy="21" r={r} />
        <circle
          className={`fs-kpi-dial-bar ${color}`}
          cx="21"
          cy="21"
          r={r}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className={`fs-kpi-dial-inner ${color}`}>
        {children}
      </div>
    </div>
  );
}

interface SortOptionConfig {
  key: SortOption;
  title: string;
  shortLabel: string;
  desc: string;
  iconColor: string;
  renderIcon: () => React.ReactNode;
}

const SORT_OPTIONS: SortOptionConfig[] = [
  {
    key: 'urgency',
    title: 'Urgency First',
    shortLabel: 'Urgency',
    desc: 'Active surveys underway & overdue vessels first',
    iconColor: 'red',
    renderIcon: () => <AlertCircleIcon width={14} height={14} />,
  },
  {
    key: 'dueSoonest',
    title: 'Next Due Date',
    shortLabel: 'Due Soonest',
    desc: 'Soonest statutory survey deadline first',
    iconColor: 'yellow',
    renderIcon: () => <CalendarIcon width={14} height={14} />,
  },
  {
    key: 'name',
    title: 'Vessel Name',
    shortLabel: 'Name A–Z',
    desc: 'Alphabetical order from A to Z',
    iconColor: 'blue',
    renderIcon: () => <ShipIcon width={14} height={14} />,
  },
  {
    key: 'lastRecent',
    title: 'Survey Date',
    shortLabel: 'Recent Survey',
    desc: 'Most recently completed survey first',
    iconColor: 'green',
    renderIcon: () => <CheckCircleIcon width={14} height={14} />,
  },
];

export function FleetStatusPage({ embedded = false }: { embedded?: boolean } = {}) {
  const nav = useNavigate();
  const me = useCurrentUser();

  const [q, setQ] = useState('');
  const [filterColor, setFilterColor] = useState<FleetFilterColor>('all');
  const [sortBy, setSortBy] = useState<SortOption>('urgency');
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Load vessels and inspections from Dexie
  const rawVessels = useLiveQuery(() => db.vessels.toArray(), []) ?? [];
  const rawInspections = useLiveQuery(() => db.inspections.toArray(), []) ?? [];

  // Exclude takeover and pre-purchase reports; restrict to standard inspections only
  const { vessels, inspections } = useMemo(() => {
    const activeVessels = rawVessels.filter((v) => !v.deletedAt && (v as any).registrationStatus !== 'unregistered');
    // Only standard statutory inspections: exclude take_over and pre_purchase
    const activeInspections = rawInspections.filter((i) => !i.deletedAt && (!i.reportCategory || i.reportCategory === 'inspection'));
    const role = me.data?.role;

    if (role === 'admin' || role === 'director' || !me.data) {
      return { vessels: activeVessels, inspections: activeInspections };
    }

    const assignedIds = (me.data.vesselIds ?? []).map((id) => id.toLowerCase().trim());
    const myId = me.data.id?.toLowerCase().trim();

    const filteredVessels = activeVessels.filter((v) => assignedIds.length === 0 || assignedIds.includes(v.id.toLowerCase().trim()));
    const filteredInspections = activeInspections.filter((i) => {
      const isCreator = Boolean(myId && i.createdBy && i.createdBy.toLowerCase().trim() === myId);
      if (isCreator) return true;
      if (assignedIds.length === 0) return true;
      return Boolean(i.vesselId && assignedIds.includes(i.vesselId.toLowerCase().trim()));
    });

    return { vessels: filteredVessels, inspections: filteredInspections };
  }, [rawVessels, rawInspections, me.data]);

  // Sync remote fleet-status if online
  useQuery({
    queryKey: ['remote-fleet-status', me.data?.id],
    enabled: navigator.onLine,
    queryFn: async () => {
      try {
        return await api<Array<{ vesselId: string; name: string; last: any; due: any }>>('/fleet-status');
      } catch {
        return [];
      }
    },
    staleTime: 15_000,
  });

  // Calculate status for each vessel matching statutory 6-month cycle
  const rows = useMemo<VesselStatusRow[]>(() => {
    return vessels.map((v) => {
      const vName = (v.name || '').trim().toLowerCase();
      const vId = (v.id || '').trim().toLowerCase();

      // Find all standard inspections for this vessel
      const vesselInspections = inspections.filter((i) => {
        if (i.vesselId && i.vesselId.trim().toLowerCase() === vId) return true;
        if (i.vesselName && i.vesselName.trim().toLowerCase() === vName) return true;
        return false;
      });

      // Completed / Approved ones
      const completedOnes = vesselInspections.filter((i) => i.status === 'approved');
      completedOnes.sort((a, b) => {
        const ad = a.completionDate || a.startDate || a.updatedAt || '';
        const bd = b.completionDate || b.startDate || b.updatedAt || '';
        return bd.localeCompare(ad);
      });
      const lastCompleted = completedOnes[0] || null;

      // In-progress ones
      const inProgressOnes = vesselInspections.filter((i) => i.status !== 'approved');
      inProgressOnes.sort((a, b) => {
        const ad = a.startDate || a.updatedAt || '';
        const bd = b.startDate || b.updatedAt || '';
        return bd.localeCompare(ad);
      });
      let pending: Inspection | null = inProgressOnes[0] || null;

      // Only surface "pending" if it isn't older than the last completed one
      if (pending && lastCompleted) {
        const pendingDate = pending.startDate || pending.updatedAt || '';
        const completedDate = lastCompleted.completionDate || lastCompleted.startDate || '';
        if (pendingDate <= completedDate) {
          pending = null;
        }
      }

      const activeInspection = pending || lastCompleted;
      let isInProgress = false;
      let statusType: FleetStatusType = 'uninspected';
      let statusLabel = 'Not Inspected';
      let rank = 4; // Uninspected vessels sit at bottom

      let lastInspectionDate = 'Not yet inspected';
      let lastInspectionRelative = '';
      let typeLabel = '—';
      let portLabel = '—';
      let inspectorName = '—';
      let nextDueFormatted = '—';
      let daysInfo: { days: number; text: string } | null = null;
      let cyclePct = 0;
      let due: DueInfo = { color: 'green', label: 'No inspection on record', nextDue: null };

      if (pending) {
        // Active in-progress survey: top priority
        isInProgress = true;
        statusType = 'in_progress';
        statusLabel = 'In Progress';
        rank = 0;

        const startStr = pending.startDate || pending.updatedAt;
        lastInspectionDate = fmtDate(startStr);
        lastInspectionRelative = formatRelativeTime(startStr);

        typeLabel = pending.inspectionType === 'port'
          ? 'In Port'
          : pending.inspectionType === 'remote'
          ? 'Remote'
          : 'While Sailing';

        if (pending.inspectionType === 'sailing') {
          const from = pending.sailFromPort || '';
          const to = pending.sailToPort || '';
          portLabel = from && to ? `${from} → ${to}` : from || to || 'At Sea';
        } else {
          portLabel = pending.port || '—';
        }

        inspectorName = pending.inspector || '—';

        if (lastCompleted) {
          due = inspectionDueInfo(lastCompleted);
          nextDueFormatted = due.nextDue ? fmtDate(due.nextDue) : '—';
          daysInfo = getDaysRemaining(due.nextDue);

          const refStr = lastCompleted.completionDate || lastCompleted.startDate;
          if (refStr) {
            const ref = new Date(`${refStr}T00:00:00`);
            if (!isNaN(ref.getTime())) {
              const months = (new Date().getTime() - ref.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
              cyclePct = Math.min(100, Math.max(5, Math.round((months / 6) * 100)));
            }
          }
        } else {
          nextDueFormatted = 'Survey Active';
          cyclePct = 15;
        }
      } else if (lastCompleted) {
        // Completed survey exists
        const refDateStr = lastCompleted.completionDate || lastCompleted.startDate;
        lastInspectionDate = fmtDate(refDateStr);
        lastInspectionRelative = formatRelativeTime(refDateStr);

        typeLabel = lastCompleted.inspectionType === 'port'
          ? 'In Port'
          : lastCompleted.inspectionType === 'remote'
          ? 'Remote'
          : 'While Sailing';

        if (lastCompleted.inspectionType === 'sailing') {
          const from = lastCompleted.sailFromPort || '';
          const to = lastCompleted.sailToPort || '';
          portLabel = from && to ? `${from} → ${to}` : from || to || 'At Sea';
        } else {
          portLabel = lastCompleted.port || '—';
        }

        inspectorName = lastCompleted.inspector || '—';

        due = inspectionDueInfo(lastCompleted);
        nextDueFormatted = due.nextDue ? fmtDate(due.nextDue) : '—';
        daysInfo = getDaysRemaining(due.nextDue);

        if (due.color === 'red') {
          statusType = 'red';
          statusLabel = 'Overdue';
          rank = 1;
        } else if (due.color === 'yellow') {
          statusType = 'yellow';
          statusLabel = 'Due Soon';
          rank = 2;
        } else {
          statusType = 'green';
          statusLabel = 'On Track';
          rank = 3;
        }

        if (refDateStr) {
          const ref = new Date(`${refDateStr}T00:00:00`);
          if (!isNaN(ref.getTime())) {
            const months = (new Date().getTime() - ref.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
            cyclePct = Math.min(100, Math.max(5, Math.round((months / 6) * 100)));
          }
        }
      } else {
        // No inspection created yet: NOT overdue until 1st inspection is created
        statusType = 'uninspected';
        statusLabel = 'Not Inspected';
        rank = 4;
        due = { color: 'green', label: 'No inspection on record', nextDue: null };
      }

      const reportRef = activeInspection ? `VIR-${activeInspection.id.slice(0, 8).toUpperCase()}` : '—';
      const dateCommenced = activeInspection?.startDate ? fmtDate(activeInspection.startDate) : '—';
      const dateCompleted = activeInspection?.completionDate
        ? fmtDate(activeInspection.completionDate)
        : pending
        ? 'Underway · In Progress'
        : activeInspection?.startDate
        ? fmtDate(activeInspection.startDate)
        : '—';

      return {
        vessel: v,
        lastCompleted,
        pending,
        activeInspection,
        due,
        statusType,
        statusLabel,
        rank,
        reportRef,
        dateCommenced,
        dateCompleted,
        lastInspectionDate,
        lastInspectionRelative,
        typeLabel,
        portLabel,
        nextDueFormatted,
        daysInfo,
        cyclePct,
        inspectorName,
        isInProgress,
      };
    });
  }, [vessels, inspections]);

  // KPI Counts & Modality Breakdown
  const { counts, modality, compliancePct } = useMemo(() => {
    let red = 0;
    let yellow = 0;
    let green = 0;
    let inProgress = 0;
    let uninspected = 0;

    for (const r of rows) {
      if (r.statusType === 'red') red++;
      else if (r.statusType === 'yellow') yellow++;
      else if (r.statusType === 'green') green++;
      else if (r.statusType === 'in_progress') inProgress++;
      else uninspected++;
    }

    const totalVessels = rows.length;
    const compliancePct = totalVessels > 0 ? Math.round((green / totalVessels) * 100) : 100;

    // Modality breakdown across all active inspections
    let port = 0;
    let remote = 0;
    let sailing = 0;

    for (const i of inspections) {
      if (i.inspectionType === 'remote') remote++;
      else if (i.inspectionType === 'sailing') sailing++;
      else port++;
    }

    const totalInsp = inspections.length;
    const portPct = totalInsp > 0 ? Math.round((port / totalInsp) * 100) : 0;
    const remotePct = totalInsp > 0 ? Math.round((remote / totalInsp) * 100) : 0;
    const sailingPct = totalInsp > 0 ? Math.round((sailing / totalInsp) * 100) : 0;

    return {
      counts: {
        red,
        yellow,
        green,
        inProgress,
        uninspected,
        total: totalVessels,
        greenPct: totalVessels > 0 ? Math.round((green / totalVessels) * 100) : 0,
        yellowPct: totalVessels > 0 ? Math.round((yellow / totalVessels) * 100) : 0,
        redPct: totalVessels > 0 ? Math.round((red / totalVessels) * 100) : 0,
      },
      modality: { port, remote, sailing, total: totalInsp, portPct, remotePct, sailingPct },
      compliancePct,
    };
  }, [rows, inspections]);

  async function handleExportExcel() {
    setIsExporting(true);
    try {
      const exportRows: FleetExportRow[] = rows.map((r) => ({
        vesselName: r.vessel.name,
        imo: r.vessel.imo,
        vesselType: r.vessel.vesselType,
        due: r.due,
        statusLabel: r.statusLabel,
        statusType: r.statusType,
        daysText: r.daysInfo?.text || '—',
        reportRef: r.reportRef,
        dateCommenced: r.dateCommenced,
        dateCompleted: r.dateCompleted,
        lastInspectionDate: r.lastInspectionDate,
        lastInspectionRelative: r.lastInspectionRelative,
        typeLabel: r.typeLabel,
        portLabel: r.portLabel,
        nextDueFormatted: r.nextDueFormatted,
        cyclePct: r.cyclePct,
        inspectorName: r.inspectorName,
      }));

      await exportFleetToExcel(exportRows, {
        total: counts.total,
        green: counts.green,
        yellow: counts.yellow,
        red: counts.red,
        compliancePct,
      });
    } catch (err) {
      console.error('Failed to export Excel report:', err);
    } finally {
      setIsExporting(false);
    }
  }

  // Filtered & Sorted Rows: Completed and In-process vessels at top
  const filteredRows = useMemo(() => {
    const list = rows.filter((r) => {
      if (filterColor !== 'all' && r.statusType !== filterColor) return false;
      if (q.trim()) {
        const query = q.trim().toLowerCase();
        const name = (r.vessel.name || '').toLowerCase();
        const imo = (r.vessel.imo || '').toLowerCase();
        const port = r.portLabel.toLowerCase();
        const type = (r.vessel.vesselType || '').toLowerCase();
        const inspector = (r.inspectorName || '').toLowerCase();
        return name.includes(query) || imo.includes(query) || port.includes(query) || type.includes(query) || inspector.includes(query);
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === 'urgency') {
        // Rank order: 0=in_progress, 1=overdue, 2=due_soon, 3=on_track, 4=uninspected
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (a.daysInfo && b.daysInfo) return a.daysInfo.days - b.daysInfo.days;
        return a.vessel.name.localeCompare(b.vessel.name);
      }
      if (sortBy === 'name') {
        return a.vessel.name.localeCompare(b.vessel.name);
      }
      if (sortBy === 'dueSoonest') {
        const da = a.due.nextDue ? a.due.nextDue.getTime() : Infinity;
        const db = b.due.nextDue ? b.due.nextDue.getTime() : Infinity;
        if (da !== db) return da - db;
        return a.rank - b.rank;
      }
      if (sortBy === 'lastRecent') {
        const da = a.activeInspection?.completionDate || a.activeInspection?.startDate || a.activeInspection?.updatedAt || '';
        const db = b.activeInspection?.completionDate || b.activeInspection?.startDate || b.activeInspection?.updatedAt || '';
        if (db !== da) return db.localeCompare(da);
        return a.rank - b.rank;
      }
      return 0;
    });

    return list;
  }, [rows, filterColor, q, sortBy]);

  // History inspections for selected vessel modal (standard inspections only)
  const selectedVesselHistory = useMemo(() => {
    if (!selectedVessel) return [];
    const vName = (selectedVessel.name || '').trim().toLowerCase();
    const vId = (selectedVessel.id || '').trim().toLowerCase();

    return inspections
      .filter((i) => {
        if (i.vesselId && i.vesselId.trim().toLowerCase() === vId) return true;
        if (i.vesselName && i.vesselName.trim().toLowerCase() === vName) return true;
        return false;
      })
      .sort((a, b) => {
        const ad = a.completionDate || a.startDate || a.updatedAt || '';
        const bd = b.completionDate || b.startDate || b.updatedAt || '';
        return bd.localeCompare(ad);
      });
  }, [selectedVessel, inspections]);

  const selectedRow = useMemo(() => {
    if (!selectedVessel) return null;
    return rows.find((r) => r.vessel.id === selectedVessel.id) || null;
  }, [selectedVessel, rows]);

  const canCreateInspection = me.data?.role === 'admin'
    || me.data?.role === 'techManager'
    || me.data?.role === 'vesselUser'
    || me.data?.role === 'vesselManager';

  return (
    <div className={embedded ? 'fleet-status-page-wrap embedded' : 'fleet-status-page-wrap'}>
      {/* ── APPBAR (Standalone page only) ── */}
      {!embedded && (
        <div className="appbar">
          <button className="back" aria-label="Back" onClick={() => nav('/')}>
            <BackIcon />
          </button>
          <div className="title-wrap">
            <h1>Fleet inspection status</h1>
          </div>
          {canCreateInspection && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => nav('/inspections/new')}
            >
              <PlusIcon width={14} height={14} /> New inspection
            </button>
          )}
        </div>
      )}

      <div className={embedded ? 'fs-page-content' : 'page-wrap'} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        
        {/* ── 1. CLEAN EXECUTIVE HEADER STRIP ── */}
        <div className="fs-header-strip">
          <div className="fs-header-left">
            <h2 className="fs-header-title">Fleet Due & Inspection Status</h2>
            <p className="fs-header-sub">Statutory 6-month survey cycle and compliance tracking</p>
          </div>

          <div className="fs-header-actions">
            <div className="fs-compliance-pill" title="Fleet Statutory Compliance Rate">
              <span className="fs-comp-label">Compliance</span>
              <span className={`fs-comp-score ${compliancePct >= 80 ? 'good' : compliancePct >= 50 ? 'warn' : 'bad'}`}>
                {compliancePct}%
              </span>
              <span className="fs-comp-count">({counts.green}/{counts.total})</span>
            </div>

            <button
              type="button"
              className="fs-excel-btn"
              onClick={handleExportExcel}
              disabled={isExporting}
              title="Download executive fleet inspection report as styled Excel (.xlsx)"
            >
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="16" y2="17" />
              </svg>
              <span>{isExporting ? 'Exporting…' : 'Export Excel (.xlsx)'}</span>
            </button>
          </div>
        </div>

        {/* ── 2. BRAND-NEW UNIQUE EXECUTIVE KPI CARDS (CIRCULAR DIAL + METER) ── */}
        <div className="fs-kpi-grid">
          {/* Card 1: On Track */}
          <div
            className={`fs-kpi-card green ${filterColor === 'green' ? 'active' : ''}`}
            onClick={() => setFilterColor(filterColor === 'green' ? 'all' : 'green')}
            role="button"
            tabIndex={0}
            title="Filter on-track compliant vessels (< 5 months)"
          >
            <div className="fs-kpi-glow-orb green" />
            <div className="fs-kpi-header-row">
              <span className="fs-kpi-capsule green">
                <span className="fs-kpi-dot green" />
                <span>On Track</span>
              </span>
              <span className="fs-kpi-pct-badge green">{counts.greenPct}%</span>
            </div>

            <div className="fs-kpi-main-row">
              <div className="fs-kpi-metric-group">
                <span className="fs-kpi-big-num text-green">{counts.green}</span>
                <span className="fs-kpi-unit">vessels</span>
              </div>
              <KpiDial pct={counts.greenPct} color="green">
                <CheckCircleIcon width={14} height={14} />
              </KpiDial>
            </div>

            <div className="fs-kpi-meter-track">
              <div className="fs-kpi-meter-bar green" style={{ width: `${counts.greenPct}%` }} />
            </div>

            <div className="fs-kpi-footer-row">
              <span className="fs-kpi-caption">Compliant (&lt; 5m)</span>
            </div>
          </div>

          {/* Card 2: Due Soon */}
          <div
            className={`fs-kpi-card yellow ${filterColor === 'yellow' ? 'active' : ''}`}
            onClick={() => setFilterColor(filterColor === 'yellow' ? 'all' : 'yellow')}
            role="button"
            tabIndex={0}
            title="Filter due-soon vessels (5–6 months)"
          >
            <div className="fs-kpi-glow-orb yellow" />
            <div className="fs-kpi-header-row">
              <span className="fs-kpi-capsule yellow">
                <span className="fs-kpi-dot yellow" />
                <span>Due Soon</span>
              </span>
              <span className="fs-kpi-pct-badge yellow">{counts.yellowPct}%</span>
            </div>

            <div className="fs-kpi-main-row">
              <div className="fs-kpi-metric-group">
                <span className="fs-kpi-big-num text-yellow">{counts.yellow}</span>
                <span className="fs-kpi-unit">vessels</span>
              </div>
              <KpiDial pct={counts.yellowPct} color="yellow">
                <CalendarIcon width={14} height={14} />
              </KpiDial>
            </div>

            <div className="fs-kpi-meter-track">
              <div className="fs-kpi-meter-bar yellow" style={{ width: `${counts.yellowPct}%` }} />
            </div>

            <div className="fs-kpi-footer-row">
              <span className="fs-kpi-caption">Within 30d window</span>
            </div>
          </div>

          {/* Card 3: Overdue */}
          <div
            className={`fs-kpi-card red ${filterColor === 'red' ? 'active' : ''}`}
            onClick={() => setFilterColor(filterColor === 'red' ? 'all' : 'red')}
            role="button"
            tabIndex={0}
            title="Filter overdue vessels (≥ 6 months)"
          >
            <div className="fs-kpi-glow-orb red" />
            <div className="fs-kpi-header-row">
              <span className="fs-kpi-capsule red">
                <span className="fs-kpi-dot red" />
                <span>Overdue</span>
              </span>
              <span className="fs-kpi-pct-badge red">{counts.redPct}%</span>
            </div>

            <div className="fs-kpi-main-row">
              <div className="fs-kpi-metric-group">
                <span className="fs-kpi-big-num text-red">{counts.red}</span>
                <span className="fs-kpi-unit">vessels</span>
              </div>
              <KpiDial pct={counts.redPct} color="red">
                <AlertCircleIcon width={14} height={14} />
              </KpiDial>
            </div>

            <div className="fs-kpi-meter-track">
              <div className="fs-kpi-meter-bar red" style={{ width: `${counts.redPct}%` }} />
            </div>

            <div className="fs-kpi-footer-row">
              <span className="fs-kpi-caption">Requires survey (≥ 6m)</span>
            </div>
          </div>

          {/* Card 4: In Progress (Live Underway Surveys) */}
          <div
            className={`fs-kpi-card blue ${filterColor === 'in_progress' ? 'active' : ''}`}
            onClick={() => setFilterColor(filterColor === 'in_progress' ? 'all' : 'in_progress')}
            role="button"
            tabIndex={0}
            title="Filter active surveys underway"
          >
            <div className="fs-kpi-glow-orb blue" />
            <div className="fs-kpi-header-row">
              <span className="fs-kpi-capsule blue">
                <span className="fs-kpi-dot blue pulse" />
                <span>In Progress</span>
              </span>
              <span className="fs-kpi-pct-badge blue">Active</span>
            </div>

            <div className="fs-kpi-main-row">
              <div className="fs-kpi-metric-group">
                <span className="fs-kpi-big-num text-blue">{counts.inProgress}</span>
                <span className="fs-kpi-unit">surveys</span>
              </div>
              <KpiDial pct={counts.total > 0 ? Math.round((counts.inProgress / counts.total) * 100) : 0} color="blue">
                <EditIcon width={14} height={14} />
              </KpiDial>
            </div>

            <div className="fs-kpi-meter-track">
              <div
                className="fs-kpi-meter-bar blue"
                style={{ width: `${counts.total > 0 ? Math.round((counts.inProgress / counts.total) * 100) : 0}%` }}
              />
            </div>

            <div className="fs-kpi-footer-row">
              <span className="fs-kpi-caption">Audits underway</span>
            </div>
          </div>

          {/* Card 5: Total Fleet */}
          <div
            className={`fs-kpi-card navy ${filterColor === 'all' ? 'active' : ''}`}
            onClick={() => setFilterColor('all')}
            role="button"
            tabIndex={0}
            title="View entire registered fleet"
          >
            <div className="fs-kpi-glow-orb navy" />
            <div className="fs-kpi-header-row">
              <span className="fs-kpi-capsule navy">
                <span className="fs-kpi-dot navy" />
                <span>Total Fleet</span>
              </span>
              <span className="fs-kpi-pct-badge navy">Fleet</span>
            </div>

            <div className="fs-kpi-main-row">
              <div className="fs-kpi-metric-group">
                <span className="fs-kpi-big-num text-navy">{counts.total}</span>
                <span className="fs-kpi-unit">vessels</span>
              </div>
              <KpiDial pct={100} color="navy">
                <ShipIcon width={14} height={14} />
              </KpiDial>
            </div>

            <div className="fs-kpi-meter-track">
              <div className="fs-kpi-meter-bar navy" style={{ width: '100%' }} />
            </div>

            <div className="fs-kpi-footer-row">
              <span className="fs-kpi-caption">
                {counts.uninspected > 0 ? `${counts.uninspected} pending 1st survey` : '100% active registry'}
              </span>
            </div>
          </div>
        </div>

        {/* ── 3. COMPACT MODALITY TELEMETRY STRIP ── */}
        <div className="fs-modality-strip">
          <div className="fs-mod-label">
            <ShipIcon width={14} height={14} />
            <span>Survey Modality:</span>
          </div>
          <div className="fs-mod-chips">
            <span className="fs-mod-pill port" title={`In Port: ${modality.port} (${modality.portPct}%)`}>
              <AnchorIcon width={12} height={12} />
              <span>In Port: <strong>{modality.port}</strong> ({modality.portPct}%)</span>
            </span>
            <span className="fs-mod-pill remote" title={`Remote: ${modality.remote} (${modality.remotePct}%)`}>
              <WifiIcon width={12} height={12} />
              <span>Remote: <strong>{modality.remote}</strong> ({modality.remotePct}%)</span>
            </span>
            <span className="fs-mod-pill sailing" title={`While Sailing: ${modality.sailing} (${modality.sailingPct}%)`}>
              <ShipIcon width={12} height={12} />
              <span>Sailing: <strong>{modality.sailing}</strong> ({modality.sailingPct}%)</span>
            </span>
            <span className="fs-mod-total-tag">
              {modality.total} Total Surveys Logged
            </span>
          </div>
        </div>

        {/* ── 4. SEARCH, FILTER & SORT TOOLBAR ── */}
        <div className="fs-controls-toolbar">
          <div className="fs-toolbar-primary">
            <div className="fs-search-box">
              <span className="fs-search-icon"><SearchIcon width={15} height={15} /></span>
              <input
                type="text"
                id="fleetSearchInput"
                placeholder="Search by vessel, IMO, port, surveyor…"
                autoComplete="off"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button
                  type="button"
                  className="fs-search-clear"
                  id="fleetSearchClear"
                  aria-label="Clear search"
                  onClick={() => setQ('')}
                >
                  <XIcon width={14} height={14} />
                </button>
              )}
            </div>

            {/* Modern Sort Card Dropdown */}
            <div className="fs-sort-dropdown-wrap">
              <button
                type="button"
                className={`fs-sort-card-btn ${isSortOpen ? 'open' : ''}`}
                onClick={() => setIsSortOpen(!isSortOpen)}
                aria-expanded={isSortOpen}
                aria-haspopup="listbox"
                aria-label="Sort vessels"
                title="Sort vessel records"
              >
                <span className="fs-scb-icon"><ArrowUpDownIcon width={13} height={13} /></span>
                <span className="fs-scb-label">Sort:</span>
                <span className="fs-scb-value">{SORT_OPTIONS.find((o) => o.key === sortBy)?.shortLabel || 'Urgency'}</span>
                <ChevronDownIcon className={`fs-scb-chevron ${isSortOpen ? 'rotated' : ''}`} width={13} height={13} />
              </button>

              {isSortOpen && (
                <>
                  <div className="fs-sort-backdrop" onClick={() => setIsSortOpen(false)} />
                  <div className="fs-sort-menu-card" role="listbox">
                    <div className="fs-sort-menu-header">
                      <span className="fs-smh-title">Sort Vessels</span>
                      <span className="fs-smh-badge">4 options</span>
                    </div>
                    <div className="fs-sort-options-list">
                      {SORT_OPTIONS.map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          role="option"
                          aria-selected={sortBy === opt.key}
                          className={`fs-sort-option-card ${sortBy === opt.key ? 'active' : ''}`}
                          onClick={() => {
                            setSortBy(opt.key);
                            setIsSortOpen(false);
                          }}
                        >
                          <div className="fs-soc-left">
                            <span className={`fs-soc-icon-wrap ${opt.iconColor}`}>
                              {opt.renderIcon()}
                            </span>
                            <div className="fs-soc-content">
                              <span className="fs-soc-title">{opt.title}</span>
                              <span className="fs-soc-desc">{opt.desc}</span>
                            </div>
                          </div>
                          {sortBy === opt.key && (
                            <span className="fs-soc-check">
                              <CheckIcon width={15} height={15} />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Filter pills */}
          <div className="fs-filter-btns">
            <button
              type="button"
              className={`fs-chip-btn ${filterColor === 'all' ? 'active' : ''}`}
              onClick={() => setFilterColor('all')}
            >
              All ({rows.length})
            </button>
            {counts.inProgress > 0 && (
              <button
                type="button"
                className={`fs-chip-btn blue ${filterColor === 'in_progress' ? 'active' : ''}`}
                onClick={() => setFilterColor(filterColor === 'in_progress' ? 'all' : 'in_progress')}
              >
                <span className="fs-dot blue" /> In Progress ({counts.inProgress})
              </button>
            )}
            <button
              type="button"
              className={`fs-chip-btn green ${filterColor === 'green' ? 'active' : ''}`}
              onClick={() => setFilterColor(filterColor === 'green' ? 'all' : 'green')}
            >
              <span className="fs-dot green" /> On Track ({counts.green})
            </button>
            <button
              type="button"
              className={`fs-chip-btn yellow ${filterColor === 'yellow' ? 'active' : ''}`}
              onClick={() => setFilterColor(filterColor === 'yellow' ? 'all' : 'yellow')}
            >
              <span className="fs-dot yellow" /> Due Soon ({counts.yellow})
            </button>
            <button
              type="button"
              className={`fs-chip-btn red ${filterColor === 'red' ? 'active' : ''}`}
              onClick={() => setFilterColor(filterColor === 'red' ? 'all' : 'red')}
            >
              <span className="fs-dot red" /> Overdue ({counts.red})
            </button>
            {counts.uninspected > 0 && (
              <button
                type="button"
                className={`fs-chip-btn slate ${filterColor === 'uninspected' ? 'active' : ''}`}
                onClick={() => setFilterColor(filterColor === 'uninspected' ? 'all' : 'uninspected')}
              >
                <span className="fs-dot slate" /> Not Inspected ({counts.uninspected})
              </button>
            )}
          </div>
        </div>

        {/* ── 5A. DESKTOP & TABLET VIEW: REFINED MASTER TABLE ── */}
        {filteredRows.length === 0 ? (
          <div className="fs-empty-card">
            <div className="fs-empty-icon-wrap"><ShipIcon width={36} height={36} /></div>
            <h3>No matching vessels found</h3>
            <p>Try modifying your search query or reset your status filter.</p>
            {(q || filterColor !== 'all') && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => { setQ(''); setFilterColor('all'); }}
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="fleet-table-wrap fs-table-container">
              <table className="fleet-table fs-enhanced-table">
                <thead>
                  <tr className="fs-thead-row">
                    <th className="th-col-vessel" style={{ width: '27%' }}>
                      <div className="th-content">
                        <span className="th-icon-box vessel"><ShipIcon width={13} height={13} /></span>
                        <span className="th-label">Vessel Particulars</span>
                      </div>
                    </th>
                    <th className="th-col-status" style={{ width: '15%' }}>
                      <div className="th-content">
                        <span className="th-icon-box status"><CheckCircleIcon width={13} height={13} /></span>
                        <span className="th-label">Statutory Status</span>
                      </div>
                    </th>
                    <th className="th-col-last" style={{ width: '18%' }}>
                      <div className="th-content">
                        <span className="th-icon-box last"><CalendarIcon width={13} height={13} /></span>
                        <span className="th-label">Last / Active Survey</span>
                      </div>
                    </th>
                    <th className="th-col-modality" style={{ width: '17%' }}>
                      <div className="th-content">
                        <span className="th-icon-box modality"><AnchorIcon width={13} height={13} /></span>
                        <span className="th-label">Modality & Port</span>
                      </div>
                    </th>
                    <th className="th-col-due" style={{ width: '13%' }}>
                      <div className="th-content">
                        <span className="th-icon-box due"><CalendarIcon width={13} height={13} /></span>
                        <span className="th-label">Statutory Due</span>
                      </div>
                    </th>
                    <th className="th-col-actions" style={{ width: '10%', textAlign: 'right' }}>
                      <div className="th-content right">
                        <span className="th-icon-box actions"><EyeIcon width={13} height={13} /></span>
                        <span className="th-label">Actions</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody id="fleetTableBody">
                  {filteredRows.map((r) => {
                    return (
                      <tr
                        key={r.vessel.id}
                        className={`ft-row ${
                          r.statusType === 'in_progress'
                            ? 'row-in-progress'
                            : r.statusType === 'red'
                            ? 'row-overdue'
                            : r.statusType === 'yellow'
                            ? 'row-due-soon'
                            : r.statusType === 'green'
                            ? 'row-on-track'
                            : 'row-uninspected'
                        }`}
                        onClick={() => setSelectedVessel(r.vessel)}
                        title={`Click to view inspection history and reports for ${r.vessel.name}`}
                      >
                        {/* 1. Vessel Particulars */}
                        <td className="ft-vessel-td">
                          <div className="ft-vessel-card">
                            <div className={`ft-avatar-box ${r.statusType}`}>
                              <ShipIcon width={18} height={18} />
                            </div>
                            <div className="ft-vessel-details">
                              <div className="ft-vessel-name-row">
                                <span className="ft-vessel-name">{r.vessel.name}</span>
                                {r.vessel.imo && (
                                  <span className="ft-imo-chip">IMO {r.vessel.imo}</span>
                                )}
                              </div>
                              <div className="ft-vessel-meta-row">
                                <span className="ft-type-chip">{r.vessel.vesselType || 'Fleet Vessel'}</span>
                                {r.pending && (
                                  <span className="ft-pending-badge">
                                    <span className="ft-pulse-dot" />
                                    <span>Survey in Progress</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 2. Statutory Status */}
                        <td>
                          <div className="ft-status-cell">
                            <div className={`ft-status-pill ${r.statusType}`}>
                              <span className="ft-status-dot" />
                              <span className="ft-status-text">{r.statusLabel}</span>
                            </div>
                            {r.statusType === 'in_progress' ? (
                              <span className="ft-countdown-badge in-progress">
                                Active Survey
                              </span>
                            ) : r.statusType === 'uninspected' ? (
                              <span className="ft-countdown-badge uninspected">
                                Pending 1st Survey
                              </span>
                            ) : r.daysInfo ? (
                              <span className={`ft-countdown-badge ${r.statusType}`}>
                                {r.daysInfo.text}
                              </span>
                            ) : null}
                          </div>
                        </td>

                        {/* 3. Last / Active Survey Details: Report Ref, Dates, Surveyor */}
                        <td>
                          <div className="ft-date-cell">
                            {r.reportRef !== '—' && (
                              <div className="ft-ref-row">
                                <span className="ft-ref-badge" title="Report Reference">{r.reportRef}</span>
                                {r.isInProgress && <span className="ft-live-tag">In Progress</span>}
                              </div>
                            )}
                            <div className={`ft-date-top ${r.isInProgress ? 'in-progress' : ''}`}>
                              <CalendarIcon width={13} height={13} className="ft-date-icon" />
                              <strong className="ft-date-val">
                                {r.isInProgress ? `Started ${r.dateCommenced}` : r.dateCompleted !== '—' ? r.dateCompleted : r.lastInspectionDate}
                              </strong>
                            </div>
                            {r.dateCommenced !== '—' && r.dateCompleted !== '—' && !r.isInProgress && (
                              <span className="ft-survey-period">Commenced: {r.dateCommenced}</span>
                            )}
                            {r.lastInspectionRelative && (
                              <span className="ft-date-rel">{r.lastInspectionRelative}</span>
                            )}
                            {r.inspectorName && r.inspectorName !== '—' && (
                              <div className="ft-inspector-row" title={`Auditor / Surveyor / Superintendent: ${r.inspectorName}`}>
                                <UserIcon width={12} height={12} className="ft-inspector-icon" />
                                <span className="ft-inspector-name">{r.inspectorName}</span>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 4. Modality & Port */}
                        <td>
                          <div className="ft-modality-cell">
                            {r.typeLabel !== '—' ? (
                              <span className={`ft-modality-tag ${r.typeLabel === 'In Port' ? 'port' : r.typeLabel === 'Remote' ? 'remote' : 'sailing'}`}>
                                {r.typeLabel === 'In Port' ? (
                                  <AnchorIcon width={12} height={12} />
                                ) : r.typeLabel === 'Remote' ? (
                                  <WifiIcon width={12} height={12} />
                                ) : (
                                  <ShipIcon width={12} height={12} />
                                )}
                                <span>{r.typeLabel}</span>
                              </span>
                            ) : (
                              <span className="ft-modality-tag none">
                                <span>—</span>
                              </span>
                            )}
                            {r.portLabel !== '—' ? (
                              <div className="ft-port-row" title={`Port / Route: ${r.portLabel}`}>
                                <AnchorIcon width={12} height={12} className="ft-port-icon" />
                                <span className="ft-port-name">{r.portLabel}</span>
                              </div>
                            ) : (
                              <span className="ft-port-name" style={{ color: '#94a3b8' }}>—</span>
                            )}
                          </div>
                        </td>

                        {/* 5. Statutory Next Due (+6 Calendar Months) */}
                        <td>
                          <div className="ft-due-cell">
                            <div className="ft-due-top">
                              <strong className={`ft-due-val ${r.statusType}`}>
                                {r.nextDueFormatted}
                              </strong>
                            </div>
                            {r.cyclePct > 0 && r.statusType !== 'uninspected' && (
                              <div className="ft-cycle-progress-wrap" title={`${r.cyclePct}% of 6-month statutory cycle elapsed`}>
                                <div
                                  className={`ft-cycle-bar ${r.statusType === 'in_progress' ? 'blue' : r.statusType}`}
                                  style={{ width: `${r.cyclePct}%` }}
                                />
                              </div>
                            )}
                            <span className="ft-due-sub">
                              {r.statusType === 'uninspected'
                                ? 'Pending 1st survey'
                                : r.statusType === 'in_progress' && !r.lastCompleted
                                ? '1st survey in progress'
                                : '6-mo statutory cycle'}
                            </span>
                          </div>
                        </td>

                        {/* 6. Actions */}
                        <td style={{ textAlign: 'right' }}>
                          <div className="ft-actions-cell" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="ft-action-btn view"
                              title={`View survey history for ${r.vessel.name}`}
                              onClick={() => setSelectedVessel(r.vessel)}
                            >
                              <EyeIcon width={13} height={13} />
                              <span>History</span>
                            </button>
                            {canCreateInspection && (
                              <button
                                type="button"
                                className="ft-action-btn new"
                                title={`Start new survey for ${r.vessel.name}`}
                                onClick={() => nav(`/inspections/new?vesselId=${r.vessel.id}`)}
                              >
                                <PlusIcon width={13} height={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── 5B. MOBILE VIEW: SLEEK TOUCH-FRIENDLY VESSEL CARDS (< 720px) ── */}
            <div className="fs-mobile-cards-list">
              {filteredRows.map((r) => {
                return (
                  <div
                    key={`m-${r.vessel.id}`}
                    className={`fsm-card ${
                      r.statusType === 'in_progress'
                        ? 'card-in-progress'
                        : r.statusType === 'red'
                        ? 'card-overdue'
                        : r.statusType === 'yellow'
                        ? 'card-due-soon'
                        : r.statusType === 'green'
                        ? 'card-on-track'
                        : 'card-uninspected'
                    }`}
                    onClick={() => setSelectedVessel(r.vessel)}
                  >
                    {/* Card Head: Avatar, Name & Status Pill */}
                    <div className="fsm-card-head">
                      <div className="fsm-vessel-info">
                        <div className={`fsm-avatar ${r.statusType}`}>
                          <ShipIcon width={16} height={16} />
                        </div>
                        <div className="fsm-names">
                          <span className="fsm-name">{r.vessel.name}</span>
                          <span className="fsm-meta">
                            {r.vessel.imo ? `IMO ${r.vessel.imo} · ` : ''}
                            {r.vessel.vesselType || 'Fleet Vessel'}
                          </span>
                        </div>
                      </div>

                      <div className="fsm-status-group">
                        {r.reportRef !== '—' && (
                          <span className="fsm-ref-pill">{r.reportRef}</span>
                        )}
                        <div className={`ft-status-pill ${r.statusType}`}>
                          <span className="ft-status-dot" />
                          <span>{r.statusLabel}</span>
                        </div>
                      </div>
                    </div>

                    {/* In-Progress Highlight Banner */}
                    {r.isInProgress && (
                      <div className="fsm-active-banner">
                        <span className="ft-pulse-dot" />
                        <span>Survey Underway · Started {r.dateCommenced}</span>
                      </div>
                    )}

                    {/* 2x2 Details Grid */}
                    <div className="fsm-grid">
                      <div className="fsm-grid-item">
                        <span className="fsm-grid-label">Survey Dates</span>
                        <div className="fsm-grid-val-row">
                          <CalendarIcon width={12} height={12} />
                          <strong className="fsm-grid-val">
                            {r.isInProgress ? `Started ${r.dateCommenced}` : r.dateCompleted !== '—' ? r.dateCompleted : r.lastInspectionDate}
                          </strong>
                        </div>
                        {r.dateCommenced !== '—' && !r.isInProgress && (
                          <span className="fsm-grid-sub">Commenced: {r.dateCommenced}</span>
                        )}
                      </div>

                      <div className="fsm-grid-item">
                        <span className="fsm-grid-label">Surveyor</span>
                        <div className="fsm-grid-val-row">
                          <UserIcon width={12} height={12} />
                          <strong className="fsm-grid-val">{r.inspectorName}</strong>
                        </div>
                      </div>

                      <div className="fsm-grid-item">
                        <span className="fsm-grid-label">Modality & Port</span>
                        <div className="fsm-grid-val-row">
                          <AnchorIcon width={12} height={12} />
                          <strong className="fsm-grid-val">
                            {r.typeLabel !== '—' ? `${r.typeLabel}` : '—'}
                          </strong>
                        </div>
                        {r.portLabel !== '—' && <span className="fsm-grid-sub">{r.portLabel}</span>}
                      </div>

                      <div className="fsm-grid-item">
                        <span className="fsm-grid-label">Statutory Due</span>
                        <div className="fsm-grid-val-row">
                          <strong className={`fsm-grid-val ${r.statusType}`}>{r.nextDueFormatted}</strong>
                        </div>
                        {r.daysInfo && (
                          <span className={`fsm-sub-badge ${r.statusType}`}>{r.daysInfo.text}</span>
                        )}
                      </div>
                    </div>

                    {/* 6-Month Statutory Progress Bar */}
                    {r.cyclePct > 0 && r.statusType !== 'uninspected' && (
                      <div className="fsm-cycle-wrap">
                        <div className="fsm-cycle-header">
                          <span>6-Month Cycle</span>
                          <span>{r.cyclePct}% elapsed</span>
                        </div>
                        <div className="ft-cycle-progress-wrap" style={{ maxWidth: '100%' }}>
                          <div
                            className={`ft-cycle-bar ${r.statusType === 'in_progress' ? 'blue' : r.statusType}`}
                            style={{ width: `${r.cyclePct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Mobile Card Action Buttons */}
                    <div className="fsm-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="fsm-btn history"
                        onClick={() => setSelectedVessel(r.vessel)}
                      >
                        <EyeIcon width={13} height={13} /> History
                      </button>
                      {canCreateInspection && (
                        <button
                          type="button"
                          className="fsm-btn new"
                          onClick={() => nav(`/inspections/new?vesselId=${r.vessel.id}`)}
                        >
                          <PlusIcon width={13} height={13} /> New Survey
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── FOOTER FLEET COMPLIANCE NOTE ── */}
        <div className="fs-table-footer-note">
          <span>Showing {filteredRows.length} of {rows.length} total vessels in fleet registry</span>
          <span>Next statutory inspection due dates calculated strictly 6 calendar months from last completed survey.</span>
        </div>

      </div>

      {/* ── 6. VESSEL INSPECTION HISTORY MODAL ── */}
      {selectedVessel && (
        <div className="fs-modal-backdrop" onClick={() => setSelectedVessel(null)}>
          <div className="fs-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="fs-modal-header">
              <div className="fs-modal-title-group">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="fs-modal-icon-badge">
                    <ShipIcon width={22} height={22} />
                  </div>
                  <div>
                    <h3 className="fs-modal-title">{selectedVessel.name}</h3>
                    <div className="fs-modal-sub">
                      {selectedVessel.vesselType || 'Fleet Vessel'} · {selectedVessel.imo ? `IMO ${selectedVessel.imo}` : 'No IMO recorded'}
                    </div>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="fs-modal-close"
                onClick={() => setSelectedVessel(null)}
                aria-label="Close modal"
              >
                <XIcon width={16} height={16} />
              </button>
            </div>

            <div className="fs-modal-body">
              <div className="fs-modal-summary-strip">
                <div>
                  <span className="fs-sum-label">Recorded Surveys</span>
                  <strong className="fs-sum-val">{selectedVesselHistory.length} Total</strong>
                </div>
                <div>
                  <span className="fs-sum-label">Statutory Status</span>
                  <span className={`fleet-status-chip ${selectedRow?.statusType || 'uninspected'}`}>
                    {selectedRow?.statusLabel || 'Not Inspected'}
                  </span>
                </div>
                <div>
                  <span className="fs-sum-label">Statutory Next Due</span>
                  <strong className="fs-sum-val">
                    {selectedRow?.nextDueFormatted || 'Pending First Survey'}
                  </strong>
                </div>
              </div>

              {selectedVesselHistory.length === 0 ? (
                <div className="fs-empty-card" style={{ padding: '32px 16px', margin: 0 }}>
                  <ShipIcon width={32} height={32} />
                  <p style={{ marginTop: 8 }}>No statutory inspections recorded for this vessel yet.</p>
                </div>
              ) : (
                <div className="fs-history-list">
                  {selectedVesselHistory.map((insp) => {
                    const isApproved = insp.status === 'approved';
                    const typeLabel = insp.inspectionType === 'port'
                      ? 'In Port Survey'
                      : insp.inspectionType === 'remote'
                      ? 'Remote Survey'
                      : 'While Sailing';
                    const portStr = insp.inspectionType === 'sailing'
                      ? (insp.sailFromPort && insp.sailToPort ? `${insp.sailFromPort} → ${insp.sailToPort}` : insp.sailFromPort || insp.sailToPort || 'At Sea')
                      : (insp.port || '—');
                    const refCode = `VIR-${insp.id.slice(0, 8).toUpperCase()}`;

                    return (
                      <div key={insp.id} className="fs-inspection-card">
                        {/* Executive Header Banner matching Image 2 */}
                        <div className="fs-ic-header">
                          <div className="fs-ic-header-left">
                            <span className="fs-ic-header-title">Inspection Details</span>
                            <span className={`status-chip ${isApproved ? 'complete' : 'progress'}`}>
                              {isApproved ? 'Approved' : 'In Progress'}
                            </span>
                          </div>
                          <div className="fs-ic-header-right">
                            <span className="fs-ic-ref-badge">{refCode}</span>
                          </div>
                        </div>

                        {/* Structured 2-Column Data Grid matching Image 2 */}
                        <div className="fs-ic-body">
                          <div className="fs-ic-grid">
                            <div className="fs-ic-field">
                              <span className="fs-ic-label">SURVEY TYPE</span>
                              <strong className="fs-ic-value text-teal">{typeLabel}</strong>
                            </div>

                            <div className="fs-ic-field">
                              <span className="fs-ic-label">AUDITOR / SURVEYOR / SUPERINTENDENT</span>
                              <strong className="fs-ic-value text-teal">{insp.inspector || '—'}</strong>
                            </div>

                            <div className="fs-ic-field">
                              <span className="fs-ic-label">PORT / LOCATION</span>
                              <strong className="fs-ic-value text-teal">{portStr}</strong>
                            </div>

                            <div className="fs-ic-field">
                              <span className="fs-ic-label">REPORT REFERENCE</span>
                              <strong className="fs-ic-value text-teal ref-code">{refCode}</strong>
                            </div>

                            <div className="fs-ic-field">
                              <span className="fs-ic-label">DATE COMMENCED</span>
                              <strong className="fs-ic-value">{fmtDate(insp.startDate)}</strong>
                            </div>

                            <div className="fs-ic-field">
                              <span className="fs-ic-label">DATE COMPLETED</span>
                              <strong className="fs-ic-value">
                                {insp.completionDate ? fmtDate(insp.completionDate) : isApproved ? fmtDate(insp.startDate) : 'Underway · In Progress'}
                              </strong>
                            </div>
                          </div>

                          <div className="fs-ic-actions">
                            {isApproved ? (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 15px' }}
                                onClick={() => {
                                  setSelectedVessel(null);
                                  nav(`/inspections/${insp.id}/report`);
                                }}
                              >
                                <FileIcon width={14} height={14} /> View Report & PDF
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 15px' }}
                                onClick={() => {
                                  setSelectedVessel(null);
                                  nav(`/inspections/${insp.id}`);
                                }}
                              >
                                <EditIcon width={14} height={14} /> Continue Active Survey
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="fs-modal-footer">
              {canCreateInspection && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => {
                    setSelectedVessel(null);
                    nav(`/inspections/new?vesselId=${selectedVessel.id}`);
                  }}
                >
                  <PlusIcon width={14} height={14} /> Start New Survey
                </button>
              )}
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setSelectedVessel(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(ms?: number | string | null | Date) {
  if (!ms) return '—';
  const d = ms instanceof Date ? ms : new Date(typeof ms === 'string' && !ms.includes('T') ? `${ms}T00:00:00` : ms);
  if (isNaN(d.getTime())) return String(ms);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Recent';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.round(diffDays / 30.4375);
  if (diffMonths === 1) return '1 month ago';
  if (diffMonths < 12) return `${diffMonths} mos ago`;
  const diffYears = Math.round(diffMonths / 12);
  return `${diffYears} ${diffYears === 1 ? 'yr' : 'yrs'} ago`;
}

function getDaysRemaining(nextDueDate?: Date | null): { days: number; text: string } | null {
  if (!nextDueDate) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(nextDueDate);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - now.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) {
    return { days, text: `${Math.abs(days)}d overdue` };
  }
  if (days === 0) {
    return { days, text: 'Due today' };
  }
  return { days, text: `${days}d left` };
}
