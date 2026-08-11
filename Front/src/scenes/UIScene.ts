import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL, VIEW } from '../core/palette';
import { settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { MemeContext, MEMES, pickMeme, renderMeme } from '../core/memes';
import { EASE, countTo, floatText, popIn, pressPulse } from '../core/juice';
import { DayMission, DaySummary, EV, SessionStats, bus } from '../core/state';
import { TUNING } from '../config/tuning';
import { registerLayout } from '../dev/layout';

interface UpgradeDef {
  key: 'air' | 'hull' | 'gold';
  name: string;
  desc: string;
  icon: string;
  caption: string;
}

const UPGRADES: UpgradeDef[] = [
  {
    key: 'air',
    name: 'AIR ASSISTANCE',
    desc: 'Friendly jet patrols and intercepts',
    icon: 'upgradeIconAir',
    caption: 'JETS INTERCEPT'
  },
  {
    key: 'hull',
    name: 'HULL ARMOR',
    desc: 'Tankers survive +1 hit per level',
    icon: 'tanker0',
    caption: '+1 HIT / LEVEL'
  },
  {
    key: 'gold',
    name: 'OIL MONEY',
    desc: 'Earn +25% $ per level',
    icon: 'upgradeIconGold',
    caption: '+25% $ / LEVEL'
  }
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
  private graphPrice = 112;
  private graphMin = NaN;
  private graphMax = NaN;
  private graph!: Phaser.GameObjects.Graphics;
  private graphTip!: Phaser.GameObjects.Text;
  private history: number[] = [112];
  private graphFlash = 0;
  // big-move color flash: price UI is white by default, green/red only while
  // a |delta| >= market.priceBigDelta move is fresh
  private priceFlashUntil = 0;
  private priceFlashDown = false;
  private elapsedSec = 0;
  private dayLabels: Phaser.GameObjects.Text[] = [];
  private targetLabel!: Phaser.GameObjects.Text;
  private yAxisLabels: Phaser.GameObjects.Text[] = [];

  // day system
  private mission: DayMission | null = null;
  private hourText!: Phaser.GameObjects.Text;
  private summaryPanel?: Phaser.GameObjects.Container;
  private summaryNextDay = 2;
  private missionChipBg!: Phaser.GameObjects.Rectangle;
  private missionDayText!: Phaser.GameObjects.Text;
  private missionText!: Phaser.GameObjects.Text;
  private headlineQueue: Array<{ text: string; tone: 'good' | 'bad' | 'event'; hold: number }> = [];
  private headlineBusy = false;
  private upgradeLocked: Record<string, boolean> = { air: true, hull: true, gold: true };

  private creditsText!: Phaser.GameObjects.Text;
  private displayedCredits = 30;
  private comboText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private headlineText!: Phaser.GameObjects.Text;
  private tickerText!: Phaser.GameObjects.Text;
  private predShown = 0.92;
  private predBase = 0.92;
  private predNudge = 0;
  private predActive = false;
  private predFlash = 0;
  private predFlashGood = false;
  private predLastChipYes = 92;
  private predLastChipAt = 0;
  private predChance!: Phaser.GameObjects.Text;
  private predYesText!: Phaser.GameObjects.Text;
  private predNoText!: Phaser.GameObjects.Text;
  private predCardGfx!: Phaser.GameObjects.Graphics;
  private dangerBanner?: Phaser.GameObjects.Container;
  private dangerText!: Phaser.GameObjects.Text;
  private predLabel!: Phaser.GameObjects.Text;
  private upgradeLevels: Record<string, number> = { air: 0, hull: 0, gold: 0 };
  private upgradeButtons: Record<string, Phaser.GameObjects.Container> = {};
  private memePopup?: Phaser.GameObjects.Container;
  private memeGen = 0;
  private lastMemeAt = -Infinity;
  private heartbeat = 0;

  constructor() {
    super('UI');
  }

  create(): void {
    this.displayedPrice = 112;
    this.graphPrice = 112;
    this.graphMin = NaN;
    this.graphMax = NaN;
    this.priceFlashUntil = 0;
    this.displayedCredits = 30;
    this.history = [112];
    this.mission = null;
    this.headlineQueue = [];
    this.headlineBusy = false;
    this.upgradeLocked = { air: true, hull: true, gold: true };
    this.upgradeLevels = { air: 0, hull: 0, gold: 0 };
    this.lastMemeAt = -Infinity;
    this.predBase = TUNING.market.baseAtStart;
    this.predShown = this.predBase;
    this.predNudge = 0;
    this.predFlash = 0;
    this.predLastChipYes = Math.round(this.predBase * 100);
    this.predLastChipAt = 0;
    this.registry.set('ui-modal', false);

    this.buildStudioFrame();
    this.buildLeftBox();
    this.buildStrip();
    this.buildPredictionPanel();
    this.buildNewsBand();
    this.buildMissionChip();

    bus.on(EV.PRICE, this.onPrice, this);
    bus.on(EV.CREDITS, this.onCredits, this);
    bus.on(EV.COMBO, this.onCombo, this);
    bus.on(EV.HEADLINE, this.onHeadline, this);
    bus.on(EV.MISSION, this.onMission, this);
    bus.on(EV.DAY_START, this.onDayStart, this);
    bus.on(EV.DAY_END, this.onDayEnd, this);
    bus.on(EV.DAY_BREAK, this.onDayBreak, this);
    bus.on(EV.UPGRADE_REVEAL, this.onUpgradeReveal, this);
    bus.on(EV.MARKET_NUDGE, this.nudgeMarket, this);
    bus.on(EV.EVENT_PROB, this.onEventProb, this);
    bus.on(EV.TIMER, this.onTimer, this);
    bus.on(EV.DANGER, this.onDanger, this);
    bus.on(EV.UPGRADE_DEMO, this.onUpgradeBought, this);
    bus.on('tanker-safe', this.onTankerSafe, this);
    bus.on('meme-moment', this.showMemeReaction, this);
    bus.on(EV.DEV_FORCE_MEME, this.onDevForceMeme, this);

    this.events.on('shutdown', () => {
      bus.off(EV.PRICE, this.onPrice, this);
      bus.off(EV.CREDITS, this.onCredits, this);
      bus.off(EV.COMBO, this.onCombo, this);
      bus.off(EV.HEADLINE, this.onHeadline, this);
      bus.off(EV.MISSION, this.onMission, this);
      bus.off(EV.DAY_START, this.onDayStart, this);
      bus.off(EV.DAY_END, this.onDayEnd, this);
      bus.off(EV.DAY_BREAK, this.onDayBreak, this);
      bus.off(EV.UPGRADE_REVEAL, this.onUpgradeReveal, this);
      bus.off(EV.MARKET_NUDGE, this.nudgeMarket, this);
      bus.off(EV.EVENT_PROB, this.onEventProb, this);
      bus.off(EV.TIMER, this.onTimer, this);
      bus.off(EV.DANGER, this.onDanger, this);
      bus.off(EV.UPGRADE_DEMO, this.onUpgradeBought, this);
      bus.off('tanker-safe', this.onTankerSafe, this);
      bus.off('meme-moment', this.showMemeReaction, this);
      bus.off(EV.DEV_FORCE_MEME, this.onDevForceMeme, this);
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
    // LIVE badge on the game window's top-right corner — blinking on-air dot
    const liveDot = this.add.circle(VIEW.x + VIEW.w - 62, VIEW.y + 18, 6, PAL.red).setDepth(991);
    if (!settings.reducedMotion) {
      this.tweens.add({ targets: liveDot, alpha: 0.15, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    this.add
      .text(VIEW.x + VIEW.w - 50, VIEW.y + 18, 'LIVE', {
        fontFamily: FONT_SANS,
        fontSize: '15px',
        fontStyle: 'bold',
        color: HEX.cream
      })
      .setOrigin(0, 0.5)
      .setDepth(991);
    // broadcast clock: in-game hour of the current day, right under LIVE
    this.hourText = this.add
      .text(VIEW.x + VIEW.w - 41, VIEW.y + 40, '00:00', {
        fontFamily: FONT_SANS,
        fontSize: '14px',
        fontStyle: 'bold',
        color: HEX.gold
      })
      .setOrigin(0.5)
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
      .text(cx - 10, 92, '$112', { fontFamily: FONT_DISPLAY, fontSize: '34px', color: HEX.cream })
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
        color: HEX.cream,
        backgroundColor: '#101a24',
        padding: { x: 5, y: 2 }
      })
      .setOrigin(0, 0.5)
      .setAlpha(0);
    // axis label pools, positioned each frame by drawGraph()
    this.yAxisLabels = [0, 1, 2].map(() =>
      this.add
        .text(0, 0, '', { fontFamily: FONT_SANS, fontSize: '11px', fontStyle: 'bold', color: HEX.green })
        .setOrigin(0, 0.5)
        .setAlpha(0)
    );
    this.dayLabels = [0, 1, 2, 3].map(() =>
      this.add
        .text(0, 0, '', { fontFamily: FONT_SANS, fontSize: '11px', fontStyle: 'bold', color: HEX.gold })
        .setOrigin(0.5, 1)
        .setAlpha(0)
    );
    // price-mission target line label ("TARGET $120"), shown on price days only
    this.targetLabel = this.add
      .text(0, 0, '', { fontFamily: FONT_SANS, fontSize: '11px', fontStyle: 'bold', color: HEX.gold })
      .setOrigin(1, 1)
      .setAlpha(0);
    group.add([oilLabel, this.priceBox, this.priceText, this.priceArrow, this.graph, this.graphTip, this.targetLabel]);
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

    // day counter + combo
    this.timerText = this.add
      .text(640, cy - 14, 'DAY 1', {
        fontFamily: FONT_DISPLAY,
        fontSize: '40px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setDepth(1000);
    this.comboText = this.add
      .text(640, cy + 28, '', {
        fontFamily: FONT_DISPLAY,
        fontSize: '22px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(1000);

    // cash readout — the shop only opens on the day-end recap screen now
    const cashChip = this.add.container(1130, cy).setDepth(1001);
    const cashBg = this.add.rectangle(0, 0, 180, 74, 0x22303e, 1).setStrokeStyle(4, PAL.gold, 0.9);
    const cashLabel = this.add
      .text(0, -18, 'CASH', { fontFamily: FONT_SANS, fontSize: '13px', fontStyle: 'bold', color: '#AAB4BD' })
      .setOrigin(0.5);
    this.creditsText = this.add
      .text(0, 14, '$30', { fontFamily: FONT_SANS, fontSize: '22px', fontStyle: 'bold', color: HEX.green })
      .setOrigin(0.5);
    cashChip.add([cashBg, cashLabel, this.creditsText]);
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
    this.drawPredCard(false, true);

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

  private drawPredCard(hot: boolean, good: boolean): void {
    const X = PRED_X,
      Y = PRED_Y,
      W = PRED_W,
      H = PRED_H;
    const g = this.predCardGfx;
    g.clear();
    g.fillStyle(0x1d2b39, 0.97);
    g.fillRoundedRect(X, Y, W, H, 12);
    if (this.predFlash > 0) {
      // big-move flash: brief green/red wash over the card fill
      g.fillStyle(this.predFlashGood ? 0x27ae60 : 0xeb5757, 0.18 * this.predFlash);
      g.fillRoundedRect(X, Y, W, H, 12);
    }
    g.lineStyle(2, hot ? (good ? 0x27ae60 : 0xeb5757) : 0x344452, 1);
    g.strokeRoundedRect(X, Y, W, H, 12);
  }

  /** Push the market a few points; decays back to the price baseline. Big
   *  single pushes also flash the card. */
  private nudgeMarket(delta: number): void {
    const m = TUNING.market;
    this.predNudge = Phaser.Math.Clamp(this.predNudge + delta, -m.nudgeMax, m.nudgeMax);
    if (Math.abs(delta) >= m.flashThreshold) {
      this.predFlash = 1;
      this.predFlashGood = delta > 0;
    }
  }

  /** Polymarket-style "▲2 / ▼3" odds-tick chip beside the % figure. */
  private spawnOddsChip(delta: number): void {
    const up = delta > 0;
    const chip = this.add
      .text(PRED_X + PRED_W - 10, PRED_Y + 44, `${up ? '▲' : '▼'}${Math.abs(delta)}`, {
        fontFamily: FONT_SANS,
        fontSize: '11px',
        fontStyle: 'bold',
        color: up ? '#27AE60' : '#EB5757'
      })
      .setOrigin(1, 0.5)
      .setDepth(1001);
    this.tweens.add({
      targets: chip,
      y: chip.y - (settings.reducedMotion ? 0 : 10),
      alpha: 0,
      duration: settings.reducedMotion ? 300 : 700,
      ease: 'Cubic.easeOut',
      onComplete: () => chip.destroy()
    });
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

  /** Builds one upgrade card inside the day-end recap/shop screen. */
  private buildUpgradeCard(parent: Phaser.GameObjects.Container, u: UpgradeDef, x: number, y: number): void {
    const c = this.add.container(x, y);
    parent.add(c);
    const bg = this.add.rectangle(0, 0, 260, 170, 0x22303e, 0.95).setStrokeStyle(4, PAL.gold, 0.9);
    const name = this.add
      .text(0, -60, u.name, { fontFamily: FONT_SANS, fontSize: '19px', fontStyle: 'bold', color: HEX.cream })
      .setOrigin(0.5);
    const icon = this.add.image(0, -16, u.icon);
    icon.setScale(Math.min(64 / icon.width, 44 / icon.height));
    const caption = this.add
      .text(0, 20, u.caption, {
        fontFamily: FONT_SANS,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#AAB4BD',
        align: 'center',
        wordWrap: { width: 240 }
      })
      .setOrigin(0.5);
    const cost = this.add
      .text(-56, 52, `$${costsOf(u.key)[0]}`, { fontFamily: FONT_DISPLAY, fontSize: '24px', color: HEX.green })
      .setOrigin(0.5);
    const pips = this.add
      .text(70, 52, '○'.repeat(costsOf(u.key).length), { fontFamily: FONT_SANS, fontSize: '18px', color: HEX.green })
      .setOrigin(0.5);
    c.add([bg, name, icon, caption, cost, pips]);
    // locked shroud until the upgrade's reveal day (news announces the unlock)
    const lock = this.add.container(0, 0);
    lock.add(this.add.rectangle(0, 0, 260, 170, PAL.ink, 0.82));
    lock.add(
      this.add
        .text(0, -10, '🔒 CLASSIFIED', { fontFamily: FONT_SANS, fontSize: '18px', fontStyle: 'bold', color: '#AAB4BD' })
        .setOrigin(0.5)
    );
    lock.add(
      this.add
        .text(0, 18, `UNLOCKS DAY ${TUNING.days.upgradeRevealDays[u.key]}`, {
          fontFamily: FONT_SANS,
          fontSize: '13px',
          fontStyle: 'bold',
          color: HEX.gold
        })
        .setOrigin(0.5)
    );
    lock.setVisible(this.upgradeLocked[u.key]);
    c.add(lock);
    c.setSize(260, 170);
    c.setInteractive({ useHandCursor: true });
    c.setData({ bg, cost, pips, def: u, baseScale: 1, lock });
    c.on('pointerover', () => this.tweens.add({ targets: c, scale: 1.05, duration: 100 }));
    c.on('pointerout', () => this.tweens.add({ targets: c, scale: 1, duration: 100 }));
    c.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      if (this.upgradeLocked[u.key]) {
        this.tweens.add({ targets: c, x: x - 6, duration: 40, yoyo: true, repeat: 2 });
        sfx.tap();
        return;
      }
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
  }

  // ---------------------------------------------------------------- events
  private onPrice(price: number, delta: number, jitter = false): void {
    const from = this.displayedPrice;
    this.displayedPrice = price;
    // market confidence baseline follows the oil price (jitter included, so
    // the odds tick like a live market)
    this.predBase = Phaser.Math.Clamp(
      TUNING.market.baseAtStart - (price - TUNING.session.startPrice) * TUNING.market.perDollar,
      0.01,
      0.97
    );
    if (jitter) {
      // market noise: tick the readout quietly — no arrow, shake, or flash
      this.priceText.setText(`$${Math.round(price)}`);
      return;
    }
    countTo(this, this.priceText, from, price, v => `$${Math.round(v)}`, delta < 0 ? 500 : 300);
    const down = delta < 0;
    this.priceArrow.setText(down ? '▼' : '▲').setColor(down ? HEX.green : HEX.red).setAlpha(1);
    this.tweens.add({ targets: this.priceArrow, alpha: 0, delay: 400, duration: 300 });
    // only a big move colors the price UI — small ticks stay white
    if (Math.abs(delta) >= TUNING.market.priceBigDelta) {
      this.priceFlashDown = down;
      this.priceFlashUntil = this.time.now + TUNING.market.priceColorHoldSec * 1000;
      this.priceText.setColor(down ? HEX.green : HEX.red);
      this.priceBox.setStrokeStyle(3, down ? PAL.green : PAL.red);
    }
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
    countTo(this, this.creditsText, from, credits, v => `$${Math.round(v)}`, 350);
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
    for (const u of UPGRADES) {
      const c = this.upgradeButtons[u.key];
      if (!c || !c.active) continue;
      if (this.upgradeLocked[u.key]) {
        (c.getData('bg') as Phaser.GameObjects.Rectangle).setStrokeStyle(4, PAL.gold, 0.4);
        continue;
      }
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
      // money is always green; affordability shows via the border + dimming
      cost.setText(`$${price}`).setColor(HEX.green).setAlpha(affordable ? 1 : 0.55);
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
    if (!c || !c.active) return;
    const def = UPGRADES.find(u => u.key === key)!;
    const pips = c.getData('pips') as Phaser.GameObjects.Text;
    pips.setText('●'.repeat(level) + '○'.repeat(Math.max(0, costsOf(def.key).length - level)));
    this.tweens.add({ targets: c, scale: { from: 1.25, to: 1 }, duration: 300, ease: EASE.pop });
    const m = c.getWorldTransformMatrix();
    floatText(this, m.tx, m.ty - 70, `${def.name} LV${level}`, HEX.green, 24);
    floatText(this, m.tx, m.ty - 98, def.desc, HEX.cream, 16);
    this.refreshUpgradeAffordability();
  }

  private onCombo(combo: number, milestone?: string): void {
    if (combo > 0) this.nudgeMarket(milestone ? TUNING.market.nudgeMilestone : TUNING.market.nudgeCombo);
    if (combo === 0) {
      this.tweens.add({ targets: this.comboText, alpha: 0, duration: 200 });
      return;
    }
    const colors = [HEX.cream, HEX.gold, HEX.orange, HEX.red, HEX.purple];
    const tier = Math.min(Math.floor(combo / 10), colors.length - 1);
    this.comboText.setText(`COMBO ×${combo}`).setColor(colors[tier]).setAlpha(1);
    this.tweens.add({ targets: this.comboText, scale: { from: 1.4, to: 1 }, duration: 200, ease: EASE.pop });
    if (milestone) {
      // milestone banner removed — just show the bonus payout
      floatText(this, VIEW.x + VIEW.w / 2, 220, `+$${combo} BONUS`, HEX.green, 24);
    }
  }

  private onTankerSafe(_streak: number): void {
    this.nudgeMarket(TUNING.market.nudgeTankerSafe);
  }

  /** Headlines queue up and play one after another so day-break sequences
   *  (summary, then intel warnings) all get read. */
  private onHeadline(text: string, tone: 'good' | 'bad' | 'event', holdMs = 2600): void {
    // bad news knocks market confidence down (good news is already counted
    // via tanker-safe, so no + nudge here — it would double-count)
    if (tone === 'bad') this.nudgeMarket(TUNING.market.nudgeBadNews);
    this.headlineQueue.push({ text, tone, hold: holdMs });
    if (!this.headlineBusy) this.pumpHeadline();
  }

  private pumpHeadline(): void {
    const next = this.headlineQueue.shift();
    if (!next) {
      this.headlineBusy = false;
      this.tickerText.setAlpha(1);
      return;
    }
    this.headlineBusy = true;
    this.tweens.killTweensOf(this.headlineText);
    this.headlineText
      .setText(next.text)
      .setColor(next.tone === 'good' ? '#B8F5CD' : next.tone === 'event' ? '#F2D8FF' : HEX.cream)
      .setAlpha(0)
      .setX(BAND.x + 240);
    // headline takes over the band; ticker comes back when the queue drains
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
      delay: next.hold,
      duration: 400,
      onComplete: () => this.pumpHeadline()
    });
  }

  // ---------------------------------------------------------------- day system
  /** Mission chip pinned to the top-center of the game window. */
  private buildMissionChip(): void {
    const chipW = 348;
    const chipX = VIEW.x + (VIEW.w - chipW) / 2;
    const chipY = VIEW.y + 12; // 12px inset from the window's top edge
    const group = this.add.container(0, 0).setDepth(1001);
    this.missionChipBg = this.add
      .rectangle(chipX, chipY, chipW, 46, PAL.ocean, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(3, PAL.gold, 1);
    this.missionDayText = this.add.text(chipX + 10, chipY + 6, 'DAY 1 · MISSION', {
      fontFamily: FONT_SANS,
      fontSize: '12px',
      fontStyle: 'bold',
      color: HEX.orange
    });
    this.missionText = this.add.text(chipX + 10, chipY + 22, 'INCOMING ORDERS…', {
      fontFamily: FONT_SANS,
      fontSize: '15px',
      fontStyle: 'bold',
      color: HEX.cream
    });
    group.add([this.missionChipBg, this.missionDayText, this.missionText]);
    registerLayout(this, 'hud-mission', group, { x: chipX, y: chipY, w: chipW, h: 46 });
  }

  private renderMissionChip(): void {
    const m = this.mission;
    if (!m) return;
    this.missionDayText.setText(`DAY ${m.day} · MISSION`);
    let suffix = '';
    let border: number = PAL.gold;
    let color: string = HEX.cream;
    if (m.done) {
      suffix = ' ✓';
      border = PAL.green;
      color = HEX.green;
    } else if (m.type === 'price') {
      suffix = ` — NOW $${Math.round(this.displayedPrice)}`;
    } else if (m.type === 'perfect') {
      if (m.progress > 0) {
        suffix = ' ✗';
        border = PAL.red;
        color = HEX.red;
      }
    } else {
      suffix = ` (${Math.min(m.progress, m.target)}/${m.target})`;
    }
    this.missionText.setText(`${m.text}${suffix}`).setColor(color);
    this.missionChipBg.setStrokeStyle(3, border, 0.9);
  }

  private onMission(m: DayMission): void {
    const wasDone = this.mission?.done ?? false;
    this.mission = m;
    this.renderMissionChip();
    if (m.done && !wasDone && !settings.reducedMotion) {
      this.tweens.add({ targets: [this.missionText, this.missionDayText], scale: { from: 1.15, to: 1 }, duration: 250, ease: EASE.pop });
    }
  }

  private onDayStart(day: number, missionText: string, reveals: Array<'air' | 'hull' | 'gold'>): void {
    // safety: the recap/shop screen never outlives the break
    this.summaryPanel?.destroy();
    this.summaryPanel = undefined;
    this.upgradeButtons = {};
    this.registry.set('ui-modal', false);
    this.onHeadline(`DAY ${day} — MISSION: ${missionText}`, 'event', 3200);
    for (const key of reveals) {
      const def = UPGRADES.find(u => u.key === key)!;
      this.onHeadline(`NEW TECH UNLOCKED: ${def.name} — ${def.desc.toUpperCase()}`, 'good', 2600);
    }
  }

  private onDayEnd(s: DaySummary): void {
    const mission = s.missionDone ? `MISSION COMPLETE +$${s.rewardCredits}` : 'MISSION FAILED';
    const delta = s.priceDelta >= 0 ? `+$${s.priceDelta}` : `−$${Math.abs(s.priceDelta)}`;
    this.onHeadline(
      `DAY ${s.day} ENDS — ${mission} · ${s.safe} SAFE, ${s.lost} LOST · OIL $${s.price} (${delta})`,
      s.missionDone ? 'good' : 'bad',
      3600
    );
    for (const warn of s.warnings) this.onHeadline(warn, 'event', 2600);
    if (!s.missionDone) this.graphFlash = 1;
    this.showDaySummaryPanel(s, delta);
  }

  /** Frozen-world recap + shop screen, covering 80% of the game window; the only
   *  time upgrades are purchasable. Waits for the player to click NEXT DAY. */
  private showDaySummaryPanel(s: DaySummary, delta: string): void {
    this.summaryPanel?.destroy();
    this.upgradeButtons = {};
    this.summaryNextDay = s.day + 1;
    const W = GAME_W * 0.8;
    const H = GAME_H * 0.8;
    const panel = this.add.container(GAME_W / 2, GAME_H / 2).setDepth(1700);
    this.summaryPanel = panel;
    this.registry.set('ui-modal', true);
    panel.add(this.add.rectangle(0, 0, W, H, PAL.ink, 0.97).setStrokeStyle(4, PAL.gold, 0.9));
    let y = -H / 2 + 42;
    panel.add(
      this.add
        .text(0, y, `DAY ${s.day} COMPLETE`, { fontFamily: FONT_DISPLAY, fontSize: '36px', color: HEX.gold })
        .setOrigin(0.5)
    );
    y += 42;
    panel.add(
      this.add
        .text(0, y, s.missionDone ? `✓ ${s.missionText}` : `✗ ${s.missionText}`, {
          fontFamily: FONT_SANS,
          fontSize: '20px',
          fontStyle: 'bold',
          color: s.missionDone ? HEX.green : HEX.red
        })
        .setOrigin(0.5)
    );
    y += 28;
    panel.add(
      this.add
        .text(0, y, s.missionDone ? `BONUS PAID: +$${s.rewardCredits}` : 'NO BONUS TODAY', {
          fontFamily: FONT_SANS,
          fontSize: '15px',
          fontStyle: 'bold',
          color: s.missionDone ? HEX.green : '#AAB4BD'
        })
        .setOrigin(0.5)
    );
    y += 28;
    panel.add(
      this.add
        .text(0, y, `CASH ON HAND: $${Math.round(this.displayedCredits)}`, {
          fontFamily: FONT_SANS,
          fontSize: '15px',
          fontStyle: 'bold',
          color: HEX.gold
        })
        .setOrigin(0.5)
    );
    y += 28;
    panel.add(
      this.add
        .text(0, y, `${s.safe} TANKERS SAFE · ${s.lost} LOST · OIL $${s.price} (${delta})`, {
          fontFamily: FONT_SANS,
          fontSize: '15px',
          fontStyle: 'bold',
          color: HEX.cream
        })
        .setOrigin(0.5)
    );
    y += 28;
    for (const warn of s.warnings) {
      panel.add(
        this.add
          .text(0, y, `⚠ ${warn}`, { fontFamily: FONT_SANS, fontSize: '13px', fontStyle: 'bold', color: '#F2D8FF' })
          .setOrigin(0.5)
      );
      y += 24;
    }

    // shop — the only window in which upgrades can be bought
    panel.add(
      this.add
        .text(0, 24, 'UPGRADES', { fontFamily: FONT_DISPLAY, fontSize: '24px', color: HEX.gold })
        .setOrigin(0.5)
    );
    UPGRADES.forEach((u, i) => this.buildUpgradeCard(panel, u, (i - 1) * 280, 128));

    const nextBtn = this.add.container(0, H / 2 - 40);
    const nextBtnBg = this.add.rectangle(0, 0, 300, 58, PAL.green).setStrokeStyle(4, PAL.ink);
    const nextBtnText = this.add
      .text(0, 0, `NEXT DAY — DAY ${this.summaryNextDay} ▶`, {
        fontFamily: FONT_DISPLAY,
        fontSize: '22px',
        color: HEX.ink
      })
      .setOrigin(0.5);
    nextBtn.add([nextBtnBg, nextBtnText]);
    nextBtn.setSize(300, 58);
    nextBtn.setInteractive({ useHandCursor: true });
    nextBtn.on('pointerover', () => this.tweens.add({ targets: nextBtn, scale: 1.05, duration: 100 }));
    nextBtn.on('pointerout', () => this.tweens.add({ targets: nextBtn, scale: 1, duration: 100 }));
    nextBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      pressPulse(this, nextBtn);
      sfx.tap();
      bus.emit(EV.NEXT_DAY_REQUEST);
    });
    if (!settings.reducedMotion) {
      this.tweens.add({ targets: nextBtn, scale: 1.04, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    panel.add(nextBtn);
    popIn(this, panel, 250);
    this.refreshUpgradeAffordability();
  }

  private onDayBreak(_remaining: null): void {
    this.summaryPanel?.destroy();
    this.summaryPanel = undefined;
    this.upgradeButtons = {};
    this.registry.set('ui-modal', false);
  }

  private onUpgradeReveal(key: string): void {
    this.upgradeLocked[key] = false;
    const c = this.upgradeButtons[key];
    if (!c || !c.active) return;
    (c.getData('lock') as Phaser.GameObjects.Container).setVisible(false);
    this.tweens.add({ targets: c, scale: { from: 1.2, to: 1 }, duration: 300, ease: EASE.pop });
    this.refreshUpgradeAffordability();
  }

  private onEventProb(_label: string, _prob: number, active: boolean): void {
    // events run silently — no LIVE footer swap, only the card's hot state
    this.predActive = active;
  }

  /** Breaking-meme cutaway: "MEME UPDATE IN 3..2..1" over the price graph,
   *  then the meme (picked from src/config/memes.json) bounces in, holds,
   *  and bounces back out. */
  /** Dev panel: fire a random meme trigger right now, bypassing the cooldown. */
  private onDevForceMeme(): void {
    const labels = Object.keys(MEMES.triggers);
    const label = labels[Math.floor(Math.random() * labels.length)] ?? 'EVENT LOST';
    this.showMemeReaction(label, undefined, true);
  }

  private showMemeReaction(label: string, ctx?: MemeContext, force = false): void {
    // memes react to game moments, but sparingly — respect the cooldown so
    // back-to-back moments don't turn the left box into a meme channel
    if (!force && this.time.now - this.lastMemeAt < MEMES.settings.minGapMs) return;
    this.lastMemeAt = this.time.now;
    // news band announces the cutaway for as long as it runs
    const cutawayMs = MEMES.settings.countdownTickMs * 3 + MEMES.settings.durationMs;
    this.onHeadline('MEME BREAK • MEME BREAK • MEME BREAK', 'event', cutawayMs);
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
      renderMeme(this, inner, pickMeme(label, ctx), 300, LEFT_BOX.h - 70);
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
    this.elapsedSec = elapsed;
    const dayLen = TUNING.dayNight.dayLengthSec;
    const day = Math.floor(elapsed / dayLen) + 1;
    this.timerText.setText(`DAY ${day}`);
    // broadcast clock: the day maps to a 24h cycle, ticking hour by hour
    const hour = Math.min(23, Math.floor(((elapsed % dayLen) / dayLen) * 24));
    this.hourText.setText(`${hour.toString().padStart(2, '0')}:00`);
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
    // "Will the US keep the strait open?" — Yes = market confidence in the
    // player: price-driven baseline + decaying nudges from gameplay moments
    const m = TUNING.market;
    this.predNudge *= Math.exp(-m.nudgeDecayPerSec * dt);
    let target = Phaser.Math.Clamp(this.predBase + this.predNudge, 0.01, 0.99);
    if (this.dangerBanner?.visible) target = Math.min(target, m.dangerCap);
    this.predShown = Phaser.Math.Linear(this.predShown, target, m.lerpRate);
    const yes = Phaser.Math.Clamp(Math.round(this.predShown * 100), 1, 99);
    const no = 100 - yes;
    this.predChance.setText(`${yes}%`);
    this.predChance.setColor(yes >= 50 ? '#27AE60' : '#EB5757');
    this.predYesText.setText(`Buy Yes ${yes}¢`);
    this.predNoText.setText(`Buy No ${no}¢`);

    // odds tick: whole-% moves pop a ▲/▼ chip and pulse the figure
    const chipDelta = yes - this.predLastChipYes;
    if (chipDelta !== 0 && this.time.now - this.predLastChipAt > 450) {
      this.predLastChipYes = yes;
      this.predLastChipAt = this.time.now;
      this.spawnOddsChip(chipDelta);
      if (!settings.reducedMotion) {
        this.tweens.add({ targets: this.predChance, scale: { from: 1.25, to: 1 }, duration: 180, ease: EASE.snap });
      }
    }

    if (this.predFlash > 0) this.predFlash = Math.max(0, this.predFlash - dt * 2.5);
    const hot = yes < m.hotLow * 100 || yes > m.hotHigh * 100 || this.predActive;
    this.drawPredCard(hot, yes >= 50);
    if (hot && !settings.reducedMotion) {
      this.heartbeat += dt * (yes < 50 ? 8 : 5);
      this.predChance.setAlpha(0.7 + Math.sin(this.heartbeat) * 0.3);
    } else {
      this.predChance.setAlpha(1);
    }

    const stats = this.registry.get('finalStats') as SessionStats | undefined;
    const hist = (this.scene.get('Game') as any)?.stats?.priceHistory ?? stats?.priceHistory ?? this.history;
    // graph head glides toward the live price instead of snapping each tick
    this.graphPrice = Phaser.Math.Linear(this.graphPrice, this.displayedPrice, 1 - Math.exp(-3.5 * dt));
    // big-move color flash expired → back to the neutral white/gold look
    if (this.priceFlashUntil && this.time.now > this.priceFlashUntil) {
      this.priceFlashUntil = 0;
      this.priceText.setColor(HEX.cream);
      this.priceBox.setStrokeStyle(3, PAL.gold);
    }
    this.drawGraph(hist, dt);
    if (this.graphFlash > 0) this.graphFlash = Math.max(0, this.graphFlash - dt * 2);
    // price missions read off the live price, so the chip tracks it each frame
    if (this.mission?.type === 'price' && !this.mission.done) this.renderMissionChip();
  }

  private drawGraph(hist: number[], dt: number): void {
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
      this.targetLabel.setAlpha(0);
      for (const t of [...this.yAxisLabels, ...this.dayLabels]) t.setAlpha(0);
      return;
    }
    // the head of the line is "now": a smoothed follower of the live price,
    // pinned at the center of the x axis. History trails off to the left,
    // the right half is the future (upcoming targets/day lines scroll in).
    const live = this.graphPrice;
    const step = (w / 2) / (SAMPLES - 1);
    const SAMPLE_SEC = 0.5;
    const n = data.length;
    const liveT = (this.elapsedSec % SAMPLE_SEC) / SAMPLE_SEC;
    const headX = x0 + w / 2;
    const xOf = (i: number): number => headX - (n - 1 - i + liveT) * step;
    const ppsX = step / SAMPLE_SEC; // pixels per second
    const dayLenX = TUNING.dayNight.dayLengthSec;
    // today's price target (price-type missions only): drawn as a line across
    // the chart so the player always sees where the day has to close
    const priceTarget = this.mission && this.mission.type === 'price' && !this.mission.done ? this.mission.target : null;
    // y range eases toward the data extents instead of snapping when a
    // sample enters/leaves the window — kills the vertical "jump" rescales
    const tgtMin = Math.min(...data, live, ...(priceTarget !== null ? [priceTarget] : [])) - 2;
    const tgtMax = Math.max(...data, live, ...(priceTarget !== null ? [priceTarget] : [])) + 2;
    if (Number.isNaN(this.graphMin)) {
      this.graphMin = tgtMin;
      this.graphMax = tgtMax;
    } else {
      const k = 1 - Math.exp(-2 * dt);
      this.graphMin = Phaser.Math.Linear(this.graphMin, tgtMin, k);
      this.graphMax = Phaser.Math.Linear(this.graphMax, tgtMax, k);
    }
    // never let the eased range clip the actual data
    const min = Math.min(this.graphMin, tgtMin + 1);
    const max = Math.max(this.graphMax, tgtMax - 1);
    const yOf = (v: number): number => y0 + h - ((v - min) / (max - min)) * h;

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
    const pps = ppsX;
    const dayLen = dayLenX;
    const tEnd = this.elapsedSec;
    const tMin = tEnd - (headX - x0) / pps;
    // right half of the chart is the future — draw upcoming day lines too
    const tMax = tEnd + (x0 + w - headX) / pps;
    let li = 0;
    for (let k = Math.max(0, Math.ceil(tMin / dayLen)); k * dayLen <= tMax && li < this.dayLabels.length; k++) {
      const px = headX - (tEnd - k * dayLen) * pps;
      g.lineStyle(1, PAL.gold, 0.35);
      g.lineBetween(px, y0, px, y0 + h);
      this.dayLabels[li++]
        .setText(`DAY ${k + 1}`)
        .setPosition(Phaser.Math.Clamp(px, x0 + 24, x0 + w - 24), y0 + h - 4)
        .setAlpha(0.95);
    }
    for (; li < this.dayLabels.length; li++) this.dayLabels[li].setAlpha(0);

    // 5-point moving average flattens per-tick jitter so the line reads as a
    // flow, not a zigzag (the head sample stays live via graphPrice below)
    const sm = data.map((_, i) => {
      let sum = 0,
        c = 0;
      for (let j = i - 2; j <= i + 2; j++) {
        if (j < 0 || j >= n) continue;
        sum += data[j];
        c++;
      }
      return sum / c;
    });
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      const px = xOf(i);
      if (px < x0) continue;
      if (!pts.length && i > 0) {
        // clip the segment entering from the left edge
        const f = (x0 - xOf(i - 1)) / step;
        pts.push(new Phaser.Math.Vector2(x0, yOf(Phaser.Math.Linear(sm[i - 1], sm[i], f))));
      }
      pts.push(new Phaser.Math.Vector2(px, yOf(sm[i])));
    }
    if (!pts.length) pts.push(new Phaser.Math.Vector2(x0, yOf(live)));
    pts.push(new Phaser.Math.Vector2(headX, yOf(live)));
    // spline through the samples rounds the corners into a continuous curve
    const curve = pts.length > 2 ? new Phaser.Curves.Spline(pts).getPoints(pts.length * 4) : pts;
    // soft area fill under the line, closed down to the graph floor
    g.fillStyle(PAL.gold, 0.16);
    g.fillPoints(
      [...curve, new Phaser.Math.Vector2(headX, y0 + h), new Phaser.Math.Vector2(curve[0].x, y0 + h)],
      true
    );
    g.lineStyle(3, PAL.gold, 0.9);
    g.strokePoints(curve, false);

    // day-mission price target: dashed line + label; green side = success side
    if (priceTarget !== null) {
      const ty = yOf(priceTarget);
      const below = live < priceTarget;
      const col = below ? PAL.green : PAL.red;
      g.lineStyle(2, col, 0.8);
      for (let px = x0; px < x0 + w - 8; px += 16) g.lineBetween(px, ty, px + 8, ty);
      this.targetLabel
        .setText(`DAY TARGET $${priceTarget}`)
        .setColor(below ? HEX.green : HEX.red)
        .setPosition(x0 + w - 6, Phaser.Math.Clamp(ty - 3, y0 + 16, y0 + h - 4))
        .setAlpha(1);
    } else {
      this.targetLabel.setAlpha(0);
    }
    const tipX = headX;
    const tipY = yOf(live);
    // white by default; green/red only while a big move is fresh
    const flashing = this.priceFlashUntil > this.time.now;
    const tipHex = flashing ? (this.priceFlashDown ? HEX.green : HEX.red) : HEX.cream;
    const tipCol = flashing ? (this.priceFlashDown ? PAL.green : PAL.red) : PAL.cream;
    // dashed-ish guide line at the current price level
    g.lineStyle(1, PAL.gold, 0.25);
    g.lineBetween(x0, tipY, x0 + w, tipY);
    g.fillStyle(tipCol, 1);
    g.fillCircle(tipX, tipY, 5);
    // price tag riding the tip of the line
    this.graphTip
      .setText(`$${Math.round(live)}`)
      .setColor(tipHex)
      .setAlpha(1);
    if (tipX > x0 + w - 72) {
      this.graphTip.setOrigin(1, 0.5).setPosition(tipX - 10, tipY);
    } else {
      this.graphTip.setOrigin(0, 0.5).setPosition(tipX + 10, tipY);
    }
  }
}
