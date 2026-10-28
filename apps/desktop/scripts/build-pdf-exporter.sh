#!/usr/bin/env bash
set -euo pipefail

# Build script for Inkpoint macOS PDF Export helper
# Compiles Swift helper and places executable into src-tauri/binaries

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SWIFT_SOURCE="${DESKTOP_DIR}/src-tauri/helpers/pdf_export/main.swift"
OUTPUT_DIR="${DESKTOP_DIR}/src-tauri/binaries"
TARGET_BIN="${OUTPUT_DIR}/inkpoint-pdf-exporter"

# 1. Platform check (macOS only)
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "==> Skipping PDF exporter build (non-macOS platform: $(uname -s))"
  exit 0
fi

# 2. Check swiftc compiler
if ! command -v swiftc &>/dev/null; then
  echo "==> Warning: swiftc not found, skipping PDF exporter build"
  exit 0
fi

if [[ ! -f "${SWIFT_SOURCE}" ]]; then
  echo "==> Warning: ${SWIFT_SOURCE} not found, skipping"
  exit 0
fi

echo "==> Building Inkpoint PDF Exporter (arm64)..."
mkdir -p "${OUTPUT_DIR}"

swiftc \
  -target arm64-apple-macos12.0 \
  -O \
  -o "${TARGET_BIN}" \
  "${SWIFT_SOURCE}" \
  -framework WebKit \
  -framework PDFKit \
  -framework Foundation

# Ad-hoc codesign
if command -v codesign &>/dev/null; then
  codesign --force --sign - --timestamp=none "${TARGET_BIN}" 2>/dev/null || true
fi

echo "==> Successfully built Inkpoint PDF Exporter at: ${TARGET_BIN}"

# 同步拷贝至 target/debug 与 target/release 目录（如果存在），确保开发模式与调试运行即时生效
if [[ -d "${DESKTOP_DIR}/src-tauri/target/debug" ]]; then
  cp -f "${TARGET_BIN}" "${DESKTOP_DIR}/src-tauri/target/debug/inkpoint-pdf-exporter"
  echo "==> Synchronized to target/debug/inkpoint-pdf-exporter"
fi
if [[ -d "${DESKTOP_DIR}/src-tauri/target/release" ]]; then
  cp -f "${TARGET_BIN}" "${DESKTOP_DIR}/src-tauri/target/release/inkpoint-pdf-exporter"
  echo "==> Synchronized to target/release/inkpoint-pdf-exporter"
fi

# If target .app bundle directory is specified, copy into Contents/MacOS or Contents/Resources
TARGET_APP="${1:-}"
if [[ -n "${TARGET_APP}" && -d "${TARGET_APP}" ]]; then
  RESOURCES_DIR="${TARGET_APP}/Contents/Resources"
  mkdir -p "${RESOURCES_DIR}"
  cp -f "${TARGET_BIN}" "${RESOURCES_DIR}/"
  echo "==> PDF exporter successfully bundled into ${RESOURCES_DIR}/"
fi
