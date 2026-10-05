import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Role } from '@ozellar/shared';
import { api, ApiError } from '../../api/client';
import { db } from '../../offline/db';
import './RegisterUserPage.css';
import {
  UsersIcon, ChevronLeftIcon, AlertCircleIcon, CheckIcon, KeyIcon,
  CopyIcon, EyeIcon, EyeOffIcon, SparklesIcon, ShipIcon
} from '../../icons';
import { ROLE_LABELS } from '@ozellar/shared';

const ROLES: Role[] = ['vesselManager', 'techManager', 'director', 'admin'];

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  vesselManager: 'Conducts ship inspections, records findings & uploads photos.',
  techManager:   'Reviews submitted inspections, approves or requests revisions.',
  director:      'Executive fleet oversight and final inspection sign-offs.',
  admin:         'System administration, manage users, vessels, and roles.',
};

const ROLE_COLORS: Record<Role, { bg: string; text: string; border: string }> = {
  vesselManager: { bg: '#E4F1F1', text: '#0A5F67', border: '#B6DFE2' },
  techManager:   { bg: '#E6F0FA', text: '#1F5C99', border: '#BAD4EE' },
  director:      { bg: '#F1EBF9', text: '#7C3EC6', border: '#D9C6F0' },
  admin:         { bg: '#FBF1DE', text: '#C98A1A', border: '#F5DCAD' },
};

const DESIGNATION_PRESETS = [
  'Technical Superintendent',
  'Technical Manager',
  'Fleet Director',
  'Chief Engineer',
  'Master Mariner',
  'System Administrator'
];

interface FormState {
  id: string;
  email: string;
  name: string;
  designation: string;
  role: Role;
  vesselIds: string[];
  isActive: boolean;
  hasPassword: boolean;
  password?: string;
}

const blankForm: FormState = {
  id: '',
  email: '',
  name: '',
  designation: '',
  role: 'vesselManager',
  vesselIds: [],
  isActive: true,
  hasPassword: false,
  password: '',
};

function generateSecurePassword(): string {
  const words = ['Titan', 'Pacific', 'Atlantic', 'Anchor', 'Vessel', 'Voyage', 'Harbor', 'Beacon', 'Compass', 'Polaris'];
  const symbols = ['#', '!', '@', '$', '%'];
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  const sym = symbols[Math.floor(Math.random() * symbols.length)];
  return `${word}${sym}${num}`;
}

export function RegisterUserPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const allVessels = useLiveQuery(() => db.vessels.orderBy('name').toArray(), []) ?? [];
  // Only show valid UUID vessels — filter out corrupted legacy "ves-timestamp" entries
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const vessels = allVessels.filter(v => UUID_RE.test(v.id));

  const [form, setForm] = useState<FormState>(blankForm);
  const [showPassword, setShowPassword] = useState(false);
  const [wantsChangePassword, setWantsChangePassword] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditing && id) {
      api(`/users/${id}`).then((u: any) => {
        setForm({
          id: u.id,
          email: u.email,
          name: u.name,
          designation: u.designation || '',
          role: u.role,
          vesselIds: u.vesselIds || [],
          isActive: u.isActive,
          hasPassword: u.hasPassword,
          password: '',
        });
        setWantsChangePassword(!u.hasPassword);
      }).catch(err => {
        setError('Failed to fetch user details.');
      });
    } else {
      setWantsChangePassword(true); // new user needs password
    }
  }, [isEditing, id]);

  function handleGeneratePassword() {
    const pwd = generateSecurePassword();
    setForm(prev => ({ ...prev, password: pwd }));
    setShowPassword(true);
  }

  function handleCopyPassword(pwd: string) {
    if (!pwd) return;
    navigator.clipboard.writeText(pwd).then(() => {
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2000);
    });
  }

  function toggleVessel(vid: string) {
    setForm(f => ({
      ...f,
      vesselIds: f.vesselIds.includes(vid)
        ? f.vesselIds.filter(v => v !== vid)
        : [...f.vesselIds, vid]
    }));
  }

  function selectAllVessels() {
    setForm(f => ({ ...f, vesselIds: vessels.map(v => v.id) }));
  }

  function clearAllVessels() {
    setForm(f => ({ ...f, vesselIds: [] }));
  }

  async function onSaveUser(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    if (!isEditing && (!form.password || form.password.trim().length < 6)) {
      setError('Enterprise Standard: Initial password of at least 6 characters is required.');
      return;
    }
    if (isEditing && wantsChangePassword && form.password && form.password.trim().length > 0 && form.password.trim().length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    const needsVessels = form.role === 'techManager' || form.role === 'vesselManager';
    // Strip internal-only fields before sending to backend
    const payload = {
      email: form.email.trim().toLowerCase(),
      name: form.name.trim(),
      designation: form.designation.trim(),
      role: form.role,
      vesselIds: needsVessels ? form.vesselIds : [],
      isActive: form.isActive,
      ...(wantsChangePassword && form.password?.trim() ? { password: form.password.trim() } : {}),
    };

    setBusy(true);
    setError(null);
    try {
      if (form.id) {
        await api(`/users/${form.id}`, { method: 'PUT', body: payload });
      } else {
        await api('/users', { method: 'POST', body: payload });
      }
      qc.invalidateQueries({ queryKey: ['users'] });
      navigate('/users');
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to save user account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const needsVessels = form.role === 'techManager' || form.role === 'vesselManager';

  return (
    <div className="ru-page-wrap">
      <header className="ru-header">
        <button className="ru-back-btn" onClick={() => navigate('/users')}>
          <ChevronLeftIcon width={16} height={16} />
          <span>Back to Users</span>
        </button>
        <div className="ru-header-title-group">
          <div className="ru-title-badge">
            <UsersIcon width={28} height={28} />
          </div>
          <div>
            <h1 className="ru-page-title">
              {isEditing ? `Edit User: ${form.name}` : 'Register New User'}
            </h1>
            <p className="ru-page-subtitle">
              {isEditing
                ? 'Manage user credentials, roles, and fleet access permissions'
                : 'Create a new team account and configure their system privileges'}
            </p>
          </div>
        </div>
      </header>

      <div className="ru-content-container">
        <main className="ru-main-form-area">
          <form onSubmit={onSaveUser} className="ru-form-card">
            {error && (
              <div className="ru-error-banner">
                <AlertCircleIcon width={16} height={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="ru-form-body">
              <div className="ru-form-section">
                <div className="ru-section-header">
                  <h2>Account Profile</h2>
                  <p>Basic identity and contact information</p>
                </div>

                <div className="ru-grid two-cols">
                  <div className="ru-input-group">
                    <label className="ru-input-label">Full Name <span className="req">*</span></label>
                    <input
                      className="ru-text-input"
                      required
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Sarah Jenkins"
                      autoFocus
                    />
                  </div>
                  <div className="ru-input-group">
                    <label className="ru-input-label">Email Address <span className="req">*</span></label>
                    <input
                      className="ru-text-input"
                      type="email"
                      required
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      placeholder="e.g. sarah.j@ozellar.com"
                    />
                  </div>
                  
                  {(!isEditing || wantsChangePassword || !form.hasPassword) ? (
                    <div className="ru-input-group">
                      <label className="ru-input-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Password <span className="req">*</span></span>
                      </label>
                      <div className="ru-password-input-group" style={{ display: 'flex', gap: 6, position: 'relative' }}>
                        <input
                          className="ru-text-input"
                          type={showPassword ? 'text' : 'password'}
                          value={form.password || ''}
                          onChange={e => setForm({ ...form, password: e.target.value })}
                          placeholder="Min 6 chars..."
                          required={!form.id || !form.hasPassword}
                          style={{ paddingRight: 32 }}
                        />
                        <button type="button" className="ru-pwd-icon-btn" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 6, top: 4, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
                          {showPassword ? <EyeOffIcon width={15} height={15} /> : <EyeIcon width={15} height={15} />}
                        </button>
                      </div>
                      {isEditing && (
                        <button type="button" className="ru-btn-text danger" style={{ fontSize: 11, padding: 0, justifyContent: 'flex-start', marginTop: 2 }} onClick={() => { setWantsChangePassword(false); setForm({ ...form, password: '' }); }}>
                          Cancel Change
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="ru-input-group">
                      <label className="ru-input-label">Password</label>
                      <div className="ru-password-present" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 8 }}>
                        <span style={{ fontSize: 13, color: '#059669', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                          <CheckIcon width={14} height={14} /> Password set
                        </span>
                        <button type="button" className="ru-btn-outline" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setWantsChangePassword(true)}>
                          Change
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="ru-input-group">
                    <label className="ru-input-label">Job Title / Designation</label>
                    <input
                      className="ru-text-input custom"
                      list="designation-presets"
                      value={form.designation}
                      onChange={e => setForm({ ...form, designation: e.target.value })}
                      placeholder="e.g. Technical Superintendent"
                    />
                    <datalist id="designation-presets">
                      {DESIGNATION_PRESETS.map(d => <option key={d} value={d} />)}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="ru-form-section">
                <div className="ru-section-header">
                  <h2>System Role & Privilege Level</h2>
                  <p>Select the appropriate permission tier for this account</p>
                </div>

                <div className="ru-role-grid">
                  {ROLES.map(r => {
                    const isSelected = form.role === r;
                    const theme = ROLE_COLORS[r];
                    return (
                      <button
                        key={r}
                        type="button"
                        className={`ru-role-tile ${isSelected ? 'selected' : ''}`}
                        style={{
                          borderColor: isSelected ? theme.text : undefined,
                          background: isSelected ? theme.bg : undefined,
                        }}
                        onClick={() => setForm({ ...form, role: r })}
                      >
                        <div className="ru-role-tile-header">
                          <span className="ru-role-name" style={{ color: isSelected ? theme.text : 'var(--ink)' }}>
                            {ROLE_LABELS[r]}
                          </span>
                          {isSelected && <span className="ru-tile-check" style={{ color: theme.text }}><CheckIcon width={16} height={16} /></span>}
                        </div>
                        <p className="ru-role-desc">{ROLE_DESCRIPTIONS[r]}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {needsVessels && (
                <div className="ru-form-section">
                  <div className="ru-section-header">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h2>Fleet Assignment</h2>
                        <p>Select the vessels this user can access and inspect</p>
                      </div>
                      <div className="ru-vessel-actions">
                        <button type="button" onClick={selectAllVessels}>Select All</button>
                        <button type="button" onClick={clearAllVessels}>Clear</button>
                      </div>
                    </div>
                  </div>

                  <div className="ru-vessel-grid">
                    {vessels.map(v => {
                      const isSelected = form.vesselIds.includes(v.id);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          className={`ru-vessel-pill ${isSelected ? 'selected' : ''}`}
                          onClick={() => toggleVessel(v.id)}
                        >
                          <ShipIcon width={14} height={14} />
                          <span>{v.name}</span>
                        </button>
                      );
                    })}
                    {vessels.length === 0 && (
                      <div className="ru-no-vessels">No vessels registered in the fleet yet.</div>
                    )}
                  </div>
                </div>
              )}

              <div className="ru-form-section">
                <div className="ru-section-header">
                  <h2>Account Status</h2>
                  <p>Manage account state</p>
                </div>

                <div className="ru-auth-box" style={{ padding: '16px' }}>
                  <div className="ru-auth-row">
                    <label className="ru-toggle">
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={e => setForm({ ...form, isActive: e.target.checked })}
                      />
                      <div className="ru-toggle-slider" />
                    </label>
                    <div className="ru-auth-text">
                      <strong>Account Active</strong>
                      <span>Allow this user to sign in to Ozellar</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="ru-form-footer">
              <button type="button" className="ru-btn-cancel" onClick={() => navigate('/users')}>
                Cancel
              </button>
              <button type="submit" className="ru-btn-save" disabled={busy}>
                <CheckIcon width={16} height={16} />
                <span>{busy ? 'Saving...' : form.id ? 'Save Changes' : 'Create User'}</span>
              </button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
