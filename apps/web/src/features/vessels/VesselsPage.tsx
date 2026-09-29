import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { User, Vessel, VesselParticularKey } from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import { BackIcon, PlusIcon } from '../../icons';
import { PARTICULAR_GROUPS, PARTICULAR_LABELS } from './particulars';

type ParticularsForm = Partial<Record<VesselParticularKey, string>>;
interface VesselForm { id?: string; name: string; imo: string; vesselType: string; particulars: ParticularsForm }

const blank: VesselForm = { name: '', imo: '', vesselType: '', particulars: {} };

export function VesselsPage() {
  const nav = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });
  const vessels = useLiveQuery(() => db.vessels.orderBy('name').toArray(), []) ?? [];
  const isAdmin = me.data?.role === 'admin';

  const [form, setForm] = useState<VesselForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startNew() { setForm(blank); setError(null); }
  function startEdit(v: Vessel) {
    setForm({ id: v.id, name: v.name, imo: v.imo, vesselType: v.vesselType, particulars: { ...v.particulars } });
    setError(null);
  }
  function setField(key: VesselParticularKey, value: string) {
    setForm((f) => (f ? { ...f, particulars: { ...f.particulars, [key]: value } } : f));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const created = await api<Vessel>('/vessels', {
        method: 'POST',
        body: { id: form.id ?? crypto.randomUUID(), name: form.name, imo: form.imo, vesselType: form.vesselType, particulars: form.particulars },
      });
      await db.vessels.put(created); // vessels aren't queued through the offline outbox (Admin-only, needs a live connection) — write the server's own copy locally right away
      setForm(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this vessel');
    } finally {
      setBusy(false);
    }
  }

  if (form) {
    return (
      <>
        <div className="appbar">
          <button className="back" aria-label="Back" onClick={() => setForm(null)}><BackIcon /></button>
          <div className="title-wrap"><h1>{form.id ? 'Edit vessel' : 'Add vessel'}</h1></div>
        </div>

        <div className="page-wrap">
          <form onSubmit={onSave} style={{ margin: '16px 0' }}>
            {error && <div className="section-pad"><div className="auth-error">{error}</div></div>}

            <div className="section-pad" style={{ display: 'grid', gap: 14 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span className="seg-label">VESSEL NAME</span>
                <input className="auth-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span className="seg-label">IMO NUMBER</span>
                <input className="auth-input" value={form.imo} onChange={(e) => setForm({ ...form, imo: e.target.value })} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span className="seg-label">VESSEL TYPE</span>
                <input className="auth-input" value={form.vesselType} onChange={(e) => setForm({ ...form, vesselType: e.target.value })} placeholder="e.g. Bulk Carrier" />
              </label>
            </div>

            {PARTICULAR_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="report-section-title">{group.title}</div>
                <div className="section-pad" style={{ display: 'grid', gap: 12 }}>
                  {group.keys.map((key) => (
                    <label key={key} style={{ display: 'grid', gap: 6 }}>
                      <span className="seg-label">{PARTICULAR_LABELS[key].toUpperCase()}</span>
                      <input className="auth-input" value={form.particulars[key] ?? ''} onChange={(e) => setField(key, e.target.value)} />
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div className="section-pad" style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => nav('/')}><BackIcon /></button>
        <div className="title-wrap"><h1>Vessels</h1></div>
      </div>

      <div className="page-wrap">
        {isAdmin && (
          <div className="section-pad fab-new" style={{ margin: '16px 16px 0' }}>
            <button className="btn btn-primary btn-block" onClick={startNew}><PlusIcon />Add vessel</button>
          </div>
        )}

        {vessels.length === 0 && (
          <div className="empty-state"><p>No vessels yet.{isAdmin ? ' Add your first one above.' : ' Ask an Admin to add your vessel.'}</p></div>
        )}
        {vessels.map((v) => {
          const particularsCount = Object.values(v.particulars ?? {}).filter(Boolean).length;
          return (
            <div key={v.id} className="inspection-card" style={{ cursor: isAdmin ? 'pointer' : 'default' }} onClick={() => isAdmin && startEdit(v)}>
              <div className="body">
                <div className="vname">{v.name}</div>
                <div className="vmeta">
                  {[v.imo && `IMO ${v.imo}`, v.vesselType].filter(Boolean).join(', ') || 'No details yet'}
                  {isAdmin && ` · ${particularsCount}/23 particulars filled`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
