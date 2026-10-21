'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { EARTH_TEXTURE_URL, NYC } from './constants';
import { FrameDriver } from './frame-driver';

const TELEMETRY = new THREE.Color('#4cb2ff');
const IGNITION = new THREE.Color('#ff5a1f');
const SPIN_RADIANS_PER_SECOND = 0.12;
const BEACON_RADIUS = 1.006;

/** Matches three's SphereGeometry UV layout for an equirectangular map whose left edge is 180°W. */
function latLonToVector3(lat: number, lon: number, radius: number) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

const NYC_POSITION = latLonToVector3(NYC.lat, NYC.lon, BEACON_RADIUS);
const NYC_FACING_SPIN = -Math.atan2(NYC_POSITION.x, NYC_POSITION.z);

const sphereVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Lighting is in view space so the terminator stays put while the planet spins under it.
const earthFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDir;
  uniform vec3 uRim;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 albedo = texture2D(uMap, vUv).rgb;
    float daylight = smoothstep(-0.2, 0.55, dot(n, normalize(uSunDir)));
    vec3 color = albedo * mix(0.12, 1.2, daylight);
    float fresnel = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), 2.6);
    color += uRim * fresnel * mix(0.35, 1.0, daylight);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

// Rendered on the back faces of a larger shell: brightest at Earth's limb, zero at the shell edge.
const atmosphereFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float limb = clamp(-dot(normalize(vNormal), normalize(vViewDir)) * 2.0, 0.0, 1.0);
    gl_FragColor = vec4(uColor, pow(limb, 2.2) * 0.85);
    #include <colorspace_fragment>
  }
`;

function Beacon({ animate }: { animate: boolean }) {
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const orientation = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), NYC_POSITION.clone().normalize()),
    [],
  );

  useFrame(({ clock }) => {
    rings.current.forEach((ring, index) => {
      if (!ring) return;
      const progress = animate ? (clock.elapsedTime / 1.8 + index / 2) % 1 : 0.35 + index * 0.25;
      ring.scale.setScalar(1 + progress * 3.2);
      (ring.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.9;
    });
  });

  return (
    <group position={NYC_POSITION} quaternion={orientation}>
      <mesh>
        <circleGeometry args={[0.035, 24]} />
        <meshBasicMaterial color={IGNITION} toneMapped={false} />
      </mesh>
      {[0, 1].map((index) => (
        <mesh key={index} ref={(mesh) => { rings.current[index] = mesh; }}>
          <ringGeometry args={[0.04, 0.052, 40]} />
          <meshBasicMaterial color={IGNITION} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.09]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.006, 0.014, 0.18, 8, 1, true]} />
        <meshBasicMaterial color={IGNITION} transparent opacity={0.75} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Earth({ animate, onReady }: { animate: boolean; onReady: () => void }) {
  const texture = useTexture(EARTH_TEXTURE_URL, (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.anisotropy = 4;
  });
  const spin = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);

  const earthUniforms = useMemo(
    () => ({
      uMap: { value: texture },
      uSunDir: { value: new THREE.Vector3(-0.55, 0.35, 0.75).normalize() },
      uRim: { value: TELEMETRY },
    }),
    [texture],
  );
  const atmosphereUniforms = useMemo(() => ({ uColor: { value: TELEMETRY } }), []);

  useEffect(() => {
    invalidate();
    onReady();
  }, [texture, invalidate, onReady]);

  useFrame((_, delta) => {
    if (!animate || !spin.current) return;
    // Clamp so a long pause (hidden tab) doesn't jump the planet forward.
    spin.current.rotation.y += Math.min(delta, 0.1) * SPIN_RADIANS_PER_SECOND;
  });

  return (
    <group rotation={[0.32, 0, 0.18]}>
      <group ref={spin} rotation={[0, NYC_FACING_SPIN, 0]}>
        <mesh>
          <sphereGeometry args={[1, 64, 48]} />
          <shaderMaterial vertexShader={sphereVertex} fragmentShader={earthFragment} uniforms={earthUniforms} />
        </mesh>
        <Beacon animate={animate} />
      </group>
      <mesh scale={1.15}>
        <sphereGeometry args={[1, 48, 32]} />
        <shaderMaterial
          vertexShader={sphereVertex}
          fragmentShader={atmosphereFragment}
          uniforms={atmosphereUniforms}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export interface EarthGlobeProps {
  /** Spin + beacon pulse. False renders a single static frame (reduced motion). */
  animate: boolean;
  /** False stops the render loop entirely (off-screen or hidden tab). */
  active: boolean;
  onReady: () => void;
  onContextLost: () => void;
}

export default function EarthGlobe({ animate, active, onReady, onContextLost }: EarthGlobeProps) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [0, 0, 4], fov: 38 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', onContextLost, { once: true });
      }}
      aria-hidden="true"
    >
      <Suspense fallback={null}>
        <Earth animate={animate} onReady={onReady} />
      </Suspense>
      <FrameDriver fps={30} active={active && animate} />
    </Canvas>
  );
}
