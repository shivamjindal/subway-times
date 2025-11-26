'use client';

import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { getStation, getRoutesForStation, getRouteColor, searchStationsByName, type Station } from '@/lib/subway-data';
import { X } from 'lucide-react';

interface StationSelectorProps {
  selectedStations: string[];
  onStationsChange: (stations: string[]) => void;
}

export function StationSelector({ selectedStations, onStationsChange }: StationSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchStationsByName(searchQuery.trim()).slice(0, 10);
  }, [searchQuery]);

  const handleSelectStation = (stationId: string, e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!selectedStations.includes(stationId)) {
      onStationsChange([...selectedStations, stationId]);
    }
    setSearchQuery('');
    setShowSuggestions(false);
  };

  const handleRemoveStation = (stationId: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    onStationsChange(selectedStations.filter(id => id !== stationId));
  };

  const selectedStationData = useMemo(() => {
    return selectedStations
      .map(id => getStation(id))
      .filter((s): s is Station => s !== undefined);
  }, [selectedStations]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="space-y-3">
      {/* Search Input */}
      <form onSubmit={handleFormSubmit} className="relative">
        <input
          type="text"
          placeholder="Search for a station..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => {
            // Delay hiding suggestions to allow clicks
            setTimeout(() => setShowSuggestions(false), 200);
          }}
          className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        />
        
        {/* Search Suggestions */}
        {showSuggestions && searchResults.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-64 overflow-y-auto">
            {searchResults.map((stationWithRoutes) => {
              const station = stationWithRoutes.station;
              const isSelected = selectedStations.includes(station.stopId);
              
              return (
                <button
                  key={station.stopId}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectStation(station.stopId, e);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  disabled={isSelected}
                  className={`w-full text-left px-4 py-3 hover:bg-muted transition-colors ${
                    isSelected ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <div className="font-medium">{station.name}</div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {stationWithRoutes.routes.map((route) => {
                      const color = getRouteColor(route.routeId);
                      return (
                        <Badge
                          key={route.routeId}
                          className="text-xs"
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
                </button>
              );
            })}
          </div>
        )}
      </form>

      {/* Selected Stations */}
      {selectedStationData.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedStationData.map((station) => {
            const routes = getRoutesForStation(station.stopId);
            return (
              <div
                key={station.stopId}
                className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border"
              >
                <div>
                  <div className="font-medium text-sm">{station.name}</div>
                  <div className="flex gap-1 mt-1">
                    {routes.map((route) => {
                      const color = getRouteColor(route.routeId);
                      return (
                        <Badge
                          key={route.routeId}
                          className="text-xs"
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
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRemoveStation(station.stopId, e);
                  }}
                  className="ml-2 p-1 hover:bg-background rounded transition-colors"
                  aria-label={`Remove ${station.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
