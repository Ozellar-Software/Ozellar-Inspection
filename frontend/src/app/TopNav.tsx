import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { type User } from '@ozellar/shared';
import { ShipIcon } from '../icons';
import { UserMenu } from './UserMenu';
import { NotificationsMenu } from './NotificationsMenu';
import './TopNav.css';

export function TopNav() {
  const nav = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });

  return (
    <header className="premium-top-nav">
      <div className="ptn-container">
        <div className="ptn-left">
          <div className="ptn-brand" onClick={() => nav('/')}>
            <div className="ptn-logo-bg">
              <ShipIcon className="ptn-logo-icon" />
            </div>
            <div className="ptn-brand-text">
              <span className="ptn-brand-title">Ozellar</span>
              <span className="ptn-brand-sub">Vessel Inspection</span>
            </div>
          </div>
        </div>
        
        <div className="ptn-right" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {me.data && (
            <>
              <NotificationsMenu />
              <UserMenu me={me.data} />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
