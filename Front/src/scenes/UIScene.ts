import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL, VIEW } from '../core/palette';
import { settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { MEMES, pickMeme, renderMeme } from '../core/memes';
import { EASE, countTo, floatText, popIn, pressPulse } from '../core/juice';
import { EV, SessionStats, bus } from '../core/state';
import { TUNING } from '../config/tuning';
import { registerLayout } from '../dev/layout';

interface UpgradeDef {
  key: 'jammer' | 'ciws' | 'escort';
  name: string;
  desc: string;
}

const UPGRADES: UpgradeDef[] = [
  { key: 'jammer', name: 'DRONE JAMMER', desc: 'Threats move slower' },
  { key: 'ciws', name: 'AUTO-CIWS', desc: 'Auto-intercepts periodically' },
  { key: 'escort', name: 'ROUTE ESCORT', desc: 'Faster ships, +1 credit/hit' }
];

function costsOf(key: UpgradeDef['key']): number[] {
  return TUNING.upgrades[`${key}Costs`];
}

const TICKER_ITEMS = [
  'OIL FUTURES JITTERY',
  'ANALYSTS DIVIDED, LOUDLY',
  'SHIPPING INSURERS SWEATING',
  'GROUP CHAT MONITORING SITUATION',
  'CAMELS UNAVAILABLE FOR COMMENT',
  'PREDICTION MARKETS BUZZING'
];

// Meme reactions (templates + captions) live in src/config/memes.json,
// picked/rendered by src/core/memes.ts.

// Broadcast-studio frame geometry (CNBC-style reference): blue outer border,
// left info box (price graph / meme cutaway), game box right (VIEW), red
// breaking-news band, bottom control strip.
const M = 28; // outer frame margin
const GAP = 14; // gap between the two boxes
const LEFT_BOX = { x: M, y: VIEW.y, w: VIEW.x - GAP - M, h: VIEW.h } as const;
const BAND = { x: M, y: VIEW.y + VIEW.h + 7, w: GAME_W - 2 * M, h: 56 } as const;
const STRIP = { x: M, y: VIEW.y + VIEW.h + 70, w: GAME_W - 2 * M, h: 110 } as const;
const FRAME_BLUE = 0x1c2c8a;
const STRIP_BLUE = 0x18246b;
const BAND_RED = 0xb01e2e;
const BAND_RED_DARK = 0x8f1620;

// Polymarket-style card, in the bottom strip right of the game logo
const PRED_X = 250;
const PRED_Y = 584;
const PRED_W = 205;
const PRED_H = 106;

export class UIScene extends Phaser.Scene {
  private priceText!: Phaser.GameObjects.Text;
  private priceArrow!: Phaser.GameObjects.Text;
  private priceBox!: Phaser.GameObjects.Rectangle;
  private displayedPrice = 112;
  private graph!: Phaser.GameObjects.Graphics;
  private graphTip!: Phaser.GameObjects.Text;
  private history: number[] = [112];
  private graphFlash = 0;
  private elapsedSec = 0;
  private dayLabels: Phaser.GameObjects.Text[] = [];
  private yAxisLabels: Phaser.GameObjects.Text[] = [];

  private creditsText!: Phaser.GameObjects.Text;
  private displayedCredits = 30;
  private comboText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private headlineText!: Phaser.GameObjects.Text;
  private tickerText!: Phaser.GameObjects.Text;
  private predShown = 0;
  private predTargetProb = 0;
  private predActive = false;
  private predChance!: Phaser.GameObjects.Text;
  private predYesText!: Phaser.GameObjects.Text;
  private predNoText!: Phaser.GameObjects.Text;
  private predCardGfx!: Phaser.GameObjects.Graphics;
  private dangerBanner?: Phaser.GameObjects.Container;
  private dangerText!: Phaser.GameObjects.Text;
  private streakBadge!: Phaser.GameObjects.Container;
  private streakText!: Phaser.GameObjects.Text;
  private predLabel!: Phaser.GameObjects.Text;
  private upgradeLevels: Record<string, number> = { jammer: 0, ciws: 0, escort: 0 };
  private upgradeButtons: Record<string, Phaser.GameObjects.Container> = {};
  private upgradePanel!: Phaser.GameObjects.Container;
  private upgradeToggleBg!: Phaser.GameObjects.Rectangle;
  private panelOpen = false;
  private memePopup?: Phaser.GameObjects.Container;
  private memeGen = 0;
  private lastMemeAt = -Infinity;
  private heartbeat = 0;

  constructor() {
    super('UI');
  }

  create(): void {
    this.displayedPrice = 112;
    this.displayedCredits = 30;
    this.history = [112];
    this.upgradeLevels = { jammer: 0, ciws: 0, escort: 0 };
    this.panelOpen = false;
    this.lastMemeAt = -Infinity;
    this.registry.set('ui-modal', false);

    this.buildStudioFrame();
    this.buildLeftBox();
    this.buildStrip();
    this.buildPredictionPanel();
    this.buildNewsBand();
    this.buildCombo();
    this.buildUpgradePanel();

    bus.on(EV.PRICE, this.onPrice, this);
    bus.on(EV.CREDITS, this.onCredits, this);
    bus.on(EV.COMBO, this.onCombo, this);
    bus.on(EV.HEADLINE, this.onHeadline, this);
    bus.on(EV.THRESHOLD, this.onThreshold, this);
    bus.on(EV.EVENT_PROB, this.onEventProb, this);
    bus.on(EV.EVENT_CARD, this.onEventCard, this);
    bus.on(EV.TIMER, this.onTimer, this);
    bus.on(EV.DANGER, this.onDanger, this);
    bus.on(EV.UPGRADE_DEMO, this.onUpgradeBought, this);
    bus.on('tanker-safe', this.onTankerSafe, this);
    bus.on('meme-moment', this.showMemeReaction, this);

    this.events.on('shutdown', () => {
      bus.off(EV.PRICE, this.onPrice, this);
      bus.off(EV.CREDITS, this.onCredits, this);
      bus.off(EV.COMBO, this.onCombo, this);
      bus.off(EV.HEADLINE, this.onHeadline, this);
      bus.off(EV.THRESHOLD, this.onThreshold, this);
      bus.off(EV.EVENT_PROB, this.onEventProb, this);
      bus.off(EV.EVENT_CARD, this.onEventCard, this);
      bus.off(EV.TIMER, this.onTimer, this);
      bus.off(EV.DANGER, this.onDanger, this);
      bus.off(EV.UPGRADE_DEMO, this.onUpgradeBought, this);
      bus.off('tanker-safe', this.onTankerSafe, this);
      bus.off('meme-moment', this.showMemeReaction, this);
    });
  }

  // ---------------------------------------------------------------- layout
  /** Blue studio frame: two boxes on top, red news band, bottom control strip. */
  private buildStudioFrame(): void {
    const g = this.add.graphics().setDepth(990);
    // blue border around and between the boxes
    g.fillStyle(FRAME_BLUE, 1);
    g.fillRect(0, 0, GAME_W, VIEW.y); // top edge
    g.fillRect(0, VIEW.y, M, GAME_H - VIEW.y); // left edge
    g.fillRect(GAME_W - M, VIEW.y, M, GAME_H - VIEW.y); // right edge
    g.fillRect(VIEW.x - GAP, VIEW.y, GAP, VIEW.h); // gap between boxes
    g.fillRect(M, VIEW.y + VIEW.h, GAME_W - 2 * M, GAME_H - VIEW.y - VIEW.h); // below boxes
    // left info box backing
    g.fillStyle(PAL.ink, 1);
    g.fillRect(LEFT_BOX.x, LEFT_BOX.y, LEFT_BOX.w, LEFT_BOX.h);
    // red breaking-news band
    g.fillStyle(BAND_RED, 1);
    g.fillRect(BAND.x, BAND.y, BAND.w, BAND.h);
    // bottom control strip
    g.fillStyle(STRIP_BLUE, 1);
    g.fillRect(STRIP.x, STRIP.y, STRIP.w, STRIP.h);
    // thin light borders around the two boxes, like studio monitors
    g.lineStyle(3, 0xdde6f0, 0.85);
    g.strokeRect(LEFT_BOX.x, LEFT_BOX.y, LEFT_BOX.w, LEFT_BOX.h);
    g.strokeRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    // LIVE badge on the game window's top-right corner
    this.add.circle(VIEW.x + VIEW.w - 62, VIEW.y + 18, 6, PAL.red).setDepth(991);
    this.add
      .text(VIEW.x + VIEW.w - 50, VIEW.y + 18, 'LIVE', {
        fontFamily: FONT_SANS,
        fontSize: '15px',
        fontStyle: 'bold',
        color: HEX.cream
      })
      .setOrigin(0, 0.5)
      .setDepth(991);
  }

  /** Left box: oil price + full-height graph (meme cutaway covers it on events). */
  private buildLeftBox(): void {
    const cx = LEFT_BOX.x + LEFT_BOX.w / 2;
    const group = this.add.container(0, 0).setDepth(1000);
    const oilLabel = this.add.text(LEFT_BOX.x + 20, LEFT_BOX.y + 16, 'OIL — LIVE MARKET', {
      fontFamily: FONT_SANS,
      fontSize: '16px',
      fontStyle: 'bold',
      color: HEX.gold
    });
    this.priceBox = this.add.rectangle(cx - 10, 92, 200, 56, 0x22303e).setStrokeStyle(3, PAL.gold);
    this.priceText = this.add
      .text(cx - 10, 92, '$112.00', { fontFamily: FONT_DISPLAY, fontSize: '34px', color: HEX.cream })
      .setOrigin(0.5);
    this.priceArrow = this.add
      .text(cx + 112, 92, '▼', { fontFamily: FONT_SANS, fontSize: '30px', color: HEX.green })
      .setOrigin(0.5)
      .setAlpha(0);
    this.graph = this.add.graphics();
    this.graphTip = this.add
      .text(0, 0, '', {
        fontFamily: FONT_SANS,
        fontSize: '13px',
        fontStyle: 'bold',
        color: HEX.green,
        backgroundColor: '#101a24',
        padding: { x: 5, y: 2 }
      })
      .setOrigin(0, 0.5)
      .setAlpha(0);
    // axis label pools, positioned each frame by drawGraph()
    this.yAxisLabels = [0, 1, 2].map(() =>
      this.add
        .text(0, 0, '', { fontFamily: FONT_SANS, fontSize: '11px', fontStyle: 'bold', color: '#8FA6BC' })
        .setOrigin(0, 0.5)
        .setAlpha(0)
    );
    this.dayLabels = [0, 1, 2, 3].map(() =>
      this.add
        .text(0, 0, '', { fontFamily: FONT_SANS, fontSize: '11px', fontStyle: 'bold', color: HEX.gold })
        .setOrigin(0.5, 1)
        .setAlpha(0)
    );
    group.add([oilLabel, this.priceBox, this.priceText, this.priceArrow, this.graph, this.graphTip]);
    group.add(this.yAxisLabels);
    group.add(this.dayLabels);
    registerLayout(this, 'hud-price', group, { x: LEFT_BOX.x, y: LEFT_BOX.y, w: LEFT_BOX.w, h: LEFT_BOX.h });
  }

  /** Bottom strip: game logo · prediction card · timer+streak · UPGRADES button. */
  private buildStrip(): void {
    const cy = STRIP.y + STRIP.h / 2;
    // game name chip, like the network logo in the corner
    const logo = this.add.container(134, cy).setDepth(1000);
    const chip = this.add.rectangle(0, 0, 180, 70, 0xf4f6f8).setStrokeStyle(3, 0xdde6f0);
    const logoText = this.add
      .text(0, 0, 'MeMeGames', { fontFamily: FONT_DISPLAY, fontSize: '26px', color: '#18246B' })
      .setOrigin(0.5);
    logo.add([chip, logoText]);

    // timer + safe streak
    this.timerText = this.add
      .text(640, cy - 14, '0:00', {
        fontFamily: FONT_DISPLAY,
        fontSize: '40px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setDepth(1000);
    this.streakBadge = this.add.container(640, cy + 28).setDepth(1000);
    const sb = this.add.rectangle(0, 0, 104, 26, PAL.green).setStrokeStyle(3, PAL.ink);
    this.streakText = this.add
      .text(0, 0, 'SAFE ×0', { fontFamily: FONT_SANS, fontSize: '15px', fontStyle: 'bold', color: HEX.ink })
      .setOrigin(0.5);
    this.streakBadge.add([sb, this.streakText]);

    // UPGRADES button — opens the upgrades panel; shows credits
    const btn = this.add.container(1130, cy).setDepth(1001);
    this.upgradeToggleBg = this.add.rectangle(0, 0, 220, 74, 0x22303e, 1).setStrokeStyle(4, PAL.gold, 0.9);
    const btnTitle = this.add
      .text(0, -14, 'UPGRADES ▴', { fontFamily: FONT_SANS, fontSize: '20px', fontStyle: 'bold', color: HEX.cream })
      .setOrigin(0.5);
    this.creditsText = this.add
      .text(0, 16, 'DC 30', { fontFamily: FONT_SANS, fontSize: '18px', fontStyle: 'bold', color: HEX.gold })
      .setOrigin(0.5);
    btn.add([this.upgradeToggleBg, btnTitle, this.creditsText]);
    btn.setSize(220, 74);
    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => this.tweens.add({ targets: btn, scale: 1.05, duration: 100 }));
    btn.on('pointerout', () => this.tweens.add({ targets: btn, scale: 1, duration: 100 }));
    btn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      pressPulse(this, btn);
      sfx.tap();
      this.toggleUpgradePanel(!this.panelOpen);
    });
  }

  // Polymarket-style binary market card, left side above the news chyron.
  private buildPredictionPanel(): void {
    const X = PRED_X;
    const Y = PRED_Y;
    const W = PRED_W;
    const H = PRED_H;
    const group = this.add.container(0, 0).setDepth(1000);

    this.predCardGfx = this.add.graphics();
    group.add(this.predCardGfx);
    this.drawPredCard(false);

    // small circular market icon (anchor glyph on navy)
    const icon = this.add.graphics();
    icon.fillStyle(0x2c3f54, 1);
    icon.fillCircle(X + 18, Y + 20, 10);
    group.add(icon);
    const iconGlyph = this.add
      .text(X + 18, Y + 20, '⚓', { fontFamily: FONT_SANS, fontSize: '11px', color: '#8FA6BC' })
      .setOrigin(0.5);
    group.add(iconGlyph);

    const question = this.add.text(X + 33, Y + 8, 'Will the US keep the\nStrait of Hormuz open?', {
      fontFamily: FONT_SANS,
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      lineSpacing: 2
    });
    group.add(question);

    // big "% chance" figure, right-aligned like the real card
    this.predChance = this.add
      .text(X + W - 10, Y + 18, '96%', { fontFamily: FONT_SANS, fontSize: '20px', fontStyle: 'bold', color: '#27AE60' })
      .setOrigin(1, 0.5);
    group.add(this.predChance);
    const chanceLabel = this.add
      .text(X + W - 10, Y + 34, 'chance', { fontFamily: FONT_SANS, fontSize: '10px', color: '#858D92' })
      .setOrigin(1, 0.5);
    group.add(chanceLabel);

    // Buy Yes / Buy No buttons
    const btnY = Y + 50;
    const btnW = (W - 36) / 2;
    const btns = this.add.graphics();
    btns.fillStyle(0x1f3b2f, 1);
    btns.fillRoundedRect(X + 12, btnY, btnW, 30, 6);
    btns.fillStyle(0x3b2426, 1);
    btns.fillRoundedRect(X + 24 + btnW, btnY, btnW, 30, 6);
    group.add(btns);
    this.predYesText = this.add
      .text(X + 12 + btnW / 2, btnY + 15, 'Buy Yes 96¢', {
        fontFamily: FONT_SANS,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#27AE60'
      })
      .setOrigin(0.5);
    this.predNoText = this.add
      .text(X + 24 + btnW * 1.5, btnY + 15, 'Buy No 4¢', {
        fontFamily: FONT_SANS,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#EB5757'
      })
      .setOrigin(0.5);
    group.add([this.predYesText, this.predNoText]);

    // footer: volume gag / live event label
    this.predLabel = this.add.text(X + 12, Y + H - 18, '$4.2m Vol.  ·  Hormuz Markets', {
      fontFamily: FONT_SANS,
      fontSize: '10px',
      color: '#858D92'
    });
    group.add(this.predLabel);

    registerLayout(this, 'hud-prediction', group, { x: X, y: Y, w: W, h: H });
  }

  private drawPredCard(hot: boolean): void {
    const X = PRED_X,
      Y = PRED_Y,
      W = PRED_W,
      H = PRED_H;
    const g = this.predCardGfx;
    g.clear();
    g.fillStyle(0x1d2b39, 0.97);
    g.fillRoundedRect(X, Y, W, H, 12);
    g.lineStyle(2, hot ? 0xeb5757 : 0x344452, 1);
    g.strokeRoundedRect(X, Y, W, H, 12);
  }

  /** Red BREAKING NEWS band between the boxes and the bottom strip:
   *  darker label block left, scrolling ticker (hidden while a headline shows). */
  private buildNewsBand(): void {
    const cy = BAND.y + BAND.h / 2;
    // scrolling ticker, clipped to the band right of the label block
    this.tickerText = this.add
      .text(GAME_W - M, cy, TICKER_ITEMS.join('   •   '), {
        fontFamily: FONT_SANS,
        fontSize: '16px',
        fontStyle: 'bold',
        color: HEX.cream
      })
      .setOrigin(0, 0.5)
      .setDepth(1000);
    const maskShape = this.make.graphics({ x: 0, y: 0 }, false);
    maskShape.fillRect(BAND.x + 195, BAND.y, BAND.w - 195, BAND.h);
    this.tickerText.setMask(maskShape.createGeometryMask());
    this.tweens.add({
      targets: this.tickerText,
      x: -this.tickerText.width,
      duration: settings.reducedMotion ? 60000 : 30000,
      repeat: -1
    });

    // darker label block on top of the ticker's path
    const label = this.add.graphics().setDepth(1002);
    label.fillStyle(BAND_RED_DARK, 1);
    label.fillRect(BAND.x, BAND.y, 190, BAND.h);
    this.add
      .text(BAND.x + 95, cy, 'BREAKING\nNEWS', {
        fontFamily: FONT_SANS,
        fontSize: '18px',
        fontStyle: 'bold',
        color: HEX.cream,
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(1003);

    this.headlineText = this.add
      .text(BAND.x + 210, cy, '', { fontFamily: FONT_DISPLAY, fontSize: '24px', color: HEX.cream })
      .setOrigin(0, 0.5)
      .setAlpha(0)
      .setDepth(1001);
  }

  private buildCombo(): void {
    const group = this.add.container(0, 0).setDepth(1001);
    this.comboText = this.add
      .text(860, 50, '', {
        fontFamily: FONT_DISPLAY,
        fontSize: '30px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 6
      })
      .setOrigin(0.5);
    group.add(this.comboText);
    registerLayout(this, 'hud-combo', group, { x: 710, y: 28, w: 300, h: 44 });
  }

  /** Modal upgrades panel over the game window, opened by the strip button. */
  private buildUpgradePanel(): void {
    const panel = this.add.container(VIEW.x + VIEW.w / 2, VIEW.y + VIEW.h / 2).setDepth(1800).setVisible(false);
    this.upgradePanel = panel;
    // dim blocker: closes the panel on outside tap, swallows the click
    const blocker = this.add.rectangle(
      GAME_W / 2 - (VIEW.x + VIEW.w / 2),
      GAME_H / 2 - (VIEW.y + VIEW.h / 2),
      GAME_W,
      GAME_H,
      0x000000,
      0.45
    );
    blocker.setInteractive();
    blocker.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.toggleUpgradePanel(false);
    });
    const bg = this.add.rectangle(0, 0, 700, 200, PAL.ink, 0.97).setStrokeStyle(4, PAL.gold, 0.9);
    const title = this.add
      .text(0, -74, 'UPGRADES', { fontFamily: FONT_DISPLAY, fontSize: '24px', color: HEX.cream })
      .setOrigin(0.5);
    const close = this.add
      .text(324, -74, '✕', { fontFamily: FONT_SANS, fontSize: '24px', fontStyle: 'bold', color: HEX.cream })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    close.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.toggleUpgradePanel(false);
    });
    panel.add([blocker, bg, title, close]);

    UPGRADES.forEach((u, i) => {
      const x = (i - 1) * 224;
      const y = 18;
      const c = this.add.container(x, y);
      panel.add(c);
      const bg = this.add.rectangle(0, 0, 205, 96, 0x22303e, 0.95).setStrokeStyle(4, PAL.gold, 0.9);
      const name = this.add
        .text(0, -34, u.name, { fontFamily: FONT_SANS, fontSize: '15px', fontStyle: 'bold', color: HEX.cream })
        .setOrigin(0.5);
      const desc = this.add
        .text(0, -13, u.desc, {
          fontFamily: FONT_SANS,
          fontSize: '12px',
          color: '#AAB4BD',
          align: 'center',
          wordWrap: { width: 190 }
        })
        .setOrigin(0.5);
      const cost = this.add
        .text(-42, 22, `DC ${costsOf(u.key)[0]}`, { fontFamily: FONT_DISPLAY, fontSize: '19px', color: HEX.gold })
        .setOrigin(0.5);
      const pips = this.add
        .text(54, 22, '○○○', { fontFamily: FONT_SANS, fontSize: '15px', color: HEX.green })
        .setOrigin(0.5);
      c.add([bg, name, desc, cost, pips]);
      c.setSize(205, 96);
      c.setInteractive({ useHandCursor: true });
      c.setData({ bg, cost, pips, def: u, baseScale: 1 });
      c.on('pointerover', () => this.tweens.add({ targets: c, scale: 1.05, duration: 100 }));
      c.on('pointerout', () => this.tweens.add({ targets: c, scale: 1, duration: 100 }));
      c.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        pressPulse(this, c);
        const costs = costsOf(u.key);
        const lvl = this.upgradeLevels[u.key];
        if (lvl >= costs.length) return;
        const price = costs[lvl];
        if (this.displayedCredits < price) {
          this.tweens.add({ targets: c, x: x - 6, duration: 40, yoyo: true, repeat: 2 });
          sfx.tap();
          return;
        }
        bus.emit('buy-upgrade', u.key, price);
      });
      this.upgradeButtons[u.key] = c;
    });
  }

  private toggleUpgradePanel(open: boolean): void {
    this.panelOpen = open;
    // GameScene checks this to ignore map taps while the panel is up
    this.registry.set('ui-modal', open);
    this.upgradePanel.setVisible(open);
    if (open) {
      this.upgradePanel.setAlpha(0);
      this.tweens.add({ targets: this.upgradePanel, alpha: 1, duration: settings.reducedMotion ? 60 : 150 });
    }
  }

  // ---------------------------------------------------------------- events
  private onPrice(price: number, delta: number, jitter = false): void {
    const from = this.displayedPrice;
    this.displayedPrice = price;
    if (jitter) {
      // market noise: tick the readout quietly — no arrow, shake, or flash
      this.priceText.setText(`$${price.toFixed(2)}`);
      return;
    }
    countTo(this, this.priceText, from, price, v => `$${v.toFixed(2)}`, delta < 0 ? 500 : 300);
    const down = delta < 0;
    this.priceArrow.setText(down ? '▼' : '▲').setColor(down ? HEX.green : HEX.red).setAlpha(1);
    this.tweens.add({ targets: this.priceArrow, alpha: 0, delay: 400, duration: 300 });
    this.priceBox.setStrokeStyle(3, down ? PAL.green : PAL.red);
    if (down) {
      this.tweens.add({ targets: this.priceText, scale: { from: 1.25, to: 1 }, duration: 300, ease: EASE.snap });
    } else {
      this.tweens.add({ targets: this.priceBox, x: { from: 204, to: 198 }, duration: 50, yoyo: true, repeat: 3 });
      this.graphFlash = 1;
    }
  }

  private onCredits(credits: number, gain: number, x: number, y: number): void {
    const from = this.displayedCredits;
    this.displayedCredits = credits;
    countTo(this, this.creditsText, from, credits, v => `DC ${Math.round(v)}`, 350);
    if (gain > 0 && x > 0 && !settings.reducedMotion) {
      const m = this.creditsText.getWorldTransformMatrix();
      for (let i = 0; i < Math.min(gain, 5); i++) {
        const coin = this.add.circle(x, y, 7, PAL.gold).setStrokeStyle(2, PAL.ink).setDepth(1500);
        this.tweens.add({
          targets: coin,
          x: m.tx - 30,
          y: m.ty,
          delay: i * 60,
          duration: 420,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            coin.destroy();
            sfx.coin();
            this.tweens.add({ targets: this.creditsText, scale: { from: 1.3, to: 1 }, duration: 150 });
          }
        });
      }
    }
    this.refreshUpgradeAffordability();
  }

  private refreshUpgradeAffordability(): void {
    // glow the strip button when anything is buyable
    const anyAffordable = UPGRADES.some(u => {
      const lvl = this.upgradeLevels[u.key];
      const costs = costsOf(u.key);
      return lvl < costs.length && this.displayedCredits >= costs[lvl];
    });
    this.upgradeToggleBg.setStrokeStyle(4, anyAffordable ? PAL.green : PAL.gold, anyAffordable ? 1 : 0.9);
    for (const u of UPGRADES) {
      const c = this.upgradeButtons[u.key];
      if (!c) continue;
      const lvl = this.upgradeLevels[u.key];
      const costs = costsOf(u.key);
      const bg = c.getData('bg') as Phaser.GameObjects.Rectangle;
      const cost = c.getData('cost') as Phaser.GameObjects.Text;
      if (lvl >= costs.length) {
        cost.setText('MAX').setColor(HEX.green);
        continue;
      }
      const price = costs[lvl];
      const affordable = this.displayedCredits >= price;
      bg.setStrokeStyle(4, affordable ? PAL.green : PAL.gold, affordable ? 1 : 0.7);
      cost.setText(`DC ${price}`).setColor(affordable ? HEX.green : HEX.gold);
      if (affordable && !c.getData('pulsing')) {
        c.setData('pulsing', true);
        if (!settings.reducedMotion) {
          this.tweens.add({ targets: c, scale: 1.04, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        }
      } else if (!affordable && c.getData('pulsing')) {
        c.setData('pulsing', false);
        this.tweens.killTweensOf(c);
        c.setScale(1);
      }
    }
  }

  private onUpgradeBought(key: string, level: number): void {
    this.upgradeLevels[key] = level;
    const c = this.upgradeButtons[key];
    const def = UPGRADES.find(u => u.key === key)!;
    const pips = c.getData('pips') as Phaser.GameObjects.Text;
    pips.setText('●'.repeat(level) + '○'.repeat(Math.max(0, 3 - level)));
    this.tweens.add({ targets: c, scale: { from: 1.25, to: 1 }, duration: 300, ease: EASE.pop });
    const m = c.getWorldTransformMatrix();
    floatText(this, m.tx, m.ty - 70, `${def.name} LV${level}`, HEX.green, 24);
    floatText(this, m.tx, m.ty - 98, def.desc, HEX.cream, 16);
    this.refreshUpgradeAffordability();
    this.toggleUpgradePanel(false); // auto-close after a purchase
  }

  private onCombo(combo: number, milestone?: string): void {
    if (combo === 0) {
      this.tweens.add({ targets: this.comboText, alpha: 0, duration: 200 });
      return;
    }
    const colors = [HEX.cream, HEX.gold, HEX.orange, HEX.red, HEX.purple];
    const tier = Math.min(Math.floor(combo / 10), colors.length - 1);
    this.comboText.setText(`COMBO ×${combo}`).setColor(colors[tier]).setAlpha(1);
    this.tweens.add({ targets: this.comboText, scale: { from: 1.4, to: 1 }, duration: 200, ease: EASE.pop });
    if (milestone) {
      const banner = this.add.container(VIEW.x + VIEW.w / 2, 168).setDepth(1400);
      const bg = this.add.rectangle(0, 0, 560, 64, PAL.purple).setStrokeStyle(5, PAL.ink);
      const txt = this.add
        .text(0, 0, milestone, {
          fontFamily: FONT_DISPLAY,
          fontSize: '28px',
          color: HEX.cream,
          stroke: HEX.ink,
          strokeThickness: 5
        })
        .setOrigin(0.5);
      banner.add([bg, txt]);
      popIn(this, banner, 300);
      this.time.delayedCall(1400, () => {
        this.tweens.add({ targets: banner, alpha: 0, y: 140, duration: 300, onComplete: () => banner.destroy() });
      });
      floatText(this, VIEW.x + VIEW.w / 2, 220, `+${combo} DC BONUS`, HEX.gold, 24);
    }
  }

  private onTankerSafe(streak: number): void {
    this.streakText.setText(`SAFE ×${streak}`);
    this.tweens.add({ targets: this.streakBadge, scale: { from: 1.4, to: 1 }, duration: 300, ease: EASE.pop });
  }

  private onHeadline(text: string, tone: 'good' | 'bad' | 'event'): void {
    this.tweens.killTweensOf(this.headlineText);
    this.headlineText
      .setText(text)
      .setColor(tone === 'good' ? '#B8F5CD' : tone === 'event' ? '#F2D8FF' : HEX.cream)
      .setAlpha(0)
      .setX(BAND.x + 240);
    // headline takes over the band; ticker comes back when it fades
    this.tickerText.setAlpha(0);
    this.tweens.add({
      targets: this.headlineText,
      alpha: 1,
      x: BAND.x + 210,
      duration: settings.reducedMotion ? 100 : 250,
      ease: 'Cubic.easeOut'
    });
    this.tweens.add({
      targets: this.headlineText,
      alpha: 0,
      delay: 2600,
      duration: 400,
      onComplete: () => this.tickerText.setAlpha(1)
    });
  }

  private onThreshold(label: string, tone: 'good' | 'bad'): void {
    // price thresholds live in the breaking-news band, no popup card
    this.onHeadline(label, tone);
  }

  private onEventProb(label: string, prob: number, active: boolean): void {
    this.predTargetProb = prob;
    this.predActive = active;
    this.predLabel?.setText(active ? `⚡ LIVE: ${label}` : '$4.2m Vol.  ·  Hormuz Markets');
    this.predLabel?.setColor(active ? '#EB5757' : '#858D92');
  }

  private onEventCard(title: string, _colorHex: string): void {
    // events announce through the breaking-news band, no popup card
    sfx.eventCard();
    this.onHeadline(`SPECIAL EVENT: ${title}`, 'event');
  }

  /** Breaking-meme cutaway: "MEME UPDATE IN 3..2..1" over the price graph,
   *  then the meme (picked from src/config/memes.json) bounces in, holds,
   *  and bounces back out. */
  private showMemeReaction(label: string): void {
    // memes react to game moments, but sparingly — respect the cooldown so
    // back-to-back moments don't turn the left box into a meme channel
    if (this.time.now - this.lastMemeAt < MEMES.settings.minGapMs) return;
    this.lastMemeAt = this.time.now;
    const gen = ++this.memeGen; // cancels any countdown/popup still running
    this.memePopup?.destroy();
    this.memePopup = undefined;

    const tick = settings.reducedMotion ? 260 : MEMES.settings.countdownTickMs;
    const pop = this.add.container(LEFT_BOX.x + LEFT_BOX.w / 2, LEFT_BOX.y + LEFT_BOX.h / 2).setDepth(1200);
    this.memePopup = pop;

    // opaque backing covers the graph; band + backing stay static while the
    // countdown/meme content animates inside `inner`
    pop.add(this.add.rectangle(0, 0, LEFT_BOX.w, LEFT_BOX.h, PAL.ink, 1));
    pop.add(this.add.rectangle(0, -LEFT_BOX.h / 2 + 20, 190, 28, BAND_RED).setStrokeStyle(3, PAL.ink));
    pop.add(
      this.add
        .text(0, -LEFT_BOX.h / 2 + 20, 'BREAKING MEME', {
          fontFamily: FONT_SANS,
          fontSize: '14px',
          fontStyle: 'bold',
          color: HEX.cream
        })
        .setOrigin(0.5)
    );

    // -- countdown teaser
    const cd = this.add.container(0, 0);
    pop.add(cd);
    cd.add(
      this.add
        .text(0, -70, 'MEME UPDATE IN', {
          fontFamily: FONT_SANS,
          fontSize: '20px',
          fontStyle: 'bold',
          color: HEX.gold
        })
        .setOrigin(0.5)
    );
    const num = this.add
      .text(0, 20, '3', {
        fontFamily: FONT_DISPLAY,
        fontSize: '96px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 8
      })
      .setOrigin(0.5);
    cd.add(num);
    const setNum = (n: number): void => {
      num.setText(String(n));
      sfx.tick(n === 1);
      if (!settings.reducedMotion) {
        num.setScale(0.4);
        this.tweens.add({ targets: num, scale: 1, duration: tick * 0.6, ease: 'Back.easeOut' });
      }
    };
    setNum(3);
    this.time.delayedCall(tick, () => gen === this.memeGen && setNum(2));
    this.time.delayedCall(tick * 2, () => gen === this.memeGen && setNum(1));

    // -- the meme itself, bouncing in after the countdown
    this.time.delayedCall(tick * 3, () => {
      if (gen !== this.memeGen || this.memePopup !== pop) return;
      cd.destroy();
      const inner = this.add.container(0, 0);
      pop.add(inner);
      renderMeme(this, inner, pickMeme(label), 300, LEFT_BOX.h - 70);
      if (settings.reducedMotion) {
        inner.setAlpha(0);
        this.tweens.add({ targets: inner, alpha: 1, duration: 200 });
      } else {
        inner.setScale(0);
        this.tweens.add({ targets: inner, scale: 1, duration: 380, ease: 'Back.easeOut' });
      }
      sfx.whoosh();

      // hold, then bounce out and drop the cutaway
      this.time.delayedCall(MEMES.settings.durationMs, () => {
        if (gen !== this.memeGen || this.memePopup !== pop) return;
        this.memePopup = undefined;
        const done = (): void => {
          this.tweens.add({ targets: pop, alpha: 0, duration: 180, onComplete: () => pop.destroy() });
        };
        if (settings.reducedMotion) done();
        else this.tweens.add({ targets: inner, scale: 0, duration: 260, ease: 'Back.easeIn', onComplete: done });
      });
    });
  }

  private onTimer(elapsed: number): void {
    const total = Math.floor(elapsed);
    const m = Math.floor(total / 60);
    const s = total % 60;
    this.elapsedSec = elapsed;
    this.timerText.setText(`${m}:${s.toString().padStart(2, '0')}`);
    if (!this.dangerBanner?.visible) this.timerText.setColor(HEX.cream).setFontSize(36);
  }

  private onDanger(remaining: number | null): void {
    if (remaining === null) {
      this.dangerBanner?.setVisible(false);
      return;
    }
    if (!this.dangerBanner) {
      this.dangerBanner = this.add.container(VIEW.x + VIEW.w / 2, VIEW.y + 42).setDepth(1650);
      const bg = this.add.rectangle(0, 0, 520, 54, PAL.red, 0.95).setStrokeStyle(4, PAL.ink);
      this.dangerText = this.add
        .text(0, 0, '', { fontFamily: FONT_DISPLAY, fontSize: '24px', color: HEX.cream, stroke: HEX.ink, strokeThickness: 4 })
        .setOrigin(0.5);
      this.dangerBanner.add([bg, this.dangerText]);
      if (!settings.reducedMotion) {
        this.tweens.add({ targets: this.dangerBanner, alpha: 0.55, duration: 220, yoyo: true, repeat: -1 });
      }
    }
    this.dangerBanner.setVisible(true);
    this.dangerText.setText(`⚠ MARKET MELTDOWN IN ${remaining.toFixed(1)}s`);
    this.timerText.setColor(HEX.red).setFontSize(40);
  }

  // ---------------------------------------------------------------- loop
  update(_t: number, dtMs: number): void {
    const dt = dtMs / 1000;
    // "Will the US keep the strait open?" — Yes falls as event probability rises
    this.predShown = Phaser.Math.Linear(this.predShown, this.predTargetProb, 0.08);
    const yes = Phaser.Math.Clamp(Math.round((1 - this.predShown) * 100), 1, 99);
    const no = 100 - yes;
    this.predChance.setText(`${yes}%`);
    this.predChance.setColor(yes >= 50 ? '#27AE60' : '#EB5757');
    this.predYesText.setText(`Buy Yes ${yes}¢`);
    this.predNoText.setText(`Buy No ${no}¢`);
    const hot = this.predShown > 0.6 || this.predActive;
    this.drawPredCard(hot);
    if (hot && !settings.reducedMotion) {
      this.heartbeat += dt * (4 + this.predShown * 6);
      this.predChance.setAlpha(0.7 + Math.sin(this.heartbeat) * 0.3);
    } else {
      this.predChance.setAlpha(1);
    }

    const stats = this.registry.get('finalStats') as SessionStats | undefined;
    const hist = (this.scene.get('Game') as any)?.stats?.priceHistory ?? stats?.priceHistory ?? this.history;
    this.drawGraph(hist);
    if (this.graphFlash > 0) this.graphFlash = Math.max(0, this.graphFlash - dt * 2);
  }

  private drawGraph(hist: number[]): void {
    const g = this.graph;
    g.clear();
    // fills the left box below the price readout
    const x0 = LEFT_BOX.x + 20,
      y0 = 132,
      w = LEFT_BOX.w - 40,
      h = LEFT_BOX.y + LEFT_BOX.h - 20 - 132;
    g.fillStyle(0x22303e, 1);
    g.fillRect(x0, y0, w, h);
    if (this.graphFlash > 0) {
      g.fillStyle(PAL.red, 0.35 * this.graphFlash);
      g.fillRect(x0, y0, w, h);
    }
    // scrolling chart: fixed step per sample so the line grows rightward,
    // then scrolls left once the window (SAMPLES) is full
    const SAMPLES = 60;
    const data = hist.slice(-SAMPLES);
    if (data.length < 2) {
      this.graphTip.setAlpha(0);
      for (const t of [...this.yAxisLabels, ...this.dayLabels]) t.setAlpha(0);
      return;
    }
    // the head of the line is "now": the live (tweened) price readout. Samples
    // sit behind it by their age, so the line slides continuously instead of
    // jumping from sample to sample every half second.
    const live = this.displayedPrice;
    const min = Math.min(...data, live) - 2;
    const max = Math.max(...data, live) + 2;
    const step = w / (SAMPLES - 1);
    const yOf = (v: number): number => y0 + h - ((v - min) / (max - min)) * h;
    const SAMPLE_SEC = 0.5;
    const n = data.length;
    const full = hist.length >= SAMPLES;
    const liveT = (this.elapsedSec % SAMPLE_SEC) / SAMPLE_SEC;
    const headX = full ? x0 + w : x0 + (n - 1 + liveT) * step;
    const xOf = (i: number): number => headX - (n - 1 - i + liveT) * step;

    // y axis: price gridlines + labels at max / mid / min
    const yLevels = [max - 2, (min + max) / 2, min + 2];
    g.lineStyle(1, 0x8fa6bc, 0.2);
    yLevels.forEach((v, i) => {
      g.lineBetween(x0, yOf(v), x0 + w, yOf(v));
      this.yAxisLabels[i]
        .setText(`$${v.toFixed(0)}`)
        .setPosition(x0 + 4, Phaser.Math.Clamp(yOf(v), y0 + 8, y0 + h - 8))
        .setAlpha(0.9);
    });

    // x axis: DAY N markers at day boundaries, in the same continuous mapping
    const pps = step / SAMPLE_SEC; // pixels per second
    const dayLen = TUNING.dayNight.dayLengthSec;
    const tEnd = this.elapsedSec;
    const tMin = tEnd - (headX - x0) / pps;
    let li = 0;
    for (let k = Math.max(0, Math.ceil(tMin / dayLen)); k * dayLen <= tEnd && li < this.dayLabels.length; k++) {
      const px = headX - (tEnd - k * dayLen) * pps;
      g.lineStyle(1, PAL.gold, 0.35);
      g.lineBetween(px, y0, px, y0 + h);
      this.dayLabels[li++]
        .setText(`DAY ${k + 1}`)
        .setPosition(Phaser.Math.Clamp(px, x0 + 24, x0 + w - 24), y0 + h - 4)
        .setAlpha(0.95);
    }
    for (; li < this.dayLabels.length; li++) this.dayLabels[li].setAlpha(0);

    g.lineStyle(3, PAL.gold, 0.9);
    g.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const px = xOf(i);
      if (px < x0) continue;
      if (!started) {
        if (i > 0) {
          // clip the segment entering from the left edge
          const f = (x0 - xOf(i - 1)) / step;
          g.moveTo(x0, yOf(Phaser.Math.Linear(data[i - 1], data[i], f)));
          g.lineTo(px, yOf(data[i]));
        } else {
          g.moveTo(px, yOf(data[i]));
        }
        started = true;
      } else {
        g.lineTo(px, yOf(data[i]));
      }
    }
    if (!started) g.moveTo(x0, yOf(live));
    g.lineTo(headX, yOf(live));
    g.strokePath();
    const tipX = headX;
    const tipY = yOf(live);
    const down = live <= data[n - 1];
    // dashed-ish guide line at the current price level
    g.lineStyle(1, PAL.gold, 0.25);
    g.lineBetween(x0, tipY, x0 + w, tipY);
    g.fillStyle(down ? PAL.green : PAL.red, 1);
    g.fillCircle(tipX, tipY, 5);
    // price tag riding the tip of the line
    this.graphTip
      .setText(`$${live.toFixed(1)}`)
      .setColor(down ? HEX.green : HEX.red)
      .setAlpha(1);
    if (tipX > x0 + w - 72) {
      this.graphTip.setOrigin(1, 0.5).setPosition(tipX - 10, tipY);
    } else {
      this.graphTip.setOrigin(0, 0.5).setPosition(tipX + 10, tipY);
    }
  }
}
