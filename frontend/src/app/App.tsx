import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Route, Routes } from 'react-router-dom';
import { useAuthToken } from '../auth/useAuthToken';
import { LoginScreen } from '../auth/LoginScreen';
import { ResetPasswordScreen } from '../auth/ResetPasswordScreen';
import { startSyncLoop } from '../offline/sync';
import { HomePage } from '../features/home/HomePage';
import { VesselsPage } from '../features/vessels/VesselsPage';
import { RegisterVesselPage } from '../features/vessels/RegisterVesselPage';
import { NewInspectionPage } from '../features/inspections/NewInspectionPage';
import { SectionListPage } from '../features/inspections/SectionListPage';
import { SectionDetailPage } from '../features/inspections/SectionDetailPage';
import { ReportPage } from '../features/report/ReportPage';
import { UsersPage } from '../features/users/UsersPage';
import { RegisterUserPage } from '../features/users/RegisterUserPage';
import { ChecklistPage } from '../features/checklist/ChecklistPage';
import { UpdatePrompt } from './UpdatePrompt';

export function App() {
  const token = useAuthToken();
  const resetToken = new URLSearchParams(window.location.search).get('token');

  // Reached via an emailed link, whether signed in or not — always let it through.
  if (window.location.pathname === '/reset-password' && resetToken) {
    return <div id="app"><ResetPasswordScreen token={resetToken} /></div>;
  }

  return (
    <>
      <div id="app">{token ? <SignedIn /> : <LoginScreen />}</div>
      {/* The service-worker update prompt is a PWA concept — a Capacitor app already ships its
          assets in the native bundle, and iOS WKWebView's service worker support is unreliable. */}
      {!Capacitor.isNativePlatform() && <UpdatePrompt />}
    </>
  );
}

import { TopNav } from './TopNav';

function SignedIn() {
  useEffect(() => startSyncLoop(), []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#f4f6f9' }}>
      <TopNav />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/inspections/new" element={<NewInspectionPage />} />
      <Route path="/inspections/:id" element={<SectionListPage />} />
      <Route path="/inspections/:id/sections/:sectionId" element={<SectionDetailPage />} />
      <Route path="/inspections/:id/report" element={<ReportPage />} />
      <Route path="/vessels" element={<VesselsPage />} />
      <Route path="/vessels/new" element={<RegisterVesselPage />} />
      <Route path="/vessels/:id/edit" element={<RegisterVesselPage />} />
      <Route path="/users" element={<UsersPage />} />
      <Route path="/users/new" element={<RegisterUserPage />} />
        <Route path="/users/:id/edit" element={<RegisterUserPage />} />
        <Route path="/checklist" element={<ChecklistPage />} />
      </Routes>
      </div>
    </div>
  );
}
