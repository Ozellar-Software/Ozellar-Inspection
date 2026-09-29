import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import type { InspectionType } from '@ozellar/shared';
import { db } from '../../offline/db';
import { createInspection } from '../../offline/createInspection';
import { BackIcon } from '../../icons';

const TYPE_LABELS: Record<InspectionType, string> = { port: 'In port', remote: 'Remote', sailing: 'While sailing' };

export function NewInspectionPage() {
  const nav = useNavigate();
  const vessels = useLiveQuery(() => db.vessels.orderBy('name').toArray(), []) ?? [];

  const [vesselId, setVesselId] = useState('');
  const [inspectionType, setInspectionType] = useState<InspectionType>('port');
  const [port, setPort] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [inspector, setInspector] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vessel = vessels.find((v) => v.id === vesselId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vessel) { setError('Pick a vessel'); return; }
    setBusy(true); setError(null);
    try {
      const id = await createInspection({
        vesselId: vessel.id, vesselName: vessel.name, imo: vessel.imo, vesselType: vessel.vesselType,
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
        <div className="title-wrap"><h1>New inspection</h1></div>
      </div>

      <div className="page-wrap">
        <form onSubmit={onSubmit} className="section-pad" style={{ margin: '16px 0', display: 'grid', gap: 14 }}>
          {error && <div className="auth-error">{error}</div>}

          <label style={{ display: 'grid', gap: 6 }}>
            <span className="seg-label">VESSEL</span>
            {vessels.length === 0 ? (
              <div className="empty-state" style={{ margin: 0 }}><p>No vessels yet. Ask an Admin to add one under Vessels.</p></div>
            ) : (
              <select className="auth-input" value={vesselId} onChange={(e) => setVesselId(e.target.value)} required>
                <option value="" disabled>Select a vessel…</option>
                {vessels.map((v) => <option key={v.id} value={v.id}>{v.name}{v.imo ? ` — IMO ${v.imo}` : ''}</option>)}
              </select>
            )}
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span className="seg-label">INSPECTION TYPE</span>
            <div className="seg">
              {(Object.keys(TYPE_LABELS) as InspectionType[]).map((t) => (
                <button key={t} type="button" className={inspectionType === t ? 'selected' : ''} onClick={() => setInspectionType(t)}>
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span className="seg-label">PORT</span>
            <input className="auth-input" value={port} onChange={(e) => setPort(e.target.value)} placeholder="e.g. Singapore" />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span className="seg-label">DATE</span>
            <input className="auth-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span className="seg-label">INSPECTOR</span>
            <input className="auth-input" value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Your name" />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span className="seg-label">COMPANY</span>
            <input className="auth-input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Inspecting company" />
          </label>

          <button className="btn btn-primary btn-block" type="submit" disabled={busy || vessels.length === 0}>
            {busy ? 'Creating…' : 'Start inspection'}
          </button>
        </form>
      </div>
    </>
  );
}
