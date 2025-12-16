'use client';

import { useSyncExternalStore, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStation, getRoutesForStation, getRouteColor } from '@/lib/subway-data';
import { Train, ArrowRight } from 'lucide-react';

interface StationConfig {
  stationId: string;
  direction: 'all' | 'N' | 'S';
  selectedRoutes?: string[];
}

interface SavedStationsWelcomeProps {
  onStationSelect: (stationId: string) => void;
  onSkip: () => void;
}

const STORAGE_KEY = 'selectedStations';

// Get saved stations from localStorage
function getSavedStations(): StationConfig[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error loading stations from localStorage:', err);
  }
  return [];
}

// Subscribe to storage changes
function subscribeToStorage(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

export function SavedStationsWelcome({ onStationSelect, onSkip }: SavedStationsWelcomeProps) {
  // Use useSyncExternalStore to properly read from localStorage
  const stationConfigs = useSyncExternalStore(
    subscribeToStorage,
    useCallback(() => getSavedStations(), []),
    useCallback(() => [] as StationConfig[], []) // Server snapshot
  );

  // If no saved stations, don't show this screen
  if (stationConfigs.length === 0) {
    return null;
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto p-4 max-w-4xl">
        {/* Header */}
        <div className="text-center py-8 mb-6">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Train className="h-10 w-10 text-primary" />
            <h1 className="text-4xl font-bold">Welcome Back</h1>
          </div>
          <p className="text-xl text-muted-foreground">
            Tap a station to see arrival times
          </p>
        </div>

        {/* Station Cards Grid */}
        <div className="grid gap-6 mb-8">
          {stationConfigs.map((config) => {
            const station = getStation(config.stationId);
            const routes = getRoutesForStation(config.stationId);

            if (!station) return null;

            return (
              <button
                key={config.stationId}
                onClick={() => onStationSelect(config.stationId)}
                className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl"
              >
                <Card className="w-full transition-all duration-200 hover:shadow-lg hover:scale-[1.02] hover:border-primary/50 cursor-pointer group">
                  <CardContent className="p-6 md:p-8">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Station Name */}
                        <h2 className="text-2xl md:text-3xl font-bold mb-4 truncate">
                          {station.name}
                        </h2>
                        
                        {/* Route Badges */}
                        <div className="flex gap-2 flex-wrap">
                          {routes.map((route) => {
                            const color = getRouteColor(route.routeId);
                            return (
                              <Badge
                                key={route.routeId}
                                className="text-lg md:text-xl px-3 py-1"
                                style={{
                                  backgroundColor: `#${color}`,
                                  color: route.textColor === 'FFFFFF' ? 'white' : 'black',
                                }}
                              >
                                {route.shortName}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                      
                      {/* Arrow indicator */}
                      <div className="flex-shrink-0">
                        <ArrowRight className="h-8 w-8 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>

        {/* Skip Button */}
        <div className="flex justify-center pb-8">
          <button
            onClick={onSkip}
            className="px-8 py-4 text-lg font-medium rounded-xl bg-muted hover:bg-muted/80 transition-colors flex items-center gap-2"
          >
            <span>View All Stations</span>
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </main>
  );
}
