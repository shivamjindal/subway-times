import { getAllStations, getRoutesForStation, type Station, type StationWithRoutes } from './subway-data';
import { getSpaceport } from './spaceports';

export type Borough = 'Manhattan' | 'Brooklyn' | 'Queens' | 'Bronx' | 'Staten Island';

export interface StationMatch extends StationWithRoutes {
  borough: Borough;
}

const WORD_ALIASES: Record<string, string> = {
  sq: 'square',
  st: 'street',
  av: 'avenue',
  ave: 'avenue',
  blvd: 'boulevard',
  pkwy: 'parkway',
  hts: 'heights',
  jct: 'junction',
  ctr: 'center',
  rd: 'road',
  pl: 'place',
  ft: 'fort',
  mt: 'mount',
};

// Approximate east edge of Manhattan as [lat, lon] vertices, south to north.
const MANHATTAN_EAST_EDGE: Array<[number, number]> = [
  [40.7, -74.0],
  [40.71, -73.978],
  [40.73, -73.973],
  [40.75, -73.968],
  [40.76, -73.95],
  [40.775, -73.94],
  [40.8, -73.935],
  [40.84, -73.932],
  [40.8765, -73.908],
];

// Approximate Brooklyn/Queens border as [lon, lat] vertices, west to east.
const BROOKLYN_QUEENS_BORDER: Array<[number, number]> = [
  [-73.955, 40.738],
  [-73.93, 40.722],
  [-73.91, 40.701],
  [-73.9, 40.698],
];

function interpolate(points: Array<[number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/** GTFS has no borough field, so this is a coordinate heuristic tuned against known stations. */
export function getBorough({ lat, lon }: Pick<Station, 'lat' | 'lon'>): Borough {
  if (lon < -74.045 && lat < 40.66) return 'Staten Island';
  if (lat >= 40.7 && lat <= 40.8765 && lon < interpolate(MANHATTAN_EAST_EDGE, lat)) return 'Manhattan';
  if (lat > 40.8765 || (lat > 40.8 && lon < -73.88)) return 'Bronx';
  if (lon < -73.9) return lat > interpolate(BROOKLYN_QUEENS_BORDER, lon) ? 'Queens' : 'Brooklyn';
  if (lat < 40.696 && lon < -73.863) return 'Brooklyn';
  return 'Queens';
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let beforePrev: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], beforePrev[j - 2] + 1);
      }
    }
    beforePrev = prev.slice();
    prev.splice(0, prev.length, ...row);
  }
  return prev[b.length];
}

// "grnd" -> "grand": same first letter, remaining letters in order.
function isAbbreviation(query: string, word: string): boolean {
  if (query.length < 3 || query[0] !== word[0]) return false;
  let at = 0;
  for (const ch of query) {
    at = word.indexOf(ch, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

function scoreWord(query: string, word: string): number {
  if (word === query) return 1;
  if (/\d/.test(query) || /\d/.test(word)) return word.startsWith(query) ? 0.85 : 0;
  if (word.startsWith(query)) return 0.9;
  if (query.length < 3) return 0;
  if (word.includes(query)) return 0.6;
  if (isAbbreviation(query, word)) return 0.7;
  const allowed = query.length >= 5 ? 2 : 1;
  const compared = word.slice(0, Math.min(word.length, query.length));
  if (query.length >= 4 && editDistance(query, compared) <= allowed) return 0.65;
  if (editDistance(query, word) <= allowed) return 0.65;
  return 0;
}

function scoreAgainstWord(query: string, word: string): number {
  const expanded = WORD_ALIASES[word];
  return Math.max(scoreWord(query, word), expanded ? scoreWord(query, expanded) * 0.95 : 0);
}

function scoreName(queryTokens: string[], nameTokens: string[]): number {
  const used = new Set<number>();
  let total = 0;
  for (const q of queryTokens) {
    let best = 0;
    let bestIndex = -1;
    nameTokens.forEach((word, i) => {
      if (used.has(i)) return;
      const s = scoreAgainstWord(q, word);
      if (s > best) {
        best = s;
        bestIndex = i;
      }
    });
    if (best === 0) return 0;
    used.add(bestIndex);
    total += best;
  }
  return total / queryTokens.length;
}

// Transfer complexes rank by the lines of the whole complex, so Times Sq outranks a single-line stop.
function hubSize(stopId: string): number {
  const lines = new Set<string>();
  for (const id of getSpaceport(stopId).stationIds) {
    for (const route of getRoutesForStation(id)) lines.add(route.shortName);
  }
  return lines.size;
}

let hubSizes: Map<string, number> | null = null;

function hubBonus(stopId: string): number {
  hubSizes ??= new Map(getAllStations().map((s) => [s.station.stopId, hubSize(s.station.stopId)]));
  return Math.min(hubSizes.get(stopId) ?? 0, 12) * 0.01;
}

/** Typo-tolerant station search. Also accepts a line ("7", "A") to list stations on that line. */
export function searchStations(query: string): StationMatch[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const lowerQuery = query.trim().toLowerCase();
  const asLine = queryTokens.length === 1 ? queryTokens[0].toUpperCase() : null;

  const scored: Array<{ match: StationMatch; score: number; index: number }> = [];
  getAllStations().forEach((entry, index) => {
    const nameTokens = tokenize(entry.station.name);
    let score = scoreName(queryTokens, nameTokens);
    if (entry.station.name.toLowerCase().includes(lowerQuery)) score = Math.max(score, 0.8);
    if (score > 0 && nameTokens.join(' ') === queryTokens.join(' ')) score += 0.2;
    if (score === 0 && asLine && entry.routes.some((r) => r.shortName === asLine)) score = 0.3;
    if (score === 0) return;
    scored.push({
      match: { ...entry, borough: getBorough(entry.station) },
      score: score + hubBonus(entry.station.stopId),
      index,
    });
  });

  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.match);
}

/** "Manhattan · 1 2 3" */
export function describeStation(match: StationMatch): string {
  return `${match.borough} · ${match.routes.map((r) => r.shortName).join(' ')}`;
}
