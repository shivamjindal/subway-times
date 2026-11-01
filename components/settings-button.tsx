'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Settings, Sun, Moon } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useTheme } from 'next-themes';

const WEATHER_CARD_VISIBLE_KEY = 'weatherCardVisible';

function useIsMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function getWeatherVisibleSnapshot(): boolean {
  try {
    const saved = localStorage.getItem(WEATHER_CARD_VISIBLE_KEY);
    if (saved !== null) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.error('Error loading weather visibility setting:', err);
  }
  return true;
}

function subscribeToWeatherVisible(callback: () => void): () => void {
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === WEATHER_CARD_VISIBLE_KEY) {
      callback();
    }
  };
  const handleVisibilityChange = () => {
    callback();
  };

  window.addEventListener('storage', handleStorageChange);
  window.addEventListener('weatherCardVisibilityChange', handleVisibilityChange);

  return () => {
    window.removeEventListener('storage', handleStorageChange);
    window.removeEventListener('weatherCardVisibilityChange', handleVisibilityChange);
  };
}

export function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false);
  const mounted = useIsMounted();
  const weatherVisible = useSyncExternalStore(
    subscribeToWeatherVisible,
    getWeatherVisibleSnapshot,
    () => true // server snapshot
  );
  const { resolvedTheme, setTheme } = useTheme();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleWeatherToggle = (checked: boolean) => {
    try {
      localStorage.setItem(WEATHER_CARD_VISIBLE_KEY, JSON.stringify(checked));
      // Dispatch custom event for same-tab sync
      window.dispatchEvent(new CustomEvent('weatherCardVisibilityChange', {
        detail: { visible: checked }
      }));
    } catch (err) {
      console.error('Error saving weather visibility setting:', err);
    }
  };

  const handleThemeChange = () => {
    const isDark = resolvedTheme === 'dark';
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`h-11 w-11 border bg-card flex items-center justify-center transition-colors hover:border-telemetry hover:text-telemetry ${isOpen ? 'border-telemetry text-telemetry' : ''}`}
        aria-label="Settings"
        aria-expanded={isOpen}
        title="Systems"
      >
        <Settings className={`h-4 w-4 transition-transform duration-500 ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {isOpen && (
        <div className="hud-panel ignite absolute right-0 top-10 mt-2 w-72 bg-popover shadow-2xl shadow-black/50 p-4 z-50">
          <div className="space-y-4">
            <div>
              <div className="hud-label">Systems Config</div>
              <h3 className="hud-title text-lg font-semibold mt-1">Settings</h3>
            </div>
            <div className="hud-divider" />
            <div className="flex items-center justify-between">
              <label htmlFor="weather-toggle" className="text-sm cursor-pointer">
                Show weather panel
              </label>
              <Switch
                id="weather-toggle"
                checked={weatherVisible}
                onCheckedChange={handleWeatherToggle}
              />
            </div>
            {mounted && (
              <div className="flex items-center justify-between">
                <label htmlFor="theme-toggle" className="text-sm cursor-pointer">
                  {resolvedTheme === 'dark' ? 'Deep space (dark)' : 'Daylight ops (light)'}
                </label>
                <button
                  id="theme-toggle"
                  onClick={handleThemeChange}
                  className="h-8 w-8 border flex items-center justify-center hover:border-telemetry transition-colors"
                  aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
                >
                  {resolvedTheme === 'dark' ? (
                    <Moon className="h-4 w-4 text-telemetry" />
                  ) : (
                    <Sun className="h-4 w-4 text-ignition" />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
