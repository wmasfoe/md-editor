import { useLayoutEffect, useState, type ReactNode } from "react";
import type { RuntimeFileService } from "@md-editor/file-system";
import {
  AssetPreview,
  EditorUiProvider,
  WelcomeState,
  type CodeMirrorEditorPorts,
} from "@md-editor/editor-ui";
import { useTranslation } from "@md-editor/i18n";
import { DesktopCodeMirrorEditor } from "../components/DesktopCodeMirrorEditor";
import { EditorTitleBarControls } from "../components/EditorTitleBarControls";
import { SettingsPage } from "../components/SettingsDialog";
import { EditorLoadingState } from "../components/EditorLoadingState";
import { DesktopModals } from "../components/DesktopModals";
import {
  AppSidebar,
  SidebarResizer,
  CollapsedSidebarReveal,
  SIDEBAR_DEFAULT_WIDTH,
} from "../components/AppSidebar";
import { APP_DISPLAY_NAME } from "../lib/app-name";
import { AppTitleBar, EditorToast, isMacPlatform } from "./AppWindowChrome";
import { useDesktopEditorController } from "./controller/useDesktopEditorController";
import {
  DesktopEditorActionsContext,
  useDesktopEditorActions,
  type DesktopEditorActions,
} from "./context/DesktopEditorActionsContext";
import { useDocumentSnapshot } from "./document-store";
import { AppSettingsProvider, useAppSettings } from "./settings-context";
import { useToast } from "./controller/useToast";
import { getLoadingDescription } from "./loading-state";
import { useDocumentUiStore } from "./stores/document-ui-store";
import { useFileActionStore } from "./stores/file-action-store";
import { useSidebarStore } from "./stores/sidebar-store";

export interface AppProps {
  readonly fileService: RuntimeFileService;
  readonly onDesktopActionsChange?: (actions: DesktopEditorActions | null) => void;
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
}

/**
 * 桌面端主应用入口与顶层布局容器。
 *
 * 核心架构分层：
 * 1. AppSettingsProvider: 提供全局偏好设置上下文（外观主题、字体大小、更新检查等）；
 * 2. DesktopEditorUiProvider: 架构适配层，从桌面端 document-store 读取当前活动文档的 snapshot.markdown，
 *    桥接给跨包通用的 EditorUiProvider，为大纲提取、目录跳转和渲染器端口通信提供统一上下文；
 * 3. DesktopEditorEffects: 纯副作用控制器层，挂载键盘快捷键、菜单绑定、文件监视与窗口防丢守卫，
 *    并将控制器动作注入 DesktopEditorActionsContext，本身不订阅任何 UI store 以免产生死循环；
 * 4. MainApp: 组装侧边栏（AppSidebar）、侧栏调宽手柄（SidebarResizer）、主编辑器工作区与全局模态弹窗（DesktopModals）。
 */
export function App({ fileService, onDesktopActionsChange, onRendererPortsChange }: AppProps) {
  const { toast, showToast } = useToast();
  return (
    <AppSettingsProvider showToast={showToast} surface="main">
      {/*
        DesktopEditorUiProvider 置于 DesktopEditorEffects 与消费组件之上：
        - 使得 useDesktopEditorController 内部能正常调用 useEditorUiActions() 注册端口和执行锚点跳转；
        - 将 useDocumentSnapshot() 引起的重渲染范围限制在当前分支，避免根组件 App 及 AppSettingsProvider 每次输入都发生重绘。
      */}
      <DesktopEditorUiProvider showToast={showToast}>
        {/* DesktopEditorEffects 只执行控制器生命周期副作用，不订阅 UI store */}
        <DesktopEditorEffects
          fileService={fileService}
          onDesktopActionsChange={onDesktopActionsChange}
          showToast={showToast}
        >
          <MainApp
            fileService={fileService}
            onRendererPortsChange={onRendererPortsChange}
            toast={toast}
            showToast={showToast}
          />
        </DesktopEditorEffects>
      </DesktopEditorUiProvider>
    </AppSettingsProvider>
  );
}

/**
 * 桌面端编辑器 UI 上下文适配器。
 *
 * 为什么存在 DesktopEditorUiProvider 并在此注入 snapshot = useDocumentSnapshot()？
 * 1. 架构解耦：@md-editor/editor-ui 是通用包，其 EditorUiProvider 只接收纯 markdown 属性，不感知桌面端的状态管理；
 * 2. 大纲响应计算：EditorUiProvider 内部封装了 useOutlineController，必须实时获得最新 markdown 才能解析 TOC 与目录树；
 * 3. 上下文层级保障：DesktopEditorEffects 内部需要调用 useEditorUiActions()，故必须被包裹在 EditorUiProvider 内；
 * 4. 渲染范围隔离：在子组件中订阅 snapshot，避免在打字时引发最外层的 App 与 AppSettingsProvider 重绘。
 */
function DesktopEditorUiProvider({
  children,
  showToast,
}: {
  readonly children: ReactNode;
  readonly showToast: (message: string | null) => void;
}) {
  const snapshot = useDocumentSnapshot();
  return (
    <EditorUiProvider markdown={snapshot.markdown} showToast={showToast}>
      {children}
    </EditorUiProvider>
  );
}

/**
 * 桌面端副作用控制器包装组件。
 *
 * 运行全局快捷键、窗口关闭确认守卫、目录监视等系统级副作用，并通过 Context 向子树分发 actions。
 */
function DesktopEditorEffects({
  children,
  fileService,
  onDesktopActionsChange,
  showToast,
}: {
  readonly children: ReactNode;
  readonly fileService: RuntimeFileService;
  readonly onDesktopActionsChange?: (actions: DesktopEditorActions | null) => void;
  readonly showToast: (message: string | null) => void;
}) {
  const actions = useDesktopEditorController({ fileService, showToast });
  useLayoutEffect(() => {
    onDesktopActionsChange?.(actions);
    return () => onDesktopActionsChange?.(null);
  }, [actions, onDesktopActionsChange]);
  return <DesktopEditorActionsContext value={actions}>{children}</DesktopEditorActionsContext>;
}

/**
 * 桌面端主界面布局组件。
 */
function MainApp({
  fileService,
  onRendererPortsChange,
  toast,
  showToast,
}: {
  readonly fileService: RuntimeFileService;
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
  readonly toast: { readonly id: number; readonly message: string } | null;
  readonly showToast: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const { isSettingsOpen } = useAppSettings();
  const snapshot = useDocumentSnapshot();
  const { isSidebarVisible, setIsSidebarVisible } = useSidebarStore();
  const { pendingAction } = useFileActionStore();
  const { hasActiveDocument, openedAsset, resolveImageSrc, closeAssetPreview, getRecentFiles } =
    useDocumentUiStore();
  const { dispatchCommand, openRecentFile, runEditorUpdateAction } = useDesktopEditorActions();

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const shouldShowOverlayTitleBar = isMacPlatform();
  const pendingActionDescription = getLoadingDescription(pendingAction);

  // Web/Vite 预览没有原生独立子窗口，保留内嵌设置页只作为开发 fallback；桌面端走 Tauri 原生设置子窗口。
  if (isSettingsOpen) {
    return (
      <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--theme-bg)]">
        <AppTitleBar
          title={t("settings.title")}
          isVisible={shouldShowOverlayTitleBar}
          hasWindowControlsInset
        />
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <SettingsPage surface="main" onRelaunchAfterUpdate={() => void runEditorUpdateAction()} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--theme-bg)]">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* 左侧抽屉/分栏侧边栏（包含文件树、大纲与文档模式栏） */}
        <AppSidebar
          fileService={fileService}
          sidebarWidth={sidebarWidth}
          shouldShowOverlayTitleBar={shouldShowOverlayTitleBar}
        />

        {/* 侧边栏宽度调节器（含拖拽虚线预览与指针跟踪） */}
        {isSidebarVisible ? (
          <SidebarResizer
            width={sidebarWidth}
            onCommitWidth={setSidebarWidth}
            onCollapse={() => setIsSidebarVisible(false)}
          />
        ) : null}

        {/* 主编辑工作区 */}
        <section
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-surface)]"
          aria-label={t("sidebar.editorAria")}
        >
          {/* 编辑区窗口顶部标题栏（含文件名称、未保存脏标记及控制按钮） */}
          <AppTitleBar
            title={snapshot.filePath?.split(/[\\/]/u).pop() || APP_DISPLAY_NAME}
            isDirty={snapshot.isDirty}
            isVisible={shouldShowOverlayTitleBar}
            hasWindowControlsInset={!isSidebarVisible}
            titleAlign="center"
            titleIcon="markdown"
            actions={<EditorTitleBarControls />}
            className="bg-[var(--theme-surface)]"
          />

          {/* 侧栏收起状态下的左边缘快捷悬浮展开按钮 */}
          {!isSidebarVisible ? (
            <CollapsedSidebarReveal
              hasTitleBar={shouldShowOverlayTitleBar}
              onReveal={() => setIsSidebarVisible(true)}
            />
          ) : null}

          {/* 核心视图区域：未打开文档欢迎页、CodeMirror 编辑器、图片资源预览与加载状态 */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <EditorToast toast={toast} />

            {!hasActiveDocument && !openedAsset ? (
              <WelcomeState
                recentFiles={getRecentFiles()}
                logoSrc="/logo.png"
                onNewDocument={() => void dispatchCommand("file.new")}
                onOpenDocument={() => void dispatchCommand("file.open")}
                onOpenFolder={() => void dispatchCommand("file.openFolder")}
                onOpenRecent={(path) => void openRecentFile(path)}
              />
            ) : (
              <>
                {hasActiveDocument ? (
                  <DesktopCodeMirrorEditor
                    hidden={openedAsset !== null}
                    onRendererPortsChange={onRendererPortsChange}
                    showToast={showToast}
                  />
                ) : null}
                {openedAsset ? (
                  <div className="absolute inset-0 z-[5] flex min-h-0 flex-col">
                    <AssetPreview
                      asset={openedAsset}
                      resolveAssetSrc={resolveImageSrc}
                      onBack={closeAssetPreview}
                    />
                  </div>
                ) : null}
              </>
            )}

            {/* 异步动作加载中指示浮层 */}
            {pendingAction ? (
              <EditorLoadingState
                title={t("loading.title")}
                description={pendingActionDescription}
                ariaLabel={pendingAction}
                isOverlay
              />
            ) : null}
          </div>
        </section>
      </div>

      {/* 全局模态弹窗层（操作确认、命令面板 Cmd+K、MDX 组件、表格插入） */}
      <DesktopModals />
    </main>
  );
}
