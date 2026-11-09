/**
 * @file style/host.ts
 * @module @md-editor/ai/style
 * @description
 * 学习引擎依赖的宿主端口。`@md-editor/ai` 不直接访问文件系统或平台 API，
 * desktop 组合根用 Tauri 命令实现这些端口。
 */

import type { AiScheduleOptions, AiScheduledRequest } from "../app/request-scheduler.ts";
import type { LocalInferenceBridge } from "../domain/model-client.ts";
import type { StyleProfileDocument } from "./types.ts";

export interface StyleSampleScanEntry {
  readonly relPath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly modifiedMs: number;
}

export interface StyleSampleScanResult {
  readonly rootPath: string;
  readonly samples: readonly StyleSampleScanEntry[];
  readonly truncated: boolean;
}

/** 文件系统与持久化端口 */
export interface StyleLearningHost {
  /** 扫描当前工作区；宿主负责应用默认排除与用户排除列表，被排除的文件不会出现在结果中 */
  scanSamples(): Promise<StyleSampleScanResult>;
  readSample(relPath: string): Promise<string>;
  loadProfile(): Promise<StyleProfileDocument | null>;
  /**
   * 以“读取最新文档 → 应用修改 → 比较 revision 后写入”的方式更新画像，冲突时重试。
   * 学习轮次可能持续数分钟，期间其他窗口可能修改了自定义规则、采纳记录或清除了数据，
   * 修改函数必须基于传入的最新文档，只改动自己负责的字段。返回写入后的文档。
   */
  updateProfile(
    mutate: (latest: StyleProfileDocument) => StyleProfileDocument,
  ): Promise<StyleProfileDocument>;
}

/**
 * 推理端口：分类请求必须经过共享调度器以独占方式派发，不能直接调用 bridge 绕过调度。
 */
export interface StyleInferencePort {
  /** 由共享 `AiRequestScheduler.schedule` 实现，学习引擎总是传入 `exclusive: true` */
  schedule<T>(options: AiScheduleOptions<T>): AiScheduledRequest<T>;
  /** 只能是本地推理桥，类型上不存在远程路径 */
  readonly bridge: LocalInferenceBridge;
}
