import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Resets the window and document scroll position to top (0, 0)
 * whenever the route pathname or search parameters change.
 */
export function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    // Disable native browser scroll restoration so browser does not fight with SPA transitions
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    const resetScroll = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      const root = document.getElementById('root');
      if (root) root.scrollTop = 0;

      const app = document.getElementById('app');
      if (app) app.scrollTop = 0;
    };

    // Immediate scroll reset
    resetScroll();

    // Secondary reset via animation frame and microtask timer to guarantee
    // top scroll position even if content takes a frame to paint
    const rafId = requestAnimationFrame(resetScroll);
    const timerId = setTimeout(resetScroll, 20);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
    };
  }, [pathname, search]);

  return null;
}
