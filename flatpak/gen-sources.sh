#!/usr/bin/env bash
# Regenerate the offline dependency sources for the Flatpak build.
#
#   flatpak/cargo-sources.json  <- src-tauri/Cargo.lock  (flatpak-cargo-generator)
#   flatpak/node-sources.json   <- package-lock.json     (flatpak-node-generator)
#
# Both generators live in https://github.com/flatpak/flatpak-builder-tools and
# are cloned to /tmp (or $FLATPAK_BUILDER_TOOLS_DIR) on first use.
#
# Run this from anywhere; it always works against the repository root.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLATPAK_DIR="$REPO_ROOT/flatpak"
TOOLS_DIR="${FLATPAK_BUILDER_TOOLS_DIR:-/tmp/flatpak-builder-tools}"
NODE_EXTENSION="${NODE_EXTENSION:-org.freedesktop.Sdk.Extension.node24//26.08}"

mkdir -p "$FLATPAK_DIR"

# --- tooling ---------------------------------------------------------------
if [ ! -d "$TOOLS_DIR/cargo" ] || [ ! -d "$TOOLS_DIR/node" ]; then
    rm -rf "$TOOLS_DIR"
    git clone --depth 1 https://github.com/flatpak/flatpak-builder-tools.git "$TOOLS_DIR"
fi

# Python deps for both generators, in a throwaway venv (keeps the system
# Python clean; override with GEN_VENV=/some/path).
VENV_DIR="${GEN_VENV:-/tmp/zen-flatpak-gen-venv}"
if [ ! -x "$VENV_DIR/bin/python" ]; then
    python3 -m venv "$VENV_DIR"
fi
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet tomlkit aiohttp "pyyaml>=6.0.2" requests
PYTHON="$VENV_DIR/bin/python"

# --- cargo ----------------------------------------------------------------
if [ ! -f "$REPO_ROOT/src-tauri/Cargo.lock" ]; then
    echo "error: src-tauri/Cargo.lock is missing" >&2
    exit 1
fi

"$PYTHON" "$TOOLS_DIR/cargo/flatpak-cargo-generator.py" \
    "$REPO_ROOT/src-tauri/Cargo.lock" \
    -o "$FLATPAK_DIR/cargo-sources.json"
echo "wrote flatpak/cargo-sources.json"

# --- node -----------------------------------------------------------------
if [ ! -f "$REPO_ROOT/package-lock.json" ]; then
    echo "error: package-lock.json is missing (run npm install --package-lock-only)" >&2
    exit 1
fi

if [ -d "$REPO_ROOT/node_modules" ]; then
    echo "note: node_modules/ exists; flatpak-node-generator expects it to be absent" >&2
fi

# A lockfile generated while node_modules/ existed can miss the
# resolved/integrity fields, which makes `npm ci --offline` fail with
# ENOTCACHED inside the sandbox. Fail early instead of producing a broken
# node-sources.json.
"$PYTHON" - "$REPO_ROOT/package-lock.json" <<'PY'
import json, sys
lock = json.load(open(sys.argv[1]))
packages = lock.get("packages", {})
missing = [k for k, v in packages.items() if not v.get("resolved")]
if missing:
    sys.exit(
        "error: package-lock.json is missing 'resolved' for %d package(s) "
        "(e.g. %s).\nRegenerate it with node_modules/ absent:\n"
        "  mv node_modules /tmp/nm && rm package-lock.json && "
        "npm install --package-lock-only --ignore-scripts && mv /tmp/nm node_modules"
        % (len(missing), missing[0])
    )
PY

PYTHONPATH="$TOOLS_DIR/node${PYTHONPATH:+:$PYTHONPATH}" \
    "$PYTHON" -m flatpak_node_generator npm \
    "$REPO_ROOT/package-lock.json" \
    -o "$FLATPAK_DIR/node-sources.json" \
    --node-sdk-extension "$NODE_EXTENSION"
echo "wrote flatpak/node-sources.json"

echo "done"
