// Leaderboard screen — fetches paginated rows from the backend and shows the
// player's own rank (myRanking) when they have a saved best score.
// Launch with: this.scene.start('Leaderboard', { from: 'Menu' | 'Results' })
import Phaser from 'phaser';
import { FONT_DISPLAY, FONT_SANS, GAME_H, GAME_W, HEX, PAL } from '../core/palette';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { pressPulse } from '../core/juice';
import { LeaderboardPeriod, LeaderboardResponse } from '../backend/api';
import { leaderboard } from '../backend/leaderboard';

const PERIODS: Array<{ key: LeaderboardPeriod; label: string }> = [
  { key: 'daily', label: 'TODAY' },
  { key: 'weekly', label: 'WEEK' },
  { key: 'monthly', label: 'MONTH' },
  { key: 'all', label: 'ALL TIME' }
];

const PAGE_SIZE = 10;

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

    this.add.rectangle(cx, 52, GAME_W, 88, PAL.ink).setStrokeStyle(4, PAL.gold, 0.5);
    this.add
      .text(cx, 52, 'GLOBAL LEADERBOARD', {
        fontFamily: FONT_DISPLAY,
        fontSize: '40px',
        color: HEX.cream,
        stroke: HEX.ink,
        strokeThickness: 6
      })
      .setOrigin(0.5);

    // period tabs
    PERIODS.forEach((p, i) => {
      const c = this.add.container(cx - 330 + i * 220, 130);
      const bg = this.add.rectangle(0, 0, 200, 52, PAL.ocean).setStrokeStyle(4, PAL.ink);
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
      .text(cx, 380, '', { fontFamily: FONT_SANS, fontSize: '24px', fontStyle: 'bold', color: HEX.gold })
      .setOrigin(0.5);

    // pager + back
    this.makeButton(cx - 190, 668, 150, '◀ PREV', PAL.ocean, () => this.turnPage(-1));
    this.pageTxt = this.add
      .text(cx, 668, '', { fontFamily: FONT_SANS, fontSize: '20px', fontStyle: 'bold', color: HEX.cream })
      .setOrigin(0.5);
    this.makeButton(cx + 190, 668, 150, 'NEXT ▶', PAL.ocean, () => this.turnPage(1));
    this.makeButton(150, 668, 200, '← BACK', PAL.red, () => this.scene.start(this.from));

    this.refreshTabs();
    this.loadPage();
  }

  private refreshTabs(): void {
    for (const t of this.tabs) {
      t.bg.setFillStyle(t.key === this.period ? PAL.gold : PAL.ocean);
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
    const bg = this.add.rectangle(0, 0, w, 56, color).setStrokeStyle(4, PAL.ink);
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
    const top = 196;
    const rowH = 40;
    const myRank = res.myRanking?.rank;

    res.entries.forEach((e, i) => {
      const y = top + i * rowH;
      const mine = myRank !== undefined && e.rank === myRank;
      const bg = this.add
        .rectangle(cx, y, 900, rowH - 6, mine ? PAL.gold : PAL.ink, mine ? 0.9 : 0.7)
        .setStrokeStyle(2, mine ? PAL.cream : PAL.gold, mine ? 1 : 0.35);
      const color = mine ? HEX.ink : e.rank <= 3 ? HEX.gold : HEX.cream;
      const style = { fontFamily: FONT_SANS, fontSize: '21px', fontStyle: 'bold', color };
      const rankT = this.add.text(cx - 420, y, `#${e.rank}`, style).setOrigin(0, 0.5);
      const nameT = this.add.text(cx - 320, y, e.name.toUpperCase().slice(0, 24), style).setOrigin(0, 0.5);
      const scoreT = this.add.text(cx + 420, y, `${e.score}`, style).setOrigin(1, 0.5);
      this.rows.add([bg, rankT, nameT, scoreT]);
    });

    // player's own rank, pinned below the list when outside the current page
    if (res.myRanking && !res.entries.some(e => e.rank === res.myRanking!.rank)) {
      const y = top + res.entries.length * rowH + 16;
      const bg = this.add.rectangle(cx, y, 900, rowH - 4, PAL.gold, 0.95).setStrokeStyle(3, PAL.ink);
      const style = { fontFamily: FONT_SANS, fontSize: '21px', fontStyle: 'bold', color: HEX.ink };
      const rankT = this.add.text(cx - 420, y, `#${res.myRanking.rank}`, style).setOrigin(0, 0.5);
      const nameT = this.add.text(cx - 320, y, `${res.myRanking.name.toUpperCase().slice(0, 20)} (YOU)`, style).setOrigin(0, 0.5);
      const scoreT = this.add.text(cx + 420, y, `${res.myRanking.score}`, style).setOrigin(1, 0.5);
      this.rows.add([bg, rankT, nameT, scoreT]);
    }
  }
}
