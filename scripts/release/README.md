# 发布脚本使用指南

## 概述

本项目提供两个发布脚本，都支持交互式版本选择和多行更新内容输入：

### version-desktop.mjs - 仅更新版本号
- 交互式选择版本类型（方向键选择）
- 多行更新内容输入
- 自动更新 CHANGELOG.md
- **不会**提交、打 tag 或推送

### publish-desktop.mjs - 完整发布流程
- 包含 version-desktop.mjs 的所有功能
- 自动 git commit
- 自动创建 git tag
- 自动推送到远程仓库
- 触发 GitHub Actions 发布工作流

---

## version-desktop.mjs - 仅更新版本

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

---

## publish-desktop.mjs - 完整发布流程

### 使用方法

```bash
# 交互式发布（推荐）
pnpm release

# 指定版本类型
pnpm release patch

# 指定具体版本号
pnpm release 0.3.19

# 带发布说明
pnpm release patch --notes "修复重要 bug"

# 预览模式（不实际执行）
pnpm release --dry-run

# 跳过确认提示
pnpm release patch --yes
```

### 交互流程

#### 1. 选择版本类型（同 version-desktop.mjs）

使用 ↑/↓ 方向键选择版本类型：

```
当前版本: 0.3.18

请选择版本类型 (使用 ↑/↓ 方向键选择, Enter 确认):

  → patch      (0.3.19)
    minor      (0.4.0)
    major      (1.0.0)
    beta       (0.3.19-beta.1)
    custom     (x.y.z)
```

#### 2. 输入更新内容（多行）

```
请输入本次更新内容 (每行一条，空行结束):

1. 完成内联语法标记路线D验证
2. 将 AI provider 设置逻辑收拢到 @md-editor/ai
3. 修复 lint 错误
4. [空行确认]
```

#### 3. 确认发布信息

```
Current version: 0.3.18
Next version:    0.3.19
Tag:             v0.3.19
Branch:          main
Notes:           完成内联语法标记路线D验证
- 将 AI provider 设置逻辑收拢到 @md-editor/ai
- 修复 lint 错误

确认创建 v0.3.19 并推送触发 GitHub Actions? [y/N]:
```

#### 4. 自动执行

确认后自动执行：
1. 更新所有版本文件
2. 更新 CHANGELOG.md
3. 创建 git commit
4. 创建 git tag
5. 推送到远程仓库
6. 触发 GitHub Actions 发布工作流

### 命令行选项

```bash
--branch <name>       # 指定发布分支（默认：main）
--allow-any-branch    # 允许在任何分支发布
--dry-run             # 预览模式，不实际执行
--resume              # 恢复中断的发布（版本文件已更新）
--no-push             # 只提交和打 tag，不推送
--notes <text>        # 指定发布说明（跳过多行输入）
--yes, -y             # 跳过确认提示
```

### 使用场景

#### 场景 1：常规发布（推荐）

```bash
pnpm release
# 交互式选择版本 -> 输入更新内容 -> 确认 -> 自动完成
```

#### 场景 2：快速发布（跳过交互）

```bash
pnpm release patch --notes "修复紧急 bug" --yes
```

#### 场景 3：预览发布计划

```bash
pnpm release --dry-run
# 查看将要执行的操作，但不实际执行
```

#### 场景 4：本地发布（不推送）

```bash
pnpm release patch --no-push
# 创建 commit 和 tag，但不推送到远程
```

### 恢复中断的发布

如果发布过程中断（例如网络问题），可以使用 `--resume` 恢复：

```bash
pnpm release --resume
```

这会跳过版本更新步骤，直接从 commit 和 push 开始。

### 错误处理

脚本会在以下情况中止：
- 工作目录不干净（有未提交的更改）
- 不在指定的发布分支
- tag 已存在（本地或远程）
- 版本号格式不正确

### 与 version-desktop.mjs 的区别

| 功能 | version-desktop.mjs | publish-desktop.mjs |
|------|---------------------|---------------------|
| 交互式版本选择 | ✅ | ✅ |
| 多行更新内容 | ✅ | ✅ |
| 更新版本文件 | ✅ | ✅ |
| 更新 CHANGELOG | ✅ | ✅ |
| Git commit | ❌ | ✅ |
| Git tag | ❌ | ✅ |
| Git push | ❌ | ✅ |
| 触发 CI/CD | ❌ | ✅ |

### 推荐工作流

**方案 A：分步控制（更安全）**
```bash
pnpm release:version  # 只更新版本
git diff              # 检查更改
# 手动提交、打 tag、推送
```

**方案 B：一键发布（更快速）**
```bash
pnpm release          # 自动完成所有步骤
```

**方案 C：预览后发布**
```bash
pnpm release --dry-run  # 先预览
pnpm release            # 确认无误后执行
```
