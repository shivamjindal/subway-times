// MTA Subway GTFS Data Utilities
// This module provides easy access to subway route and station mappings

import routeToStationsData from "./route-to-stations.json";
import stationToRoutesData from "./station-to-routes.json";
import routeHeadsignsData from "./route-headsigns.json";

// Types
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

export interface RouteWithStations {
  route: Route;
  stations: Station[];
  northboundStations: Station[];
  southboundStations: Station[];
}

export interface StationWithRoutes {
  station: Station;
  routes: Route[];
  northboundRoutes: Route[];
  southboundRoutes: Route[];
}

// Type the imported data
const routeToStations = routeToStationsData as Record<string, RouteWithStations>;
const stationToRoutes = stationToRoutesData as Record<string, StationWithRoutes>;

// Get all route IDs
export function getAllRouteIds(): string[] {
  return Object.keys(routeToStations);
}

// Get all routes
export function getAllRoutes(): Route[] {
  return Object.values(routeToStations).map((r) => r.route);
}

// Get route by ID
export function getRoute(routeId: string): Route | undefined {
  return routeToStations[routeId]?.route;
}

// Get all stations served by a route
export function getStationsForRoute(routeId: string): Station[] {
  return routeToStations[routeId]?.stations || [];
}

// Get northbound stations for a route
export function getNorthboundStationsForRoute(routeId: string): Station[] {
  return routeToStations[routeId]?.northboundStations || [];
}

// Get southbound stations for a route
export function getSouthboundStationsForRoute(routeId: string): Station[] {
  return routeToStations[routeId]?.southboundStations || [];
}

// Get full route data including all stations
export function getRouteWithStations(routeId: string): RouteWithStations | undefined {
  return routeToStations[routeId];
}

// Get all station IDs
export function getAllStationIds(): string[] {
  return Object.keys(stationToRoutes);
}

// Get all stations
export function getAllStations(): Station[] {
  return Object.values(stationToRoutes).map((s) => s.station);
}

// Get station by ID
export function getStation(stopId: string): Station | undefined {
  return stationToRoutes[stopId]?.station;
}

// Get all routes at a station
export function getRoutesForStation(stopId: string): Route[] {
  return stationToRoutes[stopId]?.routes || [];
}

// Get northbound routes at a station
export function getNorthboundRoutesForStation(stopId: string): Route[] {
  return stationToRoutes[stopId]?.northboundRoutes || [];
}

// Get southbound routes at a station
export function getSouthboundRoutesForStation(stopId: string): Route[] {
  return stationToRoutes[stopId]?.southboundRoutes || [];
}

// Get full station data including all routes
export function getStationWithRoutes(stopId: string): StationWithRoutes | undefined {
  return stationToRoutes[stopId];
}

// Search stations by name (partial match, case-insensitive)
export function searchStationsByName(query: string): StationWithRoutes[] {
  const lowerQuery = query.toLowerCase();
  return Object.values(stationToRoutes).filter((s) =>
    s.station.name.toLowerCase().includes(lowerQuery)
  );
}

// Get all stations with the same name (different platforms)
export function getStationsByName(name: string): StationWithRoutes[] {
  return Object.values(stationToRoutes).filter(
    (s) => s.station.name.toLowerCase() === name.toLowerCase()
  );
}

// Get all routes at a station complex (by name)
// This aggregates routes from all platforms with the same station name
export function getAllRoutesAtStationComplex(stationName: string): Route[] {
  const stations = getStationsByName(stationName);
  const routeMap = new Map<string, Route>();

  stations.forEach((s) => {
    s.routes.forEach((r) => {
      if (!routeMap.has(r.routeId)) {
        routeMap.set(r.routeId, r);
      }
    });
  });

  return Array.from(routeMap.values()).sort((a, b) =>
    a.shortName.localeCompare(b.shortName)
  );
}

// Find stations near a location (within radiusKm kilometers)
export function findNearbyStations(
  lat: number,
  lon: number,
  radiusKm: number = 0.5
): StationWithRoutes[] {
  return Object.values(stationToRoutes).filter((s) => {
    const distance = haversineDistance(
      lat,
      lon,
      s.station.lat,
      s.station.lon
    );
    return distance <= radiusKm;
  });
}

// Haversine distance formula (returns distance in km)
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Route colors by line group
export const ROUTE_LINE_COLORS: Record<string, string> = {
  // 8th Ave (A Division)
  A: "0062CF",
  C: "0062CF",
  E: "0062CF",
  // 6th Ave
  B: "EB6800",
  D: "EB6800",
  F: "EB6800",
  FX: "EB6800",
  M: "EB6800",
  // Crosstown
  G: "799534",
  // Nassau St
  J: "8E5C33",
  Z: "8E5C33",
  // Canarsie
  L: "7C858C",
  // Broadway (BMT)
  N: "F6BC26",
  Q: "F6BC26",
  R: "F6BC26",
  W: "F6BC26",
  // Shuttles
  GS: "7C858C",
  FS: "7C858C",
  H: "7C858C",
  // 7th Ave (IRT)
  "1": "D82233",
  "2": "D82233",
  "3": "D82233",
  // Lexington Ave
  "4": "009952",
  "5": "009952",
  "6": "009952",
  "6X": "009952",
  // Flushing
  "7": "9A38A1",
  "7X": "9A38A1",
  // Staten Island Railway
  SI: "08179C",
};

// Get the line color for a route
export function getRouteColor(routeId: string): string {
  return ROUTE_LINE_COLORS[routeId] || "999999";
}

// Route short names (for display)
export function getRouteDisplayName(routeId: string): string {
  const route = getRoute(routeId);
  if (!route) return routeId;
  // Special cases for shuttles
  if (routeId === "GS") return "S";
  if (routeId === "FS") return "S";
  if (routeId === "H") return "S";
  return route.shortName;
}

// Route headsigns from GTFS trips.txt (generated by gtfs-mappings.ts)
// Format: { routeId: { N: ["headsign1", "headsign2"], S: ["headsign1"] } }
const routeHeadsigns = routeHeadsignsData as Record<string, { N: string[]; S: string[] }>;

// Get direction label for a route based on MTA headsigns from GTFS data
// Returns formatted labels like "Downtown and Brooklyn", "Uptown and Queens", etc.
export function getDirectionLabel(
  direction: 'N' | 'S',
  arrivals: Array<{ destination: string; direction: 'N' | 'S'; routeId: string; stationId?: string }>
): string {
  // Get unique routes for this direction
  const directionArrivals = arrivals.filter(a => a.direction === direction);
  const routes = [...new Set(directionArrivals.map(a => a.routeId))];
  
  if (routes.length === 0) {
    // Fallback to generic if no routes
    return direction === 'N' ? 'Uptown' : 'Downtown';
  }
  
  // Collect all headsigns for the routes from route data (not just arrivals)
  // This ensures we see all possible terminals, not just what's currently arriving
  const allHeadsigns: string[] = [];
  routes.forEach(routeId => {
    const routeHeadsign = routeHeadsigns[routeId];
    if (routeHeadsign) {
      const headsigns = direction === 'N' ? routeHeadsign.N : routeHeadsign.S;
      // Add all headsigns for this route direction
      allHeadsigns.push(...headsigns);
    }
  });
  
  if (allHeadsigns.length === 0) {
    return direction === 'N' ? 'Uptown' : 'Downtown';
  }
  
  // Get unique headsigns
  const uniqueHeadsigns = [...new Set(allHeadsigns)];
  
  // Determine borough(s) from headsigns
  const borough = findBoroughFromHeadsigns(uniqueHeadsigns);
  
  // Format as "Direction and Borough"
  const directionLabel = direction === 'N' ? 'Uptown' : 'Downtown';
  
  if (borough) {
    return `${directionLabel} and ${borough}`;
  }
  
  // Fallback: if we can't determine borough, just return direction
  return directionLabel;
}

// Extract borough from terminal/headsign names
function findBoroughFromHeadsigns(headsigns: string[]): string | null {
  // Comprehensive borough indicators in station names
  const boroughPatterns: Record<string, string[]> = {
    'Queens': [
      'Jamaica', 'Astoria', 'Flushing', 'Forest Hills', 'Court Sq', 'Ditmars', 'Parsons',
      'Archer', 'Main St', 'Willets', 'Mets', 'Woodside', 'Sunnyside', 'Long Island City',
      'Far Rockaway', 'Rockaway', 'Ozone Park', 'Lefferts', '179 St', '71 Av'
    ],
    'Brooklyn': [
      'Coney Island', 'Church Av', 'Bay Ridge', 'Canarsie', 'Stillwell', 'Kings Hwy', 
      'Brighton', 'Flatbush', 'Utica', 'Crown Hts', 'New Lots', 'Prospect Park',
      'Franklin', 'Atlantic', 'Nostrand', 'Avenue', '95 St', '86 St'
    ],
    'Manhattan': [
      'Times Sq', 'Grand Central', 'World Trade', 'Whitehall', 'Broad St', '96 St', 
      'Hudson Yards', '34 St', 'Penn Station', 'Bowling Green', 'South Ferry',
      'City Hall', 'Brooklyn Bridge', 'Wall St', '14 St', '42 St', '125 St', '137 St',
      '145 St', '157 St', '168 St', '181 St', '191 St', '207 St', '215 St', '231 St',
      '238 St', '242 St', 'Dyckman', 'Harlem', 'Inwood', 'Washington Hts'
    ],
    'The Bronx': [
      'Van Cortlandt', 'Wakefield', 'Woodlawn', 'Bedford Park', 'Dyre Av', '242 St', 
      '241 St', 'Pelham Bay', 'Eastchester', 'Gun Hill', 'Nereid', 'Burnside',
      'Tremont', 'Fordham', 'Yankee Stadium', 'Lehman College'
    ],
  };
  
  // Count borough matches
  const boroughCounts: Record<string, number> = {};
  
  headsigns.forEach(headsign => {
    for (const [borough, patterns] of Object.entries(boroughPatterns)) {
      if (patterns.some(pattern => headsign.includes(pattern))) {
        boroughCounts[borough] = (boroughCounts[borough] || 0) + 1;
      }
    }
  });
  
  // If no matches, return null
  if (Object.keys(boroughCounts).length === 0) {
    return null;
  }
  
  // Find the most common borough
  const mostCommonBorough = Object.entries(boroughCounts).reduce((max, [borough, count]) => {
    return count > (max[1] || 0) ? [borough, count] : max;
  }, ['', 0] as [string, number]);
  
  return mostCommonBorough[0] || null;
}

// Export the raw data for direct access
export { routeToStations, stationToRoutes };

