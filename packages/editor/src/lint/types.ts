import type { MarkdownLintEngine } from "./engine.ts";
import type { Diagnostic } from "@codemirror/lint";

export interface MarkdownLintDiagnostic extends Diagnostic {
  readonly ruleId?: string;
}

export interface LinkDiagnosticItem {
  readonly from?: number;
  readonly to?: number;
  readonly line?: number;
  readonly col?: number;
  readonly target?: string;
  readonly message: string;
  readonly severity?: "error" | "warning";
}

export interface LinkLintOptions {
  /** 外部提供的链接校验器（由宿主接入层集成 file-system 提供） */
  readonly validateLinks?: (
    markdown: string,
  ) => Promise<readonly LinkDiagnosticItem[]> | readonly LinkDiagnosticItem[];
}

export interface DocumentLinterOptions extends LinkLintOptions {
  /** 是否启用 markdownlint 格式与风格规则，默认为 true */
  readonly enableMarkdownLint?: boolean;
  /** 是否启用本地相对链接探针检查，默认为 true */
  readonly enableLinkCheck?: boolean;
  /** 自定义 markdownlint 配置规则覆盖 */
  readonly markdownlintConfig?: Record<string, unknown>;
  /** 宿主注入的 lint 引擎；缺省时 lint 会以可诊断错误失败。 */
  readonly markdownlint?: MarkdownLintEngine;
}
