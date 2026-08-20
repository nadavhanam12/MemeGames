import { test } from '@playwright/test';
import { assertNoErrors, attachErrorCollector, forceLoss, gotoGame, setDevFlags, startRun, waitForScene } from './helpers';

test('mobile viewport without crypto.randomUUID (insecure-context-like) does not throw', async ({ page }) => {
  // crypto.randomUUID() only exists in secure contexts (see the comment in
  // src/backend/analytics.ts) — e.g. plain http on a LAN IP. Playwright always
  // serves localhost as a secure context, so we simulate the unavailable-API
  // case directly rather than trying to fake transport security.
  await page.addInitScript(() => {
    // @ts-expect-error deliberately breaking the API for this scenario
    delete (window.crypto as any).randomUUID;
  });

  const errors = attachErrorCollector(page);
  await gotoGame(page);
  await setDevFlags(page, { speed: 2, autoPlay: 'full' });
  await startRun(page);

  await page.waitForTimeout(4000); // enough for analytics.startRun()/track() to fire
  await forceLoss(page);
  await waitForScene(page, 'Results', 15_000);
  await page.waitForTimeout(1500);

  assertNoErrors(errors);
});
