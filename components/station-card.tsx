'use client';

import { useState, useMemo, useEffect } from 'react';
import { summarizeAlerts } from '@/lib/alert-summary';
import { AlertTriangle, ChevronDown, ChevronUp, ChevronsUpDown, DoorOpen, Rocket, SatelliteDish } from 'lucide-react';
import { getSpaceport } from '@/lib/spaceports';
import { formatTime, type TrainArrival, type ServiceAlert } from '@/lib/subway-parser';
import { getStation, getRoutesForStation, getRouteColor, getNorthboundRoutesForStation, getSouthboundRoutesForStation, getDirectionLabel } from '@/lib/subway-data';

interface StationCardProps {
  stationId: string;
  arrivals: TrainArrival[];
  alerts: ServiceAlert[];
  direction: 'all' | 'N' | 'S';
  onDirectionChange: (direction: 'all' | 'N' | 'S') => void;
  selectedRoutes?: string[];
  onRouteToggle: (routeId: string) => void;
  onEnterSpaceport: () => void;
}

const INITIAL_TRAINS_TO_SHOW = 5;
const ARRIVING_THRESHOLD_SECONDS = 60;

const stopDragPropagation = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
};

function useNowSeconds() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);
  return now;
}

function formatCountdown(secondsUntilArrival: number) {
  const minutes = Math.floor(secondsUntilArrival / 60);
  const seconds = secondsUntilArrival % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function StationCard({ stationId, arrivals, alerts, direction, onDirectionChange, selectedRoutes, onRouteToggle, onEnterSpaceport }: StationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const now = useNowSeconds();

  const station = getStation(stationId);
  const routes = getRoutesForStation(stationId);
  const northboundRoutes = getNorthboundRoutesForStation(stationId);
  const southboundRoutes = getSouthboundRoutesForStation(stationId);
  const hasCloseup = getSpaceport(stationId).pads.length > 0;

  const hasNorthbound = northboundRoutes.length > 0;
  const hasSouthbound = southboundRoutes.length > 0;

  // Get direction labels based on actual train destinations
  const northboundLabel = getDirectionLabel('N', arrivals);
  const southboundLabel = getDirectionLabel('S', arrivals);

  // Filter arrivals by direction and selected routes
  const filteredArrivals = useMemo(() => {
    let filtered = arrivals;

    // Filter by direction
    if (direction !== 'all') {
      filtered = filtered.filter(a => a.direction === direction);
    }

    // Filter by selected routes (if any are selected)
    if (selectedRoutes && selectedRoutes.length > 0) {
      filtered = filtered.filter(a => selectedRoutes.includes(a.routeId));
    }

    return filtered;
  }, [arrivals, direction, selectedRoutes]);

  const displayedArrivals = isExpanded
    ? filteredArrivals
    : filteredArrivals.slice(0, INITIAL_TRAINS_TO_SHOW);

  const hasMore = filteredArrivals.length > INITIAL_TRAINS_TO_SHOW;
  const hasAlerts = alerts.length > 0;

  if (!station) {
    return null;
  }

  const directionOptions: Array<{ value: 'all' | 'N' | 'S'; label: string; show: boolean }> = [
    { value: 'all', label: 'All', show: true },
    { value: 'N', label: `↑ ${northboundLabel}`, show: hasNorthbound },
    { value: 'S', label: `↓ ${southboundLabel}`, show: hasSouthbound },
  ];

  return (
    <section className={`hud-panel scanline ignite w-full ${hasAlerts ? 'hud-panel-accent' : ''}`}>
      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 border-b px-4 sm:px-6 py-2">
        <div className="hud-label flex items-center gap-2">
          <span className="text-ignition">■</span>
          Spaceport · Station {station.stopId}
        </div>
        <div
          className={`flex items-center gap-2 font-mono text-[0.65rem] tracking-[0.18em] uppercase ${hasAlerts ? 'text-caution' : 'text-nominal'}`}
          title={hasAlerts ? 'Service alerts active' : 'No active service alerts'}
        >
          <span className="pulse-dot" />
          <span className="hidden sm:inline text-muted-foreground">Mission status:</span>
          {hasAlerts ? `Advisory · ${alerts.length} alert${alerts.length > 1 ? 's' : ''}` : 'Nominal'}
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-5 pb-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="hud-title text-3xl sm:text-4xl font-bold break-words">{station.name}</h2>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="hud-label mr-1">Lines</span>
              {routes.map((route) => {
                const color = getRouteColor(route.routeId);
                const hasSelectedRoutes = selectedRoutes && selectedRoutes.length > 0;
                const isSelected = selectedRoutes?.includes(route.routeId) ?? false;
                // In default state (no routes selected), show all at 100% opacity
                // When routes are selected, show selected at 100%, unselected at reduced opacity
                const opacity = hasSelectedRoutes ? (isSelected ? 1 : 0.3) : 1;
                return (
                  <button
                    key={route.routeId}
                    type="button"
                    onClick={() => onRouteToggle(route.routeId)}
                    {...stopDragPropagation}
                    className="cursor-pointer transition-all hover:scale-110 active:scale-95"
                    aria-label={isSelected ? `Deselect ${route.shortName} route` : `Select ${route.shortName} route`}
                    aria-pressed={isSelected}
                  >
                    <span
                      className="route-bullet h-7 w-7 text-sm transition-opacity"
                      style={{
                        backgroundColor: `#${color}`,
                        color: route.textColor === 'FFFFFF' ? 'white' : 'black',
                        opacity,
                        ['--route-color' as string]: `#${color}`,
                      }}
                    >
                      {route.shortName}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            {...stopDragPropagation}
            className="h-8 w-8 border flex items-center justify-center hover:border-telemetry hover:text-telemetry transition-colors flex-shrink-0"
            aria-label={isCollapsed ? 'Expand station' : 'Collapse station'}
          >
            <ChevronsUpDown className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Direction Filter */}
          {(hasNorthbound || hasSouthbound) && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="hud-label">Trajectory</span>
              <div className="inline-flex flex-wrap border divide-x">
                {directionOptions.filter(o => o.show).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onDirectionChange(option.value)}
                    {...stopDragPropagation}
                    aria-pressed={direction === option.value}
                    className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                      direction === option.value
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {hasCloseup ? (
            <button
              type="button"
              onClick={onEnterSpaceport}
              {...stopDragPropagation}
              // The card's drag listeners treat Enter/Space as "start drag" and swallow the click.
              onKeyDown={(e) => e.stopPropagation()}
              aria-label={`Enter spaceport: ${station.name}`}
              className="ml-auto flex items-center gap-1.5 border border-telemetry/60 px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-telemetry transition-colors hover:bg-telemetry/10"
            >
              <DoorOpen className="h-3.5 w-3.5" /> Enter spaceport
            </button>
          ) : (
            <span className="ml-auto font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
              Close-up unavailable
            </span>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="px-4 sm:px-6 pb-6 space-y-4">
          <div className="hud-divider" />

          {/* Service Alerts */}
          {hasAlerts && (
            <div className="border border-caution/40 bg-caution/10 border-l-4 border-l-caution">
              <button
                type="button"
                onClick={() => setAlertsOpen((open) => !open)}
                aria-expanded={alertsOpen}
                aria-controls={`alerts-${stationId}`}
                className="flex w-full items-center gap-3 px-3 sm:px-4 py-2 text-left"
              >
                <AlertTriangle className="h-4 w-4 text-caution shrink-0" />
                <span className="hud-label !text-caution shrink-0">Advisory</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{summarizeAlerts(alerts)}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${alertsOpen ? 'rotate-180' : ''}`} />
              </button>
              {alertsOpen && (
                <div id={`alerts-${stationId}`} className="space-y-3 border-t border-caution/30 px-3 sm:px-4 py-3">
                  {alerts.map((alert) => (
                    <div key={alert.id} role="alert" className="min-w-0">
                      <div className="hud-label !text-caution mb-1.5">Mission advisory · Service alert</div>
                      <div className="text-sm sm:text-base font-medium break-words">{alert.headerText}</div>
                      {alert.descriptionText && (
                        <div className="mt-1 text-sm text-muted-foreground break-words whitespace-pre-line">{alert.descriptionText}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Train Arrivals */}
          {filteredArrivals.length === 0 ? (
            <div className="border border-dashed py-10 text-center">
              <SatelliteDish className="h-6 w-6 mx-auto text-muted-foreground" />
              <div className="hud-title text-xl font-semibold mt-3">No telemetry</div>
              <div className="text-sm text-muted-foreground mt-1">No boosters (trains) inbound at this time</div>
            </div>
          ) : (
            <div>
              <div className="hidden sm:grid grid-cols-[1fr_auto] gap-4 px-4 pb-2">
                <span className="hud-label">Booster · Destination</span>
                <span className="hud-label text-right">T-minus · ETA</span>
              </div>
              <ol className="space-y-2">
                {displayedArrivals.map((arrival, index) => {
                  const routeColor = getRouteColor(arrival.routeId);
                  const route = routes.find(r => r.routeId === arrival.routeId);
                  const badgeColor = route?.textColor === 'FFFFFF' ? 'white' : 'black';
                  const secondsLeft = Math.max(0, arrival.arrivalTime - now);
                  const isArriving = secondsLeft < ARRIVING_THRESHOLD_SECONDS;
                  const isNext = index === 0;

                  return (
                    <li
                      key={`${arrival.tripId}-${index}`}
                      className={`relative flex items-center justify-between gap-4 border px-3 sm:px-4 py-3 transition-colors hover:bg-muted/40 ${
                        isNext ? 'border-ignition/50 bg-ignition/[0.06]' : 'bg-background/30'
                      }`}
                    >
                      {isNext && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-ignition" aria-hidden="true" />}
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <span
                          className="route-bullet h-10 w-10 text-lg shrink-0"
                          style={{
                            backgroundColor: `#${routeColor}`,
                            color: badgeColor,
                            ['--route-color' as string]: `#${routeColor}`,
                          }}
                        >
                          {arrival.routeId}
                        </span>
                        <div className="min-w-0">
                          {isNext && (
                            <div className="hud-label !text-ignition mb-1 flex items-center gap-1.5">
                              <Rocket className="h-3 w-3" /> Next landing
                            </div>
                          )}
                          <div className="font-semibold truncate">
                            <span className="text-muted-foreground font-normal">{arrival.direction === 'N' ? '↑' : '↓'} </span>
                            {arrival.destination}
                          </div>
                          {arrival.trainId && (
                            <div className="font-mono text-[0.7rem] text-muted-foreground mt-0.5 truncate">
                              VEHICLE ID {arrival.trainId}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {isArriving ? (
                          <div className="font-mono text-xl sm:text-2xl font-bold text-ignition uppercase tracking-wider flex items-center justify-end gap-2">
                            <span className="pulse-dot" />
                            Landing
                          </div>
                        ) : (
                          <div
                            className="font-mono text-xl sm:text-2xl font-bold tabular-nums"
                            aria-label={`Arrives in ${Math.floor(secondsLeft / 60)} minutes`}
                          >
                            <span className="text-muted-foreground font-medium text-base mr-1">T−</span>
                            {formatCountdown(secondsLeft)}
                          </div>
                        )}
                        <div className="font-mono text-xs text-muted-foreground mt-0.5">
                          ETA {formatTime(arrival.arrivalTime)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {/* Expand/Collapse Button */}
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  {...stopDragPropagation}
                  className="mt-3 w-full py-2 border border-dashed font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors flex items-center justify-center gap-2"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      Collapse manifest
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      Show {filteredArrivals.length - INITIAL_TRAINS_TO_SHOW} more boosters
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
