'use client';

import { useRef, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { SubwayTimesDisplay, type SubwayTimesDisplayRef } from '@/components/subway-times-display';
import { SettingsButton } from '@/components/settings-button';

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
    <main className="min-h-screen bg-background py-8">
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="h-9 w-9 rounded-full bg-muted p-1 transition-all duration-300 hover:bg-muted/80 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Refresh arrivals"
        >
          <RefreshCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
        <SettingsButton />
      </div>
      <SubwayTimesDisplay ref={subwayTimesRef} />
    </main>
  );
}
