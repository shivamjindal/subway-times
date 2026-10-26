import { transit_realtime } from 'gtfs-realtime-bindings';
import Long from 'long';
import topologyData from './subway-map-topology.json';

/**
 * GTFS-realtime gives arrival predictions, not coordinates, so a train is placed on the segment
 * between the station it last left and the one it's predicted at next.
 * - `feed`: the feed still lists the just-departed stop, so both ends of the segment are predictions.
 * - `schedule`: only the next stop is known; the segment start is backed out of the scheduled run time.
 * - `stopped`: the feed reports the train stopped at a station.
 */
export type PositionBasis = 'feed' | 'schedule' | 'stopped';

export interface EstimatedTrain {
  id: string;
  routeId: string;
  direction: 'N' | 'S';
  from: string;
  to: string;
  departedAt: number;
  arrivesAt: number;
  basis: PositionBasis;
}

interface Topology {
  prev: Record<string, string>;
  seconds: Record<string, number>;
}

const topology = topologyData as Topology;

const DEFAULT_SEGMENT_SECONDS = 120;
// Predictions this far out usually belong to trains still sitting at their origin terminal.
const MAX_LOOKAHEAD_SECONDS = 20 * 60;

function toNumber(value: Long | number | null | undefined): number {
  if (!value) return 0;
  return Long.isLong(value) ? value.toNumber() : Number(value);
}

function splitStopId(stopId: string): { station: string; direction: 'N' | 'S' } | null {
  const suffix = stopId.slice(-1);
  if (suffix !== 'N' && suffix !== 'S') return null;
  return { station: stopId.slice(0, -1), direction: suffix };
}

export function estimateTrainPositions(feeds: transit_realtime.IFeedMessage[], now: number): EstimatedTrain[] {
  const stoppedAt = new Map<string, string>();
  for (const feed of feeds) {
    for (const entity of feed.entity ?? []) {
      const vehicle = entity.vehicle;
      const tripId = vehicle?.trip?.tripId;
      if (tripId && vehicle?.stopId && vehicle.currentStatus === transit_realtime.VehiclePosition.VehicleStopStatus.STOPPED_AT) {
        stoppedAt.set(tripId, vehicle.stopId);
      }
    }
  }

  const trains: EstimatedTrain[] = [];
  const seen = new Set<string>();

  for (const feed of feeds) {
    for (const entity of feed.entity ?? []) {
      const update = entity.tripUpdate;
      const tripId = update?.trip?.tripId;
      const routeId = update?.trip?.routeId;
      if (!update || !tripId || !routeId || seen.has(tripId)) continue;

      const stops = (update.stopTimeUpdate ?? [])
        .map((stu) => ({
          stop: stu.stopId ? splitStopId(stu.stopId) : null,
          time: toNumber(stu.arrival?.time) || toNumber(stu.departure?.time),
          departure: toNumber(stu.departure?.time) || toNumber(stu.arrival?.time),
        }))
        .filter((s): s is { stop: NonNullable<typeof s.stop>; time: number; departure: number } => s.stop !== null && s.time > 0);

      const nextIndex = stops.findIndex((s) => s.time > now);
      if (nextIndex < 0) continue;
      const next = stops[nextIndex];
      if (next.time - now > MAX_LOOKAHEAD_SECONDS) continue;

      const base = { id: tripId, routeId, direction: next.stop.direction };
      const stoppedStop = stoppedAt.get(tripId);
      const stopped = stoppedStop ? splitStopId(stoppedStop) : null;

      if (stopped) {
        trains.push({ ...base, from: stopped.station, to: stopped.station, departedAt: now, arrivesAt: now, basis: 'stopped' });
      } else if (nextIndex > 0) {
        const prev = stops[nextIndex - 1];
        trains.push({ ...base, from: prev.stop.station, to: next.stop.station, departedAt: prev.departure, arrivesAt: next.time, basis: 'feed' });
      } else {
        const prevStation = topology.prev[`${routeId}|${next.stop.direction}|${next.stop.station}`];
        if (prevStation) {
          const runSeconds = topology.seconds[`${prevStation}>${next.stop.station}`] ?? DEFAULT_SEGMENT_SECONDS;
          trains.push({ ...base, from: prevStation, to: next.stop.station, departedAt: next.time - runSeconds, arrivesAt: next.time, basis: 'schedule' });
        } else {
          // Next stop is the origin terminal: the train is waiting there.
          trains.push({ ...base, from: next.stop.station, to: next.stop.station, departedAt: now, arrivesAt: now, basis: 'stopped' });
        }
      }
      seen.add(tripId);
    }
  }

  return trains;
}
