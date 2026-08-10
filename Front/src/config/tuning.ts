// Live tuning values. Defaults come from tuning.json (committed to the repo);
// in dev, localStorage overrides are merged on top so panel tweaks survive
// reloads, and "Save to disk" writes them back into tuning.json via the Vite
// dev plugin (/__save).
import defaults from './tuning.json';

export type Tuning = typeof defaults;

function deepMerge(target: any, src: any): void {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && target[k]) {
      deepMerge(target[k], src[k]);
    } else {
      target[k] = src[k];
    }
  }
}

export const TUNING: Tuning = JSON.parse(JSON.stringify(defaults));

if (import.meta.env.DEV) {
  try {
    const raw = localStorage.getItem('dev-tuning');
    if (raw) deepMerge(TUNING, JSON.parse(raw));
  } catch {
    /* ignore corrupt overrides */
  }
}

// One-time migration at load: route 2 waypoints are stored in SAIL ORDER,
// right -> left. Old saved overrides may still run left -> right — flip them.
// (Load-time only, so it never fights the route editor mid-drag.)
for (const key of ['map2', 'flat2'] as const) {
  const pts = (TUNING.route as any)[key] as Array<[number, number]> | undefined;
  if (pts && pts.length > 1 && pts[0][0] < pts[pts.length - 1][0]) pts.reverse();
}

// Migration: the day/mission system moved the default day length 20 -> 45.
// Stale dev overrides still carry the exact old default; bump only those.
if (TUNING.dayNight.dayLengthSec === 20) TUNING.dayNight.dayLengthSec = 45;

/** Mirror the current tuning into localStorage (dev only). */
export function persistTuningLocal(): void {
  if (!import.meta.env.DEV) return;
  try {
    localStorage.setItem('dev-tuning', JSON.stringify(TUNING));
  } catch {
    /* ignore */
  }
}

/** Clear local overrides so tuning.json defaults win again. */
export function resetTuningLocal(): void {
  try {
    localStorage.removeItem('dev-tuning');
    localStorage.removeItem('dev-layout');
  } catch {
    /* ignore */
  }
}

/** POST tuning + layout to the Vite dev server, which writes src/config/*.json. */
export async function saveToDisk(layout: Record<string, unknown>): Promise<string> {
  const res = await fetch('/__save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tuning: TUNING, layout })
  });
  return res.ok ? 'saved' : `error: ${await res.text()}`;
}
