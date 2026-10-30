import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Navigate, Route, Routes } from 'react-router-dom';
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
import { useRegisterSW } from 'virtual:pwa-register/react';
import { requestPersistentStorage } from '../offline/db';
import { processPhotoQueue } from '../offline/photoQueue';
import { ScrollToTop } from './ScrollToTop';
import { TopNav } from './TopNav';
import { PhotoSyncBanner } from './PhotoSyncBanner';



/**
 * Invisible Service Worker registrar that automatically checks for server updates
 * every 60 seconds and auto-activates them in the background with zero user prompts.
 */
function SilentPwaUpdater() {
  useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      setInterval(() => void reg.update(), 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update();
      });
    },
  });
  return null;
}

export function App() {
  const token = useAuthToken();
  const resetToken = new URLSearchParams(window.location.search).get('token');

  // Request permanent, non-evictable storage so mobile browser never purges IndexedDB
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // Reached via an emailed link, whether signed in or not — always let it through.
  if (window.location.pathname === '/reset-password' && resetToken) {
    return (
      <div id="app">
        <ScrollToTop />
        <ResetPasswordScreen token={resetToken} />
      </div>
    );
  }

  return (
    <>
      <ScrollToTop />
      <div id="app">{token ? <SignedIn /> : <LoginScreen />}</div>
      {/* Silent background PWA updates without any user prompts */}
      {!Capacitor.isNativePlatform() && <SilentPwaUpdater />}
    </>
  );
}

function SignedIn() {
  useEffect(() => {
    const stop = startSyncLoop();
    void processPhotoQueue();
    return stop;
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#f4f6f9' }}>
      <TopNav />
      <PhotoSyncBanner />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
