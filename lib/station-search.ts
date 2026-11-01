import stationBoroughs from './station-boroughs.json';
import { getAllStations, getRoutesForStation, type StationWithRoutes } from './subway-data';
import { getSpaceport } from './spaceports';

const BOROUGH_NAMES: Record<string, string> = {
  M: 'Manhattan',
  Bk: 'Brooklyn',
  Bx: 'Bronx',
  Q: 'Queens',
  SI: 'Staten Island',
};

export function getStationBorough(stopId: string): string | undefined {
  return BOROUGH_NAMES[(stationBoroughs as Record<string, string>)[stopId]];
}

/** Short form as it appears in GTFS names → spelled-out form. Query tokens in either form map to the short form. */
const ABBREVIATIONS: Record<string, string[]> = {
  st: ['street'],
  sts: ['streets'],
  av: ['avenue', 'ave'],
  avs: ['avenues', 'aves'],
  sq: ['square'],
  rd: ['road'],
  pkwy: ['parkway', 'pky'],
  blvd: ['boulevard'],
  hwy: ['highway'],
  tpke: ['turnpike'],
  ctr: ['center', 'centre'],
  pl: ['place'],
  hts: ['heights'],
  ft: ['fort'],
  jct: ['junction'],
  ln: ['lane'],
  dr: ['drive'],
  e: ['east'],
  w: ['west'],
};
const SHORT_FORM = new Map<string, string>();
for (const [short, longs] of Object.entries(ABBREVIATIONS)) {
  SHORT_FORM.set(short, short);
  for (const long of longs) SHORT_FORM.set(long, short);
}

const STOP_WORDS = new Set(['station', 'stn', 'stop', 'subway', 'the', 'and']);

function canonical(token: string): string {
  const ordinal = token.match(/^(\d+)(st|nd|rd|th)$/);
  if (ordinal) return ordinal[1];
  return SHORT_FORM.get(token) ?? token;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(canonical);
}

/** Optimal string alignment distance: Levenshtein plus adjacent transpositions ("tiems" → "times" is 1). */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) if (ch === needle[i]) i++;
  return i === needle.length;
}

/** How well one query token matches one name word, 0 (no match) to 1 (exact). */
export function tokenScore(query: string, word: string): number {
  if (query === word) return 1;
  if (word.startsWith(query)) return 0.9;
  // Numbers must match exactly or as a prefix while typing: "7 Av" is not "1 Av".
  if (/\d/.test(query) || /\d/.test(word) || query.length < 3) return 0;
  // Dropped letters, e.g. "grnd" in "grand", "cntrl" in "central".
  if (query[0] === word[0] && query.length * 2 >= word.length && isSubsequence(query, word)) return 0.75;
  const maxEdits = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0;
  const distance = editDistance(query, word.slice(0, query.length + maxEdits));
  if (distance > maxEdits) return 0;
  return distance === 1 ? 0.7 : 0.55;
}

interface IndexedStation {
  entry: StationWithRoutes;
  /** Each name word with its spelled-out forms, so "squar" can prefix-match "sq" via "square". */
  words: string[][];
  complexRoutes: number;
  order: number;
}

let index: IndexedStation[] | undefined;

function getIndex(): IndexedStation[] {
  index ??= getAllStations().map((entry, order) => {
    const routes = new Set(getSpaceport(entry.station.stopId).stationIds.flatMap((id) => getRoutesForStation(id).map((r) => r.shortName)));
    return {
      entry,
      words: tokenize(entry.station.name).map((w) => [w, ...(ABBREVIATIONS[w] ?? [])]),
      complexRoutes: Math.max(routes.size, entry.routes.length),
      order,
    };
  });
  return index;
}

/** Up to ~0.2: enough to lift Times Sq or Fulton St over a minor stop matched equally well, not over a better match. */
const hubBoost = (complexRoutes: number) => Math.min(complexRoutes, 12) * 0.016;

export interface StationSearchResult extends StationWithRoutes {
  score: number;
}

/**
 * Every query word must match some word of the station name (exactly, as a prefix, or with a typo).
 * Ranked by match quality plus a boost for transfer hubs, measured by lines served across the complex.
 */
export function searchStations(query: string, limit = 10): StationSearchResult[] {
  const queryTokens = tokenize(query).filter((t) => !STOP_WORDS.has(t));
  if (queryTokens.length === 0) return [];

  const results: Array<{ result: StationSearchResult; complexRoutes: number; order: number }> = [];
  for (const { entry, words, complexRoutes, order } of getIndex()) {
    const used = new Set<number>();
    let total = 0;
    for (const q of queryTokens) {
      let best = 0;
      let bestWord = -1;
      words.forEach((forms, i) => {
        if (used.has(i)) return;
        const s = Math.max(...forms.map((f) => tokenScore(q, f)));
        if (s > best) [best, bestWord] = [s, i];
      });
      if (best === 0) break;
      used.add(bestWord);
      total += best;
    }
    if (used.size < queryTokens.length) continue;
    const match = total / queryTokens.length;
    const coverage = used.size / words.length;
    results.push({ result: { ...entry, score: match + 0.1 * coverage + hubBoost(complexRoutes) }, complexRoutes, order });
  }

  return results
    .sort((a, b) => b.result.score - a.result.score || b.complexRoutes - a.complexRoutes || a.order - b.order)
    .slice(0, limit)
    .map(({ result }) => result);
}
