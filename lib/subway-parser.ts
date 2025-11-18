import { transit_realtime } from 'gtfs-realtime-bindings';
import Long from 'long';

export interface TrainArrival {
  tripId: string;
  routeId: string;
  stopId: string;
  arrivalTime: number; // Unix timestamp in seconds
  arrivalTimeSeconds: number; // Seconds until arrival
  destination: string;
  trainId?: string;
}

export interface ServiceAlert {
  id: string;
  headerText: string;
  descriptionText: string;
  activePeriods: Array<{ start: number; end?: number }>;
}

// Stop IDs for 7th Ave Brooklyn station
// F train: F24N (Manhattan-bound/Northbound)
// G train: F24N (Queens-bound/Northbound) - G train shares the same station
// Note: In GTFS static data, Queens-bound G trains use F24N, but real-time feed may vary
const TARGET_STOP_IDS = {
  F: ['F24N'], // 7th Ave Brooklyn, Manhattan-bound
  G: ['F24N'], // 7th Ave Brooklyn, Queens-bound (northbound)
};

// Helper to convert Long to number
function longToNumber(value: Long | number | string | undefined | null): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 10);
  if (Long.isLong(value)) return value.toNumber();
  return 0;
}

export function parseGTFSFeed(
  feedMessage: transit_realtime.FeedMessage,
  routeId: 'F' | 'G'
): {
  arrivals: TrainArrival[];
  alerts: ServiceAlert[];
} {
  const arrivals: TrainArrival[] = [];
  const alerts: ServiceAlert[] = [];
  const targetStopIds = TARGET_STOP_IDS[routeId];

  if (!feedMessage.entity || feedMessage.entity.length === 0) {
    return { arrivals, alerts };
  }

  for (const entity of feedMessage.entity) {
    if (entity.tripUpdate) {
      const tripUpdate = entity.tripUpdate;
      const trip = tripUpdate.trip;
      
      // Filter for the specified route
      if (trip?.routeId !== routeId) {
        continue;
      }

      // Find stop time update for our target stop(s)
      if (tripUpdate.stopTimeUpdate && tripUpdate.stopTimeUpdate.length > 0) {
        for (const stopTimeUpdate of tripUpdate.stopTimeUpdate) {
          // Check if this stop matches any of our target stop IDs
          const stopId = stopTimeUpdate.stopId;
          const matchesStop = targetStopIds.some(targetStopId => {
            // Exact match
            return stopId === targetStopId;
          });

          if (matchesStop && stopTimeUpdate.arrival) {
            const arrivalTimeValue = stopTimeUpdate.arrival.time;
            if (!arrivalTimeValue) continue;

            const now = Math.floor(Date.now() / 1000);
            const arrivalTimeSeconds = longToNumber(arrivalTimeValue);
            
            // Only include future arrivals
            if (arrivalTimeSeconds > now) {
              arrivals.push({
                tripId: trip.tripId || '',
                routeId: trip.routeId || routeId,
                stopId: stopTimeUpdate.stopId || targetStopIds[0],
                arrivalTime: arrivalTimeSeconds,
                arrivalTimeSeconds: arrivalTimeSeconds - now,
                destination: trip.tripHeadsign || (routeId === 'F' ? 'Manhattan' : 'Queens'),
                trainId: tripUpdate.vehicle?.label || undefined,
              });
            }
          }
        }
      }
    }

    if (entity.alert) {
      const alert = entity.alert;
      
      // Check if alert is for the specified route
      const isForRoute = alert.informedEntity?.some(
        (informedEntity) => informedEntity.routeId === routeId
      );

      if (isForRoute && alert.headerText && alert.headerText.translation) {
        const translations = alert.headerText.translation;
        if (translations.length > 0) {
          const headerTranslation = translations[0];
          const descriptionTranslations = alert.descriptionText?.translation;
          const descriptionTranslation = descriptionTranslations && descriptionTranslations.length > 0 
            ? descriptionTranslations[0] 
            : null;

          if (headerTranslation?.text) {
            const activePeriods = (alert.activePeriod || []).map((period) => ({
              start: longToNumber(period.start),
              end: period.end ? longToNumber(period.end) : undefined,
            }));

            alerts.push({
              id: entity.id || '',
              headerText: headerTranslation.text,
              descriptionText: descriptionTranslation?.text || '',
              activePeriods,
            });
          }
        }
      }
    }
  }

  // Sort arrivals by arrival time
  arrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);

  return { arrivals, alerts };
}

export function formatArrivalTime(secondsUntilArrival: number): string {
  if (secondsUntilArrival < 60) {
    return 'Arriving';
  }
  const minutes = Math.floor(secondsUntilArrival / 60);
  return `${minutes} min`;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

