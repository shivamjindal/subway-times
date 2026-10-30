export type FeedbackField = 'context' | 'message' | 'email';

export type FeedbackValues = Record<FeedbackField, string>;

export type FeedbackForm =
  | {
      status: 'online';
      action: string;
      entries: { context: string; message: string; email: string | null };
    }
  | { status: 'offline'; missing: string[] };

export type FeedbackErrors = Partial<Record<FeedbackField, string>>;

export const FEEDBACK_ENV = {
  action: 'NEXT_PUBLIC_FEEDBACK_FORM_URL',
  context: 'NEXT_PUBLIC_FEEDBACK_ENTRY_CONTEXT',
  message: 'NEXT_PUBLIC_FEEDBACK_ENTRY_MESSAGE',
  email: 'NEXT_PUBLIC_FEEDBACK_ENTRY_EMAIL',
} as const;

export const FEEDBACK_PLACEHOLDERS = {
  action: 'https://docs.google.com/forms/d/e/YOUR_FORM_ID/formResponse',
  context: 'entry.CONTEXT_ID',
  message: 'entry.MESSAGE_ID',
  email: 'entry.EMAIL_ID',
} as const;

export const MESSAGE_MAX_LENGTH = 4000;
export const CONTEXT_MAX_LENGTH = 200;

type RawFeedbackEnv = Partial<Record<keyof typeof FEEDBACK_ENV, string>>;

function parseAction(raw: string | undefined): string | null {
  if (!raw || raw === FEEDBACK_PLACEHOLDERS.action) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // A pasted share link ends in /viewform; responses must go to /formResponse.
    url.pathname = url.pathname.replace(/\/viewform$/, '/formResponse');
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

function parseEntry(raw: string | undefined): string | null {
  const match = raw?.trim().match(/^(?:entry\.)?(\d+)$/);
  return match ? `entry.${match[1]}` : null;
}

export function parseFeedbackForm(env: RawFeedbackEnv): FeedbackForm {
  const action = parseAction(env.action);
  const context = parseEntry(env.context);
  const message = parseEntry(env.message);
  if (!action || !context || !message) {
    const missing: string[] = [];
    if (!action) missing.push(FEEDBACK_ENV.action);
    if (!context) missing.push(FEEDBACK_ENV.context);
    if (!message) missing.push(FEEDBACK_ENV.message);
    return { status: 'offline', missing };
  }
  return {
    status: 'online',
    action,
    entries: { context, message, email: parseEntry(env.email) },
  };
}

// NEXT_PUBLIC_ values are inlined at build time only when referenced literally.
export const feedbackForm = parseFeedbackForm({
  action: process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? FEEDBACK_PLACEHOLDERS.action,
  context: process.env.NEXT_PUBLIC_FEEDBACK_ENTRY_CONTEXT ?? FEEDBACK_PLACEHOLDERS.context,
  message: process.env.NEXT_PUBLIC_FEEDBACK_ENTRY_MESSAGE ?? FEEDBACK_PLACEHOLDERS.message,
  email: process.env.NEXT_PUBLIC_FEEDBACK_ENTRY_EMAIL ?? FEEDBACK_PLACEHOLDERS.email,
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateFeedback(values: FeedbackValues): FeedbackErrors {
  const errors: FeedbackErrors = {};
  const message = values.message.trim();
  const email = values.email.trim();
  if (!message) errors.message = 'Describe what happened before transmitting.';
  else if (message.length > MESSAGE_MAX_LENGTH) {
    errors.message = `Keep it under ${MESSAGE_MAX_LENGTH} characters.`;
  }
  if (values.context.trim().length > CONTEXT_MAX_LENGTH) {
    errors.context = `Keep it under ${CONTEXT_MAX_LENGTH} characters.`;
  }
  if (email && !EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email or leave it blank.';
  return errors;
}

export function encodeFeedback(
  entries: Extract<FeedbackForm, { status: 'online' }>['entries'],
  values: FeedbackValues
): URLSearchParams {
  const body = new URLSearchParams();
  body.set(entries.context, values.context.trim());
  body.set(entries.message, values.message.trim());
  const email = values.email.trim();
  if (entries.email && email) body.set(entries.email, email);
  return body;
}

export async function transmitFeedback(
  form: Extract<FeedbackForm, { status: 'online' }>,
  values: FeedbackValues
): Promise<void> {
  // no-cors makes the response opaque, so only a network failure (a rejected fetch) is observable.
  await fetch(form.action, {
    method: 'POST',
    mode: 'no-cors',
    body: encodeFeedback(form.entries, values),
  });
}
