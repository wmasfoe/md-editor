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

# 3. Build the Rust render core as a static library
#
# 渲染核心已从内嵌 JS（quicklook-engine.js + JavaScriptCore）迁到 Rust。
# 扩展通过 C ABI 链接 md-render-ffi，与桌面导出共用同一套渲染实现。
# 本扩展没有 allow-jit entitlement，因此不能走 WebAssembly；
# Rust 原生机器码不受限制（内部 QuickJS 是纯解释器，无需 JIT）。
REPO_ROOT="$(cd "${DESKTOP_DIR}/../.." && pwd)"
RUST_FFI_DIR="${REPO_ROOT}/crates/render-ffi"
RUST_TARGET_DIR="${RUST_FFI_DIR}/target/release"

echo "==> Building Rust render core (md-render-ffi)..."
if ! command -v cargo &>/dev/null; then
  echo "==> Error: cargo not found; cannot build the Rust render core required by Quick Look."
  exit 1
fi
# MACOSX_DEPLOYMENT_TARGET 必须与 Swift 的 -target 一致，否则 Rust 产物会按
# 构建机当前系统版本编译，链接时告警「built for newer macOS than being linked」，
# 且可能用到旧系统不存在的符号，导致扩展在 macOS 12 上加载失败。
MACOSX_DEPLOYMENT_TARGET=12.0 \
  cargo build --release --manifest-path "${RUST_FFI_DIR}/Cargo.toml"
RUST_STATIC_LIB="${RUST_TARGET_DIR}/libmd_render_ffi.a"
if [[ ! -f "${RUST_STATIC_LIB}" ]]; then
  echo "==> Error: Rust static library not found at ${RUST_STATIC_LIB}"
  exit 1
fi

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
  -L "${RUST_TARGET_DIR}" \
  -lmd_render_ffi

# 6. Copy Info.plist (no JS engine asset anymore — rendering is native)
cp "${EXT_DIR}/Info.plist" "${APPEX_PATH}/Contents/Info.plist"

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

# 8. Build PDF Exporter
bash "${DESKTOP_DIR}/scripts/build-pdf-exporter.sh" "${TARGET_APP}"


