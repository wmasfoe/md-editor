/**
 * @fileoverview 文档快照与持久化状态类型定义
 *
 * 本模块定义了编辑器的不可变文档快照 (DocumentSnapshot) 及持久化校验状态 (PersistenceStatus)。
 * 快照作为单向数据流的只读核心载体，向渲染层与 UI 状态层提供统一的数据一致性保证。
 */

import type { Markdown } from "@md-editor/shared";

/**
 * 编辑器运行模式
 * - `wysiwyg`: 所见即所得可视化编辑模式 (CodeMirror 6 投影渲染)
 * - `source`: 纯 Markdown 源码编辑模式
 */
export type EditorMode = "wysiwyg" | "source";

/**
 * 事件或监听器的退订清理函数
 */
export type Unsubscribe = () => void;

/**
 * 文档持久化状态
 *
 * 标识当前文档快照与磁盘/存储介质的数据一致性状态：
 * - `verified`: 已校验确认一致，检查点已落盘
 * - `verification-required`: 刚触发保存操作，正等待原生文件系统确认落盘
 */
export type PersistenceStatus =
  | {
      readonly kind: "verified";
      /** 关联的落盘检查点 ID，未保存或新建文档为 null */
      readonly checkpointId: string | null;
      /** 落盘时的单调递增运行时时序号 */
      readonly sequence: number | null;
    }
  | {
      readonly kind: "verification-required";
      /** 待确认的检查点 ID */
      readonly checkpointId: string;
      /** 保存提交的时序序号 */
      readonly sequence: number;
      /** 另存为等场景下的候选目标文件路径 */
      readonly candidatePath?: string;
    };

/**
 * 不可变文档状态快照
 *
 * 记录文档在某一时刻的完整只读状态。外部组件与渲染器仅能消费此快照，
 * 任何状态变迁必须通过 DocumentState 的 mutation 管道进行。
 */
export interface DocumentSnapshot {
  /** 当前编辑态的 Markdown 文本内容 (已归一化换行符为 \n) */
  readonly markdown: Markdown;
  /** 上次成功落盘保存的 Markdown 内容副本，用于比对 isDirty */
  readonly savedMarkdown: Markdown;
  /** 当前关联的本地物理文件绝对路径，新建未保存时为 null */
  readonly filePath: string | null;
  /** 当前激活的编辑器模式 */
  readonly mode: EditorMode;
  /** 脏标记：当且仅当 markdown !== savedMarkdown 时为 true */
  readonly isDirty: boolean;
  /**
   * 文档实例代际计数器 (Document Generation)
   * 每次执行“新建文档”或“整篇替换文档”时自增，用于快速作废旧文档的所有异步操作
   */
  readonly documentGeneration: number;
  /**
   * 整体状态版本号 (State Revision)
   * 包含内容变动、路径变动、模式切换等任意状态跃迁时单调递增
   */
  readonly stateRevision: number;
  /**
   * 正文内容版本号 (Content Revision)
   * 仅在 Markdown 文本发生实质性改变时递增，便于外部编辑预留令牌 (Reservation) 进行乐观并发控制
   */
  readonly contentRevision: number;
  /** 当前持久化一致性状态 */
  readonly persistenceStatus: PersistenceStatus;
}

/**
 * 监听器异常上下文
 * 当订阅者在处理状态变更抛出未捕获异常时，安全分发器封装此上下文传递给宿主错误处理程序
 */
export interface DocumentListenerErrorContext {
  readonly channel: "transition" | "snapshot";
  readonly event: unknown;
}

/**
 * 创建文档状态机的初始化参数
 */
export interface DocumentStateInput {
  /** 初始 Markdown 内容 */
  readonly markdown?: Markdown;
  /** 初始落盘内容，缺省时等同于 markdown */
  readonly savedMarkdown?: Markdown;
  /** 初始关联文件路径 */
  readonly filePath?: string | null;
  /** 初始编辑模式，缺省为 "wysiwyg" */
  readonly mode?: EditorMode;
  /** 监听器执行异常的回调钩子，避免单一订阅者崩溃影响主事件循环 */
  readonly onListenerError?: (error: unknown, context: DocumentListenerErrorContext) => void;
}
