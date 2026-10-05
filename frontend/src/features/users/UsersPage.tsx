import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABELS, type Role, type User } from '@ozellar/shared';
import { api } from '../../api/client';
import { db } from '../../offline/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { BackIcon, PlusIcon, SearchIcon, UsersIcon, CheckIcon, KeyIcon, ShipIcon, EditIcon, PlayIcon, PauseIcon } from '../../icons';
import './UsersPage.css'; // Use exactly the same theme file

interface UserRow extends User { hasPassword: boolean }
const ROLES: Role[] = ['admin', 'director', 'techManager', 'vesselManager'];

const ROLE_THEMES: Record<Role, { key: string; avatarClass: string; tagClass: string }> = {
  vesselManager: { key: 'general', avatarClass: 'avatar-teal', tagClass: 'tag-teal' },
  techManager:   { key: 'container', avatarClass: 'avatar-indigo', tagClass: 'tag-indigo' },
  director:      { key: 'bulk', avatarClass: 'avatar-amber', tagClass: 'tag-amber' },
  admin:         { key: 'tanker', avatarClass: 'avatar-rose', tagClass: 'tag-rose' },
};

export function UsersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users'), enabled: me.data?.role === 'admin' });
  const vessels = useLiveQuery(() => db.vessels.orderBy('name').toArray(), []) ?? [];

  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<Role | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

  const displayUsers = Array.isArray(users.data) ? users.data : [];

  const filteredUsers = useMemo(() => {
    return displayUsers.filter(u => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch = !q || (
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.designation || '').toLowerCase().includes(q)
      );
      const matchRole = filterRole === 'all' || u.role === filterRole;
      const matchStatus = 
        filterStatus === 'all' ? true :
        filterStatus === 'active' ? u.isActive :
        filterStatus === 'inactive' ? !u.isActive : true;

      return matchSearch && matchRole && matchStatus;
    });
  }, [displayUsers, searchQuery, filterRole, filterStatus]);

  async function toggleActive(u: UserRow) {
    try {
      const payload = { isActive: !u.isActive };
      await api(`/users/${u.id}`, { method: 'PUT', body: payload });
      qc.setQueryData(['users'], (old: UserRow[] | undefined) => {
        if (!old) return old;
        return old.map(o => o.id === u.id ? { ...o, isActive: !u.isActive } : o);
      });
      await qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      console.error('Failed to toggle user status', e);
    }
  }

  if (me.data && me.data.role !== 'admin') {
    return (
      <div className="user-page-wrap">
        <header className="users-page-header">
          <div className="users-title-group" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="back-btn-premium" aria-label="Back" onClick={() => navigate('/')}>
              <BackIcon />
            </button>
            <div className="users-title-row">
              <h1 className="users-page-title">Users & Permissions</h1>
            </div>
          </div>
        </header>
        <div className="user-empty-state" style={{ marginTop: 40 }}>
          <div className="user-empty-icon"><UsersIcon width={48} height={48} /></div>
          <h3 className="user-empty-title">Administrator Access Required</h3>
          <p className="user-empty-desc">Only system administrators have permission to manage team accounts, roles, and credentials.</p>
          <button className="user-primary-btn" style={{ marginTop: 12 }} onClick={() => navigate('/')}>Return to Dashboard</button>
        </div>
      </div>
    );
  }

  const activeCount = displayUsers.filter(u => u.isActive).length;
  const inactiveCount = displayUsers.length - activeCount;

  return (
    <div className="user-page-wrap">
      {/* â”€â”€â”€ Top Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <header className="users-page-header">
        <div className="users-title-group" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="back-btn-premium" aria-label="Back" onClick={() => navigate('/')}>
            <BackIcon />
          </button>
          <div className="users-title-row">
            <h1 className="users-page-title">Users & Permissions</h1>
            <span className="users-count-pill">{displayUsers.length} Team Member{displayUsers.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className="users-header-actions">
          <button className="user-primary-btn" onClick={() => navigate('/users/new')}>
            <PlusIcon width={16} height={16} />
            <span>New User</span>
          </button>
        </div>
      </header>

      {/* â”€â”€â”€ Control Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="users-control-panel">
        <div className="users-toolbar-row">
          <div className="users-search-box">
            <span className="users-search-icon"><SearchIcon width={16} height={16} /></span>
            <input
              type="text"
              className="users-search-input"
              placeholder="Search by name, email or designation..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Role Filters */}
          <div className="users-filter-scroll">
            <button className={`user-filter-btn ${filterRole === 'all' ? 'active' : ''}`} onClick={() => setFilterRole('all')}>
              All Roles <span className="user-filter-count">{displayUsers.length}</span>
            </button>
            {ROLES.map(r => {
              const count = displayUsers.filter(u => u.role === r).length;
              return (
                <button key={r} className={`user-filter-btn ${filterRole === r ? 'active' : ''}`} onClick={() => setFilterRole(r)}>
                  {ROLE_LABELS[r]} <span className="user-filter-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 8px', flexShrink: 0 }} />

          {/* Status Filters */}
          <div className="users-filter-scroll" style={{ marginRight: 'auto' }}>
            <button className={`user-filter-btn ${filterStatus === 'all' ? 'active' : ''}`} onClick={() => setFilterStatus('all')}>
              All Status
            </button>
            <button className={`user-filter-btn ${filterStatus === 'active' ? 'active' : ''}`} onClick={() => setFilterStatus('active')}>
              Active <span className="user-filter-count">{activeCount}</span>
            </button>
            <button className={`user-filter-btn ${filterStatus === 'inactive' ? 'active' : ''}`} onClick={() => setFilterStatus('inactive')}>
              Inactive <span className="user-filter-count">{inactiveCount}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Results Header Count */}
      <div className="users-results-count">
        <span>Showing {filteredUsers.length} of {displayUsers.length} Team Member{displayUsers.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Empty State */}
      {filteredUsers.length === 0 && (
        <div className="user-empty-state">
          <div className="user-empty-icon">
            <UsersIcon width={48} height={48} />
          </div>
          <h3 className="user-empty-title">No Users Found</h3>
          <p className="user-empty-desc">
            No users match the specified search query or filters.
          </p>
          {(searchQuery || filterRole !== 'all' || filterStatus !== 'all') && (
            <button className="user-reset-btn" onClick={() => { setSearchQuery(''); setFilterRole('all'); setFilterStatus('all'); }}>
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* â”€â”€â”€ User Rows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="user-list-container">
        {filteredUsers.map(u => {
          const theme = ROLE_THEMES[u.role] || ROLE_THEMES.vesselManager;
          const initials = (u.name || u.email).substring(0, 2).toUpperCase();

          return (
            <div key={u.id} className={`user-row-card user-type-${theme.key}`}>
              <div className="user-row-header" style={{ cursor: 'default' }}>
                {/* Left Side: Avatar & Info */}
                <div className="user-row-main" onClick={() => navigate(`/users/${u.id}/edit`)} style={{ cursor: 'pointer' }}>
                  <div className={`user-row-avatar ${theme.avatarClass}`} style={{ fontSize: 16, fontWeight: 700 }}>
                    {initials}
                  </div>

                  <div className="user-row-info">
                    <div className="user-title-main">
                      <span className="user-name-text" style={!u.isActive ? { color: 'var(--muted)', textDecoration: 'line-through' } : {}}>
                        {u.name || u.email.split('@')[0]}
                      </span>
                      <span className={`user-type-chip ${theme.tagClass}`}>{ROLE_LABELS[u.role]}</span>
                    </div>

                    <div className="user-subline">
                      <span className="user-sub-item">{u.email}</span>
                      {u.designation && (
                        <>
                          <span className="user-sub-sep">•</span>
                          <span className="user-sub-item">{u.designation}</span>
                        </>
                      )}
                      {(u.role === 'techManager' || u.role === 'vesselManager') && (
                        <>
                          <span className="user-sub-sep">•</span>
                          <span className="user-sub-item" style={{ color: 'var(--accent-dark)', fontWeight: 500 }}>
                            <ShipIcon width={12} height={12} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> {u.vesselIds?.length || 0} vessel{(u.vesselIds?.length || 0) !== 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                      <span className="user-sub-sep">•</span>
                      <span className="user-status-simple" style={!u.isActive ? { color: '#EF4444' } : {}}>
                        <span className="user-dot" style={!u.isActive ? { background: '#EF4444' } : {}} /> {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Side: Action Icons */}
                <div className="user-row-controls">
                  <div className="user-action-group">
                    <button
                      className="user-icon-btn edit"
                      title="Edit user details"
                      aria-label="Edit user"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/users/${u.id}/edit`);
                      }}
                    >
                      <EditIcon width={15} height={15} />
                    </button>

                    <button
                      className="user-icon-btn delete"
                      title={u.isActive ? 'Deactivate account' : 'Reactivate account'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleActive(u);
                      }}
                    >
                      {u.isActive ? <PauseIcon width={15} height={15} /> : <PlayIcon width={15} height={15} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
