import { NextResponse } from 'next/server';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { parseGTFSFeed } from '@/lib/subway-parser';
import { getRoutesForStation, getStation } from '@/lib/subway-data';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';

// Map routes to MTA feed groups
const ROUTE_TO_FEED: Record<string, string> = {
  'A': 'ace',
  'C': 'ace',
  'E': 'ace',
  'H': 'ace', // Rockaway Park Shuttle (connects with A line)
  'B': 'bdfm',
  'D': 'bdfm',
  'F': 'bdfm',
  'FX': 'bdfm', // F Express
  'FS': 'bdfm', // Franklin Avenue Shuttle (connects with F line)
  'M': 'bdfm',
  'G': 'g',
  'GS': '1234567', // 42 St Shuttle (connects Grand Central and Times Square)
  'J': 'jz',
  'Z': 'jz',
  'N': 'nqrw',
  'Q': 'nqrw',
  'R': 'nqrw',
  'W': 'nqrw',
  'L': 'l',
  '1': '1234567',
  '2': '1234567',
  '3': '1234567',
  '4': '1234567',
  '5': '1234567',
  '6': '1234567',
  '6X': '1234567', // 6 Express
  '7': '1234567',
  '7X': '1234567', // 7 Express
  'SI': 'si',
};

const FEED_URLS: Record<string, string> = {
  'ace': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
  'bdfm': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
  'g': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
  'jz': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
  'nqrw': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
  'l': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
  '1234567': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
  'si': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si',
};

const ALERTS_FEED_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts';

const DEFAULT_STATION_IDS = ['F24'];
const MAX_STATIONS_PER_REQUEST = 10;
const STATION_ID_REGEX = /^[A-Z0-9]{1,5}$/;
const FEED_REQUEST_TIMEOUT_MS = 10000;

// Force dynamic rendering to prevent caching - ensures fresh data when new stations are added
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stationsParam = searchParams.get('stations');

    const rawStationIds = stationsParam
      ? stationsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_STATION_IDS;

    // Maintain backward compatibility by falling back to default when stations param is empty
    const normalizedStationIds = (rawStationIds.length > 0 ? rawStationIds : DEFAULT_STATION_IDS)
      .map((id) => id.toUpperCase());

    const stationIds = Array.from(new Set(normalizedStationIds));

    if (stationIds.length > MAX_STATIONS_PER_REQUEST) {
      return NextResponse.json(
        {
          error: 'Too many stations requested',
          message: `Requests are limited to ${MAX_STATIONS_PER_REQUEST} stations at a time.`,
        },
        { status: 400 }
      );
    }

    const malformedStationIds = stationIds.filter((id) => !STATION_ID_REGEX.test(id));
    if (malformedStationIds.length > 0) {
      return NextResponse.json(
        {
          error: 'Invalid station IDs provided',
          message: 'Station IDs must be 1-5 alphanumeric characters (e.g., F24).',
          invalidStations: malformedStationIds,
        },
        { status: 400 }
      );
    }

    // Build map of station -> routes and stop IDs
    const stationConfigs: Array<{
      stationId: string;
      stopIds: string[];
      routes: string[];
    }> = [];
    const unknownStationIds: string[] = [];

    for (const stationId of stationIds) {
      const station = getStation(stationId);
      if (!station) {
        unknownStationIds.push(stationId);
        continue;
      }

      const routes = getRoutesForStation(stationId);
      const routeIds = routes.map(r => r.routeId);
      
      // Generate stop IDs: stationId + N and stationId + S
      const stopIds = [`${stationId}N`, `${stationId}S`];
      
      stationConfigs.push({
        stationId,
        stopIds,
        routes: routeIds,
      });
    }

    if (stationConfigs.length === 0) {
      return NextResponse.json(
        {
          error: 'No valid stations found',
          message: 'None of the requested station IDs match known stations.',
          invalidStations: unknownStationIds,
        },
        { status: 400 }
      );
    }

    if (unknownStationIds.length > 0) {
      console.warn(
        `Ignoring unknown station IDs: ${unknownStationIds.join(', ')}`
      );
    }

    // Determine which feeds we need
    const neededFeeds = new Set<string>();
    const stationRoutes = new Set<string>();
    const unmatchedRoutes = new Set<string>();
    
    stationConfigs.forEach(config => {
      config.routes.forEach(routeId => {
        stationRoutes.add(routeId);
        const feed = ROUTE_TO_FEED[routeId];
        if (feed) {
          neededFeeds.add(feed);
        } else {
          // Track unmatched routes for error reporting
          unmatchedRoutes.add(routeId);
        }
      });
    });

    // Report unmatched routes to alert developers
    if (unmatchedRoutes.size > 0) {
      console.warn(
        `Warning: Routes without feed mapping found: ${Array.from(unmatchedRoutes).join(', ')}. ` +
        `These routes will not have arrival data fetched. Please add them to ROUTE_TO_FEED mapping.`
      );
    }

    // Collect all target stop IDs
    const allTargetStopIds = stationConfigs.flatMap(c => c.stopIds);

    const headers: HeadersInit = {};
    if (process.env.MTA_API_KEY) {
      headers['x-api-key'] = process.env.MTA_API_KEY;
    }

    // Fetch all needed feeds in parallel
    const feedPromises = Array.from(neededFeeds).map(async (feedKey) => {
      const url = FEED_URLS[feedKey];
      if (!url) return null;

      const response = await fetchWithTimeout(url, {
        headers,
        next: { revalidate: 30 },
        timeoutMs: FEED_REQUEST_TIMEOUT_MS,
      });

      if (!response.ok) {
        throw new Error(`MTA API error (${feedKey}): ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const feedMessage = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
      
      return { feedKey, feedMessage };
    });

    const feedResults = await Promise.all(feedPromises);
    const validFeeds = feedResults.filter((f): f is { feedKey: string; feedMessage: transit_realtime.FeedMessage } => f !== null);

    let alertsFeed: transit_realtime.FeedMessage | null = null;
    try {
      // Fetch the dedicated subway alerts feed
      const alertsResponse = await fetchWithTimeout(ALERTS_FEED_URL, {
        headers,
        next: { revalidate: 30 },
        timeoutMs: FEED_REQUEST_TIMEOUT_MS,
      });

      if (alertsResponse.ok) {
        const alertsBuffer = await alertsResponse.arrayBuffer();
        alertsFeed = transit_realtime.FeedMessage.decode(new Uint8Array(alertsBuffer));
      } else {
        console.warn(`Failed to fetch alerts feed: ${alertsResponse.status} ${alertsResponse.statusText}`);
      }
    } catch (error) {
      console.warn('Failed to fetch alerts feed due to network error', error);
    }

    // Parse all feeds
    const allArrivals: Array<import('@/lib/subway-parser').TrainArrival> = [];
    const alertsById = new Map<string, import('@/lib/subway-parser').ServiceAlert>();

    for (const { feedMessage } of validFeeds) {
      const { arrivals, alerts } = parseGTFSFeed(
        feedMessage,
        allTargetStopIds,
        Array.from(stationRoutes)
      );
      allArrivals.push(...arrivals);

      // Deduplicate alerts by ID
      for (const alert of alerts) {
        if (!alertsById.has(alert.id)) {
          alertsById.set(alert.id, alert);
        }
      }
    }

    // Parse alerts from the dedicated alerts feed
    if (alertsFeed) {
      const { alerts } = parseGTFSFeed(
        alertsFeed,
        allTargetStopIds,
        Array.from(stationRoutes)
      );

      // Deduplicate alerts by ID
      for (const alert of alerts) {
        if (!alertsById.has(alert.id)) {
          alertsById.set(alert.id, alert);
        }
      }
    }

    const allAlerts = Array.from(alertsById.values());

    // Sort arrivals by arrival time
    allArrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);

    // Filter alerts to only active ones
    const now = Math.floor(Date.now() / 1000);
    const activeAlerts = allAlerts.filter((alert) => {
      return alert.activePeriods.some((period) => {
        const isActive = period.start <= now && (!period.end || period.end >= now);
        return isActive;
      });
    });

    return NextResponse.json({
      arrivals: allArrivals,
      alerts: activeAlerts,
      lastUpdated: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    console.error('Error fetching subway times:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch subway times',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
