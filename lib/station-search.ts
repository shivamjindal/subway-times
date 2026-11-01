import { getAllStations, type StationWithRoutes } from './subway-data';

export type Borough = 'Manhattan' | 'Brooklyn' | 'Queens' | 'Bronx' | 'Staten Island';

const ALIASES: Record<string, string[]> = {
  sq: ['square'],
  av: ['avenue', 'ave'],
  st: ['street'],
  ctr: ['center', 'centre'],
  hts: ['heights'],
  blvd: ['boulevard'],
  pkwy: ['parkway'],
  jct: ['junction'],
  pk: ['park'],
  rd: ['road'],
  pl: ['place'],
  mt: ['mount'],
  ft: ['fort'],
};

const HUBS = new Set([
  'Grand Central-42 St',
  'Times Sq-42 St',
  '34 St-Penn Station',
  '14 St-Union Sq',
  '34 St-Herald Sq',
  'Fulton St',
  'Atlantic Av-Barclays Ctr',
  'Jay St-MetroTech',
  'Court Sq',
  'Lexington Av/59 St',
  'Jackson Hts-Roosevelt Av',
  'Flushing-Main St',
  'Chambers St',
  'West 4 St-Washington Sq',
  'Canal St',
  'Broadway-Lafayette St',
  '59 St-Columbus Circle',
  '149 St-Grand Concourse',
  'Sutter Av-Rutland Rd',
  'Queensboro Plaza',
  'Jamaica Center-Parsons/Archer',
  'Coney Island-Stillwell Av',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function isSubsequence(q: string, word: string): boolean {
  let i = 0;
  for (const ch of word) if (ch === q[i]) i++;
  return i === q.length;
}

function tokenScore(q: string, word: string): number {
  if (q === word) return 1;
  if (/\d/.test(q) || /\d/.test(word)) return 0;
  if (word.startsWith(q)) return 0.9;
  if (q.length < 3) return 0;
  if (word.includes(q)) return 0.7;
  if (q.length >= 3 && q[0] === word[0] && word.length > q.length && isSubsequence(q, word)) return 0.6;
  if (q.length >= 4) {
    const limit = q.length >= 7 ? 2 : 1;
    if (editDistance(q, word) <= limit) return 0.55;
    const prefixDist = editDistance(q, word.slice(0, q.length));
    if (prefixDist <= limit) return 0.5;
  }
  return 0;
}

function nameWords(name: string): string[] {
  const words = tokenize(name);
  return words.flatMap((w) => [w, ...(ALIASES[w] ?? [])]);
}

export function scoreStationMatch(query: string, name: string): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;
  const words = nameWords(name);
  let total = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const w of words) best = Math.max(best, tokenScore(q, w));
    if (best === 0) return 0;
    total += best;
  }
  const normalizedName = tokenize(name).join(' ');
  const normalizedQuery = qTokens.join(' ');
  const exactBonus = normalizedName.startsWith(normalizedQuery) ? 1 : normalizedName.includes(normalizedQuery) ? 0.5 : 0;
  return total / qTokens.length + exactBonus;
}

export function fuzzySearchStations(query: string, limit = 10): StationWithRoutes[] {
  return getAllStations()
    .map((s) => {
      const match = scoreStationMatch(query, s.station.name);
      if (match === 0) return { s, score: 0 };
      const hub = HUBS.has(s.station.name) ? 0.4 : 0;
      return { s, score: match + hub + Math.min(s.routes.length, 8) * 0.02 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.s.station.name.localeCompare(b.s.station.name))
    .slice(0, limit)
    .map((r) => r.s);
}

function interpolate(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

// Approximate borough from coordinates; GTFS has no borough field.
export function getBorough(lat: number, lon: number): Borough {
  if (lat < 40.66 && lon < -74.04) return 'Staten Island';
  const harlemRiverLon = -73.9335 + Math.max(0, lat - 40.8) * 0.25;
  if (lat > 40.8 && lon > harlemRiverLon) return 'Bronx';
  if (lat > 40.8) return 'Manhattan';
  if (lat >= 40.7015 && lon < interpolate([[40.742, -73.972], [40.8, -73.935]], lat)) return 'Manhattan';
  if (lon > -73.865) return 'Queens';
  if (lon >= -73.94) {
    const queensBorderLat = interpolate([[-73.94, 40.735], [-73.89, 40.708], [-73.867, 40.69]], lon);
    return lat > queensBorderLat ? 'Queens' : 'Brooklyn';
  }
  return lat > 40.7365 ? 'Queens' : 'Brooklyn';
}

export function getStationSubtitle({ station, routes }: StationWithRoutes): string {
  const lines = routes.map((r) => r.shortName).join(' ');
  const corridor = routes[0]?.longName;
  return [getBorough(station.lat, station.lon), lines && `${lines} line${routes.length > 1 ? 's' : ''}`, corridor]
    .filter(Boolean)
    .join(' · ');
}
