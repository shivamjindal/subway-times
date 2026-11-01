'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Orbit, RefreshCcw } from 'lucide-react';
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
    <div className="hidden md:flex items-center gap-5 font-mono text-xs tabular-nums">
      <div className="text-right">
        <div className="hud-label">Local · NYC</div>
        <div className="mt-1 text-foreground">{now ? format(now, 'America/New_York') : '--:--:--'}</div>
      </div>
      <div className="text-right">
        <div className="hud-label">UTC · world time</div>
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
        <div className="container mx-auto max-w-6xl px-4 h-16 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative h-9 w-9 shrink-0 hidden sm:flex items-center justify-center border border-foreground/30">
              <Orbit className="h-5 w-5 text-telemetry animate-orbit-slow" />
              <span className="absolute -top-px -right-px h-1.5 w-1.5 bg-ignition" />
            </div>
            <div className="min-w-0">
              <div className="hud-label truncate">Mission Control // NYC Transit</div>
              <h1 className="hud-title text-lg sm:text-2xl font-bold mt-1 truncate">Subway Times</h1>
            </div>
          </div>
          <Link
            href="/feedback"
            aria-label="Submit feedback"
            className="hud-title h-11 sm:h-12 px-3 sm:px-6 flex items-center whitespace-nowrap bg-abort text-white text-base sm:text-lg font-bold tracking-[0.14em] sm:tracking-[0.18em] border border-white/20 shadow-[0_0_18px_-4px_var(--abort)] transition-[background-color,box-shadow,transform] hover:bg-abort-hover hover:shadow-[0_0_26px_-2px_var(--abort)] active:translate-y-px active:bg-abort-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <span>
              <span className="hidden lg:inline">Submit </span>Feedback
            </span>
          </Link>
          <div className="flex items-center justify-end gap-4">
            <MissionClock />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="h-9 w-9 border bg-card flex items-center justify-center transition-colors hover:border-telemetry hover:text-telemetry disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Refresh arrivals"
                title="Resync telemetry"
              >
                <RefreshCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
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
