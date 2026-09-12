// apps/utools/src/components/ErrorBoundary.tsx
import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("UtoolsApp Error Boundary caught:", error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-white dark:bg-[#1e1e1e] text-red-600 dark:text-red-400 font-sans h-full w-full overflow-auto select-text">
          <h2 className="text-lg font-bold mb-2">Inkpoint 插件渲染异常</h2>
          <p className="text-sm mb-4">
            如果看到此界面，请在 uTools 窗口内右键点击「检查」或按 Cmd+Option+I 查看控制台详细报错。
          </p>
          <pre className="p-3 bg-red-50 dark:bg-red-950/40 rounded border border-red-200 dark:border-red-900 text-xs whitespace-pre-wrap break-all">
            {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
