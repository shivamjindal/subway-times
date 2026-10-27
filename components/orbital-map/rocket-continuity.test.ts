import { describe, expect, it } from 'vitest';
import { transit_realtime } from 'gtfs-realtime-bindings';
import type { TrackIndex } from '@/lib/nyct-tracks';
import { estimateTrainPositions } from '@/lib/train-positions';
import { createPose, placeRockets, rocketPose } from './map-geometry';
import { EMPTY_FLEET, reconcileFleet, rocketState, type Fleet } from './rocket-timeline';

const POLL_SECONDS = 30;
const SAMPLE_SECONDS = 0.25;
const START = 1_800_000_000;
const L_NORTHBOUND = ['L29', 'L28', 'L27', 'L26', 'L25', 'L24', 'L22', 'L21', 'L20', 'L19', 'L17', 'L16', 'L15', 'L14', 'L13', 'L12'];
const RUN_SECONDS = 90;
const DWELL_SECONDS = 25;

/** Deterministic noise in [0, 1). */
function noise(...parts: Array<string | number>) {
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

interface Trip {
  id: string;
  /** Scheduled arrival at each stop. */
  arrivals: number[];
}

const trips: Trip[] = [0, 150, 300, 315, 450, 600, 750].map((offset, k) => ({
  id: `L_N_${k}`,
  arrivals: L_NORTHBOUND.map((_, i) => START + offset + i * (RUN_SECONDS + DWELL_SECONDS)),
}));

/**
 * One poll of a feed that behaves like the MTA's: predictions drift between polls, an arrived stop usually drops out
 * of the trip update before the train leaves, the stopped vehicle is sometimes missing, one trip is reassigned a new
 * ID partway through, and track reports come and go.
 */
function poll(now: number): { feed: transit_realtime.IFeedMessage; tracks: TrackIndex } {
  const k = Math.round((now - START) / POLL_SECONDS);
  const entity: transit_realtime.IFeedEntity[] = [];
  const tracks: TrackIndex = new Map();
  for (const trip of trips) {
    const delay = Math.round(20 * Math.sin(k * 0.5 + trip.arrivals[0]) + (noise(trip.id, k) - 0.5) * 24);
    const stops = trip.arrivals.map((t, i) => ({ stopId: `${L_NORTHBOUND[i]}N`, arr: t + delay, dep: t + delay + DWELL_SECONDS }));
    const upcoming = stops.findIndex((s) => s.arr > now);
    if (upcoming < 0 || stops[upcoming].arr - now > 15 * 60) continue;
    const dwelling = upcoming > 0 && stops[upcoming - 1].dep > now ? upcoming - 1 : -1;
    const from = dwelling >= 0 && noise(trip.id, k, 'keep') < 0.35 ? dwelling : upcoming;
    const tripId = trip.id === 'L_N_2' && k >= 16 ? 'L_N_2_reassigned' : trip.id;
    const listed = stops.slice(from);
    entity.push({
      id: tripId,
      tripUpdate: {
        trip: { tripId, routeId: 'L' },
        stopTimeUpdate: listed.map((s) => ({ stopId: s.stopId, arrival: { time: s.arr }, departure: { time: s.dep } })),
      },
    });
    if (dwelling >= 0 && noise(trip.id, k, 'vehicle') < 0.7) {
      entity.push({
        id: `${tripId}_v`,
        vehicle: {
          trip: { tripId, routeId: 'L' },
          currentStatus: transit_realtime.VehiclePosition.VehicleStopStatus.STOPPED_AT,
          stopId: stops[dwelling].stopId,
        },
      });
    }
    // Trip 4 only starts reporting a track partway through; trip 1 loses its track every third poll.
    const reportsTrack = (trip.id !== 'L_N_4' || k >= 12) && (trip.id !== 'L_N_1' || k % 3 !== 0);
    if (reportsTrack) tracks.set(tripId, new Map(listed.map((s) => [s.stopId, { scheduled: '4' }])));
  }
  return { feed: { header: { gtfsRealtimeVersion: '2.0', timestamp: now }, entity }, tracks };
}

interface Sample {
  t: number;
  phase: string;
  station: string;
  final: boolean;
  x: number;
  y: number;
  z: number;
}

/** Plays the polls through the server estimate and the client fleet, sampling every rocket's pose on the map. */
function simulate(polls: number) {
  const samples = new Map<string, Sample[]>();
  const pose = createPose();
  let fleet: Fleet = EMPTY_FLEET;
  for (let k = 0; k < polls; k++) {
    const now = START + k * POLL_SECONDS;
    const { feed, tracks } = poll(now);
    fleet = reconcileFleet(fleet, estimateTrainPositions([feed], now, tracks), now);
    const placed = placeRockets(fleet);
    for (let t = now; t < now + POLL_SECONDS; t += SAMPLE_SECONDS) {
      for (const p of placed) {
        rocketPose(p, t, pose);
        const state = rocketState(p.rocket, t);
        const visit = p.rocket.visits[state.visit];
        const list = samples.get(p.rocket.id) ?? [];
        list.push({ t, phase: state.phase, station: state.station, final: visit.to === undefined, x: pose.x, y: pose.y, z: pose.z });
        samples.set(p.rocket.id, list);
      }
    }
  }
  return samples;
}

/** Everything a viewer would read as a broken animation, as `t: problem` lines. */
function discontinuities(samples: Map<string, Sample[]>) {
  const problems: string[] = [];
  for (const [id, list] of samples) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const at = `${id} at +${(b.t - START).toFixed(2)}s: ${a.phase}@${a.station} -> ${b.phase}@${b.station}`;
      if (b.t - a.t > SAMPLE_SECONDS + 1e-6) problems.push(`${at} (dropped from the fleet for ${(b.t - a.t).toFixed(1)}s)`);
      else if (a.phase !== 'offstage' && b.phase === 'offstage' && !(a.phase === 'pad' && a.final)) problems.push(`${at} (vanished)`);
      else if (a.phase === 'pad' && (b.phase === 'hold' || (b.phase === 'flight' && b.station === a.station)))
        problems.push(`${at} (landed again)`);
      else if (a.phase === 'pad' && b.phase === 'pad' && a.station !== b.station) problems.push(`${at} (teleported)`);
      else if ((a.phase === 'flight' || a.phase === 'hold') && b.phase !== 'offstage' && b.station !== a.station)
        problems.push(`${at} (skipped its landing)`);
      else if (a.phase !== 'offstage' && b.phase !== 'offstage') {
        const step = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (step > 0.03) problems.push(`${at} (jumped ${step.toFixed(3)} km)`);
      }
    }
  }
  return problems;
}

describe('rocket continuity across polls', () => {
  const polls = 40;
  const samples = simulate(polls);

  it('covers landings, dwells, and launches at every station along the way', () => {
    const landings = [...samples.values()].flatMap((list) =>
      list.filter((s, i) => i > 0 && list[i - 1].phase !== 'pad' && s.phase === 'pad'),
    );
    expect(landings.length).toBeGreaterThan(40);
  });

  it('plays every rocket as one unbroken sequence: no vanishing, relanding, relaunching, or jumps', () => {
    expect(discontinuities(samples)).toEqual([]);
  });

  it('keeps a rocket when its trip is reassigned a new ID, and never draws a train twice', () => {
    const reassigned = samples.get('L_N_2');
    expect(samples.has('L_N_2_reassigned')).toBe(false);
    const visibleAt = new Map<number, number>();
    for (const list of samples.values())
      for (const s of list) if (s.phase !== 'offstage') visibleAt.set(s.t, (visibleAt.get(s.t) ?? 0) + 1);
    expect(Math.max(...visibleAt.values())).toBeLessThanOrEqual(trips.length);
    expect(reassigned!.at(-1)!.t).toBeGreaterThan(START + 20 * POLL_SECONDS);
  });
});
