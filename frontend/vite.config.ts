import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',               // shows "New version available — tap to update"
      includeAssets: ['favicon.svg', 'favicon.ico', 'icon-128.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Ozellar Vessel Inspection',
        short_name: 'Ozellar',
        description: 'Offline vessel inspection checklist and report builder.',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#F4F6F7',
        theme_color: '#0B2138',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          { // photos (SAS URLs) cached for offline viewing
            urlPattern: ({ url }) => url.hostname.endsWith('.blob.core.windows.net'),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 60 },
                       cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7071',
        changeOrigin: true,
      },
    },
  },
});
