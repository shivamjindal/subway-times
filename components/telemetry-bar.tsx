'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { type TrainArrival, type ServiceAlert } from '@/lib/subway-parser';
import { getStation, getRoutesForStation, getRouteColor, getDirectionLabel, type Route } from '@/lib/subway-data';

interface TelemetryStation {
  stationId: string;
  direction: 'all' | 'N' | 'S';
  selectedRoutes?: string[];
}

interface TelemetryBarProps {
  stations: TelemetryStation[];
  arrivalsByStation: Record<string, TrainArrival[]>;
  alertsByStation: Record<string, ServiceAlert[]>;
}

const STATION_KEY = 'telemetryStationId';
const COLLAPSED_KEY = 'telemetryBarCollapsed';
const GAUGE_SCALE_SECONDS = 15 * 60;
const ARRIVING_THRESHOLD_SECONDS = 60;

// The bar only mounts after stations load from localStorage, so it never renders on the server.
function readStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : (JSON.parse(saved) as T);
  } catch {
    return fallback;
  }
}

function useNowSeconds() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);
  return now;
}

function formatClock(seconds: number | null) {
  if (seconds === null) return '--:--';
  const clamped = Math.min(seconds, 99 * 60 + 59);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

// 270° gauge opening at the bottom, like the speed/altitude dials on a launch webcast.
const START_DEG = 135;
const SWEEP_DEG = 270;
const R = 40;

function polar(deg: number, radius: number) {
  const rad = (deg * Math.PI) / 180;
  return [50 + radius * Math.cos(rad), 50 + radius * Math.sin(rad)] as const;
}

const [ARC_X0, ARC_Y0] = polar(START_DEG, R);
const [ARC_X1, ARC_Y1] = polar(START_DEG + SWEEP_DEG, R);
const ARC_PATH = `M ${ARC_X0} ${ARC_Y0} A ${R} ${R} 0 1 1 ${ARC_X1} ${ARC_Y1}`;
const TICKS = Array.from({ length: 16 }, (_, minute) => {
  const deg = START_DEG + (SWEEP_DEG * minute) / 15;
  const major = minute % 5 === 0;
  const [x1, y1] = polar(deg, major ? 45 : 46.5);
  const [x2, y2] = polar(deg, 49);
  return { minute, major, x1, y1, x2, y2 };
});

interface GaugeProps {
  fraction: number;
  value: string;
  prefix?: string;
  prefixColor?: string;
  caption: string;
  label: string;
  tone: 'ignition' | 'telemetry';
  ariaLabel: string;
}

function Gauge({ fraction, value, prefix, prefixColor, caption, label, tone, ariaLabel }: GaugeProps) {
  const filled = Math.max(0, Math.min(1, fraction)) * 100;
  const color = tone === 'ignition' ? 'var(--ignition)' : 'var(--telemetry)';

  return (
    <figure className="flex flex-col items-center gap-1.5 shrink-0">
      <svg viewBox="0 0 100 100" role="img" aria-label={ariaLabel} className="h-[84px] w-[84px] sm:h-[112px] sm:w-[112px] overflow-visible">
        {TICKS.map((tick) => (
          <line
            key={tick.minute}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke="currentColor"
            strokeWidth={tick.major ? 1.2 : 0.6}
            className={tick.major ? 'text-foreground/60' : 'text-foreground/25'}
          />
        ))}
        <path d={ARC_PATH} pathLength={100} fill="none" stroke="var(--border)" strokeWidth={5} />
        <path
          d={ARC_PATH}
          pathLength={100}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeDasharray="100 100"
          className="telemetry-arc"
          style={{
            strokeDashoffset: 100 - filled,
            filter: `drop-shadow(0 0 3px color-mix(in oklab, ${color} 60%, transparent))`,
          }}
        />
        <text x={50} y={37} textAnchor="middle" className="font-mono" fill={prefixColor ?? 'var(--muted-foreground)'} fontSize={7} fontWeight={600} letterSpacing={0.6}>
          {prefix ?? ''}
        </text>
        <text x={50} y={56} textAnchor="middle" className="font-mono fill-foreground tabular-nums" fontSize={value.length > 5 ? 14 : 17} fontWeight={700}>
          {value}
        </text>
        <text x={50} y={68} textAnchor="middle" className="font-mono fill-muted-foreground" fontSize={6} letterSpacing={1.2}>
          {caption}
        </text>
        <text x={ARC_X0 + 2} y={95} textAnchor="middle" className="font-mono fill-muted-foreground" fontSize={6}>0</text>
        <text x={ARC_X1 - 2} y={95} textAnchor="middle" className="font-mono fill-muted-foreground" fontSize={6}>15</text>
      </svg>
      <figcaption className="hud-label">{label}</figcaption>
    </figure>
  );
}

function MiniBullet({ routeId, route }: { routeId: string; route?: Route }) {
  const color = getRouteColor(routeId);
  return (
    <span
      className="route-bullet h-4 w-4 text-[0.6rem] shrink-0"
      style={{
        backgroundColor: `#${color}`,
        color: route?.textColor === 'FFFFFF' ? 'white' : 'black',
        ['--route-color' as string]: `#${color}`,
      }}
    >
      {routeId}
    </span>
  );
}

export function TelemetryBar({ stations, arrivalsByStation, alertsByStation }: TelemetryBarProps) {
  const now = useNowSeconds();
  const [selectedId, setSelectedId] = useState<string | null>(() => readStorage<string | null>(STATION_KEY, null));
  const [collapsed, setCollapsed] = useState(() =>
    readStorage(COLLAPSED_KEY, window.matchMedia('(max-width: 639px)').matches)
  );
  const barRef = useRef<HTMLDivElement>(null);
  const [reservedHeight, setReservedHeight] = useState(0);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => setReservedHeight(bar.offsetHeight));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const activeIndex = Math.max(0, stations.findIndex((s) => s.stationId === selectedId));
  const active = stations[activeIndex];
  const station = getStation(active.stationId);
  const routes = getRoutesForStation(active.stationId);
  const stationArrivals = arrivalsByStation[active.stationId];
  const alerts = alertsByStation[active.stationId] || [];

  const upcoming = useMemo(() => {
    const filterRoutes = active.selectedRoutes && active.selectedRoutes.length > 0 ? new Set(active.selectedRoutes) : null;
    return (stationArrivals || []).filter(
      (a) =>
        a.arrivalTime > now &&
        (active.direction === 'all' || a.direction === active.direction) &&
        (!filterRoutes || filterRoutes.has(a.routeId))
    );
  }, [stationArrivals, active.direction, active.selectedRoutes, now]);

  const next = upcoming[0];
  const following = next ? upcoming.find((a, i) => i > 0 && a.direction === next.direction) : undefined;
  const secondsToNext = next ? next.arrivalTime - now : null;
  const headway = next && following ? following.arrivalTime - next.arrivalTime : null;
  const window15 = upcoming.filter((a) => a.arrivalTime - now <= GAUGE_SCALE_SECONDS);
  const isArriving = secondsToNext !== null && secondsToNext < ARRIVING_THRESHOLD_SECONDS;

  const status = alerts.length > 0
    ? { text: `Advisory · ${alerts.length}`, className: 'text-caution' }
    : upcoming.length === 0
      ? { text: 'No signal', className: 'text-muted-foreground' }
      : { text: 'Nominal', className: 'text-nominal' };

  const trackedRoutes = active.selectedRoutes && active.selectedRoutes.length > 0
    ? routes.filter((r) => active.selectedRoutes!.includes(r.routeId))
    : routes;
  const trajectory = active.direction === 'all'
    ? 'All trajectories'
    : `${active.direction === 'N' ? '↑' : '↓'} ${getDirectionLabel(active.direction, stationArrivals || [])}`;

  const select = (offset: number) => {
    const target = stations[(activeIndex + offset + stations.length) % stations.length].stationId;
    setSelectedId(target);
    localStorage.setItem(STATION_KEY, JSON.stringify(target));
  };

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(!collapsed));
  };

  const cycleButtons = stations.length > 1 && (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" onClick={() => select(-1)} aria-label="Previous station" className="h-7 w-7 border flex items-center justify-center hover:border-telemetry hover:text-telemetry transition-colors">
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="font-mono text-[0.65rem] tabular-nums text-muted-foreground w-9 text-center">
        {String(activeIndex + 1).padStart(2, '0')}/{String(stations.length).padStart(2, '0')}
      </span>
      <button type="button" onClick={() => select(1)} aria-label="Next station" className="h-7 w-7 border flex items-center justify-center hover:border-telemetry hover:text-telemetry transition-colors">
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const collapseButton = (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand telemetry' : 'Collapse telemetry'}
      className="h-7 w-7 border flex items-center justify-center shrink-0 hover:border-telemetry hover:text-telemetry transition-colors"
    >
      {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
    </button>
  );

  if (!station) return null;

  return (
    <>
      <div aria-hidden="true" style={{ height: reservedHeight }} />
      <div
        ref={barRef}
        className="fixed inset-x-0 bottom-0 z-40 pointer-events-none bg-gradient-to-t from-background via-background/90 to-transparent pt-6 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="container mx-auto max-w-6xl px-4">
          <section aria-label="Live telemetry" className="hud-panel pointer-events-auto">
            {collapsed ? (
              <div className="flex items-center gap-3 px-3 sm:px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="hud-label truncate">Telemetry · Stn {station.stopId}</div>
                  <div className="hud-title text-base font-bold truncate mt-1">{station.name}</div>
                </div>
                <div className="text-right font-mono tabular-nums shrink-0">
                  <div className="hud-label">Next</div>
                  <div className={`text-base font-bold mt-0.5 ${isArriving ? 'text-ignition' : ''}`}>T−{formatClock(secondsToNext)}</div>
                </div>
                <div className="hidden min-[360px]:block text-right font-mono tabular-nums shrink-0">
                  <div className="hud-label">Headway</div>
                  <div className="text-base font-bold mt-0.5 text-telemetry">{formatClock(headway)}</div>
                </div>
                <span className={`${status.className} shrink-0`} title={status.text}><span className="pulse-dot" /></span>
                <div className="hidden sm:block">{cycleButtons}</div>
                {collapseButton}
              </div>
            ) : (
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-6 gap-y-3 px-3 sm:px-5 py-3">
                <div className="min-w-0 basis-full sm:basis-auto sm:flex-1 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="hud-label flex items-center gap-2">
                      <span className="text-ignition">■</span>Telemetry · Stn {station.stopId}
                    </div>
                    <div className="hud-title text-xl sm:text-2xl font-bold truncate mt-1.5">{station.name}</div>
                    <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
                      {trackedRoutes.map((r) => <MiniBullet key={r.routeId} routeId={r.routeId} route={r} />)}
                      <span className="font-mono text-[0.7rem] text-muted-foreground truncate ml-1">{trajectory}</span>
                    </div>
                    <div className="mt-2.5 hidden sm:block">{cycleButtons}</div>
                  </div>
                  <div className="flex items-center gap-2 sm:hidden">
                    {cycleButtons}
                    {collapseButton}
                  </div>
                </div>
  
                <div className="flex items-center gap-3 sm:gap-6">
                  <Gauge
                    fraction={secondsToNext === null ? 0 : secondsToNext / GAUGE_SCALE_SECONDS}
                    prefix={next ? `${next.routeId} ${next.direction === 'N' ? '↑ UPTOWN' : '↓ DOWNTOWN'}` : 'NO TRAIN'}
                    prefixColor={next ? `#${getRouteColor(next.routeId)}` : undefined}
                    value={`T−${formatClock(secondsToNext)}`}
                    caption="MIN : SEC"
                    label="Next train"
                    tone="ignition"
                    ariaLabel={next ? `Next train: ${next.routeId} in ${Math.floor(secondsToNext! / 60)} minutes` : 'No upcoming trains'}
                  />
                  <Gauge
                    fraction={headway === null ? 0 : headway / GAUGE_SCALE_SECONDS}
                    prefix={next ? `NEXT 2 ${next.direction === 'N' ? '↑' : '↓'}` : ''}
                    value={formatClock(headway)}
                    caption="MIN : SEC"
                    label="Headway"
                    tone="telemetry"
                    ariaLabel={headway === null ? 'Headway unavailable' : `Headway: ${Math.round(headway / 60)} minutes between the next two trains`}
                  />
                </div>
  
                <div className="flex-1 sm:flex-none flex flex-col gap-3 min-w-[7.5rem] sm:min-w-[10rem] sm:border-l sm:pl-6">
                  <div>
                    <div className="hud-label">Trains · next 15 min</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="font-mono text-2xl font-bold tabular-nums leading-none">{String(window15.length).padStart(2, '0')}</span>
                      <div className="flex flex-wrap gap-0.5 max-w-[6.5rem]">
                        {window15.slice(0, 8).map((a) => (
                          <MiniBullet key={a.tripId} routeId={a.routeId} route={routes.find((r) => r.routeId === a.routeId)} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="hud-label">Service status</div>
                    <div className={`mt-1.5 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] ${status.className}`}>
                      <span className="pulse-dot" />
                      {status.text}
                    </div>
                  </div>
                </div>
  
                <div className="hidden sm:block self-start">{collapseButton}</div>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
