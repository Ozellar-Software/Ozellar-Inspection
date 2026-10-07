import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../api/client';
import { LockIcon, XIcon, CheckIcon, AlertCircleIcon, EyeIcon, EyeOffIcon } from '../icons';
import './ChangePasswordModal.css';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        handleClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, busy]);

  if (!isOpen) return null;

  function handleClose() {
    if (busy) return;
    setError(null);
    setSuccess(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change password. Please check your current password.');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="cpm-overlay" onClick={handleClose}>
      <div className="cpm-card" onClick={(e) => e.stopPropagation()}>
        <div className="cpm-header">
          <div className="cpm-title-group">
            <div className="cpm-icon-wrap">
              <LockIcon width={20} height={20} />
            </div>
            <div>
              <h2 className="cpm-title">Change Password</h2>
              <p className="cpm-subtitle">Update your account password</p>
            </div>
          </div>
          <button type="button" className="cpm-close-btn" onClick={handleClose} disabled={busy} aria-label="Close">
            <XIcon width={16} height={16} />
          </button>
        </div>

        {error && (
          <div className="cpm-alert error">
            <AlertCircleIcon width={16} height={16} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="cpm-alert success">
            <CheckIcon width={16} height={16} />
            <span>Password updated successfully!</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="cpm-form">
          <div className="cpm-field">
            <label className="cpm-label">Current Password</label>
            <div className="cpm-input-wrap">
              <input
                type={showCurrent ? 'text' : 'password'}
                className="cpm-input"
                placeholder="Enter current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoFocus
                disabled={busy || success}
              />
              <button
                type="button"
                className="cpm-eye-btn"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? 'Hide password' : 'Show password'}
              >
                {showCurrent ? <EyeOffIcon width={16} height={16} /> : <EyeIcon width={16} height={16} />}
              </button>
            </div>
          </div>

          <div className="cpm-field">
            <label className="cpm-label">New Password</label>
            <div className="cpm-input-wrap">
              <input
                type={showNew ? 'text' : 'password'}
                className="cpm-input"
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                disabled={busy || success}
              />
              <button
                type="button"
                className="cpm-eye-btn"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? 'Hide password' : 'Show password'}
              >
                {showNew ? <EyeOffIcon width={16} height={16} /> : <EyeIcon width={16} height={16} />}
              </button>
            </div>
          </div>

          <div className="cpm-field">
            <label className="cpm-label">Confirm New Password</label>
            <div className="cpm-input-wrap">
              <input
                type={showConfirm ? 'text' : 'password'}
                className="cpm-input"
                placeholder="Repeat new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={busy || success}
              />
              <button
                type="button"
                className="cpm-eye-btn"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm ? <EyeOffIcon width={16} height={16} /> : <EyeIcon width={16} height={16} />}
              </button>
            </div>
          </div>

          <div className="cpm-actions">
            <button type="button" className="cpm-btn-cancel" onClick={handleClose} disabled={busy || success}>
              Cancel
            </button>
            <button type="submit" className="cpm-btn-submit" disabled={busy || success}>
              {busy ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
