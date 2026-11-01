export type Borough = 'Manhattan' | 'Brooklyn' | 'Queens' | 'Bronx' | 'Staten Island';

// [lat, lon] of Manhattan's eastern shore (East River, then Harlem River), south to north.
const MANHATTAN_EAST_SHORE: Array<[number, number]> = [
  [40.7, -74.0],
  [40.718, -73.975],
  [40.745, -73.958],
  [40.762, -73.95],
  [40.8, -73.93],
  [40.822, -73.931],
  [40.85, -73.93],
  [40.87, -73.912],
  [40.88, -73.905],
];

function manhattanEastShoreLon(lat: number): number {
  for (let i = 1; i < MANHATTAN_EAST_SHORE.length; i++) {
    const [lat1, lon1] = MANHATTAN_EAST_SHORE[i];
    if (lat <= lat1) {
      const [lat0, lon0] = MANHATTAN_EAST_SHORE[i - 1];
      return lon0 + ((lat - lat0) / (lat1 - lat0)) * (lon1 - lon0);
    }
  }
  return Infinity;
}

/**
 * GTFS has no borough field, so this is a coarse geographic classifier built from straight-line approximations
 * of the rivers and the Brooklyn/Queens border. Good enough for a search subtitle, not a geocoder.
 */
export function boroughOf(lat: number, lon: number): Borough {
  if (lon < -74.04 && lat < 40.66) return 'Staten Island';
  if (lat >= 40.7 && lon < manhattanEastShoreLon(lat)) return 'Manhattan';
  if (lat >= 40.79) return 'Bronx';
  const brooklynQueensBorderLat = 40.737 - 0.516 * (lon + 73.957);
  return lon < -73.86 && lat < brooklynQueensBorderLat ? 'Brooklyn' : 'Queens';
}
