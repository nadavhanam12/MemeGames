import { Page, expect } from '@playwright/test';

// Every scenario drives the game the same way the dev panel itself does:
// window.phaserGame / window.bus / window.EV / window.devState, all exposed
// only in dev builds (see src/main.ts, src/core/state.ts, src/dev/state.ts).
// Playwright must run against `npm run dev`, never a production build.

export interface ConsoleErrorCollector {
  errors: string[];
}

/** Fails the test immediately if the page throws or logs a console.error —
 *  this is the check that would have caught the stale upgrade-button
 *  TypeError freeze. Call once per test, right after page creation. */
export function attachErrorCollector(page: Page): ConsoleErrorCollector {
  const collector: ConsoleErrorCollector = { errors: [] };
  page.on('pageerror', err => collector.errors.push(`[pageerror] ${err.message}\n${err.stack ?? ''}`));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    // Headless Chromium doesn't reliably report custom @font-face availability
    // via document.fonts.check() on this host (font network requests 200 OK,
    // and the same build shows zero font errors in a normal browser tab) —
    // src/scenes/BootScene.ts's font-load guard fires on that false negative.
    // Filtering this exact known message, not console.error generally.
    if (/^\[fonts\] (Anton|Chakra Petch) not available/.test(msg.text())) return;
    collector.errors.push(`[console.error] ${msg.text()}`);
  });
  page.on('requestfailed', req => {
    // Backend leaderboard/analytics calls are expected to fail when no local
    // server is running (see src/backend/CLAUDE.md) — that's not a game bug.
    if (req.url().includes(':3151')) return;
    collector.errors.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ''}`);
  });
  return collector;
}

export function assertNoErrors(collector: ConsoleErrorCollector): void {
  expect(collector.errors, `uncaught console errors:\n${collector.errors.join('\n')}`).toEqual([]);
}

/** Boots the page with the dev panel's hooks active and waits for the
 *  Phaser game + dev globals to exist. */
export async function gotoGame(page: Page): Promise<void> {
  await page.goto('/?dev=1');
  await page.waitForFunction(() => (window as any).phaserGame && (window as any).bus && (window as any).EV);
}

export async function setDevFlags(page: Page, opts: { speed?: number; autoPlay?: 'off' | 'gameplay' | 'full' }): Promise<void> {
  await page.evaluate(o => {
    const ds = (window as any).devState;
    if (o.speed !== undefined) ds.speedMultiplier = o.speed;
    if (o.autoPlay !== undefined) ds.autoPlay = o.autoPlay;
  }, opts);
}

/** Starts a fresh run directly, bypassing the Menu button (same shortcut the
 *  dev console comment in main.ts documents). */
export async function startRun(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).phaserGame.scene.start('Game'));
  await page.waitForFunction(() => (window as any).phaserGame.scene.isActive('Game'));
  // GameScene.create() assigns day 1's mission on a 400ms delayedCall — until
  // then this.mission is null and devEndDay()/endDay() throw reading `.type`
  // off it. Wait for the state the dev hooks actually assume.
  await page.waitForFunction(() => !!(window as any).phaserGame.scene.getScene('Game').mission);
}

export async function currentScene(page: Page, key: string): Promise<boolean> {
  return page.evaluate(k => (window as any).phaserGame.scene.isActive(k), key);
}

export async function waitForScene(page: Page, key: string, timeout = 20_000): Promise<void> {
  await page.waitForFunction(k => (window as any).phaserGame.scene.isActive(k), key, { timeout });
}

export async function gameScene(page: Page): Promise<{ day: number; over: boolean; awaitingNextDay: boolean }> {
  return page.evaluate(() => {
    const gs: any = (window as any).phaserGame.scene.getScene('Game');
    return { day: gs.day, over: gs.over, awaitingNextDay: gs.awaitingNextDay };
  });
}

export async function forceLoss(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).phaserGame.scene.getScene('Game').devForceLoss());
}

export async function endDay(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).phaserGame.scene.getScene('Game').devEndDay());
}

export async function emitBus(page: Page, event: string, ...args: unknown[]): Promise<void> {
  await page.evaluate(([e, a]) => (window as any).bus.emit(e, ...(a as unknown[])), [event, args] as const);
}

/** Polls until GameScene.day reaches `n`, driving via devEndDay when a day
 *  is stuck waiting on the player (autoPlay:'full' handles this itself, but
 *  this is a safety net so the scenario can't hang forever). */
export async function waitForDay(page: Page, n: number, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { day, over } = await gameScene(page);
    if (over || day >= n) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`timed out waiting for day ${n}`);
}

const MEME_TEMPLATE_IDS = [
  'twoButtons',
  'squintCaptain',
  'drakeFormat',
  'expandingBrain',
  'distractedBoyfriend',
  'changeMyMind'
];

/** Seeds the persisted meme-unlock set (localStorage `hormuz-memes-v1`) so a
 *  scenario can open the gallery zoom view without first grinding a run. */
export async function seedUnlockedMemes(page: Page, ids: string[] = MEME_TEMPLATE_IDS): Promise<void> {
  await page.addInitScript(unlockIds => {
    localStorage.setItem('hormuz-memes-v1', JSON.stringify({ ids: unlockIds }));
  }, ids);
}

/** Installs a cheap in-page invariant recorder. Must be called before
 *  startRun() so it catches the very first spawns/kills. Read results back
 *  with readInvariants(). */
export async function installInvariants(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__inv = {
      creditsOutsideViewport: [] as string[],
      killedAtSpawn: [] as string[],
      laneViolations: [] as string[],
      seenSignatures: {} as Record<string, boolean>,
      routeYBounds: null as { min: number; max: number } | null
    };
    const VIEW = { x: 402, y: 28, w: 850, h: 484 };
    const MARGIN = 40; // fly-out/impact fx overshoot slack

    const attachBus = () => {
      if (!w.bus || !w.EV) return false;
      w.bus.on(w.EV.CREDITS, (_credits: number, gain: number, x: number, y: number) => {
        if (!gain || (x === 0 && y === 0)) return; // buy-upgrade emits CREDITS with no position
        if (x < VIEW.x - MARGIN || x > VIEW.x + VIEW.w + MARGIN || y < VIEW.y - MARGIN || y > VIEW.y + VIEW.h + MARGIN) {
          w.__inv.creditsOutsideViewport.push(`credits fly-out at (${x.toFixed(0)},${y.toFixed(0)}) outside viewport`);
        }
      });
      return true;
    };
    if (!attachBus()) {
      const busPoll = setInterval(() => {
        if (attachBus()) clearInterval(busPoll);
      }, 100);
    }

    const poll = setInterval(() => {
      const gs = w.phaserGame?.scene?.getScene?.('Game');
      if (!gs || !gs.scene?.isActive?.()) return;
      const threats: any[] = gs.threats ?? [];

      if (!w.__inv.routeYBounds) {
        const routes: any[] = gs.routes ?? [];
        if (routes.length) {
          let min = Infinity;
          let max = -Infinity;
          for (const r of routes) {
            for (let i = 0; i <= 40; i++) {
              const p = r.getPoint(i / 40);
              if (p.y < min) min = p.y;
              if (p.y > max) max = p.y;
            }
          }
          if (Number.isFinite(min)) w.__inv.routeYBounds = { min, max };
        }
      }

      for (const th of threats) {
        if (!th.sprite) continue;
        const sig = `${th.type}:${Math.round(th.sprite.x / 4)}:${Math.round(th.sprite.y / 4)}`;
        if (!w.__inv.seenSignatures[sig]) {
          w.__inv.seenSignatures[sig] = true;
          if (th.dead) w.__inv.killedAtSpawn.push(`${th.type} at (${th.sprite.x.toFixed(0)},${th.sprite.y.toFixed(0)}) was already dead when first observed`);
        }
        if (th.type === 'patrol' && w.__inv.routeYBounds && !th.dead) {
          const { min, max } = w.__inv.routeYBounds;
          const lane = 180; // chase-target boats leave the exact spline; this only catches gross excursions (NaN, teleport, off-map)
          if (!Number.isFinite(th.sprite.x) || !Number.isFinite(th.sprite.y) || th.sprite.y < min - lane || th.sprite.y > max + lane) {
            w.__inv.laneViolations.push(`patrol boat at (${th.sprite.x},${th.sprite.y}) far outside lane band [${min - lane},${max + lane}]`);
          }
        }
      }
    }, 200);
    w.__invPollHandle = poll;
  });
}

export interface InvariantReport {
  creditsOutsideViewport: string[];
  killedAtSpawn: string[];
  laneViolations: string[];
}

export async function readInvariants(page: Page): Promise<InvariantReport> {
  return page.evaluate(() => {
    const w = window as any;
    return {
      creditsOutsideViewport: w.__inv?.creditsOutsideViewport ?? [],
      killedAtSpawn: w.__inv?.killedAtSpawn ?? [],
      laneViolations: w.__inv?.laneViolations ?? []
    };
  });
}

/** Recursively walks a scene's display list (including nested containers)
 *  and collects every rendered text string — the cheapest way to assert on
 *  canvas-drawn Phaser content without adding test-only DOM hooks. */
/** Waits for the day-end shop panel to actually be built. A "DAY N
 *  COMPLETED!" splash (and, when a meme unlocked for the first time, a
 *  second interstitial) plays first — polling avoids racing that chain. */
export async function waitForShopPanel(page: Page, timeout = 8_000): Promise<void> {
  await expect
    .poll(async () => (await collectSceneTexts(page, 'UI')).some(t => /UPGRADES/i.test(t)), { timeout })
    .toBe(true);
}

export async function collectSceneTexts(page: Page, sceneKey: string): Promise<string[]> {
  return page.evaluate(key => {
    const scene: any = (window as any).phaserGame.scene.getScene(key);
    const out: string[] = [];
    const walk = (obj: any) => {
      if (!obj) return;
      if (typeof obj.text === 'string') out.push(obj.text);
      if (Array.isArray(obj.list)) obj.list.forEach(walk);
    };
    scene.children.list.forEach(walk);
    return out;
  }, sceneKey);
}

export function assertInvariants(report: InvariantReport): void {
  expect(report.creditsOutsideViewport, report.creditsOutsideViewport.join('\n')).toEqual([]);
  expect(report.killedAtSpawn, report.killedAtSpawn.join('\n')).toEqual([]);
  expect(report.laneViolations, report.laneViolations.join('\n')).toEqual([]);
}
