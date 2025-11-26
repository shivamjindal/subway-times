import * as fs from "fs";
import * as path from "path";

// Types for the mappings
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

export interface RouteToStationsMapping {
  [routeId: string]: {
    route: Route;
    stations: Station[];
    northboundStations: Station[];
    southboundStations: Station[];
  };
}

export interface StationToRoutesMapping {
  [stopId: string]: {
    station: Station;
    routes: Route[];
    northboundRoutes: Route[];
    southboundRoutes: Route[];
  };
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split("\n");
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

export function generateMappings(gtfsDir: string): {
  routeToStations: RouteToStationsMapping;
  stationToRoutes: StationToRoutesMapping;
  routes: Route[];
  stations: Station[];
} {
  // Read all GTFS files
  const routesContent = fs.readFileSync(
    path.join(gtfsDir, "routes.txt"),
    "utf-8"
  );
  const stopsContent = fs.readFileSync(
    path.join(gtfsDir, "stops.txt"),
    "utf-8"
  );
  const tripsContent = fs.readFileSync(
    path.join(gtfsDir, "trips.txt"),
    "utf-8"
  );
  const stopTimesContent = fs.readFileSync(
    path.join(gtfsDir, "stop_times.txt"),
    "utf-8"
  );

  // Parse CSV files
  const routesData = parseCSV(routesContent);
  const stopsData = parseCSV(stopsContent);
  const tripsData = parseCSV(tripsContent);
  const stopTimesData = parseCSV(stopTimesContent);

  // Build routes map
  const routes: Route[] = routesData.map((r) => ({
    routeId: r.route_id,
    shortName: r.route_short_name,
    longName: r.route_long_name,
    color: r.route_color,
    textColor: r.route_text_color,
  }));

  const routesMap = new Map<string, Route>();
  routes.forEach((r) => routesMap.set(r.routeId, r));

  // Build parent stations map (only stations with location_type=1 or without N/S suffix)
  const stations: Station[] = [];
  const stationsMap = new Map<string, Station>();

  stopsData.forEach((s) => {
    // Parent stations have location_type=1 and no parent_station
    if (s.location_type === "1" || !s.parent_station) {
      // Skip if it ends with N or S (directional stop)
      if (!/[NS]$/.test(s.stop_id)) {
        const station: Station = {
          stopId: s.stop_id,
          name: s.stop_name,
          lat: parseFloat(s.stop_lat),
          lon: parseFloat(s.stop_lon),
        };
        stations.push(station);
        stationsMap.set(s.stop_id, station);
      }
    }
  });

  // Build trip to route mapping
  const tripToRoute = new Map<string, string>();
  tripsData.forEach((t) => {
    tripToRoute.set(t.trip_id, t.route_id);
  });

  // Build route to stops and stop to routes mappings
  const routeStopsNorthbound = new Map<string, Set<string>>();
  const routeStopsSouthbound = new Map<string, Set<string>>();
  const stopRoutesNorthbound = new Map<string, Set<string>>();
  const stopRoutesSouthbound = new Map<string, Set<string>>();

  // Process stop_times to find which routes serve which stops
  stopTimesData.forEach((st) => {
    const tripId = st.trip_id;
    const stopId = st.stop_id;
    const routeId = tripToRoute.get(tripId);

    if (!routeId) return;

    // Determine direction from stop_id suffix (N = northbound, S = southbound)
    const isNorthbound = stopId.endsWith("N");
    const isSouthbound = stopId.endsWith("S");

    // Get parent station ID (remove N/S suffix)
    const parentStopId = stopId.replace(/[NS]$/, "");

    // Skip if we don't have this station in our map
    if (!stationsMap.has(parentStopId)) return;

    // Add to route -> stops mapping
    if (isNorthbound) {
      if (!routeStopsNorthbound.has(routeId)) {
        routeStopsNorthbound.set(routeId, new Set());
      }
      routeStopsNorthbound.get(routeId)!.add(parentStopId);

      if (!stopRoutesNorthbound.has(parentStopId)) {
        stopRoutesNorthbound.set(parentStopId, new Set());
      }
      stopRoutesNorthbound.get(parentStopId)!.add(routeId);
    } else if (isSouthbound) {
      if (!routeStopsSouthbound.has(routeId)) {
        routeStopsSouthbound.set(routeId, new Set());
      }
      routeStopsSouthbound.get(routeId)!.add(parentStopId);

      if (!stopRoutesSouthbound.has(parentStopId)) {
        stopRoutesSouthbound.set(parentStopId, new Set());
      }
      stopRoutesSouthbound.get(parentStopId)!.add(routeId);
    }
  });

  // Build final mappings
  const routeToStations: RouteToStationsMapping = {};

  routes.forEach((route) => {
    const northboundStopIds = routeStopsNorthbound.get(route.routeId) || new Set();
    const southboundStopIds = routeStopsSouthbound.get(route.routeId) || new Set();

    const allStopIds = new Set([...northboundStopIds, ...southboundStopIds]);

    const allStations = Array.from(allStopIds)
      .map((id) => stationsMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    const northboundStations = Array.from(northboundStopIds)
      .map((id) => stationsMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    const southboundStations = Array.from(southboundStopIds)
      .map((id) => stationsMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (allStations.length > 0) {
      routeToStations[route.routeId] = {
        route,
        stations: allStations,
        northboundStations,
        southboundStations,
      };
    }
  });

  const stationToRoutes: StationToRoutesMapping = {};

  stations.forEach((station) => {
    const northboundRouteIds = stopRoutesNorthbound.get(station.stopId) || new Set();
    const southboundRouteIds = stopRoutesSouthbound.get(station.stopId) || new Set();

    const allRouteIds = new Set([...northboundRouteIds, ...southboundRouteIds]);

    const allRoutes = Array.from(allRouteIds)
      .map((id) => routesMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.shortName.localeCompare(b.shortName));

    const northboundRoutes = Array.from(northboundRouteIds)
      .map((id) => routesMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.shortName.localeCompare(b.shortName));

    const southboundRoutes = Array.from(southboundRouteIds)
      .map((id) => routesMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.shortName.localeCompare(b.shortName));

    if (allRoutes.length > 0) {
      stationToRoutes[station.stopId] = {
        station,
        routes: allRoutes,
        northboundRoutes,
        southboundRoutes,
      };
    }
  });

  return {
    routeToStations,
    stationToRoutes,
    routes,
    stations,
  };
}

// Generate route headsigns mapping from trips.txt
export function generateRouteHeadsigns(gtfsDir: string): Record<string, { N: string[]; S: string[] }> {
  const tripsContent = fs.readFileSync(
    path.join(gtfsDir, "trips.txt"),
    "utf-8"
  );

  const tripsData = parseCSV(tripsContent);

  // Map: routeId -> direction -> Set of headsigns
  const headsignMap = new Map<string, { N: Set<string>; S: Set<string> }>();

  tripsData.forEach((trip) => {
    const routeId = trip.route_id;
    const headsign = trip.trip_headsign;
    const directionId = trip.direction_id;

    if (!routeId || !headsign) return;

    // direction_id: 0 = northbound (N), 1 = southbound (S)
    const direction = directionId === "0" ? "N" : "S";

    if (!headsignMap.has(routeId)) {
      headsignMap.set(routeId, { N: new Set(), S: new Set() });
    }

    const routeHeadsigns = headsignMap.get(routeId)!;
    routeHeadsigns[direction].add(headsign);
  });

  // Convert Sets to Arrays and sort
  const result: Record<string, { N: string[]; S: string[] }> = {};
  headsignMap.forEach((headsigns, routeId) => {
    result[routeId] = {
      N: Array.from(headsigns.N).sort(),
      S: Array.from(headsigns.S).sort(),
    };
  });

  return result;
}

// Script to generate and save mappings as JSON
if (require.main === module) {
  const gtfsDir = path.join(__dirname, "..", "gtfs_subway");
  const outputDir = path.join(__dirname, "..", "lib");

  console.log("Parsing GTFS data...");
  const { routeToStations, stationToRoutes, routes, stations } =
    generateMappings(gtfsDir);

  console.log(`Found ${routes.length} routes`);
  console.log(`Found ${stations.length} stations`);
  console.log(
    `Routes with stations: ${Object.keys(routeToStations).length}`
  );
  console.log(
    `Stations with routes: ${Object.keys(stationToRoutes).length}`
  );

  // Generate route headsigns
  console.log("\nGenerating route headsigns...");
  const routeHeadsigns = generateRouteHeadsigns(gtfsDir);
  console.log(`Found headsigns for ${Object.keys(routeHeadsigns).length} routes`);

  // Save mappings as JSON files
  fs.writeFileSync(
    path.join(outputDir, "route-to-stations.json"),
    JSON.stringify(routeToStations, null, 2)
  );

  fs.writeFileSync(
    path.join(outputDir, "station-to-routes.json"),
    JSON.stringify(stationToRoutes, null, 2)
  );

  fs.writeFileSync(
    path.join(outputDir, "route-headsigns.json"),
    JSON.stringify(routeHeadsigns, null, 2)
  );

  // Also create simplified versions for quick lookups
  const simpleRouteToStations: Record<string, string[]> = {};
  Object.entries(routeToStations).forEach(([routeId, data]) => {
    simpleRouteToStations[routeId] = data.stations.map((s) => s.stopId);
  });

  const simpleStationToRoutes: Record<string, string[]> = {};
  Object.entries(stationToRoutes).forEach(([stationId, data]) => {
    simpleStationToRoutes[stationId] = data.routes.map((r) => r.routeId);
  });

  fs.writeFileSync(
    path.join(outputDir, "simple-route-to-stations.json"),
    JSON.stringify(simpleRouteToStations, null, 2)
  );

  fs.writeFileSync(
    path.join(outputDir, "simple-station-to-routes.json"),
    JSON.stringify(simpleStationToRoutes, null, 2)
  );

  console.log("Mappings saved to lib/ directory");

  // Print some examples
  console.log("\n--- Example: A train stations ---");
  const aTrain = routeToStations["A"];
  if (aTrain) {
    console.log(`A train serves ${aTrain.stations.length} stations`);
    console.log("First 5:", aTrain.stations.slice(0, 5).map((s) => s.name));
  }

  console.log("\n--- Example: Times Sq-42 St routes ---");
  const timesSq = stationToRoutes["127"]; // Times Sq station ID
  if (timesSq) {
    console.log(
      `Times Sq-42 St is served by routes: ${timesSq.routes
        .map((r) => r.shortName)
        .join(", ")}`
    );
  }

  console.log("\n--- Example: Route headsigns ---");
  const fHeadsigns = routeHeadsigns["F"];
  if (fHeadsigns) {
    console.log(`F train headsigns:`);
    console.log(`  Northbound: ${fHeadsigns.N.join(", ")}`);
    console.log(`  Southbound: ${fHeadsigns.S.join(", ")}`);
  }
}

