import { PublicClientApplication, InteractionRequiredAuthError, type AccountInfo } from '@azure/msal-browser';

export const msal = new PublicClientApplication({
  auth: {
    clientId: import.meta.env.VITE_ENTRA_WEB_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID}`,
    redirectUri: window.location.origin,
  },
  cache: { cacheLocation: 'localStorage' }, // keeps people signed in offline between app launches
});

export const loginRequest = { scopes: [import.meta.env.VITE_API_SCOPE as string] };

export function account(): AccountInfo | null {
  return msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
}

/** Access token for the API; refreshes silently, falls back to a redirect when needed. */
export async function apiToken(): Promise<string> {
  const acc = account();
  if (!acc) {
    await msal.loginRedirect(loginRequest);
    throw new Error('Redirecting to sign in');
  }
  try {
    const r = await msal.acquireTokenSilent({ ...loginRequest, account: acc });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ ...loginRequest, account: acc });
    }
    throw e;
  }
}
