import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { loadSettings, settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { pressPulse } from '../core/juice';
import { MEMES, renderMeme } from '../core/memes';
import { getUnlockedTemplates } from '../core/memeUnlocks';
import { broadcastCut, broadcastReveal, createTicker } from '../core/broadcast';
import { fetchLeaderboard } from '../backend/api';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    loadSettings();
    broadcastReveal(this);
    let leaving = false;
    const cx = GAME_W / 2;

    if (hasArt(this, 'map_bg')) {
      const bgImg = this.add.image(cx, GAME_H / 2, 'map_bg').setDisplaySize(GAME_W, GAME_H).setAlpha(0.45);
      // slow aerial-camera drift so the "studio backdrop" never sits still
      if (!settings.reducedMotion) {
        this.tweens.add({
          targets: bgImg,
          scaleX: bgImg.scaleX * 1.06,
          scaleY: bgImg.scaleY * 1.06,
          x: cx - 16,
          duration: 16000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }
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
      .text(0, -24, "HORMUZ HOLD'EM", {
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
    // kicker tab + blinking LIVE dot: the title reads as a news lower-third
    const kick = this.add
      .text(-318, -80, 'LIVE FROM THE STRAIT', {
        fontFamily: FONT_SANS,
        fontSize: '15px',
        fontStyle: 'bold',
        color: HEX.ink
      })
      .setOrigin(0, 0.5);
    const kickBg = this.add
      .rectangle(-346 + (kick.width + 46) / 2, -80, kick.width + 46, 26, PAL.cream)
      .setStrokeStyle(3, PAL.ink);
    const dot = this.add
      .text(-336, -81, '●', { fontFamily: FONT_SANS, fontSize: '14px', color: HEX.red })
      .setOrigin(0, 0.5);
    banner.add([kickBg, dot, kick]);
    if (!settings.reducedMotion) {
      this.tweens.add({ targets: dot, alpha: 0.15, duration: 600, yoyo: true, repeat: -1 });
      // graphics package slide-in from the left
      banner.setAlpha(0);
      banner.x = cx - 360;
      this.tweens.add({ targets: banner, x: cx, alpha: 1, duration: 320, ease: 'Cubic.easeOut' });
    }

    // the situation, in plain english
    const blurb = [
      'Iran is threatening to SHUT THE STRAIT OF HORMUZ —',
      'the narrow sea lane that carries A FIFTH OF THE WORLD’S OIL!',
      'TAP a threat and your gunner shoots it down.',
      'HOLD for a full burst — but DON’T OVERHEAT the gun!',
      'KEEP THE TANKERS SAFE and complete each day’s MISSION for bonus cash.'
    ];
    this.add.rectangle(cx, 319, 900, 200, PAL.ink, 0.75).setStrokeStyle(3, PAL.gold, 0.6);
    // "VIEWER GUIDE" tab on the box's top edge — the blurb as a news card
    const guideTxt = this.add
      .text(cx - 438, 219, 'VIEWER GUIDE', {
        fontFamily: FONT_SANS,
        fontSize: '14px',
        fontStyle: 'bold',
        color: HEX.ink
      })
      .setOrigin(0, 0.5);
    this.add
      .rectangle(cx - 450 + (guideTxt.width + 44) / 2, 219, guideTxt.width + 44, 24, PAL.gold)
      .setStrokeStyle(3, PAL.ink);
    guideTxt.setDepth(1);
    blurb.forEach((line, i) => {
      const t = this.add
        .text(cx, 254 + i * 34, line, {
          fontFamily: FONT_SANS,
          fontSize: '22px',
          fontStyle: 'bold',
          color: HEX.cream,
          stroke: HEX.ink,
          strokeThickness: 3
        })
        .setOrigin(0.5);
      if (!settings.reducedMotion) {
        t.setAlpha(0);
        t.x -= 36;
        this.tweens.add({ targets: t, x: cx, alpha: 1, delay: 160 + i * 80, duration: 260, ease: 'Cubic.easeOut' });
      }
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
      if (leaving) return;
      leaving = true;
      sfx.unlock();
      sfx.tap();
      pressPulse(this, lb);
      broadcastCut(this, () => this.scene.start('Leaderboard', { from: 'Menu' }));
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
      if (leaving) return;
      leaving = true;
      sfx.unlock();
      sfx.tap();
      pressPulse(this, gallery);
      broadcastCut(this, () => this.scene.start('Gallery', { from: 'Menu' }));
    });

    start.on('pointerdown', () => {
      if (leaving) return;
      leaving = true;
      sfx.unlock();
      sfx.fanfare();
      pressPulse(this, start);
      this.time.delayedCall(150, () => broadcastCut(this, () => this.scene.start('Game')));
    });

    // staggered fly-ins: buttons and studio memes enter like graphics packages
    const flyIn = (obj: Phaser.GameObjects.Container, delay: number, fromY = 50): void => {
      if (settings.reducedMotion) return;
      const y = obj.y;
      obj.setAlpha(0);
      obj.y = y + fromY;
      this.tweens.add({ targets: obj, y, alpha: 1, delay, duration: 300, ease: 'Cubic.easeOut' });
    };
    flyIn(start, 320);
    flyIn(lb, 430);
    flyIn(gallery, 500);
    flyIn(memeLeft, 590, 30);
    flyIn(memeRight, 650, 30);

    // bottom ticker crawl — live archive stat woven in ahead of the canned pool
    createTicker(this, 702, [
      `MEME ARCHIVE: ${getUnlockedTemplates().size}/${Object.keys(MEMES.templates).length} COLLECTED`
    ]);
  }

}
