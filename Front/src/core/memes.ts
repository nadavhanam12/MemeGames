// Meme reaction library: picks a meme variant for a game moment and renders it
// (generated template art when available, drawn placeholder otherwise).
// All content — templates, slot geometry, per-trigger caption variants — lives
// in src/config/memes.json; add a meme there, no code changes needed.
import Phaser from 'phaser';
import { hasArt } from './art';
import { FONT_SANS } from './palette';
import { recordMemeShown } from './memeUnlocks';
import DATA from '../config/memes.json';

export interface MemeSlot {
  x: number; // caption center, fraction of rendered width (origin = art center)
  y: number; // caption center, fraction of rendered height
  w: number; // word-wrap width, fraction of rendered width
  size?: number; // font px (default 13)
  stroke?: boolean; // true = white text with dark outline (photo-overlay style)
  color?: string;
}

export interface MemeTemplate {
  artKey: string; // canonical texture key (merged into ART_MAP by src/core/art.ts)
  artFile: string; // file produced by `npm run art` for that key
  label: string; // shown on the drawn placeholder when art is missing
  aspect: number; // height / width of the template art
  boxes: number[][]; // placeholder image-area rects [x, y, w, h], normalized like slots
  slots: MemeSlot[];
}

// Built by GameScene at emit time and passed with every 'meme-moment'. Optional
// end-to-end: pickMeme treats a missing ctx as "no conditions match", i.e. the
// old uniform-random behavior (dev console / back-compat callers keep working).
export interface MemeContext {
  price: number; // stats.oilPrice, rounded
  trend: 'rising' | 'falling' | 'stable';
  tankersLost: number; // stats.tankersLost
  tankersSafe: number; // stats.tankersSafe
  combo: number; // stats.combo
  eventActive: boolean;
  eventsWon: number;
  eventsLost: number;
  elapsed: number; // seconds into the run
  dangerActive: boolean; // meltdown countdown currently running
  threats: number; // threats.length (alive, on-screen)
}

// `when` clause values: numeric fields accept ">=N" / "<=N" / ">N" / "<N" /
// "N..M" (inclusive range) / a bare number (exact); `trend` accepts a string
// or array-of-strings (OR); boolean fields accept true/false.
type MemeWhen = Partial<Record<keyof MemeContext, string | number | boolean | string[]>>;

interface MemeVariant {
  t: string; // template key
  c: string[]; // captions, one per slot (in slot order) — may contain {price}/{combo}/{lost} tokens
  when?: MemeWhen; // hard eligibility filter — all clauses must pass
  weight?: number; // optional multiplier among eligible variants, default 1
}

interface WatcherTuning {
  cooldownSec: number;
  rearmSec: number;
  comboMin?: number;
  priceHigh?: number;
  priceLow?: number;
  lostMin?: number;
  quietSec?: number;
  maxThreats?: number;
  graceSec?: number;
}

interface MemeData {
  settings: {
    durationMs: number;
    streakCombo: number;
    countdownTickMs: number;
    minGapMs: number;
    trendWindowSec: number;
    trendBand: number;
    watchers: { dissonance: WatcherTuning; quiet: WatcherTuning };
  };
  templates: Record<string, MemeTemplate>;
  triggers: Record<string, MemeVariant[]>;
  fallback: MemeVariant[];
}

export const MEMES = DATA as unknown as MemeData;

export interface MemePick {
  tpl: MemeTemplate;
  captions: string[];
}

// Every meme shown during the current run, in order — the results screen
// replays this as the run's meme chain. Captions here are the *substituted*
// strings (tokens already resolved), so the recap replays real run numbers.
let memeLog: MemeVariant[] = [];

export function resetMemeLog(): void {
  memeLog = [];
}

export function getMemeLog(): ReadonlyArray<{ t: string; c: string[] }> {
  return memeLog;
}

let lastTemplate = '';

// -------------------------------------------------------------- when-filter
const warnedOnce = new Set<string>();
function devWarnOnce(msg: string): void {
  if (import.meta.env.DEV && !warnedOnce.has(msg)) {
    warnedOnce.add(msg);
    console.warn(msg);
  }
}

/** N, ">=N", "<=N", ">N", "<N", "N..M" (inclusive). Returns undefined if malformed. */
function evalNumericCond(actual: number, cond: string): boolean | undefined {
  if (/^-?\d+(\.\d+)?\.\.-?\d+(\.\d+)?$/.test(cond)) {
    const [a, b] = cond.split('..').map(Number);
    return actual >= a && actual <= b;
  }
  if (cond.startsWith('>=')) {
    const n = Number(cond.slice(2));
    return Number.isNaN(n) ? undefined : actual >= n;
  }
  if (cond.startsWith('<=')) {
    const n = Number(cond.slice(2));
    return Number.isNaN(n) ? undefined : actual <= n;
  }
  if (cond.startsWith('>')) {
    const n = Number(cond.slice(1));
    return Number.isNaN(n) ? undefined : actual > n;
  }
  if (cond.startsWith('<')) {
    const n = Number(cond.slice(1));
    return Number.isNaN(n) ? undefined : actual < n;
  }
  if (/^-?\d+(\.\d+)?$/.test(cond)) return actual === Number(cond);
  return undefined;
}

/** Evaluates a single `when` clause against ctx. Fails closed (returns false)
 *  on unknown keys or malformed values, warning once in dev. */
function evalClause(key: string, value: unknown, ctx: MemeContext): boolean {
  if (!(key in ctx)) {
    devWarnOnce(`[memes] unknown "when" key "${key}"`);
    return false;
  }
  const actual = (ctx as unknown as Record<string, unknown>)[key];
  if (key === 'trend') {
    const opts = Array.isArray(value) ? value : [value];
    if (!opts.every(o => typeof o === 'string')) {
      devWarnOnce(`[memes] malformed "trend" clause: ${JSON.stringify(value)}`);
      return false;
    }
    return opts.includes(actual as string);
  }
  if (typeof actual === 'boolean') {
    if (typeof value !== 'boolean') {
      devWarnOnce(`[memes] malformed boolean clause for "${key}": ${JSON.stringify(value)}`);
      return false;
    }
    return actual === value;
  }
  if (typeof actual === 'number') {
    if (typeof value === 'number') return actual === value;
    if (typeof value === 'string') {
      const r = evalNumericCond(actual, value);
      if (r === undefined) {
        devWarnOnce(`[memes] malformed numeric clause for "${key}": ${JSON.stringify(value)}`);
        return false;
      }
      return r;
    }
    devWarnOnce(`[memes] malformed clause for "${key}": ${JSON.stringify(value)}`);
    return false;
  }
  devWarnOnce(`[memes] unsupported "when" key "${key}"`);
  return false;
}

function whenSatisfied(when: MemeWhen | undefined, ctx: MemeContext | undefined): boolean {
  if (!when) return true;
  if (!ctx) return false;
  return Object.entries(when).every(([k, v]) => evalClause(k, v, ctx));
}

function effectiveWeight(v: MemeVariant, ctx: MemeContext | undefined): number {
  const satisfied = v.when && ctx ? Object.keys(v.when).length : 0;
  return (1 + satisfied) * (v.weight ?? 1);
}

function weightedPick(candidates: MemeVariant[], ctx: MemeContext | undefined): MemeVariant {
  const weights = candidates.map(v => effectiveWeight(v, ctx));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)];
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function substituteTokens(caption: string, ctx: MemeContext | undefined): string {
  return caption.replace(/\{price\}|\{combo\}|\{lost\}/g, token => {
    if (!ctx) return '???';
    switch (token) {
      case '{price}':
        return String(Math.round(ctx.price));
      case '{combo}':
        return String(ctx.combo);
      case '{lost}':
        return String(ctx.tankersLost);
      default:
        return '???';
    }
  });
}

/** Variant for the trigger label (fallback pool for unknown labels), scored
 *  against an optional MemeContext (see whenSatisfied/effectiveWeight above),
 *  avoiding the same template twice in a row when the pool allows it. */
export function pickMeme(label: string, ctx?: MemeContext): MemePick {
  const pool = MEMES.triggers[label] ?? MEMES.fallback;
  let candidates = pool.filter(v => v.t !== lastTemplate && MEMES.templates[v.t]);
  if (!candidates.length) candidates = pool.filter(v => MEMES.templates[v.t]);
  if (!candidates.length) candidates = pool;

  let eligible = candidates.filter(v => whenSatisfied(v.when, ctx));
  if (!eligible.length) eligible = candidates.filter(v => !v.when);
  if (!eligible.length) eligible = candidates;

  const v = weightedPick(eligible, ctx) ?? MEMES.fallback[0];
  lastTemplate = v.t;
  recordMemeShown(v.t);
  const captions = v.c.map(c => substituteTokens(c, ctx));
  memeLog.push({ t: v.t, c: captions });
  if (memeLog.length > 30) memeLog.shift();
  return { tpl: MEMES.templates[v.t], captions };
}

/** Draws the picked meme (art or placeholder + captions) into `pop`, centered
 *  at the container origin, fitted inside maxW x maxH. */
export function renderMeme(
  scene: Phaser.Scene,
  pop: Phaser.GameObjects.Container,
  pick: MemePick,
  maxW: number,
  maxH: number
): void {
  const { tpl, captions } = pick;
  let W = maxW;
  let H = W * tpl.aspect;
  if (H > maxH) {
    H = maxH;
    W = H / tpl.aspect;
  }

  if (hasArt(scene, tpl.artKey)) {
    pop.add(scene.add.image(0, 0, tpl.artKey).setDisplaySize(W, H));
  } else {
    pop.add(scene.add.rectangle(0, 0, W, H, 0xf2f2f2).setStrokeStyle(3, 0x111111));
    for (const [bx, by, bw, bh] of tpl.boxes) {
      pop.add(scene.add.rectangle(bx * W, by * H, bw * W, bh * H, 0xd8dde2).setStrokeStyle(2, 0x9aa4ad));
    }
    pop.add(
      scene.add
        .text(0, H / 2 - 13, tpl.label, { fontFamily: FONT_SANS, fontSize: '11px', color: '#9aa4ad' })
        .setOrigin(0.5)
    );
  }

  captions.slice(0, tpl.slots.length).forEach((cap, i) => {
    const s = tpl.slots[i];
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: FONT_SANS,
      fontSize: `${s.size ?? 13}px`,
      fontStyle: 'bold',
      color: s.stroke ? '#ffffff' : (s.color ?? '#1a1a1a'),
      align: 'center',
      wordWrap: { width: s.w * W }
    };
    if (s.stroke) {
      style.stroke = '#111111';
      style.strokeThickness = 4;
    }
    pop.add(scene.add.text(s.x * W, s.y * H, cap, style).setOrigin(0.5));
  });
}
