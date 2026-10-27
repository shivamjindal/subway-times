import { padId } from '@/lib/spaceports';
import type { EstimatedTrain } from '@/lib/train-positions';

/**
 * Pure time math for the spaceport network. A rocket is a train's ordered pad visits: it arrives over a berth,
 * lands once the berth is clear, dwells, launches toward the next visit. Every phase is a function of `now` and
 * the plan only, so a rocket that scrolls into view (or a scene that mounts late) is already in the right place.
 *
 * A berth is one landing site: a pad (platform: stop ID + direction), split by NYCT track when every train at
 * that pad reports one. Two rockets never share a berth at once: a later arrival holds in a hover until the
 * previous rocket has lifted off and cleared.
 */

/** After a liftoff, the berth stays closed this long so the climbing booster is clear of the next descent. */
export const PAD_CLEAR_SECONDS = 8;
/** A rocket delayed by a hold still sits on the pad at least this long before relaunching. */
export const MIN_PAD_SECONDS = 8;
/** How long a rocket stays on the pad at its last known stop before it's dropped (terminal, or stale data). */
export const FINAL_DWELL_SECONDS = 30;
/**
 * A rocket already on a pad when first tracked (just departed in the feed, or standing at a terminal) occupies it
 * only this long before liftoff; trains laid up at a terminal for minutes are in the hangar, not on the pad.
 */
const PRIOR_DWELL_SECONDS = 20;

export interface PadVisit {
  station: string;
  /** GTFS stop ID of the platform. */
  pad: string;
  /** Landing site within the pad: the pad ID, or `${pad}:${track}` when the pad is split by track. */
  berth: string;
  track?: string;
  /** Station the rocket lands from; undefined when it was already on the pad when first tracked. */
  from?: string;
  /** Station it launches toward; undefined at the last known stop. */
  to?: string;
  /** Predicted arrival over the berth. */
  arriveAt: number;
  /** Touchdown: later than `arriveAt` when the rocket had to hold for a busy berth. */
  landAt: number;
  /** Liftoff, or Infinity at the last known stop. */
  launchAt: number;
  /** When the rocket is off the berth: liftoff, or the end of its final dwell. */
  clearsAt: number;
}

export interface Rocket {
  train: EstimatedTrain;
  visits: PadVisit[];
}

export interface Fleet {
  rockets: Rocket[];
  /** Pad ID -> its berths in use, sorted. A pad not split by track has one berth equal to its ID. */
  berths: Map<string, string[]>;
}

export const berthTrack = (berth: string) => berth.split(':')[1];

type RawVisit = Pick<PadVisit, 'station' | 'pad' | 'track' | 'from' | 'to' | 'arriveAt' | 'launchAt'>;

function rawVisits(train: EstimatedTrain): RawVisit[] {
  const visits: RawVisit[] = [];
  const pad = (station: string) => padId(station, train.direction);
  const moving = train.from !== train.to;
  const hasNext = train.next !== undefined && train.nextArrivesAt !== undefined;
  if (moving) {
    visits.push({
      station: train.from,
      pad: pad(train.from),
      // A schedule-basis origin is backed out of the timetable, not listed in the feed; trains keep their
      // local/express track between adjacent stops, so it inherits the track at `to`.
      track: train.fromTrack ?? (train.basis === 'schedule' ? train.toTrack : undefined),
      to: train.to,
      arriveAt: train.departedAt - PRIOR_DWELL_SECONDS,
      launchAt: train.departedAt,
    });
  }
  visits.push({
    station: train.to,
    pad: pad(train.to),
    track: train.toTrack,
    from: moving ? train.from : undefined,
    to: hasNext ? train.next : undefined,
    arriveAt: moving || !hasNext ? train.arrivesAt : Math.max(train.arrivesAt, train.departsAt - PRIOR_DWELL_SECONDS),
    launchAt: hasNext ? train.departsAt : Infinity,
  });
  if (hasNext) {
    visits.push({
      station: train.next!,
      pad: pad(train.next!),
      track: train.nextTrack,
      from: train.to,
      arriveAt: train.nextArrivesAt!,
      launchAt: Infinity,
    });
  }
  return visits;
}

/**
 * Sequences every berth: visits land in arrival order, each one no earlier than the previous occupant's liftoff
 * plus PAD_CLEAR_SECONDS. A held rocket's later legs shift by the same delay. Mutates and returns `visits`.
 */
export function queueVisits<T extends { visits: PadVisit[] }>(owners: T[], key: (owner: T) => string = () => ''): T[] {
  const order: Array<{ owner: T; index: number; tie: string }> = [];
  for (const owner of owners) owner.visits.forEach((_, index) => order.push({ owner, index, tie: key(owner) }));
  order.sort(
    (a, b) => a.owner.visits[a.index].arriveAt - b.owner.visits[b.index].arriveAt || a.tie.localeCompare(b.tie) || a.index - b.index
  );
  const clearAt = new Map<string, number>();
  const delays = new Map<T, number>();
  for (const { owner, index } of order) {
    const visit = owner.visits[index];
    const delay = delays.get(owner) ?? 0;
    visit.arriveAt += delay;
    visit.landAt = Math.max(visit.arriveAt, clearAt.get(visit.berth) ?? -Infinity);
    if (Number.isFinite(visit.launchAt)) {
      const scheduled = visit.launchAt + delay;
      visit.launchAt = Math.max(scheduled, visit.landAt + MIN_PAD_SECONDS);
      delays.set(owner, delay + visit.launchAt - scheduled);
    }
    visit.clearsAt = Number.isFinite(visit.launchAt) ? visit.launchAt : visit.landAt + FINAL_DWELL_SECONDS;
    clearAt.set(visit.berth, visit.clearsAt + PAD_CLEAR_SECONDS);
  }
  return owners;
}

/** Assigns every train's arrivals and departures to berths and queues them. Deterministic for a given snapshot. */
export function planFleet(trains: EstimatedTrain[]): Fleet {
  const raw = trains.map(rawVisits);
  // Split a pad by track only when every train using it reports one; otherwise one untracked train could
  // share a site with a tracked one.
  const padTracks = new Map<string, Set<string> | null>();
  for (const visits of raw) {
    for (const v of visits) {
      const tracks = padTracks.get(v.pad);
      if (tracks === null) continue;
      if (!v.track) padTracks.set(v.pad, null);
      else if (tracks) tracks.add(v.track);
      else padTracks.set(v.pad, new Set([v.track]));
    }
  }
  const berthOf = (v: RawVisit) => (padTracks.get(v.pad) && v.track ? `${v.pad}:${v.track}` : v.pad);

  const rockets: Rocket[] = trains.map((train, i) => ({
    train,
    visits: raw[i].map((v) => ({ ...v, berth: berthOf(v), landAt: v.arriveAt, clearsAt: v.launchAt })),
  }));
  queueVisits(rockets, (r) => r.train.id);

  const berths = new Map<string, string[]>();
  for (const [pad, tracks] of padTracks) {
    berths.set(pad, tracks && tracks.size > 0 ? [...tracks].sort().map((t) => `${pad}:${t}`) : [pad]);
  }
  return { rockets, berths };
}

/** 'offstage': not yet tracked at its first pad, or past its final dwell. */
export type RocketPhase = 'offstage' | 'flight' | 'hold' | 'pad';

export interface RocketState {
  phase: RocketPhase;
  /** Visit the rocket is at, holding over, or flying toward. */
  visit: number;
  /** Progress along the leg into `visit`, 0..1. Only meaningful in flight. */
  progress: number;
  station: string;
  secondsToTouchdown: number;
}

export function rocketState(rocket: Rocket, now: number): RocketState {
  const { visits } = rocket;
  for (let i = 0; i < visits.length; i++) {
    const v = visits[i];
    if (now < v.arriveAt) {
      if (i === 0) break;
      const prev = visits[i - 1];
      return { phase: 'flight', visit: i, progress: fraction(now, prev.launchAt, v.arriveAt), station: v.station, secondsToTouchdown: v.landAt - now };
    }
    if (now < v.landAt) return { phase: 'hold', visit: i, progress: 1, station: v.station, secondsToTouchdown: v.landAt - now };
    if (now < v.clearsAt) return { phase: 'pad', visit: i, progress: 1, station: v.station, secondsToTouchdown: Infinity };
  }
  const first = now < visits[0].arriveAt;
  const v = first ? visits[0] : visits[visits.length - 1];
  return { phase: 'offstage', visit: first ? 0 : visits.length - 1, progress: 0, station: v.station, secondsToTouchdown: Infinity };
}

function fraction(now: number, start: number, end: number) {
  const span = end - start;
  return span <= 0 ? 1 : Math.min(1, Math.max(0, (now - start) / span));
}

/** Final seconds of a flight that count as "landing" (descent + landing burn). */
export const LANDING_WINDOW_SECONDS = 15;

export type EventKind = 'launch' | 'landing';

export interface NetworkEvent {
  kind: EventKind;
  station: string;
  pad: string;
  berth: string;
  time: number;
  train: EstimatedTrain;
  rocket: Rocket;
  /** Index into rocket.visits. */
  visit: number;
  /** Station the rocket launches toward (launch) or came from (landing). */
  other?: string;
  /** Seconds the rocket holds over the berth before this landing. */
  held: number;
}

/** Launch and landing events in a rocket's plan, in order. */
export function rocketEvents(rocket: Rocket): NetworkEvent[] {
  const events: NetworkEvent[] = [];
  rocket.visits.forEach((v, visit) => {
    const base = { station: v.station, pad: v.pad, berth: v.berth, train: rocket.train, rocket, visit };
    if (v.from) events.push({ ...base, kind: 'landing', time: v.landAt, other: v.from, held: v.landAt - v.arriveAt });
    if (v.to && Number.isFinite(v.launchAt)) events.push({ ...base, kind: 'launch', time: v.launchAt, other: v.to, held: 0 });
  });
  return events;
}

export interface NetworkSummary {
  total: number;
  inFlight: number;
  landing: number;
  holding: number;
  onPad: number;
  nextLaunch: NetworkEvent | null;
}

export function summarizeNetwork(rockets: Rocket[], now: number): NetworkSummary {
  let inFlight = 0;
  let landing = 0;
  let holding = 0;
  let onPad = 0;
  let nextLaunch: NetworkEvent | null = null;
  for (const rocket of rockets) {
    const state = rocketState(rocket, now);
    if (state.phase === 'flight') {
      if (state.secondsToTouchdown <= LANDING_WINDOW_SECONDS) landing++;
      else inFlight++;
    } else if (state.phase === 'hold') holding++;
    else if (state.phase === 'pad') onPad++;
    for (const event of rocketEvents(rocket)) {
      if (event.kind === 'launch' && event.time > now && (!nextLaunch || event.time < nextLaunch.time)) nextLaunch = event;
    }
  }
  return { total: rockets.length, inFlight, landing, holding, onPad, nextLaunch };
}

export interface Manifest {
  landings: NetworkEvent[];
  launches: NetworkEvent[];
}

/** Upcoming landings and launches at a spaceport's stations, soonest first. */
export function spaceportManifest(rockets: Rocket[], stationIds: readonly string[], now: number, horizonSeconds = 20 * 60): Manifest {
  const landings: NetworkEvent[] = [];
  const launches: NetworkEvent[] = [];
  for (const rocket of rockets) {
    for (const event of rocketEvents(rocket)) {
      if (!stationIds.includes(event.station) || event.time <= now - 2 || event.time > now + horizonSeconds) continue;
      (event.kind === 'landing' ? landings : launches).push(event);
    }
  }
  landings.sort((a, b) => a.time - b.time);
  launches.sort((a, b) => a.time - b.time);
  return { landings, launches };
}

/** The manifest split by pad, in the given pad order. */
export function manifestByPad(manifest: Manifest, padIds: readonly string[]): Map<string, Manifest> {
  const byPad = new Map<string, Manifest>(padIds.map((id) => [id, { landings: [], launches: [] }]));
  for (const event of manifest.landings) byPad.get(event.pad)?.landings.push(event);
  for (const event of manifest.launches) byPad.get(event.pad)?.launches.push(event);
  return byPad;
}

export function formatTMinus(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `T−${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds of descent shown before touchdown, ignition lead before liftoff, and climb-out after it. */
export const DESCENT_SECONDS = 12;
export const IGNITION_LEAD_SECONDS = 3;
export const CLIMB_SECONDS = 9;
