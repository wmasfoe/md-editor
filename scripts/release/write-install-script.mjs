import fs from "node:fs";
import path from "node:path";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function shQuote(value) {
  return `'${String(value).replace(/'/gu, "'\\''")}'`;
}

const version = requiredEnv("RELEASE_VERSION");
const sha256 = requiredEnv("DMG_SHA256").toLowerCase();
const downloadUrl = (process.env.DMG_DOWNLOAD_URL ?? process.env.CASK_DOWNLOAD_URL)?.trim();
const outputPath = process.env.INSTALL_SCRIPT_OUTPUT_PATH?.trim() || "install-md-editor.sh";

if (!downloadUrl) {
  throw new Error("Missing required environment variable: DMG_DOWNLOAD_URL or CASK_DOWNLOAD_URL");
}
if (!/^[0-9a-f]{64}$/u.test(sha256)) {
  throw new Error(`Expected a 64-character sha256, got "${sha256}".`);
}

const script = `#!/bin/sh
set -eu

APP_NAME='Markdown Editor'
APP_BUNDLE='Markdown Editor.app'
VERSION=${shQuote(version)}
DMG_URL=${shQuote(downloadUrl)}
DMG_SHA256=${shQuote(sha256)}
INSTALL_DIR="\${MD_EDITOR_INSTALL_DIR:-/Applications}"
KEEP_DMG="\${MD_EDITOR_KEEP_DMG:-0}"

log() {
  printf '%s\\n' "$*"
}

fail() {
  printf 'md-editor install: %s\\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

run_with_privilege() {
  if [ -w "$INSTALL_DIR" ]; then
    "$@"
  else
    sudo "$@"
  fi
}

ensure_install_dir() {
  if [ -d "$INSTALL_DIR" ]; then
    return
  fi

  parent_dir="$(dirname "$INSTALL_DIR")"
  if [ -w "$parent_dir" ]; then
    mkdir -p "$INSTALL_DIR"
  else
    sudo mkdir -p "$INSTALL_DIR"
  fi
}

[ "$(uname -s)" = "Darwin" ] || fail "this installer only supports macOS"
require_command curl
require_command hdiutil
require_command shasum
require_command awk
require_command find

tmp_dir="$(mktemp -d "\${TMPDIR:-/tmp}/md-editor-install.XXXXXX")"
mount_dir="$tmp_dir/mount"
dmg_path="$tmp_dir/md-editor.dmg"
mounted=0

cleanup() {
  if [ "$mounted" -eq 1 ]; then
    hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 \\
      || hdiutil detach "$mount_dir" -force -quiet >/dev/null 2>&1 \\
      || true
  fi

  if [ "$KEEP_DMG" = "1" ]; then
    log "Downloaded DMG kept at $dmg_path"
  else
    rm -rf "$tmp_dir"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$mount_dir"
log "Downloading $APP_NAME $VERSION..."
curl -fL --retry 3 --retry-delay 2 -o "$dmg_path" "$DMG_URL"

actual_sha="$(shasum -a 256 "$dmg_path" | awk '{print $1}')"
if [ "$actual_sha" != "$DMG_SHA256" ]; then
  fail "sha256 mismatch: expected $DMG_SHA256, got $actual_sha"
fi

log "Mounting DMG..."
hdiutil attach "$dmg_path" -nobrowse -quiet -mountpoint "$mount_dir"
mounted=1

source_app="$mount_dir/$APP_BUNDLE"
if [ ! -d "$source_app" ]; then
  source_app="$(find "$mount_dir" -maxdepth 2 -type d -name "$APP_BUNDLE" -print -quit)"
fi

[ -n "$source_app" ] && [ -d "$source_app" ] || fail "$APP_BUNDLE was not found in the DMG"

ensure_install_dir
destination="$INSTALL_DIR/$APP_BUNDLE"
if [ -e "$destination" ]; then
  log "Replacing existing app at $destination..."
  run_with_privilege rm -rf "$destination"
fi

log "Installing to $destination..."
run_with_privilege cp -R "$source_app" "$INSTALL_DIR/"

if [ "\${MD_EDITOR_KEEP_QUARANTINE:-0}" != "1" ] && command -v xattr >/dev/null 2>&1; then
  run_with_privilege xattr -dr com.apple.quarantine "$destination" >/dev/null 2>&1 || true
fi

log "$APP_NAME $VERSION installed successfully."
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, script, { mode: 0o755 });
fs.chmodSync(outputPath, 0o755);
console.log(`Wrote ${outputPath}`);
