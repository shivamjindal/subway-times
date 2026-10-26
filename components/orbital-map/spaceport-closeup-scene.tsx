'use client';

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';
import { getStation } from '@/lib/subway-data';
import type { EstimatedTrain } from '@/lib/train-positions';
import { Booster, type BoosterHandle } from './booster-model';
import {
  CLIMB_SECONDS,
  DESCENT_SECONDS,
  IGNITION_LEAD_SECONDS,
  REPLAY_CYCLE,
  REPLAY_LIFTOFF,
  REPLAY_TOUCHDOWN,
  livePadPlan,
  type PadPlan,
} from './rocket-timeline';

export type PadPhase = 'awaiting' | 'entry' | 'landing-burn' | 'touchdown' | 'on-pad' | 'ignition' | 'liftoff' | 'climb-out';

export interface SpaceportCloseupSceneProps {
  stationId: string;
  trains: EstimatedTrain[];
  clockOffset: number;
  mode: 'live' | 'replay';
  /** Server-clock second the current replay started. */
  replayStart: number;
  loop: boolean;
  reducedMotion: boolean;
  lowPower: boolean;
  onPhase: (phase: PadPhase) => void;
  onContextLost: () => void;
  perf: boolean;
}

const BOOSTER_SCALE = 6;
const PLAN_REFRESH_SECONDS = 0.5;
/** Reduced-motion hero frame: 1.6 s before touchdown, landing burn lit, legs unfolding. */
const HERO_SECONDS_TO_TOUCHDOWN = 1.6;

const UP = new THREE.Vector3(0, 1, 0);
const tmpObject = new THREE.Object3D();
const tmpColor = new THREE.Color();
const tmpDir = new THREE.Vector3();

const smooth = (edge0: number, edge1: number, x: number) => THREE.MathUtils.smoothstep(x, edge0, edge1);

interface PadPose {
  phase: PadPhase;
  visible: boolean;
  x: number;
  y: number;
  z: number;
  /** Lean away from vertical, in radians, along `heading`. */
  lean: number;
  heading: [number, number];
  fins: number;
  legs: number;
  plume: number;
  vent: number;
  dustAge: number;
  smokeAge: number;
}

function headingBetween(fromId: string | undefined, toId: string | undefined): [number, number] {
  const a = fromId ? getStation(fromId) : undefined;
  const b = toId ? getStation(toId) : undefined;
  if (!a || !b) return [1, 0];
  const dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  const dz = -(b.lat - a.lat);
  const n = Math.hypot(dx, dz) || 1;
  return [dx / n, dz / n];
}

/** Pure function of time and plan, so replays, live data, and the still frame all share one choreography. */
function padPose(now: number, plan: PadPlan, launchHeading: [number, number], landingHeading: [number, number], out: PadPose): PadPose {
  const { touchdownAt: td, liftoffAt: lo } = plan;
  out.dustAge = td !== null ? now - td : Infinity;
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
      out.phase = 'climb-out';
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

  if (td !== null && now < td) {
    const tau = td - now;
    if (tau > DESCENT_SECONDS) {
      out.visible = false;
      out.phase = 'awaiting';
      return out;
    }
    const k = tau / DESCENT_SECONDS;
    out.heading = landingHeading;
    out.y = 46 * Math.pow(k, 1.7);
    out.x = -landingHeading[0] * 9 * k * k;
    out.z = -landingHeading[1] * 9 * k * k;
    // Leaning back into the approach, straightening up for touchdown.
    out.lean = -0.3 * k;
    out.fins = smooth(DESCENT_SECONDS, DESCENT_SECONDS - 1.5, tau);
    out.plume = tau < 6 ? smooth(6, 5.5, tau) * (0.85 + 0.15 * smooth(2, 0, tau)) : 0;
    out.legs = smooth(3.2, 1, tau);
    out.phase = tau < 6 ? 'landing-burn' : 'entry';
    return out;
  }

  if (td !== null || lo !== null) {
    out.phase = out.dustAge < 2.5 ? 'touchdown' : 'on-pad';
    out.vent = smooth(0.5, 2.5, out.dustAge);
    return out;
  }

  out.visible = false;
  out.phase = 'awaiting';
  return out;
}

function hash(i: number, salt: number) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
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

function setParticle(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, size: number, base: THREE.Color, alpha: number) {
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

function PadScene({
  stationId,
  trains,
  clockOffset,
  mode,
  replayStart,
  loop,
  reducedMotion,
  lowPower,
  onPhase,
  perf,
}: Omit<SpaceportCloseupSceneProps, 'onContextLost'>) {
  const booster = useRef<BoosterHandle>(null);
  const boosterHolder = useRef<THREE.Group>(null);
  const plumeLight = useRef<THREE.PointLight>(null);
  const groundGlow = useRef<THREE.Mesh>(null);
  const planCache = useRef<{ at: number; plan: PadPlan; launchHeading: [number, number]; landingHeading: [number, number] } | null>(null);
  const pose = useMemo<PadPose>(
    () => ({ phase: 'awaiting', visible: false, x: 0, y: 0, z: 0, lean: 0, heading: [1, 0], fins: 0, legs: 0, plume: 0, vent: 0, dustAge: Infinity, smokeAge: -Infinity }),
    []
  );
  const lastPhase = useRef<PadPhase | null>(null);
  const perfSample = useRef({ frames: 0, since: 0 });
  const dustCount = lowPower ? 24 : 64;
  const smokeCount = lowPower ? 48 : 140;
  const ventCount = lowPower ? 16 : 40;

  const resolve = (now: number) => {
    if (reducedMotion) {
      const heroNow = 0;
      return {
        now: heroNow,
        plan: { touchdownAt: heroNow + HERO_SECONDS_TO_TOUCHDOWN, liftoffAt: null, landing: null, launch: null },
        launchHeading: [1, 0] as [number, number],
        landingHeading: [0.8, -0.6] as [number, number],
      };
    }
    if (mode === 'replay') {
      const elapsed = now - replayStart;
      const start = loop ? replayStart + Math.floor(Math.max(0, elapsed) / REPLAY_CYCLE) * REPLAY_CYCLE : replayStart;
      return {
        now,
        plan: { touchdownAt: start + REPLAY_TOUCHDOWN, liftoffAt: start + REPLAY_LIFTOFF, landing: null, launch: null },
        launchHeading: [0.85, -0.5] as [number, number],
        landingHeading: [0.6, 0.8] as [number, number],
      };
    }
    const cached = planCache.current;
    if (!cached || now - cached.at > PLAN_REFRESH_SECONDS) {
      const plan = livePadPlan(trains, stationId, now);
      planCache.current = {
        at: now,
        plan,
        launchHeading: headingBetween(stationId, plan.launch?.other),
        landingHeading: headingBetween(plan.landing?.other, stationId),
      };
    }
    const c = planCache.current!;
    return { now, plan: c.plan, launchHeading: c.launchHeading, landingHeading: c.landingHeading };
  };

  useFrame(({ clock }) => {
    const resolved = resolve(Date.now() / 1000 + clockOffset);
    padPose(resolved.now, resolved.plan, resolved.launchHeading, resolved.landingHeading, pose);
    if (pose.phase !== lastPhase.current) {
      lastPhase.current = pose.phase;
      onPhase(pose.phase);
    }

    const holder = boosterHolder.current;
    if (holder && booster.current) {
      holder.visible = pose.visible;
      holder.position.set(pose.x, pose.y + 0.3, pose.z);
      const axis = tmpDir.set(pose.heading[0] * Math.sin(pose.lean), Math.cos(pose.lean), pose.heading[1] * Math.sin(pose.lean)).normalize();
      holder.quaternion.setFromUnitVectors(UP, axis);
      const flicker = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 47) * 0.6 + Math.sin(clock.elapsedTime * 23) * 0.4;
      booster.current.pose(pose.fins, pose.legs, Math.min(pose.plume, 1.6), flicker);
    }
    const glow = pose.visible ? pose.plume * Math.max(0, 1 - pose.y / 30) : 0;
    if (plumeLight.current) {
      plumeLight.current.intensity = glow * 260;
      plumeLight.current.position.set(pose.x, Math.max(0.5, pose.y - 1), pose.z);
    }
    if (groundGlow.current) {
      groundGlow.current.visible = glow > 0.02;
      groundGlow.current.scale.setScalar(4 + glow * 6);
      (groundGlow.current.material as THREE.MeshBasicMaterial).opacity = Math.min(0.85, glow * 0.7);
    }

    if (perf) {
      const s = perfSample.current;
      s.frames++;
      if (clock.elapsedTime - s.since >= 1) {
        (window as unknown as { __spaceportPerf?: object }).__spaceportPerf = { fps: Math.round(s.frames / (clock.elapsedTime - s.since)), phase: pose.phase };
        s.frames = 0;
        s.since = clock.elapsedTime;
      }
    }
  });

  return (
    <>
      <color attach="background" args={['#03060d']} />
      <fog attach="fog" args={['#03060d', 60, 160]} />
      <hemisphereLight args={['#9fb8ff', '#1a120c', 0.6]} />
      <directionalLight position={[-20, 30, 15]} intensity={1.4} />
      <pointLight ref={plumeLight} color="#ff8a3a" intensity={0} distance={40} decay={1.6} />

      <Stars />
      <Skyline />
      <Grid args={[200, 200]} position={[0, 0, 0]} cellSize={2} sectionSize={10} cellColor="#121a2c" sectionColor="#1e2d4a" fadeDistance={120} infiniteGrid />
      <LandingPad />
      <mesh ref={groundGlow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.32, 0]} visible={false}>
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color="#ff7a2a" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>

      <group ref={boosterHolder} scale={BOOSTER_SCALE}>
        <Booster handleRef={booster} detail={lowPower ? 'lite' : 'full'} />
      </group>

      {/* Touchdown dust ring. */}
      <Particles
        count={dustCount}
        color="#b9a58c"
        write={(mesh, base) => {
          const age = pose.dustAge;
          for (let i = 0; i < dustCount; i++) {
            if (age < 0 || age > 4) {
              setParticle(mesh, i, 0, 0, 0, 0, base, 0);
              continue;
            }
            const a = hash(i, 1) * Math.PI * 2;
            const r = (3 + hash(i, 2) * 6) * (1 - Math.exp(-age * 1.6));
            const fade = (1 - age / 4) * (1 - age / 4);
            setParticle(mesh, i, Math.cos(a) * r, 0.4 + age * (0.3 + hash(i, 3) * 0.5), Math.sin(a) * r, 0.5 + age * 0.9, base, 0.35 * fade);
          }
          finish(mesh);
        }}
      />
      {/* Ignition and liftoff exhaust billowing along the ground. */}
      <Particles
        count={smokeCount}
        color="#ffd9b0"
        write={(mesh, base) => {
          const window = IGNITION_LEAD_SECONDS + 5;
          for (let i = 0; i < smokeCount; i++) {
            const age = pose.smokeAge - (i / smokeCount) * window;
            if (age < 0 || age > 5) {
              setParticle(mesh, i, 0, 0, 0, 0, base, 0);
              continue;
            }
            const a = hash(i, 4) * Math.PI * 2;
            const r = (2 + hash(i, 5) * 10) * (1 - Math.exp(-age * 1.2));
            const fade = Math.min(1, age * 3) * (1 - age / 5);
            setParticle(mesh, i, Math.cos(a) * r, 0.5 + age * (0.4 + hash(i, 6)), Math.sin(a) * r, 0.8 + age * 1.3, base, 0.28 * fade);
          }
          finish(mesh);
        }}
      />
      {/* Cold vapor venting off the tank while the booster dwells on the pad. */}
      <Particles
        count={ventCount}
        color="#d8e6ff"
        write={(mesh, base) => {
          const vent = pose.visible ? pose.vent : 0;
          const t = reducedMotion ? 1.3 : performance.now() / 1000;
          const life = 2.6;
          for (let i = 0; i < ventCount; i++) {
            const age = (t + (i / ventCount) * life) % life;
            const side = i % 2 === 0 ? 1 : -1;
            const height = BOOSTER_SCALE * (0.55 + hash(i, 7) * 0.35);
            const out = 0.3 + age * (0.6 + hash(i, 8) * 0.6);
            const fade = vent * (1 - age / life);
            setParticle(mesh, i, pose.x + side * out, height - age * age * 0.5, pose.z + (hash(i, 9) - 0.5) * age, 0.25 + age * 0.45, base, 0.3 * fade);
          }
          finish(mesh);
        }}
      />
    </>
  );
}

function LandingPad() {
  return (
    <group>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[8, 8.4, 0.3, 6]} />
        <meshStandardMaterial color="#2b2f38" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.31, 0]}>
        <ringGeometry args={[3.4, 3.8, 48]} />
        <meshBasicMaterial color="#ff5a1f" toneMapped={false} />
      </mesh>
      {[Math.PI / 4, -Math.PI / 4].map((angle) => (
        <mesh key={angle} rotation={[-Math.PI / 2, 0, angle]} position={[0, 0.31, 0]}>
          <planeGeometry args={[5.2, 0.35]} />
          <meshBasicMaterial color="#ff5a1f" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function Stars() {
  const geometry = useMemo(() => {
    const count = 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = hash(i, 11) * Math.PI * 2;
      const phi = Math.acos(hash(i, 12) * 0.9);
      positions.set([Math.sin(phi) * Math.cos(theta) * 150, Math.cos(phi) * 150, Math.sin(phi) * Math.sin(theta) * 150], i * 3);
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

function Skyline() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = 70;
  useMemo(() => {
    queueMicrotask(() => {
      const mesh = ref.current;
      if (!mesh) return;
      for (let i = 0; i < count; i++) {
        const a = -2.4 + (i / count) * 2.2 + hash(i, 13) * 0.04;
        const r = 70 + hash(i, 14) * 25;
        const h = 6 + Math.pow(hash(i, 15), 2.5) * 38;
        tmpObject.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
        tmpObject.scale.set(3 + hash(i, 16) * 4, h, 3 + hash(i, 17) * 4);
        tmpObject.rotation.set(0, -a, 0);
        tmpObject.updateMatrix();
        mesh.setMatrixAt(i, tmpObject.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <boxGeometry />
      <meshStandardMaterial color="#0b1222" roughness={1} emissive="#0d1a33" emissiveIntensity={0.5} />
    </instancedMesh>
  );
}

export default function SpaceportCloseupScene(props: SpaceportCloseupSceneProps) {
  const { reducedMotion, lowPower, onContextLost } = props;
  return (
    <Canvas
      dpr={lowPower ? 1 : [1, 1.75]}
      frameloop={reducedMotion ? 'demand' : 'always'}
      gl={{ antialias: !lowPower, powerPreference: lowPower ? 'low-power' : 'high-performance' }}
      camera={{ fov: 40, near: 0.5, far: 400, position: [14, 7, 26] }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          onContextLost();
        });
      }}
    >
      <PadScene {...props} />
      <OrbitControls
        makeDefault
        target={[0, 8, 0]}
        enablePan={false}
        minDistance={14}
        maxDistance={55}
        maxPolarAngle={Math.PI / 2 - 0.05}
        enableDamping={!reducedMotion}
      />
      {!lowPower && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={0.85} intensity={0.9} radius={0.7} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
