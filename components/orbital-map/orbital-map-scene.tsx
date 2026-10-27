'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, Grid, Line, PerformanceMonitor } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { EstimatedTrain } from '@/lib/train-positions';
import { MAP_STATIONS, ROUTE_LINES, getMapStation, project, type MapStation } from './map-geometry';
import { useFrameCost } from './frame-probe';
import { RocketNetwork, type NetworkStats } from './rocket-network';
import type { Fleet } from './rocket-timeline';

export interface OrbitalMapSceneProps {
  fleet: Fleet;
  /** Seconds to add to the local clock so interpolation uses the server's notion of "now". */
  clockOffset: number;
  savedStationIds: string[];
  selectedStationId: string | null;
  /** Bumped to re-fly to the current selection (or the overview when nothing is selected). */
  focusNonce: number;
  onSelectStation: (stationId: string) => void;
  onSelectRocket: (train: EstimatedTrain, stationId: string) => void;
  /** Stops rendering entirely (e.g. while the spaceport close-up is open). */
  paused: boolean;
  /** Shows an FPS / rocket-count readout and mirrors it to window.__spaceNetworkPerf. */
  perf: boolean;
  reducedMotion: boolean;
  lowPower: boolean;
  theme: 'dark' | 'light';
  onContextLost: () => void;
}

interface Palette {
  background: string;
  station: string;
  saved: string;
  selected: string;
  grid: string;
  gridSection: string;
  glow: number;
}

const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: { background: '#04070e', station: '#c9d6ff', saved: '#ff5a1f', selected: '#4cb2ff', grid: '#16223a', gridSection: '#22375c', glow: 1.45 },
  light: { background: '#e6ebf3', station: '#0a0f1c', saved: '#e04a0a', selected: '#0b6bcb', grid: '#c9d2e0', gridSection: '#aab7cc', glow: 1 },
};

const [CENTER_X, CENTER_Z] = project(40.715, -73.93);
const OVERVIEW_OFFSET: [number, number, number] = [0, 30, 18];
const FOCUS_OFFSET: [number, number, number] = [2.2, 4.2, 3.4];
const REDUCED_MOTION_TICK_MS = 5000;

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

/** Markers keep a readable on-screen size as the camera climbs. */
function markerScale(cameraHeight: number) {
  return THREE.MathUtils.clamp(cameraHeight / 7, 0.7, 4.5);
}

function RouteLines({ palette, additive }: { palette: Palette; additive: boolean }) {
  const lines = useMemo(
    () =>
      ROUTE_LINES.map((line) => ({
        ...line,
        core: new THREE.Color(line.color).multiplyScalar(palette.glow),
      })),
    [palette.glow]
  );

  return (
    <group position={[0, 0.02, 0]}>
      {lines.map((line) => (
        <group key={line.routeId}>
          <Line
            points={line.points}
            segments
            color={line.color}
            lineWidth={7}
            transparent
            opacity={additive ? 0.1 : 0.2}
            depthWrite={false}
            toneMapped={false}
            blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
          />
          <Line points={line.points} segments color={line.core} lineWidth={2} depthWrite={false} toneMapped={false} />
        </group>
      ))}
    </group>
  );
}

function OrbitRings({ palette }: { palette: Palette }) {
  const rings = useMemo(
    () =>
      [5, 10, 20].map((radius) =>
        Array.from({ length: 129 }, (_, i) => {
          const a = (i / 128) * Math.PI * 2;
          return [CENTER_X + Math.cos(a) * radius, 0, CENTER_Z + Math.sin(a) * radius] as [number, number, number];
        })
      ),
    []
  );
  return (
    <group position={[0, 0.005, 0]}>
      {rings.map((points, i) => (
        <Line key={i} points={points} color={palette.gridSection} lineWidth={1} dashed dashSize={0.4} gapSize={0.4} transparent opacity={0.8} depthWrite={false} />
      ))}
    </group>
  );
}

function layoutStations(visual: THREE.InstancedMesh, hit: THREE.InstancedMesh, savedSet: Set<string>, scale: number) {
  MAP_STATIONS.forEach((station, i) => {
    tmp.position.set(station.x, 0.05, station.z);
    tmp.scale.setScalar(scale * (savedSet.has(station.id) ? 1.9 : 1));
    tmp.updateMatrix();
    visual.setMatrixAt(i, tmp.matrix);
    tmp.scale.setScalar(scale);
    tmp.updateMatrix();
    hit.setMatrixAt(i, tmp.matrix);
  });
  visual.instanceMatrix.needsUpdate = true;
  hit.instanceMatrix.needsUpdate = true;
  hit.computeBoundingSphere();
}

interface StationsProps {
  palette: Palette;
  savedSet: Set<string>;
  onSelectStation: (id: string) => void;
  onHoverStation: (station: MapStation | null) => void;
}

function Stations({ palette, savedSet, onSelectStation, onHoverStation }: StationsProps) {
  const visualRef = useRef<THREE.InstancedMesh>(null);
  const hitRef = useRef<THREE.InstancedMesh>(null);
  const lastScale = useRef(1);

  useLayoutEffect(() => {
    const visual = visualRef.current;
    const hit = hitRef.current;
    if (!visual || !hit) return;
    MAP_STATIONS.forEach((station, i) => {
      visual.setColorAt(i, tmpColor.set(savedSet.has(station.id) ? palette.saved : palette.station));
    });
    if (visual.instanceColor) visual.instanceColor.needsUpdate = true;
    layoutStations(visual, hit, savedSet, lastScale.current);
  }, [savedSet, palette]);

  useFrame(({ camera }) => {
    const scale = markerScale(camera.position.y);
    if (visualRef.current && hitRef.current && Math.abs(scale - lastScale.current) / scale > 0.08) {
      lastScale.current = scale;
      layoutStations(visualRef.current, hitRef.current, savedSet, scale);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId === undefined || e.delta > 4) return;
    e.stopPropagation();
    onSelectStation(MAP_STATIONS[e.instanceId].id);
  };

  return (
    <>
      <instancedMesh ref={visualRef} args={[undefined, undefined, MAP_STATIONS.length]} renderOrder={2}>
        <cylinderGeometry args={[0.05, 0.058, 0.014, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={hitRef}
        args={[undefined, undefined, MAP_STATIONS.length]}
        onClick={handleClick}
        onPointerMove={(e) => {
          e.stopPropagation();
          if (e.instanceId !== undefined) onHoverStation(MAP_STATIONS[e.instanceId]);
        }}
        onPointerOut={() => onHoverStation(null)}
      >
        <sphereGeometry args={[0.16, 8, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>

      {[...savedSet].map((id) => {
        const station = getMapStation(id);
        return station ? <SavedBeacon key={id} x={station.x} z={station.z} color={palette.saved} /> : null;
      })}
    </>
  );
}

type LabelTone = 'default' | 'saved' | 'selected';

interface MapLabelData {
  key: string;
  station: MapStation;
  tone: LabelTone;
}

const LABEL_TONE_CLASS: Record<LabelTone, string> = {
  default: 'border-border text-foreground',
  saved: 'border-ignition/60 text-ignition',
  selected: 'border-telemetry text-telemetry',
};

/** Projects label anchors to screen space each frame and writes transforms straight to the overlay DOM. */
function LabelProjector({ labels, elements }: { labels: MapLabelData[]; elements: Map<string, HTMLDivElement> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const label of labels) {
      const el = elements.get(label.key);
      if (!el) continue;
      v.set(label.station.x, 0.1, label.station.z).project(camera);
      if (v.z > 1) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px, 0)`;
    }
  });
  return null;
}

function SavedBeacon({ x, z, color }: { x: number; z: number; color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    ref.current?.scale.setScalar(markerScale(camera.position.y));
  });
  return (
    <group position={[x, 0, z]} ref={ref}>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.5, 6]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

function SelectedMarker({ stationId, palette, reducedMotion }: { stationId: string; palette: Palette; reducedMotion: boolean }) {
  const ringRef = useRef<THREE.Mesh>(null);
  const station = getMapStation(stationId);

  useFrame(({ camera, clock }) => {
    const ring = ringRef.current;
    if (!ring) return;
    const pulse = reducedMotion ? 1 : 1 + 0.25 * Math.sin(clock.elapsedTime * 3);
    ring.scale.setScalar(markerScale(camera.position.y) * pulse);
  });

  if (!station) return null;
  return (
    <mesh ref={ringRef} position={[station.x, 0.03, station.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <ringGeometry args={[0.11, 0.14, 40]} />
      <meshBasicMaterial color={palette.selected} toneMapped={false} transparent opacity={0.95} depthWrite={false} />
    </mesh>
  );
}

/** Opt-in frame-rate probe for measuring the live network; writes straight to the DOM, no React state. */
function PerfProbe({ statsRef, outputRef }: { statsRef: React.RefObject<NetworkStats>; outputRef: React.RefObject<HTMLDivElement | null> }) {
  useFrameCost(true, (cost) => {
    const stats = statsRef.current;
    const snapshot = { ...cost, ...stats, updateMs: Math.round(stats.updateMs * 100) / 100 };
    (window as unknown as { __spaceNetworkPerf?: typeof snapshot }).__spaceNetworkPerf = snapshot;
    if (outputRef.current) {
      outputRef.current.textContent = `${cost.fps} FPS · ${cost.drawCalls} draws · ${cost.cpuMs} ms CPU · ${stats.visible}/${stats.total} rockets visible · ${stats.detailed} detailed · ${stats.flares} flares`;
    }
  });
  return null;
}

function CameraRig({ selectedStationId, focusNonce, reducedMotion }: { selectedStationId: string | null; focusNonce: number; reducedMotion: boolean }) {
  const controlsRef = useRef<ComponentRef<typeof CameraControls>>(null);
  const initialized = useRef(false);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const station = selectedStationId ? getMapStation(selectedStationId) : null;
    const animate = initialized.current && !reducedMotion;
    initialized.current = true;
    if (station) {
      controls.setLookAt(station.x + FOCUS_OFFSET[0], FOCUS_OFFSET[1], station.z + FOCUS_OFFSET[2], station.x, 0, station.z, animate);
    } else {
      controls.setLookAt(CENTER_X + OVERVIEW_OFFSET[0], OVERVIEW_OFFSET[1], CENTER_Z + OVERVIEW_OFFSET[2], CENTER_X, 0, CENTER_Z, animate);
    }
  }, [selectedStationId, focusNonce, reducedMotion]);

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      minDistance={1.2}
      maxDistance={70}
      maxPolarAngle={Math.PI / 2 - 0.12}
      smoothTime={reducedMotion ? 0 : 0.6}
      draggingSmoothTime={reducedMotion ? 0 : 0.12}
    />
  );
}

/** With frameloop="demand", trains only advance when something asks for a frame. */
function ReducedMotionTicker({ fleet }: { fleet: Fleet }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
    const interval = setInterval(() => invalidate(), REDUCED_MOTION_TICK_MS);
    return () => clearInterval(interval);
  }, [invalidate, fleet]);
  return null;
}

export default function OrbitalMapScene({
  fleet,
  clockOffset,
  savedStationIds,
  selectedStationId,
  focusNonce,
  onSelectStation,
  onSelectRocket,
  paused,
  perf,
  reducedMotion,
  lowPower,
  theme,
  onContextLost,
}: OrbitalMapSceneProps) {
  const statsRef = useRef<NetworkStats>({ total: 0, visible: 0, detailed: 0, flares: 0, updateMs: 0 });
  const perfOutput = useRef<HTMLDivElement>(null);
  const palette = PALETTES[theme];
  const [performanceOk, setPerformanceOk] = useState(true);
  const [hovered, setHovered] = useState<MapStation | null>(null);
  const [labelElements] = useState(() => new Map<string, HTMLDivElement>());
  const bloom = theme === 'dark' && !lowPower && performanceOk;
  const savedSet = useMemo(() => new Set(savedStationIds), [savedStationIds]);

  const labels = useMemo(() => {
    const result: MapLabelData[] = [];
    for (const id of savedStationIds) {
      const station = getMapStation(id);
      if (station && id !== selectedStationId) result.push({ key: `saved-${id}`, station, tone: 'saved' });
    }
    const selected = selectedStationId ? getMapStation(selectedStationId) : undefined;
    if (selected) result.push({ key: `selected-${selected.id}`, station: selected, tone: 'selected' });
    if (hovered && hovered.id !== selectedStationId && !savedSet.has(hovered.id)) {
      result.push({ key: `hover-${hovered.id}`, station: hovered, tone: 'default' });
    }
    return result;
  }, [savedStationIds, savedSet, selectedStationId, hovered]);

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : '';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hovered]);

  return (
    <div className="relative h-full w-full">
      <Canvas
        dpr={lowPower ? 1 : [1, 2]}
        frameloop={paused ? 'never' : reducedMotion ? 'demand' : 'always'}
        gl={{ antialias: !lowPower, powerPreference: lowPower ? 'low-power' : 'high-performance' }}
        camera={{ fov: 42, near: 0.05, far: 400, position: [CENTER_X, OVERVIEW_OFFSET[1], CENTER_Z + OVERVIEW_OFFSET[2]] }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            onContextLost();
          });
        }}
      >
        <color attach="background" args={[palette.background]} />
        <fog attach="fog" args={[palette.background, 50, 130]} />
        <PerformanceMonitor onDecline={() => setPerformanceOk(false)} />
        {reducedMotion && <ReducedMotionTicker fleet={fleet} />}

        <Grid
          position={[CENTER_X, 0, CENTER_Z]}
          args={[200, 200]}
          cellSize={1}
          sectionSize={5}
          cellThickness={0.6}
          sectionThickness={1}
          cellColor={palette.grid}
          sectionColor={palette.gridSection}
          fadeDistance={100}
          fadeStrength={1.5}
          infiniteGrid
        />
        <OrbitRings palette={palette} />
        <RouteLines palette={palette} additive={theme === 'dark'} />
        <Stations palette={palette} savedSet={savedSet} onSelectStation={onSelectStation} onHoverStation={setHovered} />
        {selectedStationId && <SelectedMarker stationId={selectedStationId} palette={palette} reducedMotion={reducedMotion} />}
        <ambientLight intensity={0.7} />
        <directionalLight position={[CENTER_X + 10, 20, CENTER_Z + 6]} intensity={1.6} />
        <RocketNetwork
          fleet={fleet}
          clockOffset={clockOffset}
          glow={palette.glow}
          lowPower={lowPower}
          reducedMotion={reducedMotion}
          markerScale={markerScale}
          onSelectRocket={onSelectRocket}
          statsRef={statsRef}
        />
        {perf && <PerfProbe statsRef={statsRef} outputRef={perfOutput} />}
        <CameraRig selectedStationId={selectedStationId} focusNonce={focusNonce} reducedMotion={reducedMotion} />
        <LabelProjector labels={labels} elements={labelElements} />

        {bloom && (
          <EffectComposer multisampling={0}>
            <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.25} intensity={0.55} radius={0.6} />
          </EffectComposer>
        )}
      </Canvas>

      {perf && (
        <div ref={perfOutput} className="pointer-events-none absolute left-3 top-3 border bg-popover/85 px-2 py-1 font-mono text-[0.65rem] tabular-nums text-nominal" />
      )}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {labels.map(({ key, station, tone }) => (
          <div
            key={key}
            ref={(el) => {
              if (el) labelElements.set(key, el);
              else labelElements.delete(key);
            }}
            className="invisible absolute left-0 top-0"
          >
            <div
              className={`-translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap border bg-popover/85 px-2 py-1 font-mono text-[0.65rem] uppercase tracking-[0.16em] backdrop-blur ${LABEL_TONE_CLASS[tone]}`}
            >
              {station.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
