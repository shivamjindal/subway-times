import { describe, expect, it } from 'vitest';
import { transit_realtime } from 'gtfs-realtime-bindings';
import type { TrackIndex } from '@/lib/nyct-tracks';
import { getSpaceport } from '@/lib/spaceports';
import { estimateTrainPositions } from '@/lib/train-positions';
import { REFRESH_SECONDS, assignSlots, createPose, liveShown, padPose, type PadPose, type Shown } from './apron-choreography';
import { createPose as createMapPose, placeRockets, rocketPose } from './map-geometry';
import { EMPTY_FLEET, reconcileFleet, type Fleet } from './rocket-timeline';
import { layoutSites } from './spaceport-layout';

const POLL_SECONDS = 30;
const SAMPLE_SECONDS = 0.25;
const START = 1_800_000_000;
/** Rush hour: a train on every line through the complex every 100 s. */
const HEADWAY_SECONDS = 100;
/** The close-up's booster count before it had to grow. */
const BOOSTERS = 12;
const TIMES_SQ = getSpaceport('127');

/** Each line's usual stops around Times Sq, with scheduled seconds from the first (from static GTFS). */
const PATTERNS: Array<{ route: string; dir: 'N' | 'S'; track: string; stops: Array<[string, number]> }> = [
  {
    route: '1',
    dir: 'N',
    track: '4',
    stops: [
      ['129', 0],
      ['128', 90],
      ['127', 180],
      ['126', 300],
      ['125', 420],
    ],
  },
  {
    route: '1',
    dir: 'S',
    track: '1',
    stops: [
      ['125', 0],
      ['126', 120],
      ['127', 210],
      ['128', 300],
      ['129', 360],
    ],
  },
  {
    route: '2',
    dir: 'N',
    track: '3',
    stops: [
      ['132', 0],
      ['128', 150],
      ['127', 210],
      ['123', 450],
      ['120', 600],
    ],
  },
  {
    route: '2',
    dir: 'S',
    track: '2',
    stops: [
      ['120', 0],
      ['123', 150],
      ['127', 390],
      ['128', 450],
      ['132', 600],
    ],
  },
  {
    route: '3',
    dir: 'N',
    track: '3',
    stops: [
      ['132', 0],
      ['128', 150],
      ['127', 210],
      ['123', 450],
      ['120', 630],
    ],
  },
  {
    route: '3',
    dir: 'S',
    track: '2',
    stops: [
      ['120', 0],
      ['123', 150],
      ['127', 390],
      ['128', 450],
      ['132', 630],
    ],
  },
  {
    route: '7',
    dir: 'N',
    track: '4',
    stops: [
      ['726', 0],
      ['725', 180],
      ['724', 270],
      ['723', 330],
    ],
  },
  {
    route: '7',
    dir: 'S',
    track: '1',
    stops: [
      ['723', 0],
      ['724', 90],
      ['725', 180],
      ['726', 390],
    ],
  },
  {
    route: 'A',
    dir: 'N',
    track: '3',
    stops: [
      ['A31', 0],
      ['A28', 180],
      ['A27', 270],
      ['A24', 450],
      ['A15', 930],
    ],
  },
  {
    route: 'A',
    dir: 'S',
    track: '2',
    stops: [
      ['A15', 0],
      ['A24', 480],
      ['A27', 690],
      ['A28', 750],
      ['A31', 900],
    ],
  },
  {
    route: 'C',
    dir: 'N',
    track: '4',
    stops: [
      ['A30', 0],
      ['A28', 120],
      ['A27', 180],
      ['A25', 270],
      ['A24', 390],
    ],
  },
  {
    route: 'C',
    dir: 'S',
    track: '1',
    stops: [
      ['A24', 0],
      ['A25', 120],
      ['A27', 240],
      ['A28', 300],
      ['A30', 390],
    ],
  },
  {
    route: 'E',
    dir: 'N',
    track: '4',
    stops: [
      ['A30', 0],
      ['A28', 120],
      ['A27', 180],
      ['A25', 300],
      ['D14', 390],
    ],
  },
  {
    route: 'E',
    dir: 'S',
    track: '1',
    stops: [
      ['D14', 0],
      ['A25', 90],
      ['A27', 390],
      ['A28', 450],
      ['A30', 540],
    ],
  },
  // The shuttle terminates at Times Sq northbound and starts there southbound.
  {
    route: 'GS',
    dir: 'N',
    track: '1',
    stops: [
      ['901', 0],
      ['902', 90],
    ],
  },
  {
    route: 'GS',
    dir: 'S',
    track: '1',
    stops: [
      ['902', 0],
      ['901', 90],
    ],
  },
  {
    route: 'N',
    dir: 'N',
    track: '4',
    stops: [
      ['R18', 0],
      ['R17', 60],
      ['R16', 150],
      ['R15', 240],
      ['R14', 330],
    ],
  },
  {
    route: 'N',
    dir: 'S',
    track: '1',
    stops: [
      ['R14', 0],
      ['R15', 180],
      ['R16', 270],
      ['R17', 360],
      ['R18', 420],
    ],
  },
  {
    route: 'Q',
    dir: 'N',
    track: '3',
    stops: [
      ['R20', 0],
      ['R17', 150],
      ['R16', 240],
      ['R14', 390],
      ['B08', 540],
    ],
  },
  {
    route: 'Q',
    dir: 'S',
    track: '2',
    stops: [
      ['B08', 0],
      ['R14', 180],
      ['R16', 330],
      ['R17', 420],
      ['R20', 570],
    ],
  },
  {
    route: 'R',
    dir: 'N',
    track: '4',
    stops: [
      ['R18', 0],
      ['R17', 60],
      ['R16', 150],
      ['R15', 240],
      ['R14', 360],
    ],
  },
  {
    route: 'R',
    dir: 'S',
    track: '1',
    stops: [
      ['R14', 0],
      ['R15', 90],
      ['R16', 180],
      ['R17', 300],
      ['R18', 360],
    ],
  },
  {
    route: 'W',
    dir: 'N',
    track: '4',
    stops: [
      ['R18', 0],
      ['R17', 60],
      ['R16', 150],
      ['R15', 270],
      ['R14', 390],
    ],
  },
  {
    route: 'W',
    dir: 'S',
    track: '1',
    stops: [
      ['R14', 0],
      ['R15', 90],
      ['R16', 180],
      ['R17', 300],
      ['R18', 360],
    ],
  },
];

/** Deterministic noise in [0, 1). */
function noise(...parts: Array<string | number>) {
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

interface Trip {
  id: string;
  pattern: (typeof PATTERNS)[number];
  arrivals: number[];
  dwells: number[];
}

const trips: Trip[] = PATTERNS.flatMap((pattern) =>
  Array.from({ length: 22 }, (_, n) => {
    const id = `${pattern.route}_${pattern.dir}_${n}`;
    const start = START - 900 + n * HEADWAY_SECONDS + Math.floor(noise(id, 'jitter') * 40);
    return {
      id,
      pattern,
      arrivals: pattern.stops.map(([, rel]) => start + rel),
      dwells: pattern.stops.map((_, i) => 20 + Math.floor(noise(id, i, 'dwell') * 20)),
    };
  }),
);

/**
 * One poll of a feed that behaves like the MTA's: predictions drift, an arrived stop usually drops out of the trip
 * update, the stopped vehicle is sometimes missing, a fifth of trips are reassigned a new ID partway through, some
 * trips only report tracks later, and any trip can miss its track for a poll.
 */
function poll(now: number): { feed: transit_realtime.IFeedMessage; tracks: TrackIndex } {
  const k = Math.round((now - START) / POLL_SECONDS);
  const entity: transit_realtime.IFeedEntity[] = [];
  const tracks: TrackIndex = new Map();
  for (const trip of trips) {
    const { route, dir, track, stops: pattern } = trip.pattern;
    const delay = Math.round(20 * Math.sin(k * 0.45 + noise(trip.id, 'phase') * 6.28) + (noise(trip.id, k) - 0.5) * 24);
    const stops = trip.arrivals.map((t, i) => ({ stopId: `${pattern[i][0]}${dir}`, arr: t + delay, dep: t + delay + trip.dwells[i] }));
    const upcoming = stops.findIndex((s) => s.arr > now);
    const last = stops[stops.length - 1];
    if (upcoming < 0 && last.arr <= now) continue;
    if (upcoming >= 0 && stops[upcoming].arr - now > 15 * 60) continue;
    const next = upcoming < 0 ? stops.length : upcoming;
    const dwelling = next > 0 && stops[next - 1].dep > now && next < stops.length ? next - 1 : -1;
    const from = dwelling >= 0 && noise(trip.id, k, 'keep') < 0.35 ? dwelling : next;
    if (from >= stops.length) continue;
    const reassignAt =
      noise(trip.id, 'reassign') < 0.2
        ? Math.floor((trip.arrivals[0] - START) / POLL_SECONDS) + 2 + Math.floor(noise(trip.id, 'when') * 12)
        : Infinity;
    const tripId = k >= reassignAt ? `${trip.id}_R` : trip.id;
    const listed = stops.slice(from);
    entity.push({
      id: tripId,
      tripUpdate: {
        trip: { tripId, routeId: route },
        stopTimeUpdate: listed.map((s) => ({ stopId: s.stopId, arrival: { time: s.arr }, departure: { time: s.dep } })),
      },
    });
    if (dwelling >= 0 && noise(trip.id, k, 'vehicle') < 0.7) {
      entity.push({
        id: `${tripId}_v`,
        vehicle: {
          trip: { tripId, routeId: route },
          currentStatus: transit_realtime.VehiclePosition.VehicleStopStatus.STOPPED_AT,
          stopId: stops[dwelling].stopId,
        },
      });
    }
    const tracksFrom = noise(trip.id, 'late') < 0.3 ? Math.floor((trip.arrivals[0] - START) / POLL_SECONDS) + 8 : -Infinity;
    if (k >= tracksFrom && noise(trip.id, k, 'miss') > 0.12)
      tracks.set(tripId, new Map(listed.map((s) => [s.stopId, { scheduled: track }])));
  }
  return { feed: { header: { gtfsRealtimeVersion: '2.0', timestamp: now }, entity }, tracks };
}

const LANDED = new Set(['touchdown', 'on-pad']);
const LAUNCHING = new Set(['ignition', 'liftoff', 'climb-out']);
const ON_SCREEN_LANDING = new Set(['landing-burn', 'touchdown', 'on-pad']);

/**
 * Plays the polls through the server estimate, the client fleet, and the Times Sq close-up's booster slots (refreshed
 * like the scene: on every new fleet and every REFRESH_SECONDS), sampling what each slot draws and each map rocket's
 * pose. Returns every observed cut as a readable line.
 */
function simulate(polls: number) {
  let fleet: Fleet = EMPTY_FLEET;
  const slots: Array<Shown | null> = [];
  const pose: PadPose = createPose();
  const mapPose = createMapPose();
  const drawn = new Map<string, { t: number; phase: string; site: string }>();
  const onMap = new Map<string, { t: number; state: 'pad' | 'flight' | 'hold' | 'hidden'; station: string }>();
  const problems: string[] = [];
  let maxActive = 0;
  let landings = 0;
  let refreshedAt = -Infinity;
  const terminal = { landed: new Map<string, number>(), launched: new Set<string>() };
  const at = (t: number) => `+${(t - START).toFixed(2)}s`;

  for (let k = 0; k < polls; k++) {
    const now = START + k * POLL_SECONDS;
    const { feed, tracks } = poll(now);
    fleet = reconcileFleet(fleet, estimateTrainPositions([feed], now, tracks), now);
    const { sites } = layoutSites(TIMES_SQ, fleet);
    const live = liveShown(fleet, new Map(sites.map((s, i) => [s.berth, i])));
    const placed = placeRockets(fleet).filter((p) => p.rocket.visits.some((v) => TIMES_SQ.stationIds.includes(v.station)));
    refreshedAt = -Infinity;

    for (let t = now; t < now + POLL_SECONDS; t += SAMPLE_SECONDS) {
      if (t - refreshedAt >= REFRESH_SECONDS) {
        refreshedAt = t;
        const active = assignSlots(slots, live, t);
        maxActive = Math.max(maxActive, active.length);
        const slotted = new Set(slots.map((s) => s?.key));
        for (const s of active) {
          const phase = padPose(t, s, pose).phase;
          if (ON_SCREEN_LANDING.has(phase) && !slotted.has(s.key)) problems.push(`${at(t)} ${s.key} is ${phase} with no booster drawn`);
        }
      }

      const seen = new Set<string>();
      for (const s of slots) {
        if (!s) continue;
        padPose(t, s, pose);
        if (!pose.visible || !sites[s.site]) continue;
        seen.add(s.key);
        const before = drawn.get(s.key);
        if (before && LANDED.has(before.phase) && pose.phase === 'touchdown' && before.phase === 'on-pad')
          problems.push(`${at(t)} ${s.key} landed again`);
        if (before && LANDED.has(before.phase) && LANDED.has(pose.phase) && before.site !== sites[s.site].berth)
          problems.push(`${at(t)} ${s.key} moved from ${before.site} to ${sites[s.site].berth} while on the pad`);
        if ((!before || !LANDED.has(before.phase)) && LANDED.has(pose.phase)) landings++;
        if (s.key.startsWith('GS_N') && s.visit.station === '902') {
          if (LANDED.has(pose.phase) && !terminal.landed.has(s.key)) terminal.landed.set(s.key, t);
          if (LAUNCHING.has(pose.phase)) terminal.launched.add(s.key);
        }
        drawn.set(s.key, { t, phase: pose.phase, site: sites[s.site].berth });
      }
      for (const [key, before] of drawn) {
        if (seen.has(key)) continue;
        if (LANDED.has(before.phase)) problems.push(`${at(t)} close-up: ${key} vanished while ${before.phase} at ${before.site}`);
        drawn.delete(key);
      }

      for (const p of placed) {
        rocketPose(p, t, mapPose);
        const state = !mapPose.visible ? 'hidden' : mapPose.flying ? 'flight' : mapPose.holding ? 'hold' : 'pad';
        const before = onMap.get(p.rocket.id);
        if (before?.state === 'pad' && TIMES_SQ.stationIds.includes(before.station) && state === 'hidden')
          problems.push(`${at(t)} map: ${p.rocket.id} vanished from its pad at ${before.station}`);
        onMap.set(p.rocket.id, { t, state, station: mapPose.station });
      }
    }
  }
  const end = START + polls * POLL_SECONDS;
  const terminalLandings = [...terminal.landed].filter(([, t]) => t < end - 120).map(([key]) => key);
  return { problems, maxActive, landings, terminalLandings, terminalLaunches: terminal.launched };
}

describe('a busy complex (Times Sq at rush hour)', () => {
  const { problems, maxActive, landings, terminalLandings, terminalLaunches } = simulate(50);

  it('has more concurrent visits than the close-up used to have boosters, and many landings', () => {
    expect(maxActive).toBeGreaterThan(BOOSTERS);
    expect(landings).toBeGreaterThan(150);
  });

  it('keeps every landed rocket on its pad, drawn, until it launches: in the close-up and on the map', () => {
    expect(problems).toEqual([]);
  });

  it('lifts off a rocket whose train ends its trip here (the shuttle at 902) instead of dropping it', () => {
    expect(terminalLandings.length).toBeGreaterThan(5);
    expect(terminalLandings.filter((key) => !terminalLaunches.has(key))).toEqual([]);
  });
});
