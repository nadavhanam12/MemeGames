// Persisted meme-collection progress: which templates the player has ever
// seen fire, saved per account in localStorage (same key discipline as
// src/backend/leaderboard.ts). Populated by pickMeme() in memes.ts.
const STORAGE_KEY = 'hormuz-memes-v1';

interface StoredUnlocks {
  ids: string[];
}

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set((JSON.parse(raw) as StoredUnlocks).ids);
  } catch {
    /* corrupted or unavailable storage — start fresh */
  }
  return new Set();
}

const unlocked = load();
let dayUnlocks: string[] = [];
let runUnlocks: string[] = [];

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids: [...unlocked] } as StoredUnlocks));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Marks a template as seen; the first time ever, it's also queued as a
 *  same-day unlock for the day-end recap. No-op on repeat sightings. */
export function recordMemeShown(templateId: string): void {
  if (unlocked.has(templateId)) return;
  unlocked.add(templateId);
  dayUnlocks.push(templateId);
  runUnlocks.push(templateId);
  persist();
}

export function getUnlockedTemplates(): ReadonlySet<string> {
  return unlocked;
}

/** Call at the start of each in-game day so the day-end summary can report
 *  just that day's fresh unlocks. */
export function resetDayUnlocks(): void {
  dayUnlocks = [];
}

export function getDayUnlocks(): string[] {
  return dayUnlocks;
}

/** Call at run start (next to resetMemeLog) so the results screen can show
 *  every meme unlocked for the first time during that run. */
export function resetRunUnlocks(): void {
  runUnlocks = [];
}

export function getRunUnlocks(): string[] {
  return runUnlocks;
}
