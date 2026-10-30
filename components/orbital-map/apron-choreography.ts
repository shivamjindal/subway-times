import { getStation } from '@/lib/subway-data';
import {
  CLIMB_SECONDS,
  DESCENT_SECONDS,
  HOLD_RELEASE_SECONDS,
  IGNITION_LEAD_SECONDS,
  liftoffAt,
  queueVisits,
  type Fleet,
  type PadVisit,
} from './rocket-timeline';
import type { PadPhase, Site } from './spaceport-layout';

/**
 * The close-up's choreography, independent of rendering: which visits are on the apron, where each booster is at a
 * given second, and which booster slot draws which rocket.
 */

export const REFRESH_SECONDS = 0.5;

/** A hold shorter than this is flown as a plain (slightly later) descent. */
const MIN_HOLD_SECONDS = 2;
/** Held rockets come in to a hover beside the pad, wait, then fly a short final descent once it clears. */
const APPROACH_SECONDS = 7;
const FINAL_DESCENT_SECONDS = HOLD_RELEASE_SECONDS;
const HOVER_HEIGHT = 15;
const HOVER_OFFSET = 7;
const HOVER_SLOT_ANGLE = 0.95;

/** Replay: every site lands and relaunches, staggered, and site 0 gets a second rocket that has to hold. */
const REPLAY_TOUCHDOWN = DESCENT_SECONDS + 0.5;
const REPLAY_DWELL = 9;
const REPLAY_QUEUED_ARRIVAL = 4;

/** GLSL-style smoothstep; unlike THREE.MathUtils.smoothstep it accepts edge0 > edge1 for falling ramps. */
export const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export type Heading = [number, number];

export interface Shown {
  key: string;
  site: number;
  visit: PadVisit;
  launchHeading: Heading;
  landingHeading: Heading;
  hoverSlot?: number;
}

export interface PadPose {
  phase: PadPhase;
  visible: boolean;
  x: number;
  y: number;
  z: number;
  /** Lean away from vertical, in radians, along `heading`. */
  lean: number;
  heading: Heading;
  fins: number;
  legs: number;
  plume: number;
  vent: number;
  dustAge: number;
  smokeAge: number;
}

export const createPose = (): PadPose => ({
  phase: 'awaiting',
  visible: false,
  x: 0,
  y: 0,
  z: 0,
  lean: 0,
  heading: [1, 0],
  fins: 0,
  legs: 0,
  plume: 0,
  vent: 0,
  dustAge: Infinity,
  smokeAge: -Infinity,
});

export function headingBetween(fromId: string | undefined, toId: string | undefined): Heading {
  const a = fromId ? getStation(fromId) : undefined;
  const b = toId ? getStation(toId) : undefined;
  if (!a || !b) return [1, 0];
  const dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  const dz = -(b.lat - a.lat);
  const n = Math.hypot(dx, dz) || 1;
  return [dx / n, dz / n];
}

const isHeld = (v: PadVisit) => !v.from || v.landAt - v.arriveAt >= MIN_HOLD_SECONDS;

/** When a visit first needs a booster on screen, and when it no longer does. */
export function visitWindow(v: PadVisit): [number, number] {
  const start = !v.from
    ? v.arriveAt
    : isHeld(v)
      ? Math.min(v.arriveAt, v.landAt - FINAL_DESCENT_SECONDS) - APPROACH_SECONDS
      : v.landAt - DESCENT_SECONDS;
  return [start, liftoffAt(v) + CLIMB_SECONDS];
}

/** Pure function of time and visit, so replays, live data, and the still frame all share one choreography. */
export function padPose(now: number, { visit: v, launchHeading, landingHeading, hoverSlot = 0 }: Shown, out: PadPose): PadPose {
  const td = v.landAt;
  const lo = Number.isFinite(liftoffAt(v)) ? liftoffAt(v) : null;
  out.dustAge = v.from ? now - td : Infinity;
  out.smokeAge = lo !== null ? now - (lo - IGNITION_LEAD_SECONDS) : -Infinity;
  out.x = 0;
  out.z = 0;
  out.y = 0;
  out.lean = 0;
  out.vent = 0;
  out.plume = 0;
  out.visible = true;
  out.fins = 1;
  out.legs = 1;
  out.heading = launchHeading;

  if (lo !== null && now >= lo - IGNITION_LEAD_SECONDS) {
    const s = now - lo;
    if (s > CLIMB_SECONDS) {
      out.visible = false;
      out.phase = 'awaiting';
      return out;
    }
    if (s < 0) {
      out.phase = 'ignition';
      out.plume = 0.25 + 0.45 * smooth(-IGNITION_LEAD_SECONDS, 0, s);
      out.vent = 1 - smooth(-IGNITION_LEAD_SECONDS, -1, s);
      return out;
    }
    const drift = smooth(1.5, 7, s);
    out.phase = s < 2 ? 'liftoff' : 'climb-out';
    out.y = 1.1 * s * s + 0.4 * s;
    out.lean = drift * 0.55;
    out.x = launchHeading[0] * drift * s * s * 0.45;
    out.z = launchHeading[1] * drift * s * s * 0.45;
    out.legs = 1 - smooth(0.4, 2.4, s);
    out.fins = 1 - smooth(0.4, 2, s);
    out.plume = 1 + Math.min(s, 4) * 0.35;
    return out;
  }

  if (now < td && isHeld(v)) {
    // Hover on the inbound side of the pad: the outgoing rocket climbs away on the other side.
    const [hx, hy, hz] = hoverPoint(hoverSlot, landingHeading);
    out.heading = landingHeading;
    const finalStart = td - FINAL_DESCENT_SECONDS;
    if (now < finalStart) {
      const tau = Math.min(v.arriveAt, finalStart) - now;
      if (tau > APPROACH_SECONDS && v.from) {
        out.visible = false;
        out.phase = 'awaiting';
        return out;
      }
      if (tau > 0 && v.from) {
        const k = tau / APPROACH_SECONDS;
        out.y = hy + (46 - hy) * Math.pow(k, 1.5);
        out.x = hx * (1 + k * 0.6);
        out.z = hz * (1 + k * 0.6);
        out.lean = -0.25 * k;
        out.legs = 0;
        out.plume = smooth(2.5, 0.5, tau) * 0.8;
        out.phase = 'entry';
        return out;
      }
      out.x = hx;
      out.z = hz;
      out.y = hy + Math.sin(now * 1.3 + hoverSlot) * 0.35;
      out.lean = -0.06;
      out.legs = 0.15;
      out.plume = 0.6;
      out.phase = 'holding';
      return out;
    }
    const tau = td - now;
    const k = tau / FINAL_DESCENT_SECONDS;
    out.y = hy * Math.pow(k, 1.6);
    out.x = hx * k * k;
    out.z = hz * k * k;
    out.lean = -0.12 * k;
    out.plume = 0.7 + 0.25 * smooth(2, 0, tau);
    out.legs = smooth(3.2, 1, tau);
    out.phase = 'landing-burn';
    return out;
  }

  if (now < td) {
    const tau = td - now;
    if (tau > DESCENT_SECONDS) {
      out.visible = false;
      out.phase = 'awaiting';
      return out;
    }
    const k = tau / DESCENT_SECONDS;
    out.heading = landingHeading;
    out.y = 46 * Math.pow(k, 1.7);
    out.x = -landingHeading[0] * 10 * Math.pow(k, 1.5);
    out.z = -landingHeading[1] * 10 * Math.pow(k, 1.5);
    // Leaning back into the approach, straightening up for touchdown.
    out.lean = -0.3 * k;
    out.fins = smooth(DESCENT_SECONDS, DESCENT_SECONDS - 1.5, tau);
    out.plume = tau < 6 ? smooth(6, 5.5, tau) * (0.85 + 0.15 * smooth(2, 0, tau)) : 0;
    out.legs = smooth(3.2, 1, tau);
    out.phase = tau < 6 ? 'landing-burn' : 'entry';
    return out;
  }

  out.phase = out.dustAge < 2.5 ? 'touchdown' : 'on-pad';
  out.vent = smooth(0.5, 2.5, Number.isFinite(out.dustAge) ? out.dustAge : 3);
  return out;
}

export function replayPlan(sites: Site[]): { shown: Shown[]; cycle: number } {
  const replayVisit = (berth: string, arriveAt: number): PadVisit => ({
    station: '',
    pad: '',
    berth,
    from: 'replay',
    to: 'replay',
    arriveAt,
    landAt: arriveAt,
    launchAt: arriveAt + REPLAY_DWELL,
    clearsAt: arriveAt + REPLAY_DWELL,
  });
  const owners = sites.map((site, k) => ({
    key: `replay-${k}`,
    site: k,
    visits: [replayVisit(site.berth, REPLAY_TOUCHDOWN + ((k * 2.3) % 6.9))],
  }));
  if (sites.length > 0)
    owners.push({
      key: 'replay-queued',
      site: 0,
      visits: [replayVisit(sites[0].berth, REPLAY_TOUCHDOWN + REPLAY_QUEUED_ARRIVAL)],
    });
  queueVisits(owners, (o) => o.key);
  const shown = owners.map(({ key, site, visits: [visit] }, k): Shown => {
    const a = 0.6 + k * 2.1;
    return {
      key,
      site,
      visit,
      landingHeading: [Math.cos(a), Math.sin(a)],
      launchHeading: [Math.cos(a + 2.4), Math.sin(a + 2.4)],
    };
  });
  const cycle = Math.max(0, ...shown.map((s) => visitWindow(s.visit)[1])) + 2;
  return { shown: withHoverSlots(shown), cycle };
}

/**
 * Gives each held rocket a hover slot no other rocket over the same pad uses while both are waiting, so a queue of
 * three fans out around the pad instead of stacking in one spot. Greedy by arrival, so slots never change mid-hold.
 */
function withHoverSlots(shown: Shown[]): Shown[] {
  const bySite = new Map<number, Shown[]>();
  for (const s of shown) if (s.visit.from && isHeld(s.visit)) bySite.set(s.site, [...(bySite.get(s.site) ?? []), s]);
  const slots = new Map<string, number>();
  for (const held of bySite.values()) {
    held.sort((a, b) => visitWindow(a.visit)[0] - visitWindow(b.visit)[0]);
    const taken: Array<{ slot: number; until: number }> = [];
    for (const s of held) {
      const start = visitWindow(s.visit)[0];
      const busy = new Set(taken.filter((t) => t.until > start).map((t) => t.slot));
      let slot = 0;
      while (busy.has(slot)) slot++;
      taken.push({ slot, until: s.visit.landAt });
      slots.set(s.key, slot);
    }
  }
  return shown.map((s) => (slots.has(s.key) ? { ...s, hoverSlot: slots.get(s.key)! } : s));
}

/** Slot 0 hovers on the inbound side; later slots alternate either side of it, a little wider and higher each. */
function hoverPoint(slot: number, landingHeading: Heading): [number, number, number] {
  const side = slot === 0 ? 0 : (slot % 2 === 1 ? 1 : -1) * Math.ceil(slot / 2);
  const angle = Math.atan2(-landingHeading[1], -landingHeading[0]) + side * HOVER_SLOT_ANGLE;
  const r = HOVER_OFFSET + slot * 1.2;
  return [Math.cos(angle) * r, HOVER_HEIGHT + slot * 3, Math.sin(angle) * r];
}

export function shiftVisit(v: PadVisit, by: number): PadVisit {
  return {
    ...v,
    arriveAt: v.arriveAt + by,
    landAt: v.landAt + by,
    launchAt: v.launchAt + by,
    clearsAt: v.clearsAt + by,
  };
}

/** Every visit in the fleet that lands or launches at one of the close-up's sites. */
export function liveShown(fleet: Fleet, siteByBerth: ReadonlyMap<string, number>): Shown[] {
  const shown: Shown[] = [];
  for (const rocket of fleet.rockets) {
    rocket.visits.forEach((visit) => {
      const site = siteByBerth.get(visit.berth);
      if (site === undefined) return;
      shown.push({
        key: `${rocket.id}:${visit.station}`,
        site,
        visit,
        landingHeading: headingBetween(visit.from, visit.station),
        launchHeading: headingBetween(visit.station, visit.to),
      });
    });
  }
  return withHoverSlots(shown);
}

/**
 * Hands booster slots to the visits on screen at `now`. A visit keeps its slot until its own sequence is over, and
 * the slot always draws the visit as the latest poll planned it. Free slots go to waiting visits, soonest first, and
 * the list grows when every slot is busy, so no landing waits for a booster. Mutates `slots`; returns the active visits.
 */
export function assignSlots(slots: Array<Shown | null>, candidates: Shown[], now: number): Shown[] {
  const active = candidates.filter((s) => {
    const [start, end] = visitWindow(s.visit);
    return now >= start - REFRESH_SECONDS && now <= end;
  });
  const byKey = new Map(active.map((s) => [s.key, s]));
  for (let i = 0; i < slots.length; i++) slots[i] = (slots[i] && byKey.get(slots[i]!.key)) || null;
  const held = new Set(slots.map((s) => s?.key));
  const waiting = active.filter((s) => !held.has(s.key)).sort((a, b) => visitWindow(a.visit)[0] - visitWindow(b.visit)[0]);
  for (let i = 0; waiting.length > 0; i++) if (!slots[i]) slots[i] = waiting.shift()!;
  return active;
}

/**
 * The most visits on screen at once over `candidates`' plans, so the scene can mount that many boosters up front.
 * Slots are filled lowest first, so no slot index ever reaches past this count.
 */
export function peakConcurrentVisits(candidates: Shown[]): number {
  const edges = candidates.flatMap((s) => {
    const [start, end] = visitWindow(s.visit);
    return [
      { t: start - REFRESH_SECONDS, d: 1 },
      { t: end, d: -1 },
    ];
  });
  edges.sort((a, b) => a.t - b.t || b.d - a.d);
  let open = 0;
  let peak = 0;
  for (const { d } of edges) peak = Math.max(peak, (open += d));
  return peak;
}
