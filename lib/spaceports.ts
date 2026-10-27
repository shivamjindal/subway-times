import spaceportData from './spaceports.json';

/**
 * A spaceport is a station, or a transfer complex (Times Sq: 127, 725, 902, A27, R16), and has one pad per
 * platform. A pad is a GTFS stop ID: the station ID plus its N/S direction suffix. Generated from static GTFS by
 * scripts/build-subway-map.mjs.
 */
export type Direction = 'N' | 'S';

export interface Pad {
  /** GTFS stop ID, e.g. "L14N". */
  id: string;
  stationId: string;
  direction: Direction;
  /** Display route names ("7" for 7/7X, "S" for shuttles), in route order. */
  routes: string[];
  /** Where trains on this platform head: "Manhattan-bound", "Uptown", "to Canarsie-Rockaway Pkwy", "Arrivals". */
  heading: string;
  /** "L · Manhattan-bound" */
  label: string;
}

export interface Spaceport {
  /** Lowest member station ID. */
  id: string;
  name: string;
  stationIds: string[];
  pads: Pad[];
}

interface SpaceportData {
  spaceports: Array<{ id: string; name: string; stations: string[] }>;
  pads: Record<string, { routes: string[]; label: string }>;
}

const data = spaceportData as SpaceportData;

const padById = new Map<string, Pad>();
const spaceportByStation = new Map<string, Spaceport>();

for (const entry of data.spaceports) {
  const pads: Pad[] = [];
  for (const stationId of entry.stations) {
    for (const direction of ['N', 'S'] as const) {
      const raw = data.pads[`${stationId}${direction}`];
      if (!raw) continue;
      const pad: Pad = {
        id: `${stationId}${direction}`,
        stationId,
        direction,
        routes: raw.routes,
        heading: raw.label,
        label: `${raw.routes.join('')} · ${raw.label}`,
      };
      pads.push(pad);
      padById.set(pad.id, pad);
    }
  }
  const spaceport: Spaceport = { id: entry.id, name: entry.name, stationIds: entry.stations, pads };
  for (const stationId of entry.stations) spaceportByStation.set(stationId, spaceport);
}

export function padId(stationId: string, direction: Direction): string {
  return `${stationId}${direction}`;
}

export function getPad(id: string): Pad | undefined {
  return padById.get(id);
}

/** The spaceport a station belongs to. Stations with no scheduled service get a pad-less spaceport of their own. */
export function getSpaceport(stationId: string): Spaceport {
  return spaceportByStation.get(stationId) ?? { id: stationId, name: stationId, stationIds: [stationId], pads: [] };
}
