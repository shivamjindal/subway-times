#!/usr/bin/env node
// Preprocesses static GTFS (gtfs_subway/) into the compact files used by the orbital map:
//   lib/subway-map-geometry.json  – per-route station-to-station polylines (client, lazy-loaded)
//   lib/subway-map-topology.json  – previous-station lookup + scheduled segment durations (server)
// Usage: node scripts/build-subway-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GTFS = path.join(ROOT, 'gtfs_subway');
const OUT_GEOMETRY = path.join(ROOT, 'lib', 'subway-map-geometry.json');
const OUT_TOPOLOGY = path.join(ROOT, 'lib', 'subway-map-topology.json');

// Douglas-Peucker tolerance in meters; ~6 m keeps curves smooth at city scale.
const SIMPLIFY_TOLERANCE_M = 6;
// Patterns seen on fewer trips than this are reroutes/one-offs and would clutter the map.
const MIN_PATTERN_TRIPS = 4;

function parseLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function readCsv(file) {
  const lines = fs.readFileSync(path.join(GTFS, file), 'utf8').trim().split(/\r?\n/);
  const header = parseLine(lines[0]);
  return lines.slice(1).map((l) => {
    const v = parseLine(l);
    return Object.fromEntries(header.map((h, i) => [h, v[i] ?? '']));
  });
}

function toSeconds(hms) {
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

const stationCoords = new Map();
for (const s of readCsv('stops.txt')) {
  if (s.location_type === '1') {
    stationCoords.set(s.stop_id, [Number(s.stop_lat), Number(s.stop_lon)]);
  }
}

let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
for (const [lat, lon] of stationCoords.values()) {
  minLat = Math.min(minLat, lat);
  maxLat = Math.max(maxLat, lat);
  minLon = Math.min(minLon, lon);
  maxLon = Math.max(maxLon, lon);
}
const origin = [
  Number(((minLat + maxLat) / 2).toFixed(4)),
  Number(((minLon + maxLon) / 2).toFixed(4)),
];
const KX = 111320 * Math.cos((origin[0] * Math.PI) / 180);
const KZ = 110574;
const project = (lat, lon) => [(lon - origin[1]) * KX, -(lat - origin[0]) * KZ];

const shapes = new Map();
for (const row of readCsv('shapes.txt')) {
  if (!shapes.has(row.shape_id)) shapes.set(row.shape_id, []);
  shapes.get(row.shape_id).push([Number(row.shape_pt_sequence), project(Number(row.shape_pt_lat), Number(row.shape_pt_lon))]);
}
for (const [id, pts] of shapes) {
  shapes.set(id, pts.sort((a, b) => a[0] - b[0]).map((p) => p[1]));
}

const trips = new Map();
for (const t of readCsv('trips.txt')) {
  trips.set(t.trip_id, { routeId: t.route_id, shapeId: t.shape_id });
}

// pattern key -> { routeId, direction, stations, count, shapeId }
const patterns = new Map();
// "a>b" -> scheduled durations (seconds)
const durations = new Map();

function flushTrip(tripId, stops) {
  const trip = trips.get(tripId);
  if (!trip || stops.length < 2) return;
  const direction = stops[0].stopId.slice(-1);
  const stations = stops.map((s) => s.stopId.slice(0, -1));
  const key = `${trip.routeId}|${direction}|${stations.join(',')}`;
  const existing = patterns.get(key);
  if (existing) {
    existing.count++;
    if (!existing.shapeId && trip.shapeId && shapes.has(trip.shapeId)) existing.shapeId = trip.shapeId;
  } else {
    patterns.set(key, {
      routeId: trip.routeId,
      direction,
      stations,
      count: 1,
      shapeId: shapes.has(trip.shapeId) ? trip.shapeId : '',
    });
  }
  for (let i = 1; i < stops.length; i++) {
    const k = `${stations[i - 1]}>${stations[i]}`;
    const d = stops[i].arr - stops[i - 1].dep;
    if (d <= 0) continue;
    if (!durations.has(k)) durations.set(k, []);
    durations.get(k).push(d);
  }
}

const rl = readline.createInterface({ input: fs.createReadStream(path.join(GTFS, 'stop_times.txt')) });
let header = null;
let currentTrip = null;
let currentStops = [];
for await (const line of rl) {
  if (!header) {
    header = parseLine(line);
    continue;
  }
  const v = parseLine(line);
  const row = Object.fromEntries(header.map((h, i) => [h, v[i]]));
  if (row.trip_id !== currentTrip) {
    if (currentTrip) flushTrip(currentTrip, currentStops);
    currentTrip = row.trip_id;
    currentStops = [];
  }
  currentStops.push({ stopId: row.stop_id, arr: toSeconds(row.arrival_time), dep: toSeconds(row.departure_time) });
}
if (currentTrip) flushTrip(currentTrip, currentStops);

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

function simplify(points, tol) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, az] = points[s];
    const [bx, bz] = points[e];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, pz] = points[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
      const d = Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const segmentKey = (a, b) => (a < b ? `${a}~${b}` : `${b}~${a}`);
const segments = new Map();
const routeSegments = new Map();
const prevCounts = new Map();

const sortedPatterns = [...patterns.values()].sort((a, b) => b.count - a.count);
for (const p of sortedPatterns) {
  if (p.count < MIN_PATTERN_TRIPS) continue;
  if (p.stations.some((s) => !stationCoords.has(s))) continue;

  for (let i = 1; i < p.stations.length; i++) {
    const k = `${p.routeId}|${p.direction}|${p.stations[i]}`;
    if (!prevCounts.has(k)) prevCounts.set(k, new Map());
    const m = prevCounts.get(k);
    m.set(p.stations[i - 1], (m.get(p.stations[i - 1]) ?? 0) + p.count);
  }

  const shape = p.shapeId ? shapes.get(p.shapeId) : null;
  const stationPts = p.stations.map((s) => project(...stationCoords.get(s)));
  // Monotonic projection of each stop onto the shape so loops/parallel tracks can't pull a stop backwards.
  let indices = null;
  if (shape) {
    indices = [];
    let from = 0;
    for (const sp of stationPts) {
      let best = from, bestD = Infinity;
      for (let j = from; j < shape.length; j++) {
        const d = dist2(shape[j], sp);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      indices.push(best);
      from = best;
    }
  }

  if (!routeSegments.has(p.routeId)) routeSegments.set(p.routeId, new Set());
  for (let i = 1; i < p.stations.length; i++) {
    const a = p.stations[i - 1], b = p.stations[i];
    const key = segmentKey(a, b);
    routeSegments.get(p.routeId).add(key);
    if (segments.has(key)) continue;
    let pts = [stationPts[i - 1], ...(indices ? shape.slice(indices[i - 1] + 1, indices[i]) : []), stationPts[i]];
    if (a > b) pts = pts.reverse();
    segments.set(key, simplify(pts, SIMPLIFY_TOLERANCE_M));
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const geometry = {
  origin,
  routes: Object.fromEntries([...routeSegments].sort(([a], [b]) => a.localeCompare(b)).map(([r, set]) => [r, [...set].sort()])),
  segments: Object.fromEntries(
    [...segments].sort(([a], [b]) => a.localeCompare(b)).map(([k, pts]) => [k, pts.flatMap(([x, z]) => [Math.round(x), Math.round(z)])])
  ),
};

const topology = {
  prev: Object.fromEntries(
    [...prevCounts].sort(([a], [b]) => a.localeCompare(b)).map(([k, m]) => [k, [...m].sort((x, y) => y[1] - x[1])[0][0]])
  ),
  seconds: Object.fromEntries(
    [...durations].sort(([a], [b]) => a.localeCompare(b)).map(([k, ds]) => [k, median(ds)])
  ),
};

fs.writeFileSync(OUT_GEOMETRY, JSON.stringify(geometry));
fs.writeFileSync(OUT_TOPOLOGY, JSON.stringify(topology));

const pointCount = Object.values(geometry.segments).reduce((n, pts) => n + pts.length / 2, 0);
console.log(
  `routes=${Object.keys(geometry.routes).length} segments=${segments.size} points=${pointCount} ` +
    `geometry=${(fs.statSync(OUT_GEOMETRY).size / 1024).toFixed(0)}KB topology=${(fs.statSync(OUT_TOPOLOGY).size / 1024).toFixed(0)}KB`
);
