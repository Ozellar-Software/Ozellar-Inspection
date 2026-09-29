import { useEffect, useState } from 'react';
import { getToken, subscribe } from './session';

/** null = signed out. Re-renders on login/logout anywhere in the app. */
export function useAuthToken(): string | null {
  const [token, setLocalToken] = useState(getToken());
  useEffect(() => subscribe(() => setLocalToken(getToken())), []);
  return token;
}
