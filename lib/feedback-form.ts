import { fetchWithTimeout } from '@/lib/fetch-with-timeout';

export type FeedbackField = 'context' | 'message' | 'email';

export type FeedbackValues = Record<FeedbackField, string>;

export type FeedbackErrors = Partial<Record<FeedbackField, string>>;

export const FEEDBACK_WEBHOOK_ENV = 'FEEDBACK_WEBHOOK_URL';

export const MESSAGE_MAX_LENGTH = 4000;
export const CONTEXT_MAX_LENGTH = 200;
export const EMAIL_MAX_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEBHOOK_TIMEOUT_MS = 15000;

export function resolveFeedbackWebhookUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function validateFeedback(values: FeedbackValues): FeedbackErrors {
  const errors: FeedbackErrors = {};
  const context = values.context.trim();
  const message = values.message.trim();
  const email = values.email.trim();

  if (!message) errors.message = 'Describe what happened before transmitting.';
  else if (message.length > MESSAGE_MAX_LENGTH) {
    errors.message = `Keep it under ${MESSAGE_MAX_LENGTH} characters.`;
  }

  if (context.length > CONTEXT_MAX_LENGTH) {
    errors.context = `Keep it under ${CONTEXT_MAX_LENGTH} characters.`;
  }

  if (email) {
    if (email.length > EMAIL_MAX_LENGTH) {
      errors.email = `Keep it under ${EMAIL_MAX_LENGTH} characters.`;
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.email = 'Enter a valid email or leave it blank.';
    }
  }

  return errors;
}

export type FeedbackWebhookPayload = {
  context: string;
  message: string;
  email?: string;
  submittedAt: string;
};

export function buildFeedbackWebhookPayload(values: FeedbackValues): FeedbackWebhookPayload {
  const email = values.email.trim();
  return {
    context: values.context.trim(),
    message: values.message.trim(),
    ...(email ? { email } : {}),
    submittedAt: new Date().toISOString(),
  };
}

export async function forwardFeedbackToWebhook(
  webhookUrl: string,
  values: FeedbackValues
): Promise<void> {
  // Apps Script web apps issue a 302 to a googleusercontent host; follow it server-side.
  const response = await fetchWithTimeout(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
    },
    body: JSON.stringify(buildFeedbackWebhookPayload(values)),
    redirect: 'follow',
    timeoutMs: WEBHOOK_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Feedback webhook responded with ${response.status}`);
  }
}
