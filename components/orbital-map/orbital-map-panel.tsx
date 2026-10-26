'use client';

import { Component, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { ChevronDown, Crosshair, LocateFixed, Orbit, Plus, Radar, Satellite, X } from 'lucide-react';
import { getRouteColor, getRoutesForStation, getStation } from '@/lib/subway-data';
import { formatArrivalTime, type TrainArrival } from '@/lib/subway-parser';
import type { EstimatedTrain } from '@/lib/train-positions';

const OrbitalMapScene = dynamic(() => import('./orbital-map-scene'), {
  ssr: false,
  loading: () => <SceneStatus label="Plotting trajectories" detail="Loading 3D renderer…" />,
});

const OPEN_STORAGE_KEY = 'orbitalMapOpen';
const POLL_INTERVAL_MS = 30000;

const LINE_LEGEND: Array<{ label: string; routeId: string }> = [
  { label: 'ACE', routeId: 'A' },
  { label: 'BDFM', routeId: 'B' },
  { label: 'G', routeId: 'G' },
  { label: 'JZ', routeId: 'J' },
  { label: 'L', routeId: 'L' },
  { label: 'NQRW', routeId: 'N' },
  { label: '123', routeId: '1' },
  { label: '456', routeId: '4' },
  { label: '7', routeId: '7' },
  { label: 'S', routeId: 'GS' },
  { label: 'SIR', routeId: 'SI' },
];

type Capability = { webgl: boolean; lowPower: boolean };

let capabilityCache: Capability | null = null;
function detectCapability(): Capability {
  if (capabilityCache) return capabilityCache;
  let webgl = false;
  try {
    const canvas = document.createElement('canvas');
    webgl = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    webgl = false;
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const lowPower =
    (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || Boolean(nav.connection?.saveData);
  capabilityCache = { webgl, lowPower };
  return capabilityCache;
}

const noopSubscribe = () => () => {};

function readStoredOpen() {
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function subscribeReducedMotion(callback: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false
  );
}

interface TrainTelemetry {
  trains: EstimatedTrain[];
  clockOffset: number;
  failedFeeds: number;
  status: 'loading' | 'ok' | 'error';
}

function useTrainTelemetry(enabled: boolean): TrainTelemetry {
  const [telemetry, setTelemetry] = useState<TrainTelemetry>({ trains: [], clockOffset: 0, failedFeeds: 0, status: 'loading' });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let controller: AbortController | null = null;

    const load = async () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch('/api/train-positions', { signal: controller.signal });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.message ?? 'Failed to fetch train positions');
        if (cancelled) return;
        setTelemetry({
          trains: result.trains,
          clockOffset: result.lastUpdated - Date.now() / 1000,
          failedFeeds: result.failedFeeds,
          status: 'ok',
        });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setTelemetry((prev) => ({ ...prev, status: prev.trains.length > 0 ? 'ok' : 'error' }));
      }
    };

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', load);
    };
  }, [enabled]);

  return telemetry;
}

class SceneErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Orbital map failed to render:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface OrbitalMapPanelProps {
  savedStationIds: string[];
  arrivals: TrainArrival[];
  onTrackStation: (stationId: string) => void;
}

export function OrbitalMapPanel({ savedStationIds, arrivals, onTrackStation }: OrbitalMapPanelProps) {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const capability = useSyncExternalStore(noopSubscribe, detectCapability, () => null);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === 'light' ? 'light' : 'dark';

  const storedOpen = useSyncExternalStore(noopSubscribe, readStoredOpen, () => false);
  const open = openOverride ?? storedOpen;

  const toggleOpen = () => {
    setOpenOverride(!open);
    try {
      localStorage.setItem(OPEN_STORAGE_KEY, String(!open));
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this visit.
    }
  };

  const canRender = open && capability?.webgl === true && !contextLost;
  const telemetry = useTrainTelemetry(canRender);

  const selectStation = useCallback((stationId: string | null) => {
    setSelectedStationId(stationId);
    setFocusNonce((n) => n + 1);
  }, []);

  const handleContextLost = useCallback(() => setContextLost(true), []);

  const retryScene = () => {
    setContextLost(false);
    setSceneKey((k) => k + 1);
  };

  const unavailable = (detail: string, retry?: () => void) => (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center border border-caution/50">
        <Satellite className="h-5 w-5 text-caution" />
      </div>
      <div className="hud-label !text-caution">3D map unavailable</div>
      <p className="max-w-sm text-sm text-muted-foreground">{detail} Arrivals and tracked stations keep working as normal.</p>
      {retry && (
        <button type="button" onClick={retry} className="border px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] hover:border-telemetry hover:text-telemetry">
          Retry renderer
        </button>
      )}
    </div>
  );

  let sceneContent: ReactNode;
  if (!capability) {
    sceneContent = <SceneStatus label="Checking systems" detail="Probing graphics support…" />;
  } else if (!capability.webgl) {
    sceneContent = unavailable("This browser or device doesn't support WebGL.");
  } else if (contextLost) {
    sceneContent = unavailable('The graphics context was lost.', retryScene);
  } else {
    sceneContent = (
      <SceneErrorBoundary key={sceneKey} fallback={unavailable('The 3D renderer hit an error.', retryScene)}>
        <OrbitalMapScene
          trains={telemetry.trains}
          clockOffset={telemetry.clockOffset}
          savedStationIds={savedStationIds}
          selectedStationId={selectedStationId}
          focusNonce={focusNonce}
          onSelectStation={selectStation}
          reducedMotion={reducedMotion}
          lowPower={capability.lowPower}
          theme={theme}
          onContextLost={handleContextLost}
        />
      </SceneErrorBoundary>
    );
  }

  return (
    <section className="hud-panel mb-6" aria-labelledby="orbital-map-title">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2 sm:px-6">
        <h2 id="orbital-map-title" className="hud-label flex items-center gap-2">
          <Orbit className="h-3 w-3 text-telemetry" />
          Orbital map · NYC subway
        </h2>
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-controls="orbital-map-body"
          className="flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-telemetry"
        >
          {open ? 'Collapse' : 'Open map'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div id="orbital-map-body" className="grid lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="relative h-[360px] overflow-hidden sm:h-[480px]">
            <div
              className="absolute inset-0"
              {...(canRender && {
                role: 'img',
                'aria-label': `3D map of NYC subway lines and stations with ${telemetry.trains.length} estimated train positions. Use the station list beside the map to navigate by keyboard.`,
              })}
            >
              {sceneContent}
            </div>
            {canRender && (
              <>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-background/90 to-transparent px-4 pb-3 pt-8">
                  <p className="font-mono text-[0.65rem] uppercase leading-relaxed tracking-[0.14em] text-muted-foreground">
                    <span className="text-caution">Est. positions</span> · interpolated between stations from MTA arrival predictions — not GPS
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => selectStation(null)}
                  className="absolute right-3 top-3 flex items-center gap-1.5 border bg-card px-2 py-1 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-telemetry hover:text-telemetry"
                >
                  <LocateFixed className="h-3 w-3" /> Overview
                </button>
              </>
            )}
          </div>

          <aside className="space-y-5 border-t p-4 lg:border-l lg:border-t-0">
            <SelectedStationReadout
              stationId={selectedStationId}
              isSaved={selectedStationId !== null && savedStationIds.includes(selectedStationId)}
              arrivals={arrivals}
              onTrack={onTrackStation}
              onClear={() => selectStation(null)}
            />

            <div>
              <div className="hud-label mb-2">Tracked stations</div>
              {savedStationIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">Track a station to pin a beacon on the map.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {savedStationIds.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => selectStation(id)}
                        aria-pressed={selectedStationId === id}
                        className={`flex items-center gap-1.5 border px-2 py-1 text-left transition-colors hover:border-ignition ${selectedStationId === id ? 'border-telemetry text-telemetry' : ''}`}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 bg-ignition" aria-hidden="true" />
                        <span className="hud-title text-sm font-semibold">{getStation(id)?.name ?? id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="hud-label mb-2">Trajectories</div>
              <ul className="grid grid-cols-3 gap-x-3 gap-y-1.5 font-mono text-[0.65rem] tracking-[0.12em]">
                {LINE_LEGEND.map(({ label, routeId }) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 shrink-0" style={{ backgroundColor: `#${getRouteColor(routeId)}`, boxShadow: `0 0 6px #${getRouteColor(routeId)}` }} aria-hidden="true" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>

            {canRender && <div className="hud-divider" />}
            {canRender && (
              <div role="status" aria-live="polite" className="flex items-start gap-2 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                <span className={telemetry.status === 'ok' ? 'text-nominal' : telemetry.status === 'error' ? 'text-caution' : 'text-telemetry'}>
                  <span className="pulse-dot" />
                </span>
                <span>
                  {telemetry.status === 'loading' && 'Acquiring train telemetry…'}
                  {telemetry.status === 'error' && 'Train telemetry unavailable · lines and stations only'}
                  {telemetry.status === 'ok' &&
                    `${telemetry.trains.length} trains plotted (estimated)${telemetry.failedFeeds > 0 ? ` · ${telemetry.failedFeeds} feed${telemetry.failedFeeds > 1 ? 's' : ''} offline` : ''}`}
                </span>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

function SelectedStationReadout({
  stationId,
  isSaved,
  arrivals,
  onTrack,
  onClear,
}: {
  stationId: string | null;
  isSaved: boolean;
  arrivals: TrainArrival[];
  onTrack: (stationId: string) => void;
  onClear: () => void;
}) {
  const now = useNowSeconds();

  if (!stationId) {
    return (
      <div>
        <div className="hud-label mb-2 flex items-center gap-2">
          <Crosshair className="h-3 w-3 text-telemetry" /> No target selected
        </div>
        <p className="text-xs text-muted-foreground">Click a station node to fly to it, or pick a tracked station below.</p>
      </div>
    );
  }

  const station = getStation(stationId);
  const routes = getRoutesForStation(stationId);
  const nextArrivals = isSaved ? arrivals.filter((a) => a.stationId === stationId && a.arrivalTime > now).slice(0, 3) : [];

  return (
    <div aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div className="hud-label flex items-center gap-2">
          <Crosshair className="h-3 w-3 text-telemetry" /> Target locked
        </div>
        <button type="button" onClick={onClear} className="-m-1 p-1 text-muted-foreground hover:text-foreground" aria-label="Clear selected station">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <h3 className="hud-title mt-2 text-2xl font-bold">{station?.name ?? stationId}</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {routes.map((route) => (
          <span
            key={route.routeId}
            className="route-bullet h-5 w-5 text-[0.65rem]"
            style={{
              backgroundColor: `#${route.color || getRouteColor(route.routeId)}`,
              color: route.textColor === 'FFFFFF' ? 'white' : 'black',
              ['--route-color' as string]: `#${getRouteColor(route.routeId)}`,
            }}
          >
            {route.shortName}
          </span>
        ))}
      </div>

      {isSaved ? (
        <div className="mt-3">
          <div className="hud-label !text-ignition">Tracking</div>
          {nextArrivals.length > 0 ? (
            <ul className="mt-2 space-y-1 font-mono text-xs tabular-nums">
              {nextArrivals.map((a) => (
                <li key={`${a.tripId}-${a.stopId}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="font-semibold">{a.routeId}</span> · {a.destination}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-telemetry">{formatArrivalTime(a.arrivalTime - now)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No upcoming arrivals reported.</p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onTrack(stationId)}
          className="mt-3 flex items-center gap-1.5 border border-ignition/60 px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-ignition transition-colors hover:bg-ignition/10"
        >
          <Plus className="h-3.5 w-3.5" /> Track station
        </button>
      )}
    </div>
  );
}

function useNowSeconds() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(interval);
  }, []);
  return now;
}

function SceneStatus({ label, detail }: { label: string; detail: string }) {
  return (
    <div role="status" aria-live="polite" className="scanline flex h-full items-center justify-center gap-4 px-6">
      <Radar className="h-5 w-5 text-telemetry" />
      <div>
        <div className="hud-title text-xl font-bold text-telemetry">
          {label}
          <span className="blink">…</span>
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}
