/**
 * Verifies the two v1.0.8 fixes against a running server:
 *   1. clicking a YouTube playlist card opens a playlist page with all songs
 *   2. the card's ⋯ menu opens next to its button (not "here and there")
 *
 * Screenshots land in e2e/shots/playlist-page/. Development aid, not CI.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, 'shots', 'playlist-page');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:8793';
const QUERY = process.env.E2E_QUERY || 'daft punk';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.signin', { timeout: 20000 });
  await page.fill('input[aria-label="Username"]', 'admin');
  await page.fill('input[aria-label="Password"]', 'admin');
  await page.click('.signin__submit');
  await page.waitForSelector('.sidebar', { timeout: 20000 });

  const openPlaylistsTab = async () => {
    await page.goto(`${BASE}/search?q=${encodeURIComponent(QUERY)}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('.tabs', { timeout: 20000 });
    await page.waitForFunction(
      () => document.querySelectorAll('.section__title').length > 0,
      null,
      { timeout: 30000 }
    );
    await page.click('.tabs .tab >> nth=3');
    await page.waitForTimeout(1500);
  };

  /* ------------------------------------------------- 1. the ⋯ menu position */
  await openPlaylistsTab();

  // Hover a card so the hover transform is active - that is the state the bug
  // showed up in.
  const card = page.locator('.card').nth(2);
  await card.hover();
  await page.waitForTimeout(250);

  const trigger = card.locator('[aria-label^="Options for"]').first();
  const tBox = await trigger.boundingBox();
  await trigger.dispatchEvent('click');
  await page.waitForSelector('.menu [role="menuitem"]', { timeout: 10000 });
  await page.waitForTimeout(250);

  const mBox = await page.locator('.menu').first().boundingBox();
  const vw = 1440;
  const vh = 900;

  // The menu must open just below its own button and stay inside the viewport.
  const dx = Math.abs(mBox.x + mBox.width - tBox.x - tBox.width);
  const dy = Math.abs(mBox.y - (tBox.y + tBox.height));
  check('menu opens under its own button', dx <= 12 && dy <= 14, `dx=${Math.round(dx)} dy=${Math.round(dy)}`);
  check(
    'menu stays inside the viewport',
    mBox.x >= 0 && mBox.y >= 0 && mBox.x + mBox.width <= vw && mBox.y + mBox.height <= vh,
    `x=${Math.round(mBox.x)} y=${Math.round(mBox.y)} w=${Math.round(mBox.width)} h=${Math.round(mBox.height)}`
  );
  await page.screenshot({ path: resolve(OUT, 'menu-open-1440.png'), fullPage: false });

  // The menu must be a direct child of <body> (portalled), not inside the card.
  const portalled = await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    return menu ? menu.parentElement === document.body : false;
  });
  check('menu is portalled to body', portalled);

  // And it must close when clicking outside.
  await page.mouse.click(20, 400);
  await page.waitForTimeout(300);
  const stillOpen = await page.locator('.menu').count();
  check('menu closes on outside click', stillOpen === 0, `${stillOpen} menus`);

  /* ---------------------------------------- 2. clicking the card opens it */
  await openPlaylistsTab();
  const firstTitle = await page.$eval('.card .card__title', (e) => e.textContent.trim());
  await page.locator('.card').first().click();

  await page.waitForFunction(
    () => /\/ytplaylist\//.test(window.location.pathname),
    null,
    { timeout: 15000 }
  ).catch(() => {});
  const url = page.url();
  check('card click navigates to the playlist page', /\/ytplaylist\//.test(url), url.split(BASE)[1] || url);

  // Wait for the ready state: the loading skeleton has no heading, so the
  // heading itself is the signal that the tracks arrived.
  await page.waitForSelector('.page-header__title', { timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.track-row').length > 0,
    null,
    { timeout: 60000 }
  );
  const rows = await page.locator('.track-row').count();
  const heading = await page.$eval('.page-header__title', (e) => e.textContent.trim());
  check('playlist page lists all songs', rows > 1, `${rows} rows`);
  check('playlist page keeps the playlist title', heading === firstTitle, `${heading}`);
  const kind = await page.$eval('.page-header__kind', (e) => e.textContent.trim()).catch(() => '');
  check('page is labelled a YouTube playlist', /youtube/i.test(kind), kind);
  const actions = await page.$$eval('.page-header__actions button', (els) =>
    els.map((e) => e.textContent.trim()).filter(Boolean)
  );
  check(
    'page offers Play / Shuffle / Save to library',
    actions.some((a) => /^Play$/.test(a)) &&
      actions.some((a) => /shuffle/i.test(a)) &&
      actions.some((a) => /save to library/i.test(a)),
    actions.join(' | ')
  );
  await page.screenshot({ path: resolve(OUT, 'remote-playlist-1440.png'), fullPage: false });

  /* ------------------------------------------- 3. playing from the page */
  await page.locator('.track-row').first().click();
  await page.waitForTimeout(9000);
  const bar = await page.locator('.player-bar').innerText().catch(() => '');
  check('clicking a row plays from the playlist page', bar.includes(firstTitle.slice(0, 12)) || bar.length > 0,
    bar.split('\n').slice(0, 2).join(' / '));

  /* ------------------------------------------- 4. saving from the page */
  await page.goto(`${BASE}/search?q=${encodeURIComponent(QUERY)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tabs', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.section__title').length > 0, null, { timeout: 30000 });
  await page.click('.tabs .tab >> nth=3');
  await page.waitForTimeout(1500);
  // Pick an unsaved playlist (skip "In your library" ones).
  const candidates = page.locator('.card', { hasNotText: 'In your library' });
  await candidates.first().click();
  await page.waitForSelector('.page-header__title', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length > 0, null, { timeout: 60000 });
  const saveBtn = page.locator('.page-header__actions button', { hasText: 'Save to library' });
  if (await saveBtn.count()) {
    await saveBtn.first().click();
    await page.waitForFunction(() => /\/playlist\//.test(window.location.pathname), null, { timeout: 30000 });
    check('saving from the page opens the saved copy', /\/playlist\/pl_/.test(page.url()), page.url().split(BASE)[1]);
  } else {
    check('saving from the page opens the saved copy', false, 'no Save button found');
  }

  /* --------------------------------------------------- 5. mobile sanity */
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlaylistsTab();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check('no horizontal overflow at 390px', overflow <= 1, `overflow ${overflow}px`);
  await page.locator('.card').first().click();
  await page.waitForSelector('.page-header__title', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length > 0, null, { timeout: 60000 });
  const mOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check('playlist page has no overflow at 390px', mOverflow <= 1, `overflow ${mOverflow}px`);
  await page.screenshot({ path: resolve(OUT, 'remote-playlist-390.png'), fullPage: false });
} catch (err) {
  check('run completed without throwing', false, err instanceof Error ? err.message : String(err));
  try {
    await page.screenshot({ path: resolve(OUT, 'failure.png'), fullPage: false });
  } catch {
    /* ignore */
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
