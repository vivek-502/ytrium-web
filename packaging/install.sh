#!/usr/bin/env bash
# Ytrium Web installer for Linux.
#
# One-line install (installs the binary, a systemd service, and a desktop entry):
#
#   curl -fsSL https://raw.githubusercontent.com/vivek-502/ytrium-web/master/packaging/install.sh | sudo bash
#
# Uninstall (keeps your data in ~/.local/share/ytrium-web):
#
#   curl -fsSL https://raw.githubusercontent.com/vivek-502/ytrium-web/master/packaging/install.sh | sudo bash -s -- --uninstall
#
# What installation does:
#   1. Migrates a pre-rename "yttrium" install, if present (see "Migration")
#   2. Downloads the release binary for this architecture -> /usr/local/bin/ytrium-web
#   3. Creates the data directory for the invoking user   -> ~/.local/share/ytrium-web
#   4. Installs systemd unit                              -> /etc/systemd/system/ytrium-web.service
#   5. Installs a desktop entry and app icon              -> /usr/share/{applications,pixmaps}/ytrium-web.*
#   6. Enables + starts the service and waits for /api/health
#
# Migration:
#   The app was renamed from "yttrium" to "ytrium-web". If an older install is
#   found (yttrium.service, /usr/local/bin/yttrium, ~/.local/share/yttrium), this
#   installer stops and removes those artifacts and moves the data directory
#   forward, so accounts and sessions carry over. Nothing is deleted.
#
# Overrides (environment variables, before `| sudo bash` or with `bash -s --`):
#   YTRIUM_WEB_REPO    GitHub slug to install from   (default: vivek-502/ytrium-web)
#   YTRIUM_WEB_VERSION Release tag, or "latest"      (default: latest)
#   YTRIUM_WEB_BRANCH  Branch for raw files          (default: master)
#   YTRIUM_WEB_PORT    Port for the service          (default: 8787)
#   YTRIUM_WEB_USER    User to run the service as    (default: the sudo caller)
set -euo pipefail

REPO="${YTRIUM_WEB_REPO:-vivek-502/ytrium-web}"
BRANCH="${YTRIUM_WEB_BRANCH:-master}"
VERSION="${YTRIUM_WEB_VERSION:-latest}"
PORT="${YTRIUM_WEB_PORT:-8787}"

BIN_PATH="/usr/local/bin/ytrium-web"
UNIT_PATH="/etc/systemd/system/ytrium-web.service"
DESKTOP_PATH="/usr/share/applications/ytrium-web.desktop"
ICON_PATH="/usr/share/pixmaps/ytrium-web.png"

# Pre-rename artifacts, migrated on install and removed on uninstall.
LEGACY_BIN_PATH="/usr/local/bin/yttrium"
LEGACY_UNIT_PATH="/etc/systemd/system/yttrium.service"
LEGACY_DESKTOP_PATH="/usr/share/applications/yttrium.desktop"
LEGACY_ICON_PATH="/usr/share/pixmaps/yttrium.png"

info() { printf '  %s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<EOF
Ytrium Web installer for Linux.

  curl -fsSL https://raw.githubusercontent.com/${REPO}/${BRANCH}/packaging/install.sh | sudo bash
  curl -fsSL https://raw.githubusercontent.com/${REPO}/${BRANCH}/packaging/install.sh | sudo bash -s -- --uninstall

Options:
  --uninstall   Remove the service, binary, desktop entry and icon
                (your data in ~/.local/share/ytrium-web is kept)
  -h, --help    Show this help

Environment: YTRIUM_WEB_REPO, YTRIUM_WEB_VERSION (latest|vX.Y.Z), YTRIUM_WEB_BRANCH,
             YTRIUM_WEB_PORT, YTRIUM_WEB_USER, YTRIUM_WEB_DATA_DIR
EOF
}

UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown argument: $arg (try --uninstall or --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "root is required. Run:
  curl -fsSL https://raw.githubusercontent.com/${REPO}/${BRANCH}/packaging/install.sh | sudo bash"
command -v systemctl >/dev/null || die "systemd (systemctl) is required"
command -v curl >/dev/null || die "curl is required"

# ---------------------------------------------------------------- uninstall
if [ "$UNINSTALL" -eq 1 ]; then
  step "uninstalling Ytrium Web"
  for unit in ytrium-web yttrium; do
    if [ -f "/etc/systemd/system/${unit}.service" ]; then
      systemctl disable --now "$unit" 2>/dev/null || true
      rm -f "/etc/systemd/system/${unit}.service"
      info "removed /etc/systemd/system/${unit}.service"
    fi
  done
  systemctl daemon-reload
  rm -f "$BIN_PATH" "$LEGACY_BIN_PATH" "$DESKTOP_PATH" "$LEGACY_DESKTOP_PATH" \
        "$ICON_PATH" "$LEGACY_ICON_PATH"
  command -v update-desktop-database >/dev/null &&
    update-desktop-database /usr/share/applications 2>/dev/null || true
  info "removed binary, desktop entry and icon"
  REAL_USER="${YTRIUM_WEB_USER:-${SUDO_USER:-}}"
  if [ -n "$REAL_USER" ] && [ "$REAL_USER" != "root" ]; then
    USER_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
    for d in "$USER_HOME/.local/share/ytrium-web" "$USER_HOME/.local/share/yttrium"; do
      [ -d "$d" ] && info "data kept at $d (delete it manually to purge accounts and sessions)"
    done
  fi
  printf '\n✓ Ytrium Web uninstalled\n'
  exit 0
fi

# ------------------------------------------------------------- preflight
REAL_USER="${YTRIUM_WEB_USER:-${SUDO_USER:-}}"
[ -n "$REAL_USER" ] || die "cannot determine the user to run as.
Run via sudo from your user account, or set YTRIUM_WEB_USER=<name>."
id "$REAL_USER" >/dev/null || die "user '$REAL_USER' does not exist"
USER_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
[ -n "$USER_HOME" ] || die "cannot resolve home for '$REAL_USER'"

case "$(uname -m)" in
  x86_64 | amd64) ARCH="x64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) die "unsupported architecture: $(uname -m) (Linux x86_64/aarch64 only)" ;;
esac

if [ "$VERSION" = "latest" ]; then
  BIN_URL="https://github.com/${REPO}/releases/latest/download/ytrium-web-linux-${ARCH}"
else
  BIN_URL="https://github.com/${REPO}/releases/download/${VERSION}/ytrium-web-linux-${ARCH}"
fi
RAW_BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"

# --------------------------------------------------------------- migration
# Stop any pre-rename service so the new unit can take the port, and move the
# old data directory forward. Both are skipped on a clean first install.
DATA_DIR="${YTRIUM_WEB_DATA_DIR:-$USER_HOME/.local/share/ytrium-web}"
LEGACY_DATA_DIR="$USER_HOME/.local/share/yttrium"

if [ -f "$LEGACY_UNIT_PATH" ]; then
  step "migrating from the previous 'yttrium' install"
  systemctl disable --now yttrium 2>/dev/null || true
  rm -f "$LEGACY_UNIT_PATH"
  systemctl daemon-reload
  info "removed legacy service yttrium.service"
fi
rm -f "$LEGACY_BIN_PATH" "$LEGACY_DESKTOP_PATH" "$LEGACY_ICON_PATH"

if [ ! -e "$DATA_DIR" ] && [ -d "$LEGACY_DATA_DIR" ]; then
  info "moving data: $LEGACY_DATA_DIR -> $DATA_DIR"
  if mv "$LEGACY_DATA_DIR" "$DATA_DIR" 2>/dev/null; then
    info "accounts and sessions carried over"
  else
    info "could not move data (permissions?) - it stays at $LEGACY_DATA_DIR"
  fi
fi

# ---------------------------------------------------------------- download
step "downloading ytrium-web-linux-${ARCH} (${VERSION})"
TMP="$(mktemp "${TMPDIR:-/tmp}/ytrium-web-install.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
curl -fsSL --retry 3 --retry-delay 2 -o "$TMP" "$BIN_URL" ||
  die "download failed: $BIN_URL
  - Is a release published for this repo/tag? (YTRIUM_WEB_VERSION=... to pick one)
  - Does the release contain ytrium-web-linux-${ARCH} for this architecture?"
[ "$(head -c 4 "$TMP" | tr -d '\0')" = $'\x7fELF' ] ||
  die "downloaded file is not a Linux executable - refusing to install"
[ -s "$TMP" ] || die "downloaded file is empty"

step "installing to ${BIN_PATH}"
install -m 0755 "$TMP" "$BIN_PATH"
rm -f "$TMP"
trap - EXIT
info "ytrium-web installed ($(du -h "$BIN_PATH" | cut -f1))"

# ------------------------------------------------------------ data + icon
step "preparing data directory and icon"
install -d -m 0750 -o "$REAL_USER" -g "$(id -g "$REAL_USER")" "$DATA_DIR"
info "accounts/sessions: $DATA_DIR"
if curl -fsSL --retry 2 -o "$ICON_PATH.tmp" "${RAW_BASE}/packaging/ytrium-web-icon.png"; then
  install -m 0644 "$ICON_PATH.tmp" "$ICON_PATH"
  rm -f "$ICON_PATH.tmp"
  info "icon: $ICON_PATH"
else
  rm -f "$ICON_PATH.tmp"
  info "icon download failed - continuing without it"
fi

# --------------------------------------------------------- service + entry
step "installing systemd service (runs as '${REAL_USER}')"
cat >"$UNIT_PATH" <<EOF
[Unit]
Description=Ytrium Web - local-first music streaming server
Documentation=https://github.com/${REPO}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${REAL_USER}
WorkingDirectory=${USER_HOME}
Environment=PORT=${PORT}
Environment=HOST=127.0.0.1
Environment=DATA_DIR=${DATA_DIR}
# Provider overrides go here, e.g. a pipx-installed yt-dlp:
#   Environment=YTDLP_PATH=${USER_HOME}/.local/bin/yt-dlp
ExecStart=${BIN_PATH}
Restart=on-failure
RestartSec=3

# Hardening: the service needs its own home (data), /tmp (yt-dlp scratch)
# and the network - nothing else.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF
info "$UNIT_PATH"

step "installing desktop entry"
cat >"$DESKTOP_PATH" <<EOF
[Desktop Entry]
Type=Application
Name=Ytrium Web
Comment=Local-first music streaming
Exec=xdg-open http://127.0.0.1:${PORT}
Icon=ytrium-web
Terminal=false
Categories=AudioVideo;Audio;Music;
Keywords=music;player;streaming;local;
StartupNotify=false
EOF
chmod 0644 "$DESKTOP_PATH"
command -v update-desktop-database >/dev/null &&
  update-desktop-database /usr/share/applications 2>/dev/null || true
info "$DESKTOP_PATH"

# --------------------------------------------------------------- start/verify
step "enabling and starting ytrium-web.service"
systemctl daemon-reload
systemctl enable --now ytrium-web

HEALTH=""
for _ in $(seq 1 30); do
  if HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/api/health" 2>/dev/null)"; then break; fi
  systemctl is-active --quiet ytrium-web || break
  sleep 0.5
done
if [ -z "$HEALTH" ]; then
  printf '\n'
  systemctl status ytrium-web --no-pager -l | head -20 || true
  die "service did not become healthy - see 'systemctl status ytrium-web'"
fi
info "health: $HEALTH"

printf '\n✓ Ytrium Web is installed and running\n\n'
info "Open:      http://127.0.0.1:${PORT}  (or the Ytrium Web entry in your app menu)"
info "Sign in:   admin / admin  - change the password in Settings → Account"
info "Service:   systemctl status|restart ytrium-web"
info "Logs:      journalctl -u ytrium-web -f"
info "Config:    edit Environment= lines in ${UNIT_PATH}, then: systemctl daemon-reload && systemctl restart ytrium-web"
info "Uninstall: curl -fsSL ${RAW_BASE}/packaging/install.sh | sudo bash -s -- --uninstall"
