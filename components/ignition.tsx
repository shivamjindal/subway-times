'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => true,
  );
}

export interface Ignition {
  tripId: string;
  seq: number;
}

interface IgnitionCandidate {
  tripId: string;
  arrivalTime: number;
}

/**
 * Fires once per trip when its countdown drops below `thresholdSeconds`.
 * A trip must first be observed at or above the threshold, so trains that are
 * already arriving on page load (or after a filter change) stay quiet.
 */
export function useIgnition(arrivals: IgnitionCandidate[], now: number, thresholdSeconds: number) {
  const [ignition, setIgnition] = useState<Ignition | null>(null);
  const seenAboveRef = useRef(new Set<string>());
  const firedRef = useRef(new Set<string>());

  useEffect(() => {
    const seenAbove = seenAboveRef.current;
    const fired = firedRef.current;
    const live = new Set<string>();
    let crossed: string | null = null;

    for (const arrival of arrivals) {
      live.add(arrival.tripId);
      if (arrival.arrivalTime - now >= thresholdSeconds) {
        seenAbove.add(arrival.tripId);
      } else if (seenAbove.has(arrival.tripId) && !fired.has(arrival.tripId)) {
        fired.add(arrival.tripId);
        crossed ??= arrival.tripId;
      }
    }

    // Departed trips drop out of the feed; forget them so the sets stay bounded.
    for (const set of [seenAbove, fired]) {
      for (const tripId of set) {
        if (!live.has(tripId)) set.delete(tripId);
      }
    }

    if (crossed) {
      const tripId = crossed;
      setIgnition(prev => ({ tripId, seq: (prev?.seq ?? 0) + 1 }));
    }
  }, [arrivals, now, thresholdSeconds]);

  return ignition;
}

const SHAKE_KEYFRAMES: Keyframe[] = [
  { transform: 'translate3d(0, 0, 0)' },
  { transform: 'translate3d(-2px, 1px, 0)' },
  { transform: 'translate3d(2px, -1px, 0)' },
  { transform: 'translate3d(-1.5px, -1px, 0)' },
  { transform: 'translate3d(1px, 1px, 0)' },
  { transform: 'translate3d(-0.5px, 0, 0)' },
  { transform: 'translate3d(0, 0, 0)' },
];

export function shakeElement(el: HTMLElement | null) {
  el?.animate(SHAKE_KEYFRAMES, { duration: 420, easing: 'ease-out' });
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  spark: boolean;
}

const BURST_MS = 1700;
const EMIT_MS = 600;
const BLEED_PX = 28;

// Hot core → flame → ember → smoke, picked by particle age (0..1).
const PLUME_STOPS: Array<[number, string]> = [
  [0.15, '255, 236, 200'],
  [0.4, '255, 150, 60'],
  [0.7, '255, 90, 31'],
  [1, '140, 150, 175'],
];

function makeSprite(rgb: string) {
  const size = 64;
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = size;
  const g = sprite.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb}, 1)`);
  grad.addColorStop(0.35, `rgba(${rgb}, 0.55)`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return sprite;
}

/**
 * One-shot 2D-canvas exhaust plume anchored on `originRef` (the route bullet).
 * The canvas exists only while the burst plays, so idle cards hold no context.
 */
export function IgnitionBurst({ originRef, onDone }: { originRef: React.RefObject<HTMLElement | null>; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.scale(dpr, dpr);

    const origin = originRef.current?.getBoundingClientRect();
    const ox = origin ? origin.left + origin.width / 2 - rect.left : BLEED_PX + 36;
    // Exhaust rides the row's bottom border so it never sits under the arrival text.
    const oy = rect.height - BLEED_PX;
    const sprites = PLUME_STOPS.map(([, rgb]) => makeSprite(rgb));

    const particles: Particle[] = [];
    const spawn = (count: number) => {
      for (let i = 0; i < count; i++) {
        // Exhaust hits the row's base and spreads sideways, mostly trailing right.
        const dir = Math.random() < 0.92 ? 1 : -1;
        const spark = Math.random() < 0.18;
        particles.push({
          x: ox + 8 + Math.random() * 10,
          y: oy,
          vx: dir * (0.04 + Math.random() * (spark ? 0.7 : 0.35)),
          vy: 0.04 + Math.random() * 0.1,
          age: 0,
          life: (spark ? 400 : 650) + Math.random() * 700,
          size: spark ? 1.2 : 6 + Math.random() * 10,
          spark,
        });
      }
    };

    const start = performance.now();
    let last = start;
    let frame = 0;

    const tick = (t: number) => {
      const elapsed = t - start;
      const dt = Math.min(t - last, 48);
      last = t;

      if (elapsed < EMIT_MS) spawn(elapsed < 120 ? 10 : 4);

      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.globalCompositeOperation = 'lighter';

      if (elapsed < 360) {
        const k = 1 - elapsed / 360;
        const flash = ctx.createRadialGradient(ox, oy, 0, ox, oy, 40 + 20 * k);
        flash.addColorStop(0, `rgba(255, 220, 170, ${0.5 * k})`);
        flash.addColorStop(1, 'rgba(255, 90, 31, 0)');
        ctx.fillStyle = flash;
        ctx.fillRect(0, 0, rect.width, rect.height);
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        p.vx *= 0.986;
        p.vy = p.vy * 0.96 - 0.0001 * dt;
        p.x += p.vx * dt;
        p.y = Math.min(p.y + p.vy * dt, oy + 14);

        const life = p.age / p.life;
        const fade = life < 0.1 ? life / 0.1 : 1 - (life - 0.1) / 0.9;
        if (p.spark) {
          ctx.strokeStyle = `rgba(255, 210, 150, ${fade})`;
          ctx.lineWidth = p.size;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 22, p.y - p.vy * 22);
          ctx.stroke();
          continue;
        }
        const stage = PLUME_STOPS.findIndex(([until]) => life <= until);
        const radius = p.size * (0.6 + life * 1.6);
        ctx.globalAlpha = fade * (stage === 3 ? 0.4 : 0.9);
        ctx.drawImage(sprites[stage], p.x - radius, p.y - radius, radius * 2, radius * 2);
        ctx.globalAlpha = 1;
      }

      if (elapsed < BURST_MS) {
        frame = requestAnimationFrame(tick);
      } else {
        onDoneRef.current();
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [originRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute z-0"
      style={{ inset: -BLEED_PX, width: `calc(100% + ${BLEED_PX * 2}px)`, height: `calc(100% + ${BLEED_PX * 2}px)` }}
    />
  );
}
