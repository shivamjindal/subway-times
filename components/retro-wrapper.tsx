'use client';

import { useEffect } from 'react';
import { useRetroUI } from './use-retro-ui';

export function RetroWrapper() {
  const retroEnabled = useRetroUI();

  useEffect(() => {
    if (retroEnabled) {
      document.documentElement.classList.add('retro');
    } else {
      document.documentElement.classList.remove('retro');
    }
  }, [retroEnabled]);

  return null;
}
