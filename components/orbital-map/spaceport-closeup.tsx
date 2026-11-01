'use client';

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Plus, Repeat, Rocket, RotateCcw, Satellite, X } from 'lucide-react';
import { getPad, getSpaceport, type Pad } from '@/lib/spaceports';
import { getRouteColor, getStation } from '@/lib/subway-data';
import { formatTMinus, manifestByPad, spaceportManifest, type Fleet, type NetworkEvent } from './rocket-timeline';
import { describeApron, layoutSites, type ApronStatus } from './spaceport-layout';

const SpaceportCloseupScene = dynamic(() => import('./spaceport-closeup-scene'), {
  ssr: false,
  loading: () => (
    <div role="status" className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-[0.18em] text-telemetry">
      Rolling out the pad…
    </div>
  ),
});

/** Holds shorter than this read as on-time in the manifest. */
const HOLD_NOTICE_SECONDS = 2;
const EMPTY_APRON: ApronStatus = { landing: 0, holding: 0, onPad: 0, launching: 0 };

class CloseupErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Spaceport close-up failed to render:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface SpaceportCloseupProps {
  /** Any station of the spaceport; the close-up shows its whole complex. */
  stationId: string;
  fleet: Fleet;
  clockOffset: number;
  webgl: boolean;
  lowPower: boolean;
  reducedMotion: boolean;
  perf: boolean;
  isTracked: boolean;
  onTrack: (stationId: string) => void;
  onClose: () => void;
}

export function SpaceportCloseup({
  stationId,
  fleet,
  clockOffset,
  webgl,
  lowPower,
  reducedMotion,
  perf,
  isTracked,
  onTrack,
  onClose,
}: SpaceportCloseupProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [replayStart, setReplayStart] = useState(0);
  const [loop, setLoop] = useState(true);
  const [apron, setApron] = useState<ApronStatus>(EMPTY_APRON);
  const [contextLost, setContextLost] = useState(false);
  const now = useServerNow(clockOffset);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const handleContextLost = useCallback(() => setContextLost(true), []);

  const spaceport = getSpaceport(stationId);
  const { sites, radius } = useMemo(() => layoutSites(spaceport, fleet), [spaceport, fleet]);
  const name = spaceport.name;
  const routes = [...new Set(spaceport.pads.flatMap((pad) => pad.routes))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const otherNames = [...new Set(spaceport.stationIds.map((id) => getStation(id)?.name ?? id))].filter((n) => n !== name);
  const manifest = spaceportManifest(fleet.rockets, spaceport.stationIds, now);
  const byPad = manifestByPad(manifest, spaceport.pads.map((pad) => pad.id));
  const nextLanding = manifest.landings.find((e) => e.time > now) ?? null;
  const nextLaunch = manifest.launches.find((e) => e.time > now) ?? null;
  const quiet = mode === 'live' && manifest.landings.length === 0 && manifest.launches.length === 0;
  const showScene = webgl && !contextLost;
  const apronSummary = describeApron(apron);

  const startReplay = () => {
    setMode('replay');
    setReplayStart(Date.now() / 1000 + clockOffset);
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="spaceport-title"
      className="m-auto h-[min(92vh,820px)] w-[min(96vw,1200px)] max-w-none overflow-hidden border bg-background p-0 text-foreground backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-1">
        <div className="relative min-h-[300px] border-b lg:border-b-0 lg:border-r">
          {showScene ? (
            <CloseupErrorBoundary fallback={<SceneUnavailable detail="The close-up renderer hit an error." />}>
              <div
                className="absolute inset-0"
                role="img"
                aria-label={`Close-up of the ${name} spaceport: ${sites.length} pad${sites.length === 1 ? '' : 's'}. ${apronSummary}.`}
              >
                <SpaceportCloseupScene
                  sites={sites}
                  radius={radius}
                  fleet={fleet}
                  clockOffset={clockOffset}
                  mode={mode}
                  replayStart={replayStart}
                  loop={loop}
                  reducedMotion={reducedMotion}
                  lowPower={lowPower}
                  onStatus={setApron}
                  onContextLost={handleContextLost}
                  perf={perf}
                />
              </div>
            </CloseupErrorBoundary>
          ) : (
            <SceneUnavailable detail={contextLost ? 'The graphics context was lost.' : "This device doesn't support WebGL."} />
          )}

          {showScene && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-background/90 to-transparent px-4 pb-8 pt-3">
              <div role="status" aria-live="polite" className="font-mono text-xs uppercase tracking-[0.18em]">
                {reducedMotion ? (
                  <span className="text-muted-foreground">Still frame</span>
                ) : (
                  <span className={mode === 'replay' ? 'text-caution' : 'text-nominal'}>{mode === 'replay' ? 'Replay' : 'Live'}</span>
                )}
                <span className="text-muted-foreground"> · </span>
                <span className="text-telemetry" data-testid="pad-phase">{apronSummary}</span>
              </div>
            </div>
          )}
          {showScene && reducedMotion && (
            <p className="absolute inset-x-0 bottom-0 bg-background/85 px-4 py-2 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
              Reduced motion · still frame, refreshed every few seconds. The manifest updates live.
            </p>
          )}
          {showScene && quiet && !reducedMotion && (
            <p className="absolute inset-x-0 bottom-0 bg-background/85 px-4 py-2 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
              Nothing inbound in the next 20 minutes. Press Replay to watch a landing and launch.
            </p>
          )}
        </div>

        <aside className="overflow-y-auto p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="hud-label flex items-center gap-2">
              <Rocket className="h-3 w-3 text-ignition" /> Spaceport · station
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="-m-1 p-1 text-muted-foreground hover:text-foreground"
              aria-label="Close spaceport"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <h2 id="spaceport-title" className="hud-title mt-2 text-2xl font-bold">{name}</h2>
          {otherNames.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">with {otherNames.join(', ')}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {routes.map((route) => (
              <RouteBullet key={route} routeId={route} />
            ))}
          </div>
          <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground" data-testid="pad-count">
            {sites.length} pad{sites.length === 1 ? '' : 's'} · one per platform{sites.length > spaceport.pads.length ? ' and track' : ''}
          </p>

          {showScene && !reducedMotion && (
            <div className="mt-4 flex flex-wrap gap-2">
              <ControlButton pressed={mode === 'live'} onClick={() => setMode('live')}>
                <span className="pulse-dot" /> Live
              </ControlButton>
              <ControlButton pressed={mode === 'replay'} onClick={startReplay}>
                <RotateCcw className="h-3.5 w-3.5" /> Replay
              </ControlButton>
              <ControlButton pressed={loop} onClick={() => setLoop((l) => !l)} disabled={mode !== 'replay'}>
                <Repeat className="h-3.5 w-3.5" /> Loop
              </ControlButton>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <Countdown label="Next landing" event={nextLanding} now={now} />
            <Countdown label="Next launch" event={nextLaunch} now={now} />
          </div>

          <div className="hud-label mb-2 mt-5">Manifest by pad</div>
          <ul className="space-y-3" data-testid="pad-manifest">
            {spaceport.pads.map((pad) => (
              <PadManifest key={pad.id} pad={pad} manifest={byPad.get(pad.id)!} now={now} />
            ))}
          </ul>

          <p className="mt-4 font-mono text-[0.6rem] uppercase leading-relaxed tracking-[0.14em] text-muted-foreground">
            Landings and launches are train arrivals and departures from MTA predictions. Estimated, not GPS.
          </p>

          {!isTracked && (
            <button
              type="button"
              onClick={() => onTrack(stationId)}
              className="mt-4 flex items-center gap-1.5 border border-ignition/60 px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-ignition transition-colors hover:bg-ignition/10"
            >
              <Plus className="h-3.5 w-3.5" /> Track spaceport
            </button>
          )}
        </aside>
      </div>
    </dialog>
  );
}

function useServerNow(clockOffset: number) {
  const [now, setNow] = useState(() => Date.now() / 1000 + clockOffset);
  useEffect(() => {
    const tick = () => setNow(Date.now() / 1000 + clockOffset);
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [clockOffset]);
  return now;
}

function RouteBullet({ routeId }: { routeId: string }) {
  const color = getRouteColor(routeId);
  const dark = ['N', 'Q', 'R', 'W'].includes(routeId);
  return (
    <span
      className="route-bullet h-5 w-5 text-[0.65rem]"
      style={{ backgroundColor: `#${color}`, color: dark ? 'black' : 'white', ['--route-color' as string]: `#${color}` }}
    >
      {routeId.replace(/X$/, '')}
    </span>
  );
}

function ControlButton({
  pressed,
  onClick,
  disabled,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-[0.16em] transition-colors hover:border-telemetry hover:text-telemetry disabled:opacity-40 disabled:hover:border-border disabled:hover:text-inherit ${pressed ? 'border-telemetry text-telemetry' : 'text-muted-foreground'}`}
    >
      {children}
    </button>
  );
}

function Countdown({ label, event, now }: { label: string; event: NetworkEvent | null; now: number }) {
  return (
    <div className="border p-2">
      <div className="hud-label">{label}</div>
      {event ? (
        <>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-telemetry">{formatTMinus(event.time - now)}</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <RouteBullet routeId={event.train.routeId} />
            <span className="truncate text-muted-foreground">
              {event.kind === 'landing' ? 'from' : 'to'} {getStation(event.other ?? '')?.name ?? '—'}
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground">{getPad(event.pad)?.label ?? event.pad}</div>
        </>
      ) : (
        <div className="mt-1 font-mono text-xl text-muted-foreground">—</div>
      )}
    </div>
  );
}

function PadManifest({ pad, manifest, now }: { pad: Pad; manifest: { landings: NetworkEvent[]; launches: NetworkEvent[] }; now: number }) {
  const landings = manifest.landings.filter((e) => e.time > now).slice(0, 2);
  const launches = manifest.launches.filter((e) => e.time > now).slice(0, 2);
  return (
    <li className="border-l-2 pl-2" style={{ borderColor: `#${getRouteColor(pad.routes[0] === 'S' ? 'GS' : pad.routes[0])}` }} data-pad={pad.id}>
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.14em]">{pad.label}</div>
      {landings.length === 0 && launches.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">No traffic in the next 20 minutes.</p>
      ) : (
        <ul className="mt-1 space-y-1 font-mono text-xs tabular-nums">
          {landings.map((event) => (
            <ManifestRow key={`${event.rocket.id}-landing-${event.station}`} event={event} now={now} />
          ))}
          {launches.map((event) => (
            <ManifestRow key={`${event.rocket.id}-launch-${event.station}`} event={event} now={now} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ManifestRow({ event, now }: { event: NetworkEvent; now: number }) {
  const landing = event.kind === 'landing';
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={landing ? 'text-ignition' : 'text-nominal'} aria-label={landing ? 'Landing' : 'Launch'}>
          {landing ? '↓' : '↑'}
        </span>
        <RouteBullet routeId={event.train.routeId} />
        <span className="truncate">
          {landing ? 'from' : 'to'} {getStation(event.other ?? '')?.name ?? '—'}
        </span>
        {event.held >= HOLD_NOTICE_SECONDS && (
          <span className="shrink-0 border border-caution/60 px-1 text-[0.6rem] text-caution" title="Holding until the pad clears">
            hold +{Math.round(event.held)}s
          </span>
        )}
      </span>
      <span className="shrink-0 text-telemetry">{formatTMinus(event.time - now)}</span>
    </li>
  );
}

function SceneUnavailable({ detail }: { detail: string }) {
  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Satellite className="h-5 w-5 text-caution" />
      <div className="hud-label !text-caution">Close-up unavailable</div>
      <p className="max-w-sm text-sm text-muted-foreground">{detail} The manifest beside this panel is live.</p>
    </div>
  );
}
