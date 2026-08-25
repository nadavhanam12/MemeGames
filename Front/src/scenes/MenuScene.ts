import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { loadSettings, settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { pressPulse } from '../core/juice';
import { MEMES, renderMeme } from '../core/memes';
import { getUnlockedTemplates } from '../core/memeUnlocks';
import { broadcastCut, broadcastReveal } from '../core/broadcast';
import { fetchLeaderboard } from '../backend/api';

const PANEL = 0x101820;
const PANEL_HOVER = 0x15212b;
const BORDER = 0x26323d;
const FEATURED_MEME_IDS = [
  'twoButtons2Trump', 'templeIran', 'successTrump', 'saltTrump',
  'saltKhamenei', 'rejectApproveTrump', 'rejectApproveKhamenei', 'podcastKhamenei'
];

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    loadSettings();
    broadcastReveal(this);
    let leaving = false;
    const cx = GAME_W / 2;
    const contentW = GAME_W - 64;

    this.drawBackdrop();

    const header = this.add.container(0, 0);
    const mark = this.add.circle(52, 50, 22, PANEL, 1).setStrokeStyle(2, PAL.gold, 0.85);
    const reticle = this.add.graphics().lineStyle(2, PAL.gold, 0.8);
    reticle.strokeCircle(52, 50, 10).lineBetween(34, 50, 43, 50).lineBetween(61, 50, 70, 50)
      .lineBetween(52, 32, 52, 41).lineBetween(52, 59, 52, 68);
    const brand = this.add.text(88, 37, "HOLD'EM HORMUZ", {
      fontFamily: FONT_SANS, fontSize: '20px', fontStyle: 'bold', color: HEX.cream, letterSpacing: 2
    });
    const brandSub = this.add.text(88, 62, 'STRATEGIC INTEL DASHBOARD', {
      fontFamily: FONT_SANS, fontSize: '10px', color: HEX.muted, letterSpacing: 1
    });
    const liveDot = this.add.circle(628, 43, 5, PAL.green);
    const live = this.add.text(642, 34, 'LIVE', {
      fontFamily: FONT_SANS, fontSize: '12px', fontStyle: 'bold', color: HEX.green
    });
    const status = this.add.text(670, 60, 'STRAIT ONLINE', {
      fontFamily: FONT_SANS, fontSize: '10px', color: HEX.muted
    }).setOrigin(1, 0);
    header.add([mark, reticle, brand, brandSub, liveDot, live, status]);
    if (!settings.reducedMotion) this.tweens.add({ targets: liveDot, alpha: 0.25, duration: 780, yoyo: true, repeat: -1 });

    this.add.rectangle(cx, 94, contentW, 1, BORDER, 1);
    const eyebrow = this.add.text(32, 126, 'OPERATIONAL BRIEF  /  DAY 01', {
      fontFamily: FONT_SANS, fontSize: '12px', fontStyle: 'bold', color: HEX.gold, letterSpacing: 1
    });
    const title = this.add.text(32, 154, 'THE STRAIT IS OPEN.\nKEEP IT THAT WAY.', {
      fontFamily: FONT_DISPLAY, fontSize: '48px', color: HEX.cream, lineSpacing: -5
    });
    const deck = this.add.text(34, 262, 'Global oil is moving through a live fire zone.\nProtect tankers, control the market, unlock the feed.', {
      fontFamily: FONT_SANS, fontSize: '16px', color: '#B7C0C8', lineSpacing: 5
    });

    const brief = this.add.container(cx, 380);
    const briefBg = this.add.rectangle(0, 0, contentW, 124, PANEL, 0.96).setStrokeStyle(1, BORDER);
    const briefIcon = this.add.circle(-278, 0, 28, 0x11281f, 1).setStrokeStyle(1, PAL.green, 0.7);
    const briefTarget = this.add.graphics().lineStyle(2, PAL.green, 1);
    briefTarget.strokeCircle(-278, 0, 10).lineBetween(-294, 0, -286, 0).lineBetween(-270, 0, -262, 0);
    const briefLabel = this.add.text(-234, -36, 'MISSION CONTROL', {
      fontFamily: FONT_SANS, fontSize: '11px', color: HEX.green, letterSpacing: 1
    });
    const briefText = this.add.text(-234, -10, 'SHOOT DOWN THREATS', {
      fontFamily: FONT_SANS, fontSize: '20px', fontStyle: 'bold', color: HEX.cream
    });
    const briefSub = this.add.text(-234, 24, 'Tap to fire  ·  hold for a burst  ·  watch the heat', {
      fontFamily: FONT_SANS, fontSize: '12px', color: HEX.muted
    });
    brief.add([briefBg, briefIcon, briefTarget, briefLabel, briefText, briefSub]);

    const start = this.makeButton(cx, 482, contentW, 72, 'BEGIN OPERATION  ▶', PAL.gold, true, () => {
      if (leaving) return;
      leaving = true;
      sfx.unlock(); sfx.fanfare();
      // intro map-zoom cinematic disabled for now — jump straight into the game
      this.time.delayedCall(140, () => broadcastCut(this, () => this.scene.start('Game')));
    });
    const leaderboard = this.makeButton(194, 578, 304, 64, 'RANKINGS', PAL.ocean, false, () => {
      if (leaving) return;
      leaving = true;
      sfx.unlock(); sfx.tap();
      broadcastCut(this, () => this.scene.start('Leaderboard', { from: 'Menu' }));
    });
    const gallery = this.makeButton(526, 578, 304, 64, 'MEME COLLECTION', PAL.purple, false, () => {
      if (leaving) return;
      leaving = true;
      sfx.unlock(); sfx.tap();
      broadcastCut(this, () => this.scene.start('Gallery', { from: 'Menu' }));
    });

    const stats = this.add.container(cx, 654);
    stats.add(this.add.rectangle(0, 0, contentW, 60, 0x0c131a, 0.96).setStrokeStyle(1, BORDER));
    const unlocked = getUnlockedTemplates().size;
    const total = Object.keys(MEMES.templates).length;
    stats.add(this.add.text(-292, -14, 'COLLECTION', {
      fontFamily: FONT_SANS, fontSize: '10px', color: HEX.muted, letterSpacing: 1
    }));
    stats.add(this.add.text(-292, 7, `${unlocked}/${total} UNLOCKED`, {
      fontFamily: FONT_SANS, fontSize: '14px', color: HEX.gold
    }));
    stats.add(this.add.rectangle(0, 0, 1, 34, BORDER));
    const playerCount = this.add.text(292, -3, 'SECURE UPLINK', {
      fontFamily: FONT_SANS, fontSize: '13px', color: HEX.green
    }).setOrigin(1, 0.5);
    stats.add(playerCount);
    fetchLeaderboard({ period: 'all', pageSize: 1 })
      .then(res => {
        if (this.scene.isActive() && res.total > 0) playerCount.setText(`${res.total.toLocaleString()} OPERATORS`);
      })
      .catch(() => undefined);

    const featured = this.add.container(cx, 951);
    featured.add(this.add.rectangle(0, 0, contentW, 516, PANEL, 0.96).setStrokeStyle(1, BORDER));
    featured.add(this.add.text(-292, -232, 'FEATURED INTEL', {
      fontFamily: FONT_SANS, fontSize: '11px', color: HEX.gold, letterSpacing: 1
    }));
    featured.add(this.add.text(-292, -204, 'MEME OF THE MOMENT', {
      fontFamily: FONT_SANS, fontSize: '18px', fontStyle: 'bold', color: HEX.cream
    }));
    featured.add(this.add.text(292, -225, 'AUTO ROTATION', {
      fontFamily: FONT_SANS, fontSize: '10px', color: HEX.muted
    }).setOrigin(1, 0));
    featured.add(this.add.rectangle(0, -180, contentW - 48, 1, BORDER));
    const memeHost = this.add.container(0, 28).setAngle(-1);
    featured.add(memeHost);
    let carouselIndex = 0;
    const drawMeme = (): void => {
      memeHost.removeAll(true);
      const id = FEATURED_MEME_IDS[carouselIndex];
      renderMeme(this, memeHost, { id, tpl: MEMES.templates[id], captions: [], isNew: false }, 340, 340);
    };
    drawMeme();
    const timer = this.time.addEvent({
      delay: 3400, loop: true,
      callback: () => {
        carouselIndex = (carouselIndex + 1) % FEATURED_MEME_IDS.length;
        if (settings.reducedMotion) return drawMeme();
        this.tweens.add({
          targets: memeHost, alpha: 0, y: 38, duration: 180, ease: 'Cubic.easeIn',
          onComplete: () => {
            drawMeme();
            memeHost.setAlpha(0).setY(18);
            this.tweens.add({ targets: memeHost, alpha: 1, y: 28, duration: 260, ease: 'Cubic.easeOut' });
          }
        });
      }
    });
    const onMemeArtLoaded = (): void => drawMeme();
    this.game.events.on('meme-art-loaded', onMemeArtLoaded);
    this.events.once('shutdown', () => {
      timer.remove();
      this.game.events.off('meme-art-loaded', onMemeArtLoaded);
    });

    const enter = (
      obj: Phaser.GameObjects.GameObject & {
        x: number;
        y: number;
        setAlpha(value: number): unknown;
        setPosition(x: number, y: number): unknown;
      },
      delay: number, dx = 0, dy = 18
    ): void => {
      if (settings.reducedMotion) return;
      const x = obj.x; const y = obj.y;
      obj.setAlpha(0);
      obj.setPosition(x + dx, y + dy);
      this.tweens.add({ targets: obj, x, y, alpha: 1, delay, duration: 360, ease: 'Cubic.easeOut' });
    };
    enter(header, 20, -20, 0); enter(eyebrow, 70, -16, 0); enter(title, 110, -20, 0);
    enter(deck, 160, -20, 0); enter(brief, 220); enter(start, 280);
    enter(leaderboard, 340, -12, 0); enter(gallery, 370, 12, 0); enter(stats, 420); enter(featured, 480, 0, 24);
  }

  private drawBackdrop(): void {
    const cx = GAME_W / 2;
    if (hasArt(this, 'map_bg')) {
      const bg = this.add.image(cx, GAME_H / 2, 'map_bg').setDisplaySize(GAME_W, GAME_H).setAlpha(0.17);
      if (!settings.reducedMotion) this.tweens.add({
        targets: bg, scale: 1.035, x: cx - 8, duration: 18000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
    }
    this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, PAL.navy, 0.9);
    const grid = this.add.graphics().lineStyle(1, 0x34505f, 0.12);
    for (let x = 0; x <= GAME_W; x += 48) grid.lineBetween(x, 0, x, GAME_H);
    for (let y = 0; y <= GAME_H; y += 48) grid.lineBetween(0, y, GAME_W, y);
    const glow = this.add.circle(610, 240, 250, PAL.gold, 0.035);
    if (!settings.reducedMotion) this.tweens.add({
      targets: glow, alpha: 0.07, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
  }

  private makeButton(
    x: number, y: number, w: number, h: number, label: string, accent: number, primary: boolean, onClick: () => void
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, primary ? 0x171810 : PANEL, 0.98)
      .setStrokeStyle(primary ? 2 : 1, accent, primary ? 0.9 : 0.55);
    const text = this.add.text(0, 0, label, {
      fontFamily: FONT_SANS, fontSize: primary ? '20px' : '15px', fontStyle: 'bold',
      color: primary ? HEX.gold : HEX.cream, letterSpacing: 1
    }).setOrigin(0.5);
    c.add([bg, text]);
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerover', () => {
      bg.setFillStyle(primary ? 0x231f12 : PANEL_HOVER, 1).setStrokeStyle(2, accent, 1);
      this.tweens.add({ targets: c, scale: 1.015, duration: 100 });
    });
    c.on('pointerout', () => {
      bg.setFillStyle(primary ? 0x171810 : PANEL, 0.98).setStrokeStyle(primary ? 2 : 1, accent, primary ? 0.9 : 0.55);
      this.tweens.add({ targets: c, scale: 1, duration: 100 });
    });
    c.on('pointerdown', () => { pressPulse(this, c); onClick(); });
    return c;
  }
}
