import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { loadSettings, saveSettings, settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { popIn, pressPulse } from '../core/juice';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    loadSettings();
    const cx = GAME_W / 2;

    if (hasArt(this, 'map_bg')) {
      this.add.image(cx, GAME_H / 2, 'map_bg').setDisplaySize(GAME_W, GAME_H).setAlpha(0.45);
      this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, PAL.ink, 0.35);
    } else {
      this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, PAL.navy);
      const waves = this.add.graphics();
      waves.lineStyle(4, PAL.ocean, 0.5);
      for (let y = 120; y < GAME_H; y += 80) {
        waves.beginPath();
        for (let x = -20; x <= GAME_W + 20; x += 10) {
          const yy = y + Math.sin(x / 40) * 8;
          if (x === -20) waves.moveTo(x, yy);
          else waves.lineTo(x, yy);
        }
        waves.strokePath();
      }
    }

    const banner = this.add.container(cx, 120);
    const bg = this.add.rectangle(0, 0, 700, 130, PAL.red).setStrokeStyle(6, PAL.ink);
    const t1 = this.add
      .text(0, -24, 'STRAIT SHOOTER', {
        fontFamily: FONT_DISPLAY,
        fontSize: '58px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 8
      })
      .setOrigin(0.5);
    const t2 = this.add
      .text(0, 32, 'HORMUZ MARKET DEFENSE — LIVE', {
        fontFamily: FONT_SANS,
        fontSize: '22px',
        fontStyle: 'bold',
        color: HEX.cream
      })
      .setOrigin(0.5);
    banner.add([bg, t1, t2]);
    popIn(this, banner, 400);

    // left column: how to play
    const instructions = [
      'TAP threats before they reach the tankers.',
      'Safe tankers push OIL PRICES down.',
      'Earn Defense Credits, buy upgrades fast.',
      'Chain intercepts for combo ranks.',
      'Survive! If oil pegs at the top too long,',
      'the market melts down and the run ends.'
    ];
    this.add.rectangle(330, 330, 560, 220, PAL.ink, 0.75).setStrokeStyle(3, PAL.gold, 0.6);
    instructions.forEach((line, i) => {
      this.add
        .text(330, 260 + i * 36, line, {
          fontFamily: FONT_SANS,
          fontSize: '20px',
          fontStyle: 'bold',
          color: HEX.cream,
          stroke: HEX.ink,
          strokeThickness: 3
        })
        .setOrigin(0.5);
    });

    // right column: threat legend (shape + label, accessibility)
    this.add.rectangle(950, 330, 560, 220, PAL.ink, 0.75).setStrokeStyle(3, PAL.gold, 0.6);
    const items: Array<[string, string]> = [
      ['missile', 'MISSILE'],
      ['drone', 'DRONE'],
      ['mine', 'MINE'],
      ['patrol', 'PATROL']
    ];
    items.forEach(([key, label], i) => {
      const x = 780 + i * 115;
      const img = this.add.image(x, 310, key);
      const maxDim = Math.max(img.width, img.height);
      if (maxDim > 90) img.setScale(90 / maxDim);
      this.add
        .text(x, 385, label, { fontFamily: FONT_SANS, fontSize: '16px', fontStyle: 'bold', color: HEX.cream })
        .setOrigin(0.5);
    });

    // toggles row
    this.makeToggle(cx - 330, 510, 'SOUND', () => settings.sound, v => (settings.sound = v));
    this.makeToggle(cx, 510, 'VIBRATION', () => settings.vibration, v => (settings.vibration = v));
    this.makeToggle(cx + 330, 510, 'REDUCED MOTION', () => settings.reducedMotion, v => (settings.reducedMotion = v));

    // start button
    const start = this.add.container(cx, 620);
    const sb = this.add.rectangle(0, 0, 440, 100, PAL.green).setStrokeStyle(6, PAL.ink);
    const st = this.add
      .text(0, 0, 'DEFEND THE STRAIT', { fontFamily: FONT_DISPLAY, fontSize: '34px', color: HEX.ink })
      .setOrigin(0.5);
    start.add([sb, st]);
    start.setSize(440, 100);
    start.setInteractive({ useHandCursor: true });
    if (!settings.reducedMotion) {
      this.tweens.add({ targets: start, scale: 1.04, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    // global leaderboard (backend-driven)
    const lb = this.add.container(cx + 380, 620);
    const lbBg = this.add.rectangle(0, 0, 260, 70, PAL.ocean).setStrokeStyle(6, PAL.ink);
    const lbTxt = this.add
      .text(0, 0, 'LEADERBOARD', { fontFamily: FONT_DISPLAY, fontSize: '22px', color: HEX.cream })
      .setOrigin(0.5);
    lb.add([lbBg, lbTxt]);
    lb.setSize(260, 70);
    lb.setInteractive({ useHandCursor: true });
    lb.on('pointerdown', () => {
      sfx.unlock();
      sfx.tap();
      pressPulse(this, lb);
      this.scene.start('Leaderboard', { from: 'Menu' });
    });

    start.on('pointerdown', () => {
      sfx.unlock();
      sfx.fanfare();
      pressPulse(this, start);
      this.time.delayedCall(180, () => {
        this.cameras.main.fadeOut(250, 7, 59, 92);
      });
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('Game');
      });
    });
  }

  private makeToggle(x: number, y: number, label: string, get: () => boolean, set: (v: boolean) => void): void {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, 300, 56, PAL.ocean).setStrokeStyle(5, PAL.ink);
    const txt = this.add
      .text(0, 0, '', { fontFamily: FONT_SANS, fontSize: '20px', fontStyle: 'bold', color: HEX.cream })
      .setOrigin(0.5);
    const refresh = () => {
      txt.setText(`${label}: ${get() ? 'ON' : 'OFF'}`);
      bg.setFillStyle(get() ? PAL.ocean : 0x39424e);
    };
    refresh();
    c.add([bg, txt]);
    c.setSize(300, 56);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerdown', () => {
      sfx.unlock();
      set(!get());
      saveSettings();
      refresh();
      sfx.tap();
      pressPulse(this, c);
    });
  }
}
