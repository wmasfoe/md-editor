// apps/utools/src/components/SettingsModal.tsx
// uTools 设置菜单与快捷键速查弹窗：对齐桌面端外观配置（主题/字号/正文字体/代码等宽字体）并完整收敛快捷键指南

import { useState } from "react";
import { DEFAULT_UTOOLS_SETTINGS, type UtoolsSettings } from "../utools/db-storage";
import {
  CODE_FONT_OPTIONS,
  PROSE_FONT_OPTIONS,
  resolveCodeFontStack,
  resolveProseFontStack,
} from "../utools/fonts";
import {
  CloseIcon,
  InfoIcon,
  KeyboardIcon,
  LaptopIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
} from "./Icons";

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UtoolsSettings;
  onUpdateSettings: (
    updater: Partial<UtoolsSettings> | ((prev: UtoolsSettings) => UtoolsSettings),
  ) => void;
}

type TabType = "appearance" | "shortcuts" | "global";

interface ShortcutItem {
  key: string;
  desc: string;
}

interface ShortcutCategory {
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: "常用操作与视图 (对齐桌面端)",
    items: [
      { key: "⌘ / Ctrl + S", desc: "立即保存（草稿同步到云端，文件写盘保存）" },
      { key: "⌘ / Ctrl + N", desc: "新建草稿便签" },
      { key: "⌘ / Ctrl + O", desc: "打开本地 Markdown 文件" },
      { key: "⌘ / Ctrl + Shift + O", desc: "打开本地文件夹（加载完整工作区）" },
      { key: "⌘ / Ctrl + Shift + B", desc: "展开 / 收起文件树侧边栏" },
      { key: "⌘ / Ctrl + /", desc: "切换视图模式（所见即所得 ⇄ 源码模式）" },
      { key: "⌘ / Ctrl + 1", desc: "切换为所见即所得模式" },
      { key: "⌘ / Ctrl + ,", desc: "打开设置偏好菜单" },
      { key: "⌘ / Ctrl + Enter", desc: "贴回原应用（隐藏 uTools 并将内容粘贴至光标处）" },
    ],
  },
  {
    title: "Markdown 格式排版 (对齐桌面端)",
    items: [
      { key: "⌘ / Ctrl + B", desc: "加粗 (Bold)" },
      { key: "⌘ / Ctrl + I", desc: "斜体 (Italic)" },
      { key: "⌘ / Ctrl + K", desc: "插入 / 包裹链接" },
      { key: "⌘ / Ctrl + E", desc: "行内代码 (Inline Code)" },
      { key: "⌘ / Ctrl + Shift + C", desc: "插入代码块 (Code Block)" },
      { key: "⌘ / Ctrl + Shift + S", desc: "删除线 (Strikethrough)" },
      { key: "⌘ / Ctrl + Shift + H", desc: "文本高亮 (Highlight)" },
      { key: "⌘ / Ctrl + Shift + Q", desc: "切换引用块 (Blockquote)" },
      { key: "⌘ / Ctrl + Shift + U", desc: "无序列表 (Bullet List)" },
      { key: "⌘ / Ctrl + Shift + T", desc: "待办任务列表 (Task List)" },
      { key: "⌘ / Ctrl + ⌥ + 1 ~ 6", desc: "一级至六级标题 (H1 ~ H6)" },
      { key: "⌘ / Ctrl + ⌥ + 0", desc: "正文段落" },
    ],
  },
  {
    title: "查找与编辑历史",
    items: [
      { key: "⌘ / Ctrl + F", desc: "文档内查找" },
      { key: "⌘ / Ctrl + H", desc: "文档内替换" },
      { key: "⌘ / Ctrl + Z", desc: "撤销操作（加 Shift 为重做）" },
    ],
  },
];

export function SettingsModal({ isOpen, onClose, settings, onUpdateSettings }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("appearance");

  if (!isOpen) {
    return null;
  }

  const handleResetDefaults = () => {
    onUpdateSettings({ ...DEFAULT_UTOOLS_SETTINGS });
  };

  const previewProseFont = resolveProseFontStack(settings.proseFontFamily);
  const previewCodeFont = resolveCodeFontStack(settings.codeFontFamily);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onClose}
    >
      <div
        className="max-w-xl w-full h-[580px] max-h-[92vh] rounded-xl bg-[var(--theme-surface)] border border-[var(--theme-border)] shadow-2xl p-5 text-sm text-[var(--theme-text)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题与关闭 */}
        <div className="flex items-center justify-between pb-3 border-b border-[var(--theme-border)] shrink-0">
          <h2
            id="settings-title"
            className="text-base font-semibold text-[var(--theme-title)] flex items-center gap-2"
          >
            <SettingsIcon className="size-4 text-[var(--theme-primary)]" />
            <span>Inkpoint 设置与偏好</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] cursor-pointer p-1 rounded hover:bg-[var(--theme-control-hover)] flex items-center justify-center transition-colors"
            title="关闭 (Esc)"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        {/* Tab 导航标签栏 */}
        <div className="flex items-center gap-1 pt-3 pb-2 border-b border-[var(--theme-border)] text-xs font-medium shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("appearance")}
            className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors border-0 ${
              activeTab === "appearance"
                ? "bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] font-semibold"
                : "text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)]"
            }`}
          >
            外观与排版
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("shortcuts")}
            className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors border-0 flex items-center gap-1.5 ${
              activeTab === "shortcuts"
                ? "bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] font-semibold"
                : "text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)]"
            }`}
          >
            <KeyboardIcon className="size-3.5" />
            <span>快捷键速查</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("global")}
            className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors border-0 flex items-center gap-1.5 ${
              activeTab === "global"
                ? "bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] font-semibold"
                : "text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)]"
            }`}
          >
            <InfoIcon className="size-3.5" />
            <span>uTools 全局快捷键</span>
          </button>
        </div>

        {/* Tab 内容区 */}
        <div className="flex-1 overflow-y-auto py-3 pr-1">
          {/* TAB 1: 外观与排版 */}
          {activeTab === "appearance" && (
            <div className="space-y-3">
              {/* 主题设置 */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-[var(--theme-muted)] uppercase tracking-wider block">
                  主题外观
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ theme: "system" })}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs cursor-pointer transition-all ${
                      settings.theme === "system"
                        ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)]/40 text-[var(--theme-primary)] font-medium shadow-xs"
                        : "border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)]"
                    }`}
                  >
                    <LaptopIcon className="size-3.5 shrink-0" />
                    <span>跟随系统</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ theme: "light" })}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs cursor-pointer transition-all ${
                      settings.theme === "light"
                        ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)]/40 text-[var(--theme-primary)] font-medium shadow-xs"
                        : "border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)]"
                    }`}
                  >
                    <SunIcon className="size-3.5 shrink-0" />
                    <span>浅色模式</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ theme: "dark" })}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs cursor-pointer transition-all ${
                      settings.theme === "dark"
                        ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)]/40 text-[var(--theme-primary)] font-medium shadow-xs"
                        : "border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)]"
                    }`}
                  >
                    <MoonIcon className="size-3.5 shrink-0" />
                    <span>深色模式</span>
                  </button>
                </div>
              </div>

              {/* 正文字号 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="settings-font-size"
                    className="text-xs font-semibold text-[var(--theme-muted)] uppercase tracking-wider"
                  >
                    正文字号
                  </label>
                  <span className="text-xs font-mono font-medium text-[var(--theme-primary)] bg-[var(--theme-primary-soft)] px-2 py-0.5 rounded">
                    {settings.fontSize} px
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-[var(--theme-muted)] shrink-0">12px</span>
                  <input
                    id="settings-font-size"
                    type="range"
                    min="12"
                    max="22"
                    step="1"
                    value={settings.fontSize}
                    onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                    className="flex-1 accent-[var(--theme-primary)] cursor-pointer h-1.5 bg-[var(--theme-border)] rounded-lg appearance-none"
                  />
                  <span className="text-[11px] text-[var(--theme-muted)] shrink-0">22px</span>
                </div>
              </div>

              {/* 正文字体族栈 */}
              <div className="space-y-2">
                <label
                  htmlFor="settings-prose-font"
                  className="text-xs font-semibold text-[var(--theme-muted)] uppercase tracking-wider block"
                >
                  正文字体
                </label>
                <div className="relative">
                  <select
                    id="settings-prose-font"
                    value={settings.proseFontFamily}
                    onChange={(e) => onUpdateSettings({ proseFontFamily: e.target.value })}
                    className="w-full py-2 px-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-xs text-[var(--theme-text)] focus:border-[var(--theme-primary)] focus:outline-none cursor-pointer transition-colors"
                  >
                    {PROSE_FONT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-[var(--theme-muted)]">
                  用于文章标题、段落、列表等通用排版正文。
                </p>
              </div>

              {/* 代码等宽字体 */}
              <div className="space-y-2">
                <label
                  htmlFor="settings-code-font"
                  className="text-xs font-semibold text-[var(--theme-muted)] uppercase tracking-wider block"
                >
                  代码等宽字体
                </label>
                <div className="relative">
                  <select
                    id="settings-code-font"
                    value={settings.codeFontFamily}
                    onChange={(e) => onUpdateSettings({ codeFontFamily: e.target.value })}
                    className="w-full py-2 px-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-xs text-[var(--theme-text)] focus:border-[var(--theme-primary)] focus:outline-none cursor-pointer transition-colors"
                  >
                    {CODE_FONT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-[var(--theme-muted)]">
                  用于行内代码、独立代码块及公式排版。
                </p>
              </div>

              {/* 实时效果预览卡片 */}
              <div className="p-2.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] space-y-1.5">
                <div className="text-[11px] font-semibold text-[var(--theme-muted)] uppercase tracking-wider">
                  排版预览效果
                </div>
                <div
                  style={{
                    fontFamily: previewProseFont,
                    fontSize: `${settings.fontSize}px`,
                  }}
                  className="text-[var(--theme-text)] leading-relaxed"
                >
                  山不在高，有仙则名；水不在深，有龙则灵。The quick brown fox jumps over the lazy
                  dog.
                </div>
                <div
                  style={{
                    fontFamily: previewCodeFont,
                    fontSize: `${Math.max(12, settings.fontSize - 1)}px`,
                  }}
                  className="px-2 py-1 rounded bg-[var(--theme-bg-muted)] border border-[var(--theme-border)] text-[var(--theme-primary)]"
                >
                  <code>
                    const editor = new MarkdownEditor({"{"} theme: &quot;{settings.theme}&quot;{" "}
                    {"}"});
                  </code>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 快捷键速查 */}
          {activeTab === "shortcuts" && (
            <div className="space-y-4">
              {SHORTCUT_CATEGORIES.map((category) => (
                <div key={category.title} className="space-y-1.5">
                  <div className="text-xs font-semibold text-[var(--theme-muted)] uppercase tracking-wider mb-1">
                    {category.title}
                  </div>
                  <div className="space-y-1">
                    {category.items.map((item) => (
                      <div
                        key={item.key}
                        className="flex items-center justify-between py-1 px-2 rounded bg-[var(--theme-bg-muted)] text-xs"
                      >
                        <span className="text-[var(--theme-text)]">{item.desc}</span>
                        <kbd className="px-1.5 py-0.5 rounded bg-[var(--theme-surface)] border border-[var(--theme-border)] font-mono text-[11px] text-[var(--theme-title)] shrink-0 ml-2 font-semibold">
                          {item.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: uTools 全局快捷键指南 */}
          {activeTab === "global" && (
            <div className="space-y-4">
              <div className="rounded-md border border-[var(--theme-primary-soft)] bg-[var(--theme-primary-soft)]/20 p-3.5 text-xs space-y-2">
                <div className="font-semibold text-[var(--theme-primary)] flex items-center gap-1.5">
                  <InfoIcon className="size-4 text-[var(--theme-primary)] shrink-0" />
                  <span>uTools 全局系统快捷键配置指南</span>
                </div>
                <p className="text-[var(--theme-muted)] leading-relaxed">
                  可以在 uTools 偏好设置中将 Inkpoint
                  速记绑定为系统全局快捷键，随时秒级呼出全宽沉浸式写作：
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-[var(--theme-text)] text-xs pt-1">
                  <li>
                    打开 uTools 主搜索框，按{" "}
                    <kbd className="px-1.5 py-0.5 bg-[var(--theme-surface)] rounded border text-[11px] font-mono">
                      ⌘ / Ctrl + ,
                    </kbd>{" "}
                    进入偏好设置；
                  </li>
                  <li>点击左侧「快捷呼出」或「全局快捷键」；</li>
                  <li>
                    添加全局快捷键（推荐{" "}
                    <kbd className="px-1.5 py-0.5 bg-[var(--theme-surface)] rounded border text-[11px] font-mono">
                      ⌥ + 空格
                    </kbd>{" "}
                    或{" "}
                    <kbd className="px-1.5 py-0.5 bg-[var(--theme-surface)] rounded border text-[11px] font-mono">
                      ⌘ + ⌥ + M
                    </kbd>
                    ）；
                  </li>
                  <li>
                    关联指令搜索并选择{" "}
                    <span className="font-mono text-[var(--theme-primary)] font-semibold">md</span>{" "}
                    或「速记便签」即可！
                  </li>
                </ol>
              </div>

              <div className="p-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-xs text-[var(--theme-muted)] space-y-1">
                <div className="font-medium text-[var(--theme-title)]">💡 划词超级面板</div>
                <p>
                  选中任何网页或文档中的文本，按下鼠标中键或唤起 uTools
                  超级面板，即可选择「划词编辑」直接将选中文本导入到 Inkpoint 进行润色与排版。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作按钮 */}
        <div className="pt-3 border-t border-[var(--theme-border)] flex items-center justify-between shrink-0">
          {activeTab === "appearance" ? (
            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] cursor-pointer py-1 px-2 rounded hover:bg-[var(--theme-control-hover)] transition-colors border-0 bg-transparent"
            >
              恢复默认外观
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[var(--theme-primary)] text-white text-xs font-medium hover:opacity-90 cursor-pointer border-0 shadow-xs transition-opacity"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
