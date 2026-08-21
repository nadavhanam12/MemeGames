// Menu -> Game establishing shot: the world map settles in, then the camera
// zooms into the Strait of Hormuz before fading to black into GameScene.
// Uses its own camera zoom/pan (excluded from main.ts's default DPR-zoom
// hook, same as GameScene) so it can move freely; broadcastRevealAt takes an
// explicit world rect so the shared static-settle look still covers the
// screen correctly at the scene's own (non-default) zoom/scroll.
import Phaser from 'phaser';
import { DPR, GAME_H, GAME_W } from '../core/palette';
import { hasArt } from '../core/art';
import { settings } from '../core/settings';
import { broadcastRevealAt } from '../core/broadcast';

// Hand-picked normalized position of the Strait of Hormuz on world_map.png's
// source pixels (verified against the source image at high zoom — the narrow
// channel between the Musandam Peninsula and Iran) — adjust here if the map
// asset is ever regenerated.
const STRAIT_FRAC = { x: 0.6074, y: 0.4809 };

const ZOOM_END = 20; // how many times closer than the full-map fit
const HOLD_BEFORE_ZOOM = 450;
const ZOOM_DURATION = 1900;
const HOLD_AFTER_ZOOM = 250;
const REDUCED_MOTION_HOLD = 700;
const FADE_DURATION = 500;
const FADE_COLOR = { r: 5, g: 11, b: 22 }; // matches the scene's #050b16 background

export class IntroScene extends Phaser.Scene {
  constructor() {
    super('Intro');
  }

  create(): void {
    if (!hasArt(this, 'world_map')) {
      // no establishing asset available — skip straight to the game
      this.scene.start('Game');
      return;
    }

    const cam = this.cameras.main;
    cam.setBackgroundColor('#050b16');
    this.add.image(0, 0, 'world_map').setOrigin(0, 0);

    const tex = this.textures.get('world_map').getSourceImage() as HTMLImageElement;
    const fitZoom = (GAME_W * DPR) / tex.width;
    const targetX = tex.width * STRAIT_FRAC.x;
    const targetY = tex.height * STRAIT_FRAC.y;

    cam.setZoom(fitZoom);
    cam.centerOn(tex.width / 2, tex.height / 2);

    broadcastRevealAt(this, {
      x: tex.width / 2,
      y: tex.height / 2,
      w: tex.width,
      h: (GAME_H * tex.width) / GAME_W
    });

    let done = false;
    const advance = () => {
      if (done) return;
      done = true;
      cam.fadeOut(FADE_DURATION, FADE_COLOR.r, FADE_COLOR.g, FADE_COLOR.b);
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Game'));
    };

    // tap anywhere to skip straight to the game
    this.input.once('pointerdown', advance);

    if (settings.reducedMotion) {
      this.time.delayedCall(REDUCED_MOTION_HOLD, advance);
      return;
    }

    const startX = tex.width / 2;
    const startY = tex.height / 2;
    this.time.delayedCall(HOLD_BEFORE_ZOOM, () => {
      if (done) return;
      // drive zoom and pan off ONE eased progress value so the camera heads
      // straight at the target from frame one, instead of two independent
      // tweens (zoom + pan) drifting apart mid-flight and "correcting" later.
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: ZOOM_DURATION,
        ease: 'Linear',
        onUpdate: tween => {
          const p = tween.getValue() ?? 1;
          cam.zoom = Phaser.Math.Linear(fitZoom, fitZoom * ZOOM_END, p);
          cam.centerOn(Phaser.Math.Linear(startX, targetX, p), Phaser.Math.Linear(startY, targetY, p));
        },
        onComplete: () => this.time.delayedCall(HOLD_AFTER_ZOOM, advance)
      });
    });
  }
}
