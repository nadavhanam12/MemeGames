import { expect, test } from '@playwright/test';
import { assertNoErrors, attachErrorCollector, collectSceneTexts, forceLoss, gotoGame, setDevFlags, startRun, waitForScene } from './helpers';

test('results screen renders the newspaper front page', async ({ page }) => {
  const errors = attachErrorCollector(page);
  await gotoGame(page);
  await setDevFlags(page, { speed: 2 });
  await startRun(page);
  await page.waitForTimeout(2000);
  await forceLoss(page);
  await waitForScene(page, 'Results', 15_000);
  await page.waitForTimeout(1500); // slide-in entrance

  const texts = await collectSceneTexts(page, 'Results');
  expect(texts.some(t => /SHARE/i.test(t))).toBe(true);
  expect(texts.some(t => /DEFEND AGAIN/i.test(t))).toBe(true);
  expect(texts.some(t => /GALLERY/i.test(t))).toBe(true);
  expect(texts.some(t => /LEADERBOARD/i.test(t))).toBe(true);

  await page.screenshot({ path: 'test-results/results-screen.png' });
  assertNoErrors(errors);
});
