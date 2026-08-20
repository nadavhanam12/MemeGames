import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { MEMES } from '../core/memes';
import { getRunUnlocks, getUnlockedTemplates } from '../core/memeUnlocks';
import { EASE, confetti, countTo } from '../core/juice';
import { broadcastCut, broadcastReveal, lowerThird, stampIn } from '../core/broadcast';
import { SessionStats, computeScore, freshStats } from '../core/state';
import { leaderboard } from '../backend/leaderboard';
import { openSubmitOverlay } from '../backend/submitOverlay';
import { analytics } from '../backend/analytics';

/** Minimal run recap: score + days survived + freshly unlocked memes, then
 *  three buttons. Everything lives in `root` so the whole screen can slide
 *  in/out as one unit; score submission still auto-flows into the
 *  leaderboard once per run (submitOverlay handles the form). */
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

    // --- content -----------------------------------------------------------
    // the title is a news lower-third: BREAKING kicker + red strap
    const title = lowerThird(this, {
      x: 90,
      y: 88,
      kicker: 'BREAKING NEWS',
      main: 'MARKET CLOSE — RUN ENDS',
      mainSize: 36
    });

    const scoreLabel = this.add
      .text(GAME_W / 2, 168, 'FINAL SCORE', {
        fontFamily: FONT_SANS,
        fontSize: '20px',
        fontStyle: 'bold',
        color: HEX.gold
      })
      .setOrigin(0.5)
      .setAlpha(0.9);

    const scoreTxt = this.add
      .text(GAME_W / 2, 238, '0', {
        fontFamily: FONT_DISPLAY,
        fontSize: '92px',
        color: HEX.gold,
        stroke: HEX.ink,
        strokeThickness: 10
      })
      .setOrigin(0.5);

    const days = this.add
      .text(GAME_W / 2, 322, `☀ ${stats.daysSurvived} ${stats.daysSurvived === 1 ? 'DAY' : 'DAYS'} SURVIVED`, {
        fontFamily: FONT_DISPLAY,
        fontSize: '30px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 6
      })
      .setOrigin(0.5);

    const memeRow = this.buildUnlockRow(430);

    root.add([title, scoreLabel, scoreTxt, days, memeRow]);

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

    const totalMemes = Object.keys(MEMES.templates).length;
    const btns = [
      mkButton(GAME_W / 2 - 330, 260, PAL.ocean, 'LEADERBOARD', HEX.cream, () => void runSubmitFlow(true)),
      mkButton(GAME_W / 2, 320, PAL.green, 'DEFEND AGAIN', HEX.ink, () =>
        this.exitTo(() => this.scene.start('Game'))
      ),
      mkButton(GAME_W / 2 + 330, 260, PAL.purple, `GALLERY ${getUnlockedTemplates().size}/${totalMemes}`, HEX.cream, () =>
        this.exitTo(() => this.scene.start('Gallery', { from: 'Results' }))
      )
    ];

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

    // title (the lower-third) animates itself; the rest fly in as sequential
    // graphics packages with a whoosh per wave
    slideIn(scoreLabel, 120);
    slideIn(scoreTxt, 180);
    slideIn(days, 340);
    slideIn(memeRow, 480);
    btns.forEach((btn, i) => slideIn(btn, 620 + i * 90, 40));
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

  /** Centered row of memes unlocked for the first time this run; falls back
   *  to a quiet collection-count line when there were none. */
  private buildUnlockRow(y: number): Phaser.GameObjects.Container {
    const c = this.add.container(GAME_W / 2, y);
    const ids = getRunUnlocks().filter(id => MEMES.templates[id]);

    if (!ids.length) {
      c.add(
        this.add
          .text(0, 0, 'NO NEW MEMES THIS RUN', {
            fontFamily: FONT_SANS,
            fontSize: '18px',
            fontStyle: 'bold',
            color: HEX.cream
          })
          .setOrigin(0.5)
          .setAlpha(0.55)
      );
      return c;
    }

    c.add(
      this.add
        .text(0, -78, `★ ${ids.length} NEW MEME${ids.length === 1 ? '' : 'S'} UNLOCKED`, {
          fontFamily: FONT_DISPLAY,
          fontSize: '22px',
          color: HEX.purple,
          stroke: HEX.ink,
          strokeThickness: 5
        })
        .setOrigin(0.5)
    );

    const shown = ids.slice(0, 6);
    const H = 96;
    const gap = 14;
    const widths = shown.map(id => {
      const tpl = MEMES.templates[id];
      return Math.min(170, Math.max(48, Math.round(H / tpl.aspect)));
    });
    const extra = ids.length - shown.length;
    const extraW = extra > 0 ? 60 : 0;
    const rowW = widths.reduce((a, b) => a + b + gap, -gap) + (extra > 0 ? gap + extraW : 0);

    let x = -rowW / 2;
    shown.forEach((id, i) => {
      const tpl = MEMES.templates[id];
      const w = widths[i];
      const cx = x + w / 2;
      if (hasArt(this, tpl.artKey)) {
        c.add(this.add.image(cx, 0, tpl.artKey).setDisplaySize(w, H));
      } else {
        c.add(this.add.rectangle(cx, 0, w, H, 0x39424e));
      }
      c.add(this.add.rectangle(cx, 0, w, H).setStrokeStyle(4, PAL.purple));
      x += w + gap;
    });
    if (extra > 0) {
      c.add(this.add.rectangle(x + extraW / 2, 0, extraW, H, PAL.ink, 0.8).setStrokeStyle(4, PAL.purple));
      c.add(
        this.add
          .text(x + extraW / 2, 0, `+${extra}`, {
            fontFamily: FONT_DISPLAY,
            fontSize: '26px',
            color: HEX.purple
          })
          .setOrigin(0.5)
      );
    }
    return c;
  }
}
