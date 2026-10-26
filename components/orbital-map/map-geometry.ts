import geometryData from '@/lib/subway-map-geometry.json';
import { getAllStations, getRouteColor } from '@/lib/subway-data';
import type { EstimatedTrain } from '@/lib/train-positions';

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

export interface PlacedTrain {
  train: EstimatedTrain;
  track: Track;
}

export function placeTrains(trains: EstimatedTrain[]): PlacedTrain[] {
  return trains.flatMap((train) => {
    const from = stationById.get(train.from);
    const to = stationById.get(train.to);
    if (!from || !to) return [];
    return [{ train, track: segmentPath(from, to) }];
  });
}

export function trainProgress(train: EstimatedTrain, nowSeconds: number): number {
  const span = train.arrivesAt - train.departedAt;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (nowSeconds - train.departedAt) / span));
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
