'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FrameDriver } from './frame-driver';

// Stars live directly in clip space, so density is uniform at any aspect ratio and no camera math is needed.
const starVertex = /* glsl */ `
  attribute float aDepth;
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScroll;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float nearness = 1.0 - aDepth;
    // Near stars slide further per scrolled viewport than far ones; all slower than the page itself.
    float y = position.y + uScroll * mix(0.04, 0.45, nearness * nearness) - uTime * 0.0025 * nearness;
    y = mod(y + 1.1, 2.2) - 1.1;
    gl_Position = vec4(position.x, y, 0.0, 1.0);
    gl_PointSize = aSize * mix(0.8, 2.6, nearness) * uPixelRatio;
    float twinkle = 0.75 + 0.25 * sin(uTime * (0.6 + aPhase * 0.25) + aPhase * 6.2831);
    vAlpha = mix(0.35, 1.0, nearness) * twinkle;
    vColor = aColor;
  }
`;

const starFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, core * core * vAlpha);
  }
`;

const STAR_TINTS = [
  new THREE.Color('#ffffff'),
  new THREE.Color('#ffffff'),
  new THREE.Color('#dce8ff'),
  new THREE.Color('#bedcff'),
  new THREE.Color('#ffd8c2'),
];

function buildStarGeometry(count: number) {
  const positions = new Float32Array(count * 3);
  const depth = new Float32Array(count);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const color = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.random() * 2.2 - 1.1;
    positions[i * 3 + 1] = Math.random() * 2.2 - 1.1;
    // Skew toward the back so most stars are faint and few are bright foreground ones.
    depth[i] = Math.sqrt(Math.random());
    size[i] = 0.7 + Math.random() * 0.8;
    phase[i] = Math.random();
    STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)].toArray(color, i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  return geometry;
}

function Stars({ animate, active, onReady }: { animate: boolean; active: boolean; onReady: () => void }) {
  const { invalidate, gl } = useThree();
  const scroll = useRef(0);
  const material = useRef<THREE.ShaderMaterial>(null);
  const geometry = useMemo(
    () => buildStarGeometry(Math.round(Math.min(2400, Math.max(700, (window.innerWidth * window.innerHeight) / 850)))),
    [],
  );
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uScroll: { value: 0 }, uPixelRatio: { value: 1 } }),
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    onReady();
  }, [onReady]);

  useEffect(() => {
    if (!animate || !active) return;
    const onScroll = () => {
      scroll.current = (window.scrollY / window.innerHeight) * 2;
      invalidate();
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [animate, active, invalidate]);

  useFrame(({ clock }) => {
    if (!material.current) return;
    const { uPixelRatio, uScroll, uTime } = material.current.uniforms;
    uPixelRatio.value = gl.getPixelRatio();
    uScroll.value = animate ? scroll.current : 0;
    uTime.value = animate ? clock.elapsedTime : 0;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        vertexShader={starVertex}
        fragmentShader={starFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export interface StarfieldCanvasProps {
  animate: boolean;
  active: boolean;
  onReady: () => void;
  onContextLost: () => void;
}

export default function StarfieldCanvas({ animate, active, onReady, onContextLost }: StarfieldCanvasProps) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', onContextLost, { once: true });
      }}
      aria-hidden="true"
    >
      <Stars animate={animate} active={active} onReady={onReady} />
      <FrameDriver fps={24} active={active && animate} />
    </Canvas>
  );
}
