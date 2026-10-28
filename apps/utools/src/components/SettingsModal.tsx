import { useState, useMemo } from "react";
import {
  SettingsShell,
  type SettingsTabItem,
  EditorSettingsPanel,
  AppearanceSettingsPanel,
  ShortcutSettingsPanel,
  settingsDescriptionClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
} from "@md-editor/editor-ui/settings";
import type { UtoolsSettings } from "../utools/db-storage";
import { CloseIcon, InfoIcon } from "./Icons";
import { UtoolsAiSettingsPanel } from "./UtoolsAiSettingsPanel";

export interface SettingsModalProps {
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly settings: UtoolsSettings;
  readonly onUpdateSettings: (
    updater: Partial<UtoolsSettings> | ((prev: UtoolsSettings) => UtoolsSettings),
  ) => void;
  readonly onOpenDisclaimer: () => void;
}

interface ShortcutItem {
  readonly key: string;
  readonly desc: string;
}

interface ShortcutCategory {
  readonly title: string;
  readonly items: readonly ShortcutItem[];
}

const SHORTCUT_CATEGORIES: readonly ShortcutCategory[] = [
  {
    title: "AI 智能助写",
    items: [
      { key: "⌘ / Ctrl + J 或 ⌘ / Ctrl + Shift + A", desc: "AI 行内续写 (Ghost Text)" },
      { key: "⌘ / Ctrl + Shift + G", desc: "AI 局部语法错别字审校" },
    ],
  },
  {
    title: "常用操作与视图",
    items: [
      { key: "⌘ / Ctrl + S", desc: "立即保存" },
      { key: "⌘ / Ctrl + N", desc: "新建文档" },
      { key: "⌘ / Ctrl + O", desc: "打开 Markdown 文件" },
      { key: "⌘ / Ctrl + Shift + O", desc: "打开文件夹" },
      { key: "⌘ / Ctrl + Shift + B", desc: "展开或收起文件树" },
      { key: "⌘ / Ctrl + /", desc: "切换所见即所得与源码模式" },
      { key: "⌘ / Ctrl + ,", desc: "打开设置" },
      { key: "⌘ / Ctrl + Enter", desc: "贴回原应用" },
    ],
  },
  {
    title: "Markdown 排版",
    items: [
      { key: "⌘ / Ctrl + B", desc: "加粗" },
      { key: "⌘ / Ctrl + I", desc: "斜体" },
      { key: "⌘ / Ctrl + K", desc: "插入或包裹链接" },
      { key: "⌘ / Ctrl + E", desc: "行内代码" },
      { key: "⌘ / Ctrl + Shift + C", desc: "插入代码块" },
      { key: "⌘ / Ctrl + Shift + S", desc: "删除线" },
      { key: "⌘ / Ctrl + Shift + H", desc: "文本高亮" },
      { key: "⌘ / Ctrl + Shift + Q", desc: "切换引用块" },
      { key: "⌘ / Ctrl + Shift + U", desc: "无序列表" },
      { key: "⌘ / Ctrl + Shift + T", desc: "待办任务列表" },
      { key: "⌘ / Ctrl + ⌥ + 1 ~ 6", desc: "一级至六级标题" },
      { key: "⌘ / Ctrl + ⌥ + 0", desc: "正文段落" },
    ],
  },
  {
    title: "查找与编辑历史",
    items: [
      { key: "⌘ / Ctrl + F", desc: "文档内查找" },
      { key: "⌘ / Ctrl + H", desc: "文档内替换" },
      { key: "⌘ / Ctrl + Z", desc: "撤销，配合 Shift 重做" },
    ],
  },
];

export function SettingsModal({
  isOpen,
  onCancel,
  onSave,
  settings,
  onUpdateSettings,
  onOpenDisclaimer,
}: SettingsModalProps) {
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  const tabs: readonly SettingsTabItem[] = useMemo(
    () => [
      {
        id: "editor",
        label: "编辑器配置",
        description: "排版与标记",
        panel: (
          <EditorSettingsPanel
            fontSize={{
              value: settings.fontSize,
              onChange: (size) => onUpdateSettings({ fontSize: size }),
            }}
            proseFont={{
              value: settings.proseFontFamily,
              onChange: (fam) => onUpdateSettings({ proseFontFamily: fam }),
            }}
            codeFont={{
              value: settings.codeFontFamily,
              onChange: (fam) => onUpdateSettings({ codeFontFamily: fam }),
            }}
            showLineNumbers={{
              checked: settings.showCodeBlockLineNumbers,
              onChange: (checked) => onUpdateSettings({ showCodeBlockLineNumbers: checked }),
            }}
            showInlineStyleMarkers={{
              checked: settings.showInlineStyleMarkers,
              onChange: (checked) => onUpdateSettings({ showInlineStyleMarkers: checked }),
            }}
            enableMarkdownLint={{
              checked: settings.enableMarkdownLint,
              onChange: (checked) => onUpdateSettings({ enableMarkdownLint: checked }),
            }}
          />
        ),
      },
      {
        id: "appearance",
        label: "外观设置",
        description: "主题与色彩",
        panel: (
          <AppearanceSettingsPanel
            mode={settings.theme}
            onChangeMode={(theme) => onUpdateSettings({ theme })}
          />
        ),
      },
      {
        id: "ai",
        label: "AI 智能助写",
        description: "云端协议与预设",
        panel: (
          <UtoolsAiSettingsPanel
            aiSettings={settings.ai}
            onChangeAiSettings={(nextAi) =>
              onUpdateSettings((prev) => ({
                ...prev,
                ai: nextAi,
              }))
            }
            onOpenDisclaimer={onOpenDisclaimer}
          />
        ),
      },
      {
        id: "shortcuts",
        label: "快捷键速查",
        description: "编辑命令",
        panel: <ShortcutSettingsPanel mode="readonly" categories={SHORTCUT_CATEGORIES} />,
      },
      {
        id: "global",
        label: "uTools 快捷键",
        description: "全局呼出",
        panel: (
          <section className={settingsModuleClassName} aria-labelledby="global-shortcut-title">
            <div className="mb-4">
              <h2 id="global-shortcut-title" className={settingsSectionTitleClassName}>
                uTools 全局快捷键
              </h2>
              <p className={settingsDescriptionClassName}>把 Inkpoint 绑定为系统快捷入口。</p>
            </div>

            <div className="grid gap-5 text-[13px] leading-relaxed text-[var(--theme-text)]">
              <div className="flex gap-2 border-l-2 border-[var(--theme-primary)] pl-3 text-[var(--theme-control-text)]">
                <InfoIcon className="mt-0.5 size-4 shrink-0 text-[var(--theme-primary)]" />
                <p className="m-0">
                  在 uTools 偏好设置中，将 Inkpoint 的“速记便签”指令绑定为全局快捷键。
                </p>
              </div>

              <ol className="m-0 grid gap-3 pl-5">
                <li>
                  呼出 uTools 搜索框，输入 <code>偏好设置</code> 并回车打开。
                </li>
                <li>
                  切换到 <strong>全局快捷键</strong> 标签页，点击右上角的 <strong>+ 添加</strong>。
                </li>
                <li>
                  快捷键输入框内按下期望的全局按键组合（例如：<code>⌥ + 空格</code> 或{" "}
                  <code>Ctrl + Shift + M</code>）。
                </li>
                <li>
                  功能指令选择 <strong>Inkpoint: 速记便签</strong>。
                </li>
                <li>配置完成后，在任意应用界面按下该快捷键即可秒级呼出 Inkpoint，随手记下灵感。</li>
              </ol>
            </div>
          </section>
        ),
      },
    ],
    [onOpenDisclaimer, onUpdateSettings, settings],
  );

  return (
    <SettingsShell
      variant="modal"
      open={isOpen}
      title="设置"
      subtitle="Inkpoint uTools 插件"
      tabs={tabs}
      selectedTabIndex={selectedTabIndex}
      onSelectTab={setSelectedTabIndex}
      onClose={onCancel}
      onSave={onSave}
      headerExtra={
        <button
          type="button"
          onClick={onCancel}
          className="grid size-[30px] shrink-0 place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]"
          title="取消并关闭"
          aria-label="取消并关闭设置"
        >
          <CloseIcon className="size-4" />
        </button>
      }
      cancelText="取消"
      saveText="保存"
    />
  );
}
