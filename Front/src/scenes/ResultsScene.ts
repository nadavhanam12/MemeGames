import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { MEMES, MemePick, getMemeLog, renderMeme } from '../core/memes';
import { getRunUnlocks, getUnlockedTemplates } from '../core/memeUnlocks';
import { EASE, confetti, countTo } from '../core/juice';
import { broadcastCut, broadcastReveal } from '../core/broadcast';
import { createPostHeader } from '../core/feedChrome';
import { SessionStats, computeScore, freshStats } from '../core/state';
import { repercussionHeadline, repercussionSubhead, runPerfScore } from '../core/repercussions';
import { captureAndShare } from '../core/share';
import { leaderboard } from '../backend/leaderboard';
import { openSubmitOverlay } from '../backend/submitOverlay';
import { analytics } from '../backend/analytics';

// The run recap styled as a single feed "tweet" card — a self-contained
// post designed to be screenshotted or exported via the SHARE button (which
// captures exactly this rect, watermarked, and opens the OS share sheet).
const CARD = { x: GAME_W / 2, y: 500, w: 660, h: 960 } as const;
const CARD_BG = PAL.black;
const CARD_INK = HEX.cream;
// Hairline divider color shared with feedChrome's card borders.
const DIVIDER = 0x2f3336;

export class ResultsScene extends Phaser.Scene {
  private leaving = false;

  constructor() {
    super('Results');
  }

  create(): void {
    const stats = (this.registry.get('finalStats') as SessionStats) ?? freshStats();
    const finalScore = computeScore(stats);
    this.leaving = false;

    if (hasArt(this, 'map_bg')) {
      this.add.image(GAME_W / 2, GAME_H / 2, 'map_bg').setDisplaySize(GAME_W, GAME_H).setAlpha(0.3);
      this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, PAL.ink, 0.6);
    } else {
      this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, PAL.navy);
    }

    broadcastReveal(this);
    const root = this.add.container(0, 0);
    const reduced = settings.reducedMotion;

    // --- newspaper front page ----------------------------------------------
    const { card, scoreTxt } = this.buildFrontPage(stats, finalScore);
    root.add(card);

    // --- buttons -----------------------------------------------------------
    // Thinner feed-native buttons: dark card + colored accent border/text
    // (was solid bright fills with a thick cartoon outline).
    const mkButton = (
      x: number,
      y: number,
      w: number,
      accent: number,
      label: string,
      labelColor: string,
      onClick: () => void
    ): Phaser.GameObjects.Container => {
      const c = this.add.container(x, y);
      const bg = this.add.rectangle(0, 0, w, 76, PAL.black, 0.9).setStrokeStyle(2, accent);
      const t = this.add
        .text(0, 0, label, {
          fontFamily: FONT_DISPLAY,
          fontSize: '26px',
          color: labelColor,
          align: 'center'
        })
        .setOrigin(0.5);
      c.add([bg, t]);
      c.setSize(w, 76);
      c.setInteractive({ useHandCursor: true });
      c.on('pointerover', () => !this.leaving && this.tweens.add({ targets: c, scale: 1.05, duration: 90, ease: EASE.snap }));
      c.on('pointerout', () => this.tweens.add({ targets: c, scale: 1, duration: 90, ease: EASE.snap }));
      c.on('pointerdown', () => {
        if (this.leaving) return;
        sfx.unlock();
        sfx.tap();
        onClick();
      });
      root.add(c);
      return c;
    };

    // Game-end flow: submit form (skippable) → leaderboard, once per run.
    // The leaderboard button re-runs it if the score wasn't submitted yet.
    let overlayOpen = false;
    // fromButton: an explicit LEADERBOARD click always lands there; the
    // automatic game-end prompt stays on Results when the player skips.
    const runSubmitFlow = async (fromButton: boolean): Promise<void> => {
      if (overlayOpen || this.leaving) return;
      let outcome = null;
      let prompted = false;
      if (this.registry.get('submittedFor') !== stats) {
        overlayOpen = true;
        prompted = true;
        outcome = await openSubmitOverlay(leaderboard, finalScore);
        overlayOpen = false;
        if (outcome) {
          this.registry.set('submittedFor', stats);
          analytics.track('score_submitted', { accepted: outcome.response.accepted, saved: outcome.response.saved });
          if (outcome.response.saved) {
            sfx.fanfare();
            confetti(this, GAME_W / 2, 200, 24);
          }
        } else {
          analytics.track('score_submit_skipped');
        }
      }
      const skipped = prompted && !outcome;
      if (skipped && !fromButton) return;
      const pause = outcome?.response.saved ? 900 : 200;
      this.time.delayedCall(pause, () => {
        if (this.scene.isActive()) this.exitTo(() => this.scene.start('Leaderboard', { from: 'Results' }));
      });
    };

    // Capture the front-page rect exactly (share.ts watermarks it), then hand
    // it to the OS share sheet / download and confirm under the button.
    let sharing = false;
    const shareRun = async (btn: Phaser.GameObjects.Container): Promise<void> => {
      if (sharing) return;
      sharing = true;
      const outcome = await captureAndShare(
        this.game,
        { x: CARD.x - CARD.w / 2, y: CARD.y - CARD.h / 2, w: CARD.w, h: CARD.h },
        `hormuz-holdem-day-${stats.daysSurvived}.png`,
        `HORMUZ HOLD'EM — I survived ${stats.daysSurvived} day${stats.daysSurvived === 1 ? '' : 's'} before crashing the oil market. Score: ${finalScore}. Think you can hold the strait?`,
        'results'
      );
      sharing = false;
      if (this.leaving || !this.scene.isActive()) return;
      const msg =
        outcome === 'shared' ? 'SHARED!' : outcome === 'downloaded' ? 'IMAGE SAVED!' : outcome === 'failed' ? 'SHARE FAILED' : '';
      if (msg) {
        const note = this.add
          .text(btn.x, btn.y - 58, msg, {
            fontFamily: FONT_DISPLAY,
            fontSize: '20px',
            color: outcome === 'failed' ? HEX.red : HEX.green,
            stroke: HEX.ink,
            strokeThickness: 5
          })
          .setOrigin(0.5);
        root.add(note);
        this.tweens.add({ targets: note, y: note.y - 16, alpha: 0, delay: 900, duration: 400, onComplete: () => note.destroy() });
      }
    };

    // 2x2 button grid below the front page (was one wide row in landscape)
    const totalMemes = Object.keys(MEMES.templates).length;
    const BTN_ROW1_Y = 1030;
    const BTN_ROW2_Y = 1130;
    const BTN_L_X = GAME_W / 2 - 170;
    const BTN_R_X = GAME_W / 2 + 170;
    mkButton(BTN_L_X, BTN_ROW1_Y, 320, PAL.ocean, 'LEADERBOARD', HEX.ocean, () => void runSubmitFlow(true));
    mkButton(BTN_R_X, BTN_ROW1_Y, 320, PAL.green, 'DEFEND AGAIN', HEX.green, () =>
      this.exitTo(() => this.scene.start('Game'))
    );
    const shareBtn = mkButton(BTN_L_X, BTN_ROW2_Y, 320, PAL.gold, 'SHARE', HEX.gold, () => void shareRun(shareBtn));
    mkButton(BTN_R_X, BTN_ROW2_Y, 320, PAL.purple, `GALLERY ${getUnlockedTemplates().size}/${totalMemes}`, HEX.purple, () =>
      this.exitTo(() => this.scene.start('Gallery', { from: 'Results' }))
    );

    // --- entrance ----------------------------------------------------------
    const slideIn = (obj: Phaser.GameObjects.Components.Transform & { setAlpha(a: number): unknown }, delay: number, fromY = 24): void => {
      const y = obj.y;
      obj.setAlpha(0);
      obj.y = y + (reduced ? 0 : fromY);
      this.tweens.add({
        targets: obj,
        y,
        alpha: 1,
        delay: reduced ? delay * 0.4 : delay,
        duration: reduced ? 140 : 340,
        ease: EASE.pop
      });
    };

    slideIn(card, 0, -24);
    root.list
      .filter((o): o is Phaser.GameObjects.Container => o instanceof Phaser.GameObjects.Container && o !== card)
      .forEach((btn, i) => slideIn(btn, 380 + i * 90, 40));
    if (!reduced) {
      this.time.delayedCall(180, () => sfx.whoosh());
      this.time.delayedCall(620, () => sfx.whoosh());
    }

    this.time.delayedCall(reduced ? 100 : 260, () => {
      countTo(this, scoreTxt, 0, finalScore, v => `${Math.round(v)}`, 900);
      sfx.priceDown();
    });

    this.time.delayedCall(reduced ? 500 : 1200, () => {
      sfx.fanfare();
      confetti(this, GAME_W / 2, 210, 26);
    });

    // let the recap land, then roll into submit → leaderboard (once per run)
    if (this.registry.get('autoFlowFor') !== stats) {
      this.registry.set('autoFlowFor', stats);
      this.time.delayedCall(reduced ? 1200 : 2200, () => void runSubmitFlow(false));
    }

  }

  /** Channel-cut out of the studio, then switch scenes. */
  private exitTo(go: () => void): void {
    if (this.leaving) return;
    this.leaving = true;
    broadcastCut(this, go);
  }

  /** The whole front page in one container centered on CARD — masthead,
   *  headline, "photo" (last meme of the run, real captions), stat column and
   *  oil-price sparkline. Returns the score text for the count-up tween. */
  private buildFrontPage(
    stats: SessionStats,
    finalScore: number
  ): { card: Phaser.GameObjects.Container; scoreTxt: Phaser.GameObjects.Text } {
    const card = this.add.container(CARD.x, CARD.y);
    const halfW = CARD.w / 2;
    const halfH = CARD.h / 2;

    card.add(this.add.rectangle(0, 0, CARD.w, CARD.h, CARD_BG, 0.92).setStrokeStyle(2, DIVIDER));

    // post header — this run's recap as a single tweet
    card.add(
      createPostHeader(this, {
        x: -halfW + 20,
        y: -halfH + 44,
        w: CARD.w - 40,
        handle: "Hormuz Hold'em",
        subtext: 'just now',
        live: false
      })
    );
    card.add(this.add.rectangle(0, -halfH + 86, CARD.w - 40, 2, DIVIDER));

    // "global repercussions" headline — bizarre/tabloid title picked from the
    // whole run's price swing + overall performance, real numbers underneath
    const totalDelta = Math.round(stats.oilPrice - stats.startPrice);
    card.add(
      this.add
        .text(0, -halfH + 100, repercussionHeadline(totalDelta, runPerfScore(stats)), {
          fontFamily: FONT_SANS,
          fontSize: '20px',
          fontStyle: 'bold',
          color: CARD_INK,
          align: 'center',
          wordWrap: { width: CARD.w - 60 }
        })
        .setOrigin(0.5, 0)
    );
    const subhead = repercussionSubhead({
      label: 'FINAL',
      price: Math.round(stats.oilPrice),
      priceDelta: totalDelta,
      priceBefore: stats.startPrice,
      safe: stats.tankersSafe,
      lost: stats.tankersLost
    });
    card.add(
      this.add
        .text(0, -halfH + 230, subhead, {
          fontFamily: FONT_SANS,
          fontSize: '14px',
          color: HEX.muted,
          align: 'center',
          wordWrap: { width: CARD.w - 60 }
        })
        .setOrigin(0.5)
    );

    // "photo": the last meme this run produced, real captions — single
    // centered column now (was a left column beside the stats in landscape)
    const photoY = -halfH + 410;
    card.add(this.add.rectangle(0, photoY, 460, 300, 0x0e161e).setStrokeStyle(2, DIVIDER));
    const lastMeme = this.lastMemePick();
    if (lastMeme) {
      const photo = this.add.container(0, photoY - 8);
      renderMeme(this, photo, lastMeme, 420, 260);
      card.add(photo);
      card.add(
        this.add
          .text(0, photoY + 164, 'moments before disaster', {
            fontFamily: FONT_SANS,
            fontSize: '12px',
            color: HEX.muted
          })
          .setOrigin(0.5)
      );
    } else {
      card.add(
        this.add
          .text(0, photoY, 'NO PHOTOS SURVIVED\nTHE BLAST', {
            fontFamily: FONT_DISPLAY,
            fontSize: '22px',
            color: CARD_INK,
            align: 'center'
          })
          .setOrigin(0.5)
          .setAlpha(0.5)
      );
    }

    // classifieds strip under the photo — new unlocks or a filler joke
    const unlocks = getRunUnlocks().filter(id => MEMES.templates[id]).length;
    card.add(
      this.add
        .text(
          0,
          photoY + 198,
          unlocks > 0
            ? `★ ${unlocks} new meme${unlocks === 1 ? '' : 's'} unlocked — see gallery`
            : 'tanker captain seeks new line of work',
          {
            fontFamily: FONT_SANS,
            fontSize: '13px',
            fontStyle: 'bold',
            color: unlocks > 0 ? HEX.purple : HEX.muted
          }
        )
        .setOrigin(0.5)
    );

    // score + stat briefs + sparkline — stacked below the photo (was a right
    // column beside it in landscape)
    card.add(
      this.add
        .text(0, halfH - 316, 'FINAL SCORE', {
          fontFamily: FONT_SANS,
          fontSize: '14px',
          fontStyle: 'bold',
          color: HEX.muted
        })
        .setOrigin(0.5)
    );
    const scoreTxt = this.add
      .text(0, halfH - 270, '0', {
        fontFamily: FONT_DISPLAY,
        fontSize: '56px',
        color: CARD_INK
      })
      .setOrigin(0.5);
    card.add(scoreTxt);

    const statLines = [
      `☀ ${stats.daysSurvived} DAY${stats.daysSurvived === 1 ? '' : 'S'} SURVIVED`,
      `⛴ ${stats.tankersSafe} ESCORTED · ${stats.tankersLost} LOST`,
      `✦ BEST COMBO x${stats.bestCombo} · ${stats.nearMisses} NEAR MISSES`
    ];
    statLines.forEach((line, i) => {
      card.add(
        this.add
          .text(0, halfH - 210 + i * 26, line, {
            fontFamily: FONT_SANS,
            fontSize: '15px',
            fontStyle: 'bold',
            color: CARD_INK
          })
          .setOrigin(0.5)
          .setAlpha(0.9)
      );
    });

    this.drawSparkline(card, stats, 0, halfH - 73, 500, 70);

    return { card, scoreTxt };
  }

  /** Rebuild a MemePick from the last memeLog entry (captions are already
   *  token-substituted with this run's real numbers). */
  private lastMemePick(): MemePick | null {
    const log = getMemeLog();
    for (let i = log.length - 1; i >= 0; i--) {
      const tpl = MEMES.templates[log[i].t];
      if (tpl) return { id: log[i].t, tpl, captions: [...log[i].c], isNew: false };
    }
    return null;
  }

  /** Oil-price line for the whole run (priceHistory samples every 0.5s),
   *  scaled to its own min/max, with a red marker on the closing price. */
  private drawSparkline(
    card: Phaser.GameObjects.Container,
    stats: SessionStats,
    cx: number,
    cy: number,
    w: number,
    h: number
  ): void {
    const hist = stats.priceHistory;
    card.add(this.add.rectangle(cx, cy, w, h, 0x0e161e, 0.7).setStrokeStyle(2, DIVIDER));
    if (hist.length >= 2) {
      const min = Math.min(...hist);
      const max = Math.max(...hist);
      const span = Math.max(1, max - min);
      const g = this.add.graphics();
      g.lineStyle(3, PAL.ocean, 0.9);
      g.beginPath();
      hist.forEach((p, i) => {
        const px = cx - w / 2 + 8 + (i / (hist.length - 1)) * (w - 16);
        const py = cy + h / 2 - 8 - ((p - min) / span) * (h - 16);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.strokePath();
      const lastY = cy + h / 2 - 8 - ((hist[hist.length - 1] - min) / span) * (h - 16);
      g.fillStyle(PAL.red, 1);
      g.fillCircle(cx + w / 2 - 8, lastY, 5);
      card.add(g);
    }
    // left-aligned so the bottom-right corner stays clear for the export
    // watermark share.ts stamps there
    card.add(
      this.add
        .text(cx - w / 2 + 4, cy + h / 2 + 12, `OIL PRICE: $${Math.round(stats.startPrice)} → $${Math.round(stats.oilPrice)}`, {
          fontFamily: FONT_SANS,
          fontSize: '11px',
          fontStyle: 'bold',
          color: HEX.muted
        })
        .setOrigin(0, 0.5)
    );
  }
}
