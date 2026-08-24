// Menu -> Game establishing shot: a 3-stage cinematic drill-down into the
// Strait of Hormuz. Each stage is its own map image (world -> Gulf region ->
// Strait close-up) so labels/flags stay crisp instead of blurring out under
// one continuous zoom on a single texture. Stages are joined with the
// existing broadcast "channel cut" static language; the final stage ends
// with the same zoom+fade-to-black finish the old single-image intro had.
// Uses its own camera zoom/pan (excluded from main.ts's default DPR-zoom
// hook, same as GameScene) so it can move freely; broadcastCutAt/RevealAt
// take explicit world rects so the shared static-cut look still covers the
// screen correctly at each stage's own (non-default) zoom/scroll.
import Phaser from 'phaser';
import { DPR, GAME_H, GAME_W } from '../core/palette';
import { hasArt } from '../core/art';
import { settings } from '../core/settings';
import { broadcastCutAt, broadcastRevealAt } from '../core/broadcast';

interface Stage {
  key: string;
  // Hand-picked normalized position of the Strait of Hormuz on this image's
  // source pixels (verified against the source image at high zoom) —
  // adjust here if the corresponding map asset is ever regenerated.
  fracTarget: { x: number; y: number };
  // How many times closer than this stage's full-image fit the camera
  // pushes to before cutting/fading to the next stage.
  zoomEnd: number;
  holdBefore: number; // ms to sit on the full fit before pushing in, so labels/flags are readable
  zoomDuration: number;
}

const STAGES: Stage[] = [
  { key: 'world_map', fracTarget: { x: 0.6074, y: 0.4809 }, zoomEnd: 3.2, holdBefore: 500, zoomDuration: 650 },
  { key: 'map_gulf', fracTarget: { x: 0.55, y: 0.478 }, zoomEnd: 2.4, holdBefore: 700, zoomDuration: 650 },
  { key: 'map_strait_close', fracTarget: { x: 0.566, y: 0.364 }, zoomEnd: 2.6, holdBefore: 700, zoomDuration: 900 }
];

const HOLD_AFTER_FINAL = 250;
const REDUCED_MOTION_HOLD_PER_STAGE = 500;
const FADE_DURATION = 500;
const FADE_COLOR = { r: 5, g: 11, b: 22 }; // matches the scene's #050b16 background
const CUT_STATIC_MS = 160; // matches broadcastCutAt's internal delayedCall

export class IntroScene extends Phaser.Scene {
  constructor() {
    super('Intro');
  }

  create(): void {
    const stages = STAGES.filter(s => hasArt(this, s.key));
    if (!stages.length) {
      // no establishing assets available — skip straight to the game
      this.scene.start('Game');
      return;
    }

    const cam = this.cameras.main;
    cam.setBackgroundColor('#050b16');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cam.fadeOut(FADE_DURATION, FADE_COLOR.r, FADE_COLOR.g, FADE_COLOR.b);
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Game'));
    };
    // tap anywhere to skip straight to the game, from any stage
    this.input.once('pointerdown', finish);

    this.runStage(0, stages, cam, finish);
  }

  private runStage(
    idx: number,
    stages: Stage[],
    cam: Phaser.Cameras.Scene2D.Camera,
    finish: () => void
  ): void {
    const stage = stages[idx];
    const isLast = idx === stages.length - 1;

    // destroy the previous stage's map image + any leftover cut-static tile
    // (broadcastCutAt doesn't self-destroy its tile — it assumes a scene
    // switch — so this scene has to clean up between same-scene stages)
    this.children.removeAll(true);
    this.add.image(0, 0, stage.key).setOrigin(0, 0);

    const tex = this.textures.get(stage.key).getSourceImage() as HTMLImageElement;
    const fitZoom = (GAME_W * DPR) / tex.width;
    const targetX = tex.width * stage.fracTarget.x;
    const targetY = tex.height * stage.fracTarget.y;
    const startX = tex.width / 2;
    const startY = tex.height / 2;

    cam.setZoom(fitZoom);
    cam.centerOn(startX, startY);

    const rect = { x: startX, y: startY, w: tex.width, h: (GAME_H * tex.width) / GAME_W };
    broadcastRevealAt(this, rect);

    const advance = () => {
      if (isLast) {
        this.time.delayedCall(HOLD_AFTER_FINAL, finish);
        return;
      }
      broadcastCutAt(this, rect, () => this.runStage(idx + 1, stages, cam, finish));
    };

    if (settings.reducedMotion) {
      // no zoom tween: sit on the full-image fit, then move on
      this.time.delayedCall(REDUCED_MOTION_HOLD_PER_STAGE, advance);
      return;
    }

    this.time.delayedCall(stage.holdBefore, () => {
      // drive zoom and pan off ONE eased progress value so the camera heads
      // straight at the target from frame one, instead of two independent
      // tweens (zoom + pan) drifting apart mid-flight and "correcting" later.
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: stage.zoomDuration,
        ease: 'Linear',
        onUpdate: tween => {
          const p = tween.getValue() ?? 1;
          cam.zoom = Phaser.Math.Linear(fitZoom, fitZoom * stage.zoomEnd, p);
          cam.centerOn(Phaser.Math.Linear(startX, targetX, p), Phaser.Math.Linear(startY, targetY, p));
        },
        onComplete: advance
      });
    });
  }
}
