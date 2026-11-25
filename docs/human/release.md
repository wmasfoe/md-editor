# Beta 桌面应用发布

本指南说明当前 `beta` 分支的原生桌面构建和发布流程。

## Beta CI

推送到 `beta` 分支后，`.github/workflows/release-beta.yml` 会运行 Rust 格式检查、Clippy 和 workspace 测试，然后为 macOS Apple Silicon 构建应用并打包 DMG。成功的 `beta` 分支推送会创建或更新 GitHub prerelease；Pull Request 只运行构建和上传短期 workflow artifact，不发布 prerelease。

Beta 产物是独立的 GPUI Preview 应用，不会更新稳定版 Inkpoint 安装。该流程使用仓库内随附的 llama.cpp runtime，不从网络下载 runtime。

## 本地开发检查

在仓库根目录运行：

```sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
```

## 本地构建 macOS Apple Silicon DMG

在 macOS 上安装 Rust 1.99 工具链及 `aarch64-apple-darwin` target，然后运行：

```sh
cargo +1.99.0 build --locked --release --target aarch64-apple-darwin --package inkpoint-gpui
GPUI_VERSION=0.23.4 CARGO_BUILD_TARGET=aarch64-apple-darwin bash apps/desktop/scripts/package-macos.sh
```

`GPUI_VERSION` 应与 `apps/desktop/Cargo.toml` 中的 app 版本对应。DMG 输出到 `target/gpui-preview/`。打包脚本使用 ad-hoc 签名并调用 macOS 的 `hdiutil`，不会进行 Developer ID 公证。CI 中的 beta 版本号会由 workflow 从 app 版本和 commit SHA 计算。

发布前请确认 Cargo package 版本、应用名称与独立 bundle ID 符合本次 Beta 预览要求。自动更新、官网、其他平台安装包及 npm 包发布当前不属于此工作流。
