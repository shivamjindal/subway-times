'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { useIdleMount, usePageVisible, usePrefersReducedMotion, useWebGLSupport } from './hooks';

const StarfieldCanvas = dynamic(() => import('./starfield-canvas'), { ssr: false, loading: () => null });

/**
 * WebGL starfield layered over the CSS `.starfield`. The CSS stars stay as the first-paint
 * and no-WebGL fallback and are hidden (via `data-webgl-stars`) only once the canvas is live.
 */
export function SpaceBackdrop() {
  const webgl = useWebGLSupport();
  const idle = useIdleMount();
  const reducedMotion = usePrefersReducedMotion();
  const pageVisible = usePageVisible();
  const { resolvedTheme } = useTheme();
  const [ready, setReady] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const handleReady = useCallback(() => setReady(true), []);
  const handleContextLost = useCallback(() => setContextLost(true), []);

  const live = ready && !contextLost;

  useEffect(() => {
    if (!live) return;
    const root = document.documentElement;
    root.dataset.webglStars = '';
    return () => {
      delete root.dataset.webglStars;
    };
  }, [live]);

  if (webgl !== true || !idle || contextLost) return null;

  const starsVisible = resolvedTheme !== 'light';

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none transition-opacity duration-700"
      style={{ opacity: live ? 'var(--star-opacity)' : 0 }}
    >
      <StarfieldCanvas
        animate={!reducedMotion}
        active={pageVisible && starsVisible}
        onReady={handleReady}
        onContextLost={handleContextLost}
      />
    </div>
  );
}
