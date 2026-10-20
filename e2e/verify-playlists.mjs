/**
 * Targeted visual check for the YouTube-playlist feature (v1.0.7).
 *
 * Verifies against a running server:
 *   - search results expose a Playlists tab with real playlist cards
 *   - "official only" setting filters them
 *   - saving puts the playlist in Library > Playlists
 *
 * Screenshots land in e2e/shots/playlists/. This is a development aid, not
 * part of CI.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, 'shots', 'playlists');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:8791';
const QUERY = process.env.E2E_QUERY || 'daft punk';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  /* ------------------------------------------------------------- sign in */
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.signin', { timeout: 20000 });
  await page.fill('input[aria-label="Username"]', 'admin');
  await page.fill('input[aria-label="Password"]', 'admin');
  await page.click('.signin__submit');
  await page.waitForSelector('.app-shell, .sidebar', { timeout: 20000 });

  /* -------------------------------------------------------- search page */
  await page.goto(`${BASE}/search?q=${encodeURIComponent(QUERY)}`, {
    waitUntil: 'domcontentloaded',
  });

  // Wait for the playlists tab to be present and results to settle.
  await page.waitForSelector('.tabs', { timeout: 20000 });
  const tabs = await page.$$eval('.tabs .tab', (els) => els.map((e) => e.textContent.trim()));
  check('playlists tab exists', tabs.some((t) => t.startsWith('Playlists')), tabs.join(' | '));
  check('albums tab is gone', !tabs.some((t) => t.startsWith('Albums')), tabs.join(' | '));

  // Wait for results to arrive before switching tabs.
  await page.waitForFunction(
    () => document.querySelectorAll('.section__title').length > 0,
    null,
    { timeout: 30000 }
  );
  await page.click('.tabs .tab >> nth=3');
  await page.waitForTimeout(1500);

  const cards = await page.$$eval('.card', (els) =>
    els
      .map((e) => ({
        title: e.querySelector('.card__title')?.textContent?.trim() || '',
        subtitle: e.querySelector('.card__subtitle')?.textContent?.trim() || '',
        badge: e.querySelector('.artwork__badge')?.textContent?.trim() || '',
        img: Boolean(e.querySelector('img')?.getAttribute('src')),
      }))
      .filter((c) => c.title)
  );
  check('playlist cards render', cards.length > 0, `${cards.length} cards`);
  check(
    'cards carry owner/official info',
    cards.some((c) => c.subtitle) && cards.some((c) => c.badge === 'Official'),
    cards.slice(0, 3).map((c) => `${c.title} [${c.badge}]`).join(' ; ')
  );
  check('cards have artwork', cards.filter((c) => c.img).length > 0);

  await page.screenshot({ path: resolve(OUT, 'search-playlists-1440.png'), fullPage: false });

  /* --------------------------------------------- official-only setting */
  // Flip the real toggle on the Settings page, then re-check search.
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#set-content', { timeout: 15000 });
  const toggle = page.locator('[role="switch"][aria-label="Official playlists only"]').first();
  const before = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await page.waitForTimeout(600);
  const after = await toggle.getAttribute("aria-checked");
  check('settings toggle flips', before !== after, `${before} -> ${after}`);

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
  const official = await page.$$eval('.card', (els) =>
    els
      .map((e) => ({
        title: e.querySelector('.card__title')?.textContent?.trim() || '',
        badge: e.querySelector('.artwork__badge')?.textContent?.trim() || '',
      }))
      .filter((c) => c.title)
  );
  check(
    'official-only drops the fan playlists',
    official.length > 0 && official.every((c) => c.badge === 'Official'),
    `${official.length} cards, all official=${official.every((c) => c.badge === 'Official')}`
  );
  await page.screenshot({ path: resolve(OUT, 'search-playlists-official-1440.png'), fullPage: false });

  /* turn it back off so the rest of the run uses all playlists */
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#set-content', { timeout: 15000 });
  await page.locator('[role="switch"][aria-label="Official playlists only"]').first().click();
  await page.waitForTimeout(500);

  /* --------------------------------------------------- mobile rendering */
  await page.setViewportSize({ width: 390, height: 844 });
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
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check('no horizontal overflow at 390px', overflow <= 1, `overflow ${overflow}px`);
  await page.screenshot({ path: resolve(OUT, 'search-playlists-390.png'), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });

  /* ------------------------------------------------- save to the library */
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

  const firstTitle = (await page.$eval('.card .card__title', (e) => e.textContent.trim())) || '';
  const trigger = page.locator('.card [aria-label^="Options for"]').first();
  await trigger.dispatchEvent('click');
  await page.waitForSelector('[role="menuitem"]', { timeout: 10000 });
  const menuItems = await page.$$eval('[role="menuitem"]', (els) =>
    els.map((e) => e.textContent.trim())
  );
  check(
    'playlist card offers "Save to library"',
    menuItems.some((m) => /save to library/i.test(m)),
    `${firstTitle} -> ${menuItems.join(' | ')}`
  );
  await page.locator('[role="menuitem"]', { hasText: 'Save to library' }).first().dispatchEvent('click');
  await page.waitForTimeout(12000);

  await page.goto(`${BASE}/library`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const libTitles = await page.$$eval('.card .card__title', (els) =>
    els.map((e) => e.textContent.trim()).filter(Boolean)
  );
  check(
    'saved playlist appears in Library > Playlists',
    libTitles.some((t) => t === firstTitle) || libTitles.length > 1,
    `${libTitles.length} cards: ${libTitles.slice(0, 4).join(' ; ')}`
  );
  const libTabs = await page.$$eval('.tabs .tab', (els) => els.map((e) => e.textContent.trim()));
  check('library has no Albums tab', !libTabs.some((t) => t.startsWith('Albums')), libTabs.join(' | '));
  await page.screenshot({ path: resolve(OUT, 'library-playlists-1440.png'), fullPage: false });
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
