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
  it('requires a message and a well-formed optional email', () => {
    expect(validateFeedback({ context: '', message: '   ', email: 'nope' })).toEqual({
      message: expect.any(String),
      email: expect.any(String),
    });
    expect(validateFeedback({ context: '', message: 'Rocket stuck on pad', email: '' })).toEqual({});
  });

  it('enforces field length caps', () => {
    expect(
      validateFeedback({
        context: 'x'.repeat(201),
        message: 'ok',
        email: '',
      }).context
    ).toEqual(expect.any(String));
    expect(
      validateFeedback({
        context: '',
        message: 'm'.repeat(4001),
        email: '',
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

  it('trims fields and omits a blank email', () => {
    expect(
      buildFeedbackWebhookPayload({
        context: ' Tracking L08 ',
        message: ' Map froze ',
        email: '  ',
      })
    ).toEqual({
      context: 'Tracking L08',
      message: 'Map froze',
      submittedAt: '2026-10-30T19:00:00.000Z',
    });

    expect(
      buildFeedbackWebhookPayload({
        context: '',
        message: 'Hi',
        email: ' a@b.co ',
      })
    ).toEqual({
      context: '',
      message: 'Hi',
      email: 'a@b.co',
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
      email: '',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://script.google.com/macros/s/abc/exec');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('follow');
    expect(JSON.parse(init.body)).toMatchObject({ context: 'x', message: 'y' });

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(
      forwardFeedbackToWebhook('https://script.google.com/macros/s/abc/exec', {
        context: '',
        message: 'y',
        email: '',
      })
    ).rejects.toThrow(/500/);
  });
});
