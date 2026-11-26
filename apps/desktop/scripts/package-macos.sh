#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
bundle_root="$repository_root/target/gpui-preview"
app_name="Inkpoint GPUI Preview"
bundle_identifier="com.inkpoint.gpui-preview"
binary_name="inkpoint-gpui"
version="${GPUI_VERSION:-}"
target_triple="${CARGO_BUILD_TARGET:-}"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  echo "Set GPUI_VERSION to the GPUI app's semantic version." >&2
  exit 1
fi

binary_path="$repository_root/target"
if [[ -n "$target_triple" ]]; then
  binary_path+="/$target_triple"
fi
binary_path+="/release/$binary_name"
if [[ ! -f "$binary_path" ]]; then
  echo "Build binary is missing at $binary_path." >&2
  exit 1
fi

llama_runtime_root="$repository_root/apps/desktop/runtime/llama"
sidecar_path="$llama_runtime_root/llama-server-aarch64-apple-darwin"
if [[ ! -f "$sidecar_path" ]]; then
  echo "Vendored llama-server runtime is missing at $sidecar_path." >&2
  exit 1
fi

mkdir -p "$bundle_root"
app_bundle="$bundle_root/$app_name.app"
dmg_path="$bundle_root/${app_name// /-}_${version}_aarch64.dmg"
stage_root="$(mktemp -d "${TMPDIR:-/tmp}/inkpoint-gpui-dmg.XXXXXX")"
trap 'rm -rf "$stage_root"' EXIT
rm -rf "$app_bundle" "$dmg_path"

contents_root="$app_bundle/Contents"
macos_root="$contents_root/MacOS"
resources_root="$contents_root/Resources"
llama_root="$resources_root/llama"
mkdir -p "$macos_root" "$llama_root"
cp "$binary_path" "$macos_root/$binary_name"
chmod 755 "$macos_root/$binary_name"
cp "$repository_root/apps/desktop/assets/AppIcon.icns" "$resources_root/AppIcon.icns"
cp "$sidecar_path" "$llama_root/llama-server"
chmod 755 "$llama_root/llama-server"

shared_runtime_directory="$llama_runtime_root/llama-runtime-macos-arm64"
cp "$shared_runtime_directory"/*.dylib "$shared_runtime_directory/LICENSE.llama.cpp" "$llama_root/"

app_version="${version%%-*}"
cat > "$contents_root/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleExecutable</key><string>$binary_name</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleIdentifier</key><string>$bundle_identifier</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleName</key><string>$app_name</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$app_version</string>
<key>CFBundleVersion</key><string>$app_version</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSSupportsAutomaticGraphicsSwitching</key><true/>
<key>UTImportedTypeDeclarations</key><array><dict>
<key>UTTypeIdentifier</key><string>com.inkpoint.markdown</string>
<key>UTTypeDescription</key><string>Markdown Document</string>
<key>UTTypeConformsTo</key><array><string>public.text</string></array>
<key>UTTypeTagSpecification</key><dict>
<key>public.filename-extension</key><array><string>md</string><string>markdown</string><string>mdown</string><string>mkd</string><string>mkdn</string></array>
</dict>
</dict><dict>
<key>UTTypeIdentifier</key><string>com.inkpoint.mdx</string>
<key>UTTypeDescription</key><string>MDX Document</string>
<key>UTTypeConformsTo</key><array><string>public.markdown</string></array>
<key>UTTypeTagSpecification</key><dict>
<key>public.filename-extension</key><string>mdx</string>
</dict>
</dict></array>
<key>CFBundleDocumentTypes</key><array><dict>
<key>CFBundleTypeName</key><string>Markdown Document</string>
<key>CFBundleTypeRole</key><string>Editor</string>
<key>LSHandlerRank</key><string>Alternate</string>
<key>LSItemContentTypes</key><array><string>net.daringfireball.markdown</string><string>public.markdown</string><string>com.inkpoint.markdown</string></array>
</dict><dict>
<key>CFBundleTypeName</key><string>MDX Document</string>
<key>CFBundleTypeRole</key><string>Editor</string>
<key>LSHandlerRank</key><string>Alternate</string>
<key>LSItemContentTypes</key><array><string>com.inkpoint.mdx</string></array>
</dict></array>
</dict></plist>
EOF

plutil -lint "$contents_root/Info.plist"
codesign --force --deep --sign - "$app_bundle"
codesign --verify --deep --strict "$app_bundle"

dmg_stage="$stage_root/dmg"
mkdir -p "$dmg_stage"
cp -R "$app_bundle" "$dmg_stage/$app_name.app"
ln -s /Applications "$dmg_stage/Applications"
hdiutil create -volname "$app_name" -srcfolder "$dmg_stage" -ov -format UDZO "$dmg_path"
echo "Created $dmg_path"
