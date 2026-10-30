import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',           // silently updates in background without prompting user
      includeAssets: [
        'favicon.svg',
        'favicon.ico',
        'icon-16.png',
        'icon-32.png',
        'icon-48.png',
        'icon-128.png',
        'icon-192.png',
        'icon-512.png',
        'apple-touch-icon.png',
        'icon-maskable-192.png',
        'icon-maskable-512.png',
      ],
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
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
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
