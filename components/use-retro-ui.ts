'use client';

import { useSyncExternalStore } from 'react';

const RETRO_UI_KEY = 'retroUIEnabled';

function getRetroUISnapshot(): boolean {
  try {
    const saved = localStorage.getItem(RETRO_UI_KEY);
    if (saved !== null) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.error('Error loading retro UI setting:', err);
  }
  return false;
}

function subscribeToRetroUI(callback: () => void): () => void {
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === RETRO_UI_KEY) {
      callback();
    }
  };
  const handleRetroChange = () => {
    callback();
  };

  window.addEventListener('storage', handleStorageChange);
  window.addEventListener('retroUIEnabledChange', handleRetroChange);

  return () => {
    window.removeEventListener('storage', handleStorageChange);
    window.removeEventListener('retroUIEnabledChange', handleRetroChange);
  };
}

export function useRetroUI(): boolean {
  return useSyncExternalStore(
    subscribeToRetroUI,
    getRetroUISnapshot,
    () => false // server snapshot
  );
}

export function setRetroUIEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(RETRO_UI_KEY, JSON.stringify(enabled));
    // Dispatch custom event for same-tab sync
    window.dispatchEvent(new CustomEvent('retroUIEnabledChange', {
      detail: { enabled }
    }));
  } catch (err) {
    console.error('Error saving retro UI setting:', err);
  }
}
