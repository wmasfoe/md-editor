# Inkpoint

Inkpoint 是使用 Rust 和 GPUI 构建的原生 Markdown 编辑器。Beta 分支包含桌面应用和 Rust 编辑器 crates。

## 开发

安装 `rust-toolchain.toml` 指定的 Rust 工具链，并安装 GPUI 在当前平台所需的原生构建依赖。根目录 `Cargo.toml` 同时记录了 workspace 的最低 Rust 版本。

启动桌面应用：

```sh
cargo run --locked -p inkpoint-gpui
```

启动时打开 Markdown 文件：

```sh
cargo run --locked -p inkpoint-gpui -- path/to/document.md
```

也可以使用应用的原生菜单和快捷键打开、保存文件。

## 验证

在仓库根目录运行 Rust workspace 检查：

```sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo build --locked --workspace
```

## Workspace

```text
apps/desktop/             GPUI 原生桌面应用
packages/editor-core/     Markdown 文档与编辑会话
packages/editor-typeset/  Markdown 排版与源码/显示位置映射
packages/editor-gpui/     GPUI 编辑器视图与输入处理
```

## 文档

- [桌面应用开发说明](apps/desktop/README.md)
- [Agent 文档索引](docs/agent/index.md)
- [GPUI 编辑器架构](docs/agent/architecture/gpui_beta_architecture.md)

## 许可证

GPL-3.0-or-later，详见 [LICENSE](LICENSE)。
