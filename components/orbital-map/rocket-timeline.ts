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
/**
 * How long a rocket stands on the pad at its last known stop (a terminal, or a train that left the feed) before it
 * lifts off for the yard. A poll that extends the trip in the meantime turns that liftoff into a launch to its next stop.
 */
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

/** When the rocket lifts off the berth: its launch, or at the last known stop its departure for the yard. */
export const liftoffAt = (v: PadVisit) => (Number.isFinite(v.launchAt) ? v.launchAt : v.clearsAt);

export interface Rocket {
  /** Stable across polls: the trip ID the rocket was first tracked under, kept if the feed reassigns the trip. */
  id: string;
  /** The latest estimate for this rocket's train. */
  train: EstimatedTrain;
  visits: PadVisit[];
  /** The plan the rocket was following when the latest poll arrived (at `at`); renderers ease from it to `visits`. */
  previous?: { visits: PadVisit[]; at: number };
}

export interface Fleet {
  rockets: Rocket[];
  /** Pad ID -> its berths in use, sorted. A pad not split by track has one berth equal to its ID. */
  berths: Map<string, string[]>;
  /** Last track reported per `${pad}|${routeId}`, so a train that drops its track for a poll keeps its berth. */
  tracks: Map<string, string>;
}

export const EMPTY_FLEET: Fleet = { rockets: [], berths: new Map(), tracks: new Map() };

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
 * What a reconcile has already shown and must not change: a landing that has happened (or a final descent that has
 * begun), a launch whose ignition has started, or a hold that can't release before `notBefore`.
 */
export interface Pin {
  land?: boolean;
  launch?: boolean;
  notBefore?: number;
}

/**
 * Sequences every berth: visits land in arrival order, each one no earlier than the previous occupant's liftoff
 * plus PAD_CLEAR_SECONDS. A held rocket's later legs shift by the same delay. Pinned landings and launches keep
 * their times and are placed first, so later arrivals queue behind them. Mutates and returns `owners`.
 */
export function queueVisits<T extends { visits: PadVisit[] }>(
  owners: T[],
  key: (owner: T) => string = () => '',
  pins: ReadonlyMap<PadVisit, Pin> = new Map()
): T[] {
  const order: Array<{ owner: T; index: number; tie: string; visit: PadVisit; landed: boolean }> = [];
  for (const owner of owners) {
    owner.visits.forEach((visit, index) => order.push({ owner, index, tie: key(owner), visit, landed: Boolean(pins.get(visit)?.land) }));
  }
  order.sort(
    (a, b) =>
      Number(b.landed) - Number(a.landed) ||
      (a.landed ? a.visit.landAt - b.visit.landAt : a.visit.arriveAt - b.visit.arriveAt) ||
      a.tie.localeCompare(b.tie) ||
      a.index - b.index
  );
  const clearAt = new Map<string, number>();
  const delays = new Map<T, number>();
  for (const { owner, visit } of order) {
    const pin = pins.get(visit);
    const delay = delays.get(owner) ?? 0;
    if (!pin?.land) {
      visit.arriveAt += delay;
      visit.landAt = Math.max(visit.arriveAt, clearAt.get(visit.berth) ?? -Infinity, pin?.notBefore ?? -Infinity);
    }
    if (Number.isFinite(visit.launchAt) && !pin?.launch) {
      const scheduled = visit.launchAt + delay;
      visit.launchAt = Math.max(scheduled, visit.landAt + MIN_PAD_SECONDS);
      delays.set(owner, delay + visit.launchAt - scheduled);
    }
    visit.clearsAt = Number.isFinite(visit.launchAt) ? visit.launchAt : visit.landAt + FINAL_DWELL_SECONDS;
    clearAt.set(visit.berth, Math.max(clearAt.get(visit.berth) ?? -Infinity, visit.clearsAt + PAD_CLEAR_SECONDS));
  }
  return owners;
}

/** Assigns every train's arrivals and departures to berths and queues them. Deterministic for a given snapshot. */
export function planFleet(trains: EstimatedTrain[]): Fleet {
  return reconcileFleet(EMPTY_FLEET, trains, -Infinity);
}

/** A rocket's hold releases into its final descent no sooner than this after a new poll arrives. */
export const HOLD_RELEASE_SECONDS = 6;
/** Shortest flight a reconcile will schedule when a train has to catch up with the feed. */
const MIN_FLIGHT_SECONDS = 20;
/** A trip that reappears under a new ID is the same rocket if it is predicted within this long of it. */
const REACQUIRE_SECONDS = 180;

const copyVisit = (v: PadVisit): PadVisit => ({ ...v });

/**
 * Continues `old` with a new prediction. Everything the rocket has already done stays as it was shown: the leg it
 * is flying (or the visit it is holding over or standing on), and the visit it launched from. Only events that
 * haven't started take new times, and none is moved into the past. Returns the visits, with berths still to assign
 * for the new ones (`berth === ''`).
 */
function continueRocket(old: Rocket, next: PadVisit[], now: number, pins: Map<PadVisit, Pin>): PadVisit[] {
  const state = rocketState(old, now);
  if (state.phase === 'offstage') return next;
  const kept = old.visits.slice(Math.max(0, state.visit - 1), state.visit + 1).map(copyVisit);
  const current = kept[kept.length - 1];
  const launchedFrom = kept.length > 1 ? kept[0] : undefined;
  if (launchedFrom) pins.set(launchedFrom, { land: true, launch: true });

  const match = next.find((v) => v.station === current.station);
  const stations = new Set(kept.map((v) => v.station));
  let rest = next.slice(match ? next.indexOf(match) + 1 : 0).filter((v) => !stations.has(v.station));

  if (state.phase === 'flight' && launchedFrom) {
    const underway = now - launchedFrom.launchAt < CLIMB_SECONDS || current.arriveAt - now < DESCENT_SECONDS;
    if (!underway && match?.from) {
      // Retime the rest of the leg without moving the rocket: keep its progress along the arc at `now`.
      const arriveAt = Math.max(match.arriveAt, now + DESCENT_SECONDS);
      const progress = fraction(now, launchedFrom.launchAt, current.arriveAt);
      if (progress < 1) {
        launchedFrom.launchAt = launchedFrom.clearsAt = Math.min((now - progress * arriveAt) / (1 - progress), now - CLIMB_SECONDS);
      }
      current.arriveAt = current.landAt = arriveAt;
    }
  } else {
    const descending = current.landAt - now < HOLD_RELEASE_SECONDS;
    pins.set(current, state.phase === 'pad' || descending ? { land: true } : { notBefore: now + HOLD_RELEASE_SECONDS });
  }

  const ignited = liftoffAt(current) - now <= IGNITION_LEAD_SECONDS;
  if (ignited) {
    pins.get(current)!.launch = true;
    if (current.to === undefined && rest.length > 0) {
      current.to = rest[0].station;
      current.launchAt = current.clearsAt;
    }
    const at = rest.findIndex((v) => v.station === current.to);
    rest = at >= 0 ? rest.slice(at) : old.visits.slice(state.visit + 1, state.visit + 2).map(copyVisit);
  } else {
    // No match: the feed has the train past this station already, so it leaves as soon as it can.
    const predicted = match ? match.launchAt : now;
    current.to = rest[0]?.station;
    current.launchAt = current.to === undefined ? Infinity : Math.max(predicted, now + IGNITION_LEAD_SECONDS + 1);
    current.clearsAt = current.launchAt;
  }
  if (!Number.isFinite(current.launchAt)) return kept;

  // The feed may list the next station as one the train is already standing at; this rocket still has to fly there.
  let leaves = current.launchAt;
  let from = current.station;
  const tail = rest.map(copyVisit);
  for (const v of tail) {
    v.from = from;
    v.arriveAt = v.landAt = Math.max(v.arriveAt, leaves + MIN_FLIGHT_SECONDS);
    if (Number.isFinite(v.launchAt)) v.launchAt = Math.max(v.launchAt, v.arriveAt + MIN_PAD_SECONDS);
    v.clearsAt = v.launchAt;
    leaves = v.launchAt;
    from = v.station;
  }
  return [...kept, ...tail];
}

/** The previous rocket a train belongs to: same trip ID, or a reassigned trip predicted where that rocket is. */
function findPrevious(train: EstimatedTrain, next: PadVisit[], previous: Fleet, byId: Map<string, Rocket>, claimed: Set<Rocket>, ids: Set<string>, now: number) {
  const same = byId.get(train.id);
  if (same) return same;
  let best: Rocket | undefined;
  let bestGap = REACQUIRE_SECONDS;
  for (const rocket of previous.rockets) {
    if (claimed.has(rocket) || ids.has(rocket.train.id) || rocket.train.routeId !== train.routeId || rocket.train.direction !== train.direction) continue;
    const state = rocketState(rocket, now);
    if (state.phase === 'offstage' && state.visit > 0) continue;
    const at = rocket.visits[state.visit];
    const there = next.find((v) => v.station === at.station);
    if (!there) continue;
    const gap = Math.min(Math.abs(there.arriveAt - at.arriveAt), Math.abs(there.launchAt - at.launchAt));
    if (gap < bestGap) {
      best = rocket;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Folds a new snapshot into the fleet on screen. Each train keeps its rocket (by trip ID, or by position when the
 * feed reassigns the trip), and each rocket keeps whatever it has already done; a rocket whose train dropped out of
 * the feed finishes what it was doing on its last prediction. Then every berth is queued again around the pinned
 * events. With an empty `previous` this is a plain plan of the snapshot.
 */
export function reconcileFleet(previous: Fleet, trains: EstimatedTrain[], now: number): Fleet {
  const tracks = new Map(previous.tracks);
  const raw = trains.map(rawVisits);
  raw.forEach((visits, i) => visits.forEach((v) => v.track && tracks.set(`${v.pad}|${trains[i].routeId}`, v.track)));

  const byId = new Map(previous.rockets.map((r) => [r.train.id, r]));
  const ids = new Set(trains.map((t) => t.id));
  const claimed = new Set<Rocket>();
  const pins = new Map<PadVisit, Pin>();
  const rockets: Rocket[] = trains.map((train, i) => {
    const visits = raw[i].map((v): PadVisit => ({ ...v, berth: '', landAt: v.arriveAt, clearsAt: v.launchAt }));
    const old = findPrevious(train, visits, previous, byId, claimed, ids, now);
    if (!old) return { id: train.id, train, visits };
    claimed.add(old);
    // A train that drops its track for a poll is still on the same track.
    for (const v of visits) v.track ??= old.visits.find((o) => o.pad === v.pad)?.track ?? tracks.get(`${v.pad}|${train.routeId}`);
    return { id: old.id, train, visits: continueRocket(old, visits, now, pins), previous: { visits: old.visits, at: now } };
  });
  for (const old of previous.rockets) {
    if (claimed.has(old) || rocketState(old, now).phase === 'offstage') continue;
    rockets.push({ ...old, visits: continueRocket(old, old.visits.map(copyVisit), now, pins), previous: { visits: old.visits, at: now } });
  }
  for (const rocket of rockets) {
    if (rocket.visits.length === 0) continue;
    for (const v of rocket.visits) v.track ??= tracks.get(`${v.pad}|${rocket.train.routeId}`);
  }

  // Split a pad by track only when every visit to it has one; otherwise one untracked train could share a site with
  // a tracked one. A pad keeps its previous split while a rocket that was already there is still using it.
  const padTracks = new Map<string, Set<string> | null>();
  for (const rocket of rockets) {
    for (const v of rocket.visits) {
      const known = padTracks.get(v.pad);
      if (known === null) continue;
      if (!v.track) padTracks.set(v.pad, null);
      else if (known) known.add(v.track);
      else padTracks.set(v.pad, new Set([v.track]));
    }
  }
  const settled = new Map<string, Set<string>>();
  for (const rocket of rockets) {
    for (const v of rocket.visits) if (v.berth) settled.set(v.pad, (settled.get(v.pad) ?? new Set()).add(v.berth));
  }
  // Berths are laid out by their index in the pad's list, so a pad keeps every berth it has had while its split
  // holds; a track appearing for one train must not shuffle the others.
  const berths = new Map<string, string[]>();
  for (const [pad, list] of previous.berths) if (!padTracks.has(pad)) berths.set(pad, list);
  for (const [pad, padTrackSet] of padTracks) {
    const inUse = settled.get(pad);
    const split = inUse ? [...inUse].some((b) => b !== pad) : padTrackSet !== null;
    const before = previous.berths.get(pad) ?? [];
    const list = new Set<string>(inUse ?? []);
    if (split) {
      for (const t of padTrackSet ?? []) list.add(`${pad}:${t}`);
      for (const b of before) if (b !== pad) list.add(b);
    } else list.add(pad);
    berths.set(pad, [...list].sort());
  }
  for (const rocket of rockets) {
    for (const v of rocket.visits) {
      if (v.berth) continue;
      const list = berths.get(v.pad)!;
      v.berth = v.track && list.includes(`${v.pad}:${v.track}`) ? `${v.pad}:${v.track}` : list.includes(v.pad) ? v.pad : list[0];
    }
  }
  queueVisits(rockets, (r) => r.id, pins);
  return { rockets: rockets.filter((r) => r.visits.length > 0), berths, tracks };
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
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds of descent shown before touchdown, ignition lead before liftoff, and climb-out after it. */
export const DESCENT_SECONDS = 12;
export const IGNITION_LEAD_SECONDS = 3;
export const CLIMB_SECONDS = 9;
