// Shared "X/Twitter feed post" screen language: avatar/handle post headers,
// the engagement icon row, stackable comment lines, "suggested for you"
// cards, and the trending pill. Every scene composes these instead of
// hand-rolling feed-post styling, so the whole game reads as one timeline.
// All animation respects settings.reducedMotion.
import Phaser from 'phaser';
import { FONT_SANS, HEX, PAL } from './palette';
import { settings } from './settings';
import { countTo } from './juice';

/** Card corner radius shared by every rounded chrome element. */
const RADIUS = 14;
/** Hairline divider color between feed sections. */
const DIVIDER = 0x2f3336;

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Draws a filled (and optionally stroked) rounded rect centered on (0,0)
 *  inside its own Graphics object, so callers can just `container.add()` it. */
function roundedRect(
  scene: Phaser.Scene,
  w: number,
  h: number,
  fill: number,
  fillAlpha = 1,
  radius = RADIUS,
  strokeColor?: number,
  strokeWidth = 2,
  strokeAlpha = 1
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(fill, fillAlpha);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
  if (strokeColor !== undefined) {
    g.lineStyle(strokeWidth, strokeColor, strokeAlpha);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
  }
  return g;
}

/** Compact "1.2K"-style formatter for engagement counts. */
function formatCount(v: number): string {
  const n = Math.round(v);
  if (n >= 10000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

export interface PostHeaderOpts {
  x: number;
  y: number;
  w: number;
  avatarColor?: number;
  handle: string;
  subtext: string;
  live?: boolean;
}

/** Avatar circle + bold handle + muted subtext (timestamp/status), with an
 *  optional pulsing "LIVE" badge pinned to the right edge. Used for the
 *  game HUD header and reskinned as a profile header on Menu/Results/
 *  Leaderboard. Origin is (opts.x, opts.y); content is left-aligned from
 *  there, badge right-aligned against opts.w. */
export function createPostHeader(scene: Phaser.Scene, opts: PostHeaderOpts): Phaser.GameObjects.Container {
  const c = scene.add.container(opts.x, opts.y);
  const avatarR = 22;
  const avatar = scene.add.circle(avatarR, 0, avatarR, opts.avatarColor ?? PAL.ocean);
  const textX = avatarR * 2 + 12;
  const handle = scene.add
    .text(textX, -13, opts.handle, {
      fontFamily: FONT_SANS,
      fontSize: '20px',
      fontStyle: 'bold',
      color: HEX.cream
    })
    .setOrigin(0, 0.5);
  const subtext = scene.add
    .text(textX, 14, opts.subtext, {
      fontFamily: FONT_SANS,
      fontSize: '15px',
      color: HEX.muted
    })
    .setOrigin(0, 0.5);
  c.add([avatar, handle, subtext]);

  if (opts.live) {
    const badge = scene.add.container(opts.w - 14, 0);
    const label = scene.add
      .text(-8, 0, 'LIVE', {
        fontFamily: FONT_SANS,
        fontSize: '14px',
        fontStyle: 'bold',
        color: HEX.red
      })
      .setOrigin(1, 0.5);
    const dot = scene.add.circle(-8 - label.width - 10, 0, 5, PAL.red);
    badge.add([dot, label]);
    c.add(badge);
    if (!settings.reducedMotion) {
      scene.tweens.add({ targets: dot, alpha: 0.25, duration: 600, yoyo: true, repeat: -1 });
    }
  }
  return c;
}

export interface EngagementIconOpts {
  /** Unicode/emoji glyph drawn as text (no icon font in this project). */
  glyph: string;
  count: number;
  /** Defaults to muted gray; pass PAL.green (or similar) for the "hot" icon. */
  color?: number;
}

export interface EngagementBarOpts {
  x: number;
  y: number;
  w: number;
  icons: EngagementIconOpts[];
}

export interface EngagementBar {
  container: Phaser.GameObjects.Container;
  /** Animates each icon's displayed count toward the new values (count-up
   *  via juice.ts's countTo), in the same order as opts.icons. */
  setCounts(counts: number[]): void;
}

/** Row of glyph+count pairs evenly spaced across width w — reply/retweet/
 *  like/views/share style engagement bar. */
export function createEngagementBar(scene: Phaser.Scene, opts: EngagementBarOpts): EngagementBar {
  const c = scene.add.container(opts.x, opts.y);
  const n = Math.max(opts.icons.length, 1);
  const slot = opts.w / n;
  const countTexts: Phaser.GameObjects.Text[] = [];
  const current: number[] = [];

  opts.icons.forEach((icon, i) => {
    const cx = slot * i + slot / 2;
    const color = toHex(icon.color ?? PAL.muted);
    const glyph = scene.add
      .text(cx, -7, icon.glyph, { fontFamily: FONT_SANS, fontSize: '20px', color })
      .setOrigin(0.5);
    const countTxt = scene.add
      .text(cx, 15, formatCount(icon.count), {
        fontFamily: FONT_SANS,
        fontSize: '14px',
        fontStyle: 'bold',
        color
      })
      .setOrigin(0.5);
    current.push(icon.count);
    countTexts.push(countTxt);
    c.add([glyph, countTxt]);
  });

  return {
    container: c,
    setCounts(counts: number[]) {
      counts.forEach((val, i) => {
        const txt = countTexts[i];
        if (!txt) return;
        const from = current[i] ?? val;
        current[i] = val;
        countTo(scene, txt, from, val, formatCount, 500);
      });
    }
  };
}

export interface CommentRowOpts {
  x: number;
  y: number;
  w: number;
  avatarColor?: number;
  handle: string;
  text: string;
}

/** Single stackable comment line: small avatar + bold handle + regular body
 *  text, e.g. a meme-unlock or NPC reaction. Stack several at a fixed row
 *  height for the comments strip. */
export function createCommentRow(scene: Phaser.Scene, opts: CommentRowOpts): Phaser.GameObjects.Container {
  const c = scene.add.container(opts.x, opts.y);
  const avatarR = 14;
  const avatar = scene.add.circle(avatarR, 0, avatarR, opts.avatarColor ?? PAL.purple);
  const textX = avatarR * 2 + 10;
  const handle = scene.add
    .text(textX, 0, `${opts.handle} `, {
      fontFamily: FONT_SANS,
      fontSize: '15px',
      fontStyle: 'bold',
      color: HEX.cream
    })
    .setOrigin(0, 0.5);
  const body = scene.add
    .text(textX + handle.width, 0, opts.text, {
      fontFamily: FONT_SANS,
      fontSize: '15px',
      color: HEX.muted,
      wordWrap: { width: Math.max(opts.w - textX - handle.width - 8, 40) }
    })
    .setOrigin(0, 0.5);
  c.add([avatar, handle, body]);
  return c;
}

export interface SuggestedCardOpts {
  x: number;
  y: number;
  w: number;
  h: number;
  icon?: string;
  title: string;
  subtitle: string;
  onClick?: () => void;
}

/** Bordered "suggested for you" box: optional glyph icon, bold title, muted
 *  subtitle (e.g. price/cost) — used for shop/upgrade tiles on the day
 *  summary screen. Interactive (hover-scale + click) only when onClick is
 *  given, matching the upgrade-card idiom used elsewhere in the game. */
export function createSuggestedCard(scene: Phaser.Scene, opts: SuggestedCardOpts): Phaser.GameObjects.Container {
  const c = scene.add.container(opts.x, opts.y);
  const bg = roundedRect(scene, opts.w, opts.h, PAL.black, 1, RADIUS, DIVIDER, 2);
  const parts: Phaser.GameObjects.GameObject[] = [bg];

  let textX = -opts.w / 2 + 16;
  if (opts.icon) {
    const icon = scene.add.text(textX, 0, opts.icon, { fontFamily: FONT_SANS, fontSize: '26px' }).setOrigin(0, 0.5);
    parts.push(icon);
    textX += icon.width + 12;
  }
  const wrapW = Math.max(opts.w / 2 - textX - 14, 40);
  const title = scene.add
    .text(textX, -opts.h / 2 + 20, opts.title, {
      fontFamily: FONT_SANS,
      fontSize: '16px',
      fontStyle: 'bold',
      color: HEX.cream,
      wordWrap: { width: wrapW }
    })
    .setOrigin(0, 0.5);
  const subtitle = scene.add
    .text(textX, opts.h / 2 - 18, opts.subtitle, {
      fontFamily: FONT_SANS,
      fontSize: '14px',
      color: HEX.muted,
      wordWrap: { width: wrapW }
    })
    .setOrigin(0, 0.5);
  parts.push(title, subtitle);
  c.add(parts);

  if (opts.onClick) {
    c.setSize(opts.w, opts.h);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerover', () => scene.tweens.add({ targets: c, scale: 1.03, duration: 100 }));
    c.on('pointerout', () => scene.tweens.add({ targets: c, scale: 1, duration: 100 }));
    c.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      opts.onClick?.();
    });
  }
  return c;
}

export interface TrendingPillOpts {
  x: number;
  y: number;
  text: string;
  urgent?: boolean;
}

/** Small rounded-pill badge — replaces the old danger banner, e.g.
 *  "⚠ meltdown in 8s". Pulses gently when urgent (skipped under reduced
 *  motion). Origin is the pill's center. */
export function createTrendingPill(scene: Phaser.Scene, opts: TrendingPillOpts): Phaser.GameObjects.Container {
  const c = scene.add.container(opts.x, opts.y);
  const label = scene.add
    .text(0, 0, opts.text, { fontFamily: FONT_SANS, fontSize: '15px', fontStyle: 'bold', color: HEX.cream })
    .setOrigin(0.5);
  const padX = 16;
  const padY = 8;
  const w = label.width + padX * 2;
  const h = label.height + padY * 2;
  const bg = roundedRect(
    scene,
    w,
    h,
    opts.urgent ? PAL.red : PAL.ocean,
    0.92,
    h / 2,
    opts.urgent ? PAL.gold : PAL.cream,
    2,
    0.5
  );
  c.add([bg, label]);
  if (opts.urgent && !settings.reducedMotion) {
    scene.tweens.add({ targets: c, scale: 1.06, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  return c;
}
