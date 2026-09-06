#!/usr/bin/env bash
set -euo pipefail

# Build script for Inkpoint macOS Quick Look App Extension
# Compiles Swift extension, copies assets, and produces InkpointQuickLook.appex

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXT_DIR="${DESKTOP_DIR}/src-tauri/extensions/quicklook"
OUTPUT_DIR="${1:-${DESKTOP_DIR}/src-tauri/target/quicklook}"
APPEX_PATH="${OUTPUT_DIR}/InkpointQuickLook.appex"

# 1. Platform check (macOS only)
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "==> Skipping Quick Look App Extension build (non-macOS platform: $(uname -s))"
  exit 0
fi

# 2. Check swiftc compiler
if ! command -v swiftc &>/dev/null; then
  echo "==> Warning: swiftc not found, skipping Quick Look build"
  exit 0
fi

echo "==> Building Inkpoint Quick Look App Extension (arm64)..."

# 3. Build static renderer engine bundle from @md-editor/renderer-codemirror/static
echo "==> Bundling static renderer engine (quicklook-engine.js)..."
node "${DESKTOP_DIR}/scripts/build-quicklook-engine.mjs"

# 4. Clean and prepare output directories
rm -rf "${APPEX_PATH}"
mkdir -p "${APPEX_PATH}/Contents/MacOS"
mkdir -p "${APPEX_PATH}/Contents/Resources"

# 5. Compile Swift executable (arm64 Apple Silicon)
swiftc \
  -target arm64-apple-macos12.0 \
  -O \
  -o "${APPEX_PATH}/Contents/MacOS/InkpointQuickLook" \
  "${EXT_DIR}/PreviewProvider.swift" \
  "${EXT_DIR}/main.swift" \
  -framework QuickLookUI \
  -framework UniformTypeIdentifiers \
  -framework Foundation \
  -framework JavaScriptCore

# 6. Copy Info.plist and resources
cp "${EXT_DIR}/Info.plist" "${APPEX_PATH}/Contents/Info.plist"
cp "${EXT_DIR}/Resources/quicklook-engine.js" "${APPEX_PATH}/Contents/Resources/"

# 6. Ad-hoc codesign the extension bundle with app sandbox entitlements
if command -v codesign &>/dev/null; then
  echo "==> Ad-hoc code signing InkpointQuickLook.appex..."
  codesign --force --sign - --entitlements "${EXT_DIR}/entitlements.plist" --timestamp=none "${APPEX_PATH}"
fi

echo "==> Successfully built InkpointQuickLook.appex at: ${APPEX_PATH}"

# 7. If target .app bundle directory is specified as argument 2, copy into Contents/PlugIns
TARGET_APP="${2:-}"
if [[ -n "${TARGET_APP}" && -d "${TARGET_APP}" ]]; then
  PLUGINS_DIR="${TARGET_APP}/Contents/PlugIns"
  mkdir -p "${PLUGINS_DIR}"
  echo "==> Injecting InkpointQuickLook.appex into ${PLUGINS_DIR}..."
  rm -rf "${PLUGINS_DIR}/InkpointQuickLook.appex"
  cp -R "${APPEX_PATH}" "${PLUGINS_DIR}/"
  
  # Re-sign the plugin in place
  if command -v codesign &>/dev/null; then
    codesign --force --sign - --entitlements "${EXT_DIR}/entitlements.plist" --timestamp=none "${PLUGINS_DIR}/InkpointQuickLook.appex"
  fi
  echo "==> Quick Look extension successfully bundled into ${TARGET_APP}!"
fi
