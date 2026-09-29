import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABELS, type Role, type User } from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import { BackIcon, PlusIcon } from '../../icons';

interface UserRow extends User { hasPassword: boolean }
const ROLES: Role[] = ['vesselManager', 'techManager', 'director', 'admin'];
const blank = { id: '', email: '', name: '', designation: '', role: 'vesselManager' as Role, vesselIds: [] as string[], isActive: true };

export function UsersPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users'), enabled: me.data?.role === 'admin' });
  const designations = useQuery({ queryKey: ['designations'], queryFn: () => api<string[]>('/designations'), enabled: me.data?.role === 'admin' });
  const vessels = useLiveQuery(() => db.vessels.orderBy('name').toArray(), []) ?? [];

  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startNew() { setForm(blank); setEditing(true); setError(null); }
  function startEdit(u: UserRow) {
    setForm({ id: u.id, email: u.email, name: u.name, designation: u.designation, role: u.role, vesselIds: u.vesselIds, isActive: u.isActive });
    setEditing(true); setError(null);
  }
  function toggleVessel(id: string) {
    setForm((f) => ({ ...f, vesselIds: f.vesselIds.includes(id) ? f.vesselIds.filter((v) => v !== id) : [...f.vesselIds, id] }));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email.includes('@')) { setError('Enter a valid email'); return; }
    const needsVessels = form.role === 'techManager' || form.role === 'vesselManager';
    if (needsVessels && form.vesselIds.length === 0) { setError('Pick at least one vessel'); return; }
    setBusy(true); setError(null);
    try {
      await api<UserRow>('/users', {
        method: 'POST',
        body: { email: form.email, name: form.name, designation: form.designation, role: form.role, vesselIds: form.vesselIds, isActive: form.isActive },
      });
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this user');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u: UserRow) {
    await api('/users', {
      method: 'POST',
      body: { email: u.email, name: u.name, designation: u.designation, role: u.role, vesselIds: u.vesselIds, isActive: !u.isActive },
    });
    await qc.invalidateQueries({ queryKey: ['users'] });
  }

  if (me.data && me.data.role !== 'admin') {
    return (
      <>
        <div className="appbar">
          <button className="back" aria-label="Back" onClick={() => nav('/')}><BackIcon /></button>
          <div className="title-wrap"><h1>Manage users</h1></div>
        </div>
        <div className="empty-state"><p>Admins only.</p></div>
      </>
    );
  }

  const needsVessels = form.role === 'techManager' || form.role === 'vesselManager';

  return (
    <>
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => (editing ? setEditing(false) : nav('/'))}><BackIcon /></button>
        <div className="title-wrap"><h1>{editing ? (form.id ? 'Edit role' : 'Assign a role') : 'Manage users'}</h1></div>
      </div>

      {editing ? (
        <div className="page-wrap">
          <form onSubmit={onSave} className="section-pad" style={{ margin: '16px 0', display: 'grid', gap: 14 }}>
            {error && <div className="auth-error">{error}</div>}

            <label style={{ display: 'grid', gap: 6 }}>
              <span className="seg-label">EMAIL</span>
              <input className="auth-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@example.com" required autoFocus />
              {!form.id && <p className="footer-note" style={{ textAlign: 'left', padding: 0 }}>This must be the exact email they'll sign in with. They'll get an email to set their password.</p>}
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <span className="seg-label">NAME (OPTIONAL)</span>
              <input className="auth-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Their name" />
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <span className="seg-label">DESIGNATION (OPTIONAL)</span>
              <input className="auth-input" list="designation-options" value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Technical Superintendent" />
              <datalist id="designation-options">{designations.data?.map((d) => <option key={d} value={d} />)}</datalist>
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <span className="seg-label">ROLE</span>
              <div className="seg">
                {ROLES.map((r) => (
                  <button key={r} type="button" className={form.role === r ? 'selected' : ''} onClick={() => setForm({ ...form, role: r })}>
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            </label>

            {needsVessels && (
              <div>
                <div className="seg-label">{form.role === 'vesselManager' ? "Vessel(s) they can see and manage" : 'Fleet — vessels they can see and manage'}</div>
                {vessels.length === 0 ? <p className="footer-note" style={{ textAlign: 'left', padding: 0 }}>No vessels added yet.</p> : vessels.map((v) => (
                  <label key={v.id} className="fleet-check-row">
                    <input type="checkbox" checked={form.vesselIds.includes(v.id)} onChange={() => toggleVessel(v.id)} />
                    <span>{v.name}</span>
                  </label>
                ))}
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              <span>Active</span>
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
            {!form.id && <p className="footer-note" style={{ textAlign: 'left', padding: 0 }}>After saving, we'll email them a link to set their password.</p>}
          </form>
        </div>
      ) : (
        <div className="page-wrap">
          <div className="section-pad fab-new" style={{ marginTop: 16 }}>
            <button className="btn btn-primary btn-block" onClick={startNew}><PlusIcon />Assign a role</button>
          </div>

          {users.data?.length === 0 && <div className="empty-state"><p>No one has a role assigned yet.</p></div>}
          {users.data?.map((u) => (
            <div key={u.id} className="inspection-card" onClick={() => startEdit(u)}>
              <div className="body">
                <div className="vname">
                  {u.name || u.email}{u.designation ? <span style={{ fontWeight: 500, color: 'var(--faint)' }}> — {u.designation}</span> : ''}
                  {!u.isActive && <span className="badge inactive" style={{ marginLeft: 8 }}>Inactive</span>}
                </div>
                <div className="vmeta">
                  {u.email} · {ROLE_LABELS[u.role]}
                  {(u.role === 'techManager' || u.role === 'vesselManager') ? ` · ${u.vesselIds.length} vessel${u.vesselIds.length === 1 ? '' : 's'}` : ''}
                  {!u.hasPassword ? ' · Invite pending' : ''}
                </div>
              </div>
              <button className="icon-btn" aria-label={u.isActive ? 'Deactivate' : 'Reactivate'}
                onClick={(e) => { e.stopPropagation(); void toggleActive(u); }}>
                {u.isActive ? '⏸' : '▶'}
              </button>
            </div>
          ))}
          <p className="footer-note">Roles decide what this app shows each person — not a hard security lock on the underlying data.</p>
        </div>
      )}
    </>
  );
}
