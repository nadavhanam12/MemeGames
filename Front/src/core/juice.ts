// Reusable animation helpers — all tweens route through here so easing,
// timing and reduced-motion handling stay consistent.
import Phaser from 'phaser';
import { FONT_DISPLAY, HEX } from './palette';
import { settings } from './settings';

export const EASE = {
  pop: 'Back.easeOut',
  snap: 'Cubic.easeOut',
  inOut: 'Sine.easeInOut',
  overshoot: 'Back.easeOut'
} as const;

/** Global cap so overlapping celebrations can't melt mid-range phones. */
let liveFx = 0;
const MAX_FX = 40;
export function fxBudget(): boolean {
  return liveFx < MAX_FX;
}
function fxOpen(): void {
  liveFx++;
}
function fxClose(): void {
  liveFx = Math.max(0, liveFx - 1);
}

/** Button/target press: quick compress then release. */
export function pressPulse(scene: Phaser.Scene, obj: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, scale = 0.85): void {
  const base = (obj as any).getData?.('baseScale') ?? 1;
  scene.tweens.add({
    targets: obj,
    scaleX: base * scale,
    scaleY: base * scale,
    duration: 60,
    yoyo: true,
    ease: 'Quad.easeOut'
  });
}

/** Floating reward text ("−$0.50 OIL", "+$5"). */
export function floatText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: string,
  size = 30
): void {
  if (!fxBudget()) return;
  fxOpen();
  const t = scene.add
    .text(x, y, text, {
      fontFamily: FONT_DISPLAY,
      fontSize: `${size}px`,
      color,
      stroke: HEX.ink,
      strokeThickness: 6
    })
    .setOrigin(0.5)
    .setDepth(900);
  const rise = settings.reducedMotion ? 20 : 70;
  scene.tweens.add({
    targets: t,
    y: y - rise,
    alpha: { from: 1, to: 0 },
    scale: { from: 0.6, to: 1.1 },
    duration: settings.reducedMotion ? 350 : 700,
    ease: 'Cubic.easeOut',
    onComplete: () => {
      t.destroy();
      fxClose();
    }
  });
}

/** Expanding circular shockwave ring. */
export function shockwave(scene: Phaser.Scene, x: number, y: number, color: number, maxRadius = 90): void {
  if (settings.reducedMotion || !fxBudget()) return;
  fxOpen();
  const g = scene.add.graphics().setDepth(850);
  const state = { r: 8, a: 0.9 };
  scene.tweens.add({
    targets: state,
    r: maxRadius,
    a: 0,
    duration: 300,
    ease: 'Cubic.easeOut',
    onUpdate: () => {
      g.clear();
      g.lineStyle(6 * (state.a + 0.2), color, state.a);
      g.strokeCircle(x, y, state.r);
    },
    onComplete: () => {
      g.destroy();
      fxClose();
    }
  });
}

/** Bright impact flash disc. */
export function impactFlash(scene: Phaser.Scene, x: number, y: number, color = 0xffffff, size = 44): void {
  if (!fxBudget()) return;
  fxOpen();
  const c = scene.add.circle(x, y, size, color, 1).setDepth(860);
  scene.tweens.add({
    targets: c,
    scale: { from: 0.3, to: 1.2 },
    alpha: { from: 1, to: 0 },
    duration: settings.reducedMotion ? 90 : 160,
    ease: 'Quad.easeOut',
    onComplete: () => {
      c.destroy();
      fxClose();
    }
  });
}

let lastShake = 0;
/** Camera impulse with a rate cap so stacked hits don't blur the screen. */
export function camImpulse(scene: Phaser.Scene, intensity = 0.004, duration = 90): void {
  if (settings.reducedMotion) return;
  const now = scene.time.now;
  if (now - lastShake < 70) return;
  lastShake = now;
  scene.cameras.main.shake(duration, intensity);
}

/** Tween a Text object's displayed number toward a target. */
export function countTo(
  scene: Phaser.Scene,
  txt: Phaser.GameObjects.Text,
  from: number,
  to: number,
  format: (v: number) => string,
  duration = 400
): void {
  const state = { v: from };
  scene.tweens.add({
    targets: state,
    v: to,
    duration: settings.reducedMotion ? Math.min(duration, 150) : duration,
    ease: 'Cubic.easeOut',
    onUpdate: () => txt.setText(format(state.v))
  });
}

/** Pop-in for panels/badges. */
export function popIn(scene: Phaser.Scene, obj: any, duration = 260): void {
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;
  obj.setScale(0.2 * sx, 0.2 * sy);
  obj.setAlpha(0);
  scene.tweens.add({
    targets: obj,
    scaleX: sx,
    scaleY: sy,
    alpha: 1,
    duration: settings.reducedMotion ? 120 : duration,
    ease: EASE.pop
  });
}

export function confetti(scene: Phaser.Scene, x: number, y: number, count = 24): void {
  if (settings.reducedMotion) count = Math.min(count, 8);
  const colors = [0x35d07f, 0xf4b942, 0xff8a3d, 0x9b5de5, 0xfff3d6];
  for (let i = 0; i < count; i++) {
    if (!fxBudget()) break;
    fxOpen();
    const r = scene.add
      .rectangle(x, y, 10, 14, colors[i % colors.length])
      .setDepth(950)
      .setAngle(Math.random() * 360);
    scene.tweens.add({
      targets: r,
      x: x + (Math.random() - 0.5) * 420,
      y: y + 180 + Math.random() * 320,
      angle: r.angle + (Math.random() - 0.5) * 720,
      alpha: { from: 1, to: 0 },
      duration: 900 + Math.random() * 500,
      ease: 'Quad.easeIn',
      onComplete: () => {
        r.destroy();
        fxClose();
      }
    });
  }
}
