'use client';

import { useState, useMemo } from 'react';
import { getStation, getRoutesForStation, getRouteColor, searchStationsByName, type Station } from '@/lib/subway-data';
import { Crosshair, X } from 'lucide-react';
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
  onStationJump?: (stationId: string) => void;
}

export function StationSelector({ selectedStations, onStationsChange, onStationJump }: StationSelectorProps) {
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
        <label htmlFor="station-search" className="hud-label flex items-center gap-2 mb-2">
          <Crosshair className="h-3 w-3 text-telemetry" />
          Target acquisition · Add a station
        </label>
        <span className="pointer-events-none absolute z-10 left-4 bottom-0 h-12 flex items-center font-mono text-telemetry">
          &gt;<span className="blink ml-0.5">_</span>
        </span>
        <input
          id="station-search"
          type="text"
          autoComplete="off"
          placeholder="Search for a station (e.g. Times Sq, 7 Av)"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              e.stopPropagation();
              const target = searchResults.find(r => !selectedStations.includes(r.station.stopId));
              if (target) handleSelectStation(target.station.stopId, e);
            }
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => {
            // Delay hiding suggestions to allow clicks
            setTimeout(() => setShowSuggestions(false), 200);
          }}
          className="w-full h-12 pl-11 pr-4 border bg-card/80 backdrop-blur font-mono text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:border-telemetry focus:shadow-[0_0_0_1px_var(--telemetry),0_0_24px_-8px_var(--telemetry)] transition-shadow"
        />
        
        {/* Search Suggestions */}
        {showSuggestions && searchResults.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-popover border border-telemetry/40 shadow-2xl shadow-black/60 max-h-72 overflow-y-auto divide-y">
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
                  className={`group w-full text-left px-4 py-3 hover:bg-telemetry/10 transition-colors ${
                    isSelected ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="hud-title text-lg font-semibold">{station.name}</div>
                    <span className="hud-label group-hover:text-telemetry">
                      {isSelected ? 'Tracking' : 'Lock target ↵'}
                    </span>
                  </div>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {stationWithRoutes.routes.map((route) => {
                      const color = getRouteColor(route.routeId);
                      return (
                        <span
                          key={route.routeId}
                          className="route-bullet h-5 w-5 text-[0.65rem]"
                          style={{
                            backgroundColor: `#${color}`,
                            color: route.textColor === 'FFFFFF' ? 'white' : 'black',
                            ['--route-color' as string]: `#${color}`,
                          }}
                        >
                          {route.shortName}
                        </span>
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
            <div className="hud-label mb-2 mt-1">
              Tracking {selectedStationData.length} station{selectedStationData.length > 1 ? 's' : ''}
              {onStationJump && selectedStationData.length > 1 && ' · tap to jump, drag to reorder'}
            </div>
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
                    onJump={onStationJump}
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
  onJump?: (stationId: string) => void;
}

function SortableStationCard({ stationId, station, routes, onRemove, canDrag, onJump }: SortableStationCardProps) {
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

  const handleCardClick = () => {
    onJump?.(stationId);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 pl-3 pr-1.5 py-2 bg-card/80 backdrop-blur border flex-shrink-0 min-w-fit transition-all ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} hover:border-foreground/40`}
      onClick={handleCardClick}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
    >
      <div>
        <div className="hud-title text-base font-semibold whitespace-nowrap">{station.name}</div>
        <div className="flex gap-1.5 mt-1.5 flex-wrap">
          {routes.map((route) => {
            const color = getRouteColor(route.routeId);
            return (
              <span
                key={route.routeId}
                className="route-bullet h-5 w-5 text-[0.65rem]"
                style={{
                  backgroundColor: `#${color}`,
                  color: route.textColor === 'FFFFFF' ? 'white' : 'black',
                  ['--route-color' as string]: `#${color}`,
                }}
              >
                {route.shortName}
              </span>
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
        className="ml-2 p-1 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
        aria-label={`Remove ${station.name}`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
