import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { settings } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { MEMES, getMemeLog } from '../core/memes';
import { EASE, confetti, countTo, popIn } from '../core/juice';
import { SessionStats, computeScore, freshStats } from '../core/state';
import { leaderboard } from '../backend/leaderboard';
import { openSubmitOverlay } from '../backend/submitOverlay';

interface Rank {
  name: string;
  color: string;
}

function computeRank(s: SessionStats): Rank {
  const score = computeScore(s); // survival time dominates in endless mode
  if (score >= 420) return { name: 'HORMUZ LEGEND', color: HEX.purple };
  if (score >= 280) return { name: 'MARKET WHISPERER', color: HEX.gold };
  if (score >= 170) return { name: 'CERTIFIED BOAT GUARDIAN', color: HEX.green };
  if (score >= 80) return { name: 'JUNIOR ANALYST', color: HEX.orange };
  return { name: 'THOUGHTS & PRAYERS DEPT.', color: HEX.red };
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function memeCaption(
  s: SessionStats,
  rank: Rank
): { top: string; bottom: string; mood: 'happy' | 'sweat' | 'chaos' } {
  const delta = s.oilPrice - s.startPrice;
  if (s.tankersLost === 0 && delta < -10)
    return { top: 'ECONOMISTS: "IMPOSSIBLE"', bottom: `THIS PLAYER: −$${Math.abs(delta).toFixed(0)} OIL`, mood: 'happy' };
  if (s.nearMisses >= 2) return { top: 'CALM ROOM', bottom: `${s.nearMisses} LAST-SECOND SAVES LATER…`, mood: 'sweat' };
  if (s.tankersLost >= 2)
    return { top: 'EXPECTATION: SAFE STRAIT', bottom: `REALITY: ${s.tankersLost} TANKERS ON THE NEWS`, mood: 'chaos' };
  if (delta > 5) return { top: 'SPOKESPERSON: "ALL UNDER CONTROL"', bottom: `OIL: +$${delta.toFixed(0)}`, mood: 'sweat' };
  return { top: `${rank.name}?`, bottom: `${s.intercepts} BONKS. ZERO REGRETS.`, mood: 'happy' };
}

// generated portrait per mood (fallback: drawn cartoon face)
const MOOD_PORTRAIT: Record<'happy' | 'sweat' | 'chaos', string> = {
  happy: 'charDealmaker',
  sweat: 'charSpokesperson',
  chaos: 'charAnalystPanic'
};

export class ResultsScene extends Phaser.Scene {
  private step = 0;
  private steps: Array<() => void> = [];
  private stepTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super('Results');
  }

  create(): void {
    const stats = (this.registry.get('finalStats') as SessionStats) ?? freshStats();
    const rank = computeRank(stats);
    this.step = 0;

    if (hasArt(this, 'map_bg')) {
      this.add.image(GAME_W / 2, GAME_H / 2, 'map_bg').setDisplaySize(GAME_W, GAME_H).setAlpha(0.3);
      this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, PAL.ink, 0.55);
    } else {
      this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, PAL.navy);
    }
    this.add.rectangle(GAME_W / 2, 52, GAME_W, 88, PAL.ink).setStrokeStyle(4, PAL.gold, 0.5);
    this.add
      .text(GAME_W / 2, 52, 'MARKET CLOSE', {
        fontFamily: FONT_DISPLAY,
        fontSize: '42px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 6
      })
      .setOrigin(0.5);

    // left column: graph, price, stats. right column: rank + meme card.
    const lx = 330;
    const delta = stats.oilPrice - stats.startPrice;
    const good = delta <= 0;

    const graphG = this.add.graphics();
    const priceTxt = this.add
      .text(lx, 300, '', {
        fontFamily: FONT_DISPLAY,
        fontSize: '54px',
        color: good ? HEX.green : HEX.red,
        stroke: HEX.ink,
        strokeThickness: 8
      })
      .setOrigin(0.5)
      .setAlpha(0);

    const statLines: Phaser.GameObjects.Text[] = [];
    const mkStat = (i: number, label: string, value: string): void => {
      const t = this.add
        .text(lx, 390 + i * 40, `${label}   ${value}`, {
          fontFamily: FONT_SANS,
          fontSize: '22px',
          fontStyle: 'bold',
          color: HEX.cream,
          stroke: HEX.ink,
          strokeThickness: 4
        })
        .setOrigin(0.5)
        .setAlpha(0);
      statLines.push(t);
    };
    mkStat(0, 'SURVIVED', fmtTime(stats.survivalTime));
    mkStat(1, 'SCORE', `${computeScore(stats)}`);
    mkStat(2, 'TANKERS SAFE / LOST', `${stats.tankersSafe} / ${stats.tankersLost}`);
    mkStat(3, 'INTERCEPTIONS', `${stats.intercepts}  (best combo ×${stats.bestCombo})`);
    mkStat(4, 'LAST-SECOND SAVES', `${stats.nearMisses}`);

    const rankC = this.add.container(950, 170).setAlpha(0);
    const rankBg = this.add
      .rectangle(0, 0, 560, 80, PAL.ink)
      .setStrokeStyle(6, Phaser.Display.Color.HexStringToColor(rank.color).color);
    const rankT = this.add
      .text(0, 0, rank.name, { fontFamily: FONT_DISPLAY, fontSize: '34px', color: rank.color, stroke: HEX.ink, strokeThickness: 4 })
      .setOrigin(0.5);
    rankC.add([rankBg, rankT]);

    const meme = this.buildMemeCard(stats, rank);
    meme.setAlpha(0);

    const memeChain = this.buildMemeChain();
    memeChain?.setAlpha(0);

    const replay = this.add.container(950, 655).setAlpha(0);
    const rb = this.add.rectangle(0, 0, 340, 80, PAL.green).setStrokeStyle(6, PAL.ink);
    const rt = this.add.text(0, 0, 'DEFEND AGAIN', { fontFamily: FONT_DISPLAY, fontSize: '30px', color: HEX.ink }).setOrigin(0.5);
    replay.add([rb, rt]);
    replay.setSize(340, 80);

    // online: submit the run's score + view the global leaderboard.
    // Flags are keyed to this run's stats object so revisiting the results
    // screen (back from the leaderboard) doesn't re-prompt or re-submit.
    const finalScore = computeScore(stats);
    let submitted = this.registry.get('submittedFor') === stats;

    const submitBtn = this.add.container(190, 655).setAlpha(0);
    const sbBg = this.add.rectangle(0, 0, 280, 70, PAL.gold).setStrokeStyle(6, PAL.ink);
    const sbTxt = this.add
      .text(0, 0, 'SUBMIT SCORE', { fontFamily: FONT_DISPLAY, fontSize: '24px', color: HEX.ink })
      .setOrigin(0.5);
    submitBtn.add([sbBg, sbTxt]);
    submitBtn.setSize(280, 70);
    if (submitted) {
      sbBg.setFillStyle(0x39424e);
      sbTxt.setText('SUBMITTED ✓').setColor(HEX.cream);
    }

    const lbBtn = this.add.container(490, 655).setAlpha(0);
    const lbBg = this.add.rectangle(0, 0, 280, 70, PAL.ocean).setStrokeStyle(6, PAL.ink);
    const lbTxt = this.add
      .text(0, 0, 'LEADERBOARD', { fontFamily: FONT_DISPLAY, fontSize: '24px', color: HEX.cream })
      .setOrigin(0.5);
    lbBtn.add([lbBg, lbTxt]);
    lbBtn.setSize(280, 70);

    // Game-end flow: submit form (skippable) → leaderboard. Also reachable
    // manually via the buttons if the player comes back from the leaderboard.
    let overlayOpen = false;
    const runSubmitFlow = async (): Promise<void> => {
      if (overlayOpen) return;
      let outcome = null;
      if (!submitted) {
        overlayOpen = true;
        outcome = await openSubmitOverlay(leaderboard, finalScore);
        overlayOpen = false;
      }
      if (outcome) {
        submitted = true;
        this.registry.set('submittedFor', stats);
        sbBg.setFillStyle(0x39424e);
        const r = outcome.response;
        if (r.saved) {
          sbTxt.setText('NEW BEST ✓').setColor(HEX.cream);
          sfx.fanfare();
          confetti(this, 190, 600, 24);
        } else {
          sbTxt.setText(`BEST: ${r.newBest}`).setColor(HEX.cream);
          sfx.tap();
        }
      }
      // show the current standings whether they submitted or skipped
      const pause = outcome?.response.saved ? 900 : 250;
      this.time.delayedCall(pause, () => {
        if (this.scene.isActive()) this.scene.start('Leaderboard', { from: 'Results' });
      });
    };

    this.steps = [
      () => this.drawFinalGraph(graphG, stats.priceHistory, lx, 185, 520, 110),
      () => {
        priceTxt.setAlpha(1).setText(`$${stats.oilPrice.toFixed(2)}`);
        countTo(this, priceTxt, stats.startPrice, stats.oilPrice, v => `$${v.toFixed(2)}`, 600);
        this.add
          .text(lx, 348, `${good ? '▼' : '▲'} ${Math.abs(delta).toFixed(2)} FROM OPEN`, {
            fontFamily: FONT_SANS,
            fontSize: '20px',
            fontStyle: 'bold',
            color: good ? HEX.green : HEX.red
          })
          .setOrigin(0.5);
        if (good) sfx.priceDown();
        else sfx.priceUp();
      },
      ...statLines.map(t => () => {
        t.setAlpha(1);
        popIn(this, t, 200);
        sfx.tap();
      }),
      () => {
        rankC.setAlpha(1);
        popIn(this, rankC, 350);
        sfx.comboSting(2);
      },
      () => {
        sfx.whoosh();
        if (memeChain) {
          memeChain.setAlpha(1);
          popIn(this, memeChain, 300);
        }
      },
      () => {
        meme.setAlpha(1);
        popIn(this, meme, 450);
        sfx.fanfare();
        confetti(this, 950, 400, 30);
        replay.setAlpha(1);
        popIn(this, replay, 300);
        submitBtn.setAlpha(1);
        popIn(this, submitBtn, 300);
        lbBtn.setAlpha(1);
        popIn(this, lbBtn, 300);
        // let the meme card land, then roll into submit → leaderboard
        // (once per run — not again when returning from the leaderboard)
        if (this.registry.get('autoFlowFor') !== stats) {
          this.registry.set('autoFlowFor', stats);
          this.time.delayedCall(1400, () => void runSubmitFlow());
        }
      }
    ];

    const stepDelay = settings.reducedMotion ? 220 : 420;
    this.stepTimer = this.time.addEvent({
      delay: stepDelay,
      repeat: this.steps.length - 1,
      callback: () => this.runStep()
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.step < this.steps.length) {
        while (this.step < this.steps.length) this.runStep();
        this.stepTimer?.remove();
        return;
      }
      if (Phaser.Geom.Rectangle.Contains(replay.getBounds(), p.x, p.y)) {
        sfx.unlock();
        sfx.tap();
        this.scene.start('Game');
        return;
      }
      if (Phaser.Geom.Rectangle.Contains(submitBtn.getBounds(), p.x, p.y)) {
        sfx.unlock();
        sfx.tap();
        void runSubmitFlow();
        return;
      }
      if (Phaser.Geom.Rectangle.Contains(lbBtn.getBounds(), p.x, p.y)) {
        sfx.unlock();
        sfx.tap();
        this.scene.start('Leaderboard', { from: 'Results' });
      }
    });
  }

  private runStep(): void {
    if (this.step < this.steps.length) {
      this.steps[this.step]();
      this.step++;
    }
  }

  private drawFinalGraph(g: Phaser.GameObjects.Graphics, hist: number[], cx: number, y: number, w: number, h: number): void {
    const x0 = cx - w / 2;
    const data = hist.length > 1 ? hist : [112, 112];
    const min = Math.min(...data) - 2;
    const max = Math.max(...data) + 2;
    const state = { t: 0 };
    this.tweens.add({
      targets: state,
      t: 1,
      duration: settings.reducedMotion ? 200 : 700,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        g.clear();
        g.fillStyle(0x22303e, 1);
        g.fillRect(x0, y - h / 2, w, h);
        g.lineStyle(2, PAL.gold, 0.3);
        g.strokeRect(x0, y - h / 2, w, h);
        g.lineStyle(4, PAL.gold, 1);
        const n = Math.max(2, Math.floor(data.length * state.t));
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const px = x0 + (i / (data.length - 1)) * w;
          const py = y + h / 2 - ((data[i] - min) / (max - min)) * h;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.strokePath();
      }
    });
  }

  /** Bottom strip: every meme that fired during the run, oldest → newest.
   *  Art-only thumbnails (captions are unreadable at this size). */
  private buildMemeChain(): Phaser.GameObjects.Container | null {
    const log = getMemeLog();
    const entries = log.map(v => MEMES.templates[v.t]).filter(Boolean);
    if (!entries.length) return null;

    const H = 48;
    const gap = 8;
    const labelW = 170;
    const maxRowW = GAME_W - 140 - labelW;
    const widths = entries.map(tpl => Math.max(32, Math.round(H / tpl.aspect)));
    // oldest memes drop first if the row would overflow
    while (widths.length > 1 && widths.reduce((a, b) => a + b + gap, -gap) > maxRowW) {
      widths.shift();
      entries.shift();
    }
    const rowW = widths.reduce((a, b) => a + b + gap, -gap);

    const c = this.add.container(GAME_W / 2, 592);
    c.add(
      this.add
        .text(-rowW / 2 - 14, 0, 'RUN IN MEMES →', {
          fontFamily: FONT_SANS,
          fontSize: '15px',
          fontStyle: 'bold',
          color: HEX.gold
        })
        .setOrigin(1, 0.5)
    );
    let x = -rowW / 2;
    entries.forEach((tpl, i) => {
      const w = widths[i];
      const cardX = x + w / 2;
      if (hasArt(this, tpl.artKey)) {
        c.add(this.add.image(cardX, 0, tpl.artKey).setDisplaySize(w, H));
      } else {
        c.add(this.add.rectangle(cardX, 0, w, H, 0x39424e));
      }
      c.add(this.add.rectangle(cardX, 0, w, H).setStrokeStyle(3, PAL.ink));
      x += w + gap;
    });
    return c;
  }

  /** Shareable meme card — uses generated character portraits when available. */
  private buildMemeCard(stats: SessionStats, rank: Rank): Phaser.GameObjects.Container {
    const cap = memeCaption(stats, rank);
    const c = this.add.container(950, 420);
    const bgColor = cap.mood === 'happy' ? PAL.green : cap.mood === 'sweat' ? PAL.gold : PAL.red;
    const bg = this.add.rectangle(0, 0, 580, 300, bgColor).setStrokeStyle(8, PAL.ink);
    c.add(bg);

    const portraitKey = MOOD_PORTRAIT[cap.mood];
    if (hasArt(this, portraitKey)) {
      const img = this.add.image(-185, 0, portraitKey).setDisplaySize(200, 200);
      const frame = this.add.rectangle(-185, 0, 204, 204).setStrokeStyle(6, PAL.ink);
      c.add([img, frame]);
    } else {
      c.add(this.drawFallbackFace(cap.mood, -185));
    }

    const top = this.add
      .text(110, -95, cap.top, {
        fontFamily: FONT_DISPLAY,
        fontSize: '24px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 6,
        align: 'center',
        wordWrap: { width: 320 }
      })
      .setOrigin(0.5);
    const bottom = this.add
      .text(110, -10, cap.bottom, {
        fontFamily: FONT_DISPLAY,
        fontSize: '27px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 6,
        align: 'center',
        wordWrap: { width: 320 }
      })
      .setOrigin(0.5);
    const stat = this.add
      .text(110, 75, `CLOSE: $${stats.oilPrice.toFixed(2)} • SAFE: ${stats.tankersSafe} • COMBO ×${stats.bestCombo}`, {
        fontFamily: FONT_SANS,
        fontSize: '16px',
        fontStyle: 'bold',
        color: HEX.ink,
        align: 'center',
        wordWrap: { width: 330 }
      })
      .setOrigin(0.5);
    const brand = this.add
      .text(265, 130, 'MEMEGAMES', { fontFamily: FONT_SANS, fontSize: '13px', fontStyle: 'bold', color: HEX.ink })
      .setOrigin(1, 0.5)
      .setAlpha(0.7);
    c.add([top, bottom, stat, brand]);
    return c;
  }

  private drawFallbackFace(mood: 'happy' | 'sweat' | 'chaos', fx: number): Phaser.GameObjects.Graphics {
    const face = this.add.graphics();
    face.fillStyle(0xffd9a8, 1);
    face.lineStyle(6, PAL.ink, 1);
    face.fillCircle(fx, 0, 70);
    face.strokeCircle(fx, 0, 70);
    face.fillStyle(0xffffff, 1);
    face.fillCircle(fx - 25, -12, 16);
    face.fillCircle(fx + 25, -12, 16);
    face.fillStyle(PAL.ink, 1);
    face.fillCircle(fx - 22, -10, 6);
    face.fillCircle(fx + 28, -10, 6);
    face.lineStyle(7, PAL.ink, 1);
    if (mood === 'happy') {
      face.lineBetween(fx - 40, -36, fx - 12, -30);
      face.lineBetween(fx + 12, -30, fx + 40, -36);
      face.beginPath();
      face.arc(fx, 22, 26, 0.15 * Math.PI, 0.85 * Math.PI);
      face.strokePath();
    } else if (mood === 'sweat') {
      face.lineBetween(fx - 40, -30, fx - 12, -38);
      face.lineBetween(fx + 12, -38, fx + 40, -30);
      face.lineBetween(fx - 18, 32, fx + 18, 32);
      face.fillStyle(0x8fd6ef, 1);
      face.fillCircle(fx + 55, -35, 9);
    } else {
      face.lineBetween(fx - 40, -42, fx - 12, -28);
      face.lineBetween(fx + 12, -28, fx + 40, -42);
      face.beginPath();
      face.arc(fx, 42, 20, 1.15 * Math.PI, 1.85 * Math.PI);
      face.strokePath();
    }
    return face;
  }
}
