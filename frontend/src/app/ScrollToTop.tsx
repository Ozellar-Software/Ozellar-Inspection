import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Key for session storage map of scroll positions per route.
 */
const SCROLL_POSITIONS_KEY = 'oz_route_scroll_map';
const NAV_STACK_KEY = 'oz_route_nav_stack';

function getScrollY(): number {
  return (
    window.scrollY ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0
  );
}

function setScrollY(top: number) {
  window.scrollTo({ top, left: 0, behavior: 'instant' as ScrollBehavior });
  if (document.documentElement) document.documentElement.scrollTop = top;
  if (document.body) document.body.scrollTop = top;
  const root = document.getElementById('root');
  if (root) root.scrollTop = top;
  const app = document.getElementById('app');
  if (app) app.scrollTop = top;
}

function loadScrollMap(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(SCROLL_POSITIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveScrollMap(map: Record<string, number>) {
  try {
    sessionStorage.setItem(SCROLL_POSITIONS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function loadNavStack(): string[] {
  try {
    const raw = sessionStorage.getItem(NAV_STACK_KEY);
    return raw ? JSON.parse(raw) : ['/'];
  } catch {
    return ['/'];
  }
}

function saveNavStack(stack: string[]) {
  try {
    sessionStorage.setItem(NAV_STACK_KEY, JSON.stringify(stack));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Intelligent Per-Page Scroll Restoration:
 * 1. Opening a NEW page/section/inspection -> Always starts cleanly at top (0, 0).
 * 2. RETURNING to a previous page (e.g. back to section list from question details) ->
 *    Restores scroll position to exactly where the user left off, without affecting other pages.
 * 3. Handles asynchronous data loading (Dexie IndexedDB queries) so scroll is not clamped to 0.
 */
export function ScrollToTop() {
  const location = useLocation();
  const navType = useNavigationType();

  const currentPath = location.pathname;
  const prevPathRef = useRef<string>(currentPath);
  const activeControllerRef = useRef<{ cancel: () => void } | null>(null);

  // Keep manual browser scroll restoration active
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  // Continuously record scroll position of the current page as user scrolls
  useEffect(() => {
    let ticking = false;

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const y = getScrollY();
          const map = loadScrollMap();
          map[currentPath] = y;
          saveScrollMap(map);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [currentPath]);

  // Handle route change: Decide whether to restore scroll or reset to top
  useEffect(() => {
    const prevPath = prevPathRef.current;
    prevPathRef.current = currentPath;

    // Save final scroll of previous path
    const map = loadScrollMap();
    if (prevPath) {
      map[prevPath] = getScrollY();
      saveScrollMap(map);
    }

    // Cancel any previous restoration loop
    if (activeControllerRef.current) {
      activeControllerRef.current.cancel();
      activeControllerRef.current = null;
    }

    const navStack = loadNavStack();

    // Determine if this is returning to a previously visited page:
    // 1. Browser POP (back/forward navigation), OR
    // 2. Navigating from child route back to parent (e.g. /sections/x back to /inspections/id, or /inspections/id back to /), OR
    // 3. Target route is an existing ancestor in our navigation stack
    const isChildToParent = prevPath && currentPath !== prevPath && (
      prevPath.startsWith(currentPath + '/') ||
      (currentPath === '/' && prevPath.startsWith('/inspections/'))
    );
    const existingStackIndex = navStack.indexOf(currentPath);
    const isAncestorInStack = existingStackIndex !== -1 && existingStackIndex < navStack.length - 1;

    const isReturn = navType === 'POP' || isChildToParent || isAncestorInStack;

    if (isReturn) {
      // ── RETURNING TO PREVIOUS PAGE: Restore scroll position ──
      // Update nav stack
      if (existingStackIndex !== -1) {
        navStack.splice(existingStackIndex + 1);
      }
      saveNavStack(navStack);

      const savedY = map[currentPath] ?? 0;

      // Check if an explicit target element ID was recorded (e.g. clicked section card)
      let targetElementId: string | null = null;
      if (currentPath.startsWith('/inspections/')) {
        const parts = currentPath.split('/');
        const inspId = parts[2];
        if (inspId && parts.length === 3) {
          targetElementId = sessionStorage.getItem(`oz_last_sec_${inspId}`);
        }
      } else if (currentPath === '/') {
        targetElementId = sessionStorage.getItem('oz_last_home_item');
      }

      let isCancelled = false;
      let userInteracted = false;

      const onUserInteraction = () => {
        userInteracted = true;
      };

      window.addEventListener('wheel', onUserInteraction, { passive: true, once: true });
      window.addEventListener('touchstart', onUserInteraction, { passive: true, once: true });
      window.addEventListener('keydown', onUserInteraction, { passive: true, once: true });

      const startTime = performance.now();
      const maxWaitMs = 1200; // Allow up to 1.2s for async queries (Dexie) to populate content

      const restoreStep = () => {
        if (isCancelled || userInteracted) return;

        let scrolledToElement = false;
        if (targetElementId) {
          const el = document.getElementById(targetElementId);
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            scrolledToElement = true;
          }
        }

        if (!scrolledToElement && savedY > 0) {
          setScrollY(savedY);
        }

        const currentY = getScrollY();
        const docHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
        const reachedTarget = (savedY > 0 && Math.abs(currentY - savedY) < 15) || (docHeight >= savedY + window.innerHeight * 0.5);

        if (!reachedTarget && performance.now() - startTime < maxWaitMs) {
          requestAnimationFrame(restoreStep);
        }
      };

      // Initial immediate restore attempt
      restoreStep();

      // Scheduled checkpoints to align with React & Dexie render cycles
      const t1 = setTimeout(restoreStep, 40);
      const t2 = setTimeout(restoreStep, 120);
      const t3 = setTimeout(restoreStep, 250);
      const t4 = setTimeout(restoreStep, 500);

      activeControllerRef.current = {
        cancel: () => {
          isCancelled = true;
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
          clearTimeout(t4);
          window.removeEventListener('wheel', onUserInteraction);
          window.removeEventListener('touchstart', onUserInteraction);
          window.removeEventListener('keydown', onUserInteraction);
        },
      };
    } else {
      // ── NAVIGATING TO A NEW PAGE: Always open from the top ──
      // Update nav stack
      navStack.push(currentPath);
      saveNavStack(navStack);

      // Reset scroll map for this fresh page visit so it starts at top (0, 0)
      map[currentPath] = 0;
      saveScrollMap(map);

      // Perform immediate top scroll
      setScrollY(0);

      let isCancelled = false;
      const resetToTop = () => {
        if (!isCancelled) {
          setScrollY(0);
        }
      };

      const rafId = requestAnimationFrame(resetToTop);
      const t1 = setTimeout(resetToTop, 20);
      const t2 = setTimeout(resetToTop, 60);

      activeControllerRef.current = {
        cancel: () => {
          isCancelled = true;
          cancelAnimationFrame(rafId);
          clearTimeout(t1);
          clearTimeout(t2);
        },
      };
    }
  }, [currentPath, navType]);

  return null;
}
