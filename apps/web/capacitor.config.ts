import type { CapacitorConfig } from '@capacitor/cli';

// Native builds have no same-origin dev proxy — set VITE_API_BASE to the Function App's
// full URL (e.g. https://ozellar-vir-api.azurewebsites.net/api) before running `npm run build`.
const config: CapacitorConfig = {
  appId: 'com.ozellar.vir',
  appName: 'Ozellar Inspection',
  webDir: 'dist',
  backgroundColor: '#F4F6F7',
  android: { allowMixedContent: false },
};

export default config;
