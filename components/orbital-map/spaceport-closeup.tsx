'use client';

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Plus, Repeat, Rocket, RotateCcw, Satellite, X } from 'lucide-react';
import { getRouteColor, getRoutesForStation, getStation } from '@/lib/subway-data';
import type { EstimatedTrain } from '@/lib/train-positions';
import { formatTMinus, livePadPlan, spaceportManifest, type NetworkEvent } from './rocket-timeline';
import type { PadPhase } from './spaceport-closeup-scene';

const SpaceportCloseupScene = dynamic(() => import('./spaceport-closeup-scene'), {
  ssr: false,
  loading: () => (
    <div role="status" className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-[0.18em] text-telemetry">
      Rolling out the pad…
    </div>
  ),
});

const PHASE_LABELS: Record<PadPhase, string> = {
  awaiting: 'Pad clear · awaiting inbound',
  entry: 'Entry · grid fins deployed',
  'landing-burn': 'Landing burn',
  touchdown: 'Touchdown',
  'on-pad': 'On pad · venting',
  ignition: 'Ignition',
  liftoff: 'Liftoff',
  'climb-out': 'Climb-out',
};

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
  stationId: string;
  trains: EstimatedTrain[];
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
  trains,
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
  const [phase, setPhase] = useState<PadPhase>('awaiting');
  const [contextLost, setContextLost] = useState(false);
  const now = useServerNow(clockOffset);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const handleContextLost = useCallback(() => setContextLost(true), []);

  const station = getStation(stationId);
  const name = station?.name ?? stationId;
  const routes = getRoutesForStation(stationId);
  const plan = livePadPlan(trains, stationId, now);
  const { landings, launches } = spaceportManifest(trains, stationId, now);
  const nextLanding = landings.find((e) => e.time > now) ?? null;
  const nextLaunch = launches.find((e) => e.time > now) ?? null;
  const quiet = mode === 'live' && plan.touchdownAt === null && plan.liftoffAt === null;
  const showScene = webgl && !contextLost;

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
              <div className="absolute inset-0" role="img" aria-label={`Close-up of the ${name} spaceport pad. ${PHASE_LABELS[phase]}.`}>
                <SpaceportCloseupScene
                  stationId={stationId}
                  trains={trains}
                  clockOffset={clockOffset}
                  mode={mode}
                  replayStart={replayStart}
                  loop={loop}
                  reducedMotion={reducedMotion}
                  lowPower={lowPower}
                  onPhase={setPhase}
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
                <span className={mode === 'replay' ? 'text-caution' : 'text-nominal'}>{mode === 'replay' ? 'Replay' : 'Live'}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="text-telemetry" data-testid="pad-phase">{PHASE_LABELS[phase]}</span>
              </div>
            </div>
          )}
          {showScene && reducedMotion && (
            <p className="absolute inset-x-0 bottom-0 bg-background/85 px-4 py-2 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
              Reduced motion · still frame shown. The manifest updates live.
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
              <Rocket className="h-3 w-3 text-ignition" /> Spaceport
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
          <div className="mt-2 flex flex-wrap gap-1.5">
            {routes.map((route) => (
              <RouteBullet key={route.routeId} routeId={route.routeId} />
            ))}
          </div>

          {showScene && (
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

          <ManifestList title="Inbound · landings" events={landings.filter((e) => e.time > now).slice(0, 4)} now={now} direction="from" />
          <ManifestList title="Outbound · launches" events={launches.filter((e) => e.time > now).slice(0, 4)} now={now} direction="to" />

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
        </>
      ) : (
        <div className="mt-1 font-mono text-xl text-muted-foreground">—</div>
      )}
    </div>
  );
}

function ManifestList({
  title,
  events,
  now,
  direction,
}: {
  title: string;
  events: NetworkEvent[];
  now: number;
  direction: 'from' | 'to';
}) {
  return (
    <div className="mt-5">
      <div className="hud-label mb-2">{title}</div>
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">None in the next 20 minutes.</p>
      ) : (
        <ul className="space-y-1.5 font-mono text-xs tabular-nums">
          {events.map((event) => (
            <li key={`${event.train.id}-${event.kind}-${event.time}`} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <RouteBullet routeId={event.train.routeId} />
                <span className="truncate">
                  {direction} {getStation(event.other ?? '')?.name ?? '—'}
                </span>
              </span>
              <span className="shrink-0 text-telemetry">{formatTMinus(event.time - now)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
