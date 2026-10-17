// One-finger control (DESIGN.md §1): touch anywhere, drag horizontally, release
// to shove straight up. No aim angle, no power meter — position is the only
// decision the player makes.

import { W, H } from './constants';

export interface InputDeps {
  canvas: HTMLCanvasElement;
  /** False while the game is over or the cooldown is still running. */
  canAim(): boolean;
  /** Called with a world-space x each time the finger moves. */
  aimAt(worldX: number): void;
  /** Release — launch the waiting slime. */
  launch(): void;
  /** Every touch and release, used to unlock or wake the audio context. */
  onFirstTouch(): void;
}

export interface InputHandle {
  /** True while a finger is down — the aim guide brightens. */
  isAiming(): boolean;
}

export function initInput(d: InputDeps): InputHandle {
  const cv = d.canvas;
  let aimId: number | null = null;

  const toWorld = (e: PointerEvent): { x: number; y: number } => {
    const r = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    };
  };

  cv.addEventListener('pointerdown', (e) => {
    d.onFirstTouch();
    if (!d.canAim()) return;
    d.aimAt(toWorld(e).x);
    aimId = e.pointerId;
    cv.setPointerCapture(e.pointerId);
  });

  cv.addEventListener('pointermove', (e) => {
    if (aimId !== null && e.pointerId === aimId) d.aimAt(toWorld(e).x);
  });

  cv.addEventListener('pointerup', (e) => {
    // On iOS a touch only counts as a gesture on release, so audio unlocks here.
    d.onFirstTouch();
    if (aimId === null || e.pointerId !== aimId) return;
    aimId = null;
    d.launch();
  });

  cv.addEventListener('pointercancel', () => {
    aimId = null;
  });

  return { isAiming: () => aimId !== null };
}
