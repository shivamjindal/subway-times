'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import { useRetroUI } from './use-retro-ui';

interface SplitFlapTimeProps {
  value: string | number;
  children: ReactNode;
}

export function SplitFlapTime({ value, children }: SplitFlapTimeProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValueRef = useRef<string | number>(value);
  const retroEnabled = useRetroUI();

  useEffect(() => {
    // Only animate if retro mode is enabled and value has changed
    if (retroEnabled && value !== prevValueRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsAnimating(true);
      prevValueRef.current = value;

      // Remove animation class after animation completes (500ms matches keyframe duration)
      const timer = setTimeout(() => {
        setIsAnimating(false);
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [value, retroEnabled]);

  return (
    <div className={isAnimating && retroEnabled ? 'split-flap-animate' : ''}>
      {children}
    </div>
  );
}
