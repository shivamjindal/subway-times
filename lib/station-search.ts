import { getAllStations, type StationWithRoutes } from './subway-data';
import { getSpaceport } from './spaceports';
import { boroughOf, type Borough } from './station-borough';

export interface StationSearchResult extends StationWithRoutes {
  borough: Borough;
  /** e.g. "Manhattan · 1 2 3" */
  subtitle: string;
  score: number;
}

const WORD_FORMS: Record<string, string[]> = {
  sq: ['square'],
  av: ['avenue'],
  avs: ['avenues'],
  st: ['street', 'saint'],
  sts: ['streets'],
  pkwy: ['parkway'],
  blvd: ['boulevard'],
  rd: ['road'],
  ctr: ['center'],
  hts: ['heights'],
  jct: ['junction'],
  pl: ['place'],
  e: ['east'],
  w: ['west'],
  n: ['north'],
  s: ['south'],
};

const MAX_HUB_BONUS = 18;

export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions), so "tmies" is one edit from "times". */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => [i, ...Array<number>(cols - 1).fill(0)]);
  for (let j = 1; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

function allowedEdits(length: number): number {
  if (length <= 2) return 0;
  return length <= 4 ? 1 : 2;
}

/** 0 = no match; higher is better. Tokens containing digits never match fuzzily ("7" must not mean "8"). */
function scoreToken(query: string, word: string): number {
  if (query === word) return 100;
  if (word.startsWith(query)) return 85;
  if (/\d/.test(query) || /\d/.test(word)) return 0;
  const edits = allowedEdits(query.length);
  if (edits === 0) return 0;
  // Compare against the same-length prefix too, so a half-typed typo ("grnd") still matches "grand".
  const prefixDistance = editDistance(query, word.slice(0, query.length));
  const distance = Math.min(editDistance(query, word), prefixDistance + 0.5);
  return distance <= edits ? 70 - distance * 12 : 0;
}

function bestScoreForWord(query: string, word: string): number {
  let best = scoreToken(query, word);
  for (const form of WORD_FORMS[word] ?? []) best = Math.max(best, scoreToken(query, form) - 5);
  return best;
}

export function scoreName(query: string, name: string): number {
  const queryTokens = normalize(query);
  const words = normalize(name);
  if (queryTokens.length === 0 || words.length === 0) return 0;

  let total = 0;
  let lastWordIndex = -1;
  let inOrder = true;
  for (const token of queryTokens) {
    let best = 0;
    let bestIndex = -1;
    words.forEach((word, i) => {
      const score = bestScoreForWord(token, word);
      if (score > best) {
        best = score;
        bestIndex = i;
      }
    });
    if (best === 0) return 0;
    if (bestIndex < lastWordIndex) inOrder = false;
    lastWordIndex = bestIndex;
    total += best;
  }

  let score = total / queryTokens.length;
  if (inOrder) score += 4;
  if (normalize(name).join(' ') === queryTokens.join(' ')) score += 20;
  else if (normalize(name).join(' ').startsWith(queryTokens.join(' '))) score += 8;
  // Penalise names with many unmatched words so "Grand St" beats "Grand Army Plaza-Prospect Park" on "grand st".
  score -= Math.max(0, words.length - queryTokens.length) * 0.5;
  return score;
}

const hubBonusCache = new Map<string, number>();

/** Bonus for stations in big transfer complexes (Grand Central, Times Sq, Fulton St...), by distinct lines served. */
function hubBonus(station: StationWithRoutes): number {
  const cached = hubBonusCache.get(station.station.stopId);
  if (cached !== undefined) return cached;
  const stationsById = new Map(getAllStations().map((s) => [s.station.stopId, s]));
  const lines = new Set<string>();
  for (const id of getSpaceport(station.station.stopId).stationIds) {
    for (const route of stationsById.get(id)?.routes ?? []) lines.add(route.shortName);
  }
  const bonus = Math.min(MAX_HUB_BONUS, Math.max(0, lines.size - 2) * 1.5);
  hubBonusCache.set(station.station.stopId, bonus);
  return bonus;
}

export function describeStation(station: StationWithRoutes): Pick<StationSearchResult, 'borough' | 'subtitle'> {
  const borough = boroughOf(station.station.lat, station.station.lon);
  const lines = [...new Set(station.routes.map((r) => r.shortName))].join(' ');
  return { borough, subtitle: lines ? `${borough} · ${lines}` : borough };
}

export function searchStations(query: string, limit = 10): StationSearchResult[] {
  if (normalize(query).length === 0) return [];
  const results: StationSearchResult[] = [];
  for (const station of getAllStations()) {
    const match = scoreName(query, station.station.name);
    if (match === 0) continue;
    results.push({ ...station, ...describeStation(station), score: match + hubBonus(station) });
  }
  results.sort(
    (a, b) =>
      b.score - a.score ||
      a.station.name.localeCompare(b.station.name) ||
      a.station.stopId.localeCompare(b.station.stopId, undefined, { numeric: true })
  );
  return results.slice(0, limit);
}
