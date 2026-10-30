import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, RadioTower } from 'lucide-react';
import { feedbackForm } from '@/lib/feedback-form';

export const metadata: Metadata = {
  title: 'Feedback // Mission Control',
  description: 'Send a transmission to mission control about the Subway Times app',
};

export default function FeedbackPage() {
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b bg-background/70 backdrop-blur-md">
        <div className="container mx-auto max-w-6xl px-4 h-16 flex items-center gap-3">
          <Link
            href="/"
            className="h-9 w-9 shrink-0 border bg-card flex items-center justify-center transition-colors hover:border-telemetry hover:text-telemetry"
            aria-label="Back to mission control"
            title="Back to mission control"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="hud-label truncate">Mission Control // Uplink</div>
            <h1 className="hud-title text-2xl font-bold mt-1 truncate">Feedback</h1>
          </div>
        </div>
      </header>
      <div className="container mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <section className="hud-panel p-4 sm:p-8" aria-labelledby="feedback-title">
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
          {/* The frame stays transparent until the form paints, so this backdrop doubles as the loading state. */}
          <div className="relative border bg-[#03050a]">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-telemetry" aria-hidden="true">
              <span className="pulse-dot" />
              <span className="hud-label">Acquiring uplink…</span>
            </div>
            <iframe
              src={feedbackForm.src}
              title="Subway Times feedback form"
              className="relative block w-full h-[min(78vh,1000px)] min-h-[560px]"
            />
          </div>
          <a
            href={feedbackForm.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-telemetry"
          >
            Form not loading? Open it in a new tab
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </section>
      </div>
    </main>
  );
}
