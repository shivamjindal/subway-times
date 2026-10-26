import geometryData from '@/lib/subway-map-geometry.json';
import { getAllStations, getRouteColor } from '@/lib/subway-data';
import type { EstimatedTrain } from '@/lib/train-positions';
import { rocketState } from './rocket-timeline';

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

export interface PlacedRocket {
  train: EstimatedTrain;
  /** Ground tracks for leg 0 (from→to) and leg 1 (to→next). */
  legs: [Track | null, Track | null];
  /** Apex height of each leg's arc, in scene units. */
  apex: [number, number];
}

function trackBetween(fromId: string, toId: string | undefined): Track | null {
  if (!toId || fromId === toId) return null;
  const from = stationById.get(fromId);
  const to = stationById.get(toId);
  return from && to ? segmentPath(from, to) : null;
}

const apexFor = (track: Track | null) =>
  track ? Math.min(0.9, Math.max(0.18, track.lengths[track.lengths.length - 1] * 0.35)) : 0;

export function placeRockets(trains: EstimatedTrain[]): PlacedRocket[] {
  return trains.flatMap((train) => {
    if (!stationById.has(train.to)) return [];
    const legs: [Track | null, Track | null] = [trackBetween(train.from, train.to), trackBetween(train.to, train.next)];
    return [{ train, legs, apex: [apexFor(legs[0]), apexFor(legs[1])] }];
  });
}

export interface RocketPose {
  x: number;
  y: number;
  z: number;
  /** Unit heading; (0, 1, 0) when standing on a pad. */
  dx: number;
  dy: number;
  dz: number;
  flying: boolean;
  progress: number;
  station: string;
  secondsToTouchdown: number;
}

export function createPose(): RocketPose {
  return { x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0, flying: false, progress: 0, station: '', secondsToTouchdown: Infinity };
}

/** Writes the rocket's ballistic-arc position and heading at `now` into `out`. `progressLag` samples a point behind it (trails). */
export function rocketPose(rocket: PlacedRocket, now: number, out: RocketPose, progressLag = 0): RocketPose {
  const state = rocketState(rocket.train, now);
  const track = rocket.legs[state.leg];
  out.station = state.station;
  out.secondsToTouchdown = state.secondsToTouchdown;
  if (state.phase === 'pad' || !track) {
    const pad = stationById.get(state.station) ?? stationById.get(rocket.train.to)!;
    out.x = pad.x;
    out.y = 0;
    out.z = pad.z;
    out.dx = 0;
    out.dy = 1;
    out.dz = 0;
    out.flying = false;
    out.progress = 0;
    return out;
  }
  const p = Math.max(0, state.progress - progressLag);
  const apex = rocket.apex[state.leg];
  const [x, z] = pointOnTrack(track, p);
  const p2 = Math.min(1, p + 0.01);
  const [x2, z2] = pointOnTrack(track, p2);
  const y = apex * 4 * p * (1 - p);
  const y2 = apex * 4 * p2 * (1 - p2);
  const len = Math.hypot(x2 - x, y2 - y, z2 - z) || 1;
  // Rockets stand up for liftoff and touchdown: blend the arc heading toward vertical near either pad.
  const vertical = Math.max(0, 1 - Math.min(p, 1 - p) / 0.08);
  const dx = ((x2 - x) / len) * (1 - vertical);
  const dz = ((z2 - z) / len) * (1 - vertical);
  const dy = ((y2 - y) / len) * (1 - vertical) + (p < 0.5 ? 1 : -1) * vertical;
  const n = Math.hypot(dx, dy, dz) || 1;
  out.x = x;
  out.y = y;
  out.z = z;
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
