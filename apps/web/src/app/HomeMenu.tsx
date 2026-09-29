import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '@ozellar/shared';
import { MenuIcon, ShipIcon, ClipboardIcon, UsersIcon } from '../icons';

/** The hamburger menu (top-left of Home) — navigation to the admin/director screens. */
export function HomeMenu({ me }: { me: User }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const isAdmin = me.role === 'admin';
  const isDirector = me.role === 'director';
  const items: Array<{ label: string; icon: React.ReactNode; to: string }> = [];
  if (isAdmin || isDirector) items.push({ label: 'Manage vessels', icon: <ShipIcon />, to: '/vessels' });
  if (isAdmin) items.push({ label: 'Manage checklist', icon: <ClipboardIcon />, to: '/checklist' });
  if (isAdmin) items.push({ label: 'Manage users', icon: <UsersIcon />, to: '/users' });
  if (!items.length) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label="Menu" onClick={() => setOpen((v) => !v)}><MenuIcon /></button>
      {open && (
        <>
          <div className="home-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="home-menu-dropdown" style={{ position: 'absolute', top: 42, left: 0 }}>
            {items.map((it) => (
              <button key={it.to} onClick={() => { setOpen(false); nav(it.to); }}>{it.icon}<span>{it.label}</span></button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
