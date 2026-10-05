import { useCallback, useEffect, useState } from 'react';

/**
 * Normal / Light mode — device & session synchronized.
 * Normal: Standard comprehensive checklist audit (all questions, sections, compliance evaluation).
 * Light: Photo-first walkthrough (shows only photo-only sections & photo-specific data).
 */
const KEY = 'ozellarLightMode';

let globalLight = (() => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
})();
const listeners = new Set<(on: boolean) => void>();

export function useLightMode(): [boolean, (on: boolean) => void] {
  const [light, setLightState] = useState(globalLight);

  useEffect(() => {
    const l = (val: boolean) => setLightState(val);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  const setLight = useCallback((on: boolean) => {
    globalLight = on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ }
    listeners.forEach((l) => l(on));
  }, []);

  return [light, setLight];
}

/** Filters sections: in Light mode, only photo sections (photoOnly === true) are retained. */
export const visibleSections = <T extends { photoOnly?: boolean }>(sections: T[], light: boolean) =>
  sections.filter((s) => !light || !!s.photoOnly);
