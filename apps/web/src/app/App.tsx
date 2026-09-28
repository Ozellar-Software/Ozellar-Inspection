import { useEffect } from 'react';
import { AuthenticatedTemplate, UnauthenticatedTemplate, useMsal } from '@azure/msal-react';
import { Button, Title3, Body1 } from '@fluentui/react-components';
import { Route, Routes } from 'react-router-dom';
import { loginRequest } from '../auth/msal';
import { startSyncLoop } from '../offline/sync';
import { HomePage } from '../features/home/HomePage';
import { UpdatePrompt } from './UpdatePrompt';
import { Placeholder } from './Placeholder';

export function App() {
  const { instance } = useMsal();
  return (
    <>
      <UnauthenticatedTemplate>
        <div style={{ maxWidth: 420, margin: '80px auto', padding: 16, display: 'grid', gap: 12 }}>
          <Title3>Ozellar All Right Inspection</Title3>
          <Body1>Sign in with your Ozellar Microsoft account.</Body1>
          <Button appearance="primary" onClick={() => instance.loginRedirect(loginRequest)}>Sign in</Button>
        </div>
      </UnauthenticatedTemplate>
      <AuthenticatedTemplate>
        <SignedIn />
      </AuthenticatedTemplate>
      <UpdatePrompt />
    </>
  );
}

function SignedIn() {
  useEffect(() => startSyncLoop(), []);
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      {/* Port each screen from the current app — see src/features/README.md */}
      <Route path="/inspections/new" element={<Placeholder name="New inspection (features/inspections)" />} />
      <Route path="/inspections/:id" element={<Placeholder name="Section list (features/inspections)" />} />
      <Route path="/inspections/:id/sections/:sectionId" element={<Placeholder name="Section detail + question cards + photos" />} />
      <Route path="/inspections/:id/report" element={<Placeholder name="Report, PDF, approvals (features/report, features/approvals)" />} />
      <Route path="/vessels" element={<Placeholder name="Vessels & fleet status (features/vessels)" />} />
      <Route path="/users" element={<Placeholder name="Manage users (features/users)" />} />
      <Route path="/checklist" element={<Placeholder name="Checklist template (features/checklist)" />} />
    </Routes>
  );
}
