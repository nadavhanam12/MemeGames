// Share/export helpers: capture a rectangle of the composited game canvas,
// stamp the game-name watermark bottom-right, then hand the PNG to the OS
// share sheet (mobile web share) or download it (desktop fallback).
// Callers pass logical 1280×720 coordinates; DPR scaling happens here.
import Phaser from 'phaser';
import { DPR } from './palette';
import { analytics } from '../backend/analytics';

const GAME_NAME = "HORMUZ HOLD'EM";

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/** Snapshot a logical-coordinate rect of the rendered frame into a canvas,
 *  watermarked. Phaser schedules the grab at the end of the next render pass
 *  (no preserveDrawingBuffer needed), so anything hidden this frame — e.g. a
 *  SAVE button inside the captured rect — stays out of the image. */
export function captureArea(
  game: Phaser.Game,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    game.renderer.snapshotArea(
      Math.round(x * DPR),
      Math.round(y * DPR),
      Math.round(w * DPR),
      Math.round(h * DPR),
      snap => {
        const image = snap as HTMLImageElement;
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const cx = canvas.getContext('2d');
        if (!cx) {
          reject(new Error('2d context unavailable'));
          return;
        }
        cx.drawImage(image, 0, 0);
        drawWatermark(cx, canvas.width, canvas.height);
        resolve(canvas);
      }
    );
  });
}

function drawWatermark(cx: CanvasRenderingContext2D, w: number, h: number): void {
  const size = Math.max(14, Math.round(w * 0.032));
  const pad = Math.round(size * 0.55);
  cx.font = `${size}px "Anton", "Arial Black", "Impact", sans-serif`;
  cx.textAlign = 'right';
  cx.textBaseline = 'alphabetic';
  cx.lineJoin = 'round';
  cx.lineWidth = Math.max(2, Math.round(size / 6));
  cx.strokeStyle = 'rgba(23, 32, 42, 0.95)'; // PAL.ink
  cx.strokeText(GAME_NAME, w - pad, h - pad);
  cx.fillStyle = 'rgba(255, 243, 214, 0.95)'; // PAL.cream
  cx.fillText(GAME_NAME, w - pad, h - pad);
}

/** 'auto': share sheet when supported, else download. 'download': always a
 *  straight PNG download (a dedicated SAVE button). */
export type ShareMode = 'auto' | 'download';

/** Native share sheet when the browser supports sharing files (mobile),
 *  otherwise a straight PNG download. `kind` tags the analytics event. */
export async function shareImage(
  canvas: HTMLCanvasElement,
  filename: string,
  text: string,
  kind: string,
  mode: ShareMode = 'auto'
): Promise<ShareOutcome> {
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
  if (!blob) return 'failed';
  const file = new File([blob], filename, { type: 'image/png' });

  if (mode !== 'download' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: GAME_NAME, text });
      analytics.track('share', { kind, method: 'webshare' });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // share sheet unavailable after all — fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  analytics.track('share', { kind, method: 'download' });
  return 'downloaded';
}

/** Capture + share in one go; never throws (returns 'failed' instead) so a
 *  broken export can't take a scene down with it. */
export async function captureAndShare(
  game: Phaser.Game,
  rect: { x: number; y: number; w: number; h: number },
  filename: string,
  text: string,
  kind: string,
  mode: ShareMode = 'auto'
): Promise<ShareOutcome> {
  try {
    const canvas = await captureArea(game, rect.x, rect.y, rect.w, rect.h);
    return await shareImage(canvas, filename, text, kind, mode);
  } catch {
    return 'failed';
  }
}

export type SharePlatform = 'whatsapp' | 'x' | 'facebook';

// wa.me has no separate link param (text + url are concatenated); Twitter/X
// and Facebook's intent endpoints take text and url separately. None of
// these can carry an attached file — a web page has no way to push binary
// image data into a native desktop app that hasn't registered itself as an
// OS share target, which WhatsApp/X/Facebook don't on Mac or Windows.
const INTENT_URL: Record<SharePlatform, (text: string, url: string) => string> = {
  whatsapp: (text, url) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  x: (text, url) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  facebook: (text, url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`
};

function pageUrl(): string {
  return window.location.origin + window.location.pathname;
}

/** Downloads the watermarked PNG (so it's ready to attach), then opens the
 *  platform's own share-compose window/app with the caption + a link back
 *  to the game prefilled. The image still needs a manual attach — see the
 *  INTENT_URL comment for why no web API can skip that step. */
export async function captureAndShareTo(
  game: Phaser.Game,
  rect: { x: number; y: number; w: number; h: number },
  filename: string,
  text: string,
  kind: string,
  platform: SharePlatform
): Promise<ShareOutcome> {
  try {
    const canvas = await captureArea(game, rect.x, rect.y, rect.w, rect.h);
    const outcome = await shareImage(canvas, filename, text, kind, 'download');
    window.open(INTENT_URL[platform](text, pageUrl()), '_blank', 'noopener');
    analytics.track('share_intent', { kind, platform });
    return outcome;
  } catch {
    return 'failed';
  }
}
