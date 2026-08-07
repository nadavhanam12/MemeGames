// Meme reaction library: picks a meme variant for a game moment and renders it
// (generated template art when available, drawn placeholder otherwise).
// All content — templates, slot geometry, per-trigger caption variants — lives
// in src/config/memes.json; add a meme there, no code changes needed.
import Phaser from 'phaser';
import { hasArt } from './art';
import { FONT_SANS } from './palette';
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

interface MemeVariant {
  t: string; // template key
  c: string[]; // captions, one per slot (in slot order)
}

interface MemeData {
  settings: { durationMs: number; streakCombo: number; countdownTickMs: number; minGapMs: number };
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
// replays this as the run's meme chain.
let memeLog: MemeVariant[] = [];

export function resetMemeLog(): void {
  memeLog = [];
}

export function getMemeLog(): ReadonlyArray<{ t: string; c: string[] }> {
  return memeLog;
}

let lastTemplate = '';

/** Random variant for the trigger label (fallback pool for unknown labels),
 *  avoiding the same template twice in a row when the pool allows it. */
export function pickMeme(label: string): MemePick {
  const pool = MEMES.triggers[label] ?? MEMES.fallback;
  let candidates = pool.filter(v => v.t !== lastTemplate && MEMES.templates[v.t]);
  if (!candidates.length) candidates = pool.filter(v => MEMES.templates[v.t]);
  const v = candidates[Math.floor(Math.random() * candidates.length)] ?? MEMES.fallback[0];
  lastTemplate = v.t;
  memeLog.push(v);
  if (memeLog.length > 30) memeLog.shift();
  return { tpl: MEMES.templates[v.t], captions: v.c };
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
