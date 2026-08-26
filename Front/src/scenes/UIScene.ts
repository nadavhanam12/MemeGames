import Phaser from 'phaser';
import { COMMENTS, ENGAGEMENT, FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEADER, HEX, PAL, VIEW } from '../core/palette';
import { settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { MemeContext, MEMES, MemePick, pickMeme, renderMeme } from '../core/memes';
import { captureAndShare, captureAndShareTo } from '../core/share';
import { addExportButtonRow } from '../core/shareButtons';
import { hasArt } from '../core/art';
import { getUnlockedTemplates } from '../core/memeUnlocks';
import { EASE, confetti, countTo, floatText, popIn, pressPulse } from '../core/juice';
import { createCommentRow, createEngagementBar, createPostHeader, createSuggestedCard, createTrendingPill } from '../core/feedChrome';
import { ENGAGEMENT_ICON_KEYS } from '../core/engagementIcons';
import { DayMission, DaySummary, EV, SessionStats, bus } from '../core/state';
import { dayPerfScore, repercussionHeadline, repercussionSubhead } from '../core/repercussions';
import { TUNING } from '../config/tuning';
import {
  TOWER_GLYPH,
  TOWER_NAME,
  TowerStateEntry,
  towerBuildCost,
  towerMaxLevel,
  towerRefund,
  towerUpgradeCost
} from '../core/towers';
import { DecisionEvent, DecisionOption, chooseDecision, getPendingDecision } from '../core/decisions';
import { registerLayout } from '../dev/layout';
import { devState } from '../dev/state';

// Hairline divider color between feed chrome sections — matches feedChrome.ts's
// internal DIVIDER constant (not exported, so duplicated here).
const DIVIDER = 0x26323d;
const PANEL = 0x101820;

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
  // day-end feed-scroll curtain: a frozen gameplay snapshot + 1-2 filler
  // "feed" cards that scroll up and off, revealing the (already fully built,
  // already-resting) day-summary panel underneath — see enterDaySummary().
  // token guards against a stale async snapshot capture landing after the
  // day has already advanced again.
  private feedCurtain?: Phaser.GameObjects.Container;
  private dayEndToken = 0;
  // curtain slot the player is currently viewing, and whether it accepts a
  // swipe-up/CONTINUE input right now (false mid-transition, and false on
  // the collect slot until its own animation finishes and auto-advances)
  private curtainIndex = 0;
  private curtainSlotCount = 0;
  private curtainReady = false;
  private curtainBaseY = 0;
  private curtainAdvance?: () => void;
  // day-break decision interstitial (see showDecisionScreen)
  private decisionOverlay?: Phaser.GameObjects.Container;
  private decisionChosen = false;
  // feed-scroll swipe-to-dismiss on the day summary: finalY is the panel's
  // resting position (drag offsets it from there), ready gates swipes until
  // the entrance beat (stamp + slide-in) has actually finished
  private summaryPanelFinalY = 0;
  private summaryPanelReady = false;
  private swipeStartX: number | null = null;
  private swipeStartY: number | null = null;
  private missionText!: Phaser.GameObjects.Text;
  private missionLabel!: Phaser.GameObjects.Text;
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
  private lastMemeAt = -Infinity;
  // in-play meme banner: every meme fire queues here and plays one at a time
  // over the ENGAGEMENT icon row, but only while the water is clear of live
  // threats (see tryShowUnlockBanner); first-ever unlocks get a gold
  // "NEW MEME UNLOCKED" title
  private unlockBannerQueue: MemePick[] = [];
  private unlockBanner?: Phaser.GameObjects.Container;

  // SEA TURRETS shop card (a 4th card in the TACTICAL UPGRADES row) + the
  // placement overlay it opens: the summary panel hides, GameScene fades the
  // world in with tappable slot markers ('defense-map-open'), and this scene
  // floats an instruction pill + DONE button over the view. Tower state
  // comes from the registry ('towerState', published by GameScene).
  private defenseCard?: Phaser.GameObjects.Container;
  private placementOpen = false;
  private placementUI?: Phaser.GameObjects.Container;
  private placementPill?: Phaser.GameObjects.Text;
  private towerPopup?: Phaser.GameObjects.Container;
  private towerPopupSlot: number | null = null;

  // engagement bar (reply=day, retweet=combo, heart=cash, bar-chart=oil
  // "hype", share=viral growth — see shareCount/dayShareStart/dayShareTarget)
  private engagementBar!: { container: Phaser.GameObjects.Container; setCounts(counts: number[]): void };
  private engagementCounts = [1, 0, 30, 112, 0];
  private currentDay = 1;
  private currentCombo = 0;
  // share count climbs across each day like a post going viral: dayShareStart
  // is its value when the day began, dayShareTarget is how much it grows by
  // day's end (rolled in onDayEnd from that day's performance, applied to the
  // day that follows), eased in by onTimer's elapsed-in-day fraction.
  private shareCount = 0;
  private dayShareStart = 0;
  private dayShareTarget = (TUNING.social.shareGrowthMin + TUNING.social.shareGrowthMax) / 2;

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
    this.shareCount = 0;
    this.dayShareStart = 0;
    this.dayShareTarget = Phaser.Math.Between(TUNING.social.shareGrowthMin, TUNING.social.shareGrowthMax);
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
    bus.on('towers-changed', this.onTowersChanged, this);
    bus.on('meme-moment', this.showMemeReaction, this);
    bus.on(EV.DEV_FORCE_MEME, this.onDevForceMeme, this);
    this.input.on('pointerdown', this.onSwipePointerDown, this);
    this.input.on('pointermove', this.onSwipePointerMove, this);
    this.input.on('pointerup', this.onSwipePointerUp, this);

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
      bus.off('towers-changed', this.onTowersChanged, this);
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
    g.fillStyle(PAL.navy, 1);
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
    g.lineStyle(2, PAL.gold, 0.75);
    g.lineBetween(24, 2, GAME_W - 24, 2);

    const header = createPostHeader(this, {
      x: HEADER.x + 16,
      y: HEADER.h / 2,
      w: HEADER.w - 32,
      handle: "Hormuz Hold'em",
      subtext: '00:00 · STRAIT COMMAND',
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
    cardBg.fillStyle(PANEL, 1);
    cardBg.fillRoundedRect(PRICE_CARD.x, PRICE_CARD.y, PRICE_CARD.w, PRICE_CARD.h, 14);
    cardBg.lineStyle(1, DIVIDER, 1);
    cardBg.strokeRoundedRect(PRICE_CARD.x, PRICE_CARD.y, PRICE_CARD.w, PRICE_CARD.h, 14);
    cardBg.fillStyle(PAL.gold, 0.8);
    cardBg.fillRoundedRect(PRICE_CARD.x + 14, PRICE_CARD.y, 96, 3, 2);
    group.add(cardBg);

    const oilLabel = this.add.text(PRICE_CARD.x + 14, PRICE_CARD.y + 9, 'MARKET / BRENT OIL', {
      fontFamily: FONT_SANS,
      fontSize: '11px',
      fontStyle: 'bold',
      color: HEX.gold,
      letterSpacing: 1
    });
    const failLabel = this.add
      .text(PRICE_CARD.x + PRICE_CARD.w - 14, PRICE_CARD.y + 9, `MELTDOWN  $${TUNING.session.failPrice}`, {
        fontFamily: FONT_SANS,
        fontSize: '11px',
        fontStyle: 'bold',
        color: HEX.red
      })
      .setOrigin(1, 0);
    const priceCx = PRICE_CARD.x + 66;
    const priceCy = PRICE_CARD.y + 34;
    this.priceBox = this.add.rectangle(priceCx, priceCy, 116, 32, 0x0b1117).setStrokeStyle(1, PAL.gold, 0.55);
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
   *  trending number distinct from cash), share=viral growth (shareCount). */
  private buildEngagementBar(): void {
    this.engagementBar = createEngagementBar(this, {
      x: ENGAGEMENT.x,
      y: ENGAGEMENT.y + ENGAGEMENT.h / 2,
      w: ENGAGEMENT.w,
      icons: [
        { textureKey: ENGAGEMENT_ICON_KEYS.reply, count: this.engagementCounts[0], color: PAL.gold },
        { textureKey: ENGAGEMENT_ICON_KEYS.retweet, count: this.engagementCounts[1], color: PAL.purple },
        { textureKey: ENGAGEMENT_ICON_KEYS.heart, count: this.engagementCounts[2], color: PAL.green },
        { textureKey: ENGAGEMENT_ICON_KEYS.analytics, count: this.engagementCounts[3], color: PAL.gold },
        { textureKey: ENGAGEMENT_ICON_KEYS.share, count: this.engagementCounts[4], color: PAL.ocean }
      ]
    });
    this.engagementBar.container.setDepth(1000);
  }

  /** Pushes [day, combo, cash, oil-price-hype, shareCount] into the engagement
   *  bar, skipping the call when nothing actually changed so idle frames
   *  don't spawn redundant count-up tweens. */
  private pushEngagementCounts(): void {
    const next = [this.currentDay, this.currentCombo, Math.round(this.displayedCredits), Math.round(this.displayedPrice), this.shareCount];
    if (next.every((v, i) => v === this.engagementCounts[i])) return;
    this.engagementCounts = next;
    this.engagementBar.setCounts(next);
  }

  /** Market ticker: a scrolling feed-style caption line under the price
   *  card — the acceptable fallback (per the reskin spec) for the old red
   *  "BREAKING NEWS" band. Headline queue/pump sequencing is unchanged;
   *  only the chrome around it (no box, no red banner) changed. */
  private buildCommentsTicker(): void {
    const intelBg = this.add.graphics().setDepth(999);
    intelBg.fillStyle(PANEL, 0.98);
    intelBg.fillRoundedRect(M, TICKER_Y - 22, GAME_W - M * 2, 44, 10);
    intelBg.lineStyle(1, PAL.purple, 0.5);
    intelBg.strokeRoundedRect(M, TICKER_Y - 22, GAME_W - M * 2, 44, 10);
    intelBg.fillStyle(PAL.purple, 0.8);
    intelBg.fillRoundedRect(M, TICKER_Y - 22, 5, 44, 2);
    const tickerStart = M + 74;
    this.add
      .text(M + 16, TICKER_Y, 'INTEL', {
        fontFamily: FONT_SANS,
        fontSize: '10px',
        fontStyle: 'bold',
        color: HEX.purple,
        letterSpacing: 1
      })
      .setOrigin(0, 0.5)
      .setDepth(1001);
    this.tickerText = this.add
      .text(GAME_W - M, TICKER_Y, TICKER_ITEMS.join('   ·   '), {
        fontFamily: FONT_SANS,
        fontSize: '13px',
        color: HEX.muted
      })
      .setOrigin(0, 0.5)
      .setDepth(1000);
    const maskShape = this.make.graphics({ x: 0, y: 0 }, false);
    maskShape.fillRect(tickerStart, TICKER_Y - 14, GAME_W - tickerStart - M, 28);
    this.tickerText.setMask(maskShape.createGeometryMask());
    this.tweens.add({
      targets: this.tickerText,
      x: -this.tickerText.width,
      duration: settings.reducedMotion ? 60000 : 30000,
      repeat: -1
    });

    this.headlineText = this.add
      .text(tickerStart, TICKER_Y, '', { fontFamily: FONT_SANS, fontSize: '13px', fontStyle: 'bold', color: HEX.cream })
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

  // ------------------------------------------ sea turrets (shop + placement)
  /** The SEA TURRET shop card — a 4th card in the TACTICAL UPGRADES row.
   *  Tapping it hides the summary panel and opens placement mode on the live
   *  map (GameScene draws the tappable slot markers along the coasts). */
  private buildDefenseCard(
    parent: Phaser.GameObjects.Container,
    x: number,
    y: number,
    h: number,
    w: number
  ): void {
    const card = createSuggestedCard(this, {
      x,
      y,
      w,
      h,
      icon: TOWER_GLYPH,
      title: TOWER_NAME,
      subtitle: '',
      onClick: () => {
        if (this.summaryNextDay < TUNING.towers.revealDay) {
          this.tweens.add({ targets: card, x: x - 6, duration: 40, yoyo: true, repeat: 2 });
          sfx.tap();
          return;
        }
        // no turrets yet + can't afford the first one → refuse with the same
        // shake the other upgrade cards give; once at least one is built the
        // card doubles as the manage/upgrade/sell entry, so it stays tappable
        const state = (this.registry.get('towerState') ?? []) as Array<TowerStateEntry | null>;
        const built = state.filter(Boolean).length;
        if (built === 0 && this.displayedCredits < towerBuildCost(0)) {
          this.tweens.add({ targets: card, x: x - 6, duration: 40, yoyo: true, repeat: 2 });
          sfx.tap();
          return;
        }
        pressPulse(this, card);
        this.enterPlacementMode();
      }
    });
    parent.add(card);
    this.defenseCard = card;
    this.refreshDefenseCardVisual();
  }

  /** Re-renders the turret card's subtitle (lock / next cost / slot count). */
  private refreshDefenseCardVisual(): void {
    const card = this.defenseCard;
    if (!card || !card.active) return;
    const subtitle = card.list[card.list.length - 1] as Phaser.GameObjects.Text;
    if (this.summaryNextDay < TUNING.towers.revealDay) {
      subtitle.setText(`\u{1F512} unlocks day ${TUNING.towers.revealDay}`).setColor(HEX.muted);
      card.setAlpha(0.6);
      return;
    }
    card.setAlpha(1);
    const state = (this.registry.get('towerState') ?? []) as Array<TowerStateEntry | null>;
    const built = state.filter(Boolean).length;
    const total = state.length;
    if (built >= total && total > 0) {
      subtitle.setText(`ALL ${total} BUILT \u00b7 TAP TO MANAGE`).setColor(HEX.green);
      return;
    }
    const cost = towerBuildCost(built);
    const affordable = this.displayedCredits >= cost;
    subtitle
      .setText(`PLACE ON MAP \u00b7 $${cost} (${built}/${total})`)
      .setColor(affordable ? HEX.green : HEX.muted);
    // mirror the locked-card dim when the first turret is out of reach \u2014
    // with none built the card is purely a purchase button, so it should
    // read disabled exactly like an unaffordable/locked upgrade
    card.setAlpha(built === 0 && !affordable ? 0.6 : 1);
  }

  private onTowersChanged(): void {
    this.refreshDefenseCardVisual();
    this.refreshPlacementPill();
    // keep the upgrade/sell popup honest after a purchase or sale
    if (this.towerPopupSlot != null && this.placementOpen) {
      const state = (this.registry.get('towerState') ?? []) as Array<TowerStateEntry | null>;
      const st = state[this.towerPopupSlot];
      if (st) this.showTowerPopup(this.towerPopupSlot);
      else this.closeTowerPopup();
    }
  }

  /** Hide the panel, reveal the frozen world, let GameScene mark the slots. */
  private enterPlacementMode(): void {
    if (this.placementOpen || !this.summaryPanel?.active) return;
    this.placementOpen = true;
    this.summaryPanel.setVisible(false);
    bus.emit('defense-map-open');
    sfx.tap();
    const o = this.add.container(0, 0).setDepth(1800);
    this.placementUI = o;
    // instruction pill across the top of the game view (below the mission
    // caption so the two don't overlap)
    const pillY = VIEW.y + 74;
    const pillBg = this.add.rectangle(GAME_W / 2, pillY, 460, 40, 0x0b1118, 0.92).setStrokeStyle(1, 0x8fd6ef, 0.7);
    this.placementPill = this.add
      .text(GAME_W / 2, pillY, '', { fontFamily: FONT_SANS, fontSize: '15px', fontStyle: 'bold', color: HEX.cream })
      .setOrigin(0.5);
    o.add([pillBg, this.placementPill]);
    this.refreshPlacementPill();
    // DONE pill at the foot of the view returns to the report
    const doneY = VIEW.y + VIEW.h - 42;
    const done = this.add.container(GAME_W / 2, doneY);
    const doneBg = this.add.rectangle(0, 0, 220, 48, 0x171810, 1).setStrokeStyle(2, PAL.gold, 0.85);
    const doneText = this.add
      .text(0, 0, 'DONE \u25b8', { fontFamily: FONT_DISPLAY, fontSize: '20px', color: HEX.gold })
      .setOrigin(0.5);
    done.add([doneBg, doneText]);
    done.setSize(220, 48);
    done.setInteractive({ useHandCursor: true });
    done.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.exitPlacementMode();
    });
    if (!settings.reducedMotion) {
      this.tweens.add({ targets: done, scale: 1.04, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    o.add(done);
  }

  private refreshPlacementPill(): void {
    if (!this.placementPill?.active) return;
    const state = (this.registry.get('towerState') ?? []) as Array<TowerStateEntry | null>;
    const built = state.filter(Boolean).length;
    if (built >= state.length && state.length > 0) {
      this.placementPill.setText('ALL SLOTS BUILT \u2014 tap a turret to upgrade or sell');
    } else {
      this.placementPill.setText(`TAP A RING TO BUILD \u2014 $${towerBuildCost(built)} \u00b7 tap a turret to manage`);
    }
  }

  /** Back to the report: markers away, world fades out, panel returns. */
  private exitPlacementMode(): void {
    if (!this.placementOpen) return;
    this.placementOpen = false;
    this.closeTowerPopup();
    this.placementUI?.destroy();
    this.placementUI = undefined;
    this.placementPill = undefined;
    bus.emit('defense-map-close');
    sfx.tap();
    this.summaryPanel?.setVisible(true);
    this.refreshDefenseCardVisual();
  }

  /** Upgrade/sell popup for a built turret, floated over the game view while
   *  placement mode is open (GameScene emits 'tower-tapped'). */
  private showTowerPopup(slotIdx: number): void {
    if (!this.placementOpen) return;
    this.closeTowerPopup();
    const state = (this.registry.get('towerState') ?? []) as Array<TowerStateEntry | null>;
    const st = state[slotIdx];
    if (!st) return;
    this.towerPopupSlot = slotIdx;
    const popup = this.add.container(GAME_W / 2, VIEW.y + VIEW.h - 160).setDepth(1810);
    this.towerPopup = popup;
    const maxed = st.level >= towerMaxLevel();
    const upCost = maxed ? 0 : towerUpgradeCost(st.level);
    const affordable = !maxed && this.displayedCredits >= upCost;
    const rows: Array<{ left: string; right: string; rightColor: string; enabled: boolean; onTap?: () => void }> = [
      { left: `${TOWER_GLYPH} ${TOWER_NAME} LV${st.level}`, right: '', rightColor: HEX.cream, enabled: false },
      {
        left: '\u2b06 UPGRADE',
        right: maxed ? 'MAX' : `$${upCost}`,
        rightColor: maxed ? HEX.muted : affordable ? HEX.green : HEX.muted,
        enabled: affordable,
        onTap: () => bus.emit('upgrade-tower', slotIdx)
      },
      {
        left: '\u2693 SELL',
        right: `+$${towerRefund(st.invested)}`,
        rightColor: HEX.gold,
        enabled: true,
        onTap: () => {
          bus.emit('sell-tower', slotIdx);
          this.closeTowerPopup();
        }
      }
    ];
    const rowH = 40;
    const pw = 360;
    const ph = rows.length * rowH + 20;
    const bg = this.add.graphics();
    bg.fillStyle(0x0b1118, 0.97);
    bg.fillRoundedRect(-pw / 2, -ph / 2, pw, ph, 10);
    bg.lineStyle(1, 0x8fd6ef, 0.7);
    bg.strokeRoundedRect(-pw / 2, -ph / 2, pw, ph, 10);
    popup.add(bg);
    rows.forEach((row, i) => {
      const ry = -ph / 2 + 10 + i * rowH + rowH / 2;
      popup.add(
        this.add
          .text(-pw / 2 + 16, ry, row.left, { fontFamily: FONT_SANS, fontSize: '14px', fontStyle: 'bold', color: HEX.cream })
          .setOrigin(0, 0.5)
      );
      if (row.right) {
        popup.add(
          this.add
            .text(pw / 2 - 16, ry, row.right, { fontFamily: FONT_SANS, fontSize: '14px', fontStyle: 'bold', color: row.rightColor })
            .setOrigin(1, 0.5)
        );
      }
      if (!row.onTap) return;
      const zone = this.add.rectangle(0, ry, pw - 8, rowH - 4, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        if (!row.enabled) {
          this.tweens.add({ targets: popup, x: GAME_W / 2 - 6, duration: 40, yoyo: true, repeat: 2 });
          sfx.tap();
          return;
        }
        sfx.tap();
        row.onTap!();
      });
      popup.add(zone);
    });
    const close = this.add
      .text(pw / 2 - 4, -ph / 2 + 4, '\u2715', { fontFamily: FONT_SANS, fontSize: '13px', color: '#8B98A5' })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    close.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      sfx.tap();
      this.closeTowerPopup();
    });
    popup.add(close);
    if (!settings.reducedMotion) popIn(this, popup, 140);
  }

  private closeTowerPopup(): void {
    this.towerPopup?.destroy();
    this.towerPopup = undefined;
    this.towerPopupSlot = null;
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
    if (gain > 0 && x > 0 && !settings.reducedMotion) {
      this.moneyBurst(x, y);
      sfx.coin();
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
    this.refreshDefenseCardVisual();
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
      .setX(M + 104);
    // headline takes over the ticker line; ticker comes back when the queue drains
    this.tickerText.setAlpha(0);
    this.tweens.add({
      targets: this.headlineText,
      alpha: 1,
      x: M + 74,
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
  /** Mission caption: compact operational card over the top edge of the map. */
  private buildMissionCaption(): void {
    const group = this.add.container(0, 0).setDepth(1001);
    const x = VIEW.x + 12;
    const y = VIEW.y + 10;
    const w = VIEW.w - 24;
    const bg = this.add.graphics();
    bg.fillStyle(0x081016, 0.9);
    bg.fillRoundedRect(x, y, w, 54, 10);
    bg.lineStyle(1, PAL.green, 0.55);
    bg.strokeRoundedRect(x, y, w, 54, 10);
    bg.fillStyle(PAL.green, 0.85);
    bg.fillRoundedRect(x, y, 5, 54, 2);
    const target = this.add.graphics().lineStyle(2, PAL.green, 0.9);
    target.strokeCircle(x + 28, y + 27, 10).lineBetween(x + 12, y + 27, x + 18, y + 27)
      .lineBetween(x + 38, y + 27, x + 44, y + 27);
    this.missionLabel = this.add.text(x + 52, y + 10, 'DAY 01 / LIVE MISSION', {
      fontFamily: FONT_SANS,
      fontSize: '9px',
      fontStyle: 'bold',
      color: HEX.green,
      letterSpacing: 1
    });
    this.missionText = this.add.text(x + 52, y + 27, 'INCOMING ORDERS…', {
      fontFamily: FONT_SANS,
      fontSize: '15px',
      fontStyle: 'bold',
      color: HEX.cream,
      wordWrap: { width: w - 70 }
    });
    group.add([bg, target, this.missionLabel, this.missionText]);
    registerLayout(this, 'hud-mission', group, { x, y, w, h: 54 });
  }

  private renderMissionCaption(): void {
    const m = this.mission;
    if (!m) return;
    let suffix = '';
    let color: string = HEX.white;
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
    this.missionLabel.setText(`DAY ${String(m.day).padStart(2, '0')} / LIVE MISSION`);
    this.missionText.setText(`${m.text}${suffix}`.toUpperCase()).setColor(color);
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
    this.dayEndToken++; // invalidate any in-flight snapshot capture/curtain
    this.summaryPanel?.destroy();
    this.summaryPanel = undefined;
    this.feedCurtain?.destroy();
    this.feedCurtain = undefined;
    this.curtainReady = false;
    this.upgradeButtons = {};
    this.registry.set('ui-modal', false);
    this.dayShareStart = this.shareCount;
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
    // performance-based roll for how much the share count climbs during the
    // day that follows — a clean day (mission done, nothing lost) earns the
    // top of the range, a rough one the bottom
    const performance = dayPerfScore(s.missionDone, s.safe, s.lost);
    const { shareGrowthMin, shareGrowthMax } = TUNING.social;
    this.dayShareTarget = Math.round(shareGrowthMin + (shareGrowthMax - shareGrowthMin) * performance);
    this.enterDaySummary(s);
  }

  /** Day-end entrance: transition directly from operations into the strategic
   *  after-action dashboard. The old social-feed curtain is intentionally
   *  bypassed so the recap and upgrade decisions remain the visual focus. */
  private enterDaySummary(s: DaySummary): void {
    this.dayEndToken++;
    this.feedCurtain?.destroy();
    this.feedCurtain = undefined;
    this.buildDaySummaryPanel(s);
    const panel = this.summaryPanel;
    if (!panel || settings.reducedMotion) return this.revealDaySummary();
    const finalY = this.summaryPanelFinalY;
    panel.setY(finalY + 42).setAlpha(0);
    this.tweens.add({
      targets: panel,
      y: finalY,
      alpha: 1,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => this.revealDaySummary()
    });
  }

  /** Builds the curtain — snapshot+stamp, two filler feed cards, and (only on
   *  a day with new unlocks) a collect card — and wires a CONTINUE/COLLECT
   *  button plus a swipe-up gesture on each slot so the player advances one
   *  screen at a time instead of it auto-playing. The final advance scrolls
   *  the whole curtain off, revealing the already-resting summary panel
   *  underneath. */
  private showFeedCurtain(s: DaySummary, snapCanvas: HTMLCanvasElement, token: number): void {
    if (token !== this.dayEndToken) return;
    const textureKey = `day-end-snap-${token}`;
    if (this.textures.exists(textureKey)) this.textures.remove(textureKey);
    this.textures.addCanvas(textureKey, snapCanvas);

    const curtain = this.add.container(0, 0).setDepth(2600);
    this.feedCurtain = curtain;
    const slotY = (i: number) => i * GAME_H + GAME_H / 2;
    const collectIdx = 1;
    this.curtainSlotCount = 2;
    this.curtainIndex = 0;
    this.curtainReady = false;
    this.curtainBaseY = 0;
    const panelW = 480;
    const panelH = 220;

    // slot 0 — the frozen gameplay frame, with a "DAY X COMPLETED" panel
    // fading in centered over it (CONTINUE sits directly under the panel,
    // wired below via continueY0/ctaBtn's yOverride)
    const snapImg = this.add.image(GAME_W / 2, slotY(0), textureKey).setDisplaySize(GAME_W, GAME_H);
    const stamp = this.add.container(GAME_W / 2, slotY(0)).setAlpha(0).setScale(0.9);
    const stampBg = this.add.graphics();
    stampBg.fillStyle(PAL.black, 0.82);
    stampBg.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 22);
    stampBg.lineStyle(3, PAL.gold, 1);
    stampBg.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 22);
    stamp.add(stampBg);
    stamp.add(this.add.text(0, -panelH / 2 + 54, `DAY ${s.day}`, { fontFamily: FONT_DISPLAY, fontSize: '30px', color: HEX.muted }).setOrigin(0.5));
    stamp.add(this.add.text(0, panelH / 2 - 58, 'COMPLETED', { fontFamily: FONT_DISPLAY, fontSize: '58px', color: HEX.gold }).setOrigin(0.5));
    curtain.add([snapImg, stamp]);

    // reusable pill button, faded in once its slot is the active one — defaults
    // to the bottom of the slot, but a slot can pin it under its own content instead
    const ctaBtn = (i: number, label: string, gold: boolean, onTap: () => void, yOverride?: number): Phaser.GameObjects.Container => {
      const btn = this.add.container(GAME_W / 2, yOverride ?? slotY(i) + GAME_H / 2 - 90).setAlpha(0);
      const bg = this.add.graphics();
      bg.fillStyle(PAL.black, 1);
      bg.fillRoundedRect(-130, -30, 260, 60, 16);
      bg.lineStyle(2, gold ? PAL.gold : DIVIDER, 1);
      bg.strokeRoundedRect(-130, -30, 260, 60, 16);
      const txt = this.add
        .text(0, 0, label, { fontFamily: FONT_DISPLAY, fontSize: '20px', color: gold ? HEX.gold : HEX.cream })
        .setOrigin(0.5);
      btn.add([bg, txt]);
      btn.setSize(260, 60);
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => this.tweens.add({ targets: btn, scale: 1.05, duration: 100 }));
      btn.on('pointerout', () => this.tweens.add({ targets: btn, scale: 1, duration: 100 }));
      btn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        onTap();
      });
      curtain.add(btn);
      return btn;
    };
    const swipeHint = (i: number, yOverride?: number) => {
      curtain.add(
        this.add
          .text(GAME_W / 2, yOverride ?? slotY(i) + GAME_H / 2 - 44, 'or swipe up ↑', { fontFamily: FONT_SANS, fontSize: '14px', color: '#8B98A5' })
          .setOrigin(0.5)
      );
    };
    // "DAY X COMPLETED" panel fades in centered over the snapshot; CONTINUE
    // sits directly under it (not pinned to the slot's bottom like slot 1's CTA)
    const continueY0 = slotY(0) + panelH / 2 + 46;
    const continueBtn0 = ctaBtn(0, 'CONTINUE', false, () => this.curtainReady && this.curtainAdvance?.(), continueY0);
    swipeHint(0, continueY0 + 46);

    // slot 1 (always shown) — thumbnails of every meme unlocked today, flown
    // one at a time into a running tally on COLLECT; on a day with nothing
    // unlocked it's a plain "no new memes today" screen with a CONTINUE
    // button instead (still a beat the player steps through, just nothing to collect)
    let runCollect: (() => void) | undefined;
    const hasUnlocks = s.newMemesUnlocked.length > 0;
    const fillerBg1 = this.add.rectangle(GAME_W / 2, slotY(1), GAME_W, GAME_H, PAL.ink, 1);
    curtain.add(fillerBg1);
    if (hasUnlocks) {
      const collectLabel = this.add
        .text(GAME_W / 2, slotY(1) - 230, '🎉 NEW MEMES UNLOCKED', { fontFamily: FONT_DISPLAY, fontSize: '25px', color: HEX.gold })
        .setOrigin(0.5);
      curtain.add(collectLabel);

      const shown = s.newMemesUnlocked.slice(0, 6);
      const cols = Math.min(shown.length, 3) || 1;
      const cellW = 130;
      const cellH = 130;
      const gap = 18;
      const rowW = cols * cellW + (cols - 1) * gap;
      const startX = GAME_W / 2 - rowW / 2 + cellW / 2;
      const startY = slotY(1) - 130;
      const cards: Phaser.GameObjects.Container[] = shown.map((id, i) => {
        const tpl = MEMES.templates[id];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const c = this.add.container(startX + col * (cellW + gap), startY + row * (cellH + gap));
        c.add(this.add.rectangle(0, 0, cellW, cellH, PAL.ink).setStrokeStyle(3, PAL.gold));
        if (tpl && hasArt(this, tpl.artKey)) {
          c.add(this.add.image(0, 0, tpl.artKey).setDisplaySize(cellW - 8, cellH - 8));
        } else {
          c.add(
            this.add
              .text(0, 0, tpl?.label ?? id, {
                fontFamily: FONT_SANS,
                fontSize: '13px',
                color: '#AAB4BD',
                align: 'center',
                wordWrap: { width: cellW - 12 }
              })
              .setOrigin(0.5)
          );
        }
        curtain.add(c);
        return c;
      });
      const trayY = startY + Math.ceil(shown.length / cols) * (cellH + gap) + 40;
      const trayText = this.add
        .text(GAME_W / 2, trayY, `📥 0/${shown.length} collected`, { fontFamily: FONT_DISPLAY, fontSize: '22px', color: HEX.cream })
        .setOrigin(0.5);
      curtain.add(trayText);
      if (s.newMemesUnlocked.length > shown.length) {
        curtain.add(
          this.add
            .text(GAME_W / 2, trayY + 30, `+${s.newMemesUnlocked.length - shown.length} more`, { fontFamily: FONT_SANS, fontSize: '15px', color: HEX.muted })
            .setOrigin(0.5)
        );
      }

      const collectBtn = ctaBtn(1, 'COLLECT', true, () => runCollect?.());
      this.tweens.add({ targets: collectBtn, alpha: 1, duration: 220, delay: 200 });

      runCollect = () => {
        collectBtn.disableInteractive();
        pressPulse(this, collectBtn);
        sfx.tap();
        this.tweens.add({ targets: collectBtn, alpha: 0, duration: 150 });
        let collected = 0;
        cards.forEach((c, i) => {
          this.time.delayedCall(i * 90, () => {
            if (this.feedCurtain !== curtain) return;
            this.tweens.add({
              targets: c,
              x: GAME_W / 2,
              y: trayY,
              scale: 0.15,
              alpha: 0,
              duration: 320,
              ease: EASE.inOut,
              onComplete: () => {
                collected++;
                trayText.setText(`📥 ${collected}/${shown.length} collected`);
                pressPulse(this, trayText, 1.15);
                if (collected === shown.length) {
                  confetti(this, GAME_W / 2, trayY, 16);
                  this.time.delayedCall(350, () => this.curtainAdvance?.());
                }
              }
            });
          });
        });
      };
    } else {
      curtain.add(
        this.add
          .text(GAME_W / 2, slotY(1) - 30, 'no new memes today', { fontFamily: FONT_DISPLAY, fontSize: '28px', color: HEX.muted })
          .setOrigin(0.5)
      );
      const continueBtn1 = ctaBtn(1, 'CONTINUE', false, () => this.curtainReady && this.curtainAdvance?.());
      this.tweens.add({ targets: continueBtn1, alpha: 1, duration: 220, delay: 200 });
      swipeHint(1);
    }

    sfx.tap();

    // scroll from the current slot to slot i, cubic/sine ease-in-out both ways
    const goToSlot = (i: number, onDone: () => void) => {
      if (this.feedCurtain !== curtain) return; // superseded mid-sequence
      this.tweens.add({ targets: curtain, y: -GAME_H * i, duration: 420, ease: EASE.inOut, onComplete: onDone });
    };
    const finish = () => {
      curtain.destroy();
      this.textures.remove(textureKey);
      if (this.feedCurtain === curtain) this.feedCurtain = undefined;
      this.revealDaySummary();
    };
    const enterSlot = (i: number) => {
      this.curtainIndex = i;
      this.curtainBaseY = -GAME_H * i;
      const isCollect = i === collectIdx && hasUnlocks;
      // the collect slot only advances once its own animation finishes —
      // swipe-up is disabled there so the reward can't be scrolled past
      this.curtainReady = !isCollect;
      this.curtainAdvance = () => {
        this.curtainReady = false;
        const isLast = i + 1 >= this.curtainSlotCount;
        // last transition: scroll the summary panel up into place at the same
        // time the curtain scrolls away, so the two read as one continuous strip
        if (isLast && this.summaryPanel) {
          this.tweens.add({ targets: this.summaryPanel, y: this.summaryPanelFinalY, duration: 420, ease: EASE.inOut });
        }
        goToSlot(i + 1, () => (isLast ? finish() : enterSlot(i + 1)));
      };
      // slot 0's CONTINUE fades in here; slot 1's own button (COLLECT or its
      // no-unlocks CONTINUE) already fades itself in at build time
      if (i === 0) this.tweens.add({ targets: continueBtn0, alpha: 1, duration: 220 });
    };

    // slot 0's stamp plays first; its CONTINUE button appears once it settles
    this.tweens.add({
      targets: stamp,
      alpha: 1,
      scale: 1,
      duration: 220,
      ease: EASE.pop,
      onComplete: () => this.time.delayedCall(300, () => this.feedCurtain === curtain && enterSlot(0))
    });
  }

  /** Reveals the summary panel: fanfare, unlock confetti, unlocks input
   *  (button + swipe-to-dismiss), and — under full autoplay — schedules the
   *  auto-advance. Shared by the reducedMotion fast path, the snapshot-
   *  timeout fallback (both skip the curtain entirely), and the end of the
   *  feed-curtain scroll sequence (where the panel's own scroll-in tween
   *  has already landed it at rest) — the explicit snap below is a safety
   *  net for the first two paths, where no entrance tween ever ran. */
  private revealDaySummary(): void {
    const panel = this.summaryPanel;
    if (!panel) return;
    panel.y = this.summaryPanelFinalY;
    this.summaryPanelReady = true;
    sfx.fanfare();
    if (panel.getData('newUnlocks')) confetti(this, GAME_W / 2, GAME_H / 2 - 60, 20);
    if (import.meta.env.DEV && devState.autoPlay === 'full') {
      this.time.delayedCall(500 / devState.speedMultiplier, () => {
        if (this.summaryPanel !== panel) return; // already advanced elsewhere
        this.devAutoSpendCredits();
        this.requestNextDay();
      });
    }
  }

  /** New-unlocks block folded into the top of the day-summary stack: a stack of
   *  feed comment rows ("🔓 unlocked · <meme name>"). Returns the block's height. */
  private buildUnlocksSection(parent: Phaser.GameObjects.Container, y: number, width: number, ids: string[]): number {
    const shown = ids.slice(0, 6);
    const rowH = 36;
    const h = 38 + shown.length * rowH + (ids.length > shown.length ? 24 : 0);
    const block = this.add.container(0, y + h / 2);
    block.add(
      this.add
        .text(-width / 2, -h / 2 + 6, 'NEW MEMES UNLOCKED', {
          fontFamily: FONT_SANS, fontSize: '14px', fontStyle: 'bold', color: HEX.gold, letterSpacing: 1
        })
        .setOrigin(0, 0)
    );
    let rowY = -h / 2 + 38;
    shown.forEach(id => {
      const tpl = MEMES.templates[id];
      block.add(
        createCommentRow(this, {
          x: -width / 2,
          y: rowY,
          w: width,
          avatarColor: PAL.gold,
          handle: 'UNLOCKED',
          text: tpl?.label ?? id
        })
      );
      rowY += rowH;
    });
    if (ids.length > shown.length) {
      block.add(
        this.add
          .text(0, rowY, `+${ids.length - shown.length} more`, {
            fontFamily: FONT_SANS,
            fontSize: '15px',
            fontStyle: 'bold',
            color: HEX.muted
          })
          .setOrigin(0.5)
      );
    }
    parent.add(block);
    return h;
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
    // header gets its own row; content lines flow below it instead of
    // sharing rows with (and dodging around) the header text.
    // sections are capped at 3 content rows so no single card can crowd
    // the report off-screen on a heavy day.
    const shownLines = lines.slice(0, 3);
    const headerH = 38;
    const lineH = 32;
    const padBottom = 16;
    const h = headerH + shownLines.length * lineH + padBottom;
    const card = this.add.container(0, y + h / 2);
    card.add(this.add.rectangle(0, 0, width, h, PANEL, 0.98).setStrokeStyle(1, DIVIDER, 1));
    card.add(this.add.rectangle(-width / 2 + 2, 0, 4, h - 4, accent, 0.9));
    card.add(
      this.add
        .text(-width / 2 + 18, -h / 2 + 18, header, {
          fontFamily: FONT_SANS,
          fontSize: '16px',
          fontStyle: 'bold',
          color: `#${accent.toString(16).padStart(6, '0')}`,
          letterSpacing: 1
        })
        .setOrigin(0, 0.5)
    );
    shownLines.forEach((ln, i) => {
      card.add(
        this.add
          .text(0, -h / 2 + headerH + lineH / 2 + i * lineH, ln.text, {
            fontFamily: FONT_SANS,
            fontSize: ln.size ?? '20px',
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
    todayIds: string[],
    newIds: string[]
  ): number {
    const shown = todayIds.filter(id => MEMES.templates[id]).slice(0, 8);
    const gap = 12;
    const maxRowW = width - 40;
    // thumbnails grow to 84px tall on a light day; on a heavy one, solve
    // directly for the height that makes the row exactly fit (rather than
    // scaling by feel) so it never spills past the card's edges
    const sumInvAspect = shown.reduce((s, id) => s + 1 / MEMES.templates[id].aspect, 0);
    const fitH = sumInvAspect ? (maxRowW - 8 - (shown.length - 1) * gap) / sumInvAspect : 0;
    // mock layout: centered thumbnail row under the header, tally centered
    // beneath it. Thumbnails run large — the card is the report's showpiece
    const thumbH = shown.length ? Math.max(30, Math.min(160, Math.round(fitH))) : 0;
    const widths = shown.map(id => Math.max(24, Math.floor(thumbH / MEMES.templates[id].aspect)));
    const rowW = widths.reduce((a, b) => a + b + gap, -gap);
    const headerH = 38;
    // row starts 8px below the header so a NEW badge (inside the thumbnail's
    // top-right corner) never crowds the header text
    const rowPad = 8;
    const tallyH = 34;
    const h = shown.length ? headerH + rowPad + thumbH + 10 + tallyH + 8 : headerH + 30;
    const card = this.add.container(0, y + h / 2);
    card.add(this.add.rectangle(0, 0, width, h, PANEL, 0.98).setStrokeStyle(1, DIVIDER, 1));
    card.add(this.add.rectangle(-width / 2 + 2, 0, 4, h - 4, PAL.gold, 0.9));
    const cardTitle = newIds.length ? 'MEMES / NEW UNLOCKS' : 'MEMES';
    card.add(
      this.add
        .text(-width / 2 + 18, -h / 2 + 18, cardTitle, {
          fontFamily: FONT_SANS,
          fontSize: '16px',
          fontStyle: 'bold',
          color: '#AAB4BD'
        })
        .setOrigin(0, 0.5)
    );
    if (shown.length) {
      let x = -rowW / 2;
      const rowY = -h / 2 + headerH + rowPad + thumbH / 2;
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
        if (newIds.includes(id)) {
          // tucked inside the thumbnail's top-right corner (overhanging the
          // edge collided with the card header / accent stripe)
          const badgeW = 34;
          const badgeH = 16;
          const badge = this.add.container(w / 2 - badgeW / 2 - 4, -thumbH / 2 + badgeH / 2 + 4);
          badge.add(this.add.rectangle(0, 0, badgeW, badgeH, PAL.gold));
          badge.add(
            this.add
              .text(0, 0, 'NEW', { fontFamily: FONT_SANS, fontSize: '10px', fontStyle: 'bold', color: '#1A2027' })
              .setOrigin(0.5)
          );
          thumb.add(badge);
        }
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
        .text(0, shown.length ? -h / 2 + headerH + rowPad + thumbH + 10 + tallyH / 2 : 0, tallyText, {
          fontFamily: FONT_SANS,
          fontSize: '18px',
          fontStyle: 'bold',
          color: shown.length ? HEX.gold : HEX.cream
        })
        .setOrigin(0.5)
    );
    parent.add(card);
    popIn(this, card, 220);
    return h;
  }

  /** Frozen-world recap + shop screen, built and settled in place immediately.
   *  This is the only time upgrades are purchasable. Waits for the player to
   *  click NEXT DAY (or swipe up) once revealed. */
  private buildDaySummaryPanel(s: DaySummary): void {
    this.summaryPanel?.destroy();
    this.upgradeButtons = {};
    this.defenseCard = undefined;
    this.summaryNextDay = s.day + 1;
    const W = GAME_W;
    const H = GAME_H;
    const panel = this.add.container(GAME_W / 2, GAME_H / 2).setDepth(1700);
    panel.setData('newUnlocks', s.newMemesUnlocked.length > 0);
    this.summaryPanel = panel;
    this.registry.set('ui-modal', true);
    // fully opaque — this bg is now the only thing standing between the
    // panel and the live HUD underneath (no dim backdrop layer any more)
    const bg = this.add.rectangle(0, 0, W, H, PAL.navy, 1).setStrokeStyle(2, DIVIDER);
    panel.add(bg);
    const grid = this.add.graphics().lineStyle(1, 0x34505f, 0.09);
    for (let gx = -W / 2; gx <= W / 2; gx += 48) grid.lineBetween(gx, -H / 2, gx, H / 2);
    for (let gy = -H / 2; gy <= H / 2; gy += 48) grid.lineBetween(-W / 2, gy, W / 2, gy);
    panel.add(grid);
    panel.add(this.add.rectangle(0, -H / 2 + 3, W - 64, 3, PAL.gold, 0.8));
    let y = -H / 2 + 20;
    const cardW = W - 80;
    panel.add(this.add.text(-cardW / 2, y, 'AFTER ACTION REPORT', {
      fontFamily: FONT_SANS,
      fontSize: '12px',
      fontStyle: 'bold',
      color: HEX.gold,
      letterSpacing: 1
    }).setOrigin(0, 0));
    const dayPill = this.add.container(cardW / 2 - 52, y + 8);
    dayPill.add(this.add.rectangle(0, 0, 104, 28, PANEL, 1).setStrokeStyle(1, PAL.green, 0.6));
    dayPill.add(this.add.text(0, 0, `DAY ${s.day} COMPLETE`, {
      fontFamily: FONT_SANS, fontSize: '10px', fontStyle: 'bold', color: HEX.green
    }).setOrigin(0.5));
    panel.add(dayPill);
    y += 34;
    panel.add(this.add.rectangle(0, y, cardW, 1, DIVIDER));
    y += 18;
    // everything from the headline down is the centerable content column —
    // leftover height on a light day splits above/below it (see below),
    // while the AFTER ACTION REPORT header row above stays pinned to the top
    const centerStartIdx = panel.list.length;
    // "global repercussions" — a big bizarre/tabloid headline picked from
    // this day's price swing + how well it went, real numbers underneath
    const perf = dayPerfScore(s.missionDone, s.safe, s.lost);
    const headlineTxt = this.add
      .text(0, y, repercussionHeadline(s.priceDelta, perf), {
        fontFamily: FONT_DISPLAY,
        fontSize: '30px',
        color: HEX.cream,
        align: 'center',
        wordWrap: { width: cardW }
      })
      .setOrigin(0.5, 0);
    panel.add(headlineTxt);
    y += headlineTxt.height + 10;
    panel.add(
      this.add
        .text(
          0,
          y,
          repercussionSubhead({
            label: `DAY ${s.day}`,
            price: s.price,
            priceDelta: s.priceDelta,
            priceBefore: s.price - s.priceDelta,
            safe: s.safe,
            lost: s.lost
          }),
          { fontFamily: FONT_SANS, fontSize: '13px', color: '#AAB4BD' }
        )
        .setOrigin(0.5, 0)
    );
    y += 38;

    // list indices where a stretchable gap precedes the children added next —
    // used below to spread a short day's leftover vertical space evenly
    // between the sections instead of leaving it lumped under the button
    const stretchMarks: number[] = [];

    // section 1 — mission outcome: the primary result gets first billing
    stretchMarks.push(panel.list.length);
    y += this.buildSummaryCard(panel, y, cardW, 'MISSION OUTCOME', [
      {
        text: s.missionDone ? `✓ ${s.missionText}` : `✗ ${s.missionText}`,
        color: s.missionDone ? HEX.green : HEX.red,
        size: '22px'
      },
      {
        text: s.missionDone ? `BONUS PAID: +$${s.rewardCredits}` : 'NO BONUS TODAY',
        color: s.missionDone ? HEX.green : '#AAB4BD',
        size: '16px'
      }
    ], s.missionDone ? PAL.green : PAL.red);
    y += 18;

    // section 2 — intel (warnings), only when there's something to show
    const intelLines: { text: string; color: string; size?: string }[] = s.warnings.map(w => ({
      text: `⚠ ${w}`,
      color: '#F2D8FF',
      size: '17px'
    }));
    if (intelLines.length) {
      stretchMarks.push(panel.list.length);
      y += this.buildSummaryCard(panel, y, cardW, 'INTEL', intelLines, PAL.purple);
      y += 18;
    }

    // section 3 — rewards: unlock state lives with its thumbnail instead of
    // repeating the same information in a separate block above the mission
    stretchMarks.push(panel.list.length);
    y += this.buildMemesCard(panel, y, cardW, s.memesToday, s.newMemesUnlocked);
    y += 20;

    // shop — hugs the recap content directly instead of pinning to a fixed
    // floor, so a short day doesn't leave a dead gap above it
    stretchMarks.push(panel.list.length);
    panel.add(this.add.rectangle(0, y, cardW, 1, DIVIDER));
    y += 22;
    const upgradeCardH = 175;
    // live cash readout right above the shop; onCredits keeps it current on buys
    this.summaryCashText = this.add
      .text(-cardW / 2, y + 12, `CASH  $${Math.round(this.displayedCredits)}`, {
        fontFamily: FONT_DISPLAY,
        fontSize: '24px',
        color: HEX.gold
      })
      .setOrigin(0, 0.5);
    panel.add(this.summaryCashText);
    y += 44;
    const upgradesHeaderY = y + 10;
    panel.add(
      this.add
        .text(cardW / 2, upgradesHeaderY, 'TACTICAL UPGRADES', { fontFamily: FONT_SANS, fontSize: '14px', fontStyle: 'bold', color: HEX.muted, letterSpacing: 1 })
        .setOrigin(1, 0.5)
    );
    const upgradeCardsY = upgradesHeaderY + 28 + upgradeCardH / 2;
    // 4 cards side by side (3 upgrades + the SEA TURRET defense card) must
    // fit the portrait panel: 4x168 + 3x8 = 696 < GAME_W (the shop row runs
    // nearly edge-to-edge on purpose — bigger tap targets)
    const upgradeCardW = 168;
    const upgradeCardGap = 8;
    const upgradeCardStep = upgradeCardW + upgradeCardGap;
    UPGRADES.forEach((u, i) =>
      this.buildUpgradeCard(panel, u, (i - 1.5) * upgradeCardStep, upgradeCardsY, upgradeCardH, upgradeCardW)
    );
    // the tower-defense shop entry: tap to hide the report and place turrets
    // directly on the map (see enterPlacementMode)
    this.buildDefenseCard(panel, 1.5 * upgradeCardStep, upgradeCardsY, upgradeCardH, upgradeCardW);

    // spread a little of a short day's leftover height across the section
    // gaps — deliberately capped low (density comes from the cards' own
    // padding, per Nadav's call): gaps stay tight and any remaining slack
    // sits below the button rather than puffing up the rhythm.
    const flowBtnY = upgradeCardsY + upgradeCardH / 2 + 36;
    const gapCount = stretchMarks.length + 1; // +1: the gap before the button
    const per = Math.min(18, Math.max(0, (H / 2 - 96 - flowBtnY) / gapCount));
    if (per > 0) {
      panel.list.forEach((child, i) => {
        const passed = stretchMarks.reduce((n, m) => n + (i >= m ? 1 : 0), 0);
        if (passed) (child as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject).y += per * passed;
      });
    }
    // whatever slack the capped stretch didn't absorb splits evenly above and
    // below the content column, so a light day reads centered instead of
    // top-heavy with a dead band under the button
    const slack = Math.max(0, H / 2 - 96 - (flowBtnY + per * gapCount));
    const centerShift = slack / 2;
    if (centerShift > 0) {
      panel.list.forEach((child, i) => {
        if (i >= centerStartIdx) (child as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject).y += centerShift;
      });
    }
    const nextBtnY = flowBtnY + per * gapCount + centerShift;
    // size the panel's own opaque background to however far the content
    // actually ran (+ the swipe hint under the button), floored at a full
    // screen — this panel is the next full-bleed "post" replacing the game
    // screen entirely, so it must never leave a gap exposing the live HUD
    // underneath, even on a short day's recap — then re-center on screen
    const bgH = Math.max(GAME_H, nextBtnY + 29 + 44 - (-H / 2));
    bg.setSize(W, bgH);
    bg.setPosition(0, -H / 2 + bgH / 2);
    panel.setY(GAME_H / 2 - bg.y);
    const nextBtn = this.add.container(0, nextBtnY);
    const nextBtnBg = this.add.graphics();
    nextBtnBg.fillStyle(0x171810, 1);
    nextBtnBg.fillRoundedRect(-cardW / 2, -32, cardW, 64, 12);
    nextBtnBg.lineStyle(2, PAL.gold, 0.85);
    nextBtnBg.strokeRoundedRect(-cardW / 2, -32, cardW, 64, 12);
    const nextBtnText = this.add
      .text(0, 0, `NEXT DAY — DAY ${this.summaryNextDay} ▶`, {
        fontFamily: FONT_DISPLAY,
        fontSize: '20px',
        color: HEX.gold
      })
      .setOrigin(0.5);
    nextBtn.add([nextBtnBg, nextBtnText]);
    nextBtn.setSize(cardW, 64);
    nextBtn.setInteractive({ useHandCursor: true });
    nextBtn.on('pointerover', () => this.tweens.add({ targets: nextBtn, scale: 1.05, duration: 100 }));
    nextBtn.on('pointerout', () => this.tweens.add({ targets: nextBtn, scale: 1, duration: 100 }));
    const advanceToNextDay = () => {
      if (!this.summaryPanelReady) return; // still hidden behind the feed curtain
      nextBtn.disableInteractive();
      pressPulse(this, nextBtn);
      this.requestNextDay();
    };
    nextBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      advanceToNextDay();
    });
    if (!settings.reducedMotion) {
      this.tweens.add({ targets: nextBtn, scale: 1.04, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    panel.add(nextBtn);
    // swipe-up is the primary "feed scroll" gesture (handled by
    // onSwipePointerDown/Move/Up on the panel); the button stays as a tap
    // fallback, so a hint here keeps the gesture discoverable
    panel.add(
      this.add
        .text(0, nextBtnY + 46, 'or swipe up ↑', { fontFamily: FONT_SANS, fontSize: '13px', color: '#8B98A5' })
        .setOrigin(0.5)
    );

    // panel rests in place immediately — the feed curtain (see
    // showFeedCurtain) handles the reveal motion, not this panel itself
    this.summaryPanelFinalY = panel.y;
    this.summaryPanelReady = false;
    this.refreshUpgradeAffordability();
  }

  // ------------------------------------------------ swipe-to-dismiss (day summary + curtain)
  private onSwipePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.placementOpen) return; // map placement owns input while open
    if (this.feedCurtain?.active && this.curtainReady) {
      this.swipeStartX = pointer.x;
      this.swipeStartY = pointer.y;
      return;
    }
    if (!this.summaryPanel?.active || !this.summaryPanelReady) return;
    this.swipeStartX = pointer.x;
    this.swipeStartY = pointer.y;
  }

  private onSwipePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.swipeStartY == null) return;
    const dy = pointer.y - this.swipeStartY;
    const dx = Math.abs(pointer.x - (this.swipeStartX ?? pointer.x));
    if (dy >= 0 || dx > 60) return; // only follow mostly-vertical, upward drags
    if (this.feedCurtain?.active && this.curtainReady) {
      this.feedCurtain.y = this.curtainBaseY + Math.max(dy, -GAME_H);
      return;
    }
    if (!this.summaryPanel?.active) return;
    this.summaryPanel.y = this.summaryPanelFinalY + Math.max(dy, -GAME_H);
  }

  private onSwipePointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.swipeStartY == null) return;
    const startX = this.swipeStartX ?? pointer.x;
    const startY = this.swipeStartY;
    this.swipeStartX = null;
    this.swipeStartY = null;
    const dy = pointer.y - startY;
    const dx = Math.abs(pointer.x - startX);
    const SWIPE_THRESHOLD = 70;
    if (this.feedCurtain?.active && this.curtainReady) {
      if (dy < -SWIPE_THRESHOLD && dx < 80) {
        this.curtainAdvance?.();
      } else if (this.feedCurtain.y !== this.curtainBaseY) {
        this.tweens.add({ targets: this.feedCurtain, y: this.curtainBaseY, duration: 220, ease: EASE.pop });
      }
      return;
    }
    if (!this.summaryPanel?.active) return;
    if (dy < -SWIPE_THRESHOLD && dx < 80) {
      this.requestNextDay();
    } else if (this.summaryPanel.y !== this.summaryPanelFinalY) {
      this.tweens.add({ targets: this.summaryPanel, y: this.summaryPanelFinalY, duration: 220, ease: EASE.pop });
    }
  }

  /** Shared dismiss path for the day-summary panel — fired by both the NEXT
   *  DAY button and a confirmed swipe-up gesture on the panel. */
  private requestNextDay(): void {
    if (!this.summaryPanel?.active || this.placementOpen || this.decisionOverlay) return;
    const pending = getPendingDecision();
    if (pending) {
      if (import.meta.env.DEV && devState.autoPlay === 'full') {
        // full autoplay never sees the decision screen — pick blind and move on
        const idx = Math.random() < 0.5 ? 0 : 1;
        const opt = chooseDecision(idx);
        if (opt) bus.emit(EV.DECISION, pending.id, idx, opt);
      } else {
        sfx.tap();
        this.showDecisionScreen(pending);
        return;
      }
    }
    sfx.tap();
    bus.emit(EV.NEXT_DAY_REQUEST);
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

  // ------------------------------------------------ day-break decision screen
  /** Full-screen interstitial between NEXT DAY and the day actually starting:
   *  the pending decision event rendered as a viral post (feed chrome), an
   *  oil-price graph projecting each choice's instant market move, and the
   *  two choices as quote-reply cards. No swipe-skip — the player must pick. */
  private showDecisionScreen(ev: DecisionEvent): void {
    this.decisionChosen = false;
    this.summaryPanelReady = false; // panel scrolls away; stop its swipe/tap input
    const overlay = this.add.container(0, settings.reducedMotion ? 0 : GAME_H).setDepth(2650);
    this.decisionOverlay = overlay;

    const bg = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, PAL.ink, 1);
    bg.setInteractive(); // swallow taps so nothing under the overlay reacts
    overlay.add(bg);
    const inner = this.add.container(0, 0);
    overlay.add(inner);

    const W = GAME_W - 64;
    const cx = GAME_W / 2;
    const nextDay = this.summaryNextDay;
    let y = 0;

    // ---- title
    inner.add(
      this.add.text(cx, y, `DAY ${nextDay} — DECISION`, { fontFamily: FONT_DISPLAY, fontSize: '40px', color: HEX.gold }).setOrigin(0.5, 0)
    );
    y += 52;
    inner.add(
      this.add
        .text(cx, y, 'your call, commander — the market is watching', { fontFamily: FONT_SANS, fontSize: '16px', color: HEX.muted })
        .setOrigin(0.5, 0)
    );
    y += 44;

    // ---- the "viral post" card (top-anchored: children measured, then bg drawn)
    const postCard = this.add.container(cx, y);
    const postBg = this.add.graphics();
    postCard.add(postBg);
    postCard.add(createPostHeader(this, { x: -W / 2 + 18, y: 42, w: W - 36, handle: ev.handle, subtext: ev.subtext, live: true }));
    const story = this.add
      .text(-W / 2 + 18, 84, ev.story, {
        fontFamily: FONT_SANS,
        fontSize: '20px',
        color: HEX.cream,
        wordWrap: { width: W - 36 },
        lineSpacing: 7
      })
      .setOrigin(0, 0);
    postCard.add(story);
    const engageY = 84 + story.height + 16;
    postCard.add(
      this.add
        .text(-W / 2 + 18, engageY, `💬 ${nextDay * 3 + 7}K      🔁 ${nextDay * 11 + 40}K      ❤️ ${nextDay * 23 + 120}K      👁 ${nextDay * 2 + 3}M`, {
          fontFamily: FONT_SANS,
          fontSize: '16px',
          color: HEX.muted
        })
        .setOrigin(0, 0)
    );
    const postH = engageY + 38;
    postBg.fillStyle(PANEL, 0.98);
    postBg.fillRoundedRect(-W / 2, 0, W, postH, 14);
    postBg.lineStyle(2, DIVIDER, 1);
    postBg.strokeRoundedRect(-W / 2, 0, W, postH, 14);
    inner.add(postCard);
    y += postH + 20;

    // ---- oil projection graph
    const branchColor = (o: DecisionOption) => (o.oilDelta > 0 ? PAL.red : o.oilDelta < 0 ? PAL.green : PAL.muted);
    const graphH = 240;
    inner.add(this.buildDecisionGraph(cx, y, W, graphH, ev.options, branchColor));
    y += graphH + 20;

    // ---- choice cards (quote-reply style), tagged A/B to match the graph
    ev.options.forEach((opt, idx) => {
      const lines = opt.effectLines;
      const cardH = 60 + lines.length * 26 + 18;
      const card = this.add.container(cx, y);
      const cardBg = this.add.graphics();
      cardBg.fillStyle(PANEL, 0.98);
      cardBg.fillRoundedRect(-W / 2, 0, W, cardH, 14);
      cardBg.lineStyle(2, DIVIDER, 1);
      cardBg.strokeRoundedRect(-W / 2, 0, W, cardH, 14);
      card.add(cardBg);
      const bColor = branchColor(opt);
      card.add(this.add.circle(-W / 2 + 36, 34, 17, bColor, 0.18).setStrokeStyle(2, bColor));
      card.add(
        this.add
          .text(-W / 2 + 36, 34, 'AB'[idx], { fontFamily: FONT_DISPLAY, fontSize: '19px', color: `#${bColor.toString(16).padStart(6, '0')}` })
          .setOrigin(0.5)
      );
      card.add(
        this.add
          .text(-W / 2 + 66, 34, opt.label, { fontFamily: FONT_DISPLAY, fontSize: '27px', color: HEX.cream })
          .setOrigin(0, 0.5)
      );
      lines.forEach((line, li) => {
        card.add(
          this.add
            .text(-W / 2 + 66, 64 + li * 26, line, { fontFamily: FONT_SANS, fontSize: '17px', color: HEX.muted })
            .setOrigin(0, 0)
        );
      });
      card.setSize(W, cardH);
      // explicit top-anchored hit area (container default centers on origin)
      card.setInteractive(new Phaser.Geom.Rectangle(-W / 2, 0, W, cardH), Phaser.Geom.Rectangle.Contains);
      card.input!.cursor = 'pointer';
      card.on('pointerover', () => !this.decisionChosen && this.tweens.add({ targets: card, scale: 1.02, duration: 100 }));
      card.on('pointerout', () => this.tweens.add({ targets: card, scale: 1, duration: 100 }));
      card.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        this.commitDecision(ev, idx, card, cardBg, W, cardH);
      });
      card.setData('optIdx', idx);
      inner.add(card);
      y += cardH + 16;
    });

    // center the stack in the canvas (bg stays full-bleed) — top-anchoring
    // instead just dumps all the same slack below the cards on short decision
    // text, which reads worse than splitting it evenly
    inner.y = Math.max(24, (GAME_H - y) / 2);

    // scroll in from below, same motion grammar as the feed curtain
    if (!settings.reducedMotion) {
      this.tweens.add({ targets: overlay, y: 0, duration: 420, ease: EASE.inOut });
      if (this.summaryPanel?.active) {
        this.tweens.add({ targets: this.summaryPanel, y: this.summaryPanel.y - GAME_H, duration: 420, ease: EASE.inOut });
      }
    }
  }

  /** Card with the recent oil-price sparkline plus a dashed projected branch
   *  per option (colored by direction), so each choice's instant market move
   *  is readable before committing. Top-anchored at (cx, top). */
  private buildDecisionGraph(
    cx: number,
    top: number,
    w: number,
    h: number,
    options: DecisionOption[],
    branchColor: (o: DecisionOption) => number
  ): Phaser.GameObjects.Container {
    const c = this.add.container(cx, top);
    const bg = this.add.graphics();
    bg.fillStyle(PANEL, 0.98);
    bg.fillRoundedRect(-w / 2, 0, w, h, 14);
    bg.lineStyle(2, DIVIDER, 1);
    bg.strokeRoundedRect(-w / 2, 0, w, h, 14);
    c.add(bg);
    // emoji drawn as its own text node, no letterSpacing — Phaser's canvas
    // text renderer splits the 🛢 glyph apart (renders as tofu boxes) when
    // letterSpacing is set on the same text run
    const oilIcon = this.add
      .text(-w / 2 + 18, 14, '🛢', { fontFamily: FONT_SANS, fontSize: '15px' })
      .setOrigin(0, 0);
    c.add(oilIcon);
    c.add(
      this.add
        .text(-w / 2 + 18 + oilIcon.width + 6, 14, 'BRENT CRUDE — PROJECTED REACTION', { fontFamily: FONT_SANS, fontSize: '15px', fontStyle: 'bold', color: HEX.muted, letterSpacing: 1 })
        .setOrigin(0, 0)
    );

    const hist = (((this.registry.get('priceHistory') as number[] | undefined) ?? []).slice(-40)).slice();
    if (!hist.length) hist.push(TUNING.session.startPrice);
    const cur = hist[hist.length - 1];
    const ends = options.map(o => Phaser.Math.Clamp(cur + o.oilDelta, 40, 220));
    const lo = Math.min(...hist, ...ends) - 4;
    const hi = Math.max(...hist, ...ends) + 4;
    const padX = 22;
    const labelGutter = 74;
    const plotW = w - padX * 2 - labelGutter;
    const histW = plotW * 0.62;
    const x0 = -w / 2 + padX;
    const yTop = 46;
    const plotH = h - yTop - 22;
    const yFor = (v: number) => yTop + (1 - (v - lo) / (hi - lo)) * plotH;

    // history line
    const line = this.add.graphics();
    line.lineStyle(3, PAL.cream, 1);
    line.beginPath();
    hist.forEach((v, i) => {
      const x = x0 + (hist.length === 1 ? histW : (i / (hist.length - 1)) * histW);
      i === 0 ? line.moveTo(x, yFor(v)) : line.lineTo(x, yFor(v));
    });
    line.strokePath();
    c.add(line);
    const nowX = x0 + histW;
    c.add(this.add.circle(nowX, yFor(cur), 4, PAL.gold));
    c.add(
      this.add
        .text(nowX - 6, yFor(cur) - 8, `$${Math.round(cur)}`, { fontFamily: FONT_SANS, fontSize: '15px', fontStyle: 'bold', color: HEX.gold })
        .setOrigin(1, 1)
    );

    // dashed projection branches + right-edge labels (nudged apart on overlap)
    const endX = x0 + plotW;
    const labelYs = options.map((o, i) => yFor(ends[i]));
    if (Math.abs(labelYs[0] - labelYs[1]) < 18) {
      const firstOnTop = labelYs[0] <= labelYs[1];
      const mid = (labelYs[0] + labelYs[1]) / 2;
      labelYs[0] = mid + (firstOnTop ? -9 : 9);
      labelYs[1] = mid + (firstOnTop ? 9 : -9);
    }
    options.forEach((o, i) => {
      const color = branchColor(o);
      const yEnd = yFor(ends[i]);
      const dash = this.add.graphics();
      dash.lineStyle(3, color, 0.95);
      const segs = 9;
      for (let s = 0; s < segs; s += 2) {
        const t0 = s / segs;
        const t1 = (s + 1) / segs;
        dash.lineBetween(
          nowX + (endX - nowX) * t0,
          yFor(cur) + (yEnd - yFor(cur)) * t0,
          nowX + (endX - nowX) * t1,
          yFor(cur) + (yEnd - yFor(cur)) * t1
        );
      }
      c.add(dash);
      const hex = `#${color.toString(16).padStart(6, '0')}`;
      c.add(
        this.add
          .text(endX + 8, labelYs[i], `${'AB'[i]} $${Math.round(ends[i])}`, { fontFamily: FONT_SANS, fontSize: '16px', fontStyle: 'bold', color: hex })
          .setOrigin(0, 0.5)
      );
    });
    return c;
  }

  /** Lock in a choice: gold-stamp the picked card, fade the other, apply the
   *  effects (rep + multi-day mods via decisions.ts, instant oil move via
   *  EV.DECISION in GameScene), then scroll the overlay away into the new day. */
  private commitDecision(
    ev: DecisionEvent,
    idx: number,
    card: Phaser.GameObjects.Container,
    cardBg: Phaser.GameObjects.Graphics,
    w: number,
    cardH: number
  ): void {
    if (this.decisionChosen) return;
    this.decisionChosen = true;
    const opt = chooseDecision(idx);
    if (!opt) return;
    sfx.tap();
    pressPulse(this, card);
    cardBg.lineStyle(3, PAL.gold, 1);
    cardBg.strokeRoundedRect(-w / 2, 0, w, cardH, 14);
    this.decisionOverlay?.getAll().forEach(obj => {
      if (obj instanceof Phaser.GameObjects.Container) obj.disableInteractive();
    });
    // fade the road not taken
    const inner = this.decisionOverlay?.list[1] as Phaser.GameObjects.Container | undefined;
    inner?.list.forEach(obj => {
      if (obj instanceof Phaser.GameObjects.Container && obj.getData('optIdx') !== undefined) {
        obj.disableInteractive();
        if (obj.getData('optIdx') !== idx && !settings.reducedMotion) {
          this.tweens.add({ targets: obj, alpha: 0.35, duration: 250 });
        } else if (obj.getData('optIdx') !== idx) {
          obj.setAlpha(0.35);
        }
      }
    });
    bus.emit(EV.DECISION, ev.id, idx, opt);
    this.time.delayedCall(settings.reducedMotion ? 80 : 800, () => this.exitDecisionScreen());
  }

  /** Kick off the next day underneath, then scroll the decision overlay up
   *  and off — mirroring the summary panel's own exit motion. */
  private exitDecisionScreen(): void {
    const overlay = this.decisionOverlay;
    if (!overlay) return;
    bus.emit(EV.NEXT_DAY_REQUEST);
    if (settings.reducedMotion) {
      overlay.destroy();
      this.decisionOverlay = undefined;
      return;
    }
    this.tweens.add({
      targets: overlay,
      y: -GAME_H,
      duration: 420,
      ease: EASE.inOut,
      onComplete: () => {
        overlay.destroy();
        if (this.decisionOverlay === overlay) this.decisionOverlay = undefined;
      }
    });
  }

  private onDayBreak(_remaining: null): void {
    this.dayEndToken++; // invalidate any in-flight snapshot capture/curtain
    const panel = this.summaryPanel;
    this.feedCurtain?.destroy();
    this.feedCurtain = undefined;
    this.curtainReady = false;
    this.summaryPanel = undefined;
    this.summaryPanelReady = false;
    this.swipeStartX = null;
    this.swipeStartY = null;
    this.upgradeButtons = {};
    this.registry.set('ui-modal', false);
    if (!panel) return;
    if (settings.reducedMotion) {
      panel.destroy();
      return;
    }
    // feed scroll out: the panel (the next day's live gameplay is already
    // rendering underneath, same as it was hidden underneath the whole time)
    // continues scrolling up and off the top, mirroring the scroll-in
    this.tweens.add({
      targets: panel,
      y: panel.y - GAME_H,
      duration: 260,
      ease: EASE.inOut,
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

  /** Dev panel: fire a random meme trigger right now, bypassing the cooldown. */
  private onDevForceMeme(): void {
    const labels = Object.keys(MEMES.triggers);
    const label = labels[Math.floor(Math.random() * labels.length)] ?? 'EVENT LOST';
    this.showMemeReaction(label, undefined, true);
  }

  /** Meme moments no longer interrupt play with a center-screen cutaway —
   *  they record into the day's meme log (pickMeme) and surface as a brief
   *  headline ping; the actual reveal (art + caption) happens in the
   *  day-end summary's MEMES card (buildMemesCard) and unlocks section
   *  (buildUnlocksSection), so the player isn't pulled off the play field. */
  private showMemeReaction(label: string, ctx?: MemeContext, force = false): void {
    // memes react to game moments, but sparingly — respect the cooldown so
    // back-to-back moments don't turn the feed into a meme channel
    if (!force && this.time.now - this.lastMemeAt < MEMES.settings.minGapMs) return;
    this.lastMemeAt = this.time.now;
    const pick = pickMeme(label, ctx);
    if (pick.isNew) bus.emit('meme-unlocked', pick.id);
    this.unlockBannerQueue.push(pick);
    this.onHeadline('📸 new post added to today’s feed', 'event', 2000);
    sfx.tap();
  }

  private onTimer(elapsed: number): void {
    this.elapsedSec = elapsed;
    const dayLen = TUNING.dayNight.dayLengthSec;
    this.currentDay = Math.floor(elapsed / dayLen) + 1;
    // broadcast clock: the day maps to a 24h cycle, ticking hour by hour
    const hour = Math.min(23, Math.floor(((elapsed % dayLen) / dayLen) * 24));
    this.hourText.setText(`${hour.toString().padStart(2, '0')}:00 · STRAIT COMMAND`);
    // share count eases toward dayShareStart + dayShareTarget as the day plays
    // out — ease-out so it feels like early traction rather than a linear tick
    const dayFrac = Phaser.Math.Clamp((elapsed % dayLen) / dayLen, 0, 1);
    const eased = 1 - (1 - dayFrac) * (1 - dayFrac);
    this.shareCount = Math.round(this.dayShareStart + this.dayShareTarget * eased);
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
    this.tryShowUnlockBanner();
  }

  /** Plays the next queued meme as a banner over the lower band — but only
   *  during calm-ish gameplay: at most memeBannerMaxThreats live threats, no
   *  day-end UI up, world not frozen. Queued memes wait for the next lull. */
  private tryShowUnlockBanner(): void {
    if (!this.unlockBannerQueue.length || this.unlockBanner) return;
    if (this.summaryPanel?.active || this.placementOpen) return;
    const game = this.scene.get('Game') as any;
    if (!game || game.over || game.frozen) return;
    const aliveThreats = ((game.threats ?? []) as { dead: boolean }[]).filter(t => !t.dead).length;
    if (aliveThreats > TUNING.social.memeBannerMaxThreats) return;
    const next = this.unlockBannerQueue.shift()!;
    this.showUnlockBanner(next);
  }

  private showUnlockBanner(pick: MemePick): void {
    const { tpl, isNew } = pick;
    if (!tpl) return;
    // square card spanning the whole lower band: from the top line of the
    // engagement icon row down to the bottom line of the INTEL panel
    const top = ENGAGEMENT.y;
    const bottom = TICKER_Y + 22;
    const size = bottom - top;
    const cx = GAME_W / 2;
    const cy = (top + bottom) / 2;
    const banner = this.add.container(cx, cy).setDepth(1100);
    this.unlockBanner = banner;
    const total = Object.keys(MEMES.templates).length;
    const tally = `${getUnlockedTemplates().size}/${total}`;
    const title = isNew ? `✨ NEW MEME UNLOCKED · ${tally}` : `📸 MEME POSTED · ${tally}`;
    const titleText = this.add
      .text(0, -size / 2 + 22, title, {
        fontFamily: FONT_SANS,
        fontSize: '20px',
        fontStyle: 'bold',
        color: isNew ? HEX.gold : HEX.cream
      })
      .setOrigin(0.5);
    // panel keeps the band's full height but widens past square when the
    // title needs the room
    const panelW = Math.max(size, Math.ceil(titleText.width) + 48);
    banner.add(this.add.rectangle(0, 0, panelW, size, 0x1a2027, 1).setStrokeStyle(2, PAL.gold, 1));
    banner.add(titleText);
    // meme art fills the rest of the panel below the title, kept in aspect
    const boxW = panelW - 16;
    const boxH = size - 44 - 8;
    const artW = Math.min(boxW, boxH / tpl.aspect);
    const artH = artW * tpl.aspect;
    const artY = -size / 2 + 44 + boxH / 2;
    // captions live only on this in-flight card — renderMeme overlays the
    // picked variant's text on the art (thumbnails elsewhere stay textless)
    const memeHost = this.add.container(0, artY);
    renderMeme(this, memeHost, pick, boxW, boxH);
    banner.add(memeHost);
    banner.add(this.add.rectangle(0, artY, artW, artH).setStrokeStyle(2, PAL.gold));
    sfx.tap();
    // half-transparent black dim over the whole lower band (stats / graph /
    // intel) so the meme card is the only thing that reads while it's up
    const dim = this.add
      .rectangle(GAME_W / 2, (top + GAME_H) / 2, GAME_W, GAME_H - top, 0x000000, 0.5)
      .setDepth(1099);
    const hold = TUNING.social.unlockBannerHoldMs;
    const done = () => {
      dim.destroy();
      banner.destroy();
      this.unlockBanner = undefined;
    };
    if (settings.reducedMotion) {
      this.time.delayedCall(hold, done);
    } else {
      // card slides in fully opaque from the right, holds centered, exits left
      const inMs = 300;
      banner.setX(GAME_W + panelW / 2);
      dim.setAlpha(0);
      this.tweens.add({ targets: dim, alpha: 1, duration: inMs });
      this.tweens.add({ targets: banner, x: cx, duration: inMs, ease: EASE.inOut });
      this.tweens.add({ targets: banner, x: -panelW / 2 - 10, duration: inMs, ease: EASE.inOut, delay: inMs + hold });
      this.tweens.add({ targets: dim, alpha: 0, duration: inMs, delay: inMs + hold, onComplete: done });
    }
  }

  private drawGraph(hist: number[], dt: number): void {
    const g = this.graph;
    g.clear();
    // fills the price/graph card below the price readout row
    const x0 = PRICE_CARD.x + 16,
      y0 = PRICE_CARD.y + 50,
      w = PRICE_CARD.w - 32,
      h = PRICE_CARD.y + PRICE_CARD.h - 8 - (PRICE_CARD.y + 50);
    g.fillStyle(0x0b141c, 1);
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
