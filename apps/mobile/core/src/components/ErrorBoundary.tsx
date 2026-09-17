import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { bridge } from "../bridge/index.ts";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 移动端专用的 React 异常边界隔离器
 * 保证在编辑态组件（CodeMirror、语法插件、KaTeX、Mermaid）抛出未捕获异常时，
 * 不会导致整个 React 视图树完全卸载闪退/白屏，而是优雅呈现错误卡片并提供一键恢复能力。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[Inkpoint ErrorBoundary] Caught render error:", error, errorInfo);

    // 同步将异常信息上报至原生终端日志，方便端侧开发者排查
    bridge.postToNative("error", {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
          <div className="w-full max-w-md rounded-2xl border border-red-200/80 bg-red-50/70 p-6 shadow-sm backdrop-blur-md dark:border-red-900/60 dark:bg-red-950/40">
            {/* 警告图标 */}
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/60 dark:text-red-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-6 w-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </div>

            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {this.props.fallbackTitle ?? "编辑器载入遇到问题"}
            </h3>

            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
              当前文档在编辑模式下的部分插件或排版计算发生异常，已保护文档内容不丢失。
            </p>

            {this.state.error && (
              <pre className="mt-3 max-h-32 overflow-x-auto rounded-lg bg-neutral-900/90 p-3 text-left font-mono text-[11px] leading-relaxed text-red-300 select-text">
                {this.state.error.message}
              </pre>
            )}

            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-95 transition-all cursor-pointer"
              >
                重试恢复
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
