'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { RadioTower, Send } from 'lucide-react';
import {
  CONTEXT_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  validateFeedback,
  type FeedbackErrors,
  type FeedbackField,
  type FeedbackValues,
} from '@/lib/feedback-form';

type Transmission = 'idle' | 'sending' | 'sent' | 'error';

const STATUS_TEXT = {
  sending: 'Transmitting to mission control…',
  error: 'Transmission failed. Check your connection and try again.',
} as const;

const FIELD_ORDER: FeedbackField[] = ['context', 'message'];

const inputClass =
  'w-full border bg-background/60 px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/70 transition-colors hover:border-foreground/30 focus-visible:border-telemetry focus-visible:outline-2 focus-visible:outline-telemetry/50 aria-[invalid=true]:border-destructive';

function readValues(form: HTMLFormElement): FeedbackValues {
  const data = new FormData(form);
  const read = (name: FeedbackField) => String(data.get(name) ?? '');
  return { context: read('context'), message: read('message') };
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 font-mono text-xs text-destructive">
      {message}
    </p>
  );
}

function OfflinePanel() {
  return (
    <section className="hud-panel p-6 sm:p-8" aria-labelledby="feedback-offline-title">
      <div className="hud-label flex items-center gap-2 !text-caution">
        <span className="pulse-dot" aria-hidden="true" /> Uplink offline
      </div>
      <h2 id="feedback-offline-title" className="hud-title text-3xl sm:text-4xl font-bold mt-3">
        Feedback channel offline
      </h2>
      <p className="mt-3 text-sm text-muted-foreground">
        Mission control isn&apos;t receiving transmissions right now. Try again later.
      </p>
    </section>
  );
}

function SentPanel({ onReset }: { onReset: () => void }) {
  return (
    <section className="hud-panel hud-panel-accent ignite p-6 sm:p-8" aria-labelledby="feedback-sent-title">
      <div className="hud-label flex items-center gap-2 !text-nominal">
        <span className="pulse-dot" aria-hidden="true" /> Signal acquired
      </div>
      <h2
        id="feedback-sent-title"
        tabIndex={-1}
        ref={(node) => node?.focus()}
        className="hud-title text-3xl sm:text-4xl font-bold mt-3 focus:outline-none"
      >
        Transmission received
      </h2>
      <p className="mt-3 text-sm text-muted-foreground">
        Thanks. Mission control logs every report and reads them all.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onReset}
          className="h-10 px-4 border font-mono text-xs uppercase tracking-[0.18em] transition-colors hover:border-telemetry hover:text-telemetry focus-visible:outline-2"
        >
          Send another
        </button>
        <Link
          href="/"
          className="h-10 px-4 border bg-foreground text-background font-mono text-xs uppercase tracking-[0.18em] flex items-center transition-opacity hover:opacity-85 focus-visible:outline-2"
        >
          Return to mission control
        </Link>
      </div>
    </section>
  );
}

async function transmitFeedback(values: FeedbackValues, website: string): Promise<void> {
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...values, website }),
  });
  if (!response.ok) {
    throw new Error(`Feedback API responded with ${response.status}`);
  }
}

function TransmissionForm() {
  const [transmission, setTransmission] = useState<Transmission>('idle');
  const [errors, setErrors] = useState<FeedbackErrors>({});
  const sending = transmission === 'sending';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const element = event.currentTarget;
    const values = readValues(element);
    const nextErrors = validateFeedback(values);
    setErrors(nextErrors);
    const firstInvalid = FIELD_ORDER.find((field) => nextErrors[field]);
    if (firstInvalid) {
      element.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }

    const website = String(new FormData(element).get('website') ?? '');
    setTransmission('sending');
    try {
      await transmitFeedback(values, website);
      setTransmission('sent');
    } catch {
      setTransmission('error');
    }
  };

  const clearError = (event: FormEvent<HTMLFormElement>) => {
    const name = (event.target as HTMLInputElement).name as FeedbackField;
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  };

  if (transmission === 'sent') {
    return <SentPanel onReset={() => setTransmission('idle')} />;
  }

  return (
    <section className="hud-panel p-6 sm:p-8" aria-labelledby="feedback-title">
      <div className="hud-label flex items-center gap-2">
        <RadioTower className="h-3 w-3 text-telemetry" aria-hidden="true" /> Uplink · Channel FB-01
      </div>
      <h2 id="feedback-title" className="hud-title text-3xl sm:text-4xl font-bold mt-3">
        Transmission to mission control
      </h2>
      <p className="mt-3 text-sm text-muted-foreground">
        Spotted a bug, a wrong arrival, or have an idea? Send it here.
      </p>
      <div className="hud-divider my-6" />

      <form
        noValidate
        onSubmit={handleSubmit}
        onInput={clearError}
        aria-busy={sending}
        className="space-y-5"
      >
        <div>
          <label htmlFor="feedback-context" className="hud-label !text-foreground">
            What were you doing?
          </label>
          <input
            id="feedback-context"
            name="context"
            type="text"
            maxLength={CONTEXT_MAX_LENGTH}
            placeholder="Tracking the L at Bedford Av"
            aria-invalid={Boolean(errors.context)}
            aria-describedby={errors.context ? 'feedback-context-error' : undefined}
            className={`${inputClass} mt-2`}
          />
          <FieldError id="feedback-context-error" message={errors.context} />
        </div>

        <div>
          <label htmlFor="feedback-message" className="hud-label !text-foreground">
            What happened? <span className="text-ignition" aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </label>
          <textarea
            id="feedback-message"
            name="message"
            rows={6}
            required
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder="The rocket for the 8:42 train never landed…"
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? 'feedback-message-error' : undefined}
            className={`${inputClass} mt-2 resize-y min-h-32`}
          />
          <FieldError id="feedback-message-error" message={errors.message} />
        </div>

        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="feedback-website">Website</label>
          <input id="feedback-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        {transmission === 'error' && (
          <div role="alert" className="border border-destructive/60 bg-destructive/10 px-4 py-3">
            <div className="hud-label !text-destructive">Signal lost</div>
            <p className="mt-1.5 text-sm">{STATUS_TEXT.error}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 pt-1">
          <button
            type="submit"
            disabled={sending}
            className="h-11 px-5 border border-ignition bg-ignition text-white font-mono text-xs uppercase tracking-[0.2em] flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-progress focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            {sending ? 'Transmitting…' : transmission === 'error' ? 'Retry transmission' : 'Transmit'}
          </button>
          <p role="status" className="font-mono text-xs text-muted-foreground">
            {sending && (
              <span className="blink mr-1" aria-hidden="true">
                ▮
              </span>
            )}
            {transmission === 'sending' ? STATUS_TEXT.sending : ''}
          </p>
        </div>
      </form>
    </section>
  );
}

export function FeedbackPanel({ online }: { online: boolean }) {
  if (!online) return <OfflinePanel />;
  return <TransmissionForm />;
}
