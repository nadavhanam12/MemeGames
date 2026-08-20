// Meme collection screen — every template in the library, shown as a
// scrollable grid: full color once unlocked (fired at least once, any run),
// grey while still locked. Tap/click a tile to zoom it. Drag or mouse-wheel
// to scroll — pointer events unify touch and mouse, so this works on mobile
// the same way GameScene's tap-to-fire does.
// The tile list is read live from MEMES.templates (memes.json), so adding or
// removing a meme there needs no change here — the gallery follows automatically.
// Launch with: this.scene.start('Gallery', { from: 'Menu' | 'Results' })
import Phaser from 'phaser';
import { DPR, FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { hasArt } from '../core/art';
import { sfx } from '../core/sfx';
import { pressPulse } from '../core/juice';
import { MEMES } from '../core/memes';
import { getUnlockedTemplates } from '../core/memeUnlocks';
import { captureAndShare, captureAndShareTo } from '../core/share';
import { addExportButtonRow } from '../core/shareButtons';

const COLS = 9;
const TILE_W = 118;
const TILE_H = 118;
const GAP_X = 14;
const GAP_Y = 12;
const VIEWPORT_TOP = 116;
const VIEWPORT_BOTTOM = 638; // above the BACK button
const CLICK_DRAG_THRESHOLD = 8; // px of movement below which a release counts as a tap, not a scroll

export class GalleryScene extends Phaser.Scene {
  private from: string = 'Menu';
  private ids: string[] = [];
  private grid!: Phaser.GameObjects.Container;
  private focusLayer?: Phaser.GameObjects.Container;

  private baseY = 0;
  private contentOffset = 0;
  private maxScroll = 0;
  private pointerDown = false;
  private dragStartY = 0;
  private dragStartOffset = 0;
  private dragMoved = 0;

  constructor() {
    super('Gallery');
  }

  create(data: { from?: string }): void {
    this.from = data?.from ?? 'Menu';
    this.ids = Object.keys(MEMES.templates);
    this.contentOffset = 0;
    this.pointerDown = false;
    this.dragMoved = 0;
    this.focusLayer = undefined;

    const cx = GAME_W / 2;
    this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, PAL.navy);
    this.add.rectangle(cx, 52, GAME_W, 88, PAL.ink).setStrokeStyle(4, PAL.gold, 0.5);
    this.add
      .text(cx, 38, 'MEME COLLECTION', {
        fontFamily: FONT_DISPLAY,
        fontSize: '38px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 6
      })
      .setOrigin(0.5);
    this.add
      .text(cx, 78, `${getUnlockedTemplates().size} / ${this.ids.length} UNLOCKED — TAP AN UNLOCKED MEME TO ZOOM`, {
        fontFamily: FONT_SANS,
        fontSize: '15px',
        fontStyle: 'bold',
        color: HEX.gold
      })
      .setOrigin(0.5);

    this.grid = this.add.container(0, 0);
    this.buildGrid();

    // clip the grid to the scrollable viewport band
    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(0, VIEWPORT_TOP, GAME_W, VIEWPORT_BOTTOM - VIEWPORT_TOP);
    this.grid.setMask(maskShape.createGeometryMask());

    this.makeButton(150, 668, 200, '← BACK', PAL.red, () => this.scene.start(this.from));

    this.setupScrollInput();

    this.events.on('shutdown', () => {
      this.input.off('pointerdown');
      this.input.off('pointermove');
      this.input.off('pointerup');
      this.input.off('wheel');
    });
  }

  private buildGrid(): void {
    const unlocked = getUnlockedTemplates();
    const rows = Math.ceil(this.ids.length / COLS);
    const gridW = COLS * TILE_W + (COLS - 1) * GAP_X;
    const originX = GAME_W / 2 - gridW / 2 + TILE_W / 2;
    this.baseY = VIEWPORT_TOP + TILE_H / 2 + 6;
    const contentH = rows * TILE_H + (rows - 1) * GAP_Y;
    this.maxScroll = Math.max(0, contentH - (VIEWPORT_BOTTOM - VIEWPORT_TOP - 12));

    this.ids.forEach((id, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = originX + col * (TILE_W + GAP_X);
      const y = this.baseY + row * (TILE_H + GAP_Y);
      const tpl = MEMES.templates[id];
      const unlockedHere = unlocked.has(id);

      const tile = this.add.container(x, y);
      tile.add(
        this.add.rectangle(0, 0, TILE_W, TILE_H, 0x0e161e).setStrokeStyle(3, unlockedHere ? PAL.gold : 0x39424e)
      );

      const maxW = TILE_W - 14;
      const maxH = TILE_H - 14;
      let w = maxW;
      let h = w * tpl.aspect;
      if (h > maxH) {
        h = maxH;
        w = h / tpl.aspect;
      }

      if (hasArt(this, tpl.artKey)) {
        const img = this.add.image(0, 0, tpl.artKey).setDisplaySize(w, h);
        if (!unlockedHere) img.setTint(0x3d434a).setAlpha(0.7);
        tile.add(img);
      } else {
        tile.add(this.add.rectangle(0, 0, w, h, unlockedHere ? 0xf2f2f2 : 0x2a323b));
      }

      tile.setSize(TILE_W, TILE_H);
      tile.setInteractive({ useHandCursor: unlockedHere });
      tile.on('pointerup', () => {
        if (this.dragMoved > CLICK_DRAG_THRESHOLD) return;
        if (!unlockedHere) {
          // locked — a little shake instead of opening the zoom view
          sfx.tap();
          this.tweens.add({ targets: tile, x: tile.x - 6, duration: 40, yoyo: true, repeat: 2 });
          return;
        }
        sfx.tap();
        this.showFocusedMeme(id);
      });

      this.grid.add(tile);
    });
  }

  /** Mouse: click-and-hold drag, or wheel — never on hover alone. Touch: drag
   *  while the finger is down (touch has no hover state, so this is already
   *  touch-only by construction). A release is treated as a tile tap only
   *  when movement stayed under the threshold, so scrolling never
   *  accidentally opens the zoom view. */
  private setupScrollInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // 'pointerdown' only fires on a genuine press (mouse button or touch
      // contact) — never on hover — so no extra isDown gate is needed here.
      // (pointer coords are in DPR-scaled canvas pixels; layout is logical)
      const py = p.y / DPR;
      if (py < VIEWPORT_TOP || py > VIEWPORT_BOTTOM) return;
      this.pointerDown = true;
      this.dragStartY = py;
      this.dragStartOffset = this.contentOffset;
      this.dragMoved = 0;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.pointerDown) return;
      if (!p.isDown) {
        // button/touch released without us seeing pointerup (e.g. released
        // off-window) — stop scrolling instead of following the pointer
        this.pointerDown = false;
        return;
      }
      const dy = p.y / DPR - this.dragStartY;
      this.dragMoved = Math.max(this.dragMoved, Math.abs(dy));
      this.contentOffset = Phaser.Math.Clamp(this.dragStartOffset + dy, -this.maxScroll, 0);
      this.grid.y = this.contentOffset;
    });
    this.input.on('pointerup', () => {
      this.pointerDown = false;
    });
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      this.contentOffset = Phaser.Math.Clamp(this.contentOffset - dy * 0.6, -this.maxScroll, 0);
      this.grid.y = this.contentOffset;
    });
  }

  /** Full-screen zoom for one template — art only, plus a locked/unlocked badge. */
  private showFocusedMeme(id: string): void {
    this.focusLayer?.destroy();
    const tpl = MEMES.templates[id];
    const unlockedHere = getUnlockedTemplates().has(id);

    const layer = this.add.container(GAME_W / 2, GAME_H / 2).setDepth(2000);
    this.focusLayer = layer;
    layer.add(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.85));

    const maxW = 520;
    const maxH = 440;
    let w = maxW;
    let h = w * tpl.aspect;
    if (h > maxH) {
      h = maxH;
      w = h / tpl.aspect;
    }

    layer.add(
      this.add.rectangle(0, -30, w + 24, h + 24, PAL.ink).setStrokeStyle(5, unlockedHere ? PAL.gold : 0x39424e)
    );

    if (hasArt(this, tpl.artKey)) {
      const img = this.add.image(0, -30, tpl.artKey).setDisplaySize(w, h);
      if (!unlockedHere) img.setTint(0x3d434a).setAlpha(0.75);
      layer.add(img);
    } else {
      layer.add(this.add.rectangle(0, -30, w, h, unlockedHere ? 0xf2f2f2 : 0x2a323b));
      layer.add(
        this.add.text(0, -30, tpl.label, { fontFamily: FONT_SANS, fontSize: '16px', color: '#9aa4ad' }).setOrigin(0.5)
      );
    }

    layer.add(
      this.add
        .text(0, h / 2 + 14, unlockedHere ? '✓ UNLOCKED' : '🔒 LOCKED', {
          fontFamily: FONT_DISPLAY,
          fontSize: '22px',
          color: unlockedHere ? HEX.green : '#9aa4ad'
        })
        .setOrigin(0.5)
    );
    layer.add(
      this.add
        .text(0, h / 2 + 46, 'TAP TO CLOSE', {
          fontFamily: FONT_SANS,
          fontSize: '14px',
          fontStyle: 'bold',
          color: '#AAB4BD'
        })
        .setOrigin(0.5)
    );

    if (unlockedHere) {
      // SAVE downloads the framed art rect as a watermarked PNG; the platform
      // buttons download it too, then open that platform's share-compose
      // window/app with a caption + link prefilled (see share.ts — no web
      // API lets a page attach the image directly into WhatsApp/X/Facebook).
      const frameRect = () => {
        const frameW = w + 24;
        const frameH = h + 24;
        return { x: GAME_W / 2 - frameW / 2, y: GAME_H / 2 - 30 - frameH / 2, w: frameW, h: frameH };
      };
      addExportButtonRow(
        this,
        layer,
        h / 2 + 96,
        () =>
          void captureAndShare(this.game, frameRect(), `hormuz-meme-${id}.png`, "From my HORMUZ HOLD'EM collection", 'gallery', 'download'),
        platform =>
          void captureAndShareTo(this.game, frameRect(), `hormuz-meme-${id}.png`, "From my HORMUZ HOLD'EM collection", 'gallery', platform)
      );
    }

    layer.setSize(GAME_W, GAME_H);
    layer.setInteractive({ useHandCursor: true });
    // pointerup (not pointerdown) + stopPropagation: matches the tile-open
    // listener's event type, so this dispatch pass consumes it before it can
    // reach the grid tile underneath and immediately reopen a different meme.
    layer.on('pointerup', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      sfx.tap();
      layer.destroy();
      if (this.focusLayer === layer) this.focusLayer = undefined;
    });
  }

  private makeButton(x: number, y: number, w: number, label: string, color: number, onClick: () => void): void {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, 56, color).setStrokeStyle(4, PAL.ink);
    const t = this.add
      .text(0, 0, label, { fontFamily: FONT_SANS, fontSize: '20px', fontStyle: 'bold', color: HEX.cream })
      .setOrigin(0.5);
    c.add([bg, t]);
    c.setSize(w, 56);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerdown', () => {
      sfx.unlock();
      sfx.tap();
      pressPulse(this, c);
      onClick();
    });
  }
}
