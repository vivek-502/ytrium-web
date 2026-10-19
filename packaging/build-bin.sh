#!/usr/bin/env bash
# Builds the Ytrium single-file binary for THIS machine (Node SEA).
#
#   packaging/build-bin.sh [output-name]     # default: yttrium-<os>-<arch>
#
# Pipeline:
#   1. vite build of client/            -> client/dist
#   2. packaging/embed-client.mjs       -> build/clientAssets.generated.ts + sea-config.json
#   3. esbuild bundles packaging/sea-entry.ts (ESM -> one CJS file, deps inlined)
#   4. node --build-sea=<config>        -> dist-bin/<name>  (the finished binary)
#   5. smoke test: boot it, hit /api/health
#
# Node 26 introduced `--build-sea`, which assembles the executable itself -
# no postject, no manual blob injection. The binary embeds THIS machine's
# Node runtime and is therefore platform-specific: run on each target
# platform (or CI) to publish builds. Building requires Node 26+.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

case "$(uname -m)" in
  x86_64 | amd64) DEFAULT_ARCH="x64" ;;
  aarch64 | arm64) DEFAULT_ARCH="arm64" ;;
  *) echo "error: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="${YTRIUM_ARCH:-$DEFAULT_ARCH}"
OUT_DIR="$ROOT/dist-bin"
BIN="$OUT_DIR/${1:-yttrium-${OS}-${ARCH}}"

ESBUILD="$ROOT/node_modules/.bin/esbuild"
command -v node >/dev/null || { echo "error: node not found on PATH" >&2; exit 1; }
# `--build-sea` exists on Node 26+; older Nodes only know the removed
# experimental pipeline, so fail fast with a clear message.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 26 )); then
  echo "error: building the binary requires Node.js 26+ (found $(node -v))." >&2
  echo "       The packaged binary itself has no Node requirement." >&2
  exit 1
fi
[[ -x "$ESBUILD" ]] || { echo "error: esbuild missing - run 'npm install' at the repo root" >&2; exit 1; }

step() { printf '\n==> %s\n' "$1"; }

step "1/5 building the client"
if ! npm run build --prefix "$ROOT/client" >"$ROOT/build-client.log" 2>&1; then
  tail -30 "$ROOT/build-client.log" >&2
  exit 1
fi

step "2/5 embedding the frontend"
node "$ROOT/packaging/embed-client.mjs" "$BIN"

step "3/5 bundling the server (ESM -> single CJS, dependencies inlined)"
"$ESBUILD" "$ROOT/packaging/sea-entry.ts" \
  --bundle \
  --platform=node \
  --format=cjs \
  --target=node20 \
  --outfile="$ROOT/build/sea-bundle.cjs" \
  --log-level=warning

step "4/5 assembling the single-file executable"
mkdir -p "$OUT_DIR"
rm -f "$BIN"
node --build-sea="$ROOT/build/sea-config.json"

step "5/5 smoke test"
SMOKE_PORT="${YTRIUM_SMOKE_PORT:-8791}"
SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/yttrium-smoke.XXXXXX")"
cleanup() {
  [[ -n "${SMOKE_PID:-}" ]] && kill "$SMOKE_PID" 2>/dev/null || true
  rm -rf "$SMOKE_DIR"
}
trap cleanup EXIT

PORT="$SMOKE_PORT" DATA_DIR="$SMOKE_DIR" "$BIN" >"$SMOKE_DIR/server.log" 2>&1 &
SMOKE_PID=$!

HEALTH=""
for _ in $(seq 1 40); do
  if HEALTH="$(curl -fsS "http://127.0.0.1:${SMOKE_PORT}/api/health" 2>/dev/null)"; then break; fi
  kill -0 "$SMOKE_PID" 2>/dev/null || break
  sleep 0.5
done
if [[ -z "$HEALTH" ]]; then
  echo "error: binary did not become healthy" >&2
  cat "$SMOKE_DIR/server.log" >&2
  exit 1
fi
echo "$HEALTH"
kill "$SMOKE_PID" 2>/dev/null || true
SMOKE_PID=""
trap - EXIT
rm -rf "$SMOKE_DIR"

printf '\n✓ %s (%s)\n' "$BIN" "$(du -h "$BIN" | cut -f1)"
