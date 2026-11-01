import type { Station, StationWithRoutes } from './subway-data';

const ABBREVIATIONS: Record<string, string> = {
  sq: 'square',
  st: 'street',
  av: 'avenue',
  ave: 'avenue',
  ctr: 'center',
  blvd: 'boulevard',
  pkwy: 'parkway',
  jct: 'junction',
  hts: 'heights',
  rd: 'road',
  pl: 'place',
};

const HUB_PREFIXES = ['grand central', 'times sq', 'penn station', '34 st-penn', 'union sq', 'herald sq', 'fulton st', 'atlantic av', 'jay st', '14 st'];

const MANHATTAN: [number, number][] = [
  [-74.021, 40.7], [-74.012, 40.745], [-73.997, 40.775], [-73.972, 40.8], [-73.95, 40.835], [-73.93, 40.862], [-73.915, 40.882],
  [-73.905, 40.88], [-73.915, 40.862], [-73.925, 40.845], [-73.932, 40.828], [-73.934, 40.815], [-73.936, 40.8], [-73.94, 40.79],
  [-73.944, 40.78], [-73.955, 40.77], [-73.965, 40.752], [-73.97, 40.735], [-73.975, 40.715], [-73.985, 40.7],
];

function inPolygon(lon: number, lat: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function getBorough({ lat, lon }: Station): string {
  if (inPolygon(lon, lat, MANHATTAN)) return 'Manhattan';
  if (lat > 40.8 && lon > -73.95) return 'Bronx';
  if (lon < -74.04 && lat < 40.66) return 'Staten Island';
  const queensBorder = lon > -73.9 ? 40.695 : 40.737 - 0.875 * (lon + 73.95);
  if (lat > Math.max(queensBorder, 40.695) || (lon > -73.87 && lat < 40.69)) return 'Queens';
  return 'Brooklyn';
}

export function getStationSubtitle({ station, routes }: StationWithRoutes): string {
  const lines = [...new Set(routes.map((r) => r.shortName))].join(' ');
  return lines ? `${getBorough(station)} · ${lines}` : getBorough(station);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] ?? t);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const c of haystack) if (c === needle[i]) i++;
  return i === needle.length;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

function tokenScore(q: string, t: string): number {
  if (q === t) return 1;
  if (t.startsWith(q)) return 0.9;
  if (/\d/.test(q) || /\d/.test(t)) return 0;
  if (q.length >= 3 && q[0] === t[0] && isSubsequence(q, t)) return 0.7;
  if (q.length >= 4 && editDistance(q, t) <= (q.length >= 5 ? 2 : 1)) return 0.6;
  return 0;
}

function scoreStation({ station, routes }: StationWithRoutes, queryTokens: string[], query: string): number {
  const nameTokens = tokenize(station.name);
  let total = 0;
  for (const q of queryTokens) {
    const best = Math.max(...nameTokens.map((t) => tokenScore(q, t)));
    if (best === 0) return 0;
    total += best;
  }
  const name = station.name.toLowerCase();
  const prefixBonus = name.startsWith(query) ? 0.3 : 0;
  const hubBonus = HUB_PREFIXES.some((h) => name.startsWith(h)) ? 0.4 : 0;
  return total / queryTokens.length + prefixBonus + hubBonus + Math.min(routes.length, 8) * 0.02;
}

export function searchStations(stations: StationWithRoutes[], query: string): StationWithRoutes[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const normalized = query.trim().toLowerCase();
  return stations
    .map((s) => ({ s, score: scoreStation(s, queryTokens, normalized) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.s.station.name.localeCompare(b.s.station.name) || a.s.station.stopId.localeCompare(b.s.station.stopId))
    .map((r) => r.s);
}
