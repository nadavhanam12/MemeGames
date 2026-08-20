import { expect, test } from '@playwright/test';
import { assertNoErrors, attachErrorCollector, collectSceneTexts, endDay, gotoGame, setDevFlags, startRun, waitForShopPanel } from './helpers';

test('day-end summary panel renders and can be dismissed', async ({ page }) => {
  const errors = attachErrorCollector(page);
  await gotoGame(page);
  // autoPlay off + gameplay speed normal: we want to inspect the panel
  // ourselves rather than have 'full' autoplay click through it instantly
  await setDevFlags(page, { speed: 1, autoPlay: 'off' });
  await startRun(page);

  await page.waitForTimeout(1000);
  await endDay(page);

  await page.waitForFunction(() => {
    const gs: any = (window as any).phaserGame.scene.getScene('Game');
    return gs.awaitingNextDay === true;
  }, undefined, { timeout: 10_000 });

  await waitForShopPanel(page);

  const texts = await collectSceneTexts(page, 'UI');
  expect(texts.some(t => /NEXT DAY/i.test(t))).toBe(true);

  // dismiss via the same event the NEXT DAY button emits
  await page.evaluate(() => (window as any).bus.emit((window as any).EV.NEXT_DAY_REQUEST));
  await page.waitForFunction(() => {
    const gs: any = (window as any).phaserGame.scene.getScene('Game');
    return gs.awaitingNextDay === false;
  }, undefined, { timeout: 10_000 });

  assertNoErrors(errors);
});
