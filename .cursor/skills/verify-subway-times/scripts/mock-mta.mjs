#!/usr/bin/env node
// Mock of api-endpoint.mta.info for offline machines and repeatable cases (rush hour).
// Serves GTFS-Realtime protobuf at the same paths as the real feed, so the app only needs
// MTA_FEED_BASE_URL=http://127.0.0.1:<port>. Trains are synthesised from the static GTFS in
// gtfs_subway/: one representative pattern per route and direction, a train every --headway
// seconds, anchored to the epoch so consecutive polls describe the same trains.
//
//   node .cursor/skills/verify-subway-times/scripts/mock-mta.mjs --port 3901 [--rush | --headway 360]
//
// GET /__health -> {"mock":true,...}; every trip ID starts with MOCK_ so doctor can tell mock from live.
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { ROUTE_TO_FEED } from '../../../../lib/mta-feeds.ts';

const { transit_realtime } = GtfsRealtimeBindings;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const GTFS = path.join(ROOT, 'gtfs_subway');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(arg('--port', process.env.MOCK_MTA_PORT ?? '3901'));
const rush = args.includes('--rush');
const headway = Number(arg('--headway', rush ? '120' : '360'));

const FEED_PATHS = {
  'nyct%2Fgtfs-ace': 'ace',
  'nyct%2Fgtfs-bdfm': 'bdfm',
  'nyct%2Fgtfs-g': 'g',
  'nyct%2Fgtfs-jz': 'jz',
  'nyct%2Fgtfs-nqrw': 'nqrw',
  'nyct%2Fgtfs-l': 'l',
  'nyct%2Fgtfs': '1234567',
  'nyct%2Fgtfs-si': 'si',
};

async function* csvRows(file) {
  const lines = createInterface({ input: createReadStream(path.join(GTFS, file)), crlfDelay: Infinity });
  let header = null;
  for await (const line of lines) {
    if (!line) continue;
    const cells = line.split(',');
    if (!header) header = cells;
    else yield Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  }
}

const toSeconds = (hms) => {
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

/** Longest weekday trip per route+direction: [{ stopId, offset }] with offsets from the first stop. */
async function loadPatterns() {
  const tripRoute = new Map();
  for await (const t of csvRows('trips.txt')) {
    if (t.service_id === 'Weekday' && ROUTE_TO_FEED[t.route_id]) tripRoute.set(t.trip_id, t.route_id);
  }
  const trips = new Map();
  for await (const st of csvRows('stop_times.txt')) {
    if (!tripRoute.has(st.trip_id)) continue;
    let stops = trips.get(st.trip_id);
    if (!stops) trips.set(st.trip_id, (stops = []));
    stops.push({ stopId: st.stop_id, time: toSeconds(st.arrival_time), seq: Number(st.stop_sequence) });
  }
  const best = new Map();
  for (const [tripId, stops] of trips) {
    const dir = stops[0].stopId.slice(-1);
    const key = `${tripRoute.get(tripId)}|${dir}`;
    if (!best.has(key) || best.get(key).length < stops.length) best.set(key, stops);
  }
  return [...best].map(([key, stops]) => {
    const [route, dir] = key.split('|');
    stops.sort((a, b) => a.seq - b.seq);
    return { route, dir, feed: ROUTE_TO_FEED[route], stops: stops.map((s) => ({ stopId: s.stopId, offset: s.time - stops[0].time })) };
  });
}

function buildFeed(patterns, feedKey, now) {
  const entity = [];
  for (const p of patterns) {
    if (p.feed !== feedKey) continue;
    const duration = p.stops.at(-1).offset;
    // Train k leaves its origin at k * headway; list it from 2 minutes before departure until it terminates.
    for (let k = Math.floor((now - duration) / headway); k * headway <= now + 120; k++) {
      const start = k * headway;
      const updates = p.stops
        .filter((s) => start + s.offset >= now - 90)
        .map((s) => ({ stopId: s.stopId, arrival: { time: start + s.offset }, departure: { time: start + s.offset } }));
      if (updates.length === 0) continue;
      const tripId = `MOCK_${p.route}_${p.dir}_${k}`;
      entity.push({
        id: tripId,
        tripUpdate: { trip: { tripId, routeId: p.route, startDate: '20261030' }, stopTimeUpdate: updates },
      });
    }
  }
  return transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '1.0', timestamp: now },
    entity,
  }).finish();
}

const patterns = await loadPatterns();
const stats = { requests: 0, lastFeedAt: null };

createServer((req, res) => {
  const url = new URL(req.url, 'http://mock');
  const now = Math.floor(Date.now() / 1000);
  if (url.pathname === '/__health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ mock: true, rush, headway, patterns: patterns.length, ...stats }));
    return;
  }
  const key = url.pathname.slice(1);
  let body;
  if (key === 'camsys%2Fsubway-alerts') {
    body = transit_realtime.FeedMessage.encode({ header: { gtfsRealtimeVersion: '1.0', timestamp: now }, entity: [] }).finish();
  } else if (FEED_PATHS[key]) {
    body = buildFeed(patterns, FEED_PATHS[key], now);
  } else {
    res.writeHead(404).end();
    return;
  }
  stats.requests++;
  stats.lastFeedAt = now;
  res.writeHead(200, { 'content-type': 'application/octet-stream' });
  res.end(body);
}).listen(port, '127.0.0.1', () => {
  console.log(`mock MTA feed on http://127.0.0.1:${port} · ${patterns.length} patterns · headway ${headway}s${rush ? ' (rush)' : ''}`);
});
