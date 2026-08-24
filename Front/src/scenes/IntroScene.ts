// Menu -> Game establishing shot: a 3-stage cinematic drill-down into the
// Strait of Hormuz. Each stage is its own map image (world -> Gulf region ->
// Strait close-up) so labels/flags stay crisp instead of blurring out under
// one continuous zoom on a single texture. Stages are joined with an instant
// cut (no static/broadcast transition) straight into the next stage's zoom;
// the final stage ends with the same zoom+fade-to-black finish the old
// single-image intro had. Uses its own camera zoom/pan (excluded from
// main.ts's default DPR-zoom hook, same as GameScene) so it can move freely.
import Phaser from 'phaser';
import { DPR, GAME_H, GAME_W } from '../core/palette';
import { hasArt } from '../core/art';
import { settings } from '../core/settings';

const SCAN_COLOR = 0x8cffe0; // cyan-green "signal reacquiring" tint
const SCAN_DURATION = 320;

interface Stage {
  key: string;
  // Hand-picked normalized position of the Strait of Hormuz on this image's
  // source pixels (verified against the source image at high zoom) —
  // adjust here if the corresponding map asset is ever regenerated.
  fracTarget: { x: number; y: number };
  // How many times closer than this stage's own full-image fit the camera
  // pushes to before cutting to the next stage.
  zoomEnd: number;
  holdBefore: number; // stage 0 only: ms to sit on the full fit before pushing in, so labels/flags are readable
  zoomDuration: number;
}

const STAGES: Stage[] = [
  { key: 'world_map', fracTarget: { x: 0.6074, y: 0.4809 }, zoomEnd: 3.2, holdBefore: 500, zoomDuration: 1300 },
  { key: 'map_gulf', fracTarget: { x: 0.55, y: 0.478 }, zoomEnd: 2.4, holdBefore: 700, zoomDuration: 1300 },
  { key: 'map_strait_close', fracTarget: { x: 0.566, y: 0.364 }, zoomEnd: 2.6, holdBefore: 700, zoomDuration: 1800 }
];

const HOLD_AFTER_FINAL = 250;
const REDUCED_MOTION_HOLD_PER_STAGE = 500;
const FADE_DURATION = 500;
const FADE_COLOR = { r: 5, g: 11, b: 22 }; // matches the scene's #050b16 background

export class IntroScene extends Phaser.Scene {
  // fixed-zoom overlay camera for the scan-sweep VFX, so it reads as a
  // screen-space effect instead of being warped by the world camera's own
  // (constantly changing) zoom/pan into the map texture
  private uiCam!: Phaser.Cameras.Scene2D.Camera;

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

    // viewport size is in physical canvas pixels (GAME_W/H × DPR), same as
    // the canvas itself — passing logical GAME_W/H here would only cover a
    // fraction of the screen on a DPR>1 device
    this.uiCam = this.cameras.add(0, 0, GAME_W * DPR, GAME_H * DPR);
    this.uiCam.setZoom(DPR).centerOn(GAME_W / 2, GAME_H / 2);

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

  // full-screen scanline flicker + a bright horizontal sweep line, like a
  // satellite feed re-acquiring its target — plays once at each map cut
  private playScanSweep(cam: Phaser.Cameras.Scene2D.Camera): void {
    if (settings.reducedMotion) return;

    if (!this.textures.exists('introScan')) {
      const w = 4;
      const h = 4;
      const canvas = this.textures.createCanvas('introScan', w, h);
      if (canvas) {
        const ctx = canvas.getContext();
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, 1);
        canvas.refresh();
      }
    }

    // these VFX objects render only on uiCam (fixed zoom, screen-space) —
    // the world camera, which is mid-zoom/pan into the map, ignores them
    const lines = this.add
      .tileSprite(0, 0, GAME_W, GAME_H, 'introScan')
      .setOrigin(0, 0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(SCAN_COLOR)
      .setAlpha(0);
    const glow = this.add
      .rectangle(0, -30, GAME_W, 30, SCAN_COLOR, 0.15)
      .setOrigin(0, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    const beam = this.add
      .rectangle(0, -30, GAME_W, 4, SCAN_COLOR, 0.9)
      .setOrigin(0, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    cam.ignore([lines, glow, beam]);

    const cleanup = () => {
      lines.destroy();
      glow.destroy();
      beam.destroy();
    };

    this.tweens.add({
      targets: lines,
      alpha: { from: 0, to: 0.32 },
      duration: SCAN_DURATION * 0.35,
      yoyo: true,
      ease: 'Sine.easeOut'
    });
    this.tweens.add({
      targets: [glow, beam],
      y: GAME_H + 30,
      duration: SCAN_DURATION,
      ease: 'Sine.easeInOut',
      onComplete: cleanup
    });
  }

  private runStage(
    idx: number,
    stages: Stage[],
    cam: Phaser.Cameras.Scene2D.Camera,
    finish: () => void
  ): void {
    const stage = stages[idx];
    const isLast = idx === stages.length - 1;

    // destroy the previous stage's map image before adding this one
    this.children.removeAll(true);
    const mapImg = this.add.image(0, 0, stage.key).setOrigin(0, 0);
    this.uiCam.ignore(mapImg);

    // play the scan-sweep VFX right on the cut, for every stage but the
    // first (that one is the intro's own opening shot, not a map switch)
    if (idx > 0) {
      this.playScanSweep(cam);
    }

    const tex = this.textures.get(stage.key).getSourceImage() as HTMLImageElement;
    const fitZoom = (GAME_W * DPR) / tex.width;
    const targetX = tex.width * stage.fracTarget.x;
    const targetY = tex.height * stage.fracTarget.y;
    const startX = tex.width / 2;
    const startY = tex.height / 2;

    cam.setZoom(fitZoom);
    cam.centerOn(startX, startY);

    const advance = () => {
      if (isLast) {
        this.time.delayedCall(HOLD_AFTER_FINAL, finish);
        return;
      }
      this.runStage(idx + 1, stages, cam, finish);
    };

    if (settings.reducedMotion) {
      // no zoom tween: sit on the full-image fit, then move on
      this.time.delayedCall(REDUCED_MOTION_HOLD_PER_STAGE, advance);
      return;
    }

    const startZoomTween = () => {
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
    };

    // only the first stage gets a still beat on the full establishing shot —
    // every later stage cuts straight into its own full-fit-to-zoom push so
    // the motion never idles at the map switch, it just keeps going
    if (idx === 0) {
      this.time.delayedCall(stage.holdBefore, startZoomTween);
    } else {
      startZoomTween();
    }
  }
}
