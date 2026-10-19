/**
 * Ytrium end-to-end smoke test (Playwright, headless Chromium).
 *
 * Run with:  npm run test:e2e
 * Requires:  npm run dev:server  (API :8787)
 *            npm run dev:client  (Vite :5173)
 *
 * Covers: sign-in gate, admin/admin sign-in, search -> play, player bar
 * controls, full player + lyrics + lyrics toggle, queue, playlist create,
 * settings toggles + JSON export/import, account settings, admin user
 * management (create / rename / password change / password-gated delete in an
 * isolated context), keyboard shortcuts, dialogs, toasts, responsive layout
 * (320/768/1440) and horizontal-overflow checks.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const SHOTS = path.resolve('e2e/shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Chromium's open-source build cannot decode AAC/mp4: such element-level
 *  media errors are expected here and ignored; everything else is a fail. */
function isMediaDecodeError(text) {
  return /DEMUXER_ERROR|FORMAT_ERROR|MEDIA_ERR_SRC_NOT_SUPPORTED|no supported source|Failed to load because no supported source|NotSupportedError|The media resource/i.test(text);
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();

  const consoleErrors = [];
  const streamRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('request', (r) => { if (r.url().includes('/api/stream/')) streamRequests.push(r.url()); });

  /* ------------------------------------------------------------------ boot */
  /* Fresh browser: no session yet, so the sign-in gate must come up first. */
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.signin', { timeout: 20_000 });
  const shellBeforeLogin = await page.locator('#main-content').count();
  check('boots to the sign-in screen before any session', shellBeforeLogin === 0);
  const cardBox = await page.locator('.signin__card').boundingBox();
  check(
    'sign-in card fits the viewport',
    Boolean(cardBox && cardBox.width <= 420 && cardBox.x >= 0),
    cardBox ? `${Math.round(cardBox.width)}px wide` : 'no card',
  );
  await shot(page, '00-signin');

  /* Rejected credentials are exercised in the isolated auth section below -
     a 401 also lands in this page's console, which is audited at the end. */
  await page.fill('input[aria-label="Username"]', 'admin');
  await page.fill('input[aria-label="Password"]', 'admin');
  await page.click('.signin__submit');
  await page.waitForSelector('#main-content', { timeout: 20_000 });
  await page.waitForTimeout(2500);
  check('admin/admin signs in to the home shell', true);
  await shot(page, '01-home');

  const homeCards = await page.locator('.card, .quick-pick, .track-row').count();
  check('home shows content cards', homeCards > 0, `${homeCards} items`);

  const sectionTitles = await page.locator('.section__title').allTextContents();
  check('home renders recommendation sections', sectionTitles.length >= 2, sectionTitles.join(' | '));

  /* ---------------------------------------------------------------- search */
  await page.keyboard.press('/');
  await page.waitForTimeout(250);
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  check('"/" focuses the search field', focusedTag === 'INPUT', String(focusedTag));

  await page.keyboard.type('daft punk');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/search/, { timeout: 10_000 });
  await page.waitForSelector('.track-row', { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const rows = await page.locator('.track-row').count();
  check('search returns track rows', rows > 0, `${rows} rows`);
  await shot(page, '02-search');

  const firstTrackTitle = (await page.locator('.track-row').first().locator('.track-row__title').textContent() || '').trim();

  /* ----------------------------------------------------------- play a track */
  /* The row play control only appears on hover; dispatch the same DOM event
     React listens for (dblclick plays at that row's index in the list). */
  const row = page.locator('.track-row').first();
  await row.dispatchEvent('dblclick');
  await page.waitForTimeout(4500);

  const barTitle = (await page.locator('.player-bar').innerText().catch(() => '')) || '';
  check('playing a row fills the player bar', barTitle.length > 0 && barTitle !== 'Nothing playing', barTitle.split('\n').slice(0, 2).join(' / '));
  check('player bar shows the clicked track', barTitle.includes(firstTrackTitle.slice(0, 30)), firstTrackTitle.slice(0, 40));
  check('playback hits the API stream proxy', streamRequests.some((u) => !u.endsWith('/meta')), streamRequests.slice(-1)[0] || 'none');
  const errorBanner = await page.locator('.error-banner').count();
  check('no play error banner in the player bar', errorBanner === 0);

  /* seek + volume sliders must have real width (collapsed-slider regression) */
  const seekBox = await page.locator('.player-bar__progress > .slider').first().boundingBox();
  check('seek slider has real width', Boolean(seekBox && seekBox.width > 80), `${seekBox?.width ?? 0}px`);
  const volBox = await page.locator('.player-bar__volume > .slider').first().boundingBox();
  check('volume slider has real width', Boolean(volBox && volBox.width > 40), `${volBox?.width ?? 0}px`);

  /* -------------------------------------------------------- player controls */
  const playBtn = page.locator('.player-bar__play');
  // Let the first stream actually start so the play/pause toggles are tested
  // against a stable playing state (cold cache adds a few seconds).
  await page
    .waitForFunction(() => {
      const btn = document.querySelector('.player-bar__play');
      return btn?.getAttribute('aria-label') === 'Pause';
    }, { timeout: 20_000 })
    .catch(() => {});
  const labelBefore = await playBtn.getAttribute('aria-label');
  await playBtn.dispatchEvent('click');
  await page.waitForTimeout(700);
  const labelAfter = await playBtn.getAttribute('aria-label');
  check('play/pause button toggles', labelBefore !== labelAfter, `${labelBefore} -> ${labelAfter}`);
  await playBtn.dispatchEvent('click');
  await page.waitForTimeout(400);

  const likedBtn = page.locator('.player-bar button[aria-label="Like this song"]').first();
  const likedBefore = await likedBtn.getAttribute('aria-pressed');
  await likedBtn.dispatchEvent('click');
  await page.waitForTimeout(600);
  const likedAfter = await page.locator('.player-bar button[aria-label="Unlike"], .player-bar button[aria-label="Like this song"]').first().getAttribute('aria-pressed');
  check('like button toggles state', likedBefore !== likedAfter, `${likedBefore} -> ${likedAfter}`);
  const toastVisible = await page.locator('.toast').first().isVisible().catch(() => false);
  check('liking raises a toast', toastVisible);

  /* ----------------------------------------------------------- full player */
  // "f" is a global shortcut - the search field may still be focused, so blur
  // first (same reason the "q" queue test does).
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(150);
  await page.keyboard.press('f');
  await page.waitForTimeout(700);
  const fullShown = await page.locator('.full-player').isVisible().catch(() => false);
  check('"f" opens the full player', fullShown);
  await shot(page, '04-full-player');

  const oldTrackInfo = await page
    .locator('.full-player__lyrics-text, .full-player :text("Track info"), .full-player :text("Open source page")')
    .count();
  check('full player no longer shows the track-info block', oldTrackInfo === 0);

  const lyricsRegion = page.locator('.full-player [role="region"][aria-label="Lyrics"]');
  check('full player has a lyrics panel', await lyricsRegion.isVisible().catch(() => false));

  // Lyrics come from a live provider (LRCLIB + YouTube caption fallback), so
  // the panel must simply settle into *some* non-loading state.
  const lyricsResolved = await page
    .waitForFunction(
      () => !document.querySelector('.full-player .full-player__lyrics-skeleton'),
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);
  check('lyrics panel exits its loading state', lyricsResolved);
  await shot(page, '05-full-player-lyrics');

  // Spotify-style lyrics toggle (mic button) hides / restores the panel.
  const lyricsToggle = page
    .locator('.full-player button[aria-label^="Show lyrics"], .full-player button[aria-label^="Hide lyrics"]')
    .first();
  if (await lyricsToggle.isVisible().catch(() => false)) {
    await lyricsToggle.click();
    await page.waitForTimeout(350);
    const hiddenWhenToggled = !(await lyricsRegion.isVisible().catch(() => false));
    check('lyrics toggle hides the lyrics panel', hiddenWhenToggled);
    await page.locator('.full-player button[aria-label^="Show lyrics"]').first().click();
    await page.waitForTimeout(400);
    check('lyrics toggle shows the lyrics panel again', await lyricsRegion.isVisible().catch(() => false));
  } else {
    check('lyrics toggle hides the lyrics panel', false, 'no toggle button');
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('Escape closes the full player', !(await page.locator('.full-player').isVisible().catch(() => false)));

  /* -------------------------------------------------------------- shortcuts */
  await page.keyboard.press('?');
  await page.waitForTimeout(500);
  const shortcutsDialog = await page.locator('[role="dialog"] >> text=Keyboard shortcuts').isVisible().catch(() => false);
  check('"?" opens the shortcuts dialog', shortcutsDialog);
  await shot(page, '06-shortcuts');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('Escape closes the dialog', !(await page.locator('[role="dialog"]').first().isVisible().catch(() => false)));

  /* ----------------------------------------------------------------- queue */
  // "q" is a global shortcut - make sure no text field has focus first.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(150);
  await page.keyboard.press('q');
  await page.waitForTimeout(600);
  const queueOpen = await page.locator('[role="dialog"][aria-label="Play queue"], .queue-panel').first().isVisible().catch(() => false);
  check('"q" opens the queue panel', queueOpen);
  await shot(page, '07-queue');
  await page.keyboard.press('q');
  await page.waitForTimeout(400);

  /* -------------------------------------------------------------- library */
  await page.goto(`${BASE}/library`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#main-content', { timeout: 15_000 });
  await page.waitForTimeout(1200);
  const createBtn = page.locator('button:has-text("New playlist"), button:has-text("Create playlist")').first();
  check('library exposes a create-playlist control', await createBtn.isVisible().catch(() => false));
  await shot(page, '08-library');

  if (await createBtn.isVisible().catch(() => false)) {
    await createBtn.click();
    await page.waitForTimeout(500);
    const nameInput = page.locator('[role="dialog"] input').first();
    await nameInput.fill('E2E Test List');
    await page.locator('[role="dialog"] button:has-text("Create")').last().click();
    await page.waitForTimeout(1000);
    const listed = await page.locator('a[href*="/playlist/"], .playlist-card, .library-row').count();
    check('playlist is created and listed', listed > 0, `${listed} entries`);
    await shot(page, '09-playlist-created');
  }

  /* ------------------------------------------------------------ liked page */
  await page.goto(`${BASE}/liked`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const likedRows = await page.locator('.track-row').count();
  check('liked page shows the track we liked', likedRows > 0, `${likedRows} rows`);
  await shot(page, '10-liked');

  /* -------------------------------------------------------------- settings */
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  const lightToggle = page.locator('button:has-text("Light")').first();
  if (await lightToggle.isVisible().catch(() => false)) {
    await lightToggle.click();
    await page.waitForTimeout(400);
    const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
    check('theme toggle switches data-theme', themeBefore !== themeAfter, `${themeBefore} -> ${themeAfter}`);
    await shot(page, '11-settings-light');
    await page.locator('button:has-text("Dark")').first().click();
    await page.waitForTimeout(300);
  } else {
    check('theme toggle switches data-theme', false, 'no Light button found');
  }

  const accentSwatch = page.locator('.swatch').nth(3);
  if (await accentSwatch.isVisible().catch(() => false)) {
    const accentBefore = await page.evaluate(() => document.documentElement.dataset.accent);
    await accentSwatch.click();
    await page.waitForTimeout(300);
    const accentAfter = await page.evaluate(() => document.documentElement.dataset.accent);
    check('accent swatch changes the accent token', accentBefore !== accentAfter, `${accentBefore} -> ${accentAfter}`);
    await page.locator('.swatch').first().click();
    await page.waitForTimeout(200);
  } else {
    check('accent swatch changes the accent token', false, 'no swatches');
  }

  const exportBtn = page.locator('button:has-text("Export JSON")').first();
  if (await exportBtn.isVisible().catch(() => false)) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }).catch(() => null),
      exportBtn.click(),
    ]);
    check('export produces a JSON download', Boolean(download), download ? download.suggestedFilename() : 'no event');
    if (download) {
      const p = path.join(SHOTS, 'export.json');
      await download.saveAs(p);
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const hasContent = Object.keys(raw).length > 0;
      check('export payload parses and has keys', hasContent, Object.keys(raw).slice(0, 8).join(','));
    }
  } else {
    check('export produces a JSON download', false, 'no export button');
  }
  await shot(page, '12-settings');

  /* --------------------------------------------------------------- import */
  const fixturePath = path.resolve('e2e/fixtures/ytrium-web-export.json');
  const fileInput = page.locator('input[type="file"][accept*="json"]');
  if ((await fileInput.count().catch(() => 0)) > 0) {
    await fileInput.setInputFiles(fixturePath);
    await page.waitForTimeout(1200);
    const importToast = await page.locator('.toast').last().textContent().catch(() => '');
    check('importing a JSON export shows a success toast', /Imported/.test(importToast ?? ''), importToast ?? '');
    await page.goto(`${BASE}/library`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#main-content', { timeout: 15_000 });
    await page.waitForTimeout(1200);
    const importedVisible = await page
      .locator('.card, .playlist-row')
      .filter({ hasText: 'Imported Fixture' })
      .first()
      .isVisible()
      .catch(() => false);
    check('imported playlist appears in the library', importedVisible);
    await shot(page, '13-library-after-import');
    // Leave the app on the settings route, ready for the next sections.
    await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
  } else {
    check('importing a JSON export shows a success toast', false, 'no file input');
  }

  /* -------------------------------------------------- account + admin UI */
  // Still on /settings - the signed-in account and (for admins) the user list.
  const accountVisible = await page.locator('#set-account').isVisible().catch(() => false);
  check('settings shows the account section', accountVisible);
  const signedInAs = await page
    .locator('section[aria-labelledby="set-account"] .settings-group__hint')
    .textContent()
    .catch(() => '');
  check('account section names the signed-in user', /admin/.test(signedInAs ?? ''), (signedInAs ?? '').trim().slice(0, 60));
  const adminVisible = await page.locator('#set-admin').isVisible().catch(() => false);
  check('admin account sees the users section', adminVisible);
  const listedUsers = await page.locator('.admin-user-row').count();
  check('users list contains at least the admin', listedUsers >= 1, `${listedUsers} rows`);

  /* ------------------------------------------------------ artist and album */
  await page.goto(`${BASE}/artist/daft%20punk`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const artistTracks = await page.locator('.track-row').count();
  check('artist page loads tracks', artistTracks > 0, `${artistTracks} rows`);
  await shot(page, '13-artist');

  await page.goto(`${BASE}/album/daft%20punk/discovery`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const albumTracks = await page.locator('.track-row').count();
  check('album page loads tracks', albumTracks > 0, `${albumTracks} rows`);
  await shot(page, '14-album');

  /* --------------------------------------------------------------- 404 page */
  await page.goto(`${BASE}/definitely-not-a-page`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const notFound = await page.locator('text=Page not found').isVisible().catch(() => false);
  check('unknown route renders NotFound', notFound);

  /* ------------------------------------------------------------- responsive */
  for (const [w, h, label] of [
    [320, 700, '320'],
    [768, 900, '768'],
    [1440, 900, '1440'],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    check(`no horizontal overflow at ${label}px`, overflow.scrollWidth <= overflow.clientWidth + 2, `${overflow.scrollWidth}/${overflow.clientWidth}`);
    await shot(page, `15-responsive-${label}`);
  }

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const settingsOverflow = await page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  check('settings page fits 320px', settingsOverflow <= 2, `${settingsOverflow}px over`);
  await shot(page, '16-settings-320');

  /* ----------------------------------------------------------- auth flows */
  /* Isolated context: rejected logins emit 401s into the console (audited on
     the main page above) and these flows must not disturb the admin session. */
  const authCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const authPage = await authCtx.newPage();
  const signIn = async (name, pw) => {
    await authPage.fill('input[aria-label="Username"]', name);
    await authPage.fill('input[aria-label="Password"]', pw);
    await authPage.click('.signin__submit');
  };
  const expectLoginStatus = async (name, pw, status) => {
    const [resp] = await Promise.all([
      authPage.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 15_000 }),
      signIn(name, pw),
    ]);
    check(
      `login as ${name} ${status === 200 ? 'succeeds' : `is rejected with HTTP ${status}`}`,
      resp.status() === status,
      `HTTP ${resp.status()}`,
    );
  };

  try {
    await authPage.goto(BASE, { waitUntil: 'domcontentloaded' });
    await authPage.waitForSelector('.signin', { timeout: 15_000 });

    // 1. Wrong credentials are rejected with a visible inline error.
    await expectLoginStatus('admin', 'not-the-password', 401);
    await authPage.waitForSelector('.signin__error', { timeout: 8_000 });
    const errText = (await authPage.locator('.signin__error').textContent()) || '';
    check(
      'rejected sign-in shows an inline error',
      /Incorrect username or password/.test(errText),
      errText.trim(),
    );

    // 2. Admin signs in and manages users from settings.
    await expectLoginStatus('admin', 'admin', 200);
    await authPage.waitForSelector('#main-content', { timeout: 15_000 });
    await authPage.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
    await authPage.waitForSelector('#set-admin', { timeout: 15_000 });
    await authPage.waitForTimeout(600);

    await authPage.fill('input[aria-label="New user username"]', 'e2e-alice');
    await authPage.fill('input[aria-label="New user password"]', 'alice-pw-1');
    const [createResp] = await Promise.all([
      authPage.waitForResponse(
        (r) => r.url().includes('/api/admin/users') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      authPage.click('button:has-text("Create user")'),
    ]);
    check('admin creates a user from settings', createResp.status() === 201, `HTTP ${createResp.status()}`);
    await authPage.waitForTimeout(700);
    const aliceRow = authPage.locator('.admin-user-row', { hasText: 'e2e-alice' }).first();
    check('new user appears in the users list', await aliceRow.isVisible().catch(() => false));
    const createToast = await authPage.locator('.toast').last().textContent().catch(() => '');
    check('user creation raises a toast', /created/i.test(createToast ?? ''), (createToast ?? '').trim());

    // Duplicate username is refused with an inline error.
    await authPage.fill('input[aria-label="New user username"]', 'e2e-alice');
    await authPage.fill('input[aria-label="New user password"]', 'alice-pw-1');
    const [dupResp] = await Promise.all([
      authPage.waitForResponse(
        (r) => r.url().includes('/api/admin/users') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      authPage.click('button:has-text("Create user")'),
    ]);
    check('duplicate username is refused', dupResp.status() === 409, `HTTP ${dupResp.status()}`);
    await authPage.waitForTimeout(400);
    const dupError = await authPage.locator('.admin-create + .field__error').first()
      .textContent()
      .catch(() => '');
    check('duplicate username shows an inline error', /taken/i.test(dupError ?? ''), (dupError ?? '').trim());

    // 3. Alice signs in with her credentials and edits her own account.
    await authPage.click('button:has-text("Sign out")');
    await authPage.waitForSelector('.signin', { timeout: 15_000 });
    check('sign out returns to the sign-in screen', true);

    await expectLoginStatus('e2e-alice', 'alice-pw-1', 200);
    await authPage.waitForSelector('#main-content', { timeout: 15_000 });
    await authPage.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
    await authPage.waitForSelector('#set-account', { timeout: 15_000 });
    const seesAdmin = await authPage.locator('#set-admin').count();
    check('regular users do not see the admin section', seesAdmin === 0, `${seesAdmin} admin sections`);
    await authPage.waitForTimeout(500);

    await authPage.fill('input[aria-label="New username"]', 'e2e-alice2');
    await authPage.fill('input[aria-label="New password"]', 'alice-pw-2');
    await authPage.fill('input[aria-label="Current password"]', 'alice-pw-1');
    const [changeResp] = await Promise.all([
      authPage.waitForResponse((r) => r.url().includes('/api/auth/change-credentials'), {
        timeout: 15_000,
      }),
      authPage.click('button:has-text("Save changes")'),
    ]);
    check(
      'user changes own username and password',
      changeResp.status() === 200,
      `HTTP ${changeResp.status()}`,
    );
    await authPage.waitForTimeout(700);
    const changeToast = await authPage.locator('.toast').last().textContent().catch(() => '');
    check('credential change raises a toast', /Updated your/.test(changeToast ?? ''), (changeToast ?? '').trim());
    const shownName = await authPage
      .locator('section[aria-labelledby="set-account"] .settings-group__hint')
      .textContent()
      .catch(() => '');
    check('account section shows the new username', /e2e-alice2/.test(shownName ?? ''), (shownName ?? '').trim().slice(0, 60));

    // 4. Old credentials stop working; the new pair signs in.
    await authPage.click('button:has-text("Sign out")');
    await authPage.waitForSelector('.signin', { timeout: 15_000 });
    await expectLoginStatus('e2e-alice', 'alice-pw-2', 401); // old username
    await expectLoginStatus('e2e-alice2', 'alice-pw-1', 401); // old password
    await expectLoginStatus('e2e-alice2', 'alice-pw-2', 200); // new pair
    await authPage.waitForSelector('#main-content', { timeout: 15_000 });

    // 5. Admin deletes Alice: her password is required, a wrong one is refused.
    await authPage.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
    await authPage.waitForSelector('#set-account', { timeout: 15_000 });
    await authPage.click('button:has-text("Sign out")');
    await authPage.waitForSelector('.signin', { timeout: 15_000 });
    await expectLoginStatus('admin', 'admin', 200);
    await authPage.waitForSelector('#main-content', { timeout: 15_000 });
    await authPage.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
    await authPage.waitForSelector('#set-admin', { timeout: 15_000 });
    await authPage.waitForTimeout(600);

    const targetRow = authPage.locator('.admin-user-row', { hasText: 'e2e-alice2' }).first();
    await targetRow.waitFor({ timeout: 10_000 });
    check('admin sees the renamed user in the list', await targetRow.isVisible());
    await targetRow.locator('button:has-text("Delete")').click();
    await authPage.waitForSelector('.dialog input[type="password"]', { timeout: 8_000 });

    await authPage.fill('.dialog input[type="password"]', 'wrong-password');
    const [delBad] = await Promise.all([
      authPage.waitForResponse(
        (r) => r.url().includes('/api/admin/users/') && r.request().method() === 'DELETE',
        { timeout: 15_000 },
      ),
      authPage.click('.dialog button:has-text("Delete user")'),
    ]);
    check('delete refuses the wrong password', delBad.status() === 403, `HTTP ${delBad.status()}`);
    const dialogStillOpen = await authPage.locator('.dialog').isVisible().catch(() => false);
    check('delete dialog stays open after a refusal', dialogStillOpen);
    const delErr = await authPage.locator('.dialog .field__error').textContent().catch(() => '');
    check('refusal explains why', /does not match/.test(delErr ?? ''), (delErr ?? '').trim());

    await authPage.fill('.dialog input[type="password"]', 'alice-pw-2');
    const [delGood] = await Promise.all([
      authPage.waitForResponse(
        (r) => r.url().includes('/api/admin/users/') && r.request().method() === 'DELETE',
        { timeout: 15_000 },
      ),
      authPage.click('.dialog button:has-text("Delete user")'),
    ]);
    check('delete succeeds with the user password', delGood.status() === 200, `HTTP ${delGood.status()}`);
    await authPage.waitForTimeout(900);
    const goneRows = await authPage.locator('.admin-user-row', { hasText: 'e2e-alice2' }).count();
    check('deleted user leaves the list', goneRows === 0, `${goneRows} rows`);

    // The deleted account can no longer sign in.
    await authPage.click('button:has-text("Sign out")');
    await authPage.waitForSelector('.signin', { timeout: 15_000 });
    await expectLoginStatus('e2e-alice2', 'alice-pw-2', 401);
  } catch (err) {
    failures += 1;
    console.error('AUTH SECTION ERROR:', err);
  } finally {
    await authCtx.close();
  }

  /* --------------------------------------------------------- console audit */
  const realErrors = consoleErrors.filter((e) => !isMediaDecodeError(e));
  check('no unexpected console/page errors', realErrors.length === 0, realErrors.slice(0, 5).join(' || '));
} catch (err) {
  failures += 1;
  console.error('SUITE ERROR:', err);
} finally {
  await browser.close();
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed, ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);