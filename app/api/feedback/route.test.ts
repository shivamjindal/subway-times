import { afterEach, describe, expect, it, vi } from 'vitest';

describe('POST /api/feedback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadRoute() {
    return import('./route');
  }

  it('returns 503 when the webhook env is missing', async () => {
    vi.stubEnv('FEEDBACK_WEBHOOK_URL', '');
    const { POST } = await loadRoute();
    const response = await POST(
      new Request('http://localhost/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ message: 'hi' }),
      })
    );
    expect(response.status).toBe(503);
  });

  it('returns 400 for invalid payloads and soft-drops honeypot traffic', async () => {
    vi.stubEnv('FEEDBACK_WEBHOOK_URL', 'https://script.google.com/macros/s/abc/exec');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await loadRoute();

    const invalid = await POST(
      new Request('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '' }),
      })
    );
    expect(invalid.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const honeypot = await POST(
      new Request('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'spam', website: 'http://bot.test' }),
      })
    );
    expect(honeypot.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards valid submissions to the Apps Script webhook', async () => {
    vi.stubEnv('FEEDBACK_WEBHOOK_URL', 'https://script.google.com/macros/s/abc/exec');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await loadRoute();

    const response = await POST(
      new Request('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: 'Tracking L08',
          message: 'Map froze',
          email: 'a@b.co',
          website: '',
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://script.google.com/macros/s/abc/exec');
    expect(JSON.parse(init.body)).toMatchObject({
      context: 'Tracking L08',
      message: 'Map froze',
      email: 'a@b.co',
    });
  });
});
