import { NextResponse } from 'next/server';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import { FEED_URLS, getMtaHeaders } from '@/lib/mta-feeds';
import { emptyTrackCoverage, readNyctTracks, type TrackIndex } from '@/lib/nyct-tracks';
import { estimateTrainPositions } from '@/lib/train-positions';

const FEED_REQUEST_TIMEOUT_MS = 10000;

export const dynamic = 'force-dynamic';

// Public, unauthenticated by design: serves only public MTA realtime data, like /api/subway-times.
// Upstream fan-out is bounded by the 30 s fetch revalidate cache.
export async function GET() {
  const headers = getMtaHeaders();
  const results = await Promise.allSettled(
    Object.entries(FEED_URLS).map(async ([feedKey, url]) => {
      const response = await fetchWithTimeout(url, {
        headers,
        next: { revalidate: 30 },
        timeoutMs: FEED_REQUEST_TIMEOUT_MS,
      });
      if (!response.ok) {
        throw new Error(`MTA API error (${feedKey}): ${response.status} ${response.statusText}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      return { buffer, feed: transit_realtime.FeedMessage.decode(buffer) };
    })
  );

  const decoded = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const feeds = decoded.map((d) => d.feed);
  const tracks: TrackIndex = new Map();
  const trackCoverage = emptyTrackCoverage();
  for (const { buffer } of decoded) readNyctTracks(buffer, tracks, trackCoverage);
  const failedFeeds = results.length - feeds.length;

  if (feeds.length === 0) {
    const reason = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason;
    console.error('Error fetching train positions:', reason);
    return NextResponse.json(
      {
        error: 'Failed to fetch train positions',
        message: reason instanceof Error ? reason.message : 'All MTA feeds failed',
      },
      { status: 502 }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  return NextResponse.json({
    trains: estimateTrainPositions(feeds, now, tracks),
    failedFeeds,
    trackCoverage,
    lastUpdated: now,
  });
}
