import fs from "node:fs";
import path from "node:path";

function shQuote(value) {
  return `'${String(value ?? "").replace(/'/gu, "'\\''")}'`;
}

export function generateInstallScript({
  version,
  dmgUrl = "",
  dmgSha256 = "",
  linuxX64Url = "",
  linuxX64Sha256 = "",
  linuxArm64Url = "",
  linuxArm64Sha256 = "",
}) {
  if (!version) {
    throw new Error("Missing required parameter: version");
  }

  return `#!/bin/sh
set -eu

APP_NAME='Markdown Editor'
APP_BUNDLE='Markdown Editor.app'
APP_BIN_NAME='md-editor'
APPIMAGE_FILE='Markdown_Editor.AppImage'
VERSION=${shQuote(version)}

DMG_URL=${shQuote(dmgUrl)}
DMG_SHA256=${shQuote(dmgSha256.toLowerCase())}

LINUX_X64_URL=${shQuote(linuxX64Url)}
LINUX_X64_SHA256=${shQuote(linuxX64Sha256.toLowerCase())}

LINUX_ARM64_URL=${shQuote(linuxArm64Url)}
LINUX_ARM64_SHA256=${shQuote(linuxArm64Sha256.toLowerCase())}

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

compute_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail "neither sha256sum nor shasum was found"
  fi
}

install_macos() {
  INSTALL_DIR="\${MD_EDITOR_INSTALL_DIR:-/Applications}"
  KEEP_DMG="\${MD_EDITOR_KEEP_DMG:-0}"

  require_command curl
  require_command hdiutil
  require_command awk
  require_command find

  [ -n "$DMG_URL" ] || fail "macOS download URL is not available"

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
  log "Downloading $APP_NAME $VERSION for macOS..."
  curl -fL --retry 3 --retry-delay 2 -o "$dmg_path" "$DMG_URL"

  if [ -n "$DMG_SHA256" ]; then
    actual_sha="$(compute_sha256 "$dmg_path")"
    if [ "$actual_sha" != "$DMG_SHA256" ]; then
      fail "sha256 mismatch: expected $DMG_SHA256, got $actual_sha"
    fi
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
}

install_linux() {
  arch="$(uname -m)"
  download_url=''
  expected_sha=''

  case "$arch" in
    x86_64|amd64)
      download_url="$LINUX_X64_URL"
      expected_sha="$LINUX_X64_SHA256"
      ;;
    aarch64|arm64)
      download_url="$LINUX_ARM64_URL"
      expected_sha="$LINUX_ARM64_SHA256"
      ;;
    *)
      fail "unsupported Linux architecture: $arch"
      ;;
  esac

  [ -n "$download_url" ] || fail "download URL for Linux ($arch) is not available"

  require_command curl
  require_command awk

  INSTALL_BASE="\${MD_EDITOR_INSTALL_DIR:-$HOME/.local/share/md-editor}"
  BIN_DIR="\${MD_EDITOR_BIN_DIR:-$HOME/.local/bin}"
  DESKTOP_DIR="\${XDG_DATA_HOME:-$HOME/.local/share}/applications"

  mkdir -p "$INSTALL_BASE" "$BIN_DIR" "$DESKTOP_DIR"

  target_appimage="$INSTALL_BASE/$APPIMAGE_FILE"
  tmp_file="$INSTALL_BASE/download.tmp"

  log "Downloading $APP_NAME $VERSION for Linux ($arch)..."
  curl -fL --retry 3 --retry-delay 2 -o "$tmp_file" "$download_url"

  if [ -n "$expected_sha" ]; then
    actual_sha="$(compute_sha256 "$tmp_file")"
    if [ "$actual_sha" != "$expected_sha" ]; then
      rm -f "$tmp_file"
      fail "sha256 mismatch: expected $expected_sha, got $actual_sha"
    fi
  fi

  mv "$tmp_file" "$target_appimage"
  chmod +x "$target_appimage"

  ln -sf "$target_appimage" "$BIN_DIR/$APP_BIN_NAME"

  desktop_entry="$DESKTOP_DIR/md-editor.desktop"
  cat << DESKTOP_FILE > "$desktop_entry"
[Desktop Entry]
Name=Markdown Editor
Comment=Daily-usable Markdown and MDX desktop editor
Exec=$target_appimage %F
Terminal=false
Type=Application
Categories=Office;Utility;TextEditor;
MimeType=text/markdown;text/plain;text/x-markdown;
DESKTOP_FILE
  chmod +x "$desktop_entry" 2>/dev/null || true

  log "$APP_NAME $VERSION installed successfully to $target_appimage."
  log "Executable linked to $BIN_DIR/$APP_BIN_NAME"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) log "Tip: Add $BIN_DIR to your PATH to run '$APP_BIN_NAME' from anywhere." ;;
  esac
}

os="$(uname -s)"
case "$os" in
  Darwin)
    install_macos
    ;;
  Linux)
    install_linux
    ;;
  *)
    fail "unsupported operating system: $os"
    ;;
esac
`;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  const version = process.env.RELEASE_VERSION?.trim();
  const dmgSha256 = (process.env.DMG_SHA256 ?? "").trim();
  const dmgUrl = (process.env.DMG_DOWNLOAD_URL ?? process.env.CASK_DOWNLOAD_URL)?.trim() || "";
  const linuxX64Url =
    (process.env.LINUX_X64_DOWNLOAD_URL ?? process.env.LINUX_APPIMAGE_DOWNLOAD_URL)?.trim() || "";
  const linuxX64Sha256 =
    (process.env.LINUX_X64_SHA256 ?? process.env.LINUX_APPIMAGE_SHA256)?.trim() || "";
  const linuxArm64Url = process.env.LINUX_ARM64_DOWNLOAD_URL?.trim() || "";
  const linuxArm64Sha256 = process.env.LINUX_ARM64_SHA256?.trim() || "";
  const outputPath = process.env.INSTALL_SCRIPT_OUTPUT_PATH?.trim() || "install-md-editor.sh";

  if (!version) {
    throw new Error("Missing required environment variable: RELEASE_VERSION");
  }

  const script = generateInstallScript({
    version,
    dmgUrl,
    dmgSha256,
    linuxX64Url,
    linuxX64Sha256,
    linuxArm64Url,
    linuxArm64Sha256,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, script, { mode: 0o755 });
  fs.chmodSync(outputPath, 0o755);
  console.log(`Wrote ${outputPath}`);
}
