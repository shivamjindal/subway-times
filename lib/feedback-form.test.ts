import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildFeedbackWebhookPayload,
  forwardFeedbackToWebhook,
  resolveFeedbackWebhookUrl,
  validateFeedback,
} from './feedback-form';

describe('resolveFeedbackWebhookUrl', () => {
  it('rejects missing, blank, and non-http(s) values', () => {
    expect(resolveFeedbackWebhookUrl(undefined)).toBeNull();
    expect(resolveFeedbackWebhookUrl('  ')).toBeNull();
    expect(resolveFeedbackWebhookUrl('javascript:alert(1)')).toBeNull();
  });

  it('accepts http(s) webhook URLs', () => {
    expect(resolveFeedbackWebhookUrl(' https://script.google.com/macros/s/abc/exec ')).toBe(
      'https://script.google.com/macros/s/abc/exec'
    );
  });
});

describe('validateFeedback', () => {
  it('requires a message', () => {
    expect(validateFeedback({ context: '', message: '   ' })).toEqual({
      message: expect.any(String),
    });
    expect(validateFeedback({ context: '', message: 'Rocket stuck on pad' })).toEqual({});
  });

  it('enforces field length caps', () => {
    expect(
      validateFeedback({
        context: 'x'.repeat(201),
        message: 'ok',
      }).context
    ).toEqual(expect.any(String));
    expect(
      validateFeedback({
        context: '',
        message: 'm'.repeat(4001),
      }).message
    ).toEqual(expect.any(String));
  });
});

describe('buildFeedbackWebhookPayload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T19:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('trims fields', () => {
    expect(
      buildFeedbackWebhookPayload({
        context: ' Tracking L08 ',
        message: ' Map froze ',
      })
    ).toEqual({
      context: 'Tracking L08',
      message: 'Map froze',
      submittedAt: '2026-10-30T19:00:00.000Z',
    });
  });
});

describe('forwardFeedbackToWebhook', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts JSON to the webhook and rejects non-OK responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await forwardFeedbackToWebhook('https://script.google.com/macros/s/abc/exec', {
      context: 'x',
      message: 'y',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://script.google.com/macros/s/abc/exec');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('follow');
    expect(JSON.parse(init.body)).toMatchObject({ context: 'x', message: 'y' });
    expect(JSON.parse(init.body)).not.toHaveProperty('email');

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(
      forwardFeedbackToWebhook('https://script.google.com/macros/s/abc/exec', {
        context: '',
        message: 'y',
      })
    ).rejects.toThrow(/500/);
  });
});
