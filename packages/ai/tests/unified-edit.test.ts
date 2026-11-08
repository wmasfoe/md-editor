import { describe, expect, it, vi } from "vitest";
import {
  ACTION_PREFIX_CONT,
  ACTION_PREFIX_EDIT,
  ACTION_PREFIX_NONE,
  createAiWritingService,
  createUnifiedMicroSlice,
  DEFAULT_AI_SETTINGS,
  parseUnifiedEditOutput,
  type AiContextSnapshot,
  type AiSettings,
  type ModelClient,
} from "../src/index.ts";

describe("Unified Edit Suite (类 Cursor Tab 单次前向推理与防御守卫)", () => {
  const baseSlice = "今天天气很好，但是我想出去玩，外面下着大雨。";

  // Case U-1: 标准 Action-First Edit 标签解析
  it("Case U-1: 标准 Action-First Edit 标签解析", () => {
    // 切片中：从索引 7 到 14 为 "但是我想出去玩"
    const from = baseSlice.indexOf("但是我想出去玩");
    const to = from + "但是我想出去玩".length;
    const raw = `${ACTION_PREFIX_EDIT}\n[${from}, ${to}, "但是我想出去玩", "可惜我想出去玩"]`;

    const decision = parseUnifiedEditOutput(raw, { slice: baseSlice, cursorOffset: to });
    expect(decision.action).toBe("edit");
    expect(decision.items).toHaveLength(1);
    expect(decision.items[0]).toEqual({
      action: "edit",
      fromOffset: from,
      toOffset: to,
      originalText: "但是我想出去玩",
      text: "可惜我想出去玩",
    });
  });

  // Case U-2: 标准 Action-First Continuation 标签解析
  it("Case U-2: 标准 Action-First Continuation 标签解析", () => {
    const raw = `${ACTION_PREFIX_CONT}\n我们只能在室内喝咖啡看书。`;
    const cursor = baseSlice.length;

    const decision = parseUnifiedEditOutput(raw, { slice: baseSlice, cursorOffset: cursor });
    expect(decision.action).toBe("continuation");
    expect(decision.items).toHaveLength(1);
    expect(decision.items[0].action).toBe("continuation");
    expect(decision.items[0].text).toBe("我们只能在室内喝咖啡看书。");
    expect(decision.items[0].fromOffset).toBe(cursor);
    expect(decision.items[0].toOffset).toBe(cursor);
  });

  // Case U-3: 无修改负样本 (ACT:NONE 或 [])
  it("Case U-3: 无修改负样本 (ACT:NONE 或 [])", () => {
    const none1 = parseUnifiedEditOutput(ACTION_PREFIX_NONE, { slice: baseSlice });
    expect(none1.action).toBe("none");
    expect(none1.items).toHaveLength(0);

    const none2 = parseUnifiedEditOutput("[]", { slice: baseSlice });
    expect(none2.action).toBe("none");
    expect(none2.items).toHaveLength(0);

    const none3 = parseUnifiedEditOutput("[NONE]", { slice: baseSlice });
    expect(none3.action).toBe("none");
    expect(none3.items).toHaveLength(0);
  });

  // Case U-4: 掺杂 Markdown 代码块包裹与前后废话
  it("Case U-4: 掺杂 Markdown 代码块包裹与前后废话", () => {
    const from = baseSlice.indexOf("大雨");
    const to = from + 2;
    const raw = [
      "根据上下文语境，分析修改建议如下：",
      "```diff",
      "ACT:EDIT",
      `[${from}, ${to}, "大雨", "暴雨"]`,
      "```",
      "祝写作愉快！",
    ].join("\n");

    const decision = parseUnifiedEditOutput(raw, { slice: baseSlice });
    expect(decision.action).toBe("edit");
    expect(decision.items).toHaveLength(1);
    expect(decision.items[0].originalText).toBe("大雨");
    expect(decision.items[0].text).toBe("暴雨");
  });

  // Case U-5: 四重防御锚点验证 (源字符不符丢弃与校准)
  it("Case U-5: 四重防御锚点验证 (源字符不符丢弃与校准)", () => {
    // 1. 完全不存在的幻觉原词 -> 丢弃返回 none
    const rawFake = `${ACTION_PREFIX_EDIT}\n[0, 5, "完全不存在的词汇", "替换词"]`;
    const resFake = parseUnifiedEditOutput(rawFake, { slice: baseSlice });
    expect(resFake.action).toBe("none");
    expect(resFake.items).toHaveLength(0);

    // 2. 坐标稍微偏离（±15 字符），但原词在切片中存在 -> 自动纠偏恢复
    const realFrom = baseSlice.indexOf("下着大雨");
    const fakeFrom = Math.max(0, realFrom - 3);
    const rawShifted = `${ACTION_PREFIX_EDIT}\n[${fakeFrom}, ${fakeFrom + 4}, "下着大雨", "淅淅沥沥地下雨"]`;
    const resShifted = parseUnifiedEditOutput(rawShifted, { slice: baseSlice });
    expect(resShifted.action).toBe("edit");
    expect(resShifted.items[0].fromOffset).toBe(realFrom);
    expect(resShifted.items[0].toOffset).toBe(realFrom + 4);
    expect(resShifted.items[0].originalText).toBe("下着大雨");
  });

  // Case U-6: 状态检查与 Readiness 校验
  it("Case U-6: 状态检查与 Readiness 校验", async () => {
    const service = createAiWritingService({ allowLocal: true });
    const disabledSettings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: false,
    };
    const snap: AiContextSnapshot = {
      before: "测试文本",
      after: "",
      selectedText: "",
      mode: "wysiwyg",
    };

    await expect(service.predictUnifiedEdit(disabledSettings, snap)).rejects.toThrow(
      "请先在设置中开启 AI 功能。",
    );
  });

  // Case U-7: 调度器与优先级验证
  it("Case U-7: 调度器与优先级验证", async () => {
    let capturedPriority: string | undefined;
    const fakeScheduler = {
      schedule: vi
        .fn()
        .mockImplementation((options: { priority: string; run: () => Promise<unknown> }) => {
          capturedPriority = options.priority;
          return {
            promise: options.run(),
          };
        }),
    };

    const generateSpy = vi.fn().mockResolvedValue({
      text: `${ACTION_PREFIX_CONT}\n后续内容`,
    });

    const service = createAiWritingService({
      allowLocal: true,
      scheduler: fakeScheduler as never,
    });
    (service as unknown as { resolveClient: () => ModelClient }).resolveClient = () => ({
      providerId: "openai",
      modelId: "gpt-4.1-mini",
      generate: generateSpy,
    });

    const settings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      features: { ...DEFAULT_AI_SETTINGS.features, continuation: true, editing: true },
      endpoints: {
        ...DEFAULT_AI_SETTINGS.endpoints,
        openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4", apiKey: "sk-test" },
      },
    };

    const snap: AiContextSnapshot = {
      before: "今天天气真好",
      after: "",
      selectedText: "",
      mode: "wysiwyg",
    };

    const res = await service.predictUnifiedEdit(settings, snap, { isGhostText: true });
    expect(capturedPriority).toBe("normal");
    expect(res.action).toBe("continuation");
  });

  // Case U-8: 中断信号 AbortSignal 联动
  it("Case U-8: 中断信号 AbortSignal 联动", async () => {
    const service = createAiWritingService({ allowLocal: true });
    const controller = new AbortController();
    controller.abort();

    const settings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      features: { ...DEFAULT_AI_SETTINGS.features, continuation: true, editing: true },
      endpoints: {
        ...DEFAULT_AI_SETTINGS.endpoints,
        openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4", apiKey: "sk-test" },
      },
    };

    const snap: AiContextSnapshot = {
      before: "今天天气真好",
      after: "",
      selectedText: "",
      mode: "wysiwyg",
    };

    await expect(
      service.predictUnifiedEdit(settings, snap, { signal: controller.signal }),
    ).rejects.toThrow("AI 请求已取消。");
  });

  // Case U-9: 流式首标记 Action-First 协议快速判决测试
  it("Case U-9: 流式首标记 Action-First 协议快速判决", () => {
    // 模拟只接收到前 9 个字符
    const firstChunkCont = "ACT:CONT\n";
    expect(/^ACT:CONT\b/iu.test(firstChunkCont.trim())).toBe(true);

    const firstChunkEdit = "ACT:EDIT\n";
    expect(/^ACT:EDIT\b/iu.test(firstChunkEdit.trim())).toBe(true);
  });

  // Case U-10: 本地 0.6B 模型格式破损时的 Fallback 降级断言
  it("Case U-10: 本地小模型格式破损时的 Fallback 降级断言", () => {
    // 模型未输出 ACT: 标签，但输出了纯续写正文，光标位于切片尾部
    const brokenOutput = "大家一起坐在窗边看着外面的雨滴发呆。";
    const cursorAtEnd = baseSlice.length;

    const fallbackRes = parseUnifiedEditOutput(brokenOutput, {
      slice: baseSlice,
      cursorOffset: cursorAtEnd,
    });
    expect(fallbackRes.action).toBe("continuation");
    expect(fallbackRes.items).toHaveLength(1);
    expect(fallbackRes.items[0].text).toBe(brokenOutput);
  });

  // Case U-11: 自动剔除修改前后内容完全一致的无意义 Edit
  it("Case U-11: 自动剔除修改前后内容完全一致的无意义 Edit", () => {
    // 1. 模型返回 original === replacement 的 Edit
    const rawSame = `${ACTION_PREFIX_EDIT}\n[0, 4, "今天天气", "今天天气"]`;
    const resSame = parseUnifiedEditOutput(rawSame, { slice: baseSlice });
    expect(resSame.action).toBe("none");
    expect(resSame.items).toHaveLength(0);

    // 2. 混合建议中，剔除相同项，仅保留有实质修改的项
    const from = baseSlice.indexOf("下着大雨");
    const rawMixed = `${ACTION_PREFIX_EDIT}\n[[0, 4, "今天天气", "今天天气"], [${from}, ${from + 4}, "下着大雨", "暴雨倾盆"]]`;
    const resMixed = parseUnifiedEditOutput(rawMixed, { slice: baseSlice });
    expect(resMixed.action).toBe("edit");
    expect(resMixed.items).toHaveLength(1);
    expect(resMixed.items[0].text).toBe("暴雨倾盆");
  });

  // 辅助验证：createUnifiedMicroSlice 切片构造
  it("createUnifiedMicroSlice 正确计算微观切片与光标偏移", () => {
    const snap: AiContextSnapshot = {
      before: "Hello World ",
      after: "Foo Bar",
      selectedText: "",
      mode: "wysiwyg",
    };
    const micro = createUnifiedMicroSlice(snap);
    expect(micro.slice).toBe("Hello World Foo Bar");
    expect(micro.cursorOffset).toBe("Hello World ".length);
    expect(micro.prefix).toBe("Hello World ");
    expect(micro.suffix).toBe("Foo Bar");
  });

  it("当在设置中关闭 continuation 时，predictUnifiedEdit 不产出续写建议", async () => {
    const service = createAiWritingService({ allowLocal: true });
    (service as unknown as { resolveClient: () => ModelClient }).resolveClient = () => ({
      providerId: "openai",
      modelId: "gpt-4",
      generate: vi.fn().mockResolvedValue({
        text: `${ACTION_PREFIX_CONT}\n这是自动续写的文本`,
      }),
    });

    const settingsWithoutContinuation: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      features: {
        ...DEFAULT_AI_SETTINGS.features,
        continuation: false, // 关闭续写
        editing: true, // 开启纠错
      },
      endpoints: {
        ...DEFAULT_AI_SETTINGS.endpoints,
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "test",
          model: "gpt-4",
        },
      },
    };

    const snap: AiContextSnapshot = {
      before: "今天天气真好，",
      after: "",
      selectedText: "",
      mode: "wysiwyg",
    };

    const decision = await service.predictUnifiedEdit(settingsWithoutContinuation, snap);
    // 因为续写功能被关闭，返回的决策必须被过滤为 none 且 items 为空
    expect(decision.action).toBe("none");
    expect(decision.items).toHaveLength(0);
  });
});
