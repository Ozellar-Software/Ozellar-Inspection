import { useState } from 'react';
import { ROLE_LABELS, type User } from '@ozellar/shared';
import { logout, requestReset } from '../auth/session';
import { LockIcon, SignOutIcon } from '../icons';

/** The avatar button in the header, with the account dropdown (change password / sign out). */
export function UserMenu({ me }: { me: User }) {
  const [open, setOpen] = useState(false);
  const initial = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
  const roleLine = [ROLE_LABELS[me.role], me.designation].filter(Boolean).join(' — ');

  async function onChangePassword() {
    setOpen(false);
    try { await requestReset(me.email); alert('Check your email for a link to set a new password.'); }
    catch { alert('Could not send the email right now. Try again shortly.'); }
  }

  return (
    <div style={{ position: 'relative', flex: 'none', marginLeft: 'auto' }}>
      <button className="avatar-btn" aria-label="Account" title={me.email} onClick={() => setOpen((v) => !v)}>
        {initial}
      </button>
      {open && (
        <>
          <div className="home-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="home-menu-dropdown" style={{ position: 'absolute', top: 42, right: 0 }}>
            <div className="home-menu-header">{me.email}</div>
            {roleLine && <div className="home-menu-header">{roleLine}</div>}
            <hr />
            <button onClick={onChangePassword}><LockIcon /><span>Change password</span></button>
            <button className="danger" onClick={() => { setOpen(false); logout(); }}><SignOutIcon /><span>Sign out</span></button>
          </div>
        </>
      )}
    </div>
  );
}
