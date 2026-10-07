import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { InspectionType, User } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { createInspection } from '../../offline/createInspection';
import { BackIcon, WifiIcon, ShipIcon, AnchorIcon, CheckCircleIcon, WarningIcon } from '../../icons';
import './NewInspectionPage.css';

const TYPE_LABELS: Record<InspectionType, { label: string; sub: string; icon: React.ReactNode }> = {
  port:    { label: 'In Port',       sub: 'Vessel is docked at port',    icon: <AnchorIcon style={{width:24,height:24}} /> },
  remote:  { label: 'Remote',        sub: 'Inspection without boarding',  icon: <WifiIcon style={{width:24,height:24}} /> },
  sailing: { label: 'While Sailing', sub: 'Vessel underway at sea',       icon: <ShipIcon style={{width:24,height:24}} /> },
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

  const vessels = useLiveQuery(() => db.vessels.orderBy('name').toArray(), []) ?? [];
  // TM and VM can only create inspections for their assigned vessels
  const displayVessels = (me.data?.role === 'admin' || me.data?.role === 'director' || !me.data)
    ? vessels
    : vessels.filter((v) => {
        const ids = (me.data?.vesselIds ?? []).map(id => id.toLowerCase().trim());
        return ids.includes(v.id.toLowerCase().trim());
      });

  const [vesselId, setVesselId] = useState('');
  const [inspectionType, setInspectionType] = useState<InspectionType>('port');
  const [port, setPort] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [inspector, setInspector] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vessel = displayVessels.find((v) => v.id === vesselId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const realVessel = vessels.find((v) => v.id === vesselId);
    if (!realVessel) { setError('Pick a vessel '); return; }
    setBusy(true); setError(null);
    try {
      const id = await createInspection({
        vesselId: realVessel.id, vesselName: realVessel.name, imo: realVessel.imo, vesselType: realVessel.vesselType,
        inspectionType, port, startDate: startDate || null, inspector, company,
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

          {/* Vessel selection */}
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
              <div className="ni-vessel-list">
                {displayVessels.map((v) => {
                  const isSelected = vesselId === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      className={`ni-vessel-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => setVesselId(v.id)}
                    >
                      <div className="ni-vessel-icon-wrap">
                        <ShipIcon style={{ width: 22, height: 22 }} />
                      </div>
                      <div className="ni-vessel-details">
                        <div className="ni-vessel-name">{v.name}</div>
                        <div className="ni-vessel-meta">
                          {[v.imo && `IMO ${v.imo}`, v.vesselType].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {isSelected && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="ni-vessel-check">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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

            <div className="ni-form-row" style={{ marginBottom: 14 }}>
              <FieldGroup label="Port / Location">
                <input className="auth-input" value={port} onChange={(e) => setPort(e.target.value)} placeholder="e.g. Singapore" />
              </FieldGroup>
              <FieldGroup label="Date">
                <input className="auth-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </FieldGroup>
            </div>

            <div className="ni-form-row">
              <FieldGroup label="Inspector name">
                <input className="auth-input" value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Your name" />
              </FieldGroup>
              <FieldGroup label="Inspecting company">
                <input className="auth-input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" />
              </FieldGroup>
            </div>
          </div>

          {/* Selected vessel summary */}
          {vessel && (
            <div className="ni-summary-banner">
              <CheckCircleIcon width={22} height={22} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <div>
                <div className="ni-summary-title">{vessel.name}</div>
                <div className="ni-summary-sub">{TYPE_LABELS[inspectionType].label} · {port || 'No port set'} · {startDate}</div>
              </div>
            </div>
          )}

          <div className="ni-submit-wrap">
            <button
              className="ni-submit-btn"
              type="submit"
              disabled={busy || displayVessels.length === 0}
            >
              {busy ? 'Creating inspection…' : 'Start Inspection'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
