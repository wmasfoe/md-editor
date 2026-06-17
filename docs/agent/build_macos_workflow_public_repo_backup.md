# Public Repository Homebrew Workflow Backup

用途：当 `wmasfoe/md-editor` 从私有仓库切换为公开仓库后，可以参考本文件把 Homebrew cask 的下载源切回 `wmasfoe/md-editor` 自身的 GitHub Release asset。

当前私有仓库阶段需要把 DMG 复制到公开的 `wmasfoe/homebrew-tap` Release，否则 Homebrew 匿名下载会收到 404。仓库公开后，可以移除 `Publish public Homebrew asset` 步骤，并让 `Update Homebrew cask` 不再传入 `CASK_RELEASE_REPOSITORY` / `CASK_RELEASE_TAG`。

## 备份 workflow

将下面内容复制到 `.github/workflows/build-macos.yml` 可恢复为“直接从本仓库 Release 下载 DMG”的版本：

```yaml
name: Build macOS App

on:
  workflow_dispatch:
  push:
    branches:
      - "**"
  pull_request:

jobs:
  build:
    runs-on: macos-latest
    permissions:
      contents: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11.6.0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Build macOS app
        run: pnpm build:macos

      - name: Read release version
        id: release_version
        run: |
          node <<'NODE' >> "$GITHUB_OUTPUT"
          const fs = require("fs");
          const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
          const desktopPackage = JSON.parse(fs.readFileSync("apps/desktop/package.json", "utf8"));
          const tauriConfig = JSON.parse(fs.readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
          const cargoToml = fs.readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
          const cargoVersion = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
          const versions = [rootPackage.version, desktopPackage.version, tauriConfig.version, cargoVersion];

          if (versions.some((version) => version !== tauriConfig.version)) {
            throw new Error(`Version mismatch: root=${rootPackage.version}, desktop=${desktopPackage.version}, tauri=${tauriConfig.version}, cargo=${cargoVersion}`);
          }

          console.log(`version=${tauriConfig.version}`);
          console.log(`tag=v${tauriConfig.version}`);
          NODE

      - name: Upload DMG
        uses: actions/upload-artifact@v4
        with:
          name: markdown-editor-macos-dmg
          path: apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg
          if-no-files-found: error

      - name: Create GitHub Release
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        env:
          GH_TOKEN: ${{ github.token }}
          RELEASE_TAG: ${{ steps.release_version.outputs.tag }}
          RELEASE_VERSION: ${{ steps.release_version.outputs.version }}
        run: |
          if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
            gh release upload "$RELEASE_TAG" \
              apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg \
              --clobber
          else
            gh release create "$RELEASE_TAG" \
              apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg \
              --title "Markdown Editor $RELEASE_TAG" \
              --notes "Automated macOS DMG build for $RELEASE_VERSION."
          fi

      - name: Read DMG metadata
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        id: dmg_metadata
        run: |
          dmg_path="$(find apps/desktop/src-tauri/target/release/bundle/dmg -maxdepth 1 -type f -name '*.dmg' -print -quit)"

          if [[ -z "$dmg_path" ]]; then
            echo "No DMG file found." >&2
            exit 1
          fi

          echo "file_name=$(basename "$dmg_path")" >> "$GITHUB_OUTPUT"
          echo "sha256=$(shasum -a 256 "$dmg_path" | awk '{print $1}')" >> "$GITHUB_OUTPUT"

      - name: Clone Homebrew tap
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        env:
          HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
        run: |
          git clone "https://x-access-token:${HOMEBREW_TAP_TOKEN}@github.com/wmasfoe/homebrew-tap.git" homebrew-tap

      - name: Update Homebrew cask
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        env:
          RELEASE_VERSION: ${{ steps.release_version.outputs.version }}
          DMG_FILE_NAME: ${{ steps.dmg_metadata.outputs.file_name }}
          DMG_SHA256: ${{ steps.dmg_metadata.outputs.sha256 }}
          CASK_OUTPUT_PATH: homebrew-tap/Casks/md-editor.rb
        run: node scripts/release/write-homebrew-cask.mjs

      - name: Publish Homebrew tap
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        working-directory: homebrew-tap
        run: |
          if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
            git checkout -b main
          fi

          git add Casks/md-editor.rb

          if git diff --cached --quiet -- Casks/md-editor.rb; then
            echo "Homebrew cask is already up to date."
            exit 0
          fi

          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit -m "Update md-editor to ${{ steps.release_version.outputs.tag }}"
          git push origin main
```

