import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { loadSettings, settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { pressPulse } from '../core/juice';
import { MEMES, renderMeme } from '../core/memes';
import { getUnlockedTemplates } from '../core/memeUnlocks';
import { broadcastCut, broadcastReveal } from '../core/broadcast';
import { createPostHeader } from '../core/feedChrome';
import { fetchLeaderboard } from '../backend/api';

// Hairline divider color shared with feedChrome's card borders.
const DIVIDER = 0x2f3336;

// Hand-picked "best of" rotation for the front-page carousel.
const FEATURED_MEME_IDS = [
  'twoButtons2Trump',
  'templeIran',
  'successTrump',
  'saltTrump',
  'saltKhamenei',
  'rejectApproveTrump',
  'rejectApproveKhamenei',
  'podcastKhamenei'
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

    // profile header — bigger avatar for prominence, still the feed idiom.
    // Scaled up from a narrower w so the right-aligned LIVE badge still lands
    // inside the canvas after the scale multiplies every local offset.
    const BANNER_SCALE = 1.3;
    const BANNER_W = 420;
    const bannerX = cx - (BANNER_W * BANNER_SCALE) / 2;
    const banner = createPostHeader(this, {
      x: bannerX,
      y: 110,
      w: BANNER_W,
      handle: "Hormuz Hold'em",
      subtext: '@hormuz_holdem',
      live: true
    });
    banner.setScale(BANNER_SCALE);
    if (!settings.reducedMotion) {
      // graphics package slide-in from the left
      banner.setAlpha(0);
      const targetX = banner.x;
      banner.x = targetX - 60;
      this.tweens.add({ targets: banner, x: targetX, alpha: 1, duration: 320, ease: 'Cubic.easeOut' });
    }

    // the situation, in plain english
    const blurb = [
      'Iran is threatening to SHUT THE STRAIT OF HORMUZ —',
      'the narrow sea lane that carries A FIFTH OF THE WORLD’S OIL!',
      'TAP a threat and your gunner shoots it down.',
      'HOLD for a full burst — but DON’T OVERHEAT the gun!',
      'KEEP THE TANKERS SAFE and complete each day’s MISSION for bonus cash.'
    ];
    const BLURB_W = 680;
    const BLURB_Y = 330;
    const BLURB_H = 230;
    this.add.rectangle(cx, BLURB_Y, BLURB_W, BLURB_H, PAL.black, 0.85).setStrokeStyle(2, DIVIDER);
    blurb.forEach((line, i) => {
      const t = this.add
        .text(cx, BLURB_Y - 70 + i * 26, line, {
          fontFamily: FONT_SANS,
          fontSize: '15px',
          color: HEX.cream,
          wordWrap: { width: BLURB_W - 40 }
        })
        .setOrigin(0.5);
      if (!settings.reducedMotion) {
        t.setAlpha(0);
        t.x -= 36;
        this.tweens.add({ targets: t, x: cx, alpha: 1, delay: 160 + i * 80, duration: 260, ease: 'Cubic.easeOut' });
      }
    });

    // start button
    const START_Y = 530;
    const start = this.add.container(cx, START_Y);
    const sb = this.add.rectangle(0, 0, 440, 100, PAL.black, 0.9).setStrokeStyle(2, PAL.green);
    const st = this.add
      .text(0, 0, 'DEFEND THE STRAIT', { fontFamily: FONT_DISPLAY, fontSize: '34px', color: HEX.green })
      .setOrigin(0.5);
    start.add([sb, st]);
    start.setSize(440, 100);
    start.setInteractive({ useHandCursor: true });
    if (!settings.reducedMotion) {
      this.tweens.add({ targets: start, scale: 1.04, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // global leaderboard + meme gallery buttons, side by side below the CTA
    const ROW_Y = 650;
    const lb = this.add.container(cx - 140, ROW_Y);
    const lbBg = this.add.rectangle(0, 0, 250, 70, PAL.black, 0.9).setStrokeStyle(2, PAL.ocean);
    const lbTxt = this.add
      .text(0, 0, 'LEADERBOARD', { fontFamily: FONT_DISPLAY, fontSize: '20px', color: HEX.ocean })
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
    const gallery = this.add.container(cx + 140, ROW_Y);
    const galleryBg = this.add.rectangle(0, 0, 250, 70, PAL.black, 0.9).setStrokeStyle(2, PAL.purple);
    const galleryTxt = this.add
      .text(0, 0, 'MEME GALLERY', { fontFamily: FONT_DISPLAY, fontSize: '20px', color: HEX.purple })
      .setOrigin(0.5);
    gallery.add([galleryBg, galleryTxt]);
    gallery.setSize(250, 70);

    // player count (backend-driven; hidden until the fetch succeeds)
    const playersNumTxt = this.add
      .text(cx, 715, '', {
        fontFamily: FONT_SANS,
        fontSize: '34px',
        fontStyle: 'bold',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 4
      })
      .setOrigin(0.5);
    const playersLabelTxt = this.add
      .text(cx, 715, '', {
        fontFamily: FONT_SANS,
        fontSize: '24px',
        fontStyle: 'bold',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 3
      })
      .setOrigin(0, 0.5);
    fetchLeaderboard({ period: 'all', pageSize: 1 })
      .then(res => {
        if (!this.scene.isActive()) return;
        if (res.total > 0) {
          const numStr = res.total.toLocaleString();
          const labelStr = ` ${res.total === 1 ? 'person has' : 'people have'} already played`;
          playersNumTxt.setText(numStr).setOrigin(0.5);
          playersLabelTxt.setText(labelStr);
          const totalWidth = playersNumTxt.width + playersLabelTxt.width;
          playersNumTxt.setX(cx - totalWidth / 2 + playersNumTxt.width / 2);
          playersLabelTxt.setX(playersNumTxt.x + playersNumTxt.width / 2);
        }
      })
      .catch(() => {
        /* server unreachable — leave the line empty */
      });

    // front-page meme carousel — rotates through the featured picks above
    // (not part of the run's meme log; purely a "best of" showcase).
    const MEME_Y = 900;
    const memeCarousel = this.add.container(cx, MEME_Y).setAngle(-3);
    let carouselIndex = 0;
    const drawCarouselMeme = (): void => {
      memeCarousel.removeAll(true);
      const id = FEATURED_MEME_IDS[carouselIndex];
      renderMeme(this, memeCarousel, { id, tpl: MEMES.templates[id], captions: [], isNew: false }, 320, 320);
    };
    drawCarouselMeme();
    const advanceCarousel = (): void => {
      carouselIndex = (carouselIndex + 1) % FEATURED_MEME_IDS.length;
      if (settings.reducedMotion) {
        drawCarouselMeme();
        return;
      }
      this.tweens.add({
        targets: memeCarousel,
        alpha: 0,
        duration: 220,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          drawCarouselMeme();
          memeCarousel.setAlpha(0);
          this.tweens.add({ targets: memeCarousel, alpha: 1, duration: 220, ease: 'Cubic.easeOut' });
        }
      });
    };
    const carouselTimer = this.time.addEvent({ delay: 3200, loop: true, callback: advanceCarousel });
    this.events.once('shutdown', () => carouselTimer.remove());
    // Meme art loads in the background after Boot hands off to Menu (see
    // BootScene/loadMemeArt) — refresh from placeholder to real art once it lands.
    const onMemeArtLoaded = (): void => drawCarouselMeme();
    this.game.events.on('meme-art-loaded', onMemeArtLoaded);
    this.events.once('shutdown', () => this.game.events.off('meme-art-loaded', onMemeArtLoaded));
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
      this.time.delayedCall(150, () => broadcastCut(this, () => this.scene.start('Intro')));
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
    flyIn(memeCarousel, 590, 30);

    // static muted stat line replacing the old scrolling ticker crawl
    this.add
      .text(cx, 1256, `🔓 ${getUnlockedTemplates().size}/${Object.keys(MEMES.templates).length} memes collected`, {
        fontFamily: FONT_SANS,
        fontSize: '16px',
        color: HEX.muted
      })
      .setOrigin(0.5);
  }

}
