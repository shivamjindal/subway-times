import { afterEach, describe, expect, it, vi } from 'vitest';

describe('MTA feed URLs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('points at the MTA endpoint by default', async () => {
    vi.stubEnv('MTA_FEED_BASE_URL', '');
    const { FEED_URLS, ALERTS_FEED_URL } = await import('./mta-feeds');
    expect(FEED_URLS.ace).toBe('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace');
    expect(ALERTS_FEED_URL).toBe('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts');
  });

  it('rebases every feed onto MTA_FEED_BASE_URL', async () => {
    vi.stubEnv('MTA_FEED_BASE_URL', 'http://127.0.0.1:3901/');
    const { FEED_URLS, ALERTS_FEED_URL } = await import('./mta-feeds');
    expect(Object.values(FEED_URLS).every((url) => url.startsWith('http://127.0.0.1:3901/nyct%2Fgtfs'))).toBe(true);
    expect(FEED_URLS['1234567']).toBe('http://127.0.0.1:3901/nyct%2Fgtfs');
    expect(ALERTS_FEED_URL).toBe('http://127.0.0.1:3901/camsys%2Fsubway-alerts');
  });
});
