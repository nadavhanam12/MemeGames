import { expect, test } from '@playwright/test';
import { assertNoErrors, attachErrorCollector, forceLoss, gotoGame, setDevFlags, startRun, waitForScene } from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await setDevFlags(page, { speed: 2 });
  await startRun(page);
  await page.waitForTimeout(2000);
  await forceLoss(page);
  await waitForScene(page, 'Results', 15_000);
});

test('score submission: SKIP path leaves the player on Results', async ({ page }) => {
  const errors = attachErrorCollector(page);
  const overlay = page.locator('#mg-cancel');
  await overlay.waitFor({ timeout: 10_000 }); // auto submit-flow opens the overlay ~2.2s after Results loads
  await overlay.click();

  await expect(page.locator('#mg-cancel')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).phaserGame.scene.isActive('Results'))).toBe(true);

  assertNoErrors(errors);
});

test('score submission: SUBMIT path validates and attempts to send', async ({ page }) => {
  const errors = attachErrorCollector(page);
  await page.locator('#mg-cancel').waitFor({ timeout: 10_000 });

  // empty submit should surface inline validation, not throw
  await page.locator('#mg-send').click();
  await expect(page.locator('#mg-status')).toContainText(/NAME NEEDS/i);

  await page.locator('#mg-name').fill('Regression Bot');
  await page.locator('#mg-email').fill('not-an-email');
  await page.locator('#mg-send').click();
  await expect(page.locator('#mg-status')).toContainText(/EMAIL LOOKS OFF/i);

  await page.locator('#mg-email').fill('regression-bot@example.com');
  await page.locator('#mg-send').click();

  // Whether a real leaderboard server (a separate repo, docs/backend-contract.md)
  // happens to be reachable on :3151 is outside this harness's control: if it
  // is, the token is real and the token-age gate makes this legitimately take
  // up to ~60s (VERIFYING…); if not, submit() fails fast with a clear message.
  // Either is a healthy outcome here — we're only asserting the UI drives the
  // real submit() code path without throwing, not that a submission completes.
  await expect(page.locator('#mg-status')).toContainText(/SENDING|CONNECTING|SERVER|VERIFYING/i, { timeout: 15_000 });
  await page.waitForTimeout(500);

  assertNoErrors(errors);
});
