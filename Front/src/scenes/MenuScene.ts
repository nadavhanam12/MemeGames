import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { loadSettings, settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { popIn, pressPulse } from '../core/juice';
import { MEMES, renderMeme } from '../core/memes';
import { fetchLeaderboard } from '../backend/api';

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

    // the situation, in plain english
    const blurb = [
      'Iran is threatening to SHUT THE STRAIT OF HORMUZ —',
      'the narrow sea lane that carries A FIFTH OF THE WORLD’S OIL!',
      'TAP a threat and your gunner shoots it down.',
      'HOLD for a full burst — but DON’T OVERHEAT the gun!',
      'KEEP THE TANKERS SAFE and complete each day’s MISSION for bonus cash.'
    ];
    this.add.rectangle(cx, 319, 900, 200, PAL.ink, 0.75).setStrokeStyle(3, PAL.gold, 0.6);
    blurb.forEach((line, i) => {
      this.add
        .text(cx, 254 + i * 34, line, {
          fontFamily: FONT_SANS,
          fontSize: '22px',
          fontStyle: 'bold',
          color: HEX.cream,
          stroke: HEX.ink,
          strokeThickness: 3
        })
        .setOrigin(0.5);
    });

    // static menu memes, bottom corners (fixed picks — not part of the run's meme log)
    const memeLeft = this.add.container(185, 560).setAngle(-4);
    renderMeme(this, memeLeft, { id: 'rejectApproveKhamenei', tpl: MEMES.templates.rejectApproveKhamenei, captions: [], isNew: false }, 280, 280);
    const memeRight = this.add.container(GAME_W - 185, 560).setAngle(4);
    renderMeme(this, memeRight, { id: 'twoButtons2Trump', tpl: MEMES.templates.twoButtons2Trump, captions: [], isNew: false }, 280, 280);

    // start button
    const start = this.add.container(cx, 485);
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
    // player count (backend-driven; hidden until the fetch succeeds)
    const playersTxt = this.add
      .text(cx, 668, '', {
        fontFamily: FONT_SANS,
        fontSize: '20px',
        fontStyle: 'bold',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 3
      })
      .setOrigin(0.5);
    fetchLeaderboard({ period: 'all', pageSize: 1 })
      .then(res => {
        if (!this.scene.isActive()) return;
        if (res.total > 0) {
          playersTxt.setText(`${res.total.toLocaleString()} ${res.total === 1 ? 'person has' : 'people have'} already played`);
        }
      })
      .catch(() => {
        /* server unreachable — leave the line empty */
      });

    // global leaderboard (backend-driven)
    const lb = this.add.container(cx - 140, 600);
    const lbBg = this.add.rectangle(0, 0, 250, 70, PAL.ocean).setStrokeStyle(6, PAL.ink);
    const lbTxt = this.add
      .text(0, 0, 'LEADERBOARD', { fontFamily: FONT_DISPLAY, fontSize: '20px', color: HEX.cream })
      .setOrigin(0.5);
    lb.add([lbBg, lbTxt]);
    lb.setSize(250, 70);
    lb.setInteractive({ useHandCursor: true });
    lb.on('pointerdown', () => {
      sfx.unlock();
      sfx.tap();
      pressPulse(this, lb);
      this.scene.start('Leaderboard', { from: 'Menu' });
    });

    // meme collection gallery
    const gallery = this.add.container(cx + 140, 600);
    const galleryBg = this.add.rectangle(0, 0, 250, 70, PAL.purple).setStrokeStyle(6, PAL.ink);
    const galleryTxt = this.add
      .text(0, 0, 'MEME GALLERY', { fontFamily: FONT_DISPLAY, fontSize: '20px', color: HEX.cream })
      .setOrigin(0.5);
    gallery.add([galleryBg, galleryTxt]);
    gallery.setSize(250, 70);
    gallery.setInteractive({ useHandCursor: true });
    gallery.on('pointerdown', () => {
      sfx.unlock();
      sfx.tap();
      pressPulse(this, gallery);
      this.scene.start('Gallery', { from: 'Menu' });
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

}
