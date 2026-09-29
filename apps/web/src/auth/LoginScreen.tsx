import { useState } from 'react';
import { login, requestReset } from './session';
import { ShipIcon } from '../icons';

export function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try { await login(email, password); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sign in failed'); }
    finally { setBusy(false); }
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try { await requestReset(email); setSent(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong'); }
    finally { setBusy(false); }
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
          {mode === 'login' ? (
            <form onSubmit={onLogin} style={{ display: 'contents' }}>
              <div className="auth-card-title">Sign in to continue</div>
              <div className="auth-card-body">Sign in with the email your admin gave you access with.</div>
              <input className="auth-input" type="email" placeholder="Email" autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              <input className="auth-input" type="password" placeholder="Password" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
              {error && <div className="auth-error">{error}</div>}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : 'Sign in'}
              </button>
              <button type="button" className="btn btn-outline btn-block"
                onClick={() => { setMode('forgot'); setError(null); setSent(false); }}>
                Forgot password? Email me a reset link
              </button>
            </form>
          ) : (
            <form onSubmit={onForgot} style={{ display: 'contents' }}>
              <div className="auth-card-title">Reset your password</div>
              <div className="auth-card-body">Enter your email and we'll send you a reset link.</div>
              <input className="auth-input" type="email" placeholder="Email" autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              {error && <div className="auth-error">{error}</div>}
              {sent && <div className="auth-success">If that email has an account, a reset link is on its way.</div>}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy || sent}>
                {busy ? 'Please wait…' : 'Send reset link'}
              </button>
              <button type="button" className="auth-link" onClick={() => { setMode('login'); setError(null); }}>
                Back to sign in
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
