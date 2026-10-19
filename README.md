# Ytrium

[![CI](https://github.com/vivek-502/ytrium-web/actions/workflows/ci.yml/badge.svg)](https://github.com/vivek-502/ytrium-web/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/vivek-502/ytrium-web?display_name=tag&sort=semver)](https://github.com/vivek-502/ytrium-web/releases)

A local-first music streaming app with a Spotify-class experience and its own identity:
search the web for music, queue it, organise it into playlists, and play it back — all from
one dark, keyboard-friendly player. Sign-in is a **local username/password** shared by the
people using this machine: no tracking, no cloud library — every account's data stays in
its own namespace in your browser.

- **Client** — React 18 + TypeScript + Vite, React Router, Zustand, CSS design tokens.
- **Server** — Node + Express + TypeScript. Search/metadata/streaming stay server-side;
  `yt-dlp` is spawned by the backend only (safe argument arrays, TTL caches, rate limits).
  Accounts and sessions are kept server-side (salted scrypt hashes, httpOnly cookies).
- **Storage** — IndexedDB for library/playlists/history/queue, `localStorage` for tiny
  preferences, both scoped to the signed-in user. Nothing leaves your machine except
  provider API calls.

Ytrium is an original project: its own name, mark, and colour system. It is not affiliated
with, derived from, or a clone of any existing streaming service.

---

## Install (single-file binary, Linux)

The packaged binary embeds the Node runtime and the built frontend — no Node, npm or build
step needed on the target machine. It still needs **`yt-dlp` on `PATH`** (and `ffmpeg`
recommended) to reach providers.

One line installs the binary, a **systemd service** that starts on boot, and a desktop
menu entry:

```bash
curl -fsSL https://raw.githubusercontent.com/vivek-502/ytrium-web/master/packaging/install.sh | sudo bash
```

Then open <http://127.0.0.1:8787> (or the **Ytrium** entry in your app menu). The default
account is **`admin` / `admin`** — change it from Settings → Account, then create regular
accounts in Settings → Users.

**Every device on your network can use the same library.** The service binds to
`0.0.0.0:8787`, so any phone, tablet or computer on your Wi-Fi can sign in at
`http://<your-computer's-LAN-IP>:8787` (the installer prints that URL when it finishes). Each
person gets their own account, library and playlists. This is plain HTTP with no transport
encryption, so only do it on a network you trust — install with `YTRIUM_WEB_HOST=127.0.0.1`
(or set `HOST=127.0.0.1` when running from source) to keep it to this machine only.

Manage the service:

```bash
sudo systemctl status ytrium-web        # is it up?
sudo systemctl restart ytrium-web       # restart after config changes
journalctl -u ytrium-web -f             # follow logs
```

Remove it (your data in `~/.local/share/ytrium-web` is kept):

```bash
curl -fsSL https://raw.githubusercontent.com/vivek-502/ytrium-web/master/packaging/install.sh | sudo bash -s -- --uninstall
```

Prefer a pinned version, a different port, or to run as another user? The installer honours
`YTRIUM_WEB_VERSION` (`latest` or `vX.Y.Z`), `YTRIUM_WEB_PORT`, `YTRIUM_WEB_HOST`,
`YTRIUM_WEB_USER`, `YTRIUM_WEB_DATA_DIR`, `YTRIUM_WEB_REPO` and `YTRIUM_WEB_BRANCH`:

```bash
curl -fsSL https://raw.githubusercontent.com/vivek-502/ytrium-web/master/packaging/install.sh \
  | sudo YTRIUM_WEB_VERSION=v1.0.6 YTRIUM_WEB_PORT=9000 bash
```

The service runs as your user (not root) and stores its database under
`~/.local/share/ytrium-web` — set `YTRIUM_WEB_DATA_DIR` to relocate it.

## Run from source

Requirements: **Node 20+**, **yt-dlp** on `PATH` (`yt-dlp --version`), `ffmpeg` recommended
(used by `yt-dlp` when a format needs remuxing).

```bash
cp .env.example .env      # optional — every value has a working default
npm install               # installs root, server and client deps
npm run dev               # API on :8787, client on :5173
```

Open <http://localhost:5173>. The first run creates a default **`admin` / `admin`**
account — sign in with it and change the password from Settings → Account (then create
regular accounts for everyone else in Settings → Users).

Production build and serve (the API then also serves `client/dist`):

```bash
npm run build
npm start                 # http://127.0.0.1:8787
```

### Scripts

| Command             | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | API (`tsx watch`) + Vite dev server, concurrently      |
| `npm run dev:server` | Backend only (port 8787)                              |
| `npm run dev:client` | Vite only (port 5173, proxies `/api` to 8787)         |
| `npm run build`      | Type-check + build client, then compile server        |
| `npm start`          | Run the compiled server, serving `client/dist` if built |
| `npm run typecheck`  | `tsc --noEmit` for both packages                      |
| `npm run lint` / `npm run format` | ESLint / Prettier                          |
| `npm run test:e2e`   | Headless browser smoke test (needs both dev servers running) |
| `npm run build:bin`  | Package the single-file Linux binary into `dist-bin/`  |

### Build the binary

`npm run build:bin` produces `dist-bin/ytrium-web-linux-<arch>` — one self-contained
executable (frontend embedded in-memory, Node runtime baked in via Node's single-executable
app support). The resulting file runs on the machine that built it, so produce each target
arch on matching hardware; the Release workflow does exactly that for x64 and arm64.

```bash
npm install                 # once, for build deps (esbuild)
npm run build:bin           # -> dist-bin/ytrium-web-linux-x64
DATA_DIR=$(mktemp -d) ./dist-bin/ytrium-web-linux-x64   # smoke it on :8787
```

At runtime the binary needs no Node install — only `yt-dlp` (and `ffmpeg`) on `PATH`.

---

## Configuration

Copy `.env.example` to `.env` (repository root; `server/.env` is also read). Every key in
`.env.example` is honoured by `server/src/config.ts`.

### Server

| Variable          | Default             | Description                                            |
| ----------------- | ------------------- | ------------------------------------------------------ |
| `PORT`            | `8787`              | API port                                               |
| `HOST`            | `0.0.0.0`           | Bind interface (`0.0.0.0` = whole LAN, `127.0.0.1` = this machine only) |
| `NODE_ENV`        | `development`       | `production` enables stricter behaviour                |
| `CORS_ORIGIN`     | `http://localhost:5173` | Comma-separated allowed origins for cross-origin use |

### Accounts & sessions

| Variable              | Default            | Description                                          |
| --------------------- | ------------------ | ---------------------------------------------------- |
| `SESSION_TTL_DAYS`    | `30`               | Days a signed-in session stays valid                 |
| `RATE_LIMIT_AUTH_PER_MIN` | `20`           | Password checks per minute (sign-in, credential change, admin deletes) |
| `DATA_DIR`            | `server/data` (checkout) · `~/.local/share/ytrium-web` (binary) | Where `users.json` and `sessions.json` live |

On first run Ytrium bootstraps an `admin` / `admin` account. Passwords are stored only as
salted scrypt hashes; session tokens are stored only as SHA-256 hashes. See
[Accounts & privacy](#accounts--privacy) for the admin/user privacy rules.

### yt-dlp

| Variable             | Default   | Description                                             |
| -------------------- | --------- | ------------------------------------------------------- |
| `YTDLP_PATH`         | `yt-dlp`  | Executable (absolute path recommended in production)    |
| `YTDLP_TIMEOUT_MS`   | `30000`   | Hard timeout per invocation                             |
| `YTDLP_SEARCH_LIMIT` | `20`      | Results per search (capped at 50)                       |
| `YTDLP_EXTRA_ARGS`   | *(empty)* | Extra CLI args, comma separated (e.g. a proxy)          |
| `YTDLP_FORCE_IPV4`   | `true`    | Keep yt-dlp on IPv4. Home networks often have a broken IPv6 route, which makes yt-dlp hang until the request times out; set `false` only on an IPv6-only host |

### Streaming

| Variable         | Default  | Description                                                       |
| ---------------- | -------- | ----------------------------------------------------------------- |
| `STREAM_MODE`    | `proxy`  | `proxy` relays bytes through the API; `redirect` replies 302      |
| `STREAM_TTL_MS`  | `1800000`| How long a resolved media URL stays fresh in memory. Resolved URLs are **never** written to disk or the database. |

### Cache (all in-memory, TTL based)

| Variable                     | Default       |
| ---------------------------- | ------------- |
| `SEARCH_CACHE_TTL_MS`        | `600000`      |
| `METADATA_CACHE_TTL_MS`      | `86400000`    |
| `CHART_CACHE_TTL_MS`         | `1800000`     |
| `RECOMMENDATION_CACHE_TTL_MS`| `1800000`     |
| `CACHE_MAX_ENTRIES`          | `500`         |

### Rate limiting

| Variable                  | Default |
| ------------------------- | ------- |
| `RATE_LIMIT_WINDOW_MS`    | `60000` |
| `RATE_LIMIT_SEARCH_PER_MIN` | `40`  |
| `RATE_LIMIT_STREAM_PER_MIN` | `60`  |
| `RATE_LIMIT_API_PER_MIN`    | `300` |
| `RATE_LIMIT_AUTH_PER_MIN`   | `20`  |

### Providers

| Variable                 | Default                     | Description                                                        |
| ------------------------ | --------------------------- | ------------------------------------------------------------------ |
| `ENABLE_CHARTS_PROVIDER` | `true`                      | Charts/metadata from Apple's public iTunes RSS + lookup (metadata only — no media is streamed from them). `false` falls back to yt-dlp search-derived charts. |
| `CHARTS_API_BASE`        | `https://itunes.apple.com`  | Charts provider base URL                                           |
| `CHARTS_REGION`          | `us`                        | Charts region                                                      |

| Variable             | Default                  | Description                                                        |
| -------------------- | ------------------------ | ------------------------------------------------------------------ |
| `ENABLE_LYRICS_PROVIDER` | `true`                | Lyrics via the public LRCLIB API (no key), with a YouTube-caption fallback. `false` skips the database and only uses captions. |
| `LYRICS_API_BASE`    | `https://lrclib.net`     | Lyrics provider base URL                                            |
| `LYRICS_TIMEOUT_MS`  | `10000`                  | Timeout for a lyrics database lookup (ms)                          |
| `LYRICS_SUBS_TIMEOUT_MS` | `12000`               | Timeout for the yt-dlp caption fallback (ms)                       |
| `LYRICS_CACHE_TTL_MS`| `86400000`               | How long "no lyrics" results are remembered (ms)                   |
| `LYRICS_CACHE_MAX_ENTRIES` | `400`               | Max cached lyrics entries                                          |

---

## Features

**Player** — play/pause, next/previous, seek bar and elapsed/remaining time, volume and
mute, shuffle, repeat (off → all → one), a real queue with drag reordering, one-tap
retry on stream errors, autoplay of the next track, and cross-track fades.

**Library** — liked songs, playlists (create, rename, edit, delete, drag-and-drop
reordering, add/remove tracks), saved albums, followed artists, recently played grouped
by day, and per-track play signals (plays, skips, listen time) that feed recommendations.

**Discovery** — home sections (trending, popular, new releases, recommended for you,
quick picks), full-text search with recent-search history, and artist and album pages
with related artists.

**Lyrics** — the full player shows synced lyrics for the current track with a
follow-along highlight that tracks playback, falling back to plain text when
time-synced lines are unavailable (plus graceful *instrumental* / *no lyrics*
states). Lyrics are resolved backend-only via the public LRCLIB API, with the
track's YouTube captions as a fallback.

**Interface** — mini player bar + expandable full player with a Spotify-style blurred
artwork backdrop and a toggleable synced-lyrics panel, slide-in queue panel, context
menus everywhere, toasts, skeleton loaders, empty states, a light/dark theme with five
accent colours, compact mode, reduced motion, responsive layout from 320px to 1920px.

**Accounts** — every visit starts at a sign-in screen (username + password, no email, no
forgot-password flow). The bootstrap `admin` can create users from Settings → Users —
the password is set **once, at creation** — and delete them, which requires *that user's*
password; an admin can never read, reset or set anyone's password. Each user renames
themselves and changes their own password from Settings → Account (current password
required), and signs out from the same section. Each account gets its own library,
history, queue and settings on the device; sessions persist across server restarts and
expire after `SESSION_TTL_DAYS`.

**Settings** — account (username/password, sign out), theme, accent, compact mode,
reduced motion, autoplay, crossfade length, audio quality (auto/low/high), volume
normalisation, JSON export **and import** of your library (playlists, likes, history and
settings merge in — nothing local is deleted), clearing listening data / search history,
and a full reset (which only clears the signed-in account's local data). Admins also get
the user management section.

**Keyboard** — Space, ←/→ (Shift for 10s), ↑/↓, `M`, `N`/`P`, `S`, `R`, `Q`, `F`, `/`,
`?`, `Esc`. Shortcuts are disabled while typing in a field.

**Accessibility** — skip link, labelled icon buttons, focus-trapped dialogs and menus,
`aria-live` regions for toasts and player status, visible focus rings, and full keyboard
operation of every control.

**Performance** — every route is code-split, long track lists are virtualised, provider
results are cached client-side, and the backend caches search/metadata/charts with TTLs.

---

## Architecture

```
client/src/
  components/   UI kit, menus, dialogs, cards, track lists, player, layout, sign-in gate
  pages/        Route-level screens (code-split)
  stores/       Zustand stores: auth, player, library, settings, ui, discovery
  engine/       Single long-lived <audio> element + optional WebAudio graph
  providers/    MusicProvider interface + the HTTP API implementation (music + auth)
  rec/          Local recommendation engine over your play signals
  lib/          IndexedDB, preferences, formatting, hooks (storage is user-scoped)
  styles/       tokens / base / layout / components / player / auth

server/src/
  app.ts        Express app: security headers, CORS, rate limits, SPA serving
  routes/       auth, admin, health, search, resolve, tracks, artist, album,
                charts, trending, recommendations, lyrics, stream (+ /meta)
  providers/    youtube (yt-dlp), charts (iTunes RSS/lookup), lyrics (LRCLIB + captions)
  services/     stream service (URL resolution, TTL cache, proxy/redirect),
                users (scrypt hashes, JSON store), sessions (token hashes, TTL)
  middleware/   session gate (httpOnly cookie), rate limiting, sanitisation,
                error handling
  config.ts     Reads .env (root, then server/) — single source of truth
```

Every `/api/*` route except `/api/health` and `/api/auth/*` requires a valid session
cookie; the admin routes additionally require the `admin` role.

### API

| Endpoint                             | Purpose                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `GET /api/health`                    | Liveness + provider list (public)                    |
| `POST /api/auth/login`               | Sign in `{username,password}` → sets the session cookie |
| `GET /api/auth/me`                   | Current session user, or `{user:null}` (public)      |
| `POST /api/auth/logout`              | Revoke the session and clear the cookie              |
| `POST /api/auth/change-credentials`  | Change your own username/password (current password required) |
| `GET /api/admin/users`               | List accounts, admin only (never includes hashes)    |
| `POST /api/admin/users`              | Create a user `{username,password}`, admin only      |
| `DELETE /api/admin/users/:id`        | Delete a user, admin only — body must carry **that user's** password |
| `GET /api/search?q=&limit=`          | Search tracks/artists/albums                         |
| `GET|POST /api/resolve`              | Turn metadata (or a description) into a playable track |
| `GET /api/tracks/:id`                | Single track metadata                                |
| `GET /api/artist?name=&limit=`       | Artist, popular tracks, albums, related artists      |
| `GET /api/album?artist=&title=`      | Album metadata + tracks                              |
| `GET /api/charts`                    | Trending / popular / new releases + featured artists/albums |
| `GET /api/trending?limit=`           | Trending tracks only                                 |
| `GET /api/recommendations?seeds=&limit=` | Provider-side similar material                   |
| `GET /api/lyrics?title=&artist=&id=&album=&duration=` | Synced or plain lyrics for a track (metadata only; `{lyrics:null}` when none exist) |
| `GET /api/stream/:id?q=auto\|low\|high` | Proxied audio (HTTP Range / 206 supported)        |
| `GET /api/stream/:id/meta`           | Warm the stream cache without streaming              |

Track ids are stable and provider-qualified: `yt:<videoId>` and `itunes:<id>`. Chart
records are metadata-only until played — the client calls `/api/resolve` just before
playback, so nothing streams from the charts provider.

### Provider integration boundary

What is fully integrated and tested:

- **Search, metadata and streaming via `yt-dlp`** (YouTube) — spawned only by the API,
  never by the browser, always with an argument array (no shell interpolation), a hard
  timeout, and stderr folded into a sanitised client error.
- **Charts/album/artist discovery via Apple's public iTunes RSS + lookup endpoints** —
  metadata only; playback of those records is resolved to a playable source on demand.
- **Lyrics via the public LRCLIB API** (exact match, then a scored search), with the
  track's own YouTube captions as a fallback. Lyrics are text metadata only — no media
  is fetched — and are cached in-memory, never written to disk.

What is deliberately out of scope (and why):

- **Streaming from iTunes or any other commercial catalogue** is not implemented —
  those services do not offer a public playback API. Charts entries are metadata that
  resolves to a `yt-dlp`-backed stream.
- **Lyrics licensing / display** — Ytrium renders lyric text supplied by a community
  database (LRCLIB) or the track's own captions. Lyrics shown are for personal use;
  rights remain with the original rights holders, and lyrics are never re-published or
  stored by Ytrium itself.
- **Cloud sync, a central catalogue, and DRM playback** are out of scope by design:
  Ytrium is local-first. Accounts are local too — usernames and salted password hashes
  live in this instance's `server/data/users.json`, sessions in `sessions.json`, and
  nothing is sent anywhere. There is no email, no recovery service and no cloud
  identity provider.

If a provider call fails (network down, rate limited, region blocked), the UI shows a
retryable error state rather than a broken control.

### Data & privacy

- Everything you create — playlists, likes, history, search history, queue, settings —
  is stored locally (IndexedDB / `localStorage`) and can be exported **and re-imported**
  as JSON from Settings (Settings → Your data). Imports validate and sanitise the file,
  then merge: playlists replace same-id copies, likes/history dedupe by id, and nothing
  already on the device is removed.
- **Expiring media URLs are never persisted.** They live only in the backend's in-memory
  TTL cache (`STREAM_TTL_MS`) and are re-resolved when they lapse.
- The backend sanitises error messages before they reach the client, so upstream
  details/URLs are not leaked into the UI or logs of the browser.

### Accounts & privacy

- **Sign-in is local.** Usernames and salted **scrypt** password hashes live in
  `server/data/users.json` (file mode `0600`, gitignored); sessions live beside it in
  `sessions.json` as **SHA-256 token hashes** — only the browser's httpOnly cookie holds
  the raw token. Nothing account-related is sent to any third party.
- **The admin can create and delete accounts, and nothing else.** A password is chosen
  once, at creation: it can never be read, reset or set afterwards — not even by an
  admin. Changing your own username or password always requires your current password,
  and deleting an account requires *that user's* password (the admin neither knows nor
  can reset it) and revokes their sessions immediately. Admins cannot delete their own
  account.
- **Each account has its own local data.** Library, history, queue and settings are
  namespaced per user id, so one browser can host several accounts without mixing their
  libraries. Resetting from Settings clears only the signed-in account's data. The first
  sign-in after upgrading claims any pre-account local data, so existing libraries
  survive the move.
- Sessions survive server restarts (they are persisted on disk) and expire after
  `SESSION_TTL_DAYS`. Sign-in and credential checks are rate limited per client IP.

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Searches fail with a provider error | Check `yt-dlp --version` and update it: `yt-dlp -U` |
| Search and playback time out after ~30s | Almost always a broken IPv6 route: yt-dlp tries IPv6 first and hangs. The server forces IPv4 by default; make sure `YTDLP_FORCE_IPV4` isn't set to `false`. Verify with `curl -6 -sI https://www.youtube.com/` (a hang means IPv6 is unusable) |
| `EADDRINUSE` | Another process holds 8787/5173 — change `PORT` or stop it |
| Audio won't start | Browsers require a user gesture before playback; press play once |
| Empty charts | Set `ENABLE_CHARTS_PROVIDER=false` for the yt-dlp derived fallback |
| Slow first stream | The first request resolves the media URL (~1–3s); it is cached afterwards |
| A user forgot their password | Admins cannot reset passwords by design. Stop the API (`sudo systemctl stop ytrium-web`, or your dev process) and remove that user from `users.json` in `DATA_DIR` (`server/data` from source, `~/.local/share/ytrium-web` from the binary), then recreate the account from Settings → Users (its local data on that browser remains under the old id and is simply not claimed again) |
| Installed service won't start | `journalctl -u ytrium-web -n 50` — usually `yt-dlp` isn't on the *service's* `PATH`; install it system-wide or point the unit's `Environment` at it |

## License

Provided as-is for personal use.
