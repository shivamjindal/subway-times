'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { formatArrivalTime, formatTime, type TrainArrival, type ServiceAlert } from '@/lib/subway-parser';
import { getStation, getRoutesForStation, getRouteColor, getNorthboundRoutesForStation, getSouthboundRoutesForStation, getDirectionLabel } from '@/lib/subway-data';

interface StationCardProps {
  stationId: string;
  arrivals: TrainArrival[];
  alerts: ServiceAlert[];
  direction: 'all' | 'N' | 'S';
  onDirectionChange: (direction: 'all' | 'N' | 'S') => void;
}

const INITIAL_TRAINS_TO_SHOW = 5;

export function StationCard({ stationId, arrivals, alerts, direction, onDirectionChange }: StationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  const station = getStation(stationId);
  const routes = getRoutesForStation(stationId);
  const northboundRoutes = getNorthboundRoutesForStation(stationId);
  const southboundRoutes = getSouthboundRoutesForStation(stationId);
  
  const hasNorthbound = northboundRoutes.length > 0;
  const hasSouthbound = southboundRoutes.length > 0;
  
  // Get direction labels based on actual train destinations
  const northboundLabel = getDirectionLabel('N', arrivals);
  const southboundLabel = getDirectionLabel('S', arrivals);

  // Filter arrivals by direction
  const filteredArrivals = useMemo(() => {
    if (direction === 'all') return arrivals;
    return arrivals.filter(a => a.direction === direction);
  }, [arrivals, direction]);

  // Filter alerts for this station's routes
  const stationAlerts = useMemo(() => {
    // Note: This is a simplified check - real alerts might have more complex matching
    // Show all alerts for now
    return alerts;
  }, [alerts]);

  const displayedArrivals = isExpanded 
    ? filteredArrivals 
    : filteredArrivals.slice(0, INITIAL_TRAINS_TO_SHOW);
  
  const hasMore = filteredArrivals.length > INITIAL_TRAINS_TO_SHOW;

  if (!station) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 flex-wrap">
              {station.name}
              {routes.map((route) => {
                const color = getRouteColor(route.routeId);
                return (
                  <Badge
                    key={route.routeId}
                    className="text-sm"
                    style={{
                      backgroundColor: `#${color}`,
                      color: route.textColor === 'FFFFFF' ? 'white' : 'black',
                    }}
                  >
                    {route.shortName}
                  </Badge>
                );
              })}
            </CardTitle>
            <CardDescription className="mt-1">
              Next Trains
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            className="p-1 hover:bg-muted rounded transition-colors flex-shrink-0"
            aria-label={isCollapsed ? 'Expand station' : 'Collapse station'}
          >
            <ChevronsUpDown className={`h-5 w-5 text-muted-foreground transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>
        
        {/* Direction Filter */}
        {(hasNorthbound || hasSouthbound) && (
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => onDirectionChange('all')}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                direction === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              All
            </button>
            {hasNorthbound && (
              <button
                type="button"
                onClick={() => onDirectionChange('N')}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  direction === 'N'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                }`}
              >
                {northboundLabel}
              </button>
            )}
            {hasSouthbound && (
              <button
                type="button"
                onClick={() => onDirectionChange('S')}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  direction === 'S'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                }`}
              >
                {southboundLabel}
              </button>
            )}
          </div>
        )}
      </CardHeader>
      {!isCollapsed && (
        <CardContent className="space-y-4">
        {/* Service Alerts */}
        {stationAlerts.length > 0 && (
          <div className="space-y-2">
            {stationAlerts.map((alert) => (
              <Alert key={alert.id} variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{alert.headerText}</AlertTitle>
                {alert.descriptionText && (
                  <AlertDescription>{alert.descriptionText}</AlertDescription>
                )}
              </Alert>
            ))}
          </div>
        )}

        {/* Train Arrivals */}
        {filteredArrivals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No trains scheduled at this time
          </div>
        ) : (
          <div className="space-y-2">
            {displayedArrivals.map((arrival, index) => {
              const routeColor = getRouteColor(arrival.routeId);
              const route = routes.find(r => r.routeId === arrival.routeId);
              const badgeColor = route?.textColor === 'FFFFFF' ? 'white' : 'black';
              
              return (
                <div
                  key={`${arrival.tripId}-${index}`}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      className="text-lg px-3 py-1"
                      style={{
                        backgroundColor: `#${routeColor}`,
                        color: badgeColor,
                      }}
                    >
                      {arrival.routeId}
                    </Badge>
                    <div>
                      <div className="font-semibold">{arrival.destination}</div>
                      {arrival.trainId && (
                        <div className="text-sm text-muted-foreground">
                          Train {arrival.trainId}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">
                      {formatArrivalTime(arrival.arrivalTimeSeconds)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatTime(arrival.arrivalTime)}
                    </div>
                  </div>
                </div>
              );
            })}
            
            {/* Expand/Collapse Button */}
            {hasMore && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    Show Less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Show {filteredArrivals.length - INITIAL_TRAINS_TO_SHOW} More
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}
