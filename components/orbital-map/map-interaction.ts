import CameraControlsImpl from 'camera-controls';

const { ACTION } = CameraControlsImpl;

/** Until the user clicks into the map, plain wheel and one-finger drags belong to the page; pinch still zooms. */
export function cameraInputs(engaged: boolean) {
  return {
    one: engaged ? ACTION.TOUCH_ROTATE : ACTION.NONE,
    two: ACTION.TOUCH_DOLLY_TRUCK,
    touchAction: engaged ? 'none' : 'pan-x pan-y',
  };
}

/** Trackpad pinch arrives as ctrl+wheel, so it zooms even while the map isn't engaged. */
export function wheelAction(engaged: boolean, ctrlKey: boolean) {
  return engaged || ctrlKey ? ACTION.DOLLY : ACTION.NONE;
}
