import type { EstimatedTrain } from '@/lib/train-positions';

/**
 * Pure time math for the spaceport network. Every rocket's phase is a function of `now` and its trip
 * estimate only, so a rocket that scrolls into view (or a scene that mounts late) is already in the right place.
 *
 * A rocket's timeline: pad at `from` → launch at departedAt → fly → land at `to` (arrivesAt) → dwell →
 * launch at departsAt → fly → land at `next` (nextArrivesAt) → pad.
 */
export type RocketPhase = 'pad' | 'flight';

export interface RocketState {
  phase: RocketPhase;
  /** 0 = first leg (from→to), 1 = second leg (to→next). Only meaningful in flight. */
  leg: 0 | 1;
  /** Progress along the current leg, 0..1. */
  progress: number;
  /** Station the rocket is on (pad) or flying toward (flight). */
  station: string;
  secondsToTouchdown: number;
}

/** Final seconds of a flight that count as "landing" (descent + landing burn). */
export const LANDING_WINDOW_SECONDS = 15;

export function rocketState(train: EstimatedTrain, now: number): RocketState {
  const moving = train.from !== train.to;
  if (moving && now < train.departedAt) {
    return { phase: 'pad', leg: 0, progress: 0, station: train.from, secondsToTouchdown: Infinity };
  }
  if (moving && now < train.arrivesAt) {
    return {
      phase: 'flight',
      leg: 0,
      progress: fraction(now, train.departedAt, train.arrivesAt),
      station: train.to,
      secondsToTouchdown: train.arrivesAt - now,
    };
  }
  if (now < train.departsAt || !train.next || train.nextArrivesAt === undefined) {
    return { phase: 'pad', leg: 0, progress: 1, station: train.to, secondsToTouchdown: Infinity };
  }
  if (now < train.nextArrivesAt) {
    return {
      phase: 'flight',
      leg: 1,
      progress: fraction(now, train.departsAt, train.nextArrivesAt),
      station: train.next,
      secondsToTouchdown: train.nextArrivesAt - now,
    };
  }
  return { phase: 'pad', leg: 1, progress: 1, station: train.next, secondsToTouchdown: Infinity };
}

function fraction(now: number, start: number, end: number) {
  const span = end - start;
  return span <= 0 ? 1 : Math.min(1, Math.max(0, (now - start) / span));
}

export type EventKind = 'launch' | 'landing';

export interface NetworkEvent {
  kind: EventKind;
  station: string;
  time: number;
  train: EstimatedTrain;
  /** Station the rocket launches toward (launch) or came from (landing). */
  other?: string;
}

/** Launch and landing events in a train's timeline, in order. */
export function trainEvents(train: EstimatedTrain): NetworkEvent[] {
  const events: NetworkEvent[] = [];
  if (train.from !== train.to) {
    events.push({ kind: 'launch', station: train.from, time: train.departedAt, train, other: train.to });
    events.push({ kind: 'landing', station: train.to, time: train.arrivesAt, train, other: train.from });
  }
  if (train.next && train.nextArrivesAt !== undefined) {
    events.push({ kind: 'launch', station: train.to, time: train.departsAt, train, other: train.next });
    events.push({ kind: 'landing', station: train.next, time: train.nextArrivesAt, train, other: train.to });
  }
  return events;
}

export interface NetworkSummary {
  total: number;
  inFlight: number;
  landing: number;
  onPad: number;
  nextLaunch: NetworkEvent | null;
}

export function summarizeNetwork(trains: EstimatedTrain[], now: number): NetworkSummary {
  let inFlight = 0;
  let landing = 0;
  let nextLaunch: NetworkEvent | null = null;
  for (const train of trains) {
    const state = rocketState(train, now);
    if (state.phase === 'flight') {
      if (state.secondsToTouchdown <= LANDING_WINDOW_SECONDS) landing++;
      else inFlight++;
    }
    for (const event of trainEvents(train)) {
      if (event.kind === 'launch' && event.time > now && (!nextLaunch || event.time < nextLaunch.time)) nextLaunch = event;
    }
  }
  return { total: trains.length, inFlight, landing, onPad: trains.length - inFlight - landing, nextLaunch };
}

/** Upcoming landings and launches at one spaceport, soonest first. */
export function spaceportManifest(trains: EstimatedTrain[], stationId: string, now: number, horizonSeconds = 20 * 60) {
  const landings: NetworkEvent[] = [];
  const launches: NetworkEvent[] = [];
  for (const train of trains) {
    for (const event of trainEvents(train)) {
      if (event.station !== stationId || event.time <= now - 2 || event.time > now + horizonSeconds) continue;
      (event.kind === 'landing' ? landings : launches).push(event);
    }
  }
  landings.sort((a, b) => a.time - b.time);
  launches.sort((a, b) => a.time - b.time);
  return { landings, launches };
}

/** A rocket currently on this pad (landed and not yet launched), if any. */
export function rocketOnPad(trains: EstimatedTrain[], stationId: string, now: number): EstimatedTrain | null {
  let best: EstimatedTrain | null = null;
  for (const train of trains) {
    const state = rocketState(train, now);
    if (state.phase !== 'pad' || state.station !== stationId) continue;
    const departs = state.station === train.to && train.next ? train.departsAt : Infinity;
    if (departs === Infinity) continue;
    if (!best || departs < best.departsAt) best = train;
  }
  return best;
}

export function formatTMinus(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `T−${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds of descent shown before touchdown, ignition lead before liftoff, and climb-out after it. */
export const DESCENT_SECONDS = 12;
export const IGNITION_LEAD_SECONDS = 3;
export const CLIMB_SECONDS = 9;
/** A replay cycle: descent, dwell, ignition + climb, a short pause. */
export const REPLAY_TOUCHDOWN = DESCENT_SECONDS + 0.5;
export const REPLAY_LIFTOFF = REPLAY_TOUCHDOWN + 9;
export const REPLAY_CYCLE = REPLAY_LIFTOFF + CLIMB_SECONDS + 2;

export interface PadPlan {
  touchdownAt: number | null;
  liftoffAt: number | null;
  landing: NetworkEvent | null;
  launch: NetworkEvent | null;
}

/** What the close-up pad should be doing now: climbing out, sitting on the pad, or receiving the next inbound. */
export function livePadPlan(trains: EstimatedTrain[], stationId: string, now: number): PadPlan {
  const { landings, launches } = spaceportManifest(trains, stationId, now - CLIMB_SECONDS);
  const climbing = launches.find((e) => e.time <= now && e.time > now - CLIMB_SECONDS);
  if (climbing) return { touchdownAt: null, liftoffAt: climbing.time, landing: null, launch: climbing };

  const onPad = rocketOnPad(trains, stationId, now);
  if (onPad) {
    const launch = launches.find((e) => e.train === onPad && e.time > now) ?? null;
    const landed = landings.find((e) => e.train === onPad) ?? null;
    return { touchdownAt: landed?.time ?? null, liftoffAt: onPad.departsAt, landing: landed, launch };
  }

  const landing = landings.find((e) => e.time > now) ?? null;
  if (!landing) return { touchdownAt: null, liftoffAt: null, landing: null, launch: null };
  const launch = launches.find((e) => e.train === landing.train && e.time > landing.time) ?? null;
  return { touchdownAt: landing.time, liftoffAt: launch?.time ?? null, landing, launch };
}
