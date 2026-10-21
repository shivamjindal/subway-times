'use client';

import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { NYC } from './constants';
import { useIdleMount, useInView, usePageVisible, usePrefersReducedMotion, useWebGLSupport } from './hooks';

const EarthGlobe = dynamic(() => import('./earth-globe'), { ssr: false, loading: () => null });

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? positive : negative}`;
}

export function HeaderEarth() {
  const containerRef = useRef<HTMLDivElement>(null);
  const webgl = useWebGLSupport();
  const idle = useIdleMount();
  const reducedMotion = usePrefersReducedMotion();
  const pageVisible = usePageVisible();
  const inView = useInView(containerRef);
  const [ready, setReady] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const handleReady = useCallback(() => setReady(true), []);
  const handleContextLost = useCallback(() => setContextLost(true), []);

  const showCanvas = webgl === true && idle && !contextLost;

  return (
    <div className="hidden min-[375px]:flex items-center gap-3">
      <div
        ref={containerRef}
        role="img"
        aria-label="Earth with a beacon marking New York City"
        className="relative h-10 w-10 shrink-0 sm:h-14 sm:w-14 md:h-20 md:w-20"
      >
        {/* Static globe: first paint, no-WebGL fallback, and backdrop while the 3D chunk loads. */}
        <div
          aria-hidden="true"
          className={`earth-static absolute inset-[12%] transition-opacity duration-700 ${ready && showCanvas ? 'opacity-0' : 'opacity-100'}`}
        >
          <span className="earth-static-beacon" />
        </div>
        {showCanvas && (
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`}>
            <EarthGlobe
              animate={!reducedMotion}
              active={pageVisible && inView}
              onReady={handleReady}
              onContextLost={handleContextLost}
            />
          </div>
        )}
      </div>
      <div className="hidden lg:block font-mono text-xs tabular-nums">
        <div className="hud-label">Beacon · NYC</div>
        <div className="mt-1 text-ignition">
          {formatCoordinate(NYC.lat, 'N', 'S')} {formatCoordinate(NYC.lon, 'E', 'W')}
        </div>
      </div>
    </div>
  );
}
