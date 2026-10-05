import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABELS, type User } from '@ozellar/shared';
import { logout, requestReset } from '../auth/session';
import { LockIcon, SignOutIcon, ClipboardIcon, UsersIcon, ShipIcon } from '../icons';
import './TopNav.css';

export function UserMenu({ me }: { me: User }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (open && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const initial = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
  const roleLine = [ROLE_LABELS[me.role], me.designation].filter(Boolean).join(' — ');
  const isAdmin = me.role === 'admin';
  const isDirector = me.role === 'director';
  const displayName = me.name || me.email.split('@')[0];
  const roleLabel = ROLE_LABELS[me.role];

  async function onChangePassword() {
    setOpen(false);
    try { await requestReset(me.email); alert('Check your email for a link to set a new password.'); }
    catch { alert('Could not send the email right now. Try again shortly.'); }
  }

  return (
    <div className="user-menu-wrapper" ref={menuRef}>
      <button
        type="button"
        className={`nav-user-pill ${open ? 'active' : ''}`}
        aria-label="Account menu"
        title={me.email}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="nav-user-avatar">
          {initial}
        </div>
        <div className="nav-user-info hide-on-mobile">
          <span className="nav-user-name">{displayName}</span>
          <span className="nav-user-role">{roleLabel}</span>
        </div>
        <svg
          className={`nav-user-chevron hide-on-mobile ${open ? 'open' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="premium-dropdown">
          {/* Profile header section */}
            <div className="dropdown-header">
              <div className="dropdown-avatar">{initial}</div>
              <div className="dropdown-user-details">
                <div className="dropdown-name">{me.name || me.email}</div>
                {me.email && me.name && (
                  <div className="dropdown-email">{me.email}</div>
                )}
                {roleLine && (
                  <div className="dropdown-role-chip">{roleLine}</div>
                )}
              </div>
            </div>

            <div className="dropdown-body">
              {isAdmin && (
                <>
                  <div className="dropdown-section-title">Management</div>
                  <button className="premium-dropdown-item" onClick={() => { setOpen(false); nav('/vessels'); }}>
                    <ShipIcon /> <span>Manage Vessels</span>
                  </button>
                  <button className="premium-dropdown-item" onClick={() => { setOpen(false); nav('/users'); }}>
                    <UsersIcon /> <span>Manage Users</span>
                  </button>
                  <button className="premium-dropdown-item" onClick={() => { setOpen(false); nav('/checklist'); }}>
                    <ClipboardIcon /> <span>Manage Checklist</span>
                  </button>
                  <div className="dropdown-divider" />
                </>
              )}

              {isDirector && (
                <>
                  <div className="dropdown-section-title">Overview</div>
                  <button className="premium-dropdown-item" onClick={() => { setOpen(false); nav('/vessels'); }}>
                    <ShipIcon /> <span>View Vessels</span>
                  </button>
                  <div className="dropdown-divider" />
                </>
              )}

              {(me.role === 'techManager' || me.role === 'vesselManager') && (
                <>
                  <div className="dropdown-section-title">My Fleet</div>
                  <button className="premium-dropdown-item" onClick={() => { setOpen(false); nav('/vessels'); }}>
                    <ShipIcon /> <span>My Vessels</span>
                  </button>
                  <div className="dropdown-divider" />
                </>
              )}

              <button className="premium-dropdown-item" onClick={onChangePassword}>
                <LockIcon /> <span>Change password</span>
              </button>
              <button className="premium-dropdown-item danger" onClick={() => { setOpen(false); logout(); }}>
                <SignOutIcon /> <span>Sign out</span>
              </button>
            </div>
          </div>
      )}
    </div>
  );
}
