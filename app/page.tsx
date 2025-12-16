'use client';

import { useRef, useState, useSyncExternalStore, useCallback } from 'react';
import { RefreshCcw } from 'lucide-react';
import { SubwayTimesDisplay, type SubwayTimesDisplayRef } from '@/components/subway-times-display';
import { SettingsButton } from '@/components/settings-button';
import { SavedStationsWelcome } from '@/components/saved-stations-welcome';

const STORAGE_KEY = 'selectedStations';
const WELCOME_DISMISSED_KEY = 'welcomeDismissed';

// Check if we should show the welcome screen
function shouldShowWelcome(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const welcomeDismissed = sessionStorage.getItem(WELCOME_DISMISSED_KEY);
    
    if (saved && !welcomeDismissed) {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) && parsed.length > 0;
    }
  } catch (err) {
    console.error('Error checking saved stations:', err);
  }
  return false;
}

// Subscribe to storage changes (for useSyncExternalStore)
function subscribeToStorage(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

export default function Home() {
  const subwayTimesRef = useRef<SubwayTimesDisplayRef>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [initialFilteredStation, setInitialFilteredStation] = useState<string | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  // Use useSyncExternalStore to properly read from localStorage
  const hasSavedStations = useSyncExternalStore(
    subscribeToStorage,
    useCallback(() => shouldShowWelcome(), []),
    useCallback(() => false, []) // Server snapshot
  );

  const showWelcome = hasSavedStations && !welcomeDismissed;

  const handleRefresh = () => {
    setIsRefreshing(true);
    subwayTimesRef.current?.refresh();
    // Reset refreshing state after a short delay
    setTimeout(() => setIsRefreshing(false), 2000);
  };

  const handleStationSelect = (stationId: string) => {
    setInitialFilteredStation(stationId);
    setWelcomeDismissed(true);
    // Remember that welcome was dismissed for this session
    sessionStorage.setItem(WELCOME_DISMISSED_KEY, 'true');
  };

  const handleSkip = () => {
    setWelcomeDismissed(true);
    // Remember that welcome was dismissed for this session
    sessionStorage.setItem(WELCOME_DISMISSED_KEY, 'true');
  };

  // Show welcome screen for returning users
  if (showWelcome) {
    return (
      <SavedStationsWelcome
        onStationSelect={handleStationSelect}
        onSkip={handleSkip}
      />
    );
  }

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
      <SubwayTimesDisplay ref={subwayTimesRef} initialFilteredStation={initialFilteredStation} />
    </main>
  );
}
