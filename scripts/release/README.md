# 发布脚本使用指南

## version-desktop.mjs

交互式版本发布脚本，支持：
- 交互式选择版本类型（方向键选择）
- 多行更新内容输入
- 自动更新 CHANGELOG.md

### 使用方法

```bash
pnpm release:version
```

### 交互流程

#### 1. 选择版本类型

使用 ↑/↓ 方向键在以下选项中选择，按 Enter 确认：

- **patch** - 补丁版本 (0.3.18 → 0.3.19)
- **minor** - 次要版本 (0.3.18 → 0.4.0)
- **major** - 主要版本 (0.3.18 → 1.0.0)
- **beta** - 测试版本 (0.3.18 → 0.3.19-beta.1)
- **custom** - 自定义版本号

如果选择 `custom`，会提示输入自定义版本号（格式：x.y.z）。

#### 2. 输入更新内容

每行输入一条更新内容，空行结束输入：

```
请输入本次更新内容 (每行一条，空行结束):

1. 完成内联语法标记路线D验证
2. 将 AI provider 设置逻辑收拢到 @md-editor/ai
3. 修复 lint 错误
4. [空行确认]
```

#### 3. 确认发布信息

脚本会显示版本号和更新内容，确认后继续：

```
=== 发布信息确认 ===
版本: 0.3.18 -> 0.3.19
更新内容:
  1. 完成内联语法标记路线D验证
  2. 将 AI provider 设置逻辑收拢到 @md-editor/ai
  3. 修复 lint 错误

确认发布? (y/N):
```

#### 4. 自动执行更新

确认后，脚本会自动：
- 更新 `package.json`（根目录和 apps/desktop）
- 更新 `apps/desktop/src-tauri/Cargo.toml`
- 更新 `apps/desktop/src-tauri/tauri.conf.json`
- 更新 `CHANGELOG.md`（添加新版本条目）
- 运行 `cargo update`

### 完成后的步骤

脚本会提示后续操作：

```bash
# 1. 检查更改
git diff

# 2. 提交更改
git add .
git commit -m "chore: release v0.3.19"

# 3. 推送到远程
git push origin main

# 4. 打标签
git tag v0.3.19
git push origin v0.3.19
```

### 示例：完整发布流程

```bash
# 1. 运行发布脚本
pnpm release:version

# 交互式操作：
# - 选择 patch (↓ 选择，Enter 确认)
# - 输入更新内容（每行一条）
# - 确认发布 (输入 y)

# 2. 检查生成的更改
git diff

# 3. 提交并推送
git add .
git commit -m "chore: release v0.3.19"
git push origin main

# 4. 打标签
git tag v0.3.19
git push origin v0.3.19
```

### CHANGELOG.md 格式

脚本会自动生成以下格式的 CHANGELOG 条目：

```markdown
## 0.3.19 - 2026-07-15

- 完成内联语法标记路线D验证
- 将 AI provider 设置逻辑收拢到 @md-editor/ai
- 修复 lint 错误
```

### 取消操作

在任何交互步骤中，可以：
- 按 `Ctrl+C` 退出脚本
- 在确认步骤输入 `n` 或 `no` 取消发布

### 错误处理

如果出现错误，脚本会显示错误信息并退出，不会修改任何文件。

常见错误：
- 版本号格式不正确
- 未输入更新内容
- Cargo 验证失败

### 技术细节

脚本更新的文件：
1. `/package.json` - 根目录版本
2. `/apps/desktop/package.json` - 桌面端版本
3. `/apps/desktop/src-tauri/Cargo.toml` - Rust 包版本
4. `/apps/desktop/src-tauri/tauri.conf.json` - Tauri 配置版本
5. `/CHANGELOG.md` - 更新日志

所有版本号保持一致，确保跨平台版本同步。
