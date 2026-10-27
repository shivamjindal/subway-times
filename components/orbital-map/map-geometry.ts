import geometryData from '@/lib/subway-map-geometry.json';
import { getPad } from '@/lib/spaceports';
import { getAllStations, getRouteColor } from '@/lib/subway-data';
import { rocketState, type Fleet, type Rocket } from './rocket-timeline';

interface MapGeometry {
  origin: [number, number];
  routes: Record<string, string[]>;
  segments: Record<string, number[]>;
}

const geometry = geometryData as unknown as MapGeometry;

// Scene units are kilometres on a local equirectangular projection; +x east, -z north.
const KM_PER_DEG_LON = (111320 * Math.cos((geometry.origin[0] * Math.PI) / 180)) / 1000;
const KM_PER_DEG_LAT = 110574 / 1000;

export function project(lat: number, lon: number): [number, number] {
  return [(lon - geometry.origin[1]) * KM_PER_DEG_LON, -(lat - geometry.origin[0]) * KM_PER_DEG_LAT];
}

export interface MapStation {
  id: string;
  name: string;
  x: number;
  z: number;
  routeIds: string[];
}

export const MAP_STATIONS: MapStation[] = getAllStations().map(({ station, routes }) => {
  const [x, z] = project(station.lat, station.lon);
  return { id: station.stopId, name: station.name, x, z, routeIds: routes.map((r) => r.routeId) };
});

const stationById = new Map(MAP_STATIONS.map((s) => [s.id, s]));

export function getMapStation(id: string): MapStation | undefined {
  return stationById.get(id);
}

export interface RouteLine {
  routeId: string;
  color: string;
  /** Flat xyz pairs for LineSegments: [ax, ay, az, bx, by, bz, ...] */
  points: number[];
}

export const ROUTE_LINES: RouteLine[] = Object.entries(geometry.routes).map(([routeId, keys]) => {
  const points: number[] = [];
  for (const key of keys) {
    const seg = geometry.segments[key];
    for (let i = 2; i < seg.length; i += 2) {
      points.push(seg[i - 2] / 1000, 0, seg[i - 1] / 1000, seg[i] / 1000, 0, seg[i + 1] / 1000);
    }
  }
  return { routeId, color: `#${getRouteColor(routeId)}`, points };
});

/** Polyline in scene units from one station to the next, with cumulative arc lengths for interpolation. */
export interface Track {
  xs: Float32Array;
  zs: Float32Array;
  lengths: Float32Array;
}

function segmentPath(from: MapStation, to: MapStation): Track {
  const key = from.id < to.id ? `${from.id}~${to.id}` : `${to.id}~${from.id}`;
  const flat = geometry.segments[key];
  const coords = flat ? Array.from(flat, (v) => v / 1000) : [from.x, from.z, to.x, to.z];
  const count = coords.length / 2;
  const reversed = flat !== undefined && from.id > to.id;
  const xs = new Float32Array(count);
  const zs = new Float32Array(count);
  const lengths = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const j = reversed ? count - 1 - i : i;
    xs[i] = coords[j * 2];
    zs[i] = coords[j * 2 + 1];
    lengths[i] = i === 0 ? 0 : lengths[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  return { xs, zs, lengths };
}

/** Pad cluster around a station node, in km: N platforms on the north side, S on the south, tracks spread across. */
const PAD_RING_KM = 0.06;
const BERTH_SPREAD_KM = 0.04;
/** A held rocket hovers this high, offset outward from its berth so it doesn't hide the occupant. */
export const HOLD_HEIGHT = 0.1;
const HOLD_OFFSET_KM = 0.035;

export function berthPosition(fleet: Fleet, station: MapStation, pad: string, berth: string): [number, number] {
  const berths = fleet.berths.get(pad) ?? [pad];
  const k = Math.max(0, berths.indexOf(berth));
  const side = pad.endsWith('N') ? -1 : 1;
  return [station.x + (k - (berths.length - 1) / 2) * BERTH_SPREAD_KM, station.z + side * PAD_RING_KM];
}

/** Every berth around every map station, for the pad markers. */
export function mapBerths(fleet: Fleet): Array<{ x: number; z: number; pad: string }> {
  const out: Array<{ x: number; z: number; pad: string }> = [];
  for (const station of MAP_STATIONS) {
    for (const direction of ['N', 'S'] as const) {
      const pad = `${station.id}${direction}`;
      if (!getPad(pad) && !fleet.berths.has(pad)) continue;
      for (const berth of fleet.berths.get(pad) ?? [pad]) {
        const [x, z] = berthPosition(fleet, station, pad, berth);
        out.push({ x, z, pad });
      }
    }
  }
  return out;
}

export interface PlacedRocket {
  rocket: Rocket;
  /** Berth position of each visit. */
  spots: Array<[number, number]>;
  /** Hover position over each visit's berth while holding. */
  holds: Array<[number, number]>;
  /** Ground track of each leg: legs[i] runs from visit i to visit i + 1. */
  legs: Array<Track | null>;
  /** Apex height of each leg's arc, in scene units. */
  apex: number[];
}

function trackBetween(fromId: string, toId: string): Track | null {
  if (fromId === toId) return null;
  const from = stationById.get(fromId);
  const to = stationById.get(toId);
  return from && to ? segmentPath(from, to) : null;
}

const apexFor = (track: Track | null) =>
  track ? Math.min(0.9, Math.max(0.18, track.lengths[track.lengths.length - 1] * 0.35)) : 0;

export function placeRockets(fleet: Fleet): PlacedRocket[] {
  return fleet.rockets.flatMap((rocket) => {
    const stations = rocket.visits.map((v) => stationById.get(v.station));
    if (stations.some((s) => !s)) return [];
    const spots = rocket.visits.map((v, i) => berthPosition(fleet, stations[i]!, v.pad, v.berth));
    const holds = spots.map(([x, z], i): [number, number] => {
      const station = stations[i]!;
      const dx = x - station.x;
      const dz = z - station.z;
      const n = Math.hypot(dx, dz) || 1;
      return [x + (dx / n) * HOLD_OFFSET_KM, z + (dz / n) * HOLD_OFFSET_KM];
    });
    const legs = rocket.visits.slice(1).map((v, i) => trackBetween(rocket.visits[i].station, v.station));
    return [{ rocket, spots, holds, legs, apex: legs.map(apexFor) }];
  });
}

export interface RocketPose {
  x: number;
  y: number;
  z: number;
  /** Unit heading; (0, 1, 0) when standing on a pad or holding. */
  dx: number;
  dy: number;
  dz: number;
  visible: boolean;
  flying: boolean;
  holding: boolean;
  progress: number;
  station: string;
  secondsToTouchdown: number;
}

export function createPose(): RocketPose {
  return {
    x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0,
    visible: false, flying: false, holding: false, progress: 0, station: '', secondsToTouchdown: Infinity,
  };
}

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Writes the rocket's ballistic-arc position and heading at `now` into `out`. `progressLag` samples a point behind it (trails). */
export function rocketPose(placed: PlacedRocket, now: number, out: RocketPose, progressLag = 0): RocketPose {
  const state = rocketState(placed.rocket, now);
  const visit = placed.rocket.visits[state.visit];
  out.station = state.station;
  out.secondsToTouchdown = state.secondsToTouchdown;
  out.visible = state.phase !== 'offstage';
  out.flying = false;
  out.holding = false;
  out.progress = 0;
  out.dx = 0;
  out.dy = 1;
  out.dz = 0;
  const [sx, sz] = placed.spots[state.visit];
  const held = visit.landAt > visit.arriveAt;
  const track = state.phase === 'flight' ? placed.legs[state.visit - 1] : null;

  if (state.phase === 'hold') {
    // Hover beside the berth, then drop onto it over the last 1.5 s once it clears.
    const [hx, hz] = placed.holds[state.visit];
    const drop = 1 - smoothstep((visit.landAt - now) / 1.5);
    out.x = hx + (sx - hx) * drop;
    out.z = hz + (sz - hz) * drop;
    out.y = HOLD_HEIGHT * (1 - drop);
    out.holding = true;
    return out;
  }
  if (state.phase !== 'flight' || !track) {
    out.x = sx;
    out.y = 0;
    out.z = sz;
    return out;
  }

  // Ends of the leg sit on the berths (or the hover point), not the station node.
  const [ax, az] = placed.spots[state.visit - 1];
  const from = stationById.get(placed.rocket.visits[state.visit - 1].station)!;
  const to = stationById.get(visit.station)!;
  const [ex, ez] = held ? placed.holds[state.visit] : placed.spots[state.visit];
  const endY = held ? HOLD_HEIGHT : 0;
  const p = Math.max(0, state.progress - progressLag);
  const apex = placed.apex[state.visit - 1];
  const at = (q: number, target: [number, number, number]) => {
    const [x, z] = pointOnTrack(track, q);
    target[0] = x + (ax - from.x) * (1 - q) + (ex - to.x) * q;
    target[1] = apex * 4 * q * (1 - q) + endY * q;
    target[2] = z + (az - from.z) * (1 - q) + (ez - to.z) * q;
  };
  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [0, 0, 0];
  at(p, a);
  at(Math.min(1, p + 0.01), b);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
  // Rockets stand up for liftoff and touchdown: blend the arc heading toward vertical near either pad.
  const vertical = Math.max(0, 1 - Math.min(p, 1 - p) / 0.08);
  const dx = ((b[0] - a[0]) / len) * (1 - vertical);
  const dz = ((b[2] - a[2]) / len) * (1 - vertical);
  const dy = ((b[1] - a[1]) / len) * (1 - vertical) + (p < 0.5 ? 1 : -1) * vertical;
  const n = Math.hypot(dx, dy, dz) || 1;
  out.x = a[0];
  out.y = a[1];
  out.z = a[2];
  out.dx = dx / n;
  out.dy = dy / n;
  out.dz = dz / n;
  out.flying = true;
  out.progress = p;
  return out;
}

export function pointOnTrack(track: Track, progress: number): [number, number] {
  const { xs, zs, lengths } = track;
  const last = lengths.length - 1;
  if (last <= 0) return [xs[0], zs[0]];
  const target = progress * lengths[last];
  let i = 1;
  while (i < last && lengths[i] < target) i++;
  const span = lengths[i] - lengths[i - 1] || 1;
  const t = (target - lengths[i - 1]) / span;
  return [xs[i - 1] + (xs[i] - xs[i - 1]) * t, zs[i - 1] + (zs[i] - zs[i - 1]) * t];
}
