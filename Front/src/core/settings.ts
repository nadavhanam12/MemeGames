// Player-facing options, persisted to localStorage.
// v3: music now defaults ON (sound/SFX still defaults OFF) — key bumped so
// previously-saved values don't override the new defaults.
const KEY = 'hormuz-settings-v3';

export interface Settings {
  sound: boolean;
  music: boolean;
  vibration: boolean;
  reducedMotion: boolean;
}

function systemReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const settings: Settings = {
  sound: false,
  music: true,
  vibration: true,
  reducedMotion: systemReducedMotion()
};

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch {
    /* private-mode storage failures are fine */
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function vibrate(ms: number | number[]): void {
  if (!settings.vibration) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
