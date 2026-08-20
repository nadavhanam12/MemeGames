// Shared SAVE + platform-share button row for the meme zoom views
// (GalleryScene, UIScene's unlock zoom). One row, auto-sized to its labels,
// centered under the framed art. Platform icons are hand-drawn vector
// glyphs (no icon assets/library) — simplified but recognizable at the
// small size these buttons render at.
import Phaser from 'phaser';
import { FONT_DISPLAY, HEX, PAL } from './palette';
import { sfx } from './sfx';
import { SharePlatform } from './share';

const BRAND = {
  whatsapp: 0x25d366,
  x: 0x14171a,
  facebook: 0x1877f2
} as const;

const ICON_SIZE = 22;

/** Phone-handset silhouette (rounded bar + two circular ends, rotated 45°) —
 *  reads as a "call" glyph, the core of WhatsApp's icon. */
function whatsappIcon(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(-9, -3, 18, 6, 3);
  g.fillCircle(-9, 0, 4.5);
  g.fillCircle(9, 0, 4.5);
  g.setRotation(Math.PI / 4);
  return g;
}

/** Two thick crossing bars — the current X wordmark is itself just this
 *  shape, so a drawn cross reads truer than a font glyph at this size. */
function xIcon(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.lineStyle(4, 0xffffff, 1);
  g.beginPath();
  g.moveTo(-8, -8);
  g.lineTo(8, 8);
  g.moveTo(-8, 8);
  g.lineTo(8, -8);
  g.strokePath();
  return g;
}

/** Facebook's app icon is literally a white lowercase "f" — a text glyph
 *  is the accurate representation here, no vector drawing needed. */
function facebookIcon(scene: Phaser.Scene): Phaser.GameObjects.Text {
  return scene.add.text(0, 0, 'f', { fontFamily: FONT_DISPLAY, fontSize: '26px', color: HEX.cream }).setOrigin(0.5);
}

// text color per button — the bright SAVE/WHATSAPP fills read fine with the
// game's usual dark-ink label, but X's near-black brand fill needs a light
// label or it disappears entirely against the zoom's dark scrim
const BUTTONS: {
  label: string;
  fill: number;
  textColor: string;
  platform: SharePlatform | 'save';
  icon?: (scene: Phaser.Scene) => Phaser.GameObjects.Graphics | Phaser.GameObjects.Text;
}[] = [
  { label: 'SAVE', fill: PAL.green, textColor: HEX.ink, platform: 'save' },
  { label: 'WHATSAPP', fill: BRAND.whatsapp, textColor: HEX.ink, platform: 'whatsapp', icon: whatsappIcon },
  // no label: the drawn cross already IS the X wordmark, so a text "X" next
  // to it would just repeat the same glyph twice
  { label: '', fill: BRAND.x, textColor: HEX.cream, platform: 'x', icon: xIcon },
  { label: 'FACEBOOK', fill: BRAND.facebook, textColor: HEX.cream, platform: 'facebook', icon: facebookIcon }
];

/** Adds a centered row of buttons to `parent` at local y `y`: SAVE (plain
 *  download) plus one per SharePlatform, each with its brand icon.
 *  pointerdown is swallowed on every button so a tap can't fall through to
 *  a close/drag handler underneath. */
export function addExportButtonRow(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  y: number,
  onSave: () => void,
  onPlatform: (platform: SharePlatform) => void
): void {
  const gap = 10;
  const padX = 14;
  const iconGap = 6;
  const btnH = 40;

  const built = BUTTONS.map(({ label, fill, textColor, platform, icon }) => {
    const btn = scene.add.container(0, y);
    const text = label
      ? scene.add.text(0, 0, label, { fontFamily: FONT_DISPLAY, fontSize: '16px', color: textColor }).setOrigin(0.5)
      : null;
    const iconObj = icon?.(scene);
    const textW = text?.width ?? 0;
    const contentW = textW + (iconObj ? ICON_SIZE + (textW > 0 ? iconGap : 0) : 0);

    let cx = -contentW / 2;
    if (iconObj) {
      iconObj.setPosition(cx + ICON_SIZE / 2, 0);
      cx += ICON_SIZE + (textW > 0 ? iconGap : 0);
    }
    text?.setPosition(cx + textW / 2, 0);

    const w = Math.max(64, Math.round(contentW) + padX * 2);
    // a light stroke on every button — the X button's near-black fill would
    // otherwise vanish against the zoom's dark scrim with a dark ink stroke
    const parts: Phaser.GameObjects.GameObject[] = [scene.add.rectangle(0, 0, w, btnH, fill).setStrokeStyle(3, 0xaab4bd)];
    if (iconObj) parts.push(iconObj);
    if (text) parts.push(text);
    btn.add(parts);
    btn.setSize(w, btnH);
    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) =>
      ev.stopPropagation()
    );
    btn.on('pointerup', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      sfx.tap();
      if (platform === 'save') onSave();
      else onPlatform(platform);
    });
    return { btn, w };
  });

  const totalW = built.reduce((s, b) => s + b.w, 0) + gap * (built.length - 1);
  let x = -totalW / 2;
  for (const { btn, w } of built) {
    btn.x = x + w / 2;
    x += w + gap;
    parent.add(btn);
  }
}
