import './LoginScreen.css';
import { useState } from 'react';
import { login, requestReset } from './session';
import { ShipIcon } from '../icons';

/* ─── Feature bullet icons (inline SVG, no extra dep) ─────────────────── */
function IconShield() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 4v5c0 4.5-3 8.4-7 9.5C8 20.4 5 16.5 5 12V7l7-4z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function IconWifi() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5a10 10 0 0 1 14 0" opacity=".4" />
      <path d="M8.5 16a5 5 0 0 1 7 0" opacity=".7" />
      <circle cx="12" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconClipboard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4.5h6a1 1 0 0 1 1 1V6h1.5A1.5 1.5 0 0 1 19 7.5v12A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-12A1.5 1.5 0 0 1 6.5 6H8v-.5a1 1 0 0 1 1-1z" />
      <path d="M9 11h6M9 14.5h6M9 17.5h3.5" />
    </svg>
  );
}

/* ─── Main component ───────────────────────────────────────────────────── */
export function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [showPw, setShowPw] = useState(false);

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
    <div className="login-root">
      {/* ── big card ── */}
      <div className="login-card">

        {/* ── LEFT panel — branding ── */}
        <div className="login-left">
          <div className="login-left-inner">
            {/* Brand logo row */}
            <div className="login-brand">
              <div className="login-brand-icon">
                <ShipIcon className="login-ship-icon" />
              </div>
              <div>
                <div className="login-wordmark">Ozellar</div>
                <div className="login-tagline">All Right Inspection</div>
              </div>
            </div>

            {/* Mobile-only rich hero section */}
            <div className="login-hero-mobile">
              <div className="login-hero-badge">
                <span className="login-hero-badge-dot" />
                Maritime Inspection Platform
              </div>
              <h2 className="login-hero-heading">
                Professional vessel inspection,<br />any time, any place.
              </h2>
              <p className="login-hero-sub">
                IMO-compliant checklists · Offline-first · Instant PDF reports
              </p>
            </div>

            {/* Desktop-only hero text */}
            <p className="login-hero">
              Professional vessel&nbsp;inspection,<br />
              <span className="login-hero-accent">any&nbsp;time, any&nbsp;place.</span>
            </p>

            {/* Desktop-only feature bullets */}
            <ul className="login-features">
              <li>
                <div className="login-feat-icon"><IconShield /></div>
                <div>
                  <strong>Compliant reporting</strong>
                  <span>IMO-structured checklists with photo evidence</span>
                </div>
              </li>
              <li>
                <div className="login-feat-icon"><IconWifi /></div>
                <div>
                  <strong>Works offline</strong>
                  <span>Capture findings at sea, sync when back in port</span>
                </div>
              </li>
              <li>
                <div className="login-feat-icon"><IconClipboard /></div>
                <div>
                  <strong>Instant PDF export</strong>
                  <span>One-tap report generation for superintendents</span>
                </div>
              </li>
            </ul>
          </div>
        </div>

        {/* ── RIGHT panel — form ── */}
        <div className="login-right">
          <div className="login-form-wrap">
            {mode === 'login' ? (
              <form onSubmit={onLogin}>
                <div className="login-form-title">Welcome back</div>
                <div className="login-form-sub">Sign in with your account email to continue.</div>

                <div className="login-field">
                  <label htmlFor="lf-email">Email address</label>
                  <input
                    id="lf-email"
                    className="auth-input"
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="login-field">
                  <div className="login-field-row">
                    <label htmlFor="lf-pw">Password</label>
                    <button
                      type="button"
                      className="auth-link login-forgot-inline"
                      onClick={() => { setMode('forgot'); setError(null); setSent(false); }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="login-pw-wrap">
                    <input
                      id="lf-pw"
                      className="auth-input"
                      type={showPw ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="login-pw-toggle"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPw(v => !v)}
                    >
                      {showPw ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.06 10.06 0 0 1 12 20C7 20 2.73 16.39 1 12a10.06 10.06 0 0 1 2.06-3.94M6.53 6.53A9.94 9.94 0 0 1 12 4c5 0 9.27 3.61 11 8a10.06 10.06 0 0 1-1.53 2.47" />
                          <path d="M2 2l20 20" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12C2.73 7.61 7 4 12 4s9.27 3.61 11 8c-1.73 4.39-6 8-11 8S2.73 16.39 1 12z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {error && <div className="auth-error login-msg">{error}</div>}

                <button className="btn btn-primary btn-block login-submit" type="submit" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            ) : (
              <form onSubmit={onForgot}>
                <button
                  type="button"
                  className="login-back-btn"
                  onClick={() => { setMode('login'); setError(null); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  Back to sign in
                </button>

                <div className="login-form-title">Reset password</div>
                <div className="login-form-sub">Enter your email and we'll send you a reset link.</div>

                <div className="login-field">
                  <label htmlFor="rf-email">Email address</label>
                  <input
                    id="rf-email"
                    className="auth-input"
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                {error && <div className="auth-error login-msg">{error}</div>}
                {sent && <div className="auth-success login-msg">If that email has an account, a reset link is on its way.</div>}

                <button className="btn btn-primary btn-block login-submit" type="submit" disabled={busy || sent}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            )}
          </div>
        </div>

      </div>

      <p className="login-footer">© {new Date().getFullYear()} Ozellar Maritime Services</p>
    </div>
  );
}
