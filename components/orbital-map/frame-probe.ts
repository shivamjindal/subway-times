'use client';

import { useEffect, useRef } from 'react';
import { addAfterEffect, addEffect, useThree } from '@react-three/fiber';

export interface FrameCost {
  fps: number;
  /** Draw calls per frame, summed over every render pass (bloom included). */
  drawCalls: number;
  /** Main-thread ms per frame: all useFrame callbacks plus render submission. */
  cpuMs: number;
}

/**
 * Opt-in per-frame cost probe. Averages over one-second windows and hands the result to `onSample`.
 * renderer.info resets on every render() call by default, which would count only the last post-processing pass.
 */
export function useFrameCost(enabled: boolean, onSample: (cost: FrameCost) => void) {
  const gl = useThree((s) => s.gl);
  const sampleRef = useRef(onSample);
  useEffect(() => {
    sampleRef.current = onSample;
  });

  useEffect(() => {
    if (!enabled) return;
    gl.info.autoReset = false;
    let frameStart = 0;
    let windowStart = performance.now();
    let frames = 0;
    let cpu = 0;
    let calls = 0;
    const before = addEffect(() => {
      frameStart = performance.now();
      gl.info.reset();
    });
    const after = addAfterEffect(() => {
      const end = performance.now();
      frames++;
      cpu += end - frameStart;
      calls += gl.info.render.calls;
      if (end - windowStart < 1000) return;
      sampleRef.current({
        fps: Math.round((frames * 1000) / (end - windowStart)),
        drawCalls: Math.round(calls / frames),
        cpuMs: Math.round((cpu / frames) * 100) / 100,
      });
      frames = 0;
      cpu = 0;
      calls = 0;
      windowStart = end;
    });
    return () => {
      before();
      after();
      gl.info.autoReset = true;
    };
  }, [enabled, gl]);
}
