import { useCallback, useState } from 'react';

/** Normal / Light mode — per device, any user. Light = inspection section list shows only Photo sections. */
const KEY = 'ozellarLightMode';

export function useLightMode(): [boolean, (on: boolean) => void] {
  const [light, setLightState] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  const setLight = useCallback((on: boolean) => {
    setLightState(on);
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ }
  }, []);
  return [light, setLight];
}

/** Use in the section list: `sections.filter((s) => !light || s.photoOnly)` */
export const visibleSections = <T extends { photoOnly: boolean }>(sections: T[], light: boolean) =>
  sections.filter((s) => !light || s.photoOnly);
