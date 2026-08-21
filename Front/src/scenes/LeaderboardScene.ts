// Leaderboard screen — fetches paginated rows from the backend and shows the
// player's own rank (myRanking) when they have a saved best score.
// Launch with: this.scene.start('Leaderboard', { from: 'Menu' | 'Results' })
import Phaser from 'phaser';
import { FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { pressPulse } from '../core/juice';
import { settings } from '../core/settings';
import { broadcastCut, broadcastReveal } from '../core/broadcast';
import { createPostHeader } from '../core/feedChrome';
import { LeaderboardPeriod, LeaderboardResponse } from '../backend/api';
import { leaderboard } from '../backend/leaderboard';

const PERIODS: Array<{ key: LeaderboardPeriod; label: string }> = [
  { key: 'daily', label: 'TODAY' },
  { key: 'weekly', label: 'WEEK' },
  { key: 'monthly', label: 'MONTH' },
  { key: 'all', label: 'ALL TIME' }
];

const PAGE_SIZE = 10;

// Hairline divider color shared with feedChrome's card borders.
const DIVIDER = 0x2f3336;

export class LeaderboardScene extends Phaser.Scene {
  private period: LeaderboardPeriod = 'all';
  private page = 1;
  private from: string = 'Menu';
  private rows!: Phaser.GameObjects.Container;
  private statusTxt!: Phaser.GameObjects.Text;
  private pageTxt!: Phaser.GameObjects.Text;
  private tabs: Array<{ c: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Rectangle; key: LeaderboardPeriod }> = [];
  private requestSeq = 0;

  constructor() {
    super('Leaderboard');
  }

  create(data: { from?: string }): void {
    this.from = data?.from ?? 'Menu';
    this.period = 'all';
    this.page = 1;
    this.tabs = [];
    const cx = GAME_W / 2;

    if (hasArt(this, 'map_bg')) {
      this.add.image(cx, GAME_H / 2, 'map_bg').setDisplaySize(GAME_W, GAME_H).setAlpha(0.3);
      this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, PAL.ink, 0.6);
    } else {
      this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, PAL.navy);
    }

    broadcastReveal(this);
    this.add.rectangle(cx, 52, GAME_W, 88, PAL.black, 0.9).setStrokeStyle(2, DIVIDER);
    createPostHeader(this, {
      x: 24,
      y: 52,
      w: GAME_W - 48,
      handle: 'Trending in oil markets',
      subtext: 'Leaderboard · updated live'
    });

    // period tabs — 2x2 grid (was a single row of 4 spanning a 1280px canvas)
    PERIODS.forEach((p, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const c = this.add.container(cx + (col === 0 ? -120 : 120), 130 + row * 65);
      const bg = this.add.rectangle(0, 0, 200, 52, PAL.black, 0.9).setStrokeStyle(2, PAL.ocean);
      const t = this.add
        .text(0, 0, p.label, { fontFamily: FONT_SANS, fontSize: '20px', fontStyle: 'bold', color: HEX.cream })
        .setOrigin(0.5);
      c.add([bg, t]);
      c.setSize(200, 52);
      c.setInteractive({ useHandCursor: true });
      c.on('pointerdown', () => {
        if (this.period === p.key) return;
        sfx.tap();
        pressPulse(this, c);
        this.period = p.key;
        this.page = 1;
        this.refreshTabs();
        this.loadPage();
      });
      this.tabs.push({ c, bg, key: p.key });
    });

    this.rows = this.add.container(0, 0);
    this.statusTxt = this.add
      .text(cx, 245, '', { fontFamily: FONT_SANS, fontSize: '22px', fontStyle: 'bold', color: HEX.gold })
      .setOrigin(0.5);

    // pager (its own row) + back (below it) — stacked now instead of sharing
    // one row, since PREV/BACK collided once the canvas narrowed to 720px
    this.makeButton(cx - 160, 1160, 140, '◀ PREV', PAL.ocean, () => this.turnPage(-1));
    this.pageTxt = this.add
      .text(cx, 1160, '', { fontFamily: FONT_SANS, fontSize: '20px', fontStyle: 'bold', color: HEX.cream })
      .setOrigin(0.5);
    this.makeButton(cx + 160, 1160, 140, 'NEXT ▶', PAL.ocean, () => this.turnPage(1));
    this.makeButton(cx, 1230, 220, '← BACK', PAL.red, () => broadcastCut(this, () => this.scene.start(this.from)));

    this.refreshTabs();
    this.loadPage();
  }

  private refreshTabs(): void {
    for (const t of this.tabs) {
      const active = t.key === this.period;
      t.bg.setFillStyle(active ? PAL.ocean : PAL.black, active ? 0.35 : 0.9);
      t.bg.setStrokeStyle(2, active ? PAL.gold : PAL.ocean);
    }
  }

  private turnPage(dir: number): void {
    const next = this.page + dir;
    if (next < 1) return;
    this.page = next;
    this.loadPage();
  }

  private makeButton(x: number, y: number, w: number, label: string, color: number, onClick: () => void): void {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, 56, PAL.black, 0.9).setStrokeStyle(2, color);
    const t = this.add
      .text(0, 0, label, { fontFamily: FONT_SANS, fontSize: '20px', fontStyle: 'bold', color: HEX.cream })
      .setOrigin(0.5);
    c.add([bg, t]);
    c.setSize(w, 56);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerdown', () => {
      sfx.unlock();
      sfx.tap();
      pressPulse(this, c);
      onClick();
    });
  }

  private loadPage(): void {
    const seq = ++this.requestSeq;
    this.rows.removeAll(true);
    this.pageTxt.setText('');
    this.statusTxt.setText('LOADING…').setColor(HEX.gold);
    leaderboard
      .getLeaderboard(this.period, this.page, PAGE_SIZE)
      .then(res => {
        if (seq !== this.requestSeq || !this.scene.isActive()) return; // stale response
        this.render(res);
      })
      .catch(() => {
        if (seq !== this.requestSeq || !this.scene.isActive()) return;
        this.statusTxt.setText('COULD NOT REACH SERVER').setColor(HEX.red);
      });
  }

  private render(res: LeaderboardResponse): void {
    this.statusTxt.setText(res.entries.length === 0 ? 'NO SCORES YET — GO SET ONE' : '');
    this.pageTxt.setText(`PAGE ${res.page} / ${Math.max(1, res.totalPages)}`);

    const cx = GAME_W / 2;
    const top = 300; // below the 2-row tab grid
    const rowH = 42;
    const rowW = 660; // was 900, wider than the 720px portrait canvas
    const myRank = res.myRanking?.rank;

    // podium accents: gold / silver / bronze for the top three
    const MEDALS: Record<number, { color: string; stroke: number }> = {
      1: { color: HEX.gold, stroke: PAL.gold },
      2: { color: '#C8D0D8', stroke: 0xc8d0d8 },
      3: { color: '#D8925A', stroke: 0xd8925a }
    };
    res.entries.forEach((e, i) => {
      const y = top + i * rowH;
      const mine = myRank !== undefined && e.rank === myRank;
      const medal = MEDALS[e.rank];
      const rowC = this.add.container(0, 0);
      const bg = this.add
        .rectangle(cx, y, rowW, rowH - 6, mine ? PAL.ocean : PAL.black, mine ? 0.25 : 0.85)
        .setStrokeStyle(2, mine ? PAL.ocean : medal ? medal.stroke : DIVIDER, mine || medal ? 1 : 0.6);
      const color = mine ? HEX.ocean : medal ? medal.color : HEX.cream;
      const style = { fontFamily: FONT_SANS, fontSize: '19px', fontStyle: 'bold', color };
      const rankT = this.add.text(cx - rowW / 2 + 30, y, `#${e.rank}`, style).setOrigin(0, 0.5);
      const nameT = this.add.text(cx - rowW / 2 + 130, y, e.name.toUpperCase().slice(0, 20), style).setOrigin(0, 0.5);
      const scoreT = this.add.text(cx + rowW / 2 - 30, y, `${e.score}`, style).setOrigin(1, 0.5);
      rowC.add([bg, rankT, nameT, scoreT]);
      this.rows.add(rowC);
      // chart-rundown stagger: each row slides in off the right edge
      if (!settings.reducedMotion) {
        rowC.setAlpha(0);
        rowC.x = 60;
        this.tweens.add({ targets: rowC, x: 0, alpha: 1, delay: i * 45, duration: 240, ease: 'Cubic.easeOut' });
      }
    });

    // player's own rank, pinned below the list when outside the current page
    if (res.myRanking && !res.entries.some(e => e.rank === res.myRanking!.rank)) {
      const y = top + res.entries.length * rowH + 16;
      const bg = this.add.rectangle(cx, y, rowW, rowH - 4, PAL.ocean, 0.25).setStrokeStyle(2, PAL.ocean);
      const style = { fontFamily: FONT_SANS, fontSize: '19px', fontStyle: 'bold', color: HEX.ocean };
      const rankT = this.add.text(cx - rowW / 2 + 30, y, `#${res.myRanking.rank}`, style).setOrigin(0, 0.5);
      const nameT = this.add.text(cx - rowW / 2 + 130, y, `${res.myRanking.name.toUpperCase().slice(0, 16)} (YOU)`, style).setOrigin(0, 0.5);
      const scoreT = this.add.text(cx + rowW / 2 - 30, y, `${res.myRanking.score}`, style).setOrigin(1, 0.5);
      this.rows.add([bg, rankT, nameT, scoreT]);
    }
  }
}
