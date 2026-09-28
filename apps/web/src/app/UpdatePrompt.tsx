import { Button } from '@fluentui/react-components';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** "A new version of the app is available — tap to update" (replaces APP_VERSION polling in the old app). */
export function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => void reg.update(), 10 * 60_000); },
  });
  if (!needRefresh) return null;
  return (
    <div style={{ position: 'fixed', left: 12, right: 12, bottom: 16, zIndex: 1000 }}>
      <Button appearance="primary" style={{ width: '100%', padding: 14 }} onClick={() => updateServiceWorker(true)}>
        A new version of the app is available — tap to update
      </Button>
    </div>
  );
}
