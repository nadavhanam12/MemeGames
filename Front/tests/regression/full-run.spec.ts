import { test } from '@playwright/test';
import {
  assertInvariants,
  assertNoErrors,
  attachErrorCollector,
  gotoGame,
  installInvariants,
  readInvariants,
  setDevFlags,
  startRun,
  waitForDay
} from './helpers';

test('5-day autoplay run at 2x speed produces zero console errors', async ({ page }) => {
  test.setTimeout(210_000); // ~5 days x 45s / 2x speed, plus day-transition dwell time
  const errors = attachErrorCollector(page);
  await gotoGame(page);
  await installInvariants(page);
  await setDevFlags(page, { speed: 2, autoPlay: 'full' });
  await startRun(page);

  await waitForDay(page, 5, 150_000);

  assertNoErrors(errors);
  assertInvariants(await readInvariants(page));
});
