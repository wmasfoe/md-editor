/**
 * @fileoverview 更新日志的数据模型
 *
 * 官网（apps/site）与桌面端（apps/desktop）共用同一份 CHANGELOG 解析结果，
 * 保证「更新内容」在两端是同一结构、同一事实源。
 */

/** 更新日志条目中的单个列表项，支持嵌套子项。 */
export interface ChangelogItem {
  /** 条目纯文本（保留行内 Markdown 标记，由渲染层 token 化） */
  text: string;
  /** 嵌套子项 */
  items?: ChangelogItem[];
}

/** 一个版本区块（对应 CHANGELOG 里的 `## <version> - <date> (#pr)`）。 */
export interface ChangelogEntry {
  /** 版本号，不含 `v` 前缀 */
  version: string;
  /** 发布日期，缺失时为空字符串 */
  date: string;
  /** 版本标题里声明的关联 PR 编号 */
  sourcePR?: number[];
  /** 列表项 */
  items: ChangelogItem[];
}
