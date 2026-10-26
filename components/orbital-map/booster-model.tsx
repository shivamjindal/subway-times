'use client';

import { useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import * as THREE from 'three';

/** Procedural, low-poly Falcon-style booster. Local height is 1 with the engines at y = 0. */
export interface BoosterHandle {
  root: THREE.Group;
  /** fins/legs/plume are 0..1; flicker jitters the plume so it reads as fire. */
  pose: (fins: number, legs: number, plume: number, flicker?: number) => void;
}

const RADIUS = 0.045;
const FIN_FOLDED = 0;
const FIN_DEPLOYED = Math.PI / 2;
const LEG_FOLDED = 0.06;
const LEG_DEPLOYED = 2.45;

export function Booster({ handleRef, detail = 'full' }: { handleRef: Ref<BoosterHandle>; detail?: 'full' | 'lite' }) {
  const root = useRef<THREE.Group>(null);
  const fins = useRef<THREE.Group[]>([]);
  const legs = useRef<THREE.Group[]>([]);
  const plume = useRef<THREE.Group>(null);
  const plumeOuter = useRef<THREE.MeshBasicMaterial>(null);
  const plumeCore = useRef<THREE.MeshBasicMaterial>(null);
  const segments = detail === 'full' ? 12 : 6;

  const materials = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({ color: '#e9edf3', roughness: 0.55, metalness: 0.1 }),
      soot: new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.8 }),
      metal: new THREE.MeshStandardMaterial({ color: '#8a919c', roughness: 0.4, metalness: 0.6 }),
    }),
    []
  );

  useImperativeHandle(
    handleRef,
    () => ({
      get root() {
        return root.current!;
      },
      pose(finAmount, legAmount, plumeAmount, flicker = 0) {
        fins.current.forEach((fin) => {
          fin.rotation.x = THREE.MathUtils.lerp(FIN_FOLDED, FIN_DEPLOYED, finAmount);
        });
        legs.current.forEach((leg) => {
          leg.rotation.x = THREE.MathUtils.lerp(LEG_FOLDED, LEG_DEPLOYED, legAmount);
        });
        const p = plume.current;
        if (p) {
          p.visible = plumeAmount > 0.01;
          p.scale.set(0.6 + 0.4 * plumeAmount, plumeAmount * (1 + flicker * 0.12), 0.6 + 0.4 * plumeAmount);
        }
        if (plumeOuter.current) plumeOuter.current.opacity = 0.55 * plumeAmount;
        if (plumeCore.current) plumeCore.current.opacity = 0.9 * plumeAmount;
      },
    }),
    []
  );

  return (
    <group ref={root}>
      {/* Engine section, tank, and dark interstage. */}
      <mesh position={[0, 0.04, 0]} material={materials.soot}>
        <cylinderGeometry args={[RADIUS * 1.02, RADIUS * 1.08, 0.08, segments]} />
      </mesh>
      <mesh position={[0, 0.46, 0]} material={materials.body}>
        <cylinderGeometry args={[RADIUS, RADIUS, 0.76, segments]} />
      </mesh>
      <mesh position={[0, 0.9, 0]} material={materials.soot}>
        <cylinderGeometry args={[RADIUS, RADIUS, 0.12, segments]} />
      </mesh>

      {[0, 1, 2, 3].map((i) => (
        <group key={`fin-${i}`} rotation={[0, (i * Math.PI) / 2, 0]}>
          <group
            position={[0, 0.93, RADIUS]}
            ref={(el) => {
              if (el) fins.current[i] = el;
            }}
          >
            <mesh position={[0, 0.035, 0.002]} material={materials.metal}>
              <boxGeometry args={[0.06, 0.07, 0.006]} />
            </mesh>
          </group>
        </group>
      ))}

      {[0, 1, 2, 3].map((i) => (
        <group key={`leg-${i}`} rotation={[0, Math.PI / 4 + (i * Math.PI) / 2, 0]}>
          <group
            position={[0, 0.1, RADIUS]}
            ref={(el) => {
              if (el) legs.current[i] = el;
            }}
          >
            <mesh position={[0, 0.17, 0.006]} material={materials.soot}>
              <boxGeometry args={[0.03, 0.34, 0.014]} />
            </mesh>
          </group>
        </group>
      ))}

      <group ref={plume} visible={false}>
        <mesh position={[0, -0.32, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.07, 0.62, segments, 1, true]} />
          <meshBasicMaterial ref={plumeOuter} color="#ff7a2a" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -0.16, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.032, 0.3, segments, 1, true]} />
          <meshBasicMaterial ref={plumeCore} color="#fff2c4" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}
