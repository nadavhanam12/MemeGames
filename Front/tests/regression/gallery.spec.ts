import { expect, test } from '@playwright/test';
import { assertNoErrors, attachErrorCollector, gotoGame, seedUnlockedMemes, waitForScene } from './helpers';

test('meme gallery: open, scroll, zoom a tile, close', async ({ page }) => {
  const errors = attachErrorCollector(page);
  await seedUnlockedMemes(page); // pre-unlock a few templates so zoom has something to open
  await gotoGame(page);

  await page.evaluate(() => (window as any).phaserGame.scene.start('Gallery', { from: 'Menu' }));
  await waitForScene(page, 'Gallery');
  await page.waitForTimeout(300);

  // scroll the grid via the wheel handler GalleryScene wires up
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(200);

  const templateId: string = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('hormuz-memes-v1') ?? '{"ids":[]}');
    return stored.ids[0];
  });
  expect(templateId).toBeTruthy();

  await page.evaluate(id => (window as any).phaserGame.scene.getScene('Gallery').showFocusedMeme(id), templateId);
  await page.waitForTimeout(300);

  const zoomOpen = await page.evaluate(() => {
    const gs: any = (window as any).phaserGame.scene.getScene('Gallery');
    return !!gs.focusLayer && gs.focusLayer.active;
  });
  expect(zoomOpen).toBe(true);

  // close via a pointerup on the backdrop, same as the real interaction
  await page.evaluate(() => {
    const gs: any = (window as any).phaserGame.scene.getScene('Gallery');
    gs.focusLayer.emit('pointerup', {}, 0, 0, { stopPropagation() {} });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => (window as any).phaserGame.scene.start('Menu'));
  await waitForScene(page, 'Menu');

  assertNoErrors(errors);
});
