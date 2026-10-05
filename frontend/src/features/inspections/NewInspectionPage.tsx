import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { InspectionType, User } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { createInspection } from '../../offline/createInspection';
import { BackIcon, WifiIcon, ShipIcon, AnchorIcon, CheckCircleIcon, WarningIcon } from '../../icons';

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

export function NewInspectionPage() {
  const nav = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });

  useEffect(() => {
    if (me.data?.role === 'director') {
      nav('/', { replace: true });
    }
  }, [me.data, nav]);

  const vessels = useLiveQuery(() => db.vessels.orderBy('name').toArray(), []) ?? [];
  // TM and VM can only create inspections for their assigned vessels
  const displayVessels = me.data?.role === 'admin' || me.data?.role === 'director'
    ? vessels
    : vessels.filter((v) => me.data?.vesselIds?.includes(v.id) ?? false);

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
          <div style={{ margin: '0 16px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 18px', boxShadow: '0 1px 4px rgba(11,33,56,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14 }}>
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
              <div style={{ display: 'grid', gap: 8 }}>
                {displayVessels.map((v) => {
                  const isSelected = vesselId === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                        borderRadius: 10, textAlign: 'left', width: '100%',
                        border: isSelected ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                        background: isSelected ? 'var(--accent-tint)' : '#fff',
                        cursor: 'pointer', transition: 'all 0.12s ease',
                      }}
                      onClick={() => setVesselId(v.id)}
                    >
                      <div style={{
                        width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                        background: isSelected ? 'var(--accent)' : '#E7EBEC',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, transition: 'background 0.12s ease',
                      }}><ShipIcon style={{width:24,height:24}} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14.5, color: isSelected ? 'var(--accent-dark)' : 'var(--ink)' }}>{v.name}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                          {[v.imo && `IMO ${v.imo}`, v.vesselType].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {isSelected && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0 }}>
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
          <div style={{ margin: '0 16px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 18px', boxShadow: '0 1px 4px rgba(11,33,56,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14 }}>
              Inspection Type
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {(Object.keys(TYPE_LABELS) as InspectionType[]).map((t) => {
                const { label, sub, icon } = TYPE_LABELS[t];
                const isSelected = inspectionType === t;
                return (
                  <button
                    key={t} type="button"
                    style={{
                      padding: '14px 10px', borderRadius: 10, textAlign: 'center',
                      border: isSelected ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                      background: isSelected ? 'var(--accent-tint)' : '#fff',
                      cursor: 'pointer', transition: 'all 0.12s ease', display: 'flex',
                      flexDirection: 'column', alignItems: 'center', gap: 6,
                    }}
                    onClick={() => setInspectionType(t)}
                  >
                    <span style={{ fontSize: 24 }}>{icon}</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: isSelected ? 'var(--accent-dark)' : 'var(--ink)', lineHeight: 1.2 }}>{label}</span>
                    <span style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.3 }}>{sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Details */}
          <div style={{ margin: '0 16px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 18px', boxShadow: '0 1px 4px rgba(11,33,56,0.06)', display: 'grid', gap: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspection Details</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FieldGroup label="Port / Location">
                <input className="auth-input" value={port} onChange={(e) => setPort(e.target.value)} placeholder="e.g. Singapore" />
              </FieldGroup>
              <FieldGroup label="Date">
                <input className="auth-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </FieldGroup>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
            <div style={{ margin: '0 16px 14px', padding: '12px 16px', borderRadius: 10, background: 'var(--accent-tint)', border: '1px solid var(--accent)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <CheckCircleIcon width={22} height={22} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--accent-dark)' }}>{vessel.name}</div>
                <div style={{ fontSize: 12, color: 'var(--accent)' }}>{TYPE_LABELS[inspectionType].label} · {port || 'No port set'} · {startDate}</div>
              </div>
            </div>
          )}

          <div style={{ margin: '0 16px 32px' }}>
            <button
              className="btn btn-primary btn-block"
              type="submit"
              disabled={busy || displayVessels.length === 0}
              style={{ borderRadius: 12, minHeight: 52, fontSize: 15, letterSpacing: '0.2px' }}
            >
              {busy ? 'Creating inspection…' : "Start Inspection"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
