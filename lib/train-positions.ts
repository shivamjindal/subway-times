import { transit_realtime } from 'gtfs-realtime-bindings';
import Long from 'long';
import { trackAt, type TrackIndex } from './nyct-tracks';
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
  /** When the train leaves `to` again. */
  departsAt: number;
  /** The stop after `to`, when the feed lists one. */
  next?: string;
  nextArrivesAt?: number;
  /** NYCT track at `from`, `to`, and `next`, when the feed's track extension carries one. */
  fromTrack?: string;
  toTrack?: string;
  nextTrack?: string;
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
// Feeds usually report departure == arrival at intermediate stops; trains really dwell ~20-30 s.
const MIN_DWELL_SECONDS = 20;

function toNumber(value: Long | number | null | undefined): number {
  if (!value) return 0;
  return Long.isLong(value) ? value.toNumber() : Number(value);
}

function splitStopId(stopId: string): { station: string; direction: 'N' | 'S' } | null {
  const suffix = stopId.slice(-1);
  if (suffix !== 'N' && suffix !== 'S') return null;
  return { station: stopId.slice(0, -1), direction: suffix };
}

export function estimateTrainPositions(feeds: transit_realtime.IFeedMessage[], now: number, tracks?: TrackIndex): EstimatedTrain[] {
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
      const stoppedIndex = stopped ? stops.findIndex((s) => s.stop.station === stopped.station) : -1;

      // Index of the stop the train is heading to (or sitting at) and how it got there.
      let toIndex = nextIndex;
      let leg: Pick<EstimatedTrain, 'from' | 'departedAt' | 'arrivesAt' | 'basis'>;
      if (stopped) {
        toIndex = stoppedIndex;
        const arrivedAt = stoppedIndex >= 0 ? Math.min(stops[stoppedIndex].time, now) : now;
        leg = { from: stopped.station, departedAt: arrivedAt, arrivesAt: arrivedAt, basis: 'stopped' };
      } else if (nextIndex > 0) {
        const prev = stops[nextIndex - 1];
        leg = { from: prev.stop.station, departedAt: prev.departure, arrivesAt: next.time, basis: 'feed' };
      } else {
        const prevStation = topology.prev[`${routeId}|${next.stop.direction}|${next.stop.station}`];
        if (prevStation) {
          const runSeconds = topology.seconds[`${prevStation}>${next.stop.station}`] ?? DEFAULT_SEGMENT_SECONDS;
          leg = { from: prevStation, departedAt: next.time - runSeconds, arrivesAt: next.time, basis: 'schedule' };
        } else {
          // Next stop is the origin terminal: the train is already waiting there.
          leg = { from: next.stop.station, departedAt: now, arrivesAt: now, basis: 'stopped' };
        }
      }

      const to = toIndex >= 0 ? stops[toIndex] : null;
      const after = toIndex >= 0 ? stops[toIndex + 1] : stops[nextIndex];
      const toStation = to?.stop.station ?? leg.from;
      const reportedDeparture = to?.departure ?? leg.arrivesAt;
      const dwellCap = after ? (leg.arrivesAt + after.time) / 2 : Infinity;
      const departsAt = Math.max(reportedDeparture, Math.min(leg.arrivesAt + MIN_DWELL_SECONDS, dwellCap));

      const track = (station: string | undefined) =>
        station === undefined ? undefined : trackAt(tracks, tripId, `${station}${base.direction}`);
      const fromTrack = track(leg.from);
      const toTrack = track(toStation);
      const nextTrack = track(after?.stop.station);
      trains.push({
        ...base,
        ...leg,
        to: toStation,
        departsAt,
        ...(after && { next: after.stop.station, nextArrivesAt: after.time }),
        ...(fromTrack && { fromTrack }),
        ...(toTrack && { toTrack }),
        ...(nextTrack && { nextTrack }),
      });
      seen.add(tripId);
    }
  }

  return trains;
}
