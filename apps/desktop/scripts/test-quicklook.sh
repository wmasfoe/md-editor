#!/usr/bin/env bash
set -euo pipefail

# Inkpoint macOS Quick Look 本地一键测试与验证工具
# 用法:
#   bash apps/desktop/scripts/test-quicklook.sh          # 注册并在访达中按空格体验
#   bash apps/desktop/scripts/test-quicklook.sh --clean  # 清理测试环境

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SAMPLE_FILE="${DESKTOP_DIR}/fixtures/quicklook-sample.md"
DEV_APP="/Applications/InkpointDev.app"

if [[ "${1:-}" == "--clean" ]]; then
  echo "==> 正在清理 Inkpoint Quick Look 测试环境..."
  if [[ -d "${DEV_APP}" ]]; then
    /System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -u "${DEV_APP}" 2>/dev/null || true
    rm -rf "${DEV_APP}"
  fi
  qlmanage -r &>/dev/null || true
  echo "==> 测试环境已恢复干净状态！"
  exit 0
fi

echo "=========================================================="
echo "    Inkpoint macOS Quick Look 快速预览一键验证助手"
echo "=========================================================="

# 1. 编译最新的 Quick Look App Extension
echo "==> 步骤 1/4: 编译 Quick Look 原生扩展..."
bash "${SCRIPT_DIR}/build-quicklook.sh"

# 2. 组装临时测试应用容器 /Applications/InkpointDev.app
echo "==> 步骤 2/4: 在 /Applications 中创建测试宿主应用..."
mkdir -p "${DEV_APP}/Contents/MacOS"
mkdir -p "${DEV_APP}/Contents/PlugIns"

cat << 'EOF' > "${DEV_APP}/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Inkpoint</string>
    <key>CFBundleIdentifier</key>
    <string>dev.md-editor.app</string>
    <key>CFBundleName</key>
    <string>InkpointDev</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.7.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleDocumentTypes</key>
    <array>
        <dict>
            <key>CFBundleTypeName</key>
            <string>Markdown Document</string>
            <key>CFBundleTypeRole</key>
            <string>Editor</string>
            <key>LSItemContentTypes</key>
            <array>
                <string>net.daringfireball.markdown</string>
                <string>public.markdown</string>
                <string>text/markdown</string>
                <string>public.plain-text</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
EOF

cp /bin/ls "${DEV_APP}/Contents/MacOS/Inkpoint"
rm -rf "${DEV_APP}/Contents/PlugIns/InkpointQuickLook.appex"
cp -R "${DESKTOP_DIR}/src-tauri/target/quicklook/InkpointQuickLook.appex" "${DEV_APP}/Contents/PlugIns/"

# 对扩展与应用进行签名
codesign --force --sign - --entitlements "${DESKTOP_DIR}/src-tauri/extensions/quicklook/entitlements.plist" --timestamp=none "${DEV_APP}/Contents/PlugIns/InkpointQuickLook.appex"
codesign --force --sign - --timestamp=none "${DEV_APP}"

# 3. 注册到 macOS 系统 LaunchServices 并激活插件
echo "==> 步骤 3/4: 向 macOS 注册插件并激活..."
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "${DEV_APP}"
pluginkit -a "${DEV_APP}/Contents/PlugIns/InkpointQuickLook.appex"
pluginkit -e use -i dev.md-editor.app.quicklook 2>/dev/null || true
qlmanage -r &>/dev/null || true
qlmanage -r cache &>/dev/null || true

# 4. 在 Finder 中打开并选中测试文件
echo "==> 步骤 4/4: 打开访达 (Finder) 并选中测试 Markdown 文档..."
open -R "${SAMPLE_FILE}"

echo ""
echo "=========================================================="
echo "🎉 准备就绪！"
echo "访达（Finder）窗口已在屏幕上打开，并已为你高亮选中测试文件："
echo "   $(basename "${SAMPLE_FILE}")"
echo ""
echo "👉 请直接按下键盘上的【空格键 (Spacebar)】，即可体验快速查看！"
echo ""
echo "（测试完成后，可运行 'bash apps/desktop/scripts/test-quicklook.sh --clean' 清理测试应用）"
echo "=========================================================="
