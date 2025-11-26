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
import { GripVertical } from 'lucide-react';

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
    high: number;
    low: number;
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

  // Load stations from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setStationConfigs(parsed);
        } else {
          // Default to F24 for backward compatibility
          setStationConfigs([{ stationId: 'F24', direction: 'all' }]);
        }
      } else {
        // Default to F24 for backward compatibility
        setStationConfigs([{ stationId: 'F24', direction: 'all' }]);
      }
    } catch (err) {
      console.error('Error loading stations from localStorage:', err);
      setStationConfigs([{ stationId: 'F24', direction: 'all' }]);
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
      setData({ arrivals: [], alerts: [], lastUpdated: Math.floor(Date.now() / 1000) });
      setLoading(false);
      hasDataRef.current = false;
      return;
    }

    try {
      // If we already have data, use refreshing state instead of loading to avoid blanking the page
      const shouldShowRefreshing = showRefreshing || hasDataRef.current;
      if (shouldShowRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
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
      hasDataRef.current = false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedStationIdsKey]); // Only recreate when actual station IDs change, not order

  useEffect(() => {
    if (selectedStationIds.length > 0) {
      fetchData();
    }
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
    useSensor(PointerSensor),
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
                  H: {weather.today.high}°F / L: {weather.today.low}°F
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
              <div className="space-y-2">
                <div className="text-sm font-semibold">Hourly Forecast</div>
                <div className="overflow-x-auto">
                  <div className="flex gap-2 pb-2 min-w-max">
                    {weather.hourly.slice(0, 12).map((hour, index) => (
                      <div
                        key={index}
                        className="flex flex-col items-center gap-1 min-w-[70px] p-2 border rounded-lg bg-muted/30"
                      >
                        <div className="text-xs font-medium text-muted-foreground">
                          {formatHourlyTime(hour.time)}
                        </div>
                        <div className="text-muted-foreground">
                          {getWeatherIcon(hour.condition)}
                        </div>
                        <div className="text-sm font-semibold">
                          {hour.temperature}°F
                        </div>
                        {hour.probabilityOfPrecipitation > 0 && (
                          <div className="text-xs text-blue-600">
                            {hour.probabilityOfPrecipitation}%
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground text-center">
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
    <div ref={setNodeRef} style={style} className="flex items-start gap-2">
      {showDragHandle && (
        <div
          {...attributes}
          {...listeners}
          className="mt-6 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <GripVertical className="h-5 w-5" />
        </div>
      )}
      <div className="flex-1 min-w-0">
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
