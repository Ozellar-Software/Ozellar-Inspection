import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type AppNotification } from '@ozellar/shared';
import { api } from '../api/client';
import { db } from '../offline/db';
import { useCurrentUser } from '../auth/useCurrentUser';
import {
  BellIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ClipboardIcon,
  CheckIcon,
  ShipIcon,
} from '../icons';
import './NotificationsMenu.css';

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(isoString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function getNotificationIcon(type: string) {
  switch (type) {
    case 'inspection_created':
      return <ClipboardIcon className="nm-item-icon-svg" />;
    case 'section_completed':
      return <CheckIcon className="nm-item-icon-svg" />;
    case 'inspection_submitted':
      return <ShipIcon className="nm-item-icon-svg" />;
    case 'inspection_approved':
      return <CheckCircleIcon className="nm-item-icon-svg" />;
    case 'inspection_returned':
      return <AlertCircleIcon className="nm-item-icon-svg" />;
    default:
      return <BellIcon className="nm-item-icon-svg" />;
  }
}

function getNotificationBadgeClass(type: string) {
  switch (type) {
    case 'inspection_approved':
      return 'badge-success';
    case 'inspection_returned':
      return 'badge-warning';
    case 'section_completed':
      return 'badge-info';
    case 'inspection_submitted':
      return 'badge-purple';
    case 'inspection_created':
    default:
      return 'badge-teal';
  }
}

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useCurrentUser();

  const { data } = useQuery<{ notifications: AppNotification[]; unreadCount: number }>({
    queryKey: ['notifications', me.data?.id],
    queryFn: async () => {
      const currentUserId = me.data?.id;
      if (navigator.onLine) {
        try {
          const res = await api<{ notifications: AppNotification[]; unreadCount: number }>('/notifications');
          if (res?.notifications?.length) {
            await db.notifications.bulkPut(res.notifications);
          }
          return res;
        } catch {
          // offline fallback below
        }
      }
      let localNotifs = await db.notifications.toArray();
      if (currentUserId) {
        localNotifs = localNotifs.filter((n) => !n.userId || n.userId === currentUserId);
      }
      localNotifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const unread = localNotifs.filter((n) => !n.read).length;
      return { notifications: localNotifs, unreadCount: unread };
    },
    refetchInterval: navigator.onLine ? 15000 : false,
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (open && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function markAllAsRead() {
    try {
      if (navigator.onLine) {
        await api('/notifications/read', { method: 'POST', body: { all: true } });
      }
      const currentUserId = me.data?.id;
      if (currentUserId) {
        await db.notifications.where('userId').equals(currentUserId).modify({ read: true });
      } else {
        await db.notifications.toCollection().modify({ read: true });
      }
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err) {
      console.error('Failed to mark all notifications as read', err);
    }
  }

  async function handleNotificationClick(item: AppNotification) {
    if (!item.read) {
      try {
        if (navigator.onLine) {
          await api('/notifications/read', { method: 'POST', body: { id: item.id } });
        }
        await db.notifications.update(item.id, { read: true });
        qc.invalidateQueries({ queryKey: ['notifications'] });
      } catch (err) {
        console.error('Failed to mark notification as read', err);
      }
    }
    setOpen(false);
    if (item.link) {
      nav(item.link);
    }
  }

  return (
    <div className="notifications-menu-wrapper" ref={menuRef}>
      <button
        type="button"
        className={`nm-bell-btn ${open ? 'active' : ''} ${unreadCount > 0 ? 'has-unread' : ''}`}
        aria-label="Notifications"
        title={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'Notifications'}
        onClick={() => setOpen((prev) => !prev)}
      >
        <BellIcon className="nm-bell-icon" />
        {unreadCount > 0 && (
          <span className="nm-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="nm-dropdown-panel" role="menu">
          <div className="nm-header">
            <div className="nm-header-title">
              <span className="nm-title-text">Notifications</span>
              {unreadCount > 0 && (
                <span className="nm-unread-chip">{unreadCount} new</span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                className="nm-mark-all-btn"
                onClick={markAllAsRead}
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="nm-list">
            {notifications.length === 0 ? (
              <div className="nm-empty">
                <BellIcon className="nm-empty-icon" />
                <div className="nm-empty-title">All caught up</div>
                <div className="nm-empty-desc">No notifications right now</div>
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  className={`nm-item ${!item.read ? 'nm-unread' : ''}`}
                  onClick={() => handleNotificationClick(item)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleNotificationClick(item);
                    }
                  }}
                >
                  <div className={`nm-item-icon-box ${getNotificationBadgeClass(item.type)}`}>
                    {getNotificationIcon(item.type)}
                  </div>
                  <div className="nm-item-content">
                    <div className="nm-item-header">
                      <span className="nm-item-title">{item.title}</span>
                      <span className="nm-item-time">{formatRelativeTime(item.createdAt)}</span>
                    </div>
                    <div className="nm-item-msg">{item.message}</div>
                  </div>
                  {!item.read && <span className="nm-item-unread-dot" />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
