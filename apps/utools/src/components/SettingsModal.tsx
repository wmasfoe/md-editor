import { dialogButtonClassName, primaryDialogButtonClassName } from "@md-editor/editor-ui";
import { useState } from "react";
import { DEFAULT_UTOOLS_SETTINGS, type UtoolsSettings } from "../utools/db-storage";
import { CODE_FONT_OPTIONS, PROSE_FONT_OPTIONS } from "../utools/fonts";
import { CloseIcon, InfoIcon } from "./Icons";

export interface SettingsModalProps {
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly settings: UtoolsSettings;
  readonly onUpdateSettings: (
    updater: Partial<UtoolsSettings> | ((prev: UtoolsSettings) => UtoolsSettings),
  ) => void;
}

type TabType = "appearance" | "shortcuts" | "global";

interface ShortcutItem {
  readonly key: string;
  readonly desc: string;
}

interface ShortcutCategory {
  readonly title: string;
  readonly items: readonly ShortcutItem[];
}

const TABS: readonly { id: TabType; label: string; description: string }[] = [
  { id: "appearance", label: "外观设置", description: "主题与字体" },
  { id: "shortcuts", label: "快捷键速查", description: "编辑命令" },
  { id: "global", label: "uTools 快捷键", description: "全局呼出" },
];

const SHORTCUT_CATEGORIES: readonly ShortcutCategory[] = [
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

const sectionTitleClassName = "m-0 text-sm leading-[1.4] text-[var(--theme-title)]";
const descriptionClassName = "mb-0 mt-1 text-xs leading-normal text-[var(--theme-muted)]";
const fieldLabelClassName = "block text-[13px] font-semibold text-[var(--theme-title)]";
const inputClassName =
  "h-[30px] w-full rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] px-2 text-[13px] leading-none text-[var(--theme-text)] outline-none focus:border-[var(--theme-primary)] focus:shadow-[0_0_0_2px_var(--theme-primary-soft)]";

export function SettingsModal({
  isOpen,
  onCancel,
  onSave,
  settings,
  onUpdateSettings,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("appearance");

  if (!isOpen) return null;

  const isCustomProse =
    Boolean(settings.proseFontFamily) &&
    !PROSE_FONT_OPTIONS.some((option) => option.id === settings.proseFontFamily);
  const isCustomCode =
    Boolean(settings.codeFontFamily) &&
    !CODE_FONT_OPTIONS.some((option) => option.id === settings.codeFontFamily);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 select-none"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="flex h-[min(620px,calc(100vh-32px))] w-[min(840px,calc(100vw-32px))] min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-[var(--theme-shadow)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="flex min-h-[54px] shrink-0 items-center justify-between gap-4 border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5">
          <div className="min-w-0">
            <h1
              id="settings-title"
              className="m-0 text-[17px] leading-[1.35] text-[var(--theme-title)]"
            >
              设置
            </h1>
            <p className={descriptionClassName}>Inkpoint uTools 插件</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="grid size-[30px] shrink-0 place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]"
            title="取消并关闭"
            aria-label="取消并关闭设置"
          >
            <CloseIcon className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="grid min-h-0 flex-1 grid-cols-[190px_minmax(0,1fr)] overflow-hidden max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_minmax(0,1fr)]">
            <aside className="min-h-0 border-r border-[var(--theme-border)] bg-[var(--theme-chrome)] px-3 py-4 max-[720px]:border-b max-[720px]:border-r-0 max-[720px]:py-2">
              <nav
                className="flex flex-col gap-1 max-[720px]:flex-row max-[720px]:overflow-x-auto"
                role="tablist"
                aria-label="设置"
              >
                {TABS.map((tab) => {
                  const selected = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`settings-panel-${tab.id}`}
                      onClick={() => setActiveTab(tab.id)}
                      className={`grid min-h-[46px] w-full min-w-0 grid-cols-1 rounded-[6px] border-0 px-3 py-2 text-left outline-none transition-colors max-[720px]:min-w-[132px] ${
                        selected
                          ? "bg-[var(--theme-control-active)] text-[var(--theme-title)]"
                          : "bg-transparent text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
                      } focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]`}
                    >
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold leading-[1.3]">
                        {tab.label}
                      </span>
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.35] text-[var(--theme-muted)]">
                        {tab.description}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            <main
              id={`settings-panel-${activeTab}`}
              className="min-h-0 overflow-auto bg-[var(--theme-surface)]"
              role="tabpanel"
            >
              <div className="mx-auto grid w-full max-w-[760px] gap-5 px-7 py-6 max-[760px]:px-4">
                {activeTab === "appearance" ? (
                  <AppearancePanel
                    settings={settings}
                    isCustomProse={isCustomProse}
                    isCustomCode={isCustomCode}
                    onUpdateSettings={onUpdateSettings}
                  />
                ) : null}
                {activeTab === "shortcuts" ? <ShortcutsPanel /> : null}
                {activeTab === "global" ? <GlobalShortcutPanel /> : null}
              </div>
            </main>
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5 py-3.5">
            <div>
              {activeTab === "appearance" ? (
                <button
                  type="button"
                  className={dialogButtonClassName}
                  onClick={() => onUpdateSettings({ ...DEFAULT_UTOOLS_SETTINGS })}
                >
                  恢复默认
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={dialogButtonClassName} onClick={onCancel}>
                取消
              </button>
              <button type="button" className={primaryDialogButtonClassName} onClick={onSave}>
                保存
              </button>
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
}

interface AppearancePanelProps {
  readonly settings: UtoolsSettings;
  readonly isCustomProse: boolean;
  readonly isCustomCode: boolean;
  readonly onUpdateSettings: SettingsModalProps["onUpdateSettings"];
}

function AppearancePanel({
  settings,
  isCustomProse,
  isCustomCode,
  onUpdateSettings,
}: AppearancePanelProps) {
  return (
    <section className="py-1" aria-labelledby="appearance-settings-title">
      <div className="mb-3">
        <h2 id="appearance-settings-title" className={sectionTitleClassName}>
          外观设置
        </h2>
        <p className={descriptionClassName}>调整编辑器字体、字号与明暗主题。</p>
      </div>

      <div className="grid gap-4">
        <fieldset className="grid gap-3 border-0 p-0">
          <legend className={fieldLabelClassName}>字体与排版</legend>

          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
            <span className={fieldLabelClassName}>正文字体</span>
            <select
              className={inputClassName}
              value={isCustomProse ? "custom" : settings.proseFontFamily}
              onChange={(event) => {
                const value = event.target.value;
                onUpdateSettings({
                  proseFontFamily:
                    value === "custom" ? settings.proseFontFamily || "PingFang SC" : value,
                });
              }}
            >
              {PROSE_FONT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
              <option value="custom">自定义字体</option>
            </select>
          </label>
          {isCustomProse ? (
            <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
              <span className={fieldLabelClassName}>自定义正文字体</span>
              <input
                type="text"
                className={inputClassName}
                placeholder="例如 PingFang SC"
                value={settings.proseFontFamily}
                onChange={(event) => onUpdateSettings({ proseFontFamily: event.target.value })}
              />
            </label>
          ) : null}

          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
            <span className={fieldLabelClassName}>代码字体</span>
            <select
              className={inputClassName}
              value={isCustomCode ? "custom" : settings.codeFontFamily}
              onChange={(event) => {
                const value = event.target.value;
                onUpdateSettings({
                  codeFontFamily: value === "custom" ? settings.codeFontFamily || "SF Mono" : value,
                });
              }}
            >
              {CODE_FONT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
              <option value="custom">自定义代码字体</option>
            </select>
          </label>
          {isCustomCode ? (
            <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
              <span className={fieldLabelClassName}>自定义代码字体</span>
              <input
                type="text"
                className={inputClassName}
                placeholder="例如 SF Mono"
                value={settings.codeFontFamily}
                onChange={(event) => onUpdateSettings({ codeFontFamily: event.target.value })}
              />
            </label>
          ) : null}

          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)_44px] items-center gap-3 text-[13px] text-[var(--theme-text)] max-[760px]:grid-cols-[minmax(0,1fr)_44px]">
            <span className={`${fieldLabelClassName} max-[760px]:col-span-2`}>正文字号</span>
            <input
              type="range"
              min={13}
              max={22}
              step={1}
              value={settings.fontSize}
              aria-label="正文字号"
              onChange={(event) => onUpdateSettings({ fontSize: Number(event.target.value) })}
            />
            <output className="text-right text-[13px] tabular-nums text-[var(--theme-control-text)]">
              {settings.fontSize}px
            </output>
          </label>
        </fieldset>

        <div className="grid gap-2.5">
          <h3 className={fieldLabelClassName}>主题</h3>
          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
            <span className={fieldLabelClassName}>应用模式</span>
            <select
              className={inputClassName}
              value={settings.theme}
              onChange={(event) =>
                onUpdateSettings({ theme: event.target.value as UtoolsSettings["theme"] })
              }
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </div>
      </div>
    </section>
  );
}

function ShortcutsPanel() {
  return (
    <section className="py-1" aria-labelledby="shortcut-settings-title">
      <div className="mb-3">
        <h2 id="shortcut-settings-title" className={sectionTitleClassName}>
          快捷键速查
        </h2>
        <p className={descriptionClassName}>uTools 插件沿用 Inkpoint 桌面端的编辑命令。</p>
      </div>
      <div className="grid gap-5">
        {SHORTCUT_CATEGORIES.map((category) => (
          <section key={category.title} className="grid gap-2">
            <h3 className={fieldLabelClassName}>{category.title}</h3>
            <div className="grid gap-1">
              {category.items.map((item) => (
                <div
                  key={item.key}
                  className="grid min-h-[34px] grid-cols-[minmax(0,1fr)_minmax(150px,220px)] items-center gap-3 border-b border-[var(--theme-border)] py-1.5 text-[13px] last:border-b-0 max-[620px]:grid-cols-1"
                >
                  <span className="text-[var(--theme-text)]">{item.desc}</span>
                  <kbd className="justify-self-stretch rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] px-2 py-1 text-[12px] text-[var(--theme-control-text)] max-[620px]:justify-self-start">
                    {item.key}
                  </kbd>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function GlobalShortcutPanel() {
  return (
    <section className="py-1" aria-labelledby="global-shortcut-title">
      <div className="mb-4">
        <h2 id="global-shortcut-title" className={sectionTitleClassName}>
          uTools 全局快捷键
        </h2>
        <p className={descriptionClassName}>把 Inkpoint 绑定为系统快捷入口。</p>
      </div>

      <div className="grid gap-5 text-[13px] leading-relaxed text-[var(--theme-text)]">
        <div className="flex gap-2 border-l-2 border-[var(--theme-primary)] pl-3 text-[var(--theme-control-text)]">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-[var(--theme-primary)]" />
          <p className="m-0">
            在 uTools 偏好设置中，将 Inkpoint 的“速记便签”指令绑定为全局快捷键。
          </p>
        </div>

        <ol className="m-0 grid gap-3 pl-5">
          <li>打开 uTools 主搜索框，按 ⌘ / Ctrl + , 进入偏好设置。</li>
          <li>进入“快捷呼出”或“全局快捷键”。</li>
          <li>添加快捷键，例如 ⌥ + 空格或 ⌘ + ⌥ + M。</li>
          <li>关联指令搜索并选择“md”或“速记便签”。</li>
        </ol>

        <section className="grid gap-1 border-t border-[var(--theme-border)] pt-4">
          <h3 className={fieldLabelClassName}>划词超级面板</h3>
          <p className="m-0 text-[var(--theme-control-text)]">
            选中文本并唤起 uTools 超级面板，选择“划词编辑”即可导入 Inkpoint。
          </p>
        </section>
      </div>
    </section>
  );
}
