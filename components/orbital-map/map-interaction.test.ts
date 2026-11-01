import { describe, expect, it } from 'vitest';
import CameraControlsImpl from 'camera-controls';
import { cameraInputs, wheelAction } from './map-interaction';

const { ACTION } = CameraControlsImpl;

describe('map wheel and touch gating', () => {
  it('lets a plain wheel scroll the page until the map is engaged', () => {
    expect(wheelAction(false, false)).toBe(ACTION.NONE);
    expect(wheelAction(true, false)).toBe(ACTION.DOLLY);
  });

  it('zooms on ctrl+wheel (and trackpad pinch) without engaging', () => {
    expect(wheelAction(false, true)).toBe(ACTION.DOLLY);
  });

  it('hands one-finger drags to the page but keeps pinch zoom while idle', () => {
    expect(cameraInputs(false)).toEqual({ one: ACTION.NONE, two: ACTION.TOUCH_DOLLY_TRUCK, touchAction: 'pan-x pan-y' });
  });

  it('takes every gesture once engaged', () => {
    expect(cameraInputs(true)).toEqual({ one: ACTION.TOUCH_ROTATE, two: ACTION.TOUCH_DOLLY_TRUCK, touchAction: 'none' });
  });
});
