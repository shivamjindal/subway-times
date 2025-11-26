'use client';

import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { getStation, getRoutesForStation, getRouteColor, searchStationsByName, type Station } from '@/lib/subway-data';
import { X } from 'lucide-react';
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
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      const oldIndex = selectedStations.indexOf(active.id as string);
      const newIndex = selectedStations.indexOf(over.id as string);
      
      if (oldIndex >= 0 && newIndex >= 0) {
        onStationsChange(arrayMove(selectedStations, oldIndex, newIndex));
      }
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={selectedStations}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
              {selectedStationData.map((station) => {
                const routes = getRoutesForStation(station.stopId);
                return (
                  <SortableStationCard
                    key={station.stopId}
                    stationId={station.stopId}
                    station={station}
                    routes={routes}
                    onRemove={handleRemoveStation}
                    canDrag={selectedStations.length > 1}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

interface SortableStationCardProps {
  stationId: string;
  station: Station;
  routes: ReturnType<typeof getRoutesForStation>;
  onRemove: (stationId: string, e?: React.MouseEvent) => void;
  canDrag: boolean;
}

function SortableStationCard({ stationId, station, routes, onRemove, canDrag }: SortableStationCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stationId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border flex-shrink-0 min-w-fit ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
    >
      <div>
        <div className="font-medium text-sm whitespace-nowrap">{station.name}</div>
        <div className="flex gap-1 mt-1 flex-wrap">
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
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove(stationId, e);
        }}
        className="ml-2 p-1 hover:bg-background rounded transition-colors flex-shrink-0"
        aria-label={`Remove ${station.name}`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
