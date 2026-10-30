import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_PLACEHOLDERS,
  encodeFeedback,
  parseFeedbackForm,
  transmitFeedback,
  validateFeedback,
} from './feedback-form';

const configured = {
  action: 'https://docs.google.com/forms/d/e/abc123/formResponse',
  context: 'entry.111',
  message: 'entry.222',
  email: 'entry.333',
};

describe('parseFeedbackForm', () => {
  it('is offline with every required var named when only placeholders are set', () => {
    expect(parseFeedbackForm(FEEDBACK_PLACEHOLDERS)).toEqual({
      status: 'offline',
      missing: [
        'NEXT_PUBLIC_FEEDBACK_FORM_URL',
        'NEXT_PUBLIC_FEEDBACK_ENTRY_CONTEXT',
        'NEXT_PUBLIC_FEEDBACK_ENTRY_MESSAGE',
      ],
    });
  });

  it('is offline when the URL is not http(s)', () => {
    expect(parseFeedbackForm({ ...configured, action: 'javascript:alert(1)' }).status).toBe('offline');
  });

  it('accepts bare numeric IDs and rewrites a viewform link to formResponse', () => {
    expect(
      parseFeedbackForm({
        action: 'https://docs.google.com/forms/d/e/abc123/viewform?usp=pp_url&entry.111=x',
        context: '111',
        message: ' entry.222 ',
      })
    ).toEqual({
      status: 'online',
      action: 'https://docs.google.com/forms/d/e/abc123/formResponse',
      entries: { context: 'entry.111', message: 'entry.222', email: null },
    });
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
});

describe('encodeFeedback', () => {
  it('sends trimmed entry.* fields and omits a blank email', () => {
    const online = parseFeedbackForm(configured);
    if (online.status !== 'online') throw new Error('expected online config');
    expect(
      encodeFeedback(online.entries, { context: ' Tracking L08 ', message: 'Map froze', email: '' }).toString()
    ).toBe('entry.111=Tracking+L08&entry.222=Map+froze');
    expect(
      encodeFeedback(online.entries, { context: '', message: 'Hi', email: 'a@b.co' }).toString()
    ).toBe('entry.111=&entry.222=Hi&entry.333=a%40b.co');
  });
});

describe('transmitFeedback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts form-encoded fields with no-cors and rejects only on network failure', async () => {
    const online = parseFeedbackForm(configured);
    if (online.status !== 'online') throw new Error('expected online config');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal('fetch', fetchMock);

    await transmitFeedback(online, { context: 'x', message: 'y', email: '' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(configured.action);
    expect(init.mode).toBe('no-cors');
    expect(init.method).toBe('POST');
    expect(init.body.toString()).toBe('entry.111=x&entry.222=y');

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(transmitFeedback(online, { context: '', message: 'y', email: '' })).rejects.toThrow();
  });
});
