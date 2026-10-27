'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';
import { getStation } from '@/lib/subway-data';
import { Booster, type BoosterHandle } from './booster-model';
import { useFrameCost } from './frame-probe';
import {
  CLIMB_SECONDS,
  DESCENT_SECONDS,
  IGNITION_LEAD_SECONDS,
  formatTMinus,
  queueVisits,
  type Fleet,
  type PadVisit,
} from './rocket-timeline';
import { PAD_RADIUS, PHASE_LABELS, type ApronStatus, type PadPhase, type Site } from './spaceport-layout';

export interface SpaceportCloseupSceneProps {
  sites: Site[];
  /** Apron radius from layoutSites, used to frame the camera. */
  radius: number;
  fleet: Fleet;
  clockOffset: number;
  mode: 'live' | 'replay';
  /** Server-clock second the current replay started. */
  replayStart: number;
  loop: boolean;
  reducedMotion: boolean;
  lowPower: boolean;
  onStatus: (status: ApronStatus) => void;
  onContextLost: () => void;
  perf: boolean;
}

const BOOSTER_SCALE = 8;
/** How far deployed legs reach below the engine bell, in booster-local units. */
const LEG_REACH = 0.16;
/** Boosters drawn at once; every concurrent landing or launch gets one, soonest first, up to this many. */
const BOOSTER_POOL = 12;
const BOOSTER_POOL_LOW_POWER = 5;
const REFRESH_SECONDS = 0.5;
const REDUCED_MOTION_TICK_MS = 5000;

/** A hold shorter than this is flown as a plain (slightly later) descent. */
const MIN_HOLD_SECONDS = 2;
/** Held rockets come in to a hover beside the pad, wait, then fly a short final descent once it clears. */
const APPROACH_SECONDS = 7;
const FINAL_DESCENT_SECONDS = 6;
const HOVER_HEIGHT = 15;
const HOVER_OFFSET = 7;
const HOVER_SLOT_ANGLE = 0.95;

/** Replay: every site lands and relaunches, staggered, and site 0 gets a second rocket that has to hold. */
const REPLAY_TOUCHDOWN = DESCENT_SECONDS + 0.5;
const REPLAY_DWELL = 9;
const REPLAY_QUEUED_ARRIVAL = 4;

const UP = new THREE.Vector3(0, 1, 0);
const tmpObject = new THREE.Object3D();
const tmpColor = new THREE.Color();
const tmpDir = new THREE.Vector3();

/** GLSL-style smoothstep; unlike THREE.MathUtils.smoothstep it accepts edge0 > edge1 for falling ramps. */
const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

type Heading = [number, number];

interface Shown {
  key: string;
  site: number;
  visit: PadVisit;
  launchHeading: Heading;
  landingHeading: Heading;
  hoverSlot?: number;
}

interface PadPose {
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

const createPose = (): PadPose => ({
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

function headingBetween(fromId: string | undefined, toId: string | undefined): Heading {
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
function visitWindow(v: PadVisit): [number, number] {
  const start = !v.from
    ? v.arriveAt
    : isHeld(v)
      ? Math.min(v.arriveAt, v.landAt - FINAL_DESCENT_SECONDS) - APPROACH_SECONDS
      : v.landAt - DESCENT_SECONDS;
  const end = Number.isFinite(v.launchAt) ? v.launchAt + CLIMB_SECONDS : v.clearsAt;
  return [start, end];
}

/** Pure function of time and visit, so replays, live data, and the still frame all share one choreography. */
function padPose(now: number, { visit: v, launchHeading, landingHeading, hoverSlot = 0 }: Shown, out: PadPose): PadPose {
  const td = v.landAt;
  const lo = Number.isFinite(v.launchAt) ? v.launchAt : null;
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

  if (now >= v.clearsAt) {
    out.visible = false;
    out.phase = 'awaiting';
    return out;
  }
  out.phase = out.dustAge < 2.5 ? 'touchdown' : 'on-pad';
  out.vent = smooth(0.5, 2.5, Number.isFinite(out.dustAge) ? out.dustAge : 3);
  return out;
}

const PHASE_PRIORITY: PadPhase[] = [
  'landing-burn',
  'holding',
  'ignition',
  'liftoff',
  'entry',
  'touchdown',
  'climb-out',
  'on-pad',
  'awaiting',
];

function hash(i: number, salt: number) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function replayPlan(sites: Site[]): { shown: Shown[]; cycle: number } {
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

function shiftVisit(v: PadVisit, by: number): PadVisit {
  return {
    ...v,
    arriveAt: v.arriveAt + by,
    landAt: v.landAt + by,
    launchAt: v.launchAt + by,
    clearsAt: v.clearsAt + by,
  };
}

/** Particles are a pure function of age (no simulation), so any frame can be drawn on demand. */
function Particles({
  count,
  color,
  write,
}: {
  count: number;
  color: string;
  write: (mesh: THREE.InstancedMesh, base: THREE.Color) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const base = useMemo(() => new THREE.Color(color), [color]);
  useFrame(() => {
    if (ref.current) write(ref.current, base);
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </instancedMesh>
  );
}

function setParticle(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  y: number,
  z: number,
  size: number,
  base: THREE.Color,
  alpha: number,
) {
  tmpObject.position.set(x, y, z);
  tmpObject.scale.setScalar(alpha > 0 ? size : 0);
  tmpObject.rotation.set(0, 0, 0);
  tmpObject.updateMatrix();
  mesh.setMatrixAt(i, tmpObject.matrix);
  mesh.setColorAt(i, tmpColor.copy(base).multiplyScalar(Math.max(0, alpha)));
}

function finish(mesh: THREE.InstancedMesh) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** DOM nodes of the pad labels, which sit in an overlay beside the canvas. */
interface LabelNodes {
  anchors: Map<number, HTMLDivElement>;
  status: Map<number, HTMLSpanElement>;
}

function Apron({
  labels,
  sites,
  fleet,
  clockOffset,
  mode,
  replayStart,
  loop,
  reducedMotion,
  lowPower,
  onStatus,
  perf,
}: Omit<SpaceportCloseupSceneProps, 'onContextLost' | 'radius'> & {
  labels: LabelNodes;
}) {
  const pool = lowPower ? BOOSTER_POOL_LOW_POWER : BOOSTER_POOL;
  const boosters = useRef<Array<BoosterHandle | null>>([]);
  const holders = useRef<Array<THREE.Group | null>>([]);
  const plumeLight = useRef<THREE.PointLight>(null);
  const groundGlow = useRef<THREE.InstancedMesh>(null);
  const posesRef = useRef<PadPose[]>(Array.from({ length: BOOSTER_POOL }, createPose));
  const slots = useRef<Array<Shown | null>>([]);
  const refreshedAt = useRef(-Infinity);
  const lastStatus = useRef('');
  const dustPer = lowPower ? 16 : 40;
  const smokePer = lowPower ? 24 : 80;
  const ventPer = lowPower ? 10 : 24;

  const siteByBerth = useMemo(() => new Map(sites.map((s, i) => [s.berth, i])), [sites]);
  const live = useMemo(() => {
    const shown: Shown[] = [];
    for (const rocket of fleet.rockets) {
      rocket.visits.forEach((visit, i) => {
        const site = siteByBerth.get(visit.berth);
        if (site === undefined) return;
        shown.push({
          key: `${rocket.train.id}:${i}`,
          site,
          visit,
          landingHeading: headingBetween(visit.from, visit.station),
          launchHeading: headingBetween(visit.station, visit.to),
        });
      });
    }
    return withHoverSlots(shown);
  }, [fleet, siteByBerth]);
  const replay = useMemo(() => replayPlan(sites), [sites]);

  /** The visits on screen at `now`, with replays shifted onto the current loop. */
  const candidates = (now: number): Shown[] => {
    if (mode === 'live' || reducedMotion) return live;
    const elapsed = now - replayStart;
    const start = loop ? replayStart + Math.floor(Math.max(0, elapsed) / replay.cycle) * replay.cycle : replayStart;
    return replay.shown.map((s) => ({
      ...s,
      key: `${s.key}@${start}`,
      visit: shiftVisit(s.visit, start),
    }));
  };

  const refresh = (now: number) => {
    const active = candidates(now).filter((s) => {
      const [start, end] = visitWindow(s.visit);
      return now >= start - REFRESH_SECONDS && now <= end;
    });
    const current = slots.current;
    const activeKeys = new Set(active.map((s) => s.key));
    for (let i = 0; i < pool; i++) if (current[i] && !activeKeys.has(current[i]!.key)) current[i] = null;
    const held = new Set(current.filter(Boolean).map((s) => s!.key));
    const waiting = active.filter((s) => !held.has(s.key)).sort((a, b) => visitWindow(a.visit)[0] - visitWindow(b.visit)[0]);
    for (let i = 0; i < pool && waiting.length > 0; i++) if (!current[i]) current[i] = waiting.shift()!;

    // Per-site label: the most eventful phase on that pad, how many rockets are holding over it, and the next event.
    const phases: PadPhase[] = sites.map(() => 'awaiting');
    const holding = sites.map(() => 0);
    const next: Array<{ kind: '↓' | '↑'; time: number } | null> = sites.map(() => null);
    for (const s of candidates(now)) {
      const pose = padPose(now, s, createPose());
      if (pose.phase === 'holding') holding[s.site]++;
      else if (PHASE_PRIORITY.indexOf(pose.phase) < PHASE_PRIORITY.indexOf(phases[s.site])) phases[s.site] = pose.phase;
      const upcoming =
        s.visit.from && s.visit.landAt > now
          ? { kind: '↓' as const, time: s.visit.landAt }
          : Number.isFinite(s.visit.launchAt) && s.visit.launchAt > now
            ? { kind: '↑' as const, time: s.visit.launchAt }
            : null;
      if (upcoming && (!next[s.site] || upcoming.time < next[s.site]!.time)) next[s.site] = upcoming;
    }
    const status: ApronStatus = {
      landing: 0,
      holding: 0,
      onPad: 0,
      launching: 0,
    };
    phases.forEach((phase, i) => {
      const el = labels.status.get(i);
      if (!el) return;
      const n = next[i];
      const shown = phase === 'awaiting' && holding[i] > 0 ? 'holding' : phase;
      const queue = holding[i] > 0 && shown !== 'holding' ? ` · ${holding[i]} holding` : holding[i] > 1 ? ` ×${holding[i]}` : '';
      el.textContent = `${PHASE_LABELS[shown]}${queue}${n && n.time - now < 20 * 60 ? ` · ${n.kind} ${formatTMinus(n.time - now)}` : ''}`;
      el.dataset.phase = shown;
    });
    for (const s of active) {
      const phase = padPose(now, s, createPose()).phase;
      if (phase === 'entry' || phase === 'landing-burn' || phase === 'touchdown') status.landing++;
      else if (phase === 'holding') status.holding++;
      else if (phase === 'on-pad') status.onPad++;
      else if (phase === 'ignition' || phase === 'liftoff' || phase === 'climb-out') status.launching++;
    }
    const key = JSON.stringify(status);
    if (key !== lastStatus.current) {
      lastStatus.current = key;
      onStatus(status);
    }
  };

  useFrame(({ clock }) => {
    const poses = posesRef.current;
    const now = Date.now() / 1000 + clockOffset;
    if (now - refreshedAt.current > REFRESH_SECONDS || now < refreshedAt.current) {
      refreshedAt.current = now;
      refresh(now);
    }
    const flicker = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 47) * 0.6 + Math.sin(clock.elapsedTime * 23) * 0.4;
    let brightest = -1;
    let brightestGlow = 0.02;
    for (let i = 0; i < pool; i++) {
      const shown = slots.current[i];
      const pose = poses[i];
      if (shown) padPose(now, shown, pose);
      else pose.visible = false;
      const site = shown ? sites[shown.site] : undefined;
      const holder = holders.current[i];
      const booster = boosters.current[i];
      if (holder && booster) {
        holder.visible = pose.visible && Boolean(site);
        if (holder.visible && site) {
          holder.position.set(site.x + pose.x, pose.y + 0.3 + pose.legs * LEG_REACH * BOOSTER_SCALE, site.z + pose.z);
          const axis = tmpDir
            .set(pose.heading[0] * Math.sin(pose.lean), Math.cos(pose.lean), pose.heading[1] * Math.sin(pose.lean))
            .normalize();
          holder.quaternion.setFromUnitVectors(UP, axis);
          booster.pose(pose.fins, pose.legs, Math.min(pose.plume, 1.6), flicker);
        }
      }
      const glow = pose.visible ? pose.plume * Math.max(0, 1 - pose.y / 30) : 0;
      const glowMesh = groundGlow.current;
      if (glowMesh) {
        tmpObject.rotation.set(-Math.PI / 2, 0, 0);
        tmpObject.position.set((site?.x ?? 0) + pose.x, 0.32, (site?.z ?? 0) + pose.z);
        tmpObject.scale.setScalar(glow > 0.02 ? 3 + glow * 2.5 : 0);
        tmpObject.updateMatrix();
        glowMesh.setMatrixAt(i, tmpObject.matrix);
        glowMesh.setColorAt(i, tmpColor.set('#ff7a2a').multiplyScalar(Math.min(0.55, glow * 0.35)));
      }
      if (glow > brightestGlow) {
        brightestGlow = glow;
        brightest = i;
      }
    }
    if (groundGlow.current) finish(groundGlow.current);
    const light = plumeLight.current;
    if (light) {
      const pose = poses[brightest];
      const site = brightest >= 0 ? sites[slots.current[brightest]!.site] : undefined;
      light.intensity = pose && site ? brightestGlow * 260 : 0;
      if (pose && site) light.position.set(site.x + pose.x, Math.max(0.5, pose.y - 1), site.z + pose.z);
    }
  });

  useFrameCost(perf, (cost) => {
    (window as unknown as { __spaceportPerf?: object }).__spaceportPerf = {
      ...cost,
      sites: sites.length,
      boosters: posesRef.current.filter((p) => p.visible).length,
      status: lastStatus.current,
    };
  });

  const emitters = (write: (pose: PadPose, site: Site | null, slot: number) => void) => {
    const poses = posesRef.current;
    for (let i = 0; i < pool; i++) {
      const shown = slots.current[i];
      write(poses[i], shown && poses[i].visible ? sites[shown.site] : null, i);
    }
  };

  return (
    <>
      <pointLight ref={plumeLight} color="#ff8a3a" intensity={0} distance={40} decay={1.6} />
      <Pads sites={sites} />
      <instancedMesh ref={groundGlow} args={[undefined, undefined, pool]} frustumCulled={false}>
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>

      {Array.from({ length: pool }, (_, i) => (
        <group
          key={i}
          ref={(el) => {
            holders.current[i] = el;
          }}
          scale={BOOSTER_SCALE}
          visible={false}
        >
          <Booster
            handleRef={(handle) => {
              boosters.current[i] = handle;
            }}
            detail={lowPower || sites.length > 6 ? 'lite' : 'full'}
          />
        </group>
      ))}

      {/* Touchdown dust ring. */}
      <Particles
        count={dustPer * pool}
        color="#b9a58c"
        write={(mesh, base) => {
          emitters((pose, site, slot) => {
            const age = pose.dustAge;
            for (let j = 0; j < dustPer; j++) {
              const i = slot * dustPer + j;
              if (!site || age < 0 || age > 4) {
                setParticle(mesh, i, 0, 0, 0, 0, base, 0);
                continue;
              }
              const a = hash(j, 1) * Math.PI * 2;
              const r = (3 + hash(j, 2) * 6) * (1 - Math.exp(-age * 1.6));
              const fade = (1 - age / 4) * (1 - age / 4);
              setParticle(
                mesh,
                i,
                site.x + Math.cos(a) * r,
                0.4 + age * (0.3 + hash(j, 3) * 0.5),
                site.z + Math.sin(a) * r,
                0.5 + age * 0.9,
                base,
                0.16 * fade,
              );
            }
          });
          finish(mesh);
        }}
      />
      {/* Ignition and liftoff exhaust billowing along the ground. */}
      <Particles
        count={smokePer * pool}
        color="#c9b8a4"
        write={(mesh, base) => {
          const window = IGNITION_LEAD_SECONDS + 5;
          emitters((pose, site, slot) => {
            for (let j = 0; j < smokePer; j++) {
              const i = slot * smokePer + j;
              const age = pose.smokeAge - (j / smokePer) * window;
              if (!site || age < 0 || age > 5) {
                setParticle(mesh, i, 0, 0, 0, 0, base, 0);
                continue;
              }
              const a = hash(j, 4) * Math.PI * 2;
              const r = (2 + hash(j, 5) * 8) * (1 - Math.exp(-age * 1.2));
              const fade = Math.min(1, age * 3) * (1 - age / 5);
              setParticle(
                mesh,
                i,
                site.x + Math.cos(a) * r,
                0.5 + age * (0.4 + hash(j, 6)),
                site.z + Math.sin(a) * r,
                0.7 + age * 0.8,
                base,
                0.055 * fade,
              );
            }
          });
          finish(mesh);
        }}
      />
      {/* Cold vapor venting off the tank while a booster dwells on its pad. */}
      <Particles
        count={ventPer * pool}
        color="#d8e6ff"
        write={(mesh, base) => {
          const t = reducedMotion ? 1.3 : performance.now() / 1000;
          const life = 2.6;
          emitters((pose, site, slot) => {
            const vent = site ? pose.vent : 0;
            for (let j = 0; j < ventPer; j++) {
              const i = slot * ventPer + j;
              if (!site || vent <= 0) {
                setParticle(mesh, i, 0, 0, 0, 0, base, 0);
                continue;
              }
              const age = (t + (j / ventPer) * life + slot * 0.37) % life;
              const side = j % 2 === 0 ? 1 : -1;
              const height = BOOSTER_SCALE * (0.55 + hash(j, 7) * 0.35);
              const out = 0.3 + age * (0.6 + hash(j, 8) * 0.6);
              const fade = vent * (1 - age / life);
              setParticle(
                mesh,
                i,
                site.x + pose.x + side * out,
                height - age * age * 0.5,
                site.z + pose.z + (hash(j, 9) - 0.5) * age,
                0.25 + age * 0.45,
                base,
                0.3 * fade,
              );
            }
          });
          finish(mesh);
        }}
      />
    </>
  );
}

const LABEL_MEASURE_SECONDS = 0.5;
const LABEL_GAP_PX = 3;

/**
 * Projects each pad's label anchor (just in front of the pad) to the overlay, then drops labels that would overlap one
 * already placed: busy pads win over idle ones, nearer over farther. Label sizes are re-read only every half second
 * so the frame loop never forces layout.
 */
function LabelProjector({ sites, labels }: { sites: Site[]; labels: LabelNodes }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const sizes = useRef<Array<[number, number]>>([]);
  const measuredAt = useRef(-Infinity);
  useFrame(({ camera, size, clock }) => {
    const t = clock.elapsedTime;
    if (t - measuredAt.current > LABEL_MEASURE_SECONDS) {
      measuredAt.current = t;
      sites.forEach((_, i) => {
        const box = labels.anchors.get(i)?.firstElementChild as HTMLElement | null | undefined;
        sizes.current[i] = box ? [box.offsetWidth, box.offsetHeight] : [0, 0];
      });
    }
    const placed: Array<{ i: number; x: number; y: number; depth: number; busy: boolean }> = [];
    sites.forEach((site, i) => {
      const el = labels.anchors.get(i);
      if (!el) return;
      v.set(site.x, 0.4, site.z + PAD_RADIUS + 0.6).project(camera);
      if (v.z > 1) {
        el.style.visibility = 'hidden';
        return;
      }
      const phase = labels.status.get(i)?.dataset.phase;
      placed.push({
        i,
        x: ((v.x + 1) / 2) * size.width,
        y: ((1 - v.y) / 2) * size.height,
        depth: v.z,
        busy: phase !== undefined && phase !== 'awaiting',
      });
    });
    placed.sort((a, b) => Number(b.busy) - Number(a.busy) || a.depth - b.depth);
    const kept: Array<[number, number, number, number]> = [];
    for (const { i, x: rawX, y } of placed) {
      const el = labels.anchors.get(i)!;
      const [w, h] = sizes.current[i] ?? [0, 0];
      const x = THREE.MathUtils.clamp(rawX, w / 2 + LABEL_GAP_PX, Math.max(w / 2, size.width - w / 2 - LABEL_GAP_PX));
      const rect: [number, number, number, number] = [x - w / 2, y, x + w / 2, y + h];
      const clash = kept.some(
        ([l, t2, r, b]) =>
          rect[0] < r + LABEL_GAP_PX && rect[2] > l - LABEL_GAP_PX && rect[1] < b + LABEL_GAP_PX && rect[3] > t2 - LABEL_GAP_PX,
      );
      el.style.visibility = clash ? 'hidden' : 'visible';
      if (clash) continue;
      kept.push(rect);
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  });
  return null;
}

/** Every site's pad as three instanced draws, however many pads the spaceport has. */
function Pads({ sites }: { sites: Site[] }) {
  const base = useRef<THREE.InstancedMesh>(null);
  const ring = useRef<THREE.InstancedMesh>(null);
  const cross = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!base.current || !ring.current || !cross.current) return;
    sites.forEach((site, i) => {
      tmpObject.rotation.set(0, 0, 0);
      tmpObject.scale.setScalar(1);
      tmpObject.position.set(site.x, 0.15, site.z);
      tmpObject.updateMatrix();
      base.current!.setMatrixAt(i, tmpObject.matrix);
      tmpObject.rotation.set(-Math.PI / 2, 0, 0);
      tmpObject.position.set(site.x, 0.31, site.z);
      tmpObject.updateMatrix();
      ring.current!.setMatrixAt(i, tmpObject.matrix);
      [Math.PI / 4, -Math.PI / 4].forEach((angle, k) => {
        tmpObject.rotation.set(-Math.PI / 2, 0, angle);
        tmpObject.updateMatrix();
        cross.current!.setMatrixAt(i * 2 + k, tmpObject.matrix);
      });
    });
    for (const mesh of [base.current, ring.current, cross.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [sites]);
  const n = Math.max(1, sites.length);
  return (
    <>
      <instancedMesh ref={base} args={[undefined, undefined, n]}>
        <cylinderGeometry args={[PAD_RADIUS, PAD_RADIUS + 0.4, 0.3, 6]} />
        <meshStandardMaterial color="#2b2f38" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={ring} args={[undefined, undefined, n]}>
        <ringGeometry args={[2.3, 2.6, 40]} />
        <meshBasicMaterial color="#ff5a1f" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={cross} args={[undefined, undefined, n * 2]}>
        <planeGeometry args={[3.5, 0.26]} />
        <meshBasicMaterial color="#ff5a1f" toneMapped={false} />
      </instancedMesh>
    </>
  );
}

function Stars() {
  const geometry = useMemo(() => {
    const count = 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = hash(i, 11) * Math.PI * 2;
      const phi = Math.acos(hash(i, 12) * 0.9);
      positions.set([Math.sin(phi) * Math.cos(theta) * 300, Math.cos(phi) * 300, Math.sin(phi) * Math.sin(theta) * 300], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);
  return (
    <points geometry={geometry}>
      <pointsMaterial color="#cfdcff" size={0.6} sizeAttenuation={false} fog={false} />
    </points>
  );
}

function Skyline({ radius }: { radius: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = 70;
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < count; i++) {
      const a = -2.4 + (i / count) * 2.2 + hash(i, 13) * 0.04;
      const r = Math.max(70, radius + 50) + hash(i, 14) * 25;
      const h = 6 + Math.pow(hash(i, 15), 2.5) * 38;
      tmpObject.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      tmpObject.scale.set(3 + hash(i, 16) * 4, h, 3 + hash(i, 17) * 4);
      tmpObject.rotation.set(0, -a, 0);
      tmpObject.updateMatrix();
      mesh.setMatrixAt(i, tmpObject.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [radius]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <boxGeometry />
      <meshStandardMaterial color="#0b1222" roughness={1} emissive="#0d1a33" emissiveIntensity={0.5} />
    </instancedMesh>
  );
}

const FOV = 40;
const LOW_VIEW = new THREE.Vector3(0.48, 0.24, 0.86).normalize();
const HIGH_VIEW = new THREE.Vector3(0.32, 0.72, 0.62).normalize();

/**
 * Direction, distance and look-at height that fit every pad (and a descending booster) in view. Wide complexes are
 * viewed from higher up so rows of pads separate on screen instead of stacking behind each other.
 */
function fitCamera(radius: number, aspect: number) {
  const direction = LOW_VIEW.clone()
    .lerp(HIGH_VIEW, THREE.MathUtils.clamp((radius - 12) / 28, 0, 1))
    .normalize();
  const elevation = Math.asin(direction.y);
  const half = THREE.MathUtils.degToRad(FOV / 2);
  const horizontal = Math.atan(Math.tan(half) * aspect);
  const vertical = radius * Math.sin(elevation) * 0.8 + 14 * Math.cos(elevation) + 4;
  const distance = Math.max(44, (radius / Math.sin(horizontal)) * 1.12, vertical / Math.tan(half));
  return { direction, distance, targetY: radius > 20 ? 4 : 10 };
}

function CameraFit({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useLayoutEffect(() => {
    const { direction, distance, targetY } = fitCamera(radius, aspect);
    camera.position
      .copy(direction)
      .multiplyScalar(distance)
      .add(new THREE.Vector3(0, targetY, 0));
    camera.lookAt(0, targetY, 0);
  }, [radius, aspect, camera]);
  return null;
}

/** With frameloop="demand", the still frame only refreshes when something asks for it. */
function StillFrameTicker() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const interval = setInterval(() => invalidate(), REDUCED_MOTION_TICK_MS);
    return () => clearInterval(interval);
  }, [invalidate]);
  return null;
}

export default function SpaceportCloseupScene(props: SpaceportCloseupSceneProps) {
  const { reducedMotion, lowPower, onContextLost, radius, sites } = props;
  const { direction, distance, targetY } = fitCamera(radius, 1.2);
  const [labels] = useState<LabelNodes>(() => ({
    anchors: new Map(),
    status: new Map(),
  }));
  return (
    <div className="relative h-full w-full">
      <Canvas
        dpr={lowPower ? 1 : [1, 1.75]}
        frameloop={reducedMotion ? 'demand' : 'always'}
        gl={{
          antialias: !lowPower,
          powerPreference: lowPower ? 'low-power' : 'high-performance',
        }}
        camera={{
          fov: FOV,
          near: 0.5,
          far: 600,
          position: [direction.x * distance, targetY + direction.y * distance, direction.z * distance],
        }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            onContextLost();
          });
        }}
      >
        <color attach="background" args={['#03060d']} />
        <fog attach="fog" args={['#03060d', distance + 20, distance + 150]} />
        <hemisphereLight args={['#9fb8ff', '#1a120c', 0.6]} />
        <directionalLight position={[-20, 30, 15]} intensity={1.4} />
        <Stars />
        <Skyline radius={radius} />
        <Grid
          args={[200, 200]}
          position={[0, 0, 0]}
          cellSize={2}
          sectionSize={10}
          cellColor="#121a2c"
          sectionColor="#1e2d4a"
          fadeDistance={Math.max(120, distance * 1.8)}
          infiniteGrid
        />
        <Apron {...props} labels={labels} />
        <LabelProjector sites={sites} labels={labels} />
        <CameraFit radius={radius} />
        {reducedMotion && <StillFrameTicker />}
        <OrbitControls
          makeDefault
          target={[0, targetY, 0]}
          enablePan={false}
          minDistance={14}
          maxDistance={distance * 1.7}
          maxPolarAngle={Math.PI / 2 - 0.05}
          enableDamping={!reducedMotion}
        />
        {!lowPower && (
          <EffectComposer multisampling={0}>
            <Bloom mipmapBlur luminanceThreshold={0.85} intensity={0.9} radius={0.7} />
          </EffectComposer>
        )}
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {sites.map((site, i) => (
          <div
            key={site.berth}
            ref={(el) => {
              if (el) labels.anchors.set(i, el);
              else labels.anchors.delete(i);
            }}
            className="invisible absolute left-0 top-0"
          >
            <div
              className="-translate-x-1/2 whitespace-nowrap border bg-background/80 px-1.5 py-0.5 text-center font-mono text-[0.6rem] uppercase tracking-[0.12em] backdrop-blur-sm"
              data-testid="pad-label"
            >
              <div className="text-foreground">{site.label}</div>
              <span
                ref={(el) => {
                  if (el) labels.status.set(i, el);
                  else labels.status.delete(i);
                }}
                className="text-telemetry"
                data-testid="pad-status"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
