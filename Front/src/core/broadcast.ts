// Shared "TV broadcast" screen language: the channel-cut transition between
// scenes, static blinks, lower-third news straps, the ticker crawl, and the
// stamp entrance. Every menu/recap screen uses these so the whole game feels
// like one news channel. All effects respect settings.reducedMotion.
import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from './palette';
import { settings } from './settings';
import { sfx } from './sfx';

const CUT_DEPTH = 100000;

/** Satirical ticker pool — screens can prepend their own live-stat lines. */
export const HEADLINES: string[] = [
  "OIL ANALYSTS 'CAUTIOUSLY CONFIDENT' FOR THIRD TIME TODAY",
  'STRAIT OF HORMUZ STILL EXACTLY 21 MILES WIDE, EXPERTS CONFIRM',
  "TANKER CAPTAINS ASK MARKETS TO 'PLEASE CALM DOWN'",
  'PREDICTION MARKET NOW PREDICTING OTHER PREDICTION MARKETS',
  'SEAGULL ON RADAR CAUSES BRIEF INTERNATIONAL INCIDENT',
  'LOCAL MAN TOPS UP TANK, DECLARES SELF ENERGY EXPERT',
  "GUNNER REPORTEDLY 'VERY GOOD AT THIS, MAYBE THE BEST'",
  'MINES: ROUND, RUDE, AND BACK IN FASHION',
  'ANCHORS REMINDED THAT MELTDOWN IS A MARKET TERM',
  'THIS TICKER POWERED BY OIL MONEY'
];

/** Coarse white-noise texture used by every static effect. */
function ensureStatic(scene: Phaser.Scene): void {
  if (scene.textures.exists('staticGen')) return;
  const w = 200;
  const h = 112;
  const canvas = scene.textures.createCanvas('staticGen', w, h);
  if (!canvas) return;
  const ctx = canvas.getContext();
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  canvas.refresh();
}

/** Full-screen static frame that jitters then fades — the "channel flip". */
export function staticBlink(scene: Phaser.Scene, ms = 150, withSound = true): void {
  if (settings.reducedMotion) return;
  ensureStatic(scene);
  if (withSound) sfx.staticBurst();
  const tile = scene.add
    .tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 'staticGen')
    .setTileScale(3)
    .setDepth(CUT_DEPTH)
    .setAlpha(0.9);
  const jitter = scene.time.addEvent({
    delay: 40,
    repeat: Math.ceil(ms / 40),
    callback: () => tile.setTilePosition(Math.random() * 200, Math.random() * 112)
  });
  scene.tweens.add({
    targets: tile,
    alpha: 0,
    delay: ms * 0.5,
    duration: ms * 0.5,
    onComplete: () => {
      jitter.remove();
      tile.destroy();
    }
  });
}

/** A world-space rect the static overlay should cover — defaults to the full
 *  GAME_W×GAME_H frame, but a scene running its camera off the default
 *  zoom/scroll (e.g. IntroScene's map zoom) must pass its current visible
 *  world rect so the static actually covers the screen. */
export interface StaticRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const DEFAULT_RECT: StaticRect = { x: GAME_W / 2, y: GAME_H / 2, w: GAME_W, h: GAME_H };

/** Outgoing half of the channel cut: a brief static shimmer → switch scenes.
 *  No white flash — just a soft camera-switch feel. ~200ms total; instant
 *  under reduced motion. The incoming scene should call broadcastReveal() in
 *  create() for the matching static-settle. */
export function broadcastCut(scene: Phaser.Scene, go: () => void): void {
  broadcastCutAt(scene, DEFAULT_RECT, go);
}

/** Same as broadcastCut, but sized/positioned to a specific world-space rect
 *  instead of assuming the default full-canvas camera framing. */
export function broadcastCutAt(scene: Phaser.Scene, rect: StaticRect, go: () => void): void {
  if (settings.reducedMotion) {
    go();
    return;
  }
  ensureStatic(scene);
  sfx.staticBurst();
  const tile = scene.add
    .tileSprite(rect.x, rect.y, rect.w, rect.h, 'staticGen')
    .setTileScale(3)
    .setDepth(CUT_DEPTH)
    .setAlpha(0);
  scene.tweens.add({ targets: tile, alpha: 0.55, duration: 70, ease: 'Quad.easeIn' });
  scene.time.addEvent({
    delay: 40,
    repeat: 3,
    callback: () => tile.setTilePosition(Math.random() * 200, Math.random() * 112)
  });
  // switch while the static frame still covers the screen — a soft cut
  scene.time.delayedCall(160, go);
}

/** Incoming half: a static frame settling into the new "camera feed". */
export function broadcastReveal(scene: Phaser.Scene): void {
  broadcastRevealAt(scene, DEFAULT_RECT);
}

/** Same as broadcastReveal, but sized/positioned to a specific world-space
 *  rect instead of assuming the default full-canvas camera framing. */
export function broadcastRevealAt(scene: Phaser.Scene, rect: StaticRect): void {
  if (settings.reducedMotion) return;
  ensureStatic(scene);
  const tile = scene.add
    .tileSprite(rect.x, rect.y, rect.w, rect.h, 'staticGen')
    .setTileScale(3)
    .setDepth(CUT_DEPTH)
    .setAlpha(0.55);
  const jitter = scene.time.addEvent({
    delay: 40,
    repeat: 3,
    callback: () => tile.setTilePosition(Math.random() * 200, Math.random() * 112)
  });
  scene.tweens.add({
    targets: tile,
    alpha: 0,
    duration: 130,
    ease: 'Quad.easeOut',
    onComplete: () => {
      jitter.remove();
      tile.destroy();
    }
  });
}

export interface LowerThirdOpts {
  x: number; // left edge of the strap
  y: number; // vertical center of the main bar
  kicker: string; // small tab above the bar ("BREAKING NEWS")
  main: string; // the big line
  width?: number; // bar width; defaults to fitting the text
  mainSize?: number;
  color?: number; // bar fill, default news red
  depth?: number;
}

/** Animated news strap: red main bar + small kicker tab, slides in from the
 *  left like a graphics package. Returns the container (origin at opts.x/y). */
export function lowerThird(scene: Phaser.Scene, opts: LowerThirdOpts): Phaser.GameObjects.Container {
  const mainSize = opts.mainSize ?? 34;
  const c = scene.add.container(opts.x, opts.y).setDepth(opts.depth ?? 500);
  const mainTxt = scene.add
    .text(18, 0, opts.main, {
      fontFamily: FONT_DISPLAY,
      fontSize: `${mainSize}px`,
      color: HEX.cream,
      stroke: HEX.ink,
      strokeThickness: 5
    })
    .setOrigin(0, 0.5);
  const barW = opts.width ?? mainTxt.width + 36;
  const barH = mainSize + 22;
  const bar = scene.add
    .rectangle(barW / 2, 0, barW, barH, opts.color ?? PAL.red)
    .setStrokeStyle(4, PAL.ink);
  const kickTxt = scene.add
    .text(12, -barH / 2 - 14, opts.kicker, {
      fontFamily: FONT_SANS,
      fontSize: '15px',
      fontStyle: 'bold',
      color: HEX.ink
    })
    .setOrigin(0, 0.5);
  const kickBg = scene.add
    .rectangle(12 + kickTxt.width / 2, -barH / 2 - 14, kickTxt.width + 20, 26, PAL.cream)
    .setStrokeStyle(3, PAL.ink);
  c.add([bar, mainTxt, kickBg, kickTxt]);
  if (!settings.reducedMotion) {
    c.setAlpha(0);
    c.x = opts.x - 320;
    scene.tweens.add({ targets: c, x: opts.x, alpha: 1, duration: 300, ease: 'Cubic.easeOut' });
  }
  return c;
}

/** Stamped-on entrance (score reveals, "OFFICIAL" seals): slams from big. */
export function stampIn(scene: Phaser.Scene, obj: any, delay = 0): void {
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;
  if (settings.reducedMotion) {
    obj.setAlpha(1);
    return;
  }
  obj.setAlpha(0);
  obj.setScale(sx * 2.4, sy * 2.4);
  scene.tweens.add({
    targets: obj,
    scaleX: sx,
    scaleY: sy,
    alpha: 1,
    delay,
    duration: 200,
    ease: 'Cubic.easeIn',
    onComplete: () => sfx.hit()
  });
}

/** Bottom-of-screen ticker crawl: LIVE tag + endless satirical headlines.
 *  `extra` lines (live stats) are woven in ahead of the canned pool. */
export function createTicker(scene: Phaser.Scene, y: number, extra: string[] = []): void {
  const stripH = 36;
  scene.add
    .rectangle(GAME_W / 2, y, GAME_W, stripH, PAL.ink, 0.92)
    .setStrokeStyle(2, PAL.gold, 0.4)
    .setDepth(600);
  const tagW = 176;
  scene.add.rectangle(tagW / 2, y, tagW, stripH, PAL.red).setStrokeStyle(3, PAL.ink).setDepth(602);
  const tag = scene.add
    .text(tagW / 2, y, '◉ LIVE — HHN', {
      fontFamily: FONT_SANS,
      fontSize: '17px',
      fontStyle: 'bold',
      color: HEX.cream
    })
    .setOrigin(0.5)
    .setDepth(603);
  if (!settings.reducedMotion) {
    scene.tweens.add({ targets: tag, alpha: 0.55, duration: 700, yoyo: true, repeat: -1 });
  }

  const pool = [...extra, ...Phaser.Utils.Array.Shuffle([...HEADLINES])];
  if (settings.reducedMotion) {
    // no crawl: one static headline, swapped on a timer
    let idx = 0;
    const txt = scene.add
      .text((GAME_W + tagW) / 2, y, pool[0], {
        fontFamily: FONT_SANS,
        fontSize: '17px',
        fontStyle: 'bold',
        color: HEX.cream
      })
      .setOrigin(0.5)
      .setDepth(601);
    scene.time.addEvent({
      delay: 5000,
      loop: true,
      callback: () => {
        idx = (idx + 1) % pool.length;
        txt.setText(pool[idx]);
      }
    });
    return;
  }

  const crawl = scene.add
    .text(GAME_W, y, pool.join('  +++  ') + '  +++  ', {
      fontFamily: FONT_SANS,
      fontSize: '17px',
      fontStyle: 'bold',
      color: HEX.cream
    })
    .setOrigin(0, 0.5)
    .setDepth(601);
  // clip the crawl so it slides under the LIVE tag, not over it
  const maskShape = scene.make.graphics({}, false);
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(tagW + 6, y - stripH / 2, GAME_W - tagW - 6, stripH);
  crawl.setMask(maskShape.createGeometryMask());
  const dist = crawl.width + (GAME_W - tagW);
  scene.tweens.add({
    targets: crawl,
    x: { from: GAME_W, to: GAME_W - dist },
    duration: (dist / 80) * 1000, // 80 px/s reading speed
    repeat: -1
  });
}
