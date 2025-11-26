'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { type TrainArrival, type ServiceAlert } from '@/lib/subway-parser';
import { AlertCircle, Cloud, CloudRain, Sun, Wind } from 'lucide-react';
import { StationSelector } from './station-selector';
import { StationCard } from './station-card';
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

export function SubwayTimesDisplay() {
  const [stationConfigs, setStationConfigs] = useState<StationConfig[]>([]);
  const [data, setData] = useState<SubwayTimesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const hasDataRef = useRef(false);
  const dataRef = useRef<SubwayTimesData | null>(null);

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

  // Use a ref to always access the latest selectedStationIds without causing re-renders
  const selectedStationIdsRef = useRef(selectedStationIds);
  useEffect(() => {
    selectedStationIdsRef.current = selectedStationIds;
  }, [selectedStationIds]);

  const fetchData = useCallback(async (showRefreshing = false) => {
    // Use ref to get current station IDs without making fetchData depend on order changes
    const currentStationIds = selectedStationIdsRef.current;
    
    if (currentStationIds.length === 0) {
      const emptyData = { arrivals: [], alerts: [], lastUpdated: Math.floor(Date.now() / 1000) };
      setData(emptyData);
      dataRef.current = emptyData;
      setError(null);
      setRefreshing(false);
      setLoading(false);
      hasDataRef.current = false;
      return;
    }

    try {
      // If we already have data, use refreshing state instead of loading to avoid blanking the page
      // Use ref to check current data state to avoid stale closures
      const hasExistingData = dataRef.current !== null && dataRef.current.arrivals.length > 0;
      const shouldShowRefreshing = showRefreshing || hasExistingData || hasDataRef.current;
      if (shouldShowRefreshing) {
        setRefreshing(true);
        // Ensure loading is false when refreshing to prevent skeleton from showing
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
      dataRef.current = result;
      hasDataRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      hasDataRef.current = false;
      // Don't clear dataRef on error - keep existing data visible
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedStationIdsKey]); // Only recreate when actual station IDs change, not order

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStationIdsKey, selectedStationIds.length]);
  // Note: fetchData is intentionally excluded from deps to avoid re-fetching on reorder
  // selectedStationIdsKey already captures when actual station IDs change

  useEffect(() => {
    if (selectedStationIds.length === 0) return;
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchData(true);
    }, 30000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStationIdsKey, selectedStationIds.length]);
  // Note: fetchData is intentionally excluded from deps to avoid re-fetching on reorder
  // selectedStationIdsKey already captures when actual station IDs change

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
      return <CloudRain className="h-5 w-5" />;
    } else if (lowerCondition.includes('cloud')) {
      return <Cloud className="h-5 w-5" />;
    } else {
      return <Sun className="h-5 w-5" />;
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
    // Add new stations with default direction 'all'
    const newConfigs: StationConfig[] = stationIds.map(id => {
      const existing = stationConfigs.find(c => c.stationId === id);
      return existing || { stationId: id, direction: 'all' };
    });
    setStationConfigs(newConfigs);
  };

  const handleDirectionChange = (stationId: string, direction: 'all' | 'N' | 'S') => {
    setStationConfigs(prev => 
      prev.map(c => c.stationId === stationId ? { ...c, direction } : c)
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

  // Group alerts by station (simplified - show all alerts for all stations)
  const alertsByStation = useMemo(() => {
    if (!data) return {};
    
    const grouped: Record<string, ServiceAlert[]> = {};
    selectedStationIds.forEach(stationId => {
      grouped[stationId] = data.alerts;
    });
    
    return grouped;
  }, [data, selectedStationIds]);

  if (loading) {
    return (
      <div className="container mx-auto p-4 max-w-6xl">
        <div className="mb-6">
          <Skeleton className="h-12 w-full mb-4" />
          <Skeleton className="h-20 w-full" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 max-w-6xl">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      {/* Station Selector */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">Subway Times</h1>
        <StationSelector
          selectedStations={selectedStationIds}
          onStationsChange={handleStationsChange}
        />
      </div>

      {/* Weather Section */}
      {weatherLoading ? (
        <div className="mb-6">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : weatherError ? (
        <div className="mb-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Weather: {weatherError}</AlertDescription>
          </Alert>
        </div>
      ) : weather ? (
        <Card className="mb-6">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">NYC Weather</h2>
            </div>
            {/* Current Weather */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-2xl font-bold">
                  {getWeatherIcon(weather.current.condition)}
                  {weather.current.temperature}°F
                </div>
                <div className="text-sm text-muted-foreground">
                  {weather.current.condition}
                </div>
              </div>
              <div className="space-y-1 text-right">
                <div className="text-base font-semibold">
                  H: {formatTemperatureValue(weather.today.high)} / L: {formatTemperatureValue(weather.today.low)}
                </div>
                <div className="flex items-center justify-end gap-1 text-sm text-muted-foreground">
                  <Wind className="h-4 w-4" />
                  {weather.current.windSpeed}
                  {weather.current.windDirection !== 'N/A' && ` ${weather.current.windDirection}`}
                </div>
              </div>
            </div>

            {/* Hourly Forecast */}
            {weather.hourly && weather.hourly.length > 0 && (
              <div className="space-y-3">
                <div className="text-sm font-semibold">Hourly Forecast</div>
                <div className="overflow-x-auto -mx-6 px-6">
                  <div className="flex gap-3 pb-2 min-w-max">
                    {weather.hourly.slice(0, 12).map((hour, index) => (
                      <div
                        key={index}
                        className="flex flex-col items-center gap-2 p-4 min-w-[100px] border rounded-xl bg-gradient-to-br from-muted/40 to-muted/20 hover:from-muted/50 hover:to-muted/30 transition-all shadow-sm hover:shadow-md"
                      >
                        <div className="text-sm font-semibold text-foreground">
                          {formatHourlyTime(hour.time)}
                        </div>
                        <div className="text-2xl text-muted-foreground">
                          {getWeatherIcon(hour.condition)}
                        </div>
                        <div className="text-lg font-bold text-foreground">
                          {hour.temperature}°F
                        </div>
                        {hour.probabilityOfPrecipitation > 0 && (
                          <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            {hour.probabilityOfPrecipitation}%
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground text-center flex items-center gap-1">
                          <Wind className="h-3 w-3" />
                          {hour.windSpeed}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Station Cards */}
      {selectedStationIds.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">No stations selected</p>
          <p className="text-sm">Search and select stations above to view train arrivals</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={stationConfigs.map(c => c.stationId)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-4">
              {stationConfigs.map((config) => {
                const arrivals = arrivalsByStation[config.stationId] || [];
                const alerts = alertsByStation[config.stationId] || [];
                
                return (
                  <SortableStationCard
                    key={config.stationId}
                    config={config}
                    arrivals={arrivals}
                    alerts={alerts}
                    onDirectionChange={(dir) => handleDirectionChange(config.stationId, dir)}
                    showDragHandle={stationConfigs.length > 1}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Last Updated */}
      {data && selectedStationIds.length > 0 && (
        <div className="text-xs text-muted-foreground text-center mt-6">
          Last updated: {new Date(data.lastUpdated * 1000).toLocaleTimeString()}
          {refreshing && <span className="ml-2">(refreshing...)</span>}
        </div>
      )}
    </div>
  );
}

interface SortableStationCardProps {
  config: StationConfig;
  arrivals: TrainArrival[];
  alerts: ServiceAlert[];
  onDirectionChange: (direction: 'all' | 'N' | 'S') => void;
  showDragHandle: boolean;
}

function SortableStationCard({ config, arrivals, alerts, onDirectionChange, showDragHandle }: SortableStationCardProps) {
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
        />
      </div>
    </div>
  );
}
