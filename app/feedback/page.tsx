import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { FeedbackPanel } from '@/components/feedback-panel';
import { resolveFeedbackWebhookUrl } from '@/lib/feedback-form';

export const metadata: Metadata = {
  title: 'Feedback // Mission Control',
  description: 'Send a transmission to mission control about the Subway Times app',
};

export default function FeedbackPage() {
  const online = Boolean(resolveFeedbackWebhookUrl(process.env.FEEDBACK_WEBHOOK_URL));

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
      <div className="container mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <FeedbackPanel online={online} />
      </div>
    </main>
  );
}
