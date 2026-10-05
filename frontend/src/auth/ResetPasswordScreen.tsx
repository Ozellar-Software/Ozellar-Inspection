import { useState } from 'react';
import { resetPassword } from './session';
import { ShipIcon } from '../icons';

/** Reached via the emailed link: {APP_URL}/reset-password?token=... (new-user invite or forgot-password). */
export function ResetPasswordScreen({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await resetPassword(token, password);
      window.history.replaceState(null, '', '/'); // drop the token from the URL/history and load signed-in
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="home-header auth-header">
        <ShipIcon className="mark" />
        <div>
          <div className="wordmark">Ozellar</div>
          <div className="tagline">All Right Inspection</div>
        </div>
      </div>

      <div className="auth-card">
        <div className="auth-card-inner">
          <form onSubmit={onSubmit} style={{ display: 'contents' }}>
            <div className="auth-card-title">Create your password</div>
            <div className="auth-card-body">Set a password now so you can sign in directly next time.</div>
            <input className="auth-input" type="password" placeholder="New password" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            <input className="auth-input" type="password" placeholder="Confirm password" autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            {error && <div className="auth-error">{error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : 'Save password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
