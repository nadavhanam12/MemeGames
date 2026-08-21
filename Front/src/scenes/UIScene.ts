import Phaser from 'phaser';
import { COMMENTS, ENGAGEMENT, FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEADER, HEX, PAL, VIEW } from '../core/palette';
import { settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { MemeContext, MEMES, pickMeme, renderMeme } from '../core/memes';
import { captureAndShare, captureAndShareTo } from '../core/share';
import { addExportButtonRow } from '../core/shareButtons';
import { hasArt } from '../core/art';
import { getUnlockedTemplates } from '../core/memeUnlocks';
import { EASE, confetti, countTo, floatText, popIn, pressPulse } from '../core/juice';
import { staticBlink } from '../core/broadcast';
import { createCommentRow, createEngagementBar, createPostHeader, createSuggestedCard, createTrendingPill } from '../core/feedChrome';
import { DayMission, DaySummary, EV, SessionStats, bus } from '../core/state';
import { TUNING } from '../config/tuning';
import { registerLayout } from '../dev/layout';
import { devState } from '../dev/state';

// Hairline divider color between feed chrome sections — matches feedChrome.ts's
// internal DIVIDER constant (not exported, so duplicated here).
const DIVIDER = 0x2f3336;

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

// Emoji glyph shown on each shop card (feedChrome's createSuggestedCard takes
// a glyph, not a texture key — the old `icon` texture field is unused now).
const UPGRADE_GLYPH: Record<UpgradeDef['key'], string> = { air: '✈️', hull: '🛡️', gold: '💰' };

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

// Feed-native HUD geometry: the game window (VIEW) is the embedded media,
// the ENGAGEMENT row (reply/retweet/like/views/share) sits right below it,
// and everything the old broadcast layout put in a price/graph card + news
// ticker + control strip now stacks inside COMMENTS — a compact price card
// up top, then a scrolling market-ticker caption underneath it.
const M = 16; // outer margin
// price + graph card (also hosts the meme-reaction cutaway) — top of COMMENTS
const PRICE_CARD = { x: M, y: COMMENTS.y + 10, w: GAME_W - 2 * M, h: 190 } as const;
// scrolling market-ticker caption, right under the price card
const TICKER_Y = PRICE_CARD.y + PRICE_CARD.h + 24;

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
  private summaryCashText?: Phaser.GameObjects.Text;
  private summaryNextDay = 2;
  private missionText!: Phaser.GameObjects.Text;
  private headlineQueue: Array<{ text: string; tone: 'good' | 'bad' | 'event'; hold: number }> = [];
  private headlineBusy = false;
  private upgradeLocked: Record<string, boolean> = { air: true, hull: true, gold: true };

  private displayedCredits = 30;
  private headlineText!: Phaser.GameObjects.Text;
  private tickerText!: Phaser.GameObjects.Text;
  private dangerPill?: Phaser.GameObjects.Container;
  private dangerVignette?: Phaser.GameObjects.Image;
  private upgradeLevels: Record<string, number> = { air: 0, hull: 0, gold: 0 };
  private upgradeButtons: Record<string, Phaser.GameObjects.Container> = {};
  private memePopup?: Phaser.GameObjects.Container;
  private memeGen = 0;
  private lastMemeAt = -Infinity;

  // engagement bar (reply=day, retweet=combo, heart=cash, bar-chart=oil
  // "hype", share=static placeholder)
  private engagementBar!: { container: Phaser.GameObjects.Container; setCounts(counts: number[]): void };
  private engagementCounts = [1, 0, 30, 112, 0];
  private currentDay = 1;
  private currentCombo = 0;

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
    this.currentDay = 1;
    this.currentCombo = 0;
    this.engagementCounts = [1, 0, 30, 112, 0];
    this.registry.set('ui-modal', false);

    this.buildChrome();
    this.buildPriceCard();
    this.buildEngagementBar();
    this.buildCommentsTicker();
    this.buildMissionCaption();

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
  /** Feed-native background chrome: dark X/Twitter-style backdrop behind the
   *  whole HUD, a hairline divider under the header + around the embedded
   *  video (VIEW), and the post header (avatar/handle/subtext/LIVE badge). */
  private buildChrome(): void {
    const g = this.add.graphics().setDepth(990);
    g.fillStyle(PAL.ink, 1);
    // Fill everything EXCEPT the VIEW rect — that's GameScene's own camera
    // viewport, rendered underneath; a full-canvas fill here would paint
    // straight over it since UIScene draws on top of GameScene.
    g.fillRect(0, 0, GAME_W, VIEW.y); // above VIEW
    g.fillRect(0, VIEW.y + VIEW.h, GAME_W, GAME_H - (VIEW.y + VIEW.h)); // below VIEW
    g.fillRect(0, VIEW.y, VIEW.x, VIEW.h); // left of VIEW
    g.fillRect(VIEW.x + VIEW.w, VIEW.y, GAME_W - (VIEW.x + VIEW.w), VIEW.h); // right of VIEW
    g.lineStyle(1, DIVIDER, 1);
    g.lineBetween(0, HEADER.h, GAME_W, HEADER.h);
    g.lineStyle(1, DIVIDER, 0.8);
    g.strokeRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);

    const header = createPostHeader(this, {
      x: HEADER.x + 16,
      y: HEADER.h / 2,
      w: HEADER.w - 32,
      handle: "Hormuz Hold'em",
      subtext: '00:00',
      live: true
    }).setDepth(1001);
    // createPostHeader adds [avatar, handle, subtext] then an optional badge —
    // grab the subtext Text ref by its known add-order index so onTimer can
    // keep updating the in-game clock readout through it.
    this.hourText = header.list[2] as Phaser.GameObjects.Text;
  }

  /** Price card: oil price + live graph, restyled as a small dark rounded
   *  card at the top of COMMENTS (the meme cutaway covers it on events). The
   *  graph plotting logic itself is unchanged — only this surrounding frame. */
  private buildPriceCard(): void {
    const group = this.add.container(0, 0).setDepth(1000);
    const cardBg = this.add.graphics();
    cardBg.fillStyle(PAL.black, 1);
    cardBg.fillRoundedRect(PRICE_CARD.x, PRICE_CARD.y, PRICE_CARD.w, PRICE_CARD.h, 14);
    cardBg.lineStyle(2, DIVIDER, 1);
    cardBg.strokeRoundedRect(PRICE_CARD.x, PRICE_CARD.y, PRICE_CARD.w, PRICE_CARD.h, 14);
    group.add(cardBg);

    const oilLabel = this.add.text(PRICE_CARD.x + 14, PRICE_CARD.y + 9, 'OIL — LIVE MARKET', {
      fontFamily: FONT_SANS,
      fontSize: '11px',
      fontStyle: 'bold',
      color: HEX.muted
    });
    const failLabel = this.add
      .text(PRICE_CARD.x + PRICE_CARD.w - 14, PRICE_CARD.y + 9, `LIMIT $${TUNING.session.failPrice}`, {
        fontFamily: FONT_SANS,
        fontSize: '11px',
        fontStyle: 'bold',
        color: HEX.red
      })
      .setOrigin(1, 0);
    const priceCx = PRICE_CARD.x + 66;
    const priceCy = PRICE_CARD.y + 34;
    this.priceBox = this.add.rectangle(priceCx, priceCy, 116, 32, 0x1c1f23).setStrokeStyle(2, DIVIDER);
    this.priceText = this.add
      .text(priceCx, priceCy, '$112', { fontFamily: FONT_DISPLAY, fontSize: '20px', color: HEX.cream })
      .setOrigin(0.5);
    this.priceArrow = this.add
      .text(priceCx + 72, priceCy, '▼', { fontFamily: FONT_SANS, fontSize: '18px', color: HEX.green })
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
    group.add([oilLabel, failLabel, this.priceBox, this.priceText, this.priceArrow, this.graph, this.graphTip, this.targetLabel]);
    group.add(this.yAxisLabels);
    group.add(this.dayLabels);
    registerLayout(this, 'hud-price', group, { x: PRICE_CARD.x, y: PRICE_CARD.y, w: PRICE_CARD.w, h: PRICE_CARD.h });
  }

  /** Bottom control row → engagement bar: reply=day count, retweet=combo,
   *  heart=cash, bar-chart="hype" (live oil price, chosen as a second
   *  trending number distinct from cash), share=static placeholder. */
  private buildEngagementBar(): void {
    this.engagementBar = createEngagementBar(this, {
      x: ENGAGEMENT.x,
      y: ENGAGEMENT.y + ENGAGEMENT.h / 2,
      w: ENGAGEMENT.w,
      icons: [
        { glyph: '💬', count: this.engagementCounts[0] },
        { glyph: '🔁', count: this.engagementCounts[1] },
        { glyph: '❤️', count: this.engagementCounts[2] },
        { glyph: '📊', count: this.engagementCounts[3] },
        { glyph: '↗', count: this.engagementCounts[4] }
      ]
    });
    this.engagementBar.container.setDepth(1000);
  }

  /** Pushes [day, combo, cash, oil-price-hype, 0] into the engagement bar,
   *  skipping the call when nothing actually changed so idle frames don't
   *  spawn redundant count-up tweens. */
  private pushEngagementCounts(): void {
    const next = [this.currentDay, this.currentCombo, Math.round(this.displayedCredits), Math.round(this.displayedPrice), 0];
    if (next.every((v, i) => v === this.engagementCounts[i])) return;
    this.engagementCounts = next;
    this.engagementBar.setCounts(next);
  }

  /** Approximates the engagement bar's heart (cash) icon position, for the
   *  coin-fly landing animation — createEngagementBar doesn't expose
   *  per-icon refs, so this mirrors its internal layout math (5 icons). */
  private heartIconWorldPos(): { x: number; y: number } {
    const slot = ENGAGEMENT.w / 5;
    return { x: ENGAGEMENT.x + slot * 2 + slot / 2, y: ENGAGEMENT.y + ENGAGEMENT.h / 2 - 7 };
  }

  /** Market ticker: a scrolling feed-style caption line under the price
   *  card — the acceptable fallback (per the reskin spec) for the old red
   *  "BREAKING NEWS" band. Headline queue/pump sequencing is unchanged;
   *  only the chrome around it (no box, no red banner) changed. */
  private buildCommentsTicker(): void {
    this.tickerText = this.add
      .text(GAME_W - M, TICKER_Y, TICKER_ITEMS.join('   ·   '), {
        fontFamily: FONT_SANS,
        fontSize: '13px',
        color: HEX.muted
      })
      .setOrigin(0, 0.5)
      .setDepth(1000);
    const maskShape = this.make.graphics({ x: 0, y: 0 }, false);
    maskShape.fillRect(M, TICKER_Y - 14, GAME_W - 2 * M, 28);
    this.tickerText.setMask(maskShape.createGeometryMask());
    this.tweens.add({
      targets: this.tickerText,
      x: -this.tickerText.width,
      duration: settings.reducedMotion ? 60000 : 30000,
      repeat: -1
    });

    this.headlineText = this.add
      .text(M, TICKER_Y, '', { fontFamily: FONT_SANS, fontSize: '15px', fontStyle: 'bold', color: HEX.cream })
      .setOrigin(0, 0.5)
      .setAlpha(0)
      .setDepth(1001);
  }

  /** Builds one upgrade card inside the day-end recap/shop screen, styled as
   *  a feedChrome "suggested for you" card. Cost/level/lock state live in
   *  the card's subtitle text (grabbed by add-order index, since
   *  createSuggestedCard doesn't expose per-field refs), refreshed by
   *  refreshUpgradeCardVisual() whenever credits/level/lock state changes. */
  private buildUpgradeCard(
    parent: Phaser.GameObjects.Container,
    u: UpgradeDef,
    x: number,
    y: number,
    h = 170,
    w = 260
  ): void {
    const card = createSuggestedCard(this, {
      x,
      y,
      w,
      h,
      icon: UPGRADE_GLYPH[u.key],
      title: u.name,
      subtitle: '',
      onClick: () => {
        if (this.upgradeLocked[u.key]) {
          this.tweens.add({ targets: card, x: x - 6, duration: 40, yoyo: true, repeat: 2 });
          sfx.tap();
          return;
        }
        const costs = costsOf(u.key);
        const lvl = this.upgradeLevels[u.key];
        if (lvl >= costs.length) return;
        const price = costs[lvl];
        if (this.displayedCredits < price) {
          this.tweens.add({ targets: card, x: x - 6, duration: 40, yoyo: true, repeat: 2 });
          sfx.tap();
          return;
        }
        pressPulse(this, card);
        bus.emit('buy-upgrade', u.key, price);
      }
    });
    parent.add(card);
    this.upgradeButtons[u.key] = card;
    this.refreshUpgradeCardVisual(u.key);
  }

  /** Re-renders one upgrade card's subtitle (cost/level/lock) + dim state to
   *  match current upgradeLocked/upgradeLevels/displayedCredits. */
  private refreshUpgradeCardVisual(key: UpgradeDef['key']): void {
    const card = this.upgradeButtons[key];
    if (!card || !card.active) return;
    const subtitle = card.list[card.list.length - 1] as Phaser.GameObjects.Text;
    const def = UPGRADES.find(u => u.key === key)!;
    if (this.upgradeLocked[key]) {
      subtitle.setText(`🔒 unlocks day ${TUNING.days.upgradeRevealDays[key]}`).setColor(HEX.muted);
      card.setAlpha(0.6);
      return;
    }
    card.setAlpha(1);
    const costs = costsOf(key);
    const lvl = this.upgradeLevels[key];
    const pips = '●'.repeat(lvl) + '○'.repeat(Math.max(0, costs.length - lvl));
    if (lvl >= costs.length) {
      subtitle.setText(`${def.caption} · MAX ${pips}`).setColor(HEX.green);
      return;
    }
    const price = costs[lvl];
    const affordable = this.displayedCredits >= price;
    subtitle.setText(`${def.caption} · $${price} ${pips}`).setColor(affordable ? HEX.green : HEX.muted);
  }

  // ---------------------------------------------------------------- events
  private onPrice(price: number, delta: number, jitter = false): void {
    const from = this.displayedPrice;
    this.displayedPrice = price;
    if (jitter) {
      // market noise: tick the readout quietly — no arrow, shake, or flash
      this.priceText.setText(`$${Math.round(price)}`);
      this.pushEngagementCounts();
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
      this.priceBox.setStrokeStyle(2, down ? PAL.green : PAL.red);
    }
    if (down) {
      this.tweens.add({ targets: this.priceText, scale: { from: 1.25, to: 1 }, duration: 300, ease: EASE.snap });
    } else {
      this.tweens.add({ targets: this.priceBox, x: { from: 204, to: 198 }, duration: 50, yoyo: true, repeat: 3 });
      this.graphFlash = 1;
    }
    this.pushEngagementCounts();
  }

  private onCredits(credits: number, gain: number, x: number, y: number): void {
    this.displayedCredits = credits;
    this.pushEngagementCounts();
    if (this.summaryCashText?.active) this.summaryCashText.setText(`CASH: $${Math.round(credits)}`);
    const coinsFly = gain > 0 && x > 0 && !settings.reducedMotion;
    if (coinsFly) {
      this.moneyBurst(x, y);
      const target = this.heartIconWorldPos();
      for (let i = 0; i < Math.min(gain, 5); i++) {
        const coin = this.add
          .text(x, y, '$', { fontFamily: FONT_DISPLAY, fontSize: '22px', color: HEX.green })
          .setStroke(HEX.ink, 3)
          .setOrigin(0.5)
          .setDepth(1500)
          .setScale(0);
        this.tweens.add({ targets: coin, scale: 1, delay: i * 100, duration: 130, ease: EASE.pop });
        this.tweens.add({
          targets: coin,
          x: target.x,
          y: target.y,
          delay: i * 100,
          duration: 750,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            coin.destroy();
            sfx.coin();
          }
        });
      }
    }
    this.refreshUpgradeAffordability();
  }

  /** Small green pop where kill money spawns: expanding ring + radial sparks. */
  private moneyBurst(x: number, y: number): void {
    const ring = this.add.circle(x, y, 6).setStrokeStyle(3, PAL.green).setDepth(1499);
    this.tweens.add({
      targets: ring,
      radius: 34,
      alpha: { from: 0.9, to: 0 },
      duration: 280,
      ease: EASE.snap,
      onComplete: () => ring.destroy()
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.6;
      const spark = this.add.circle(x, y, 3, PAL.green).setDepth(1499);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(a) * (22 + Math.random() * 14),
        y: y + Math.sin(a) * (22 + Math.random() * 14),
        scale: 0,
        alpha: { from: 1, to: 0.4 },
        duration: 260 + Math.random() * 120,
        ease: EASE.snap,
        onComplete: () => spark.destroy()
      });
    }
  }

  private refreshUpgradeAffordability(): void {
    for (const u of UPGRADES) this.refreshUpgradeCardVisual(u.key);
  }

  private onUpgradeBought(key: string, level: number): void {
    this.upgradeLevels[key] = level;
    const c = this.upgradeButtons[key];
    if (!c || !c.active) return;
    const def = UPGRADES.find(u => u.key === key)!;
    this.tweens.add({ targets: c, scale: { from: 1.25, to: 1 }, duration: 300, ease: EASE.pop });
    const m = c.getWorldTransformMatrix();
    floatText(this, m.tx, m.ty - 70, `${def.name} LV${level}`, HEX.green, 24);
    floatText(this, m.tx, m.ty - 98, def.desc, HEX.cream, 16);
    this.refreshUpgradeCardVisual(key as UpgradeDef['key']);
  }

  private onCombo(combo: number, milestone?: string): void {
    if (combo > 0) this.nudgeMarket(milestone ? TUNING.market.nudgeMilestone : TUNING.market.nudgeCombo);
    this.currentCombo = combo;
    this.pushEngagementCounts();
    if (milestone) {
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
      .setX(M + 30);
    // headline takes over the ticker line; ticker comes back when the queue drains
    this.tickerText.setAlpha(0);
    this.tweens.add({
      targets: this.headlineText,
      alpha: 1,
      x: M,
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
  /** Mission caption: a plain feed-caption line under the header, above
   *  VIEW — no chip/border, just "day N mission: <text>". */
  private buildMissionCaption(): void {
    const group = this.add.container(0, 0).setDepth(1001);
    this.missionText = this.add.text(HEADER.x + 16, HEADER.h + 10, 'day 1 mission: incoming orders…', {
      fontFamily: FONT_SANS,
      fontSize: '14px',
      color: HEX.muted,
      wordWrap: { width: GAME_W - 32 }
    });
    group.add(this.missionText);
    registerLayout(this, 'hud-mission', group, { x: HEADER.x + 16, y: HEADER.h + 10, w: GAME_W - 32, h: 20 });
  }

  private renderMissionCaption(): void {
    const m = this.mission;
    if (!m) return;
    let suffix = '';
    let color: string = HEX.muted;
    if (m.done) {
      suffix = ' ✓';
      color = HEX.green;
    } else if (m.type === 'price') {
      suffix = ` — now $${Math.round(this.displayedPrice)}`;
    } else if (m.type === 'perfect') {
      if (m.progress > 0) {
        suffix = ' ✗';
        color = HEX.red;
      }
    } else {
      suffix = ` (${Math.min(m.progress, m.target)}/${m.target})`;
    }
    this.missionText.setText(`day ${m.day} mission: ${m.text}${suffix}`).setColor(color);
  }

  private onMission(m: DayMission): void {
    const wasDone = this.mission?.done ?? false;
    this.mission = m;
    this.renderMissionCaption();
    if (m.done && !wasDone && !settings.reducedMotion) {
      this.tweens.add({ targets: this.missionText, scale: { from: 1.15, to: 1 }, duration: 250, ease: EASE.pop });
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
    staticBlink(this, 130); // channel-cut into the recap segment
    const mission = s.missionDone ? `MISSION COMPLETE +$${s.rewardCredits}` : 'MISSION FAILED';
    const delta = s.priceDelta >= 0 ? `+$${s.priceDelta}` : `−$${Math.abs(s.priceDelta)}`;
    this.onHeadline(
      `DAY ${s.day} ENDS — ${mission} · ${s.safe} SAFE, ${s.lost} LOST · OIL $${s.price} (${delta})`,
      s.missionDone ? 'good' : 'bad',
      3600
    );
    for (const warn of s.warnings) this.onHeadline(warn, 'event', 2600);
    if (!s.missionDone) this.graphFlash = 1;
    this.showDayCompletePanel(s.day, () => {
      if (s.newMemesUnlocked.length) {
        this.showNewUnlocksPopup(s.newMemesUnlocked, () => this.showDaySummaryPanel(s));
      } else {
        this.showDaySummaryPanel(s);
      }
    });
  }

  /** Fades a modal container out (quick shrink + alpha), destroys it, then
   *  chains into the next step of the day-end flow. Instant under reduced motion. */
  private fadeOutModal(c: Phaser.GameObjects.Container, onDone: () => void): void {
    if (settings.reducedMotion) {
      c.destroy();
      onDone();
      return;
    }
    this.tweens.add({
      targets: c,
      alpha: 0,
      scaleX: 0.92,
      scaleY: 0.92,
      duration: 180,
      ease: EASE.pop,
      onComplete: () => {
        c.destroy();
        onDone();
      }
    });
  }

  /** Brief "DAY X COMPLETED!" splash shown the moment a day ends, before the
   *  meme-unlocks popup / recap+shop panel. Auto-advances; tap to skip early. */
  private showDayCompletePanel(day: number, onDone: () => void): void {
    this.registry.set('ui-modal', true);
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const c = this.add.container(cx, cy).setDepth(1800);
    c.add(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.7));
    const panel = this.add.container(0, 0);
    c.add(panel);
    panel.add(this.add.rectangle(0, 0, 560, 200, PAL.black, 0.97).setStrokeStyle(2, DIVIDER));
    panel.add(
      this.add
        .text(0, -30, `DAY ${day} COMPLETED!`, { fontFamily: FONT_DISPLAY, fontSize: '40px', color: HEX.gold })
        .setOrigin(0.5)
    );
    panel.add(
      this.add
        .text(0, 30, 'WELL DONE', { fontFamily: FONT_DISPLAY, fontSize: '24px', color: HEX.cream })
        .setOrigin(0.5)
    );
    popIn(this, panel, 250);
    sfx.fanfare();

    c.setSize(GAME_W, GAME_H);
    c.setInteractive({ useHandCursor: true });
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      this.fadeOutModal(c, onDone);
    };
    c.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      sfx.tap();
      dismiss();
    });
    const holdMs = import.meta.env.DEV && devState.autoPlay === 'full' ? 900 / devState.speedMultiplier : 1600;
    this.time.delayedCall(holdMs, dismiss);
  }

  /** Interstitial shown before the day-end shop panel when at least one meme
   *  template fired for the first time ever today. Tap anywhere to continue.
   *  New unlocks render as a stack of feed comment rows ("🔓 unlocked ·
   *  <meme name>") instead of a thumbnail grid — no tap-to-zoom here; the
   *  full gallery/day-summary thumbnails still support that. */
  private showNewUnlocksPopup(ids: string[], onDone: () => void): void {
    this.registry.set('ui-modal', true);
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const c = this.add.container(cx, cy).setDepth(1800);
    c.add(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.8));
    const panel = this.add.container(0, 0);
    c.add(panel);

    const shown = ids.slice(0, 6);
    const rowH = 32;
    const panelW = 560;
    const panelH = 130 + shown.length * rowH + (ids.length > shown.length ? 22 : 0);
    panel.add(this.add.rectangle(0, 0, panelW, panelH, PAL.black, 0.97).setStrokeStyle(2, DIVIDER));
    panel.add(
      this.add
        .text(0, -panelH / 2 + 32, '🎉 new memes unlocked', { fontFamily: FONT_DISPLAY, fontSize: '24px', color: HEX.gold })
        .setOrigin(0.5)
    );

    let rowY = -panelH / 2 + 70;
    shown.forEach(id => {
      const tpl = MEMES.templates[id];
      panel.add(
        createCommentRow(this, {
          x: -panelW / 2 + 24,
          y: rowY,
          w: panelW - 48,
          avatarColor: PAL.gold,
          handle: '🔓 unlocked',
          text: tpl?.label ?? id
        })
      );
      rowY += rowH;
    });
    if (ids.length > shown.length) {
      panel.add(
        this.add
          .text(0, rowY, `+${ids.length - shown.length} more`, {
            fontFamily: FONT_SANS,
            fontSize: '14px',
            fontStyle: 'bold',
            color: HEX.muted
          })
          .setOrigin(0.5)
      );
      rowY += 22;
    }
    panel.add(
      this.add
        .text(0, panelH / 2 - 20, 'tap anywhere to continue', { fontFamily: FONT_SANS, fontSize: '13px', color: HEX.muted })
        .setOrigin(0.5)
    );

    popIn(this, panel, 250);
    sfx.fanfare();
    confetti(this, cx, cy - 60, 20);

    c.setSize(GAME_W, GAME_H);
    c.setInteractive({ useHandCursor: true });
    let dismissed = false;
    // grace period: ignore the opening tap so a held-down shoot input from the
    // instant the day ended can't dismiss this before the player sees it
    let canDismiss = false;
    this.time.delayedCall(500, () => { canDismiss = true; });
    const dismiss = () => {
      if (dismissed || !canDismiss) return;
      dismissed = true;
      sfx.tap();
      this.fadeOutModal(c, onDone);
    };
    c.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      dismiss();
    });
    // full autoplay reads the popup like a player would, then moves on itself
    if (import.meta.env.DEV && devState.autoPlay === 'full') {
      this.time.delayedCall(900 / devState.speedMultiplier, dismiss);
    }
  }

  /** Full-screen zoom for one just-unlocked template, same presentation as the
   *  gallery's zoom view. Added as a child of the popup container so it dies
   *  with it; tapping it closes only the zoom, returning to the popup. */
  private showFocusedUnlock(popup: Phaser.GameObjects.Container, id: string): void {
    const tpl = MEMES.templates[id];
    if (!tpl) return;

    const layer = this.add.container(0, 0);
    popup.add(layer);
    layer.add(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.85));

    if (settings.reducedMotion) {
      layer.setAlpha(0);
      this.tweens.add({ targets: layer, alpha: 1, duration: 150 });
    } else {
      layer.setScale(0.85).setAlpha(0);
      this.tweens.add({ targets: layer, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    }

    const maxW = 620;
    const maxH = 520;
    let w = maxW;
    let h = w * tpl.aspect;
    if (h > maxH) {
      h = maxH;
      w = h / tpl.aspect;
    }

    layer.add(this.add.rectangle(0, -30, w + 24, h + 24, PAL.ink).setStrokeStyle(5, PAL.gold));
    if (hasArt(this, tpl.artKey)) {
      layer.add(this.add.image(0, -30, tpl.artKey).setDisplaySize(w, h));
    } else {
      layer.add(this.add.rectangle(0, -30, w, h, 0xf2f2f2));
      layer.add(
        this.add.text(0, -30, tpl.label, { fontFamily: FONT_SANS, fontSize: '16px', color: '#9aa4ad' }).setOrigin(0.5)
      );
    }
    // "✓ UNLOCKED" / "TAP TO CLOSE" are hidden here to give the share block
    // below the frame more room — the share buttons are the point of this screen.

    // SAVE downloads the framed art rect as a watermarked PNG; the platform
    // buttons download it too, then open that platform's share-compose
    // window/app with a caption + link prefilled (see share.ts — no web API
    // lets a page attach the image directly into WhatsApp/X/Facebook).
    const frameRect = () => {
      // the layer sits inside a (possibly nested) popup container — resolve
      // its world-space origin instead of assuming a centered parent
      const m = layer.getWorldTransformMatrix();
      const frameW = w + 24;
      const frameH = h + 24;
      return { x: m.tx - frameW / 2, y: m.ty - 30 - frameH / 2, w: frameW, h: frameH };
    };
    addExportButtonRow(
      this,
      layer,
      h / 2 + 10,
      () =>
        void captureAndShare(this.game, frameRect(), `hormuz-meme-${id}.png`, "Just unlocked in HORMUZ HOLD'EM", 'unlock_zoom', 'download'),
      platform =>
        void captureAndShareTo(this.game, frameRect(), `hormuz-meme-${id}.png`, "Just unlocked in HORMUZ HOLD'EM", 'unlock_zoom', platform)
    );

    layer.setSize(GAME_W, GAME_H);
    layer.setInteractive({ useHandCursor: true });
    // pointerdown + stopPropagation: consumed before it can reach the thumbs
    // or the popup's own dismiss listener underneath.
    layer.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      sfx.tap();
      if (settings.reducedMotion) {
        layer.destroy();
      } else {
        this.tweens.add({
          targets: layer,
          scale: 0.85,
          alpha: 0,
          duration: 150,
          ease: 'Back.easeIn',
          onComplete: () => layer.destroy()
        });
      }
    });
  }

  /** One bordered, labeled group inside the day-end recap (mission / report / intel).
   *  Renders a header + stacked lines sized to their content and returns the group's height. */
  private buildSummaryCard(
    parent: Phaser.GameObjects.Container,
    y: number,
    width: number,
    header: string,
    lines: { text: string; color: string; size?: string }[],
    accent: number
  ): number {
    const padTop = 20;
    const lineH = 18;
    const padBottom = 8;
    const h = padTop + lines.length * lineH + padBottom;
    const card = this.add.container(0, y + h / 2);
    card.add(this.add.rectangle(0, 0, width, h, 0x22303e, 0.9).setStrokeStyle(3, accent, 0.85));
    card.add(
      this.add
        .text(-width / 2 + 18, -h / 2 + 15, header, {
          fontFamily: FONT_SANS,
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#AAB4BD'
        })
        .setOrigin(0, 0.5)
    );
    lines.forEach((ln, i) => {
      card.add(
        this.add
          .text(0, -h / 2 + padTop + i * lineH, ln.text, {
            fontFamily: FONT_SANS,
            fontSize: ln.size ?? '15px',
            fontStyle: 'bold',
            color: ln.color,
            align: 'center',
            wordWrap: { width: width - 40 }
          })
          .setOrigin(0.5)
      );
    });
    parent.add(card);
    popIn(this, card, 220);
    return h;
  }

  /** Day-end recap card for the meme collection: thumbnails of every template
   *  that fired today (new unlocks or repeats) plus the overall gallery tally.
   *  Returns the card's height. */
  private buildMemesCard(
    parent: Phaser.GameObjects.Container,
    y: number,
    width: number,
    todayIds: string[]
  ): number {
    const shown = todayIds.filter(id => MEMES.templates[id]).slice(0, 8);
    const thumbH = shown.length ? 64 : 0;
    const h = 20 + thumbH + (shown.length ? 8 : 0) + 20 + 8;
    const card = this.add.container(0, y + h / 2);
    card.add(this.add.rectangle(0, 0, width, h, 0x22303e, 0.9).setStrokeStyle(3, PAL.gold, 0.85));
    card.add(
      this.add
        .text(-width / 2 + 18, -h / 2 + 15, 'MEMES', {
          fontFamily: FONT_SANS,
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#AAB4BD'
        })
        .setOrigin(0, 0.5)
    );
    if (shown.length) {
      const gap = 12;
      const widths = shown.map(id => Math.max(36, Math.round(thumbH / MEMES.templates[id].aspect)));
      const rowW = widths.reduce((a, b) => a + b + gap, -gap);
      let x = -rowW / 2;
      const rowY = -h / 2 + 20 + thumbH / 2;
      shown.forEach((id, i) => {
        const tpl = MEMES.templates[id];
        const w = widths[i];
        const thumb = this.add.container(x + w / 2, rowY);
        if (hasArt(this, tpl.artKey)) {
          thumb.add(this.add.image(0, 0, tpl.artKey).setDisplaySize(w, thumbH));
        } else {
          thumb.add(this.add.rectangle(0, 0, w, thumbH, 0x39424e));
        }
        thumb.add(this.add.rectangle(0, 0, w, thumbH).setStrokeStyle(2, PAL.gold));
        thumb.setSize(w, thumbH);
        thumb.setInteractive({ useHandCursor: true });
        thumb.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
          ev.stopPropagation();
          sfx.tap();
          this.showFocusedUnlock(parent, id);
        });
        card.add(thumb);
        x += w + gap;
      });
    }
    const total = Object.keys(MEMES.templates).length;
    const unlocked = getUnlockedTemplates().size;
    const tallyText = shown.length
      ? `${todayIds.length} TODAY · COLLECTION: ${unlocked}/${total}`
      : `NO MEMES TODAY · COLLECTION: ${unlocked}/${total}`;
    card.add(
      this.add
        .text(0, h / 2 - 16, tallyText, {
          fontFamily: FONT_SANS,
          fontSize: '14px',
          fontStyle: 'bold',
          color: shown.length ? HEX.gold : HEX.cream
        })
        .setOrigin(0.5)
    );
    parent.add(card);
    popIn(this, card, 220);
    return h;
  }

  /** Frozen-world recap + shop screen, covering 80% of the game window; the only
   *  time upgrades are purchasable. Waits for the player to click NEXT DAY. */
  private showDaySummaryPanel(s: DaySummary): void {
    this.summaryPanel?.destroy();
    this.upgradeButtons = {};
    this.summaryNextDay = s.day + 1;
    const W = GAME_W * 0.8;
    const H = GAME_H * 0.8;
    const panel = this.add.container(GAME_W / 2, GAME_H / 2).setDepth(1700);
    this.summaryPanel = panel;
    this.registry.set('ui-modal', true);
    const bg = this.add.rectangle(0, 0, W, H, PAL.black, 0.97).setStrokeStyle(2, DIVIDER);
    panel.add(bg);
    let y = -H / 2 + 20;
    panel.add(
      this.add
        .text(0, y + 24, `DAY ${s.day} COMPLETE`, { fontFamily: FONT_DISPLAY, fontSize: '32px', color: HEX.gold })
        .setOrigin(0.5)
    );
    y += 56;

    const cardW = W - 80;
    // section 1 — mission outcome
    y += this.buildSummaryCard(panel, y, cardW, 'MISSION', [
      {
        text: s.missionDone ? `✓ ${s.missionText}` : `✗ ${s.missionText}`,
        color: s.missionDone ? HEX.green : HEX.red,
        size: '18px'
      },
      {
        text: s.missionDone ? `BONUS PAID: +$${s.rewardCredits}` : 'NO BONUS TODAY',
        color: s.missionDone ? HEX.green : '#AAB4BD',
        size: '14px'
      }
    ], s.missionDone ? PAL.green : PAL.red);
    y += 8;

    // section 2 — memes: every template that fired today + overall collection tally
    y += this.buildMemesCard(panel, y, cardW, s.memesToday);
    y += 8;

    // section 3 — intel (warnings), only when there's something to show
    const intelLines: { text: string; color: string; size?: string }[] = s.warnings.map(w => ({
      text: `⚠ ${w}`,
      color: '#F2D8FF',
      size: '13px'
    }));
    if (intelLines.length) {
      y += this.buildSummaryCard(panel, y, cardW, 'INTEL', intelLines, PAL.purple);
    }
    y += 10;

    // shop — the only window in which upgrades can be bought; sits below whatever
    // the recap cards above needed, so a long warnings list can never overlap it
    const upgradeCardH = 150;
    // live cash readout right above the shop; onCredits keeps it current on buys
    this.summaryCashText = this.add
      .text(0, y + 12, `CASH: $${Math.round(this.displayedCredits)}`, {
        fontFamily: FONT_DISPLAY,
        fontSize: '24px',
        color: HEX.gold
      })
      .setOrigin(0.5);
    panel.add(this.summaryCashText);
    y += 34;
    const upgradesHeaderY = y + 10;
    panel.add(
      this.add
        .text(0, upgradesHeaderY, 'UPGRADES', { fontFamily: FONT_DISPLAY, fontSize: '22px', color: HEX.gold })
        .setOrigin(0.5)
    );
    const upgradeCardsY = upgradesHeaderY + 20 + upgradeCardH / 2;
    // 3 cards side by side must fit the narrower portrait panel (cardW≈496)
    // instead of the old landscape spacing — narrower cards, tighter gap
    const upgradeCardW = 150;
    const upgradeCardGap = 13;
    const upgradeCardStep = upgradeCardW + upgradeCardGap;
    UPGRADES.forEach((u, i) =>
      this.buildUpgradeCard(panel, u, (i - 1) * upgradeCardStep, upgradeCardsY, upgradeCardH, upgradeCardW)
    );

    const nextBtnY = Math.max(H / 2 - 40, upgradeCardsY + upgradeCardH / 2 + 30);
    // grow the backdrop to fit however far the content ran, and re-center on screen
    const bgH = Math.max(H, nextBtnY + 29 + 24 - (-H / 2));
    if (bgH > H) {
      bg.setSize(W, bgH);
      bg.setPosition(0, -H / 2 + bgH / 2);
      panel.setY(GAME_H / 2 - bg.y);
    }
    const nextBtn = this.add.container(0, nextBtnY);
    const nextBtnBg = this.add.graphics();
    nextBtnBg.fillStyle(PAL.black, 1);
    nextBtnBg.fillRoundedRect(-150, -29, 300, 58, 16);
    nextBtnBg.lineStyle(2, DIVIDER, 1);
    nextBtnBg.strokeRoundedRect(-150, -29, 300, 58, 16);
    const nextBtnText = this.add
      .text(0, 0, `NEXT DAY — DAY ${this.summaryNextDay} ▶`, {
        fontFamily: FONT_DISPLAY,
        fontSize: '20px',
        color: HEX.cream
      })
      .setOrigin(0.5);
    nextBtn.add([nextBtnBg, nextBtnText]);
    nextBtn.setSize(300, 58);
    nextBtn.setInteractive({ useHandCursor: true });
    nextBtn.on('pointerover', () => this.tweens.add({ targets: nextBtn, scale: 1.05, duration: 100 }));
    nextBtn.on('pointerout', () => this.tweens.add({ targets: nextBtn, scale: 1, duration: 100 }));
    const advanceToNextDay = () => {
      nextBtn.disableInteractive();
      pressPulse(this, nextBtn);
      sfx.tap();
      staticBlink(this, 130); // channel-cut back to the live feed
      bus.emit(EV.NEXT_DAY_REQUEST);
    };
    nextBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      advanceToNextDay();
    });
    if (!settings.reducedMotion) {
      this.tweens.add({ targets: nextBtn, scale: 1.04, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    panel.add(nextBtn);
    popIn(this, panel, 250);
    this.refreshUpgradeAffordability();

    // full autoplay: spend whatever's affordable, then click through itself
    if (import.meta.env.DEV && devState.autoPlay === 'full') {
      this.time.delayedCall(500 / devState.speedMultiplier, () => {
        if (this.summaryPanel !== panel) return; // already advanced elsewhere
        this.devAutoSpendCredits();
        advanceToNextDay();
      });
    }
  }

  /** Full autoplay: buys the cheapest affordable unlocked upgrade, repeatedly,
   *  until nothing is left to afford — mirrors tapping the shop cards by hand. */
  private devAutoSpendCredits(): void {
    for (let guard = 0; guard < 20; guard++) {
      const affordable = UPGRADES.filter(u => {
        if (this.upgradeLocked[u.key]) return false;
        const costs = costsOf(u.key);
        const lvl = this.upgradeLevels[u.key];
        return lvl < costs.length && this.displayedCredits >= costs[lvl];
      }).sort((a, b) => costsOf(a.key)[this.upgradeLevels[a.key]] - costsOf(b.key)[this.upgradeLevels[b.key]]);
      if (!affordable.length) return;
      const u = affordable[0];
      const price = costsOf(u.key)[this.upgradeLevels[u.key]];
      bus.emit('buy-upgrade', u.key, price);
    }
  }

  private onDayBreak(_remaining: null): void {
    const panel = this.summaryPanel;
    this.summaryPanel = undefined;
    this.upgradeButtons = {};
    this.registry.set('ui-modal', false);
    if (!panel) return;
    if (settings.reducedMotion) {
      panel.destroy();
      return;
    }
    this.tweens.add({
      targets: panel,
      scaleX: 0.85,
      scaleY: 0.85,
      alpha: 0,
      duration: 200,
      ease: EASE.pop,
      onComplete: () => panel.destroy()
    });
  }

  private onUpgradeReveal(key: string): void {
    this.upgradeLocked[key] = false;
    const c = this.upgradeButtons[key];
    if (!c || !c.active) return;
    this.tweens.add({ targets: c, scale: { from: 1.2, to: 1 }, duration: 300, ease: EASE.pop });
    this.refreshUpgradeCardVisual(key as UpgradeDef['key']);
  }

  /** Silent no-ops: both fed the polymarket-style card removed in this
   *  reskin (items 4/7). Bus wiring stays registered per the reskin's
   *  event-wiring-unchanged rule — the handlers just have nothing left to do. */
  private nudgeMarket(_delta: number): void {}
  private onEventProb(_label: string, _prob: number, _active: boolean): void {}

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
    // back-to-back moments don't turn the feed into a meme channel
    if (!force && this.time.now - this.lastMemeAt < MEMES.settings.minGapMs) return;
    this.lastMemeAt = this.time.now;
    // ticker caption announces the cutaway for as long as it runs
    const cutawayMs = MEMES.settings.countdownTickMs * 3 + MEMES.settings.durationMs;
    this.onHeadline('MEME BREAK • MEME BREAK • MEME BREAK', 'event', cutawayMs);
    const gen = ++this.memeGen; // cancels any countdown/popup still running
    this.memePopup?.destroy();
    this.memePopup = undefined;

    const tick = settings.reducedMotion ? 260 : MEMES.settings.countdownTickMs;
    // tilted "photo card" floating over VIEW, clear of the price card below
    const popW = 320;
    const popH = 300;
    const rotationDeg = Phaser.Math.RND.pick([-4, -3, 3, 4]);
    const pop = this.add
      .container(VIEW.x + VIEW.w / 2, VIEW.y + VIEW.h / 2)
      .setDepth(1200)
      .setRotation(Phaser.Math.DegToRad(rotationDeg));
    this.memePopup = pop;

    const cardBg = this.add.graphics();
    cardBg.fillStyle(PAL.cream, 1);
    cardBg.fillRoundedRect(-popW / 2, -popH / 2, popW, popH, 16);
    pop.add(cardBg);
    const captionText = this.add
      .text(0, popH / 2 - 26, '', {
        fontFamily: FONT_SANS,
        fontSize: '13px',
        fontStyle: 'bold',
        color: HEX.ink,
        align: 'center',
        wordWrap: { width: popW - 30 }
      })
      .setOrigin(0.5);
    pop.add(captionText);

    // -- countdown teaser
    const cd = this.add.container(0, -20);
    pop.add(cd);
    cd.add(
      this.add
        .text(0, -46, 'meme update in', {
          fontFamily: FONT_SANS,
          fontSize: '15px',
          fontStyle: 'bold',
          color: HEX.ink
        })
        .setOrigin(0.5)
    );
    const num = this.add
      .text(0, 18, '3', { fontFamily: FONT_DISPLAY, fontSize: '64px', color: HEX.ink })
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
      const pick = pickMeme(label, ctx);
      // first-time-ever unlocks get their full celebration at day end, not
      // mid-day — during play a new template just swaps the caption below.
      captionText.setText(pick.isNew ? 'NEW MEME UNLOCKED!' : pick.captions[0] ?? '');
      const inner = this.add.container(0, -20);
      pop.add(inner);
      renderMeme(this, inner, pick, popW - 40, popH - 90);
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
    this.currentDay = Math.floor(elapsed / dayLen) + 1;
    // broadcast clock: the day maps to a 24h cycle, ticking hour by hour
    const hour = Math.min(23, Math.floor(((elapsed % dayLen) / dayLen) * 24));
    this.hourText.setText(`${hour.toString().padStart(2, '0')}:00`);
    this.pushEngagementCounts();
  }

  private onDanger(remaining: number | null): void {
    if (remaining === null) {
      this.dangerPill?.destroy();
      this.dangerPill = undefined;
      if (this.dangerVignette) {
        this.tweens.add({ targets: this.dangerVignette, alpha: 0, duration: 400 });
      }
      return;
    }
    // red vignette that closes in as the countdown runs out — danger you feel
    // at the edges of the screen without reading the banner
    if (!this.dangerVignette) {
      if (!this.textures.exists('vignetteGen')) {
        const c = this.textures.createCanvas('vignetteGen', 320, 180);
        if (c) {
          const cx = c.getContext();
          const grad = cx.createRadialGradient(160, 90, 55, 160, 90, 185);
          grad.addColorStop(0, 'rgba(230,72,61,0)');
          grad.addColorStop(1, 'rgba(230,72,61,0.9)');
          cx.fillStyle = grad;
          cx.fillRect(0, 0, 320, 180);
          c.refresh();
        }
      }
      this.dangerVignette = this.add
        .image(VIEW.x + VIEW.w / 2, VIEW.y + VIEW.h / 2, 'vignetteGen')
        .setDisplaySize(VIEW.w, VIEW.h)
        .setDepth(1600)
        .setAlpha(0);
    }
    this.tweens.killTweensOf(this.dangerVignette);
    const closeness = 1 - remaining / TUNING.session.failSeconds;
    const pulse = settings.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(this.time.now / 130);
    this.dangerVignette.setAlpha(TUNING.juice.vignetteMaxAlpha * (0.4 + 0.6 * closeness) * pulse);
    // trending pill, recreated each tick to update its countdown text —
    // simpler than reaching into feedChrome's container internals
    this.dangerPill?.destroy();
    this.dangerPill = createTrendingPill(this, {
      x: VIEW.x + VIEW.w / 2,
      y: VIEW.y + 36,
      text: `⚠ meltdown in ${remaining.toFixed(1)}s`,
      urgent: true
    }).setDepth(1650);
  }

  // ---------------------------------------------------------------- loop
  update(_t: number, dtMs: number): void {
    const dt = dtMs / 1000;
    const stats = this.registry.get('finalStats') as SessionStats | undefined;
    const hist = (this.scene.get('Game') as any)?.stats?.priceHistory ?? stats?.priceHistory ?? this.history;
    // graph head glides toward the live price instead of snapping each tick
    this.graphPrice = Phaser.Math.Linear(this.graphPrice, this.displayedPrice, 1 - Math.exp(-3.5 * dt));
    // big-move color flash expired → back to the neutral white/gold look
    if (this.priceFlashUntil && this.time.now > this.priceFlashUntil) {
      this.priceFlashUntil = 0;
      this.priceText.setColor(HEX.cream);
      this.priceBox.setStrokeStyle(2, DIVIDER);
    }
    this.drawGraph(hist, dt);
    if (this.graphFlash > 0) this.graphFlash = Math.max(0, this.graphFlash - dt * 2);
    // price missions read off the live price, so the caption tracks it each frame
    if (this.mission?.type === 'price' && !this.mission.done) this.renderMissionCaption();
  }

  private drawGraph(hist: number[], dt: number): void {
    const g = this.graph;
    g.clear();
    // fills the price/graph card below the price readout row
    const x0 = PRICE_CARD.x + 16,
      y0 = PRICE_CARD.y + 50,
      w = PRICE_CARD.w - 32,
      h = PRICE_CARD.y + PRICE_CARD.h - 8 - (PRICE_CARD.y + 50);
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
