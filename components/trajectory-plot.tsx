'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TrainArrival } from '@/lib/subway-parser';
import { getRouteColor, getRoutesForStation } from '@/lib/subway-data';

interface TrajectoryPlotProps {
  stationId: string;
  arrivals: TrainArrival[];
  direction: 'all' | 'N' | 'S';
  now: number;
}

const TICK_SECONDS = 5 * 60;
// Window is anchored to the last 5-minute boundary and spans 35 minutes, so at least
// 30 minutes ahead of "now" are always visible while the grid itself stays still.
const SPAN_SECONDS = 35 * 60;
const ROW_HEIGHT = 22;
const ARRIVING_THRESHOLD_SECONDS = 60;

const ROW_LABELS = { N: '↑ N', S: '↓ S' } as const;

const pct = (value: number) => `${value.toFixed(3)}%`;

export function TrajectoryPlot({ stationId, arrivals, direction, now }: TrajectoryPlotProps) {
  const [isOpen, setIsOpen] = useState(true);

  const windowStart = Math.floor(now / TICK_SECONDS) * TICK_SECONDS;
  const windowEnd = windowStart + SPAN_SECONDS;
  const toX = (t: number) => ((t - windowStart) / SPAN_SECONDS) * 100;

  const rows = direction === 'all' ? (['N', 'S'] as const) : [direction];
  const height = rows.length * ROW_HEIGHT;

  const routes = getRoutesForStation(stationId);

  const points = useMemo(
    () =>
      arrivals
        .filter((a) => a.arrivalTime >= windowStart && a.arrivalTime <= windowEnd)
        .map((a) => ({
          key: `${a.tripId}-${a.direction}`,
          routeId: a.routeId,
          direction: a.direction,
          time: a.arrivalTime,
          x: ((a.arrivalTime - windowStart) / SPAN_SECONDS) * 100,
        })),
    [arrivals, windowStart, windowEnd]
  );

  const ticks = Array.from({ length: SPAN_SECONDS / TICK_SECONDS + 1 }, (_, i) => windowStart + i * TICK_SECONDS);
  const nowX = toX(now);

  return (
    <div className="border bg-background/30">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Hide trajectory plot' : 'Show trajectory plot'}
        className="w-full flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-muted/40 transition-colors"
      >
        <span className="hud-label flex items-center gap-2">
          <span className="text-telemetry">◆</span>
          Trajectory plot · T+30 min
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="grid grid-cols-[2rem_1fr] border-t px-3 pt-2 pb-1" aria-hidden="true">
          <div>
            {rows.map((row) => (
              <div key={row} className="hud-label flex items-center" style={{ height: ROW_HEIGHT }}>
                {ROW_LABELS[row]}
              </div>
            ))}
          </div>

          <div className="min-w-0">
            <svg width="100%" height={height} className="block overflow-visible">
              {ticks.map((t, i) => (
                <line key={t} x1={pct(toX(t))} x2={pct(toX(t))} y1={0} y2={height} className="stroke-border" strokeDasharray={i === 0 ? undefined : '2 3'} />
              ))}
              {rows.map((row, i) => {
                const y = i * ROW_HEIGHT + ROW_HEIGHT / 2;
                const next = points.find((p) => p.direction === row && p.time >= now);
                return (
                  <g key={row}>
                    <line x1="0" x2="100%" y1={y} y2={y} className="stroke-border" />
                    {next && (
                      <line x1={pct(nowX)} x2={pct(next.x)} y1={y} y2={y} className="stroke-telemetry" strokeWidth={2} />
                    )}
                  </g>
                );
              })}

              <line x1={pct(nowX)} x2={pct(nowX)} y1={-4} y2={height} className="stroke-ignition" strokeWidth={1.5} />

              {points.map((p) => {
                const y = rows.indexOf(p.direction) * ROW_HEIGHT + ROW_HEIGHT / 2;
                if (y < 0) return null;
                const color = `#${getRouteColor(p.routeId)}`;
                const textColor = routes.find((r) => r.routeId === p.routeId)?.textColor === '000000' ? 'black' : 'white';
                const isPast = p.time < now;
                const isArriving = !isPast && p.time - now < ARRIVING_THRESHOLD_SECONDS;
                return (
                  <svg key={p.key} x={pct(p.x)} y={y} width="1" height="1" overflow="visible" opacity={isPast ? 0.3 : 1}>
                    {isArriving && (
                      <circle r={7} fill={color} className="animate-ping origin-center [transform-box:fill-box] motion-reduce:hidden" />
                    )}
                    <circle r={7} fill={color} stroke="var(--background)" strokeWidth={1.5} />
                    <text textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={700} fill={textColor} className="font-sans">
                      {p.routeId.slice(0, 2)}
                    </text>
                  </svg>
                );
              })}
            </svg>

            <div className="relative h-4 mt-1 font-mono text-[0.55rem] tracking-wider text-muted-foreground tabular-nums">
              {ticks.map((t, i) => {
                if (t - now < 150) return null;
                const isLast = i === ticks.length - 1;
                return (
                  <span key={t} className={`absolute ${isLast ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: pct(toX(t)) }}>
                    T+{Math.round((t - now) / 60)}
                  </span>
                );
              })}
              <span className="absolute -translate-x-1/2 text-ignition font-semibold" style={{ left: pct(nowX) }}>
                NOW
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
