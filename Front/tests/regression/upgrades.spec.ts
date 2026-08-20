import { expect, test } from '@playwright/test';
import { assertNoErrors, attachErrorCollector, endDay, gotoGame, setDevFlags, startRun, waitForShopPanel } from './helpers';

async function awaitPanel(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => (window as any).phaserGame.scene.getScene('Game').awaitingNextDay === true, undefined, {
    timeout: 10_000
  });
  await waitForShopPanel(page); // the completed-splash plays before upgradeButtons are populated
}

/** Drives a real click on an upgrade card by invoking the exact pointerdown
 *  handler the shop UI wires up (UIScene.buildUpgradeCard) — exercises the
 *  same code path a mouse click would, including the affordability/lock
 *  checks, without needing pixel-perfect canvas coordinates. */
async function clickUpgradeCard(page: import('@playwright/test').Page, key: 'air' | 'hull' | 'gold') {
  return page.evaluate(k => {
    const ui: any = (window as any).phaserGame.scene.getScene('UI');
    const card = ui.upgradeButtons[k];
    if (!card || !card.active) return 'missing-or-inactive';
    card.emit('pointerdown', {}, 0, 0, { stopPropagation() {} });
    return 'clicked';
  }, key);
}

test('buying an upgrade from the day-end shop deducts credits and increments the stat', async ({ page }) => {
  const errors = attachErrorCollector(page);
  await gotoGame(page);
  await setDevFlags(page, { speed: 2, autoPlay: 'off' });
  await startRun(page);

  // grant credits directly rather than relying on real-time intercept RNG to
  // afford anything within a short window — this is a preconditions setup,
  // not something the purchase-flow assertions below depend on being "earned".
  // UIScene's affordability check reads its own displayedCredits, which only
  // updates off the CREDITS bus event (see UIScene.onCredits), so both sides
  // of the split need to move together.
  await page.evaluate(() => {
    (window as any).phaserGame.scene.getScene('Game').stats.credits = 999;
    (window as any).bus.emit((window as any).EV.CREDITS, 999, 999, 0, 0);
  });
  await endDay(page); // day 1 -> hull unlocks day 1
  await awaitPanel(page);

  const before = await page.evaluate(() => {
    const gs: any = (window as any).phaserGame.scene.getScene('Game');
    return { credits: gs.stats.credits, bought: gs.stats.upgradesBought };
  });

  const clickResult = await clickUpgradeCard(page, 'hull');
  expect(clickResult).toBe('clicked');
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const gs: any = (window as any).phaserGame.scene.getScene('Game');
    return { credits: gs.stats.credits, bought: gs.stats.upgradesBought };
  });

  expect(after.bought, 'upgradesBought should increment if the card was affordable and unlocked').toBe(before.bought + 1);
  expect(after.credits).toBeLessThan(before.credits);

  assertNoErrors(errors);
});

test('rapid buy + advance cycles across day boundaries do not throw (stale-button regression)', async ({ page }) => {
  // This targets the historical bug class: UIScene.upgradeButtons entries
  // going stale (panel destroyed/rebuilt) while something still tries to
  // read them. Racing a click against an immediate day-advance request is a
  // tighter window than autoplay ever produces.
  const errors = attachErrorCollector(page);
  await gotoGame(page);
  await setDevFlags(page, { speed: 2, autoPlay: 'off' });
  await startRun(page);
  await page.waitForTimeout(500);

  for (let day = 1; day <= 3; day++) {
    await endDay(page);
    await awaitPanel(page);
    // fire a click and the next-day request back-to-back, no settle time
    await Promise.all([
      clickUpgradeCard(page, 'hull'),
      clickUpgradeCard(page, 'gold'),
      clickUpgradeCard(page, 'air'),
      page.evaluate(() => (window as any).bus.emit((window as any).EV.NEXT_DAY_REQUEST))
    ]);
    await page.waitForFunction(() => (window as any).phaserGame.scene.getScene('Game').awaitingNextDay === false, undefined, {
      timeout: 10_000
    });
  }

  assertNoErrors(errors);
});
