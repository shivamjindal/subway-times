'use client';

import { useEffect, useState, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { type TrainArrival, type ServiceAlert } from '@/lib/subway-parser';
import { getRoutesForStation } from '@/lib/subway-data';
import { AlertCircle, Cloud, CloudRain, Orbit, Radar, Rocket, Satellite, Sun, Wind } from 'lucide-react';
import { StationSelector } from './station-selector';
import { StationCard } from './station-card';
import { OrbitalMapPanel, type OrbitalMapPanelHandle } from './orbital-map/orbital-map-panel';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface StationConfig {
  stationId: string;
  direction: 'all' | 'N' | 'S';
  selectedRoutes?: string[];
}

interface SubwayTimesData {
  arrivals: TrainArrival[];
  alerts: ServiceAlert[];
  lastUpdated: number;
}

interface HourlyWeather {
  time: string;
  temperature: number;
  condition: string;
  windSpeed: string;
  windDirection: string;
  probabilityOfPrecipitation: number;
  isDaytime: boolean;
}

interface WeatherData {
  current: {
    temperature: number;
    condition: string;
    windSpeed: string;
    windDirection: string;
    isDaytime: boolean;
  };
  today: {
    high: number | null;
    low: number | null;
    condition: string;
    windSpeed: string;
    windDirection: string;
  };
  hourly: HourlyWeather[];
  lastUpdated: number;
}

const STORAGE_KEY = 'selectedStations';
const WEATHER_CARD_VISIBLE_KEY = 'weatherCardVisible';

export interface SubwayTimesDisplayRef {
  refresh: () => void;
  isRefreshing: () => boolean;
}

export const SubwayTimesDisplay = forwardRef<SubwayTimesDisplayRef>((props, ref) => {
  const [stationConfigs, setStationConfigs] = useState<StationConfig[]>([]);
  const [data, setData] = useState<SubwayTimesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherCardVisible, setWeatherCardVisible] = useState(true);
  const [filteredStationIds, setFilteredStationIds] = useState<string[]>([]);
  const hasDataRef = useRef(false);
  const mapRef = useRef<OrbitalMapPanelHandle>(null);

  // Load stations from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        return;
      }

      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setStationConfigs(parsed);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      console.error('Error loading stations from localStorage:', err);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Load weather card visibility setting from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(WEATHER_CARD_VISIBLE_KEY);
      if (saved !== null) {
        setWeatherCardVisible(JSON.parse(saved));
      }
    } catch (err) {
      console.error('Error loading weather card visibility setting:', err);
    }
  }, []);

  // Listen for storage changes to sync weather card visibility across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === WEATHER_CARD_VISIBLE_KEY) {
        try {
          if (e.newValue !== null) {
            setWeatherCardVisible(JSON.parse(e.newValue));
          }
        } catch (err) {
          console.error('Error parsing weather card visibility setting:', err);
        }
      }
    };

    // Listen for custom event for same-tab updates
    const handleCustomChange = (e: CustomEvent<{ visible: boolean }>) => {
      setWeatherCardVisible(e.detail.visible);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('weatherCardVisibilityChange', handleCustomChange as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('weatherCardVisibilityChange', handleCustomChange as EventListener);
    };
  }, []);

  // Save stations to localStorage whenever they change
  useEffect(() => {
    try {
      if (stationConfigs.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stationConfigs));
      } else {
        // Clear localStorage when all stations are removed
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      console.error('Error saving stations to localStorage:', err);
    }
  }, [stationConfigs]);

  const selectedStationIds = useMemo(() => {
    return stationConfigs.map(c => c.stationId);
  }, [stationConfigs]);

  // Normalized station IDs string for dependency comparison (sorted to avoid re-fetch on reorder)
  const selectedStationIdsKey = useMemo(() => {
    return [...selectedStationIds].sort().join(',');
  }, [selectedStationIds]);

  const fetchData = useCallback(async (showRefreshing = false) => {
    const currentStationIds = selectedStationIds;

    if (currentStationIds.length === 0) {
      const emptyData = { arrivals: [], alerts: [], lastUpdated: Math.floor(Date.now() / 1000) };
      setData(emptyData);
      setError(null);
      setRefreshing(false);
      setLoading(false);
      hasDataRef.current = false;
      return;
    }

    try {
      const shouldShowRefreshing = showRefreshing || hasDataRef.current;
      if (shouldShowRefreshing) {
        setRefreshing(true);
        setLoading(false);
      } else {
        setLoading(true);
        setRefreshing(false);
      }
      setError(null);

      const stationsParam = currentStationIds.join(',');
      const response = await fetch(`/api/subway-times?stations=${stationsParam}`);
      if (!response.ok) {
        throw new Error('Failed to fetch subway times');
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.message || 'Failed to fetch subway times');
      }

      setData(result);
      hasDataRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedStationIds]);

  // Expose refresh function via ref
  useImperativeHandle(ref, () => ({
    refresh: () => fetchData(true),
    isRefreshing: () => refreshing,
  }), [fetchData, refreshing]);

  useEffect(() => {
    fetchData();
  }, [fetchData, selectedStationIdsKey, selectedStationIds.length]);

  useEffect(() => {
    if (selectedStationIds.length === 0) return;
    
    const interval = setInterval(() => {
      fetchData(true);
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchData, selectedStationIdsKey, selectedStationIds.length]);

  // Fetch weather data for NYC
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        setWeatherLoading(true);
        setWeatherError(null);

        const response = await fetch('/api/weather');
        
        if (!response.ok) {
          throw new Error('Failed to fetch weather');
        }

        const result = await response.json();
        
        if (result.error) {
          throw new Error(result.message || 'Failed to fetch weather');
        }

        setWeather(result);
      } catch (err) {
        setWeatherError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setWeatherLoading(false);
      }
    };

    fetchWeather();

    // Auto-refresh weather every 15 minutes
    const weatherInterval = setInterval(() => {
      fetchWeather();
    }, 900000);

    return () => clearInterval(weatherInterval);
  }, []);

  const getWeatherIcon = (condition: string) => {
    const lowerCondition = condition.toLowerCase();
    if (lowerCondition.includes('rain') || lowerCondition.includes('shower')) {
      return <CloudRain className="h-6 w-6" />;
    } else if (lowerCondition.includes('cloud')) {
      return <Cloud className="h-6 w-6" />;
    } else {
      return <Sun className="h-6 w-6" />;
    }
  };

  const formatHourlyTime = (timeString: string) => {
    const date = new Date(timeString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatTemperatureValue = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return '--°F';
    }
    return `${value}°F`;
  };

  const handleStationsChange = (stationIds: string[]) => {
    const newConfigs: StationConfig[] = stationIds.map(id => {
      const existing = stationConfigs.find(c => c.stationId === id);
      return existing || { stationId: id, direction: 'all', selectedRoutes: [] };
    });
    setStationConfigs(newConfigs);

    setFilteredStationIds(prev => prev.filter(id => stationIds.includes(id)));
  };

  const handleStationFilterToggle = (stationId: string) => {
    setFilteredStationIds(prev => {
      const isSelected = prev.includes(stationId);
      
      // Calculate new filtered stations after toggle
      const newFiltered = isSelected
        ? prev.filter(id => id !== stationId)
        : [...prev, stationId];
      
      // If all stations are selected, reset to default (empty array = show all)
      const allStationIds = stationConfigs.map(c => c.stationId);
      const shouldReset = newFiltered.length === allStationIds.length && 
                          allStationIds.every(id => newFiltered.includes(id));
      
      return shouldReset ? [] : newFiltered;
    });
  };

  const handleDirectionChange = (stationId: string, direction: 'all' | 'N' | 'S') => {
    setStationConfigs(prev => 
      prev.map(c => c.stationId === stationId ? { ...c, direction } : c)
    );
  };

  const handleRouteToggle = (stationId: string, routeId: string) => {
    setStationConfigs(prev =>
      prev.map(c => {
        if (c.stationId !== stationId) return c;
        
        const currentRoutes = c.selectedRoutes || [];
        const isSelected = currentRoutes.includes(routeId);
        
        // Calculate new selected routes after toggle
        const newSelectedRoutes = isSelected
          ? currentRoutes.filter(r => r !== routeId)
          : [...currentRoutes, routeId];
        
        // Get all available routes for this station
        const allRoutes = getRoutesForStation(stationId);
        const allRouteIds = allRoutes.map(r => r.routeId);
        
        // If all routes are selected, reset to default (empty array = show all)
        const shouldReset = newSelectedRoutes.length === allRouteIds.length && 
                           allRouteIds.every(id => newSelectedRoutes.includes(id));
        
        return {
          ...c,
          selectedRoutes: shouldReset ? [] : newSelectedRoutes,
        };
      })
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setStationConfigs((items) => {
        const oldIndex = items.findIndex(item => item.stationId === active.id);
        const newIndex = items.findIndex(item => item.stationId === over.id);
        
        // Validate indices to prevent invalid arrayMove calls
        if (oldIndex < 0 || newIndex < 0) {
          // If either index is invalid, return items unchanged
          return items;
        }
        
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Group arrivals by station
  const arrivalsByStation = useMemo(() => {
    if (!data) return {};
    
    const grouped: Record<string, TrainArrival[]> = {};
    data.arrivals.forEach(arrival => {
      if (!grouped[arrival.stationId]) {
        grouped[arrival.stationId] = [];
      }
      grouped[arrival.stationId].push(arrival);
    });
    
    return grouped;
  }, [data]);

  const alertsByStation = useMemo(() => {
    if (!data) return {};

    const grouped: Record<string, ServiceAlert[]> = {};

    stationConfigs.forEach(config => {
      const stationId = config.stationId;
      const routesToMatch = config.selectedRoutes && config.selectedRoutes.length > 0
        ? config.selectedRoutes
        : getRoutesForStation(stationId).map((route) => route.routeId);
      const routesToMatchSet = new Set(routesToMatch);

      grouped[stationId] = data.alerts.filter((alert) => {
        if (alert.affectedRoutes.length === 0) {
          return true;
        }

        return alert.affectedRoutes.some((routeId) => routesToMatchSet.has(routeId));
      });
    });

    return grouped;
  }, [data, stationConfigs]);

  const visibleStationConfigs = useMemo(() => {
    if (filteredStationIds.length === 0) {
      return stationConfigs;
    }

    const filteredSet = new Set(filteredStationIds);
    return stationConfigs.filter((config) => filteredSet.has(config.stationId));
  }, [filteredStationIds, stationConfigs]);

  const visibleStationIds = useMemo(
    () => visibleStationConfigs.map((config) => config.stationId),
    [visibleStationConfigs]
  );

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <OrbitalMapPanel
        ref={mapRef}
        savedStationIds={selectedStationIds}
        arrivals={data?.arrivals ?? []}
        onTrackStation={(stationId) => handleStationsChange([...selectedStationIds, stationId])}
      />

      {/* Station Selector */}
      <div className="mb-6">
        <StationSelector
          selectedStations={selectedStationIds}
          onStationsChange={handleStationsChange}
          filteredStations={filteredStationIds}
          onStationFilterToggle={handleStationFilterToggle}
        />
      </div>

      {/* Weather Section */}
      {weatherCardVisible && (
        <>
          {weatherLoading ? (
            <div className="mb-6">
              <AcquiringSignal compact label="Acquiring atmospheric data" detail="Contacting National Weather Service…" />
            </div>
          ) : weatherError ? (
            <div className="mb-6">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle className="font-mono text-xs uppercase tracking-[0.18em]">Weather uplink lost</AlertTitle>
                <AlertDescription>{weatherError}</AlertDescription>
              </Alert>
            </div>
          ) : weather ? (
            <section className="hud-panel ignite mb-6">
              <div className="flex items-center justify-between gap-3 border-b px-4 sm:px-6 py-2">
                <div className="hud-label flex items-center gap-2">
                  <Satellite className="h-3 w-3 text-telemetry" />
                  Atmospheric conditions · NYC
                </div>
                <div className="hud-label">Weather</div>
              </div>
              <div className="px-4 sm:px-6 py-5 space-y-5">
                {/* Current Weather */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="hud-label mb-2">Current</div>
                    <div className="flex items-center gap-3 font-mono text-4xl font-bold tabular-nums">
                      <span className="text-telemetry">{getWeatherIcon(weather.current.condition)}</span>
                      {weather.current.temperature}°F
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {weather.current.condition}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="hud-label mb-2">High / Low</div>
                    <div className="font-mono text-base font-semibold tabular-nums">
                      <span className="text-ignition">H {formatTemperatureValue(weather.today.high)}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-telemetry">L {formatTemperatureValue(weather.today.low)}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1 font-mono text-xs text-muted-foreground mt-2">
                      <Wind className="h-3.5 w-3.5" />
                      {weather.current.windSpeed}
                      {weather.current.windDirection !== 'N/A' && ` ${weather.current.windDirection}`}
                    </div>
                  </div>
                </div>

                {/* Hourly Forecast */}
                {weather.hourly && weather.hourly.length > 0 && (
                  <div className="space-y-3">
                    <div className="hud-divider" />
                    <div className="hud-label">Hourly forecast · Next 12 hrs</div>
                    <div className="overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6">
                      <div className="flex border divide-x min-w-max">
                        {weather.hourly.slice(0, 12).map((hour, index) => (
                          <div
                            key={index}
                            className="flex flex-col items-center gap-2 px-4 py-3 min-w-[92px] bg-background/30 hover:bg-telemetry/10 transition-colors"
                          >
                            <div className="font-mono text-[0.7rem] text-muted-foreground uppercase">
                              {formatHourlyTime(hour.time)}
                            </div>
                            <div className="text-foreground/80">
                              {getWeatherIcon(hour.condition)}
                            </div>
                            <div className="font-mono text-lg font-bold tabular-nums">
                              {hour.temperature}°
                            </div>
                            {hour.probabilityOfPrecipitation > 0 && (
                              <div className="font-mono text-[0.7rem] font-medium text-telemetry">
                                {hour.probabilityOfPrecipitation}% precip
                              </div>
                            )}
                            <div className="font-mono text-[0.65rem] text-muted-foreground text-center flex items-center gap-1">
                              <Wind className="h-3 w-3" />
                              {hour.windSpeed}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </>
      )}

      {/* Station Cards */}
      {loading ? (
        <div className="space-y-4">
          <AcquiringSignal label="Acquiring signal" detail="Establishing uplink with MTA real-time feeds…" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : error ? (
        <div role="alert" className="hud-panel hud-panel-accent ignite px-6 py-10 text-center">
          <div className="mx-auto h-14 w-14 border border-destructive/50 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <div className="hud-label !text-destructive mt-5">Telemetry error · Signal lost</div>
          <h2 className="hud-title text-3xl font-bold mt-2">Unable to load arrivals</h2>
          <p className="font-mono text-sm text-muted-foreground mt-3 break-words">{error}</p>
          <p className="text-sm text-muted-foreground mt-4">Use the resync button in the top bar to try again.</p>
        </div>
      ) : selectedStationIds.length === 0 ? (
        <AwaitingMission />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleStationIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-5">
              {visibleStationConfigs.map((config) => (
                <SortableStationCard
                  key={config.stationId}
                  config={config}
                  arrivals={arrivalsByStation[config.stationId] || []}
                  alerts={alertsByStation[config.stationId] || []}
                  onDirectionChange={(dir) => handleDirectionChange(config.stationId, dir)}
                  onRouteToggle={(routeId) => handleRouteToggle(config.stationId, routeId)}
                  onEnterSpaceport={() => mapRef.current?.enterSpaceport(config.stationId)}
                  showDragHandle={stationConfigs.length > 1}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Last Updated */}
      {data && selectedStationIds.length > 0 && (
        <div className="mt-8 flex items-center justify-center gap-3 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          <span className={refreshing ? 'text-telemetry' : 'text-nominal'}>
            <span className="pulse-dot" />
          </span>
          <span>
            Last telemetry sync {new Date(data.lastUpdated * 1000).toLocaleTimeString()}
          </span>
          <span className="text-border">|</span>
          <span>{refreshing ? <span className="text-telemetry">Syncing…</span> : 'Auto-sync 30s'}</span>
        </div>
      )}
    </div>
  );
});

SubwayTimesDisplay.displayName = 'SubwayTimesDisplay';

interface SortableStationCardProps {
  config: StationConfig;
  arrivals: TrainArrival[];
  alerts: ServiceAlert[];
  onDirectionChange: (direction: 'all' | 'N' | 'S') => void;
  onRouteToggle: (routeId: string) => void;
  onEnterSpaceport: () => void;
  showDragHandle: boolean;
}

function SortableStationCard({ config, arrivals, alerts, onDirectionChange, onRouteToggle, onEnterSpaceport, showDragHandle }: SortableStationCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: config.stationId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className="w-full"
    >
      <div 
        className={showDragHandle ? "cursor-grab active:cursor-grabbing" : ""}
        {...(showDragHandle ? { ...attributes, ...listeners } : {})}
      >
        <StationCard
          stationId={config.stationId}
          arrivals={arrivals}
          alerts={alerts}
          direction={config.direction}
          onDirectionChange={onDirectionChange}
          selectedRoutes={config.selectedRoutes}
          onRouteToggle={onRouteToggle}
          onEnterSpaceport={onEnterSpaceport}
        />
      </div>
    </div>
  );
}

function AcquiringSignal({ label, detail, compact = false }: { label: string; detail: string; compact?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`hud-panel scanline flex items-center gap-5 px-6 ${compact ? 'py-5' : 'py-8'}`}>
      <div className={`relative shrink-0 rounded-full border border-telemetry/40 ${compact ? 'h-12 w-12' : 'h-16 w-16'}`}>
        <div className="absolute inset-2 rounded-full border border-telemetry/20" />
        <div
          className="absolute inset-0 rounded-full animate-sweep"
          style={{ background: 'conic-gradient(from 0deg, transparent 0deg, color-mix(in oklab, var(--telemetry) 55%, transparent) 60deg, transparent 61deg)' }}
        />
        <Radar className="absolute inset-0 m-auto h-5 w-5 text-telemetry" />
      </div>
      <div className="min-w-0">
        <div className={`hud-title font-bold text-telemetry ${compact ? 'text-xl' : 'text-2xl sm:text-3xl'}`}>
          {label}<span className="blink">…</span>
        </div>
        <div className="font-mono text-xs text-muted-foreground mt-1.5">{detail}</div>
      </div>
    </div>
  );
}

function AwaitingMission() {
  return (
    <div className="hud-panel ignite px-6 py-14 text-center overflow-hidden">
      <div className="relative mx-auto h-36 w-36">
        <div className="absolute inset-0 rounded-full border border-dashed border-foreground/20" />
        <div className="absolute inset-6 rounded-full border border-telemetry/30" />
        <div className="absolute inset-0 animate-orbit">
          <span className="absolute -top-1 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-ignition shadow-[0_0_12px_var(--ignition)]" />
        </div>
        <div className="absolute inset-6 animate-orbit-slow">
          <span className="absolute top-1/2 -right-1 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-telemetry shadow-[0_0_10px_var(--telemetry)]" />
        </div>
        <Orbit className="absolute inset-0 m-auto h-8 w-8 text-foreground/70" />
      </div>
      <div className="hud-label mt-8">Standby · No stations tracked</div>
      <h2 className="hud-title text-3xl sm:text-4xl font-bold mt-2">Awaiting mission parameters</h2>
      <p className="text-sm text-muted-foreground mt-3 max-w-md mx-auto">
        Search for a station above to start tracking live train arrivals. Add as many as you like and drag to reorder.
      </p>
      <div className="mt-6 inline-flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ignition">
        <Rocket className="h-3.5 w-3.5" /> Ready for launch
      </div>
    </div>
  );
}
