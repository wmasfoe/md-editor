# 更新内容链路（CHANGELOG → updater manifest → 客户端）

状态：现行契约（2026-10 起）
适用：改发版流程、改 `updater.json`、改客户端更新提示、改 CHANGELOG 格式时必读。

## 为什么有这个契约

旧链路把更新内容丢在了发版环节：GitHub Release body 是硬编码模板
（`Multi-platform release for X`），R2 `updater.json` 的 `notes` 退化为
`Inkpoint <version>`。客户端即便做了弹窗，也只能显示一句版本号 —— 用户的
「检测到更新但没有更新内容」投诉，根因在发版侧而不是 UI 侧。

现行契约：**`apps/desktop/CHANGELOG.md` 是更新内容的唯一事实源**。

## 链路

```
apps/desktop/CHANGELOG.md ──┐
                            ├─ scripts/release/changelog-section.mjs
apps/desktop/CHANGELOG_EN.md┘   ├─ notes（中文区块）→ R2 updater.json.notes
                                │                     └→ homebrew-tap/md-editor-latest.json
                                └─ body（中英双区块）→ GitHub Release body
```

- 抽取入口：`.github/workflows/release-desktop.yml` 的 `Resolve release notes from CHANGELOG` 步骤。
- 抽取失败语义：**缺版本区块、或区块里没有列表项 → 脚本非零退出 → 发版中止**。
  这是刻意的：宁可不发，也不给用户推空更新内容。
- 重跑语义：`gh release edit --notes-file` 会覆盖旧 body，R2 manifest 由 `wrangler r2 object put` 覆盖写。
- 发版前置条件：**`## <version> - <date> (#pr)` 必须已存在于 CHANGELOG**，
  预发布 tag 也一样（beta 通道走 `release-beta.yml`，不受此约束）。

## 标题格式契约（两侧共享）

发版侧与运行时有**两份实现**，它们共享的是「标题格式契约」，不是同一份代码：

| 侧 | 实现 | 输出 |
| --- | --- | --- |
| 发版 | `scripts/release/changelog-section.mjs` | 保留 `## <version>` 的**原文切片**，直接作为 manifest `notes` |
| 运行时 | `packages/changelog/src/parse.ts` | **结构化条目**（version/date/PR/嵌套 items） |

两者不能合并：发版需要保留标题，运行时需要剥掉标题，合并会让两个相反需求互相牵制；
且发版链路直跑 `.mjs`，不依赖 Node 的 type-stripping（避免在发版时刻因语法问题炸链路）。

漂移由 `apps/desktop/tests/app/updates/changelog-contract.test.ts` 交叉断言：
**凡切片器接受的标题，解析器必须能按同一版本命中**；真实 CHANGELOG 全量往返也在该测试内。
改任一侧的正则必须同步另一侧并跑该测试。

## 客户端消费

| 环节 | 位置 | 说明 |
| --- | --- | --- |
| notes 归一 | `apps/desktop/src/app/updates/release-notes.ts` | 占位内容（`Inkpoint x.y.z`、旧 Release 模板）视为无内容；版本未命中时按扁平分拣本切片条目，**不回退 `entries[0]`**（那会展示上一版本内容） |
| 提示准入 | `apps/desktop/src/app/updates/presentation.ts` | `isVersionSkipped` / `shouldPresentUpdateNotice` / `shouldAutoDownloadUpdate` 三个纯函数 |
| 簿记 | `apps/desktop/src-tauri/src/update_prompt.rs` | `app_data_dir()/update-prompt.json`，只存 `lastNotifiedVersion` / `skippedVersion` |

### 两段式提示

1. 检测到新版本且该版本未提示/未跳过、且 notes 有内容 → 弹「本次更新内容」；
   关闭后写 `lastNotifiedVersion`，「跳过此版本」额外写 `skippedVersion`。
2. 下载完成 → 标题栏「重启以更新」+ 一次性 toast，不再弹模态。

### 「跳过此版本」的语义（易错点）

跳过是用户对**自动行为**的拒绝，必须同时满足三条：

- 不自动弹提示；
- **不自动下载**（`shouldAutoDownloadUpdate` 返回 false）—— 只挡提示会被 6h 周期检查绕过，
  用户会先看到「已跳过」，随后又被同一版本以 toast + 标题栏打扰；
- 标题栏不再常驻主色 CTA，但 `downloaded` / `installing` / `installed` 必须保留重启入口。

手动检查仍可看到被跳过的版本；出现更新版本后跳过自动失效（比较版本号，无需清理字段）。

### 跨窗口同步

设置是独立窗口，两个窗口各有 webview 状态。`saveUpdatePromptState` 写盘后
`emit("md-editor-update-prompt-changed")`，另一侧订阅刷新；否则设置窗口里跳过、
主窗口仍会再提示一次。

## 排查清单

| 症状 | 先看 |
| --- | --- |
| 弹窗里只有版本号 | `updater.json` 的 `notes` 是否仍为 `Inkpoint x.y.z`（发版步骤是否跳过） |
| 弹窗标题写 0.16.0、内容是旧版本 | `release-notes.ts` 是否又出现了 `entries[0]` 回退 |
| 发版在 Resolve release notes 步骤失败 | CHANGELOG 是否有该版本区块、区块是否只有标题没有列表项 |
| 跳过某版本后仍被提醒 | `shouldAutoDownloadUpdate` 是否被绕过、簿记事件是否送达另一窗口 |
| 关于窗口 3 秒后才出现 | `capabilities/default.json` 的 `windows` 是否漏了 `about`（漏了会 ACL 拒绝 show/set-focus） |
