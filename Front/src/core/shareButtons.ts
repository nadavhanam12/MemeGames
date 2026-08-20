// Shared "SHARE TO" block for the meme zoom views (GalleryScene, UIScene's
// unlock zoom): a title, a row of three platform buttons (official app
// icons from public/icons/, preloaded in BootScene — see shareIcons.ts),
// and a DOWNLOAD button beneath.
import Phaser from 'phaser';
import { FONT_DISPLAY, HEX, FONT_SANS, PAL } from './palette';
import { sfx } from './sfx';
import { SharePlatform } from './share';
import { SHARE_ICON_KEYS } from './shareIcons';

const PLATFORM_BUTTONS: { platform: SharePlatform; textureKey: string }[] = [
  { platform: 'whatsapp', textureKey: SHARE_ICON_KEYS.whatsapp },
  { platform: 'x', textureKey: SHARE_ICON_KEYS.x },
  { platform: 'facebook', textureKey: SHARE_ICON_KEYS.facebook }
];

/** Adds a "SHARE TO" block to `parent`, top edge at local y `y`: a title,
 *  a centered row of platform icon buttons, then a DOWNLOAD button.
 *  pointerdown is swallowed on every button so a tap can't fall through to
 *  a close/drag handler underneath. */
export function addExportButtonRow(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  y: number,
  onSave: () => void,
  onPlatform: (platform: SharePlatform) => void
): void {
  const iconBtnSize = 56;
  const gap = 18;

  const title = scene.add
    .text(0, y, 'SHARE TO', { fontFamily: FONT_SANS, fontSize: '13px', fontStyle: 'bold', color: '#AAB4BD' })
    .setOrigin(0.5);
  parent.add(title);

  const rowY = y + 34;
  const totalW = PLATFORM_BUTTONS.length * iconBtnSize + (PLATFORM_BUTTONS.length - 1) * gap;
  let x = -totalW / 2;
  for (const { platform, textureKey } of PLATFORM_BUTTONS) {
    const btn = scene.add.container(x + iconBtnSize / 2, rowY);
    const icon = scene.add.image(0, 0, textureKey).setDisplaySize(iconBtnSize, iconBtnSize);
    btn.add(icon);
    btn.setSize(iconBtnSize, iconBtnSize);
    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) =>
      ev.stopPropagation()
    );
    btn.on('pointerup', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      sfx.tap();
      onPlatform(platform);
    });
    parent.add(btn);
    x += iconBtnSize + gap;
  }

  const downloadY = rowY + iconBtnSize / 2 + 16 + 20;
  const download = scene.add.container(0, downloadY);
  download.add(scene.add.rectangle(0, 0, totalW, 40, PAL.green).setStrokeStyle(3, PAL.ink));
  download.add(
    scene.add
      .text(0, 0, 'DOWNLOAD', { fontFamily: FONT_DISPLAY, fontSize: '17px', color: HEX.ink })
      .setOrigin(0.5)
  );
  download.setSize(totalW, 40);
  download.setInteractive({ useHandCursor: true });
  download.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) =>
    ev.stopPropagation()
  );
  download.on('pointerup', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
    ev.stopPropagation();
    sfx.tap();
    onSave();
  });
  parent.add(download);
}
