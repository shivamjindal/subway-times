'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, ChevronDown, ChevronUp, ChevronsUpDown, X, Eye } from 'lucide-react';
import { formatArrivalTime, formatTime, type TrainArrival, type ServiceAlert } from '@/lib/subway-parser';
import { getStation, getRoutesForStation, getRouteColor, getNorthboundRoutesForStation, getSouthboundRoutesForStation, getDirectionLabel } from '@/lib/subway-data';
import { SplitFlapTime } from '@/components/split-flap-time';
import { Skeleton } from '@/components/ui/skeleton';

interface StationCardProps {
  stationId: string;
  arrivals: TrainArrival[];
  alerts: ServiceAlert[];
  hiddenAlertKeys: Set<string>;
  showHiddenAlerts: boolean;
  direction: 'all' | 'N' | 'S';
  isPending?: boolean;
  onDirectionChange: (direction: 'all' | 'N' | 'S') => void;
  selectedRoutes?: string[];
  onRouteToggle: (routeId: string) => void;
  onHideAlert: (alert: ServiceAlert) => void;
  onUnhideAlert: (alert: ServiceAlert) => void;
}

// Helper to generate a content-based key for alert deduplication/hiding
const getAlertContentKey = (alert: ServiceAlert): string => {
  const normalize = (text: string) => (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${normalize(alert.headerText)}|${normalize(alert.descriptionText)}`;
};

const INITIAL_TRAINS_TO_SHOW = 5;

export function StationCard({ stationId, arrivals, alerts, hiddenAlertKeys, showHiddenAlerts, direction, isPending = false, onDirectionChange, selectedRoutes, onRouteToggle, onHideAlert, onUnhideAlert }: StationCardProps) {
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
                const hasSelectedRoutes = selectedRoutes && selectedRoutes.length > 0;
                const isSelected = selectedRoutes?.includes(route.routeId) ?? false;
                // In default state (no routes selected), show all at 100% opacity
                // When routes are selected, show selected at 100%, unselected at reduced opacity
                const opacity = hasSelectedRoutes ? (isSelected ? 1 : 0.4) : 1;
                return (
                  <button
                    key={route.routeId}
                    type="button"
                    onClick={() => onRouteToggle(route.routeId)}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                    className="cursor-pointer transition-all hover:scale-105 active:scale-95"
                    aria-label={isSelected ? `Deselect ${route.shortName} route` : `Select ${route.shortName} route`}
                  >
                    <Badge
                      className="text-sm transition-opacity"
                      style={{
                        backgroundColor: `#${color}`,
                        color: route.textColor === 'FFFFFF' ? 'white' : 'black',
                        opacity: opacity,
                      }}
                    >
                      {route.shortName}
                    </Badge>
                  </button>
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
            {stationAlerts.map((alert) => {
              const contentKey = getAlertContentKey(alert);
              const isHidden = hiddenAlertKeys.has(contentKey);
              
              return (
                <Alert 
                  key={alert.id} 
                  variant="destructive"
                  className={`relative ${isHidden && showHiddenAlerts ? 'opacity-60 border-dashed' : ''}`}
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="pr-8 flex items-center gap-2">
                    {alert.headerText}
                    {isHidden && showHiddenAlerts && (
                      <span className="text-xs font-normal bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                        Hidden
                      </span>
                    )}
                  </AlertTitle>
                  {alert.descriptionText && (
                    <AlertDescription className="pr-8">{alert.descriptionText}</AlertDescription>
                  )}
                  <button
                    type="button"
                    onClick={() => isHidden ? onUnhideAlert(alert) : onHideAlert(alert)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="absolute top-3 right-3 p-1 hover:bg-destructive/20 rounded transition-colors"
                    aria-label={isHidden ? 'Show this alert' : 'Hide this alert'}
                    title={isHidden ? 'Show this alert' : 'Hide this alert'}
                  >
                    {isHidden ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </button>
                </Alert>
              );
            })}
          </div>
        )}

        {/* Train Arrivals */}
        {filteredArrivals.length === 0 ? (
          isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No trains scheduled at this time
            </div>
          )
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
                    <SplitFlapTime value={arrival.routeId}>
                      <Badge
                        className="text-lg px-3 py-1"
                        style={{
                          backgroundColor: `#${routeColor}`,
                          color: badgeColor,
                        }}
                      >
                        {arrival.routeId}
                      </Badge>
                    </SplitFlapTime>
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
                    <SplitFlapTime value={arrival.arrivalTimeSeconds}>
                      <div className="text-2xl font-bold">
                        {formatArrivalTime(arrival.arrivalTimeSeconds)}
                      </div>
                    </SplitFlapTime>
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
