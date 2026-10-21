'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  };
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const subscribeReducedMotion = subscribeMedia(REDUCED_MOTION);

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

export function usePageVisible() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => true,
  );
}

let webglSupported: boolean | undefined;

function detectWebGL() {
  if (webglSupported === undefined) {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      webglSupported = gl !== null;
      // Browsers cap live contexts (~16); release the probe immediately.
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webglSupported = false;
    }
  }
  return webglSupported;
}

const noopSubscribe = () => () => {};

/** `null` during SSR/hydration, then whether a WebGL context can be created. */
export function useWebGLSupport(): boolean | null {
  return useSyncExternalStore(noopSubscribe, detectWebGL, () => null);
}

/** Flips to true once the browser is idle, so WebGL chunks never compete with first paint. */
export function useIdleMount(timeout = 1500) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setReady(true), { timeout });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setReady(true), 300);
    return () => window.clearTimeout(id);
  }, [timeout]);

  return ready;
}

export function useInView(ref: RefObject<Element | null>) {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return inView;
}
