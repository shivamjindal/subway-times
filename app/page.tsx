'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageSquareText, Orbit, RefreshCcw } from 'lucide-react';
import { SubwayTimesDisplay, type SubwayTimesDisplayRef } from '@/components/subway-times-display';
import { SettingsButton } from '@/components/settings-button';

function MissionClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const format = (date: Date, timeZone?: string) =>
    date.toLocaleTimeString('en-US', { hour12: false, timeZone });

  return (
    <div className="hidden sm:flex items-center gap-5 font-mono text-xs tabular-nums">
      <div className="text-right">
        <div className="hud-label">Mission clock · NYC time</div>
        <div className="mt-1 text-foreground">{now ? format(now, 'America/New_York') : '--:--:--'}</div>
      </div>
      <div className="text-right">
        <div className="hud-label">UTC · Universal time</div>
        <div className="mt-1 text-muted-foreground">{now ? format(now, 'UTC') : '--:--:--'}</div>
      </div>
    </div>
  );
}

export default function Home() {
  const subwayTimesRef = useRef<SubwayTimesDisplayRef>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    subwayTimesRef.current?.refresh();
    // Reset refreshing state after a short delay
    setTimeout(() => setIsRefreshing(false), 2000);
  };

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b bg-background/70 backdrop-blur-md">
        <div className="container mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative h-9 w-9 shrink-0 flex items-center justify-center border border-foreground/30">
              <Orbit className="h-5 w-5 text-telemetry animate-orbit-slow" />
              <span className="absolute -top-px -right-px h-1.5 w-1.5 bg-ignition" />
            </div>
            <div className="min-w-0">
              <div className="hud-label truncate">Mission Control // NYC Transit</div>
              <h1 className="hud-title text-2xl font-bold mt-1 truncate">Subway Times</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <MissionClock />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="h-11 w-11 border bg-card flex items-center justify-center transition-colors hover:border-telemetry hover:text-telemetry disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Refresh arrivals"
                title="Resync telemetry"
              >
                <RefreshCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
              <Link
                href="/feedback"
                className="h-11 w-11 border bg-card flex items-center justify-center transition-colors hover:border-telemetry hover:text-telemetry"
                aria-label="Send feedback"
                title="Transmit feedback"
              >
                <MessageSquareText className="h-4 w-4" />
              </Link>
              <SettingsButton />
            </div>
          </div>
        </div>
      </header>
      <div className="py-8">
        <SubwayTimesDisplay ref={subwayTimesRef} />
      </div>
    </main>
  );
}
