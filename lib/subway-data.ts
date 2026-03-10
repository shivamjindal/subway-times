import stationToRoutesData from "./station-to-routes.json";
import routeHeadsignsData from "./route-headsigns.json";

export interface Station {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
}

export interface Route {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
}

export interface StationWithRoutes {
  station: Station;
  routes: Route[];
  northboundRoutes: Route[];
  southboundRoutes: Route[];
}

const stationToRoutes = stationToRoutesData as Record<string, StationWithRoutes>;
const allStationsWithRoutes = Object.values(stationToRoutes);

export function getStation(stopId: string): Station | undefined {
  return stationToRoutes[stopId]?.station;
}

export function getRoutesForStation(stopId: string): Route[] {
  return stationToRoutes[stopId]?.routes || [];
}

export function getNorthboundRoutesForStation(stopId: string): Route[] {
  return stationToRoutes[stopId]?.northboundRoutes || [];
}

export function getSouthboundRoutesForStation(stopId: string): Route[] {
  return stationToRoutes[stopId]?.southboundRoutes || [];
}

export function searchStationsByName(query: string): StationWithRoutes[] {
  const lowerQuery = query.toLowerCase();
  return allStationsWithRoutes.filter((s) =>
    s.station.name.toLowerCase().includes(lowerQuery)
  );
}

export const ROUTE_LINE_COLORS: Record<string, string> = {
  A: "0062CF",
  C: "0062CF",
  E: "0062CF",
  B: "EB6800",
  D: "EB6800",
  F: "EB6800",
  FX: "EB6800",
  M: "EB6800",
  G: "799534",
  J: "8E5C33",
  Z: "8E5C33",
  L: "7C858C",
  N: "F6BC26",
  Q: "F6BC26",
  R: "F6BC26",
  W: "F6BC26",
  GS: "7C858C",
  FS: "7C858C",
  H: "7C858C",
  "1": "D82233",
  "2": "D82233",
  "3": "D82233",
  "4": "009952",
  "5": "009952",
  "6": "009952",
  "6X": "009952",
  "7": "9A38A1",
  "7X": "9A38A1",
  SI: "08179C",
};

export function getRouteColor(routeId: string): string {
  return ROUTE_LINE_COLORS[routeId] || "999999";
}

const routeHeadsigns = routeHeadsignsData as Record<string, { N: string[]; S: string[] }>;

export function getDirectionLabel(
  direction: 'N' | 'S',
  arrivals: Array<{ direction: 'N' | 'S'; routeId: string }>
): string {
  const routes = new Set(
    arrivals
      .filter((arrival) => arrival.direction === direction)
      .map((arrival) => arrival.routeId)
  );

  if (routes.size === 0) {
    return direction === 'N' ? 'Northbound' : 'Southbound';
  }

  const allTerminals = new Set<string>();
  for (const routeId of routes) {
    const routeHeadsign = routeHeadsigns[routeId];
    if (!routeHeadsign) {
      continue;
    }

    for (const terminal of direction === 'N' ? routeHeadsign.N : routeHeadsign.S) {
      allTerminals.add(terminal);
    }
  }

  if (allTerminals.size === 0) {
    return direction === 'N' ? 'Northbound' : 'Southbound';
  }

  const terminals = Array.from(allTerminals);
  if (terminals.length === 1) {
    return terminals[0];
  }

  return terminals.slice(0, 2).join(' / ');
}

