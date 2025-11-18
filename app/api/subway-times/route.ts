import { NextResponse } from 'next/server';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { parseGTFSFeed } from '@/lib/subway-parser';

const MTA_API_URL_F = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm';
const MTA_API_URL_G = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g';

export async function GET() {
  try {
    const headers: HeadersInit = {};
    if (process.env.MTA_API_KEY) {
      headers['x-api-key'] = process.env.MTA_API_KEY;
    }

    // Fetch both F and G train feeds in parallel
    const [fResponse, gResponse] = await Promise.all([
      fetch(MTA_API_URL_F, {
        headers,
        next: { revalidate: 30 },
      }),
      fetch(MTA_API_URL_G, {
        headers,
        next: { revalidate: 30 },
      }),
    ]);

    if (!fResponse.ok) {
      throw new Error(`MTA API error (F train): ${fResponse.status} ${fResponse.statusText}`);
    }

    if (!gResponse.ok) {
      throw new Error(`MTA API error (G train): ${gResponse.status} ${gResponse.statusText}`);
    }

    const [fBuffer, gBuffer] = await Promise.all([
      fResponse.arrayBuffer(),
      gResponse.arrayBuffer(),
    ]);

    const fFeedMessage = transit_realtime.FeedMessage.decode(new Uint8Array(fBuffer));
    const gFeedMessage = transit_realtime.FeedMessage.decode(new Uint8Array(gBuffer));

    // Parse both feeds
    const { arrivals: fArrivals, alerts: fAlerts } = parseGTFSFeed(fFeedMessage, 'F');
    const { arrivals: gArrivals, alerts: gAlerts } = parseGTFSFeed(gFeedMessage, 'G');

    // Combine arrivals and sort by arrival time
    const allArrivals = [...fArrivals, ...gArrivals].sort((a, b) => a.arrivalTime - b.arrivalTime);

    // Combine alerts
    const allAlerts = [...fAlerts, ...gAlerts];

    // Filter alerts to only active ones
    const now = Math.floor(Date.now() / 1000);
    const activeAlerts = allAlerts.filter((alert) => {
      return alert.activePeriods.some((period) => {
        const isActive = period.start <= now && (!period.end || period.end >= now);
        return isActive;
      });
    });

    return NextResponse.json({
      arrivals: allArrivals.slice(0, 10), // Return next 10 trains
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

