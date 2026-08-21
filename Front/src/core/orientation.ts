/**
 * Best-effort portrait lock for Android mobile browsers.
 *
 * `screen.orientation.lock()` only works while the document is fullscreen,
 * and iOS Safari supports neither fullscreen-on-element nor orientation lock —
 * there the CSS landscape overlay in index.html is the only guard. So this
 * arms a pointerdown listener (a user gesture is required for fullscreen)
 * and keeps retrying on each tap until the lock sticks.
 */
export function setupPortraitLock(): void {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const android = /Android/i.test(navigator.userAgent);
  if (!coarse || !android) return;

  let locked = false;
  const tryLock = async () => {
    if (locked) return;
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
      const orientation = screen.orientation as unknown as {
        lock?: (mode: string) => Promise<void>;
      };
      await orientation.lock?.('portrait');
      locked = true;
      window.removeEventListener('pointerdown', tryLock);
    } catch {
      // Denied or unsupported — the CSS landscape overlay still covers us.
    }
  };
  window.addEventListener('pointerdown', tryLock);
}
