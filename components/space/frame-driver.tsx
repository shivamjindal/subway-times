'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

/**
 * Drives a `frameloop="demand"` canvas at a capped frame rate while `active`.
 * Ambient scenes don't need 60–120fps, and stopping the loop is how we pause.
 */
export function FrameDriver({ fps, active }: { fps: number; active: boolean }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (!active) return;
    const interval = 1000 / fps;
    let last = 0;
    let raf = requestAnimationFrame(function loop(time) {
      raf = requestAnimationFrame(loop);
      if (time - last >= interval - 1) {
        last = time;
        invalidate();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [active, fps, invalidate]);

  return null;
}
