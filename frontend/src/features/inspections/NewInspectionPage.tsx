import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { InspectionType, ReportCategory, User } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { createInspection, createInspectionWithNewVessel } from '../../offline/createInspection';
import { VesselCoreFields, type VesselCoreForm } from '../vessels/VesselCoreFields';
import { BackIcon, WifiIcon, ShipIcon, AnchorIcon, CheckCircleIcon, WarningIcon } from '../../icons';
import './NewInspectionPage.css';

const TYPE_LABELS: Record<InspectionType, { label: string; sub: string; icon: React.ReactNode }> = {
  port:    { label: 'In Port',       sub: 'Vessel is docked at port',    icon: <AnchorIcon style={{width:24,height:24}} /> },
  remote:  { label: 'Remote',        sub: 'Inspection without boarding',  icon: <WifiIcon style={{width:24,height:24}} /> },
  sailing: { label: 'While Sailing', sub: 'Vessel underway at sea',       icon: <ShipIcon style={{width:24,height:24}} /> },
};

const REPORT_LABELS: Record<ReportCategory, { label: string; sub: string }> = {
  inspection:    { label: 'Inspection Report', sub: 'Standard inspection of a registered vessel' },
  pre_purchase:  { label: 'Pre Purchase Report', sub: 'Photo survey of a vessel under purchase review' },
  take_over:     { label: 'Take Over Report', sub: 'Photo survey of a vessel being taken over' },
};

// ─── Small form field wrapper ──────────────────────────────────────────────
function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: 'var(--faint)' }}>{hint}</span>}
    </label>
  );
}

import { useCurrentUser } from '../../auth/useCurrentUser';

export function NewInspectionPage() {
  const nav = useNavigate();
  const me = useCurrentUser();

  useEffect(() => {
    if (me.data?.role === 'director') {
      nav('/', { replace: true });
    }
  }, [me.data, nav]);

  useQuery({
    queryKey: ['remote-vessels', 'new-inspection', me.data?.id],
    enabled: navigator.onLine,
    queryFn: async () => {
      try {
        const remote = await api<any[]>('/vessels');
        if (Array.isArray(remote) && remote.length > 0) {
          const pendingVesselIds = new Set(
            (await db.outbox.where('entity').equals('vessels').toArray()).map((m) => m.entityId),
          );
          const toPut = remote.filter((v) => !pendingVesselIds.has(v.id));
          if (toPut.length > 0) {
            await db.vessels.bulkPut(toPut as any);
          }
        }
        return remote;
      } catch {
        return [];
      }
    },
    staleTime: 5_000,
  });

  const rawVessels = useLiveQuery(() => db.vessels.toArray(), []) ?? [];
  const vessels = useMemo(() => {
    return rawVessels
      .filter((v) => !(v as any).deletedAt && (v as any).registrationStatus !== 'unregistered')
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rawVessels]);
  const templateSections = (useLiveQuery(() => db.templateSections.toArray(), []) ?? [])
    .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));

  // TM and VM can only create inspections for their assigned vessels
  const displayVessels = useMemo(() => {
    if (me.data?.role === 'admin' || me.data?.role === 'director' || !me.data) {
      return vessels;
    }
    const ids = (me.data?.vesselIds ?? []).map(id => id.toLowerCase().trim());
    return vessels.filter((v) => ids.includes(v.id.toLowerCase().trim()));
  }, [vessels, me.data]);

  const [reportCategory, setReportCategory] = useState<ReportCategory>('inspection');
  const [vesselId, setVesselId] = useState('');
  const [newVessel, setNewVessel] = useState<VesselCoreForm>({ name: '', imo: '', vesselType: 'Bulk Carrier' });
  const [inspectionType, setInspectionType] = useState<InspectionType>('port');
  const [port, setPort] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [completionDate, setCompletionDate] = useState('');
  const [sailFromDate, setSailFromDate] = useState('');
  const [sailFromPort, setSailFromPort] = useState('');
  const [sailToDate, setSailToDate] = useState('');
  const [sailToPort, setSailToPort] = useState('');
  const [remoteFromDate, setRemoteFromDate] = useState('');
  const [remoteToDate, setRemoteToDate] = useState('');
  const [inspector, setInspector] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNewVesselReport = reportCategory !== 'inspection';
  const vessel = displayVessels.find((v) => v.id === vesselId);

  function getSectionCountForVesselType(vesselType?: string | null, photoOnly = false): number {
    const vt = vesselType?.trim().toLowerCase() ?? '';
    let matching = templateSections.filter((s) => {
      if ((s as any).deletedAt) return false;
      const types: string[] = Array.isArray((s as any).vesselTypes) ? (s as any).vesselTypes : [];
      if (!vt) return types.length === 0;
      return types.some((t) => t.trim().toLowerCase() === vt);
    });
    if (photoOnly) {
      matching = matching.filter((s) => Boolean((s as any).photoOnly));
    }
    return new Set(matching.map((s) => `${String(s.name ?? '').trim().toLowerCase()}::${Boolean(s.photoOnly)}`)).size;
  }

  const selectedVesselSectionCount = vessel ? getSectionCountForVesselType(vessel.vesselType, isNewVesselReport) : 0;
  const newVesselSectionCount = isNewVesselReport ? getSectionCountForVesselType(newVessel.vesselType, true) : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);

    const finalStartDate = (inspectionType === 'sailing'
      ? (sailFromDate || startDate)
      : inspectionType === 'remote'
      ? (remoteFromDate || startDate)
      : startDate) || null;

    const finalCompletionDate = (inspectionType === 'sailing'
      ? (sailToDate || completionDate)
      : inspectionType === 'remote'
      ? (remoteToDate || completionDate)
      : completionDate) || null;

    if (finalStartDate && finalCompletionDate && finalCompletionDate < finalStartDate) {
      setError('Inspection completion date cannot be earlier than start date');
      setBusy(false);
      return;
    }

    const finalPort = inspectionType === 'sailing'
      ? [sailFromPort, sailToPort].filter(Boolean).join(' → ')
      : port;

    if (isNewVesselReport) {
      if (!newVessel.name.trim()) { setError('Vessel name is required'); setBusy(false); return; }
      if (!newVessel.imo.trim()) { setError('IMO number is required'); setBusy(false); return; }
      try {
        const id = await createInspectionWithNewVessel({
          newVessel: { name: newVessel.name.trim(), imo: newVessel.imo.trim(), vesselType: newVessel.vesselType.trim() },
          vesselName: newVessel.name.trim(), imo: newVessel.imo.trim(), vesselType: newVessel.vesselType.trim(),
          inspectionType, reportCategory,
          port: finalPort,
          startDate: finalStartDate,
          completionDate: finalCompletionDate,
          sailFromDate: inspectionType === 'sailing' ? finalStartDate : null,
          sailFromPort: inspectionType === 'sailing' ? sailFromPort : '',
          sailToDate: inspectionType === 'sailing' ? finalCompletionDate : null,
          sailToPort: inspectionType === 'sailing' ? sailToPort : '',
          remoteFromDate: inspectionType === 'remote' ? finalStartDate : null,
          remoteToDate: inspectionType === 'remote' ? finalCompletionDate : null,
          inspector, company,
        });
        nav(`/inspections/${id}`, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create the inspection');
        setBusy(false);
      }
      return;
    }

    const realVessel = vessels.find((v) => v.id === vesselId);
    if (!realVessel) { setError('Pick a vessel'); setBusy(false); return; }
    try {
      const id = await createInspection({
        vesselId: realVessel.id, vesselName: realVessel.name, imo: realVessel.imo, vesselType: realVessel.vesselType,
        inspectionType, reportCategory,
        port: finalPort,
        startDate: finalStartDate,
        completionDate: finalCompletionDate,
        sailFromDate: inspectionType === 'sailing' ? finalStartDate : null,
        sailFromPort: inspectionType === 'sailing' ? sailFromPort : '',
        sailToDate: inspectionType === 'sailing' ? finalCompletionDate : null,
        sailToPort: inspectionType === 'sailing' ? sailToPort : '',
        remoteFromDate: inspectionType === 'remote' ? finalStartDate : null,
        remoteToDate: inspectionType === 'remote' ? finalCompletionDate : null,
        inspector, company,
      });
      nav(`/inspections/${id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the inspection');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => nav('/')}><BackIcon /></button>
        <div className="title-wrap"><h1>New Inspection</h1></div>
      </div>

      <div className="page-wrap">
        <form onSubmit={onSubmit} style={{ margin: '16px 0' }}>
          {error && (
            <div style={{ margin: '0 16px 12px', padding: '12px 14px', borderRadius: 10, background: 'var(--bad-tint)', border: '1px solid var(--bad)', color: 'var(--bad)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <WarningIcon width={16} height={16} /> {error}
            </div>
          )}

          {/* Report type */}
          <div className="ni-card">
            <div className="ni-card-header">
              Report Type
            </div>
            <div className="ni-type-grid">
              {(Object.keys(REPORT_LABELS) as ReportCategory[]).map((c) => {
                const { label, sub } = REPORT_LABELS[c];
                const isSelected = reportCategory === c;
                return (
                  <button
                    key={c}
                    type="button"
                    className={`ni-type-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => setReportCategory(c)}
                  >
                    <span className="ni-type-label">{label}</span>
                    <span className="ni-type-sub">{sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Vessel selection */}
          {isNewVesselReport ? (
            <div className="ni-card">
              <div className="ni-card-header">
                New Vessel
              </div>
              <VesselCoreFields form={newVessel} setForm={setNewVessel} />
              {newVessel.vesselType.trim() && newVesselSectionCount === 0 && (
                <div className="ni-summary-banner ni-summary-warn" style={{ marginTop: 14 }}>
                  <WarningIcon width={22} height={22} style={{ color: '#b45309', flexShrink: 0 }} />
                  <div className="ni-summary-body">
                    <div className="ni-summary-title">No checklist sections configured for {newVessel.vesselType}</div>
                    <div className="ni-summary-sub">
                      This inspection will be created empty (0 sections). You can add photo sections during the inspection.
                      {me.data?.role === 'admin'
                        ? ' Or open Checklist Templates to configure sections for this vessel type.'
                        : ''}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="ni-card">
              <div className="ni-card-header">
                Select Vessel
              </div>
              {displayVessels.length === 0 ? (
                <div className="empty-state" style={{ margin: 0 }}>
                  <p>
                    {me.data?.role === 'techManager' || me.data?.role === 'vesselManager'
                      ? 'No vessels assigned to you. Ask an Admin to assign vessels to your account.'
                      : 'No vessels yet. Ask an Admin to add one under Vessels.'}
                  </p>
                </div>
              ) : (
                <div className="ni-vessel-grid">
                  {displayVessels.map((v) => {
                    const isSelected = vesselId === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={`ni-vessel-pill ${isSelected ? 'selected' : ''}`}
                        onClick={() => setVesselId(v.id)}
                        title={`${v.name} (${v.vesselType || 'Vessel'}) · IMO ${v.imo || 'N/A'}`}
                      >
                        <ShipIcon width={14} height={14} />
                        <span>{v.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Inspection type */}
          <div className="ni-card">
            <div className="ni-card-header">
              Inspection Type
            </div>
            <div className="ni-type-grid">
              {(Object.keys(TYPE_LABELS) as InspectionType[]).map((t) => {
                const { label, sub, icon } = TYPE_LABELS[t];
                const isSelected = inspectionType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    className={`ni-type-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => setInspectionType(t)}
                  >
                    <div className="ni-type-icon">{icon}</div>
                    <span className="ni-type-label">{label}</span>
                    <span className="ni-type-sub">{sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Details */}
          <div className="ni-card">
            <div className="ni-card-header">Inspection Details</div>

            {/* In Port Details */}
            {inspectionType === 'port' && (
              <>
                <div className="ni-form-row" style={{ marginBottom: 14 }}>
                  <FieldGroup label="Port of inspection">
                    <input
                      className="auth-input"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="e.g. Port of Singapore"
                    />
                  </FieldGroup>
                  <FieldGroup label="Inspection start date">
                    <input
                      className="auth-input"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                    />
                  </FieldGroup>
                </div>

                <div className="ni-form-row" style={{ marginBottom: 14 }}>
                  <FieldGroup label="Inspection completion date">
                    <input
                      className="auth-input"
                      type="date"
                      value={completionDate}
                      min={startDate}
                      onChange={(e) => setCompletionDate(e.target.value)}
                    />
                  </FieldGroup>
                  <div />
                </div>
              </>
            )}

            {/* Sailing inspection period */}
            {inspectionType === 'sailing' && (
              <div className="ni-period-group">
                <div className="ni-period-header">Sailing inspection period & ports</div>
                <div className="ni-form-row" style={{ marginBottom: 14 }}>
                  <FieldGroup label="Sailing from port">
                    <input
                      className="auth-input"
                      value={sailFromPort}
                      onChange={(e) => setSailFromPort(e.target.value)}
                      placeholder="e.g. Singapore"
                    />
                  </FieldGroup>
                  <FieldGroup label="Sailing from date (Start date)">
                    <input
                      className="auth-input"
                      type="date"
                      value={sailFromDate || startDate}
                      onChange={(e) => {
                        setSailFromDate(e.target.value);
                        setStartDate(e.target.value);
                      }}
                      required
                    />
                  </FieldGroup>
                </div>
                <div className="ni-form-row">
                  <FieldGroup label="Sailing to port">
                    <input
                      className="auth-input"
                      value={sailToPort}
                      onChange={(e) => setSailToPort(e.target.value)}
                      placeholder="e.g. Rotterdam"
                    />
                  </FieldGroup>
                  <FieldGroup label="Sailing to date (Completion date)">
                    <input
                      className="auth-input"
                      type="date"
                      value={sailToDate || completionDate}
                      min={sailFromDate || startDate}
                      onChange={(e) => {
                        setSailToDate(e.target.value);
                        setCompletionDate(e.target.value);
                      }}
                    />
                  </FieldGroup>
                </div>
              </div>
            )}

            {/* Remote inspection period */}
            {inspectionType === 'remote' && (
              <div className="ni-period-group">
                <div className="ni-period-header">Remote inspection period & location</div>
                <div className="ni-form-row" style={{ marginBottom: 14 }}>
                  <FieldGroup label="Port / Location">
                    <input
                      className="auth-input"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="e.g. Singapore / Remote Office"
                    />
                  </FieldGroup>
                  <FieldGroup label="Remote from date (Start date)">
                    <input
                      className="auth-input"
                      type="date"
                      value={remoteFromDate || startDate}
                      onChange={(e) => {
                        setRemoteFromDate(e.target.value);
                        setStartDate(e.target.value);
                      }}
                      required
                    />
                  </FieldGroup>
                </div>
                <div className="ni-form-row">
                  <FieldGroup label="Remote to date (Completion date)">
                    <input
                      className="auth-input"
                      type="date"
                      value={remoteToDate || completionDate}
                      min={remoteFromDate || startDate}
                      onChange={(e) => {
                        setRemoteToDate(e.target.value);
                        setCompletionDate(e.target.value);
                      }}
                    />
                  </FieldGroup>
                  <div />
                </div>
              </div>
            )}

            <div className="ni-form-row">
              <FieldGroup label="Inspector name">
                <input className="auth-input" value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="e.g. Capt. J. Rao" />
              </FieldGroup>
              <FieldGroup label="Company / rank">
                <input className="auth-input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Ozellar Marine" />
              </FieldGroup>
            </div>
          </div>

          {/* Selected vessel summary & checklist status */}
          {vessel && (
            <div className={`ni-summary-banner ${selectedVesselSectionCount === 0 && vessel.vesselType ? 'ni-summary-warn' : ''}`}>
              {selectedVesselSectionCount === 0 && vessel.vesselType ? (
                <WarningIcon width={22} height={22} style={{ color: '#b45309', flexShrink: 0 }} />
              ) : (
                <CheckCircleIcon width={22} height={22} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              )}
              <div className="ni-summary-body">
                <div className="ni-summary-title">
                  {vessel.name} {vessel.vesselType ? `(${vessel.vesselType})` : ''}
                </div>
                <div className="ni-summary-sub">
                  {TYPE_LABELS[inspectionType].label}
                  {inspectionType === 'sailing' && (sailFromPort || sailToPort) && (
                    <> · {[sailFromPort, sailToPort].filter(Boolean).join(' → ')}</>
                  )}
                  {inspectionType !== 'sailing' && port && <> · {port}</>}
                  {inspectionType === 'sailing' && (
                    <> · {[sailFromDate || startDate, sailToDate || completionDate].filter(Boolean).join(' to ')}</>
                  )}
                  {inspectionType === 'remote' && (
                    <> · {[remoteFromDate || startDate, remoteToDate || completionDate].filter(Boolean).join(' to ')}</>
                  )}
                  {inspectionType === 'port' && (
                    <> · {startDate}{completionDate ? ` to ${completionDate}` : ''}</>
                  )}
                  {' · '}
                  <strong>{selectedVesselSectionCount} checklist section{selectedVesselSectionCount === 1 ? '' : 's'}</strong>
                </div>
                {selectedVesselSectionCount === 0 && vessel.vesselType && (
                  <div className="ni-checklist-warn-row">
                    <span>
                      No checklist sections are configured for <strong>{vessel.vesselType}</strong> yet.
                      This inspection will be created empty (0 sections). You can add photo sections during the inspection.
                      {me.data?.role === 'admin'
                        ? ' Or open Checklist Templates to configure sections for this vessel type.'
                        : ''}
                    </span>
                    {me.data?.role === 'admin' && (
                      <button
                        type="button"
                        className="ni-configure-checklist-btn"
                        onClick={() => nav(`/checklist?category=${encodeURIComponent(vessel.vesselType)}`)}
                      >
                        Configure {vessel.vesselType} Checklist →
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="ni-submit-wrap">
            <button
              className="ni-submit-btn"
              type="submit"
              disabled={busy || (isNewVesselReport
                ? !newVessel.name.trim() || !newVessel.imo.trim()
                : !vesselId || displayVessels.length === 0)}
            >
              {busy ? 'Creating inspection…' : 'Start Inspection'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
