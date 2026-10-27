#!/usr/bin/env node
// Preprocesses static GTFS (gtfs_subway/) into the compact files used by the orbital map:
//   lib/subway-map-geometry.json  – per-route station-to-station polylines (client, lazy-loaded)
//   lib/subway-map-topology.json  – previous-station lookup + scheduled segment durations (server)
//   lib/spaceports.json           – station complexes and their pads (one per platform)
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

// --- Spaceports: station complexes (transfer groups) and their pads (one per platform: stop ID + direction).

const stationNames = new Map(readCsv('stops.txt').filter((s) => s.location_type === '1').map((s) => [s.stop_id, s.stop_name]));

const complexOf = new Map([...stationCoords.keys()].map((id) => [id, id]));
const findComplex = (id) => {
  while (complexOf.get(id) !== id) id = complexOf.get(id);
  return id;
};
for (const t of readCsv('transfers.txt')) {
  if (t.from_stop_id === t.to_stop_id || !stationCoords.has(t.from_stop_id) || !stationCoords.has(t.to_stop_id)) continue;
  const [a, b] = [findComplex(t.from_stop_id), findComplex(t.to_stop_id)].sort();
  if (a !== b) complexOf.set(b, a);
}

// Rough outline of Manhattan island (lat, lon), enough to tell "Manhattan-bound" from "to <terminal>".
const MANHATTAN = [
  [40.7, -74.02], [40.712, -74.017], [40.74, -74.012], [40.76, -74.003], [40.79, -73.985], [40.82, -73.962],
  [40.85, -73.947], [40.873, -73.93], [40.88, -73.925], [40.875, -73.91], [40.865, -73.912], [40.845, -73.928],
  [40.826, -73.933], [40.81, -73.932], [40.8, -73.928], [40.787, -73.936], [40.775, -73.943], [40.76, -73.957],
  [40.745, -73.969], [40.73, -73.972], [40.715, -73.976], [40.71, -73.992], [40.704, -74.005], [40.7, -74.012],
];
function inManhattan(stationId) {
  const [lat, lon] = stationCoords.get(stationId);
  let inside = false;
  for (let i = 0, j = MANHATTAN.length - 1; i < MANHATTAN.length; j = i++) {
    const [yi, xi] = MANHATTAN[i];
    const [yj, xj] = MANHATTAN[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Manhattan's street grid runs ~29° east of true north; "uptown" is along that axis.
const GRID_ANGLE = (29 * Math.PI) / 180;
function uptownComponent(fromId, toId) {
  const [ax, az] = project(...stationCoords.get(fromId));
  const [bx, bz] = project(...stationCoords.get(toId));
  const east = bx - ax;
  const north = az - bz;
  return {
    along: north * Math.cos(GRID_ANGLE) + east * Math.sin(GRID_ANGLE),
    across: east * Math.cos(GRID_ANGLE) - north * Math.sin(GRID_ANGLE),
  };
}

const displayRoute = (routeId) => (['GS', 'FS', 'H'].includes(routeId) ? 'S' : routeId.replace(/X$/, ''));

// pad stop ID -> { routes: Map<routeId, trips>, votes: Map<label, trips> }
const padStats = new Map();
for (const p of sortedPatterns) {
  if (p.count < MIN_PATTERN_TRIPS || p.stations.some((s) => !stationCoords.has(s))) continue;
  const terminal = stationNames.get(p.stations[p.stations.length - 1]);
  p.stations.forEach((station, i) => {
    const padId = `${station}${p.direction}`;
    if (!padStats.has(padId)) padStats.set(padId, { station, direction: p.direction, routes: new Map(), votes: new Map() });
    const stats = padStats.get(padId);
    stats.routes.set(p.routeId, (stats.routes.get(p.routeId) ?? 0) + p.count);
    const rest = p.stations.slice(i + 1);
    let label;
    if (rest.length === 0) label = 'Arrivals';
    else if (!inManhattan(station)) label = rest.some(inManhattan) ? 'Manhattan-bound' : `to ${terminal}`;
    else if (!inManhattan(rest[0])) label = `to ${terminal}`;
    else {
      // A few stops ahead, so a jog in the line (Fulton St → Park Pl) doesn't read as crosstown.
      const ahead = rest.slice(0, 3);
      const last = ahead.findIndex((s) => !inManhattan(s));
      const { along, across } = uptownComponent(station, ahead[last < 0 ? ahead.length - 1 : last - 1]);
      label = Math.abs(along) >= Math.abs(across) ? (along > 0 ? 'Uptown' : 'Downtown') : `to ${terminal}`;
    }
    stats.votes.set(label, (stats.votes.get(label) ?? 0) + p.count);
  });
}

const routeOrder = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const pads = {};
for (const [padId, stats] of [...padStats].sort(([a], [b]) => a.localeCompare(b))) {
  const routes = [...new Set([...stats.routes.keys()].map(displayRoute))].sort(routeOrder);
  const [label] = [...stats.votes].sort((a, b) => b[1] - a[1])[0];
  pads[padId] = { routes, label };
}

const members = new Map();
for (const id of stationCoords.keys()) {
  const root = findComplex(id);
  if (!members.has(root)) members.set(root, []);
  members.get(root).push(id);
}
const spaceports = [...members.values()]
  .map((ids) => ids.filter((id) => pads[`${id}N`] || pads[`${id}S`]).sort())
  .filter((ids) => ids.length > 0)
  .map((ids) => {
    const counts = new Map();
    for (const id of ids) counts.set(stationNames.get(id), (counts.get(stationNames.get(id)) ?? 0) + 1);
    const [name] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { id: ids[0], name, stations: ids };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const OUT_SPACEPORTS = path.join(ROOT, 'lib', 'spaceports.json');
fs.writeFileSync(OUT_SPACEPORTS, JSON.stringify({ spaceports, pads }));

fs.writeFileSync(OUT_GEOMETRY, JSON.stringify(geometry));
fs.writeFileSync(OUT_TOPOLOGY, JSON.stringify(topology));

const pointCount = Object.values(geometry.segments).reduce((n, pts) => n + pts.length / 2, 0);
console.log(
  `routes=${Object.keys(geometry.routes).length} segments=${segments.size} points=${pointCount} ` +
    `geometry=${(fs.statSync(OUT_GEOMETRY).size / 1024).toFixed(0)}KB topology=${(fs.statSync(OUT_TOPOLOGY).size / 1024).toFixed(0)}KB`
);
