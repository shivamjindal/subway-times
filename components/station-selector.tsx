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
  filteredStations?: string[];
  onStationFilterToggle?: (stationId: string) => void;
}

export function StationSelector({ selectedStations, onStationsChange, filteredStations = [], onStationFilterToggle }: StationSelectorProps) {
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
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
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
                const hasFiltered = filteredStations.length > 0;
                const isFiltered = filteredStations.includes(station.stopId);
                return (
                  <SortableStationCard
                    key={station.stopId}
                    stationId={station.stopId}
                    station={station}
                    routes={routes}
                    onRemove={handleRemoveStation}
                    canDrag={selectedStations.length > 1}
                    isFiltered={isFiltered}
                    hasFilteredStations={hasFiltered}
                    onFilterToggle={onStationFilterToggle}
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
  isFiltered: boolean;
  hasFilteredStations: boolean;
  onFilterToggle?: (stationId: string) => void;
}

function SortableStationCard({ stationId, station, routes, onRemove, canDrag, isFiltered, hasFilteredStations, onFilterToggle }: SortableStationCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stationId });

  // Calculate opacity: full when no filter or when this station is filtered, dimmed otherwise
  const filterOpacity = hasFilteredStations ? (isFiltered ? 1 : 0.4) : 1;
  const finalOpacity = isDragging ? 0.5 : filterOpacity;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: finalOpacity,
  };

  const handleCardClick = () => {
    // Only trigger filter toggle if it wasn't a drag action
    if (onFilterToggle) {
      onFilterToggle(stationId);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border flex-shrink-0 min-w-fit transition-opacity ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} hover:bg-muted/80`}
      onClick={handleCardClick}
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
