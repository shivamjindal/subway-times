'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Settings } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

const WEATHER_CARD_VISIBLE_KEY = 'weatherCardVisible';

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
  const weatherVisible = useSyncExternalStore(
    subscribeToWeatherVisible,
    getWeatherVisibleSnapshot,
    () => true // server snapshot
  );
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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="h-9 w-9 rounded-full bg-muted p-1 transition-all duration-300 hover:bg-muted/80 flex items-center justify-center"
        aria-label="Settings"
        aria-expanded={isOpen}
      >
        <Settings className="h-4 w-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-12 mt-2 w-64 rounded-lg border bg-background shadow-lg p-4 z-50">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Settings</h3>
            <div className="flex items-center justify-between">
              <label htmlFor="weather-toggle" className="text-sm font-medium cursor-pointer">
                Show weather card
              </label>
              <Switch
                id="weather-toggle"
                checked={weatherVisible}
                onCheckedChange={handleWeatherToggle}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
