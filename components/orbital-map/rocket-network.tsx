'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { getRouteColor } from '@/lib/subway-data';
import type { EstimatedTrain } from '@/lib/train-positions';
import { Booster, type BoosterHandle } from './booster-model';
import { createPose, getMapStation, placeRockets, rocketPose, type PlacedRocket } from './map-geometry';
import { LANDING_WINDOW_SECONDS, trainEvents } from './rocket-timeline';

export interface NetworkStats {
  total: number;
  visible: number;
  detailed: number;
  flares: number;
}

interface RocketNetworkProps {
  trains: EstimatedTrain[];
  clockOffset: number;
  glow: number;
  lowPower: boolean;
  reducedMotion: boolean;
  markerScale: (cameraHeight: number) => number;
  onSelectRocket: (train: EstimatedTrain, stationId: string) => void;
  statsRef: React.RefObject<NetworkStats>;
}

const MAX_ROCKETS = 2000;
const TRAIL_SAMPLES = 5;
const TRAIL_SPACING = 0.035;
const MAX_FLARES = 256;
const FLARE_SECONDS = 2.4;
const DETAIL_SLOTS = 8;
const DETAIL_SLOTS_LOW_POWER = 3;
/** Camera-to-rocket distance (km) under which a rocket swaps its glyph for the full booster. */
const DETAIL_DISTANCE = 3.2;
/** Visible set is recomputed at most this often while the camera moves, and at least this often while idle. */
const CULL_THROTTLE_MS = 150;
const CULL_IDLE_MS = 1000;
/** Frustum padding as a fraction of camera distance, so rockets are drawn before they reach the edge. */
const CULL_MARGIN = 0.08;
const DETAIL_HEIGHT = 0.16;

const UP = new THREE.Vector3(0, 1, 0);
const tmpObject = new THREE.Object3D();
const tmpColor = new THREE.Color();
const tmpDir = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpSphere = new THREE.Sphere();
const frustum = new THREE.Frustum();
const projScreen = new THREE.Matrix4();

export function RocketNetwork({ trains, clockOffset, glow, lowPower, reducedMotion, markerScale, onSelectRocket, statsRef }: RocketNetworkProps) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const trailRef = useRef<THREE.InstancedMesh>(null);
  const flareRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as THREE.EventDispatcher<{ update: object }> | null;

  const rockets = useMemo(() => placeRockets(trains).slice(0, MAX_ROCKETS), [trains]);
  const colors = useMemo(() => rockets.map((r) => new THREE.Color(`#${getRouteColor(r.train.routeId)}`).multiplyScalar(glow * 1.3)), [rockets, glow]);
  const events = useMemo(() => rockets.flatMap((r, i) => trainEvents(r.train).map((e) => ({ ...e, rocket: i }))), [rockets]);

  const cull = useRef({ visible: new Int32Array(MAX_ROCKETS), count: 0, detailed: new Set<number>(), last: -Infinity, dirty: true });
  const detailAssignments = useRef<number[]>(Array(DETAIL_SLOTS).fill(-1));
  const pose = useMemo(() => createPose(), []);
  const trailPose = useMemo(() => createPose(), []);
  const slots = lowPower ? DETAIL_SLOTS_LOW_POWER : DETAIL_SLOTS;
  const trailSamples = lowPower ? 0 : TRAIL_SAMPLES;

  useLayoutEffect(() => {
    cull.current.dirty = true;
    cull.current.last = -Infinity;
  }, [rockets]);

  useEffect(() => {
    if (!controls) return;
    const markDirty = () => {
      cull.current.dirty = true;
    };
    controls.addEventListener('update', markDirty);
    return () => controls.removeEventListener('update', markDirty);
  }, [controls]);

  const recomputeVisibleSet = (now: number) => {
    const state = cull.current;
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    const zoomed = camera.position.y < 8;
    const near: Array<[number, number]> = [];
    let count = 0;
    for (let i = 0; i < rockets.length; i++) {
      rocketPose(rockets[i], now, pose);
      tmpVec.set(pose.x, pose.y, pose.z);
      const distance = camera.position.distanceTo(tmpVec);
      tmpSphere.set(tmpVec, 0.15 + distance * CULL_MARGIN);
      if (!frustum.intersectsSphere(tmpSphere)) continue;
      state.visible[count++] = i;
      if (zoomed && distance < DETAIL_DISTANCE) near.push([i, distance]);
    }
    near.sort((a, b) => a[1] - b[1]);
    state.detailed = new Set(near.slice(0, slots).map(([i]) => i));
    const assignments = detailAssignments.current;
    assignments.fill(-1);
    [...state.detailed].forEach((rocket, slot) => {
      assignments[slot] = rocket;
    });
    state.count = count;
    state.dirty = false;

    const body = bodyRef.current;
    const trail = trailRef.current;
    let bodyIndex = 0;
    for (let v = 0; v < count; v++) {
      const i = state.visible[v];
      if (state.detailed.has(i)) continue;
      body?.setColorAt(bodyIndex++, colors[i]);
    }
    if (body?.instanceColor) body.instanceColor.needsUpdate = true;
    if (trail) {
      let t = 0;
      for (let v = 0; v < count; v++) {
        for (let k = 1; k <= trailSamples; k++) {
          trail.setColorAt(t++, tmpColor.copy(colors[state.visible[v]]).multiplyScalar(0.55 * (1 - k / (trailSamples + 1))));
        }
      }
      if (trail.instanceColor) trail.instanceColor.needsUpdate = true;
    }
    statsRef.current.total = rockets.length;
    statsRef.current.visible = count;
    statsRef.current.detailed = state.detailed.size;
  };

  useFrame((frameState) => {
    const body = bodyRef.current;
    const trail = trailRef.current;
    const flare = flareRef.current;
    const ring = ringRef.current;
    if (!body) return;
    const now = Date.now() / 1000 + clockOffset;
    const ms = frameState.clock.elapsedTime * 1000;
    const state = cull.current;
    if ((state.dirty && ms - state.last > CULL_THROTTLE_MS) || ms - state.last > CULL_IDLE_MS) {
      state.last = ms;
      recomputeVisibleSet(now);
      body.computeBoundingSphere();
    }

    const scale = markerScale(camera.position.y);
    let bodyIndex = 0;
    let trailIndex = 0;
    for (let v = 0; v < state.count; v++) {
      const i = state.visible[v];
      const rocket = rockets[i];
      rocketPose(rocket, now, pose);
      if (!state.detailed.has(i)) {
        tmpDir.set(pose.dx, pose.dy, pose.dz);
        tmpObject.quaternion.setFromUnitVectors(UP, tmpDir);
        tmpObject.position.set(pose.x, pose.y + 0.055 * scale, pose.z);
        tmpObject.scale.setScalar(scale * (pose.flying ? 1 : 0.8));
        tmpObject.updateMatrix();
        body.setMatrixAt(bodyIndex++, tmpObject.matrix);
      }
      if (trail) {
        for (let k = 1; k <= trailSamples; k++) {
          if (pose.flying) {
            rocketPose(rocket, now, trailPose, k * TRAIL_SPACING);
            tmpObject.position.set(trailPose.x, trailPose.y + 0.05 * scale, trailPose.z);
            tmpObject.scale.setScalar(scale * (1 - k / (trailSamples + 2)));
          } else {
            tmpObject.scale.setScalar(0);
          }
          tmpObject.quaternion.identity();
          tmpObject.updateMatrix();
          trail.setMatrixAt(trailIndex++, tmpObject.matrix);
        }
      }
    }
    body.count = bodyIndex;
    body.instanceMatrix.needsUpdate = true;
    if (trail) {
      trail.count = trailIndex;
      trail.instanceMatrix.needsUpdate = true;
    }

    // Launch and landing flares come straight from the event times; only stations in view get one.
    let flares = 0;
    if (flare && ring && !reducedMotion) {
      for (const event of events) {
        const age = now - event.time;
        if (age < 0 || age > FLARE_SECONDS || flares >= MAX_FLARES) continue;
        const station = getMapStation(event.station);
        if (!station) continue;
        tmpVec.set(station.x, 0.05, station.z);
        tmpSphere.set(tmpVec, 0.6);
        if (!frustum.intersectsSphere(tmpSphere)) continue;
        const life = age / FLARE_SECONDS;
        const fade = (1 - life) * (1 - life);
        const base = colors[event.rocket];
        tmpObject.quaternion.identity();
        tmpObject.position.copy(tmpVec);
        tmpObject.scale.setScalar(scale * (0.6 + 1.6 * Math.sqrt(life)) * (event.kind === 'launch' ? 1.2 : 1));
        tmpObject.updateMatrix();
        flare.setMatrixAt(flares, tmpObject.matrix);
        flare.setColorAt(flares, tmpColor.set(event.kind === 'launch' ? '#ffd2a1' : '#cfe6ff').multiplyScalar(2.2 * fade));
        tmpObject.rotation.set(-Math.PI / 2, 0, 0);
        tmpObject.position.y = 0.01;
        tmpObject.scale.setScalar(scale * (0.4 + 5 * life));
        tmpObject.updateMatrix();
        ring.setMatrixAt(flares, tmpObject.matrix);
        ring.setColorAt(flares, tmpColor.copy(base).multiplyScalar(fade));
        flares++;
      }
      flare.count = flares;
      ring.count = flares;
      flare.instanceMatrix.needsUpdate = true;
      ring.instanceMatrix.needsUpdate = true;
      if (flare.instanceColor) flare.instanceColor.needsUpdate = true;
      if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
    }
    statsRef.current.flares = flares;
  });

  const bodyToRocket = (instanceId: number) => {
    const state = cull.current;
    let bodyIndex = 0;
    for (let v = 0; v < state.count; v++) {
      const i = state.visible[v];
      if (state.detailed.has(i)) continue;
      if (bodyIndex++ === instanceId) return rockets[i];
    }
    return undefined;
  };

  const handleClick = (rocket: PlacedRocket | undefined, e: ThreeEvent<MouseEvent>) => {
    if (!rocket || e.delta > 4) return;
    e.stopPropagation();
    rocketPose(rocket, Date.now() / 1000 + clockOffset, pose);
    onSelectRocket(rocket.train, pose.station);
  };

  return (
    <>
      <instancedMesh
        ref={bodyRef}
        args={[undefined, undefined, MAX_ROCKETS]}
        renderOrder={4}
        onClick={(e) => e.instanceId !== undefined && handleClick(bodyToRocket(e.instanceId), e)}
      >
        <coneGeometry args={[0.024, 0.11, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {trailSamples > 0 && (
        <instancedMesh ref={trailRef} args={[undefined, undefined, MAX_ROCKETS * TRAIL_SAMPLES]} frustumCulled={false} raycast={() => null}>
          <sphereGeometry args={[0.014, 5, 4]} />
          <meshBasicMaterial toneMapped={false} transparent blending={THREE.AdditiveBlending} depthWrite={false} />
        </instancedMesh>
      )}
      <instancedMesh ref={flareRef} args={[undefined, undefined, MAX_FLARES]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshBasicMaterial toneMapped={false} transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={ringRef} args={[undefined, undefined, MAX_FLARES]} frustumCulled={false} raycast={() => null}>
        <ringGeometry args={[0.05, 0.065, 32]} />
        <meshBasicMaterial toneMapped={false} transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </instancedMesh>
      {Array.from({ length: slots }, (_, slot) => (
        <DetailBooster
          key={slot}
          slot={slot}
          assignments={detailAssignments}
          rockets={rockets}
          clockOffset={clockOffset}
          onSelect={(rocket, e) => handleClick(rocket, e)}
        />
      ))}
    </>
  );
}

/** One pooled full-detail booster; the culling pass decides which nearby rocket it represents. */
function DetailBooster({
  slot,
  assignments,
  rockets,
  clockOffset,
  onSelect,
}: {
  slot: number;
  assignments: React.RefObject<number[]>;
  rockets: PlacedRocket[];
  clockOffset: number;
  onSelect: (rocket: PlacedRocket | undefined, e: ThreeEvent<MouseEvent>) => void;
}) {
  const handle = useRef<BoosterHandle>(null);
  const holder = useRef<THREE.Group>(null);
  const pose = useMemo(() => createPose(), []);

  useFrame(({ clock }) => {
    const group = holder.current;
    const booster = handle.current;
    if (!group || !booster) return;
    const index = assignments.current[slot];
    const rocket = index >= 0 ? rockets[index] : undefined;
    group.visible = Boolean(rocket);
    if (!rocket) return;
    rocketPose(rocket, Date.now() / 1000 + clockOffset, pose);
    const descending = pose.flying && pose.progress > 0.5;
    // Boosters fly nose-first on ascent and come down engines-first.
    tmpDir.set(pose.dx, pose.dy, pose.dz);
    if (descending) tmpDir.negate();
    group.quaternion.setFromUnitVectors(UP, tmpDir);
    group.position.set(pose.x, pose.y, pose.z);
    group.scale.setScalar(DETAIL_HEIGHT);
    const landingBurn = pose.flying && pose.secondsToTouchdown < LANDING_WINDOW_SECONDS * 0.5;
    const ascentBurn = pose.flying && pose.progress < 0.3;
    const legs = !pose.flying ? 1 : THREE.MathUtils.clamp(1 - (pose.secondsToTouchdown - 1) / 3, 0, 1);
    booster.pose(descending || !pose.flying ? 1 : 0, legs, landingBurn || ascentBurn ? 1 : 0, Math.sin(clock.elapsedTime * 40));
  });

  return (
    <group ref={holder} visible={false} onClick={(e) => onSelect(rockets[assignments.current[slot]], e)}>
      <Booster handleRef={handle} detail="lite" />
    </group>
  );
}
