#!/usr/bin/env bash
# Ytrium installer for Linux.
#
# One-line install (installs the binary, a systemd service, and a desktop entry):
#
#   curl -fsSL https://raw.githubusercontent.com/vivek-502/yttrium/master/packaging/install.sh | sudo bash
#
# Uninstall (keeps your data in ~/.local/share/yttrium):
#
#   curl -fsSL https://raw.githubusercontent.com/vivek-502/yttrium/master/packaging/install.sh | sudo bash -s -- --uninstall
#
# What installation does:
#   1. Downloads the release binary for this architecture -> /usr/local/bin/yttrium
#   2. Creates the data directory for the invoking user   -> ~/.local/share/yttrium
#   3. Installs systemd unit                              -> /etc/systemd/system/yttrium.service
#   4. Installs a desktop entry and app icon              -> /usr/share/{applications,pixmaps}/yttrium.*
#   5. Enables + starts the service and waits for /api/health
#
# Overrides (environment variables, before `| sudo bash` or with `bash -s --`):
#   YTTRIUM_REPO    GitHub slug to install from   (default: vivek-502/yttrium)
#   YTTRIUM_VERSION Release tag, or "latest"      (default: latest)
#   YTTRIUM_BRANCH  Branch for raw files          (default: master)
#   YTTRIUM_PORT    Port for the service          (default: 8787)
#   YTTRIUM_USER    User to run the service as    (default: the sudo caller)
set -euo pipefail

REPO="${YTTRIUM_REPO:-vivek-502/yttrium}"
BRANCH="${YTTRIUM_BRANCH:-master}"
VERSION="${YTTRIUM_VERSION:-latest}"
PORT="${YTTRIUM_PORT:-8787}"

BIN_PATH="/usr/local/bin/yttrium"
UNIT_PATH="/etc/systemd/system/yttrium.service"
DESKTOP_PATH="/usr/share/applications/yttrium.desktop"
ICON_PATH="/usr/share/pixmaps/yttrium.png"

info() { printf '  %s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<EOF
Ytrium installer for Linux.

  curl -fsSL https://raw.githubusercontent.com/${REPO}/${BRANCH}/packaging/install.sh | sudo bash
  curl -fsSL https://raw.githubusercontent.com/${REPO}/${BRANCH}/packaging/install.sh | sudo bash -s -- --uninstall

Options:
  --uninstall   Remove the service, binary, desktop entry and icon
                (your data in ~/.local/share/yttrium is kept)
  -h, --help    Show this help

Environment: YTTRIUM_REPO, YTTRIUM_VERSION (latest|vX.Y.Z), YTTRIUM_BRANCH,
             YTTRIUM_PORT, YTTRIUM_USER, YTTRIUM_DATA_DIR
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
  step "uninstalling Ytrium"
  if command -v systemctl >/dev/null && [ -f "$UNIT_PATH" ]; then
    systemctl disable --now yttrium 2>/dev/null || true
    rm -f "$UNIT_PATH"
    systemctl daemon-reload
    info "removed $UNIT_PATH"
  fi
  rm -f "$BIN_PATH" "$DESKTOP_PATH" "$ICON_PATH"
  command -v update-desktop-database >/dev/null &&
    update-desktop-database /usr/share/applications 2>/dev/null || true
  info "removed binary, desktop entry and icon"
  REAL_USER="${YTTRIUM_USER:-${SUDO_USER:-}}"
  if [ -n "$REAL_USER" ] && [ "$REAL_USER" != "root" ]; then
    DATA="$(getent passwd "$REAL_USER" | cut -d: -f6)/.local/share/yttrium"
    info "data kept at $DATA (delete it manually to purge accounts and sessions)"
  fi
  printf '\n✓ Ytrium uninstalled\n'
  exit 0
fi

# ------------------------------------------------------------- preflight
REAL_USER="${YTTRIUM_USER:-${SUDO_USER:-}}"
[ -n "$REAL_USER" ] || die "cannot determine the user to run as.
Run via sudo from your user account, or set YTTRIUM_USER=<name>."
id "$REAL_USER" >/dev/null || die "user '$REAL_USER' does not exist"
USER_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
[ -n "$USER_HOME" ] || die "cannot resolve home for '$REAL_USER'"

case "$(uname -m)" in
  x86_64 | amd64) ARCH="x64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) die "unsupported architecture: $(uname -m) (Linux x86_64/aarch64 only)" ;;
esac

if [ "$VERSION" = "latest" ]; then
  BIN_URL="https://github.com/${REPO}/releases/latest/download/yttrium-linux-${ARCH}"
else
  BIN_URL="https://github.com/${REPO}/releases/download/${VERSION}/yttrium-linux-${ARCH}"
fi
RAW_BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"

if systemctl list-unit-files yttrium.service >/dev/null 2>&1 &&
  [ -f "$UNIT_PATH" ]; then
  step "stopping existing service"
  systemctl disable --now yttrium 2>/dev/null || true
fi

# ---------------------------------------------------------------- download
step "downloading yttrium-linux-${ARCH} (${VERSION})"
TMP="$(mktemp "${TMPDIR:-/tmp}/yttrium-install.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
curl -fsSL --retry 3 --retry-delay 2 -o "$TMP" "$BIN_URL" ||
  die "download failed: $BIN_URL
  - Is a release published for this repo/tag? (YTTRIUM_VERSION=... to pick one)
  - Does the release contain yttrium-linux-${ARCH} for this architecture?"
[ "$(head -c 4 "$TMP" | tr -d '\0')" = $'\x7fELF' ] ||
  die "downloaded file is not a Linux executable - refusing to install"
[ -s "$TMP" ] || die "downloaded file is empty"

step "installing to ${BIN_PATH}"
install -m 0755 "$TMP" "$BIN_PATH"
rm -f "$TMP"
trap - EXIT
info "yttrium installed ($(du -h "$BIN_PATH" | cut -f1))"

# ------------------------------------------------------------ data + icon
step "preparing data directory and icon"
DATA_DIR="${YTTRIUM_DATA_DIR:-$USER_HOME/.local/share/yttrium}"
install -d -m 0750 -o "$REAL_USER" -g "$(id -g "$REAL_USER")" "$DATA_DIR"
info "accounts/sessions: $DATA_DIR"
if curl -fsSL --retry 2 -o "$ICON_PATH.tmp" "${RAW_BASE}/packaging/yttrium-icon.png"; then
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
Description=Ytrium - local-first music streaming server
Documentation=https://github.com/${REPO}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${REAL_USER}
WorkingDirectory=${USER_HOME}
Environment=PORT=${PORT}
Environment=HOST=127.0.0.1
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
Name=Ytrium
Comment=Local-first music streaming
Exec=xdg-open http://127.0.0.1:${PORT}
Icon=yttrium
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
step "enabling and starting yttrium.service"
systemctl daemon-reload
systemctl enable --now yttrium

HEALTH=""
for _ in $(seq 1 30); do
  if HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/api/health" 2>/dev/null)"; then break; fi
  systemctl is-active --quiet yttrium || break
  sleep 0.5
done
if [ -z "$HEALTH" ]; then
  printf '\n'
  systemctl status yttrium --no-pager -l | head -20 || true
  die "service did not become healthy - see 'systemctl status yttrium'"
fi
info "health: $HEALTH"

printf '\n✓ Ytrium is installed and running\n\n'
info "Open:      http://127.0.0.1:${PORT}  (or the Ytrium entry in your app menu)"
info "Sign in:   admin / admin  - change the password in Settings → Account"
info "Service:   systemctl status|restart yttrium"
info "Logs:      journalctl -u yttrium -f"
info "Config:    edit Environment= lines in ${UNIT_PATH}, then: systemctl daemon-reload && systemctl restart yttrium"
info "Uninstall: curl -fsSL ${RAW_BASE}/packaging/install.sh | sudo bash -s -- --uninstall"
