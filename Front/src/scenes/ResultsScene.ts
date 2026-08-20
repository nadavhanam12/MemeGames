import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { MEMES, MemePick, getMemeLog, renderMeme } from '../core/memes';
import { getRunUnlocks, getUnlockedTemplates } from '../core/memeUnlocks';
import { EASE, confetti, countTo } from '../core/juice';
import { broadcastCut, broadcastReveal, stampIn } from '../core/broadcast';
import { SessionStats, computeScore, freshStats } from '../core/state';
import { captureAndShare } from '../core/share';
import { leaderboard } from '../backend/leaderboard';
import { openSubmitOverlay } from '../backend/submitOverlay';
import { analytics } from '../backend/analytics';

// The run recap styled as a newspaper front page — a self-contained "poster"
// designed to be screenshotted or exported via the SHARE button (which
// captures exactly this rect, watermarked, and opens the OS share sheet).
const CARD = { x: GAME_W / 2, y: 300, w: 900, h: 480 } as const;
const PAPER = 0xf6efdc;
const PAPER_INK = HEX.ink;

/** Every run ends the same way (market meltdown), so the headline only has to
 *  vary by how long the player lasted. */
function headlineFor(stats: SessionStats): string {
  const d = stats.daysSurvived;
  const price = Math.round(stats.oilPrice);
  if (d <= 0) return 'OIL MARKET IMPLODES ON DAY ONE — INTERN BLAMED';
  if (d <= 2) return `STRAIT FALLS ON DAY ${d} — OIL ROCKETS TO $${price}`;
  if (d <= 5) return `DAY ${d} DISASTER: DEFENDER 'DID THEIR BEST', MARKET DISAGREES`;
  return `LEGENDARY ${d}-DAY STAND ENDS IN FLAMES — OIL AT $${price}`;
}

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
    const mkButton = (
      x: number,
      w: number,
      fill: number,
      label: string,
      labelColor: string,
      onClick: () => void
    ): Phaser.GameObjects.Container => {
      const c = this.add.container(x, 610);
      const bg = this.add.rectangle(0, 0, w, 76, fill).setStrokeStyle(6, PAL.ink);
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
            confetti(this, GAME_W / 2, 240, 24);
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

    const totalMemes = Object.keys(MEMES.templates).length;
    mkButton(228, 250, PAL.ocean, 'LEADERBOARD', HEX.cream, () => void runSubmitFlow(true));
    mkButton(521, 300, PAL.green, 'DEFEND AGAIN', HEX.ink, () =>
      this.exitTo(() => this.scene.start('Game'))
    );
    const shareBtn = mkButton(799, 220, PAL.gold, 'SHARE', HEX.ink, () => void shareRun(shareBtn));
    mkButton(1052, 250, PAL.purple, `GALLERY ${getUnlockedTemplates().size}/${totalMemes}`, HEX.cream, () =>
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

    // certification stamp slams on once the score finishes counting up
    const stamp = this.add
      .text(GAME_W / 2 + 262, 198, 'OFFICIAL — HHN', {
        fontFamily: FONT_DISPLAY,
        fontSize: '22px',
        color: HEX.gold,
        stroke: HEX.ink,
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setAngle(-9);
    root.add(stamp);
    stampIn(this, stamp, reduced ? 400 : 1250);
    this.time.delayedCall(reduced ? 500 : 1200, () => {
      sfx.fanfare();
      confetti(this, GAME_W / 2, 250, 26);
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

    card.add(this.add.rectangle(0, 0, CARD.w, CARD.h, PAPER).setStrokeStyle(6, PAL.ink));
    card.add(this.add.rectangle(0, 0, CARD.w - 16, CARD.h - 16).setStrokeStyle(2, PAL.ink, 0.35));

    // masthead + dateline
    card.add(
      this.add
        .text(0, -halfH + 34, "THE HORMUZ HOLD'EM TIMES", {
          fontFamily: FONT_DISPLAY,
          fontSize: '34px',
          color: PAPER_INK
        })
        .setOrigin(0.5)
    );
    card.add(this.add.rectangle(0, -halfH + 58, CARD.w - 70, 3, PAL.ink));
    card.add(
      this.add
        .text(0, -halfH + 72, `SPECIAL EDITION  ·  DAY ${stats.daysSurvived}  ·  OIL AT $${Math.round(stats.oilPrice)}/BBL`, {
          fontFamily: FONT_SANS,
          fontSize: '13px',
          fontStyle: 'bold',
          color: PAPER_INK
        })
        .setOrigin(0.5)
        .setAlpha(0.8)
    );
    card.add(this.add.rectangle(0, -halfH + 86, CARD.w - 70, 3, PAL.ink));

    // headline + eyewitness subhead
    card.add(
      this.add
        .text(0, -halfH + 96, headlineFor(stats), {
          fontFamily: FONT_DISPLAY,
          fontSize: '38px',
          color: PAPER_INK,
          align: 'center',
          wordWrap: { width: CARD.w - 60 }
        })
        .setOrigin(0.5, 0)
    );
    const subhead = stats.memeMoment
      ? `EYEWITNESS MOMENT: “${stats.memeMoment}”`
      : `${stats.tankersSafe} TANKERS ESCORTED SAFELY · ${stats.tankersLost} LOST AT SEA`;
    card.add(
      this.add
        .text(0, -34, subhead, {
          fontFamily: FONT_SANS,
          fontSize: '16px',
          fontStyle: 'bold',
          color: PAPER_INK
        })
        .setOrigin(0.5)
        .setAlpha(0.85)
    );

    // left column — "photo": the last meme this run produced, real captions
    const photoX = -233;
    card.add(this.add.rectangle(photoX, 96, 344, 236, 0xffffff).setStrokeStyle(4, PAL.ink));
    const lastMeme = this.lastMemePick();
    if (lastMeme) {
      const photo = this.add.container(photoX, 88);
      renderMeme(this, photo, lastMeme, 320, 190);
      card.add(photo);
      card.add(
        this.add
          .text(photoX, 198, 'PHOTO: MOMENTS BEFORE DISASTER', {
            fontFamily: FONT_SANS,
            fontSize: '11px',
            fontStyle: 'bold',
            color: PAPER_INK
          })
          .setOrigin(0.5)
          .setAlpha(0.7)
      );
    } else {
      card.add(
        this.add
          .text(photoX, 96, 'NO PHOTOS SURVIVED\nTHE BLAST', {
            fontFamily: FONT_DISPLAY,
            fontSize: '22px',
            color: PAPER_INK,
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
          photoX,
          224,
          unlocks > 0
            ? `★ ${unlocks} NEW MEME${unlocks === 1 ? '' : 'S'} UNLOCKED — SEE GALLERY`
            : 'CLASSIFIEDS: TANKER CAPTAIN SEEKS NEW LINE OF WORK',
          {
            fontFamily: FONT_SANS,
            fontSize: '13px',
            fontStyle: 'bold',
            color: unlocks > 0 ? HEX.purple : PAPER_INK
          }
        )
        .setOrigin(0.5)
        .setAlpha(unlocks > 0 ? 1 : 0.6)
    );

    // right column — score + stat briefs + sparkline
    const colX = 215;
    card.add(
      this.add
        .text(colX, -8, 'FINAL SCORE', {
          fontFamily: FONT_SANS,
          fontSize: '14px',
          fontStyle: 'bold',
          color: PAPER_INK
        })
        .setOrigin(0.5)
        .setAlpha(0.75)
    );
    const scoreTxt = this.add
      .text(colX, 38, '0', {
        fontFamily: FONT_DISPLAY,
        fontSize: '54px',
        color: PAPER_INK
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
          .text(colX, 92 + i * 24, line, {
            fontFamily: FONT_SANS,
            fontSize: '15px',
            fontStyle: 'bold',
            color: PAPER_INK
          })
          .setOrigin(0.5)
          .setAlpha(0.9)
      );
    });

    this.drawSparkline(card, stats, colX, 186, 380, 60);

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
    card.add(this.add.rectangle(cx, cy, w, h, 0xffffff, 0.55).setStrokeStyle(2, PAL.ink, 0.5));
    if (hist.length >= 2) {
      const min = Math.min(...hist);
      const max = Math.max(...hist);
      const span = Math.max(1, max - min);
      const g = this.add.graphics();
      g.lineStyle(3, PAL.ink, 0.9);
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
          color: PAPER_INK
        })
        .setOrigin(0, 0.5)
        .setAlpha(0.7)
    );
  }
}
