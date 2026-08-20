import { expect, test } from '@playwright/test';
import { assertNoErrors, attachErrorCollector, forceLoss, gotoGame, setDevFlags, startRun, waitForScene } from './helpers';

test('force-loss ends the run and reaches Results with no console errors', async ({ page }) => {
  const errors = attachErrorCollector(page);
  await gotoGame(page);
  await setDevFlags(page, { speed: 2 });
  await startRun(page);

  // let a couple of seconds of real gameplay run first so the loss isn't
  // instantaneous (some end-of-run code paths read accumulated stats)
  await page.waitForTimeout(2000);
  await forceLoss(page);

  await waitForScene(page, 'Results', 15_000);
  await page.waitForTimeout(2500); // newspaper slide-in + auto submit-flow kickoff

  assertNoErrors(errors);
  expect(await page.evaluate(() => (window as any).phaserGame.scene.isActive('Results'))).toBe(true);
});
