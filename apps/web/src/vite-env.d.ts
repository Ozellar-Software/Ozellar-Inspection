/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
interface ImportMetaEnv {
  readonly VITE_ENTRA_TENANT_ID: string;
  readonly VITE_ENTRA_WEB_CLIENT_ID: string;
  readonly VITE_API_SCOPE: string;
  readonly VITE_API_BASE: string;
}
