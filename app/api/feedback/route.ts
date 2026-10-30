import { NextResponse } from 'next/server';
import {
  FEEDBACK_WEBHOOK_ENV,
  forwardFeedbackToWebhook,
  resolveFeedbackWebhookUrl,
  validateFeedback,
  type FeedbackValues,
} from '@/lib/feedback-form';

export const dynamic = 'force-dynamic';

function readValues(body: unknown): FeedbackValues | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const read = (key: keyof FeedbackValues) =>
    typeof record[key] === 'string' ? (record[key] as string) : '';
  return {
    context: read('context'),
    message: read('message'),
    email: read('email'),
  };
}

export async function POST(request: Request) {
  const webhookUrl = resolveFeedbackWebhookUrl(process.env.FEEDBACK_WEBHOOK_URL);
  if (!webhookUrl) {
    return NextResponse.json(
      {
        error: 'Feedback channel offline',
        message: `Set ${FEEDBACK_WEBHOOK_ENV} to the Apps Script web app URL.`,
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON', message: 'Request body must be JSON.' },
      { status: 400 }
    );
  }

  // Bots fill every input; people never see the honeypot, so pretend it worked.
  if (
    body &&
    typeof body === 'object' &&
    typeof (body as Record<string, unknown>).website === 'string' &&
    (body as Record<string, unknown>).website !== ''
  ) {
    return NextResponse.json({ ok: true });
  }

  const values = readValues(body);
  if (!values) {
    return NextResponse.json(
      { error: 'Invalid payload', message: 'Expected context, message, and email fields.' },
      { status: 400 }
    );
  }

  const errors = validateFeedback(values);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 });
  }

  try {
    await forwardFeedbackToWebhook(webhookUrl, values);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Feedback webhook failed', error);
    return NextResponse.json(
      {
        error: 'Transmission failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 }
    );
  }
}
